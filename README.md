# PayRead Basic

A clean, deployable pay-per-article starter using Next.js + Supabase + UPI.

## Important payment model

This version intentionally uses **UPI QR/deep-link + admin confirmation**. It does **not** pretend that the browser can verify a UPI payment. A payment starts as `pending`; an authenticated admin marks it `completed` only after independently confirming receipt.

For automatic confirmation later, replace this with a real payment gateway + server-side webhook.

## Deploy

1. Create a Supabase project.
2. Open Supabase SQL Editor and run `supabase/schema.sql`.
3. Create an Auth user for the admin in Supabase Authentication.
4. Copy `.env.example` to `.env.local` and fill in the values.
5. Install and test: `npm install` then `npm run dev`.
6. Push the folder to GitHub.
7. Import the repo into Vercel (or another Next.js host).
8. Add the same environment variables in the host dashboard and deploy.

## Security notes

- The client never has a service-role key.
- The article price is read from the database for the normal UI; for a high-value production system, create payments through a server/RPC that derives the price from the article row so a modified browser cannot choose a different amount.
- The current public payment-status policy is deliberately simple for this starter. Before handling meaningful revenue, tighten status reads to a secure RPC or authenticated flow and use a gateway webhook.
- Never put payment gateway secret keys in `NEXT_PUBLIC_*` variables.

## UPI warning

A UPI deep link is not the same thing as a Paytm Payment Gateway integration. Risk warnings shown by Paytm/another UPI app are outside the browser's control. This starter therefore does not display misleading claims such as "payment verified by Paytm".
