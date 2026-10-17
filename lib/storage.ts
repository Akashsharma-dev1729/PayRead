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
export function savedPaymentSession(id: string): PaymentSession | null {
  const existing = readRecord('payread_pending')[id] as Partial<PaymentSession> | undefined;
  if (!existing || typeof existing.token !== 'string' || !UUID.test(existing.token) || typeof existing.ref !== 'string' || !/^PR[0-9A-Z]{8,62}$/.test(existing.ref)) return null;
  if (existing.method !== undefined && existing.method !== 'manual_upi' && existing.method !== 'razorpay') return null;
  return { token: existing.token, ref: existing.ref, method: existing.method || 'manual_upi' };
}
export function paymentSession(id: string, method: 'manual_upi' | 'razorpay' = 'manual_upi'): PaymentSession {
  const raw = readRecord('payread_pending')[id] as Partial<PaymentSession> | undefined;
  if (raw && typeof raw.token === 'string' && UUID.test(raw.token) && raw.method !== undefined && raw.method !== 'manual_upi' && raw.method !== 'razorpay') {
    throw new Error('The saved purchase has an unknown payment method. Contact the site owner before paying again.');
  }
  const existing = savedPaymentSession(id);
  if (existing) {
    if (existing.method !== method) throw new Error('This purchase uses another payment method. Close and reopen the payment dialog to resume it; do not pay twice.');
    return existing;
  }
  const session = { method, token: crypto.randomUUID(), ref: `PR${crypto.randomUUID().replaceAll('-', '').toUpperCase()}` };
  persist('payread_pending', id, session);
  return session;
}
