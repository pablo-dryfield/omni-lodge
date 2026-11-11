# Booking commissions and Stripe processing fees

## Commission policy

An actual positive booking discount makes an unpaid affiliate commission ineligible. The affiliate attribution and booking revenue remain visible; the status explains the applied code when available. A code with zero applied discount is not treated as a financial discount. Explicitly unpaid bookings, repeat Pub Crawl customers and the Warsaw same-day cutoff retain their existing rules. Recorded affiliate payout allocations keep their historical amounts.

The overview endpoint returns `commissionRules` from the pure backend policy module that owns eligibility. The information icon in the Affiliates booking section opens these rules, including the current cutoff and timezone. It does not duplicate business-rule copy in the UI.

## Stripe fee reconciliation

The primary application's existing background-job lifecycle starts a one-minute heartbeat. Deployment candidates do not run background jobs. The worker:

- Scans missing fee/currency records across all historical storefront, direct and Ecwid bookings with paid, partial, deposit or refunded payment statuses. It has no experience-date or creation-date cutoff.
- Excludes explicit cash, manual bank-transfer, PayPal and free methods; it never manufactures a Stripe fee for those methods or for an unpaid booking.
- Reuses the payment viewer's persisted reference/account/mode resolution. Food Tour credentials cannot fall back to another merchant. Stripe API operations are read-only.
- Requires a captured, paid charge and an actual balance transaction with a valid fee. Missing/asynchronous/provider failures remain unresolved for retry; a verified provider fee of zero is distinct from unavailable data.
- Locks a storefront order before its bookings and rechecks the payment identity. Direct peers must match the exact native payment reference, merchant and explicit mode.
- Allocates the exact fee once across booking lines, equally and deterministically by booking ID, including native minor-unit remainders. This matches the existing Ecwid allocation convention.
- Writes only booking `processingFee` and `processingFeeCurrency`, with an audit entry in the same transaction. Reporting values use the booking currency; a differing settlement currency is converted using Stripe's own transaction exchange rate with pinned Decimal arithmetic, not a current or guessed FX rate. The original native fee/currency and applied rate remain in the audit. Original charge fees are not silently reversed by a later refund.
- Preserves synchronized fee fields when a subsequent direct-integration payload omits them.

The fee field has two-decimal storage precision. An unsupported higher-precision currency, absent transaction FX rate or inconsistent booking-line currencies is reported as unresolved rather than rounded or guessed silently. Conversion happens once per payment before deterministic line allocation, preserving the converted total exactly. The existing Ecwid enrichment handler uses the same pure calculation, so later imports cannot restore the previous currency-mixing behavior.

## Controls and evidence

Settings / Control Panel, Payments:

| Key | Default | Effect |
| --- | --- | --- |
| `BOOKING_STRIPE_FEE_SYNC_ENABLED` | `true` | Pause/resume new-payment reconciliation and historical backfill. |
| `BOOKING_STRIPE_FEE_SYNC_BATCH_SIZE` | `100` | Maximum candidates per run, bounded to 1-500 and a 45-second run budget. |
| `BOOKING_STRIPE_FEE_SYNC_INTERVAL_MINUTES` | `1` | Minimum interval between runs, checked live on every heartbeat. |
| `BOOKING_STRIPE_FEE_SYNC_TIMEOUT_MS` | `12000` | Timeout per read-only provider request, with no immediate network retries. |

`booking.stripe_fee_synced` audit entries preserve the previous value, exact native balance transaction/charge/payment identity, account mode, original fee in native minor units, settlement/charge currencies, converted reporting fee, transaction FX rate and allocation booking IDs. They contain no guest contact/card data or Stripe credentials.

`booking.stripe_fee_sync_batch` entries report the ID cursor, scanned/updated counts, unresolved booking IDs/reasons and an independent database count of remaining candidate fee gaps. A zero remaining count is required before claiming the backlog complete. A failed or unavailable lookup must not be hidden behind a zero fee. The cursor advances beyond unresolved records and wraps at the end, so an old invalid reference cannot starve later bookings.

Service calls default to dry-run mode. The authorized scheduled worker explicitly opts into writes. Dry runs perform only provider reads/database reads and create no audit/fee records. Idle no-work heartbeats do not create audit noise.

## Release and rollback

Use the normal same-repository PR, complete CI, immutable Release artifact and managed production deployment. Never build on the production host. The owner authorized deployment and the audited historical fee backfill for this change; it does not authorize customer charges, refunds or staff payouts.

Pause the fee setting first if investigation is needed. Preserve audit evidence and independently verify accounting before any scoped fee rollback; never restore the whole database or rewrite unrelated bookings. Reverting application code does not undo a backfilled reporting value.

The separate cleaning-photo payroll safeguard is unchanged. The owner removed incorrectly dated payout records; a production read-only recheck found no remaining settlement blocker for the reported pending task. Approval itself remains the assigned reviewer's action.

## Provider reference

[Stripe fee expansion and asynchronous availability](https://docs.stripe.com/expand/use-cases): fees may not be available at initial payment confirmation. Retry later rather than blocking checkout or guessing a fee.

[Stripe balance transaction fields](https://docs.stripe.com/api/balance_transactions/object) define the settlement fee and charge-to-settlement exchange-rate direction. [Stripe currency units](https://docs.stripe.com/currencies) document minor units and the ISK/UGX compatibility exceptions used by the shared calculation.
