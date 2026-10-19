# Counter add-on refund verification

In Counter Summary, open an add-on's **No-show** chip and use **Verify** on the customer's card. The check reads refunds directly from the booking's Stripe payment, using the configured merchant/account. It is available for Ecwid and OmniLodge card bookings. Refunds on other platforms and bank transfers cannot be verified through this Stripe flow.

A successful partial refund must cover at least the selected missing add-ons and remain below the full paid booking amount. Only successful, unapplied refund credit qualifies. Pending/requires-action refunds block another refund; failed/canceled refunds do not count as money returned. Full refunds use the booking cancellation/reconciliation flow. Shared payments with unassigned refunds require a manager to identify the correct booking.

**Rectify the booking** rechecks Stripe and removes the selected add-on quantities without issuing another refund or sending another customer refund email. It updates booking add-on rows, the canonical extras snapshot, refund totals, and applicable refund tasks, and refreshes counter metrics. Party size and attendance stay unchanged: an attending cocktail guest whose cocktail add-on is removed remains an attending normal guest. Each rectification records the actor and allocated Stripe refund references in booking events so refund credit cannot be reused.

The reservation-check refund decision performs the same verification automatically. A new refund is allowed only after a successful clear check, and the server rechecks immediately before issuing it. Amounts come from the historical booking add-on prices and payment currency; the endpoint does not accept people counts or custom amounts. Changed booking quantities, incomplete Stripe history, missing prices, and failed Stripe lookups block the operation. A pending newly submitted refund must succeed in Stripe before rectification is available.

Counter refunds/rectifications are serialized per order, protected by booking row locks, and bound to the add-on quantities shown to the operator. Stripe refund creation uses an idempotency key. If Stripe succeeds but the database update fails, verify and rectify the booking; do not submit another refund. Retrying a stale booking cannot deduct add-ons twice.

The server endpoints require an owner, administrator/admin, manager, or assistant manager and preserve booking product-scope checks. Verification does not issue a refund. No migration or new credential is required.

Stripe references: [refund listing and pagination](https://docs.stripe.com/api/refunds/list), [refund statuses and minor-unit amounts](https://docs.stripe.com/api/refunds/object), and [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
