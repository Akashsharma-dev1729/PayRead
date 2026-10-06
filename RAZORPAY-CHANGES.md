# Razorpay integration

Built on the previously audited PayRead ZIP; manual UPI and existing purchases are preserved.

- Payment-method chooser and Pay with Razorpay checkout button.
- Server-owned Razorpay orders at the stored article price, with one durable order reservation per purchase.
- Server verification of checkout signatures, payment identity, order, amount, INR currency, captured state and refund state.
- Signed, raw-body webhooks for capture and refunds; idempotent database completion and irreversible refund revocation for that purchase.
- Database permissions restrict gateway completion/revocation to the server. Manual admin review cannot approve gateway payments.
- Pending purchases survive reloads, and paid articles still use the existing token-checked content RPC.
- No secret keys in client code. No real merchant credentials are included.

## Before deployment

Follow RAZORPAY-SETUP.md. The new incremental migration is `supabase/migrations/202610020001_razorpay.sql`. Set four server environment variables, configure automatic capture and the signed webhook, and test using Razorpay Test Mode before live use.

## Evidence

The test suite includes real PostgreSQL semantics through PGlite for permissions, purchase creation, completion, replay and refunds; simulated provider responses test the server orchestration. React/jsdom tests cover cancellation, invalid callback, successful server verification, and the existing UPI/admin flows. Production HTTP smoke checks use dummy credentials and rejected inputs; they make no payment or database calls. See TEST-RESULTS.txt and DEPENDENCY-AUDIT.json.

Live merchant credentials, actual Razorpay Checkout/browser behavior, real webhook delivery, your deployed Supabase schema and Vercel configuration were not available for validation. Local success does not certify those external integrations. Rate controls, chargeback automation and account-based recovery remain outside this change. See the setup guide for order-timeout reconciliation and refund behavior.

The earlier AUDIT-AND-FIXES.md and FIXES.md document the preceding 18-defect audit, not additional defects discovered in this integration.
