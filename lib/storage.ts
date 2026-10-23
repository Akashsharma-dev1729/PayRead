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
// Every purchase token this browser holds (completed and in progress), so they
// can be attached to the account after sign-in. Malformed entries are skipped.
export function storedPurchaseTokens(): string[] {
  const tokens = new Set<string>();
  for (const value of Object.values(readRecord('payread_access'))) {
    if (typeof value === 'string' && UUID.test(value)) tokens.add(value.toLowerCase());
  }
  for (const value of Object.values(readRecord('payread_pending'))) {
    const token = (value as Partial<PaymentSession> | null)?.token;
    if (typeof token === 'string' && UUID.test(token)) tokens.add(token.toLowerCase());
  }
  return [...tokens].slice(0, 100);
}
// A saved token that no longer opens its article (the purchase was refunded or
// revoked) is dropped, so the home page stops showing the article as unlocked.
export function forgetAccess(id: string) {
  const record = readRecord('payread_access');
  if (!(id in record)) return;
  delete record[id];
  try { localStorage.setItem('payread_access', JSON.stringify(record)); } catch { /* storage unavailable */ }
}
// After sign-out: the purchases now live in the account, not in this browser.
export function forgetBrowserPurchases() {
  try { localStorage.removeItem('payread_access'); localStorage.removeItem('payread_pending'); }
  catch { /* storage unavailable: nothing stored */ }
}
// Token of an in-progress purchase, used to pick up an approval that happened
// while the payment dialog was closed.
export function pendingToken(id: string): string | null {
  return savedSession(id)?.token ?? null;
}
