# PayRead Basic

A Next.js + Supabase + UPI pay-per-article starter intended for Vercel deployment.

## Payment model

UPI QR/deep-link payments remain `pending` until an explicit PayRead admin independently confirms receipt. The browser does not pretend to verify UPI payments.

## Supabase setup

1. Create/open the Supabase project.
2. Run `supabase/hardening.sql` in **SQL Editor**. It is also the full schema for a fresh project.
3. In **Authentication -> Users**, create the admin email/password if it does not already exist.
4. Register that exact Auth user as a PayRead admin by running this in SQL Editor:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'YOUR_ADMIN_EMAIL'
on conflict (user_id) do nothing;
```

Authentication and admin authorization are intentionally separate. Merely having a Supabase Auth account does not grant payment approval access.

## Vercel environment variables

Set these in **Vercel -> Project -> Settings -> Environment Variables** for the environments you deploy (Production/Preview as appropriate):

```text
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_UPI_ID=your-upi-id@bank
NEXT_PUBLIC_MERCHANT_NAME=PayRead
```

The app also supports the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`, but the publishable key is preferred.

`NEXT_PUBLIC_SUPABASE_URL` must be the base project URL. Do **not** use `/rest/v1`, a database connection string, or the dashboard URL.

After changing any `NEXT_PUBLIC_*` value in Vercel, **redeploy** so Next.js rebuilds the browser bundle with the new value.

## Why admin could show "Failed to fetch"

The previous client silently substituted `https://placeholder.supabase.co` when Vercel env vars were missing. Login then attempted to contact that fake host and surfaced a generic network error. This version no longer makes network requests when the configuration is invalid; the admin page reports the missing/invalid setting explicitly.

If login still reports that Supabase cannot be reached, verify:

- the Supabase project is active/not paused;
- `NEXT_PUBLIC_SUPABASE_URL` is correct;
- the publishable/anon key belongs to that same project;
- the Vercel deployment was rebuilt after env changes;
- the browser network request to `/auth/v1/token?grant_type=password` is reaching the expected Supabase project.

## Security hardening included

- Public users cannot query the raw `payments` table or steal access tokens.
- Public users cannot query paid article content directly.
- Payment amount is derived inside Supabase from the article price instead of trusting the browser.
- Payment status is checked through a token-scoped RPC.
- Paid article content is returned only for a completed payment with the matching access token.
- Payment approval requires membership in `public.admin_users`; an arbitrary authenticated user is not an admin.
- The browser never receives a Supabase service-role key.

## Local run

Copy `.env.example` to `.env.local`, fill in real values, then:

```bash
npm install
npm run dev
```

For automatic payment confirmation later, replace manual UPI confirmation with a payment gateway and server-side webhook.
