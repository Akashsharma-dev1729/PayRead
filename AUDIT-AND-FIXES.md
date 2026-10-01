# PayRead audit — 1 October 2026

18 confirmed defect groups were identified and fixed. This is the count established by this source audit, not a claim that all possible defects or deployment conditions have been exhausted.

| # | Confirmed defect in uploaded source | Correction |
|---|---|---|
| 1 | Strict Mode or network retry creates a duplicate payment with a unique-key error. | Database creation is idempotent for the same article/reference/token; concurrent retries serialize. |
| 2 | Pending token/reference exists only in modal state, so close/reload loses purchase recovery. | Persist identity before creation; reopen and retry the same purchase. |
| 3 | QR amount comes from stale frontend article data, while the database records the current price. | Token-scoped payment-details RPC provides the recorded amount for both display and QR. |
| 4 | Blocked storage makes successful payment polling loop; malformed storage and throwing cleanup can break reading. | Validate stored records, tolerate reads failing, require successful persistence before showing payment, retain pending identity for recovery. |
| 5 | Homepage starts a new purchase for an already purchased article. | Existing saved access opens the article for database verification. |
| 6 | Article route changes retain previous allowed/content/error state. | Reset per ID and suppress mismatched article state during navigation. |
| 7 | Content-verification errors silently look like an unpaid article. | Show verification failure and advise retry before paying again. |
| 8 | Admin payment queue remains empty until manually refreshed. | Load automatically after successful authorization; show loading/empty state. |
| 9 | Late role/session/list responses can restore stale admin UI after auth changes. | Invalidate role/list work when auth changes and ignore superseded results. |
| 10 | Approval treats a zero-row update as success and uses the browser clock. | Atomic admin-only review RPC returns a result and timestamps on the database server. |
| 11 | No UI path to mark a rejected payment failed; overlapping review actions remain enabled. | Add Reject and disable review buttons while processing. Database permits only pending-to-terminal transitions. |
| 12 | Hardening removes only a fixed list of policy names; other permissive legacy policies survive. | Replace policies on the three PayRead-owned tables within a transaction. |
| 13 | Revoking table grants does not remove legacy column grants or PUBLIC grants. | Revoke both before restoring intended access; test legacy column exposure. |
| 14 | Payment-reference validation accepts null through SQL three-valued logic and allows unbounded strings. | Require non-null token and bounded reference format before insertion. Existing records remain readable. |
| 15 | Running hardening on an existing site publishes an unsolicited demo paid article. | Remove automatic sample publication from installation/migration scripts. Existing articles are preserved. |
| 16 | Supabase URL validator accepts /rest/v1 despite claiming to reject it. | Require an HTTPS project origin without path/query/credentials/port. |
| 17 | Dependency installs are not reproducible, allow old vulnerable versions, and the lint command has no configured linter. | Pin runtime versions, include lockfile, patch PostCSS, provide working typecheck/test/check commands. |
| 18 | Payment modal has no dialog semantics, focus containment/restoration, or Escape handling. | Accessible dialog label, keyboard handling, focus trap/restoration, live status. |

## Validation

See TEST-RESULTS.txt and DEPENDENCY-AUDIT.json for the executed final results.

- Tests execute SQL in PGlite (PostgreSQL compiled to WASM), including actual role grants and RLS. They do not mock SQL results.
- Test bootstrap supplies Supabase's auth schema and auth.uid(). The pgcrypto extension declaration is omitted in PGlite; built-in UUID generation remains available. Hosted Supabase extension/PostgREST behavior is not tested here.
- React component tests use jsdom and mocked Supabase responses to exercise payment Strict Mode/reopen, server amount use, completed purchase storage, admin auto-load, conflicting review, and auth race handling.
- TypeScript and optimized Next.js production build are run locally. Dependencies resolve to Next 15.5.27 with patched PostCSS 8.5.28. Next security release reference: https://nextjs.org/blog/september-2026-security-release
- No live UPI transfer, Supabase migration, Vercel deployment, or real bank confirmation was performed.

## Required rollout

Read README.md before deployment. Run the included SQL migration against your Supabase project before deploying this frontend. It intentionally replaces policies/grants on PayRead's articles, payments and admin_users tables; if you have added custom access rules, reconcile those first. Back up the database and test on a staging copy.

## Remaining operational limits

Payments remain manually verified UPI payments, not Razorpay. Admins must verify receipt independently. Bearer access is stored on this browser: clearing storage, losing the device, or sharing tokens affects access. There is no cross-device account recovery. Public payment creation still needs deployment-specific abuse/rate controls for a public launch. The migration supports the uploaded UUID-token schema and adds missing excerpt/published/timestamp fields for older starters; arbitrary custom schemas (such as text access_token columns) need reconciliation before migration. No credentials were supplied, so live schema compatibility cannot be certified.
