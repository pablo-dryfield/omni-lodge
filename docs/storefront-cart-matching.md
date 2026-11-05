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

## Editing experience selections in unpaid customer carts

Customer-managed carts contain one selection per product ID, resolved experience date and resolved start time. A later selection replaces the entire earlier guest/add-on selection; quantities are not added together. Product defaults are resolved before comparing slots, so omitted fixed times match their explicit values. Different products/dates/times remain distinct, including separate NYE start times.

The KTK storefront prefills an existing selection, changes the primary action to Update booking, retains its stable journey identity, and offers Undo after updates. Old browser/recovery drafts normalize on load. Quotes enforce the same rule server-side. Reopened recovery carts persist normalized selections through the version-checked quote/save path; opening a link only records its open timestamps. Recovery previews/sends reprice legacy duplicate selections with optimistic version/status checks and retain previous selection details in audit history. Completed carts and existing paid orders are not normalized.

Staff-authored prepared carts and backoffice bank-transfer links retain their explicit line items through a server-selected quote option; customers cannot enable this option in a normal quote request. A new purchase after completed checkout uses the existing fresh cart/session flow.

This rule addresses duplicate entries within a cart. Customer identity matching above separately handles duplicate cart records. A name match alone never grants access to another customer's cart.

## Concurrent devices and payment confirmation

Modern customer carts send `cartVersionProtocol: 1` and the last acknowledged `cartVersion` (a canonical selection fingerprint) on quotes and checkout. Row-locked saves reject an outdated selection with HTTP 409. Retrying the exact already-saved selection is idempotent. Superseded device IDs cannot retrieve the successor cart. Once versioned, a cart also rejects unversioned conflicting writes. An existing legacy browser draft without a known revision prompts for review once instead of silently adopting the server's revision.

The customer sees “This cart changed on another device” and explicitly chooses “Review and use these selections.” This preserves the choices displayed in that browser and starts its own opaque cart identity before internal identity merging. It never downloads another device's private cart or payment credentials. Same-browser updates read newer storage first; stale Undo cannot overwrite later selections.

During local payment confirmation, ticket/contact/discount edits and removal are disabled. The server also checks linked Stripe payment status before saving or merging a draft. Submitted/processing/authorized/succeeded payments block edits. A changed unpaid checkout must successfully cancel its old unsubmitted Stripe intent (or expire its old hosted session) before creating a new immutable order/intent; old order items and amounts remain available for audit. If confirmation wins that race, the edit fails and the original snapshot remains intact for fulfillment. An unchanged pending selection reuses its intent. New intent creation uses an order-and-selection idempotency key.

Checkout checks the revision before any Stripe cancellation and rechecks revision, cart/order association and paid status under database locks. Fulfillment and checkout lock the order before the cart. These guards protect the selection that was paid for even when a webhook arrives while checkout waits. Tests use mocked Stripe responses, including cancellation races and already-processing payments; they do not charge real customers.
