# Payment architecture and regression review

The payment backend uses composition and dependency injection:

- `PaymentService` coordinates validation, order creation, verification and webhook processing.
- `PaymentRepository` defines the persistence operations the service needs. `SupabasePaymentRepository` implements them.
- `PaymentGateway` defines the provider operations. `RazorpayGateway` owns Razorpay HTTP paths and order payloads.
- Existing exported functions compose these objects per request, preserving all API route callers.

Objects contain dependencies, not mutable per-purchase state. Purchase identity, prices, claim ownership and completion remain database-authoritative. The refactor retains the conditional order write and atomic SQL RPCs; it does not replace database concurrency guarantees with in-process locks. Provider network calls retain their timeout and do not automatically retry uncertain order creation.

Malformed provider JSON (null, arrays and primitives) now produces a controlled 502 instead of propagating an unexpected runtime exception.

The branch also includes the previously prepared article retry and checkout preparation dismissal fixes. Existing layout and payment methods remain intact.

## Validation

`npm run check` runs TypeScript validation, 34 automated tests and the Next.js production build. Tests include real PostgreSQL-compatible execution through PGlite, forged signatures, changed prices, duplicate confirmations, refunds, delayed webhooks, failed order creation, admin isolation, reader access, and checkout behavior. Added tests exercise malformed gateway responses and early validation with injected adapters.

These checks simulate Razorpay and do not charge real payments. This work improves maintainability and isolates dependencies; it is not a throughput benchmark or a guarantee of unlimited scalability. Live deployment smoke checks remain subject to Vercel access. No production database migration is required.
