# PayRead fixes in this build

- Removed the silent fake Supabase fallback that turned missing Vercel env vars into `Failed to fetch`.
- Added explicit Supabase URL/key validation and clearer admin login network/configuration errors.
- Added support for the current Supabase publishable key while retaining legacy anon-key compatibility.
- Separated authentication from admin authorization with `public.admin_users` + `is_admin()`.
- Removed the policy that allowed every authenticated account to approve payments.
- Removed public raw reads of `payments`, including access tokens and transaction data.
- Moved public payment creation to a database RPC that derives price from the article row.
- Moved payment-status polling to a token-scoped RPC.
- Closed the paywall bypass where public clients could select the full `articles.content` field.
- Added preview/content RPCs so paid content is returned only for a completed matching payment token.
- Added `supabase/hardening.sql` for upgrading the existing Supabase project.
- Updated Vercel/Supabase setup instructions in README.

## Required deployment actions

1. Run `supabase/hardening.sql` in the existing Supabase project's SQL Editor.
2. Register the intended Auth user in `public.admin_users` using the SQL snippet in README.
3. Set the Vercel Supabase URL and publishable/anon key correctly.
4. Redeploy Vercel after changing `NEXT_PUBLIC_*` variables.
- Fixed the Vercel/Next.js TypeScript build failure caused by Supabase inferring `articles(title)` as an array relation while the UI typed it as a single object. The admin payment loader now fetches payments and article titles separately and combines them explicitly, removing the fragile nested-relation cast.
