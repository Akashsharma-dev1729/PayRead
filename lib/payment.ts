const rawUpiId = process.env.NEXT_PUBLIC_UPI_ID?.trim();
const rawMerchantName = process.env.NEXT_PUBLIC_MERCHANT_NAME?.trim();

export const paymentConfigError = !rawUpiId
  ? 'NEXT_PUBLIC_UPI_ID is missing.'
  : null;

const MERCHANT_NAME = rawMerchantName || 'PayRead';

export function buildUpiLink(
  amountPaise: number,
  transactionRef: string,
  articleTitle: string,
) {
  if (!rawUpiId) {
    throw new Error(paymentConfigError || 'UPI payment is not configured.');
  }

  const params = new URLSearchParams({
    pa: rawUpiId,
    pn: MERCHANT_NAME,
    am: (amountPaise / 100).toFixed(2),
    cu: 'INR',
    tn: `PayRead: ${articleTitle.slice(0, 40)}`,
    tr: transactionRef,
  });

  return `upi://pay?${params.toString()}`;
}

export function newToken() {
  return crypto.randomUUID();
}

export function newTransactionRef() {
  return `PR${Date.now()}${crypto
    .randomUUID()
    .replaceAll('-', '')
    .slice(0, 8)
    .toUpperCase()}`;
}

export function formatPrice(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(paise / 100);
}

export function saveAccess(articleId: string, token: string) {
  const key = 'payread_access';
  let current: Record<string, string> = {};

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        current = parsed as Record<string, string>;
      }
    }
  } catch {
    // A corrupt browser value should never prevent a successful purchase from
    // being stored. Start with a clean access map instead.
    current = {};
  }

  current[articleId] = token;
  localStorage.setItem(key, JSON.stringify(current));
}
