const UPI_ID = process.env.NEXT_PUBLIC_UPI_ID;
const MERCHANT_NAME = process.env.NEXT_PUBLIC_MERCHANT_NAME || 'PayRead';

export function buildUpiLink(
  amountPaise: number,
  transactionRef: string,
  articleTitle: string
) {
  if (!UPI_ID) throw new Error('UPI ID is not configured.');

  const params = new URLSearchParams({
    pa: UPI_ID,
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
  const current = JSON.parse(
    localStorage.getItem(key) || '{}'
  );

  current[articleId] = token;
  localStorage.setItem(key, JSON.stringify(current));
}
