import type { SupabaseClient } from '@supabase/supabase-js';
import { assertCaptured, PaymentError, validSignature } from './razorpay';
import { UUID } from '../storage';
import { SupabasePaymentRepository, type PaymentRepository } from './payment-repository';
import { RazorpayGateway, type PaymentGateway } from './payment-gateway';
type Input = Record<string, unknown>;
export function identity(body: Input) {
    if (typeof body.articleId !== 'string' || !UUID.test(body.articleId) || typeof body.token !== 'string' || !UUID.test(body.token) || typeof body.ref !== 'string' || !/^PR[0-9A-Z]{8,62}$/.test(body.ref))
        throw new PaymentError('Invalid purchase details.');
    return { articleId: body.articleId, token: body.token, ref: body.ref };
}
function databaseError(error: unknown) { if (error)
    throw new PaymentError('Purchase could not be updated. Check the database migration or contact the site owner.', 503); }
/** Coordinates policy; adapters handle persistence and external transport. No request state is shared. */
export class PaymentService {
    constructor(private readonly repository: PaymentRepository, private readonly provider: PaymentGateway, private readonly webhookSecret: () => string | undefined) { }
    async createOrder(body: Input) {
        const input = identity(body), { keyId } = this.provider.configuration();
        if (!this.webhookSecret()?.trim())
            throw new PaymentError('Payment webhook is not configured by the site owner yet.', 503);
        const { data, error } = await this.repository.begin(input.articleId, input.ref, input.token, keyId);
        databaseError(error);
        const purchase = data?.[0];
        if (!purchase)
            throw new PaymentError('Purchase could not be created.', 503);
        if (purchase.key_id !== keyId)
            throw new PaymentError('This purchase belongs to another payment configuration. Contact the site owner.', 409);
        if (purchase.status === 'completed')
            return { completed: true };
        if (purchase.status !== 'pending')
            throw new PaymentError('Purchase was rejected or refunded. Contact the site owner.', 409);
        let orderId = purchase.order_id;
        if (!orderId) {
            if (!purchase.claimed)
                throw new PaymentError('An order is being prepared. Retry shortly. If this persists, ask the site owner to reconcile your payment reference; do not start another purchase.', 409);
            const order = await this.provider.createOrder(purchase.amount_paise, purchase.payment_id);
            if (typeof order.id !== 'string' || !/^order_[A-Za-z0-9]+$/.test(order.id) || order.amount !== purchase.amount_paise || order.currency !== 'INR')
                throw new PaymentError('Gateway returned mismatched order details.', 502);
            const saved = await this.repository.saveOrder(purchase.payment_id, order.id);
            databaseError(saved.error);
            if (!saved.data?.order_id)
                throw new PaymentError('Order could not be saved. Contact the site owner before paying.', 503);
            orderId = saved.data.order_id;
        }
        return { orderId, amount: purchase.amount_paise, currency: 'INR', keyId, completed: false };
    }
    async verifyPayment(body: Input) {
        if (typeof body.token !== 'string' || !UUID.test(body.token) || typeof body.paymentId !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(body.paymentId))
            throw new PaymentError('Invalid payment verification request.');
        const purchase = await this.repository.findPurchase(body.token);
        if (purchase.error || !purchase.data || purchase.data.provider !== 'razorpay')
            throw new PaymentError('Purchase not found.', 404);
        const stored = await this.repository.findOrder(purchase.data.id);
        if (stored.error || !stored.data?.order_id)
            throw new PaymentError('Order not found.', 404);
        const { keySecret, keyId } = this.provider.configuration();
        if (stored.data.key_id !== keyId || body.orderId !== stored.data.order_id || !validSignature(`${stored.data.order_id}|${body.paymentId}`, body.signature, keySecret))
            throw new PaymentError('Payment signature is invalid.', 400);
        const payment = await this.provider.getPayment(body.paymentId);
        if (payment.id !== body.paymentId)
            throw new PaymentError('Payment identity mismatch.', 409);
        assertCaptured(payment, stored.data.order_id, purchase.data.amount_paise);
        const result = await this.repository.complete(stored.data.order_id, body.paymentId, payment.amount, payment.currency);
        databaseError(result.error);
        if (result.data !== true)
            throw new PaymentError('Payment confirmation is not complete.', 503);
        return { completed: true };
    }
    async processWebhook(raw: string, signature: string | null) {
        const secret = this.webhookSecret()?.trim();
        if (!secret)
            throw new PaymentError('Webhook is not configured.', 503);
        if (!validSignature(raw, signature, secret))
            throw new PaymentError('Invalid webhook signature.', 400);
        let event: {
            event?: string;
            payload?: {
                payment?: {
                    entity?: {
                        id?: string;
                    };
                };
                refund?: {
                    entity?: {
                        payment_id?: string;
                    };
                };
            };
        };
        try {
            event = JSON.parse(raw);
        }
        catch {
            throw new PaymentError('Invalid webhook body.');
        }
        if (!event || !['payment.captured', 'order.paid', 'refund.processed'].includes(event.event || ''))
            return { received: true, ignored: true };
        const id = event.event === 'refund.processed' ? event.payload?.refund?.entity?.payment_id : event.payload?.payment?.entity?.id;
        if (typeof id !== 'string' || !/^pay_[A-Za-z0-9]+$/.test(id))
            throw new PaymentError('Webhook payment is missing.');
        // Fetch authoritative current state so late/duplicate captured events cannot undo a refund.
        const payment = await this.provider.getPayment(id);
        if (payment.id !== id || typeof payment.order_id !== 'string')
            throw new PaymentError('Invalid gateway payment.', 502);
        const stored = await this.repository.findPurchaseByOrder(payment.order_id);
        databaseError(stored.error);
        if (!stored.data)
            return { received: true, ignored: true }; // Other orders on the same merchant account.
        if (stored.data.key_id !== this.provider.configuration().keyId)
            throw new PaymentError('Payment key configuration changed.', 409);
        const purchase = await this.repository.findAmount(stored.data.payment_id);
        databaseError(purchase.error);
        if (!purchase.data)
            throw new PaymentError('Purchase is missing.', 503);
        if (payment.amount !== purchase.data.amount_paise || payment.currency !== 'INR')
            throw new PaymentError('Payment amount mismatch.', 409);
        if (typeof payment.amount_refunded === 'number' && payment.amount_refunded > 0) {
            const result = await this.repository.revoke(payment.order_id, id);
            databaseError(result.error);
            return { received: true };
        }
        try {
            assertCaptured(payment, payment.order_id, purchase.data.amount_paise);
        }
        catch (e) {
            if (e instanceof PaymentError && e.status === 202)
                throw new PaymentError('Capture confirmation pending; retry webhook.', 503);
            throw e;
        }
        const result = await this.repository.complete(payment.order_id, id, payment.amount, payment.currency);
        databaseError(result.error);
        if (result.data !== true)
            throw new PaymentError('Confirmation not saved.', 503);
        return { received: true };
    }
}
// Composition root keeps the existing route API stable and creates request-scoped services.
function service(db: SupabaseClient) {
    return new PaymentService(new SupabasePaymentRepository(db), new RazorpayGateway(), () => process.env.RAZORPAY_WEBHOOK_SECRET);
}
export function createOrder(db: SupabaseClient, body: Input) {
    return service(db).createOrder(body);
}
export function verifyPayment(db: SupabaseClient, body: Input) {
    return service(db).verifyPayment(body);
}
export function processWebhook(db: SupabaseClient, raw: string, signature: string | null) {
    return service(db).processWebhook(raw, signature);
}
