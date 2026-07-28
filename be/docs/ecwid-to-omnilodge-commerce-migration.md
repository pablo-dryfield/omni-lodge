# Ecwid to OmniLodge commerce migration

This document is the working inventory for replacing Ecwid commerce while keeping
`/store` available during the transition. The custom WordPress storefront remains
at `/store2` until the launch checklist is complete.

## Implemented foundation

| Capability | OmniLodge implementation | Status |
| --- | --- | --- |
| Public catalog | Storefront product list and product-detail APIs | Implemented |
| Product pricing | Scheduled `ProductPrice`, product base price, then channel-price fallback | Implemented |
| Product options | Selected options are accepted, validated, priced, and stored with the order item | Implemented |
| Add-ons | Active product add-ons are validated and priced server-side | Implemented |
| Cart | Persistent browser cart with quantities, removal, and authoritative server quote | Implemented |
| Promotions | Promotion model, date/use limits, fixed/percentage discounts, and server validation | Implemented |
| Checkout customer | Name, email, phone, country, consent, and attribution capture | Implemented |
| Payments | Stripe Checkout session created from the server-calculated order total | Implemented |
| Orders | Immutable order and order-item price snapshots with public order UUID | Implemented |
| Booking fulfillment | Paid order creates OmniLodge guest, bookings, and `BookingAddon` rows | Implemented |
| Payment reliability | Signed Stripe webhook plus idempotent browser-return confirmation | Implemented |
| WordPress bridge | `/store2` proxies catalog, quote, checkout, confirmation, and order APIs | Implemented |
| Attribution | UTM and supported click identifiers are stored on the order | Implemented |

## Data to migrate from Ecwid

Export each dataset before disabling Ecwid writes. Retain the raw exports unchanged
for reconciliation and audit.

| Dataset | Destination or action | Required before launch |
| --- | --- | --- |
| Products, names, descriptions, status, SKU | OmniLodge products | Yes |
| Categories and product ordering | OmniLodge storefront/category configuration | Yes |
| Base, scheduled, and channel prices | `ProductPrice` and `ChannelProductPrice` | Yes |
| Product choices and modifiers | Product options and add-ons | Yes |
| Product images and galleries | Managed media/CDN URLs linked to products | Yes |
| Coupon definitions and limits | `StorefrontPromotion` | Yes |
| Open and future orders | Import or keep Ecwid read-only until fulfilled | Yes |
| Historical orders and customers | Archive/import for support and reporting | Recommended |
| Tax settings and invoice rules | OmniLodge finance/legal configuration | Yes |
| Email templates | OmniLodge transactional templates | Yes |
| Tracking configuration | OmniLodge storefront analytics configuration | Yes |
| Legal copy and consent text | Versioned checkout/legal configuration | Yes |

## Remaining implementation

### Launch blockers

- Add admin screens and APIs for storefront promotions, orders, refunds, and product
  storefront visibility.
- Connect product media to the agreed production object store/CDN and migrate all
  Ecwid product images.
- Implement transactional customer email with order reference, booking summary,
  payment receipt link, and operational contact details.
- Define taxes, invoices/receipts, terms acceptance, privacy consent, and required
  legal record retention with the business/accountant.
- Add capacity checks and short-lived reservation holds where a product has finite
  availability. Revalidate availability immediately before creating payment.
- Configure Stripe production keys and
  `STOREFRONT_STRIPE_WEBHOOK_SECRET`; register
  `/api/storefront/webhooks/stripe` in Stripe.
- Complete production smoke tests for successful, cancelled, expired, duplicate,
  and asynchronous payments.
- Reconcile one full parallel-sales period against Ecwid before routing `/store`
  traffic to the custom storefront.

### Required operations

- Cancellation and refund workflow that updates Stripe, storefront order, booking,
  add-ons, finance records, and capacity atomically.
- Order-support search by public ID, customer email, payment ID, and booking ID.
- Failed-payment and abandoned-checkout visibility.
- Monitoring and alerts for webhook failures, unfulfilled paid orders, quote errors,
  and payment/order amount mismatches.
- Promotion creation/editing, redemption audit, and manual disable controls.
- Product/category merchandising controls for visibility, sort order, labels, and
  featured products.
- A documented Ecwid rollback procedure during the transition.

### Later parity and optimization

- Gift cards/store credit if currently used in Ecwid.
- Multiple currencies and localized price display if required.
- Customer accounts and saved details if required.
- Cross-sells, bundles, and cart recommendations.
- Automated review requests and lifecycle email.
- A/B testing, checkout funnel reporting, and conversion dashboards.
- Search, filters, category landing pages, and structured product metadata.

## Cutover sequence

1. Freeze structural edits in Ecwid and export every dataset above.
2. Import and reconcile products, prices, options, add-ons, promotions, and media.
3. Configure Stripe production webhook and transactional email.
4. Run catalog, cart, checkout, payment, fulfillment, cancellation, and refund tests.
5. Run Ecwid and `/store2` in parallel with daily order/value reconciliation.
6. Resolve all discrepancies and record the final Ecwid order identifier.
7. Route `/store` to the custom storefront while retaining a reversible redirect.
8. Keep Ecwid read-only for historical support until retention requirements are met.

## Acceptance criteria

- No client-provided price can alter an order total.
- Every paid Stripe session maps to exactly one storefront order and the expected
  number of bookings.
- Every selected paid add-on creates the matching `BookingAddon` quantity.
- Promotion limits are transaction-safe and auditable.
- Customer, consent, attribution, and payment references are retrievable by support.
- Refunds and cancellations leave payment, order, booking, add-on, finance, and
  availability states consistent.
- Catalog totals, paid totals, booking totals, and finance totals reconcile for the
  parallel-sales period.
