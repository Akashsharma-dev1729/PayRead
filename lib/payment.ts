import { persist } from './storage';
const rawUpiId = process.env.NEXT_PUBLIC_UPI_ID?.trim();
const rawMerchantName = process.env.NEXT_PUBLIC_MERCHANT_NAME?.trim();

// A UPI ID (VPA) is handle@provider: letters, digits, dot, hyphen, underscore.
export const UPI_ID = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;

export const paymentConfigError = !rawUpiId
  ? 'NEXT_PUBLIC_UPI_ID is missing.'
  : !UPI_ID.test(rawUpiId)
    ? 'NEXT_PUBLIC_UPI_ID must be a UPI ID such as name@okbank (no spaces, no upi:// prefix).'
    : null;

const MERCHANT_NAME = rawMerchantName || 'PayRead';

// UPI apps decode deep-link values as URIs, not HTML forms: a '+' produced by
// URLSearchParams shows up literally ("Pay+Read"), so encode spaces as %20.
const encode = (value: string) => encodeURIComponent(value);

export function buildUpiLink(
  amountPaise: number,
  transactionRef: string,
) {
  if (!rawUpiId || paymentConfigError) {
    throw new Error(paymentConfigError || 'UPI payment is not configured.');
  }

  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid payment amount.');

  // The reference goes in the note (tn): it is the field the payee actually sees
  // for a personal UPI ID. `tr` is a merchant-only field that is not shown for
  // person-to-person transfers and makes some apps decline the payment.
  return 'upi://pay?' + [
    `pa=${rawUpiId}`,
    `pn=${encode(MERCHANT_NAME)}`,
    `am=${(amountPaise / 100).toFixed(2)}`,
    'cu=INR',
    `tn=${encode(`PayRead ${transactionRef}`)}`,
  ].join('&');
}

// UPI transaction IDs (UTR / UPI Ref No.) are 12 digits. Accept the spaces and
// dashes people paste from their UPI app.
export function normalizeUtr(value: string): string | null {
  const digits = value.replace(/[\s-]/g, '');
  return /^[0-9]{12}$/.test(digits) ? digits : null;
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
