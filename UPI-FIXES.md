# Manual UPI payment fixes — October 2026

Scope: the manual UPI flow only (QR / UPI link → admin approval). Razorpay is unchanged.

| # | Defect | Fix |
|---|--------|-----|
| 1 | The admin had nothing to match a received transfer against. The PayRead reference was sent only in the UPI `tr` field, which is not shown to the payee for a personal UPI ID; the note shown (`tn`) held only the article title. Approval was effectively a guess. | Buyer enters the 12-digit UPI transaction ID (UTR) after paying. The UTR is what appears in the payee's bank/UPI history. The admin queue shows UTR, amount and submission time. The reference now goes in the visible note. |
| 2 | Every opened payment dialog created a "pending" row in the admin queue, whether or not the buyer paid. Real payments were mixed with abandoned dialogs and spam. | The queue lists only purchases whose buyer submitted a UTR. The database refuses to approve a manual UPI payment that has no UTR. |
| 3 | One genuine transfer could unlock any number of purchases: nothing tied a payment to a single purchase. | A UTR can be attached to only one live purchase (unique index). Rejecting a claim releases its UTR so a mistyped or squatted ID cannot block the genuine payer. |
| 4 | A rejected payment was a permanent dead end on that browser: reopening always showed the same rejected purchase and "Retry" re-fetched it. | Rejected purchases show the reference and UTR with guidance, plus "Start a new payment", which issues a fresh identity. |
| 5 | Spaces in the merchant name or note were encoded as `+` (form encoding). UPI apps decode links as URIs, so payers saw "Pay+Read". | Values are percent-encoded (`%20`). |
| 6 | The merchant-only `tr` parameter was sent for a personal UPI ID; some UPI apps decline such person-to-person intents. | `tr` is no longer sent. |
| 7 | A malformed `NEXT_PUBLIC_UPI_ID` (spaces, `upi://` prefix, typo) produced payment links that fail inside the payer's app. | The UPI ID is validated; checkout shows a configuration error instead. |
| 8 | If the admin approved while the buyer's dialog was closed, opening the article directly still said "locked" until the buyer reopened the payment dialog. | The article page also checks the in-progress purchase token and saves access when it has been approved. |

## Deploy order

1. Back up the database, then run `supabase/migrations/202610200001_upi_utr_claims.sql` in the Supabase SQL Editor (re-runnable; existing payments untouched). It adds `payer_utr` / `claimed_at`, the `submit_payment_utr` RPC, and updates `get_payment_details` and `review_payment`.
2. Promote the frontend promptly. Between the two steps, buyers on the old frontend can still pay and read, but the old admin page cannot approve manual UPI payments (none has a UTR yet). The new frontend fails without the migration, so the migration comes first.
3. Payments already pending before the upgrade have no UTR, so they do not appear in the queue. If you know such a payment was received, ask the buyer to reopen the article: the dialog now asks for the UTR, after which it appears for review.

## Admin checking procedure

Open your bank or UPI app, find the received payment with the same UTR (often labelled "UPI Ref No." or "UTR") and the same amount, then Approve. Reject anything you cannot find.
