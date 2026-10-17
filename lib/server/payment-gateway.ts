import { config, gateway } from './razorpay';
export interface PaymentGateway {
    configuration(): {
        keyId: string;
        keySecret: string;
    };
    createOrder(amount: number, receipt: string): Promise<Record<string, unknown>>;
    getPayment(paymentId: string): Promise<Record<string, unknown>>;
}
/** Provider adapter owns Razorpay's HTTP paths and order payload shape. */
export class RazorpayGateway implements PaymentGateway {
    configuration() { return config(); }
    createOrder(amount: number, receipt: string) {
        return gateway('orders', 'POST', { amount, currency: 'INR', receipt, partial_payment: false });
    }
    getPayment(paymentId: string) {
        return gateway(`payments/${paymentId}`);
    }
}
