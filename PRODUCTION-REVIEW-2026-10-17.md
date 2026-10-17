# Production review — 17 October 2026

Reviewed from commit `751b89ca8ddb54f974773a35e44831e64c5236e2`.

## Live Supabase follow-up

On 17 October, the connected PayRead database was missing `payments.provider`, `razorpay_orders`, and all three gateway RPCs, despite the deployed frontend using them. This breaks order creation and the admin list's provider filter.

Applied the repository's existing `202610020001_razorpay.sql` after verifying its upgrade path from the manual schema plus free catalog in PGlite. Supabase recorded it as migration `20261017085514` (`razorpay`). No catalog migration was rerun.

Live verification after the migration:

- All 21 prior payment rows remain, classified as manual UPI; no gateway orders were created.
- Five free articles, one ₹100 article, and one admin membership remain.
- An anonymous role sees six previews and free content, but no paid content with a null token.
- Anonymous users have no direct SELECT privilege on article/payment columns or the gateway orders table.
- Ordinary authenticated role without admin identity sees no article/payment rows and cannot directly update payments.
- Gateway creation/completion/revocation RPCs deny anon and authenticated execution and permit service_role.
- Security advisors rerun. Locked-down internal tables intentionally have no client RLS policy; reader RPCs intentionally use scoped SECURITY DEFINER access. Leaked-password protection is disabled and remains an Auth configuration follow-up: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Vercel installation is confirmed, but its tools were not exposed during this follow-up. Deployed environment values and an actual Razorpay test-mode flow remain unverified.

## Confirmed fixes

- Enforce the saved payment provider before displaying a payable request. Previously `paymentSession` returned a Razorpay identity to the manual UPI flow (or vice versa), including when another tab changed the saved provider.
- Validate saved purchase records before choosing a payment screen. Preserve legacy manual purchases; refuse unknown methods with a valid bearer token instead of replacing that purchase.
- Lock the parent dialog during checkout preparation, close the gateway overlay on confirmation/revocation, and prevent late order responses from reopening an already completed checkout.
- Disable checkout for a revoked purchase or missing Supabase configuration.
- Recover completed purchases on the article page using the pending bearer token when the callback never saved an access entry. Content still requires authorization by the existing database RPC.
- Let locked article readers check their purchase without bouncing between the home and article pages. Add retry controls and avoid describing an unavailable free article as a paid lock.
- Bound browser Supabase fetches to 15 seconds while preserving caller cancellation. This bounds the fetch operation; SDK retries may take additional time.
- Ignore generated TypeScript build metadata.

The frontend code patch does not change pricing, article data, or payment-verification rules. The live database repair is documented above and uses the existing repository migration.

## Validation

`npm run check` runs TypeScript checking, 35 tests, and the optimized Next.js build. Tests include PostgreSQL permissions and payment lifecycle via PGlite, simulated Razorpay signatures/capture/refund callbacks, browser UI behavior via jsdom, purchase recovery, provider isolation, checkout completion during an in-flight order request, and fetch cancellation.

`npm run test:http` runs six HTTP rejection checks against the production build with dummy credentials. `npm audit --json` reported zero known dependency vulnerabilities on this review date. These checks do not establish live payment or production database correctness.

## Release blockers requiring connected services

1. Identify the production Vercel project/domain. GitHub reports successful deployments for both `pay-read` and `pay-read.1`; neither is assumed to be the production target.
2. Core live Supabase schema/permissions review completed and missing gateway migration applied (see above). Actual admin sign-in and end-to-end gateway flow still require verification. Do not rerun catalog migrations blindly: the free-article migration changes published article prices.
3. Verify Vercel environment configuration without exposing secrets: public Supabase URL/key, server-only service-role key, matching Razorpay key pair, webhook secret, and manual UPI recipient. Confirm the deployed domain in Razorpay.
4. Exercise a Razorpay test-mode payment on a staging deployment: successful capture, cancelled checkout, reload/closed tab, duplicate webhook, refund, and recovery. Verify webhook delivery logs and automatic capture configuration. No real payments were made during this review.
5. Verify ordinary users cannot enumerate payment tokens/read paid bodies or approve payments on the actual database. Verify the designated admin can review manual UPI receipts.

## Operational limitations still requiring decisions

- Purchase identity is browser-local. Clearing site storage or changing devices loses access; there is no authenticated cross-device purchase recovery.
- An ambiguous Razorpay order-creation timeout deliberately leaves a reservation requiring merchant reconciliation. Do not delete it or generate another payable order without checking Razorpay for the existing receipt/order.
- Anonymous purchase creation has no application-level abuse quota. Vercel-only rate limits would not cover direct calls to the manual Supabase purchase RPC. A production abuse-control strategy must cover both entry points.
- Merchant contact, refund/privacy/terms pages and gateway approval requirements need the owner's business details; none were invented in this patch.

This is a tested code repair, not a certification of zero defects or completion of the live production review.
