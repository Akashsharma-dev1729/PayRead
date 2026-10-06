# Enable Razorpay in PayRead

This adds one-time, per-article Standard Checkout. It uses the existing article price in paise. It does not add subscriptions or require reader accounts. Existing manual UPI purchases continue to work.

## 1. Update Supabase

You already applied the previous PayRead repair migration. Run only this new file in Supabase SQL Editor:

`supabase/migrations/202610020001_razorpay.sql`

It adds gateway order records and three server-only RPCs, and prevents manual admin approval from bypassing gateway verification. Existing payment rows remain manual UPI. Do not rerun the old 202610010001 migration by itself after this upgrade: it contains the older manual-review function. For a fresh database, schema.sql contains both migrations.

## 2. Set up Test Mode first

Generate Test Mode API keys in your Razorpay account. In Vercel project environment variables (or .env.local for development), add:

| Variable | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project's server-only service-role key |
| `RAZORPAY_KEY_ID` | Razorpay Test Mode Key ID, beginning rzp_test_ |
| `RAZORPAY_KEY_SECRET` | Secret paired with that Key ID |
| `RAZORPAY_WEBHOOK_SECRET` | A separate strong random secret you choose for the webhook |

Keep the existing NEXT_PUBLIC_SUPABASE_URL and public Supabase key. Keep the UPI variables for the manual option. Never prefix a secret with NEXT_PUBLIC_, paste it into frontend code, or commit it to Git. The service-role key bypasses RLS and must remain server-only.

## 3. Deploy and register the webhook

Deploy the corrected code to Vercel. Configure a Razorpay webhook in the SAME mode/account as the API keys:

- URL: `https://YOUR-SITE/api/razorpay/webhook`
- Secret: exactly the `RAZORPAY_WEBHOOK_SECRET` value above
- Events: `payment.captured`, `order.paid`, `refund.processed`

Ensure the endpoint is publicly reachable by Razorpay (not protected by Vercel preview login). Enable automatic capture in Razorpay's payment-capture settings. An authorized-only payment intentionally stays locked until captured.

## 4. Test before using real money

1. Choose an article with no existing pending purchase in your test browser. Select Razorpay, then click Pay with Razorpay.
2. Complete a Razorpay Test Mode payment. Confirm the article unlocks and the payment row becomes completed with provider=razorpay.
3. Cancel checkout: access must stay locked. Reopen: the same order should be reused.
4. Complete another test payment, then close the page. Check the webhook delivery succeeds and reopening the purchase restores access.
5. Send a duplicate webhook: no duplicate purchase should appear.
6. Process a test refund: access should be denied on the next article load. Any nonzero refund revokes the whole article purchase in this version, including partial refunds.
7. Confirm manual UPI still works and appears in the admin approval list. Razorpay payments are not manually approvable there.

Automated local tests simulate Razorpay responses; no actual merchant keys or live transactions were available during development. Complete these merchant-account tests yourself before switching to Live Mode.

## 5. Switch to Live Mode when ready

Use the Live Mode key pair and configure the webhook in Live Mode too. Redeploy. Keep test and production Supabase databases/environments separate so test purchases never grant paid access on the production site. A pending order belongs to the Key ID under which it was created; changing that ID requires reconciling old pending orders. Confirm your Razorpay account is approved for the payment methods you intend to accept. Live processing is subject to Razorpay's terms and fees; no paid dependency was added to the application.

## What the code does

- Browser persists the purchase token before any payment is attempted.
- Server reserves one purchase/order using the database's article price.
- Server creates a Razorpay order; the browser receives only the public Key ID and order details.
- Callback verification uses HMAC over the stored order ID and returned payment ID, then fetches the payment from Razorpay and checks capture, amount, currency and refund state.
- Signed webhooks independently fetch current provider state and complete or revoke access. Duplicate events are safe; late captured events cannot reinstate refunded access.
- Tokens are bearer credentials in this browser, not account-based cross-device access.

## Recovery and limits

If an order-creation request times out after reservation, the app does not create another order blindly. It will show a reconciliation message. The owner should use the local payments.id as the Razorpay receipt, locate the matching order in the same merchant account/mode, verify its amount/currency, and attach the correct order ID to the matching razorpay_orders row using the trusted SQL Editor. If no order exists, confirm that conclusively with Razorpay before removing only that empty reservation so the same purchase can retry. Do not delete payment history or paid orders. Never enter a guessed order ID.

A chosen payment method is retained for that pending purchase to avoid paying through both methods accidentally. Existing pending manual purchases resume manual UPI. If you need to change methods, reconcile the old purchase first. Failed payment attempts inside Razorpay can be retried on the same order.

The endpoint uses same-origin checks, bounded request bodies, timeouts and idempotent order reservations. Public order creation still needs deployment-specific abuse/rate controls at scale. Webhook delivery monitoring, chargeback/dispute handling and account-based recovery are not included. Refund revocation prevents future fetches; it cannot retract content already read or copied. Do not rotate keys/secrets until pending requests/webhook retries are reconciled.

## Documentation used

- https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
- https://razorpay.com/docs/webhooks/validate-test/
