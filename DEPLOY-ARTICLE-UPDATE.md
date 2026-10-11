# Deploy the ₹100 + free articles update

1. Deploy this updated project to Vercel with your existing environment variables.
2. In Supabase → SQL Editor, run the entire file `supabase/migrations/202610110001_free_articles.sql`.
3. Refresh the homepage. The five new articles should say Free and open without checkout. One existing article should show ₹100.00.

The migration keeps the earliest published existing article (created_at, then ID) as the ₹100 article and makes other published articles free. It adds five original free reads. Existing article content, drafts, and payment records are preserved. If there are no published existing articles, it creates one premium article as well. Re-running this migration does not duplicate the new articles.

Prices are stored in paise: ₹100 = 10000. New paid purchases use the database price. Previously created purchases retain their recorded amount and valid existing access; a price update does not rewrite payment history.

Run only the new migration for this already-deployed site; do not rerun older setup/hardening migrations. For a fresh database, run schema.sql and then this new migration.

## Mini regression

- 32 tests passed (31 database/payment/admin/storage tests plus one free-reading UI test).
- npm run typecheck passed.
- npm run build passed.
- Database checks execute with embedded PostgreSQL (PGlite); browser component checks use jsdom; Razorpay requests are simulated.
- Verified anonymous free access, paid/draft protection, ₹100 Razorpay reservation, existing paid access, and idempotent article seeding.
- No live Supabase migration, Vercel deployment, or real payment was performed here.

Changed production files: app/page.tsx, app/article/[id]/page.tsx, supabase/schema.sql, and the new SQL migration. Checkout, webhook, payment APIs, admin code, and dependencies are unchanged.
