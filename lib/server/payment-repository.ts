import type { SupabaseClient } from '@supabase/supabase-js';
/** Persistence boundary. Atomic purchase transitions remain in PostgreSQL RPCs. */
export class SupabasePaymentRepository {
    constructor(private readonly db: SupabaseClient) { }
    begin(articleId: string, ref: string, token: string, keyId: string) {
        return this.db.rpc('begin_razorpay_payment', {
            p_article_id: articleId, p_transaction_ref: ref,
            p_access_token: token, p_key_id: keyId,
        });
    }
    saveOrder(paymentId: string, orderId: string) {
        return this.db.from('razorpay_orders').update({ order_id: orderId })
            .eq('payment_id', paymentId).is('order_id', null).select('order_id').single();
    }
    findPurchase(token: string) {
        return this.db.from('payments').select('id,amount_paise,provider')
            .eq('access_token', token).single();
    }
    findOrder(paymentId: string) {
        return this.db.from('razorpay_orders').select('order_id,key_id')
            .eq('payment_id', paymentId).single();
    }
    findPurchaseByOrder(orderId: string) {
        return this.db.from('razorpay_orders').select('payment_id,key_id')
            .eq('order_id', orderId).maybeSingle();
    }
    findAmount(paymentId: string) {
        return this.db.from('payments').select('amount_paise').eq('id', paymentId).single();
    }
    complete(orderId: string, paymentId: string, amount: unknown, currency: unknown) {
        return this.db.rpc('complete_razorpay_payment', {
            p_order_id: orderId, p_payment_id: paymentId, p_amount: amount, p_currency: currency,
        });
    }
    revoke(orderId: string, paymentId: string) {
        return this.db.rpc('revoke_razorpay_payment', { p_order_id: orderId, p_payment_id: paymentId });
    }
}
/** Structural port permits isolated fakes without inheritance or a live database. */
export type PaymentRepository = Pick<SupabasePaymentRepository, 'begin' | 'saveOrder' | 'findPurchase' | 'findOrder' | 'findPurchaseByOrder' | 'findAmount' | 'complete' | 'revoke'>;
