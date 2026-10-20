// Tokens are bearer credentials: keep them in this browser, never in URLs.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function readRecord(key: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
export function accessToken(id: string): string | null {
  const value = readRecord('payread_access')[id];
  return typeof value === 'string' && UUID.test(value) ? value : null;
}
export function persist(key: string, id: string, value: unknown) {
  const record = readRecord(key);
  record[id] = value;
  try { localStorage.setItem(key, JSON.stringify(record)); }
  catch { throw new Error('Browser storage is unavailable. Enable site storage before paying.'); }
}
export type PaymentSession = { token: string; ref: string; method?: 'manual_upi' | 'razorpay' };
function savedSession(id: string): PaymentSession | null {
  const existing = readRecord('payread_pending')[id] as Partial<PaymentSession> | undefined;
  return existing && typeof existing.token === 'string' && UUID.test(existing.token) && typeof existing.ref === 'string' && /^PR[0-9A-Z]{8,62}$/.test(existing.ref)
    ? existing as PaymentSession : null;
}
function freshSession(id: string, method: 'manual_upi' | 'razorpay'): PaymentSession {
  const session = { method, token: crypto.randomUUID(), ref: `PR${crypto.randomUUID().replaceAll('-', '').toUpperCase()}` };
  persist('payread_pending', id, session);
  return session;
}
export function paymentSession(id: string, method: 'manual_upi' | 'razorpay' = 'manual_upi'): PaymentSession {
  return savedSession(id) ?? freshSession(id, method);
}
// Only after the administrator has rejected the saved payment: replaces the
// identity so the buyer can make a new purchase instead of being stuck forever.
export function restartPaymentSession(id: string, method: 'manual_upi' | 'razorpay' = 'manual_upi'): PaymentSession {
  return freshSession(id, method);
}
// Token of an in-progress purchase, used to pick up an approval that happened
// while the payment dialog was closed.
export function pendingToken(id: string): string | null {
  return savedSession(id)?.token ?? null;
}
