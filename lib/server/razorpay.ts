import { createHmac, timingSafeEqual } from 'node:crypto';

export class PaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function validSignature(body: string, signature: unknown, secret: string): boolean {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) || !secret) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export function config() {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId) || !keySecret) throw new PaymentError('Razorpay is not configured by the site owner yet.', 503);
  return { keyId, keySecret };
}
export async function gateway(path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
  const { keyId, keySecret } = config();
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method, headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(12000),
    });
  } catch { throw new PaymentError('Payment provider could not be reached. Retry this purchase; do not pay again.', 502); }
  if (!response.ok) throw new PaymentError('Payment provider could not process this request. Contact the site owner if it persists.', 502);
  try { return await response.json(); } catch { throw new PaymentError('Invalid payment provider response.', 502); }
}
export function assertCaptured(payment: Record<string, unknown>, orderId: string, amount: number) {
  if (payment.order_id !== orderId || payment.amount !== amount || payment.currency !== 'INR') throw new PaymentError('Payment does not match this purchase.', 409);
  if (typeof payment.amount_refunded !== 'number' || payment.amount_refunded !== 0 || payment.status === 'refunded') throw new PaymentError('Payment has been refunded or cannot be verified.', 409);
  if (payment.status !== 'captured' || payment.captured !== true) throw new PaymentError('Payment is awaiting capture. Do not pay again; confirmation will update automatically.', 202);
}
