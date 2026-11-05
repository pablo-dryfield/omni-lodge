# Storefront cart matching

## Customer identity and current selections

Match normalized email first. Only when no email matches, match the normalized international phone number (including country). An exact name match without either contact match is a review hint, never an automatic merge, even when there is only one name candidate.

A known browser/public cart ID continues updating its cart. Another browser keeps all of its submitted selections and receives its own opaque cart ID and payment context. Matching older unpaid cart records are dismissed internally and linked into the new cart's staff-only activity history. They are not deleted, and no old customer's details or payment credentials are returned from an email/phone lookup. There is no verification-email flow. Superseded recovery links cannot open the successor's private cart.

One active cart is retained for the matched identity. Email candidates take priority over separate phone-only candidates. Exact-name-only rows stay separate and show a contact-review badge in the ongoing-cart list. Existing payment orders and audit records are retained; this does not cancel an already created Stripe payment intent.

## Preventing recovery reminders after payment

Before an automatic or manual recovery email, check for a confirmed, paid booking for the same customer and the same product, experience date, and start time. Guest quantity, add-ons, discount code and name spelling do not have to match. For a cart with several experiences, every distinct product/date/time must be covered; an unrelated or partially covered trip stays active.

Use current bookings rather than historical converted-cart snapshots, so cancellations, refunds and amendments do not incorrectly qualify. OmniLodge orders must also be confirmed/paid, with a payment date at or after the abandoned cart was created. Other platforms use booking creation time because a separate payment timestamp is not available. A new cart created after an existing sale is left alone, allowing a genuine repeat purchase.

Payment fulfillment removes matching older carts immediately, even across browsers. If the customer changed to a different trip while an older payment completed, preserve that current trip and detach the older order. Before sending a reminder, reload the claimed cart and check again that it has not converted or been dismissed. Email delivery and an external payment are not one atomic operation; a payment arriving after the final check can still race an email already being sent.

An already-booked cart is dismissed with its matching booking/order in the audit history. It is not counted as a recovered sale. Existing recovery attribution continues to require a tracked recovery-link open before payment.

## Existing records and operational controls

The existing five-minute abandoned-cart job also reconciles older carts in bounded batches, including carts already emailed, even when automatic recovery emails are disabled. It retains the latest cart's selections and audits merges. No production records are changed merely by editing these local source files.

Settings / Control Panel:

- **Ongoing cart reconciliation batch size** (`STOREFRONT_CART_RECONCILIATION_BATCH_SIZE`): default 100, range 1–500. Refreshed on each job pass.
- **Paid cart retry protection window** (`STOREFRONT_ONGOING_CART_DEDUPE_WINDOW_MINUTES`): guards stale identical submissions from the same already-paid browser session. It no longer limits cross-browser unpaid-cart matching.

## Validation status

Regression tests cover identity priority, name ambiguity, current-selection isolation, date/time/product matching, changed guest counts, repeat purchases, payment cleanup and the pre-send guard. Run these suites with the repository's required backend/UI checks before release. The PR records the commands and results for its exact revision.
