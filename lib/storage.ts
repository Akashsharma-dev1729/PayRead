// Tokens are bearer credentials: keep them in this browser, never in URLs.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PaymentMethod = 'manual_upi' | 'razorpay';
export type PaymentSession = { token: string; ref: string; method?: PaymentMethod };

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;
type RandomId = () => string;

/**
 * Encapsulates browser persistence for article access and pending payments.
 * Dependencies are injected for deterministic tests; browser APIs are only
 * accessed when a method is called, not during server-side module imports.
 */
export class PaymentSessionStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly randomId: RandomId = () => crypto.randomUUID(),
  ) {}

  readRecord(key: string): Record<string, unknown> {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }

  accessToken(articleId: string): string | null {
    const value = this.readRecord('payread_access')[articleId];
    return typeof value === 'string' && UUID.test(value) ? value : null;
  }

  persist(key: string, articleId: string, value: unknown): void {
    const record = this.readRecord(key);
    record[articleId] = value;
    try {
      this.storage.setItem(key, JSON.stringify(record));
    } catch {
      throw new Error('Browser storage is unavailable. Enable site storage before paying.');
    }
  }

  paymentSession(articleId: string, method: PaymentMethod = 'manual_upi'): PaymentSession {
    const existing = this.readRecord('payread_pending')[articleId] as Partial<PaymentSession> | undefined;
    if (
      existing &&
      typeof existing.token === 'string' &&
      UUID.test(existing.token) &&
      typeof existing.ref === 'string' &&
      /^PR[0-9A-Z]{8,62}$/.test(existing.ref)
    ) {
      return existing as PaymentSession;
    }

    const session: PaymentSession = {
      method,
      token: this.randomId(),
      ref: `PR${this.randomId().replaceAll('-', '').toUpperCase()}`,
    };
    this.persist('payread_pending', articleId, session);
    return session;
  }
}

// Preserve the existing public API so payment components need no changes.
function browserStore(): PaymentSessionStore {
  return new PaymentSessionStore(localStorage);
}

export function readRecord(key: string): Record<string, unknown> {
  return browserStore().readRecord(key);
}

export function accessToken(id: string): string | null {
  return browserStore().accessToken(id);
}

export function persist(key: string, id: string, value: unknown): void {
  browserStore().persist(key, id, value);
}

export function paymentSession(id: string, method: PaymentMethod = 'manual_upi'): PaymentSession {
  return browserStore().paymentSession(id, method);
}
