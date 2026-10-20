> **Manual UPI update (October 2026):** before deploying this version, run `supabase/migrations/202610200001_upi_utr_claims.sql` in the Supabase SQL Editor. Buyers now enter their 12-digit UPI transaction ID (UTR) after paying, and the admin queue lists only those claims with the UTR to match in your bank/UPI app. See [UPI-FIXES.md](UPI-FIXES.md).

> **Article pricing update:** Follow [DEPLOY-ARTICLE-UPDATE.md](DEPLOY-ARTICLE-UPDATE.md) to add five free reads and set one paid article to ₹100 on your existing deployment.

# PayRead — Razorpay + manual UPI

Next.js + Supabase + Vercel. Readers pay once per article. An explicitly authorized administrator verifies receipt before approving access. Razorpay now offers automatic confirmation. Start with **RAZORPAY-SETUP.md** for the new migration, server-only environment variables, and webhook setup.

## Previous manual-UPI setup (reference)

If you already completed the earlier repair, follow RAZORPAY-SETUP.md instead of rerunning the old migration.

## Original repair steps

1. Back up your Supabase database and test on a staging copy first.
2. Run `supabase/migrations/202610010001_payread_repair.sql` in Supabase SQL Editor. Run the entire file: it is transactional and reloads the API schema cache. It preserves existing articles/payments/admin memberships and replaces policies/grants on those three PayRead-owned tables. Reconcile any custom policies before applying.
3. Ensure the admin Auth user is registered (replace the email):

```sql
insert into public.admin_users(user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL'
on conflict (user_id) do nothing;
```

4. Configure environment variables below and redeploy the corrected frontend. New RPCs `get_payment_details` and `review_payment` are required; a frontend-only deploy is insufficient.
5. Check article previews, ordinary-user access denial, a pending purchase, admin approval/rejection, reopening the purchase, and paid content in staging before a real payment.

For a fresh install, run `supabase/schema.sql` (same schema as hardening.sql and the migration), create an Auth admin, then register it above. Add your own article in Supabase Table Editor and set published=true. No sample paid articles are silently published.

## Environment

Copy `.env.example` to `.env.local` for local development. Set the same values in the appropriate Vercel environment:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
NEXT_PUBLIC_UPI_ID=your-upi-id@bank
NEXT_PUBLIC_MERCHANT_NAME=PayRead
```

`NEXT_PUBLIC_UPI_ID` must be a plain UPI ID such as `name@okbank` (no spaces or `upi://` prefix); an invalid value disables UPI checkout with a clear message. The legacy NEXT_PUBLIC_SUPABASE_ANON_KEY is also supported. Never put a service-role or secret key in a NEXT_PUBLIC variable. The URL is the project origin, without /rest/v1. Redeploy after changing public environment variables.

## Run and verify

Use Node.js 22 or newer (Node 24 used in validation).

```bash
npm ci
npm run dev
```

```bash
npm run typecheck
npm test
npm run build
npm audit --omit=dev
```

`npm run check` runs typecheck, tests and build. After building, `npm run test:http` checks the payment HTTP rejection paths using dummy credentials. Tests are local; SQL tests use PGlite with a minimal Supabase Auth fixture, UI tests use jsdom and mocked RPC responses. No tests contact your production database or send payments.

## Purchase recovery

Enable browser site storage before paying. Pending purchase identity is saved before the QR is shown. Closing/reopening the dialog or reloading reuses the same payment; do not pay twice. After approval, the same browser can reopen the article. After paying, the buyer enters the UPI transaction ID; it can be corrected until the payment is reviewed. A rejected payment shows its reference and transaction ID; a buyer who did pay should contact the administrator, and one who did not can start a new payment. An approval that happens while the dialog is closed is picked up when the buyer opens the article on the same browser. Clearing browser storage removes the bearer token; there is no account-based or cross-device recovery.

See AUDIT-AND-FIXES.md for the 18 confirmed defect groups, validation coverage and remaining deployment limits.
