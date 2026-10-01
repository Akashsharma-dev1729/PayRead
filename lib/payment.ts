import { persist } from './storage';
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

  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid payment amount.');

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
  persist('payread_access', articleId, token);
}
