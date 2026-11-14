# Partner integration guide

The company Channel remains the accounting parent. A manager enables its partner profile, selects products and payment arrangements, and adds company members. A company owner issues a scoped API token in Partners / Integrations. Keep it on your server; never embed it in a website or mobile client.

## Booking methods

- Share the company's customer booking URL or QR code.
- Embed the dedicated booking page using the code in Integrations. Add each exact HTTPS website origin to the agreement first. Stripe payment opens outside the iframe.
- Use the portal for phone, email or in-person reservations, or send its generated payment link to the customer.
- Use the authenticated API to quote, create, amend, cancel and track bookings.
- Create a group request; management approval creates the actual reservation.
- Offer configured referral vouchers or packages of approved OmniLodge experiences.
- Import CSV or JSON, validate it first, then submit. Stable references make retries safe.

External tour inventory needs its own supplier connector. This API is not a vendor-specific adapter or an OCTO certification.

## Authentication and identity

Base path: `/api/partners/{companyId}`. Send `Authorization: Bearer YOUR_TOKEN` and `Content-Type: application/json`. Tokens are scoped (`read`, `book`, `amend`, `cancel`, `refund`), expire and can be revoked. A token belongs to exactly one company. It cannot administer memberships, agreements or settlements. Company suspension blocks access immediately.

Use a unique reference for each booking and operation. Retry the same reference with the same payload after a timeout. A changed payload with that reference returns HTTP 409. Do not generate a fresh reference just because a response was lost. The `approved:` prefix is reserved for management-created group confirmations.

## Quote and create

`POST /quote` validates the selection and returns live server prices. `POST /bookings` uses the same body:

```json
{
  "reference": "your-order-123",
  "paymentMode": "platform",
  "customer": {
    "firstName": "Alex",
    "lastName": "Morgan",
    "email": "customer@example.com",
    "phone": "+441234567890"
  },
  "items": [{
    "productId": 28,
    "quantity": 2,
    "experienceDate": "2027-01-15",
    "experienceTime": "21:00",
    "options": {"participants": {"men": 1, "women": 1}},
    "addons": [{"addonId": 1, "quantity": 1}]
  }]
}
```

Use catalog IDs and configured times, not the example IDs. Products requiring gender counts use `options.participants`. Sized add-ons use `variants: [{"value":"M","quantity":1}]`; other selection add-ons use `value`. Product rules remain authoritative.

## Commission agreements

Company-wide management configures a default commission and optional rules for individual approved products under Partners / Agreement. A rule uses `type: "fixed" | "percentage"`, `basis: "person" | "experience" | "booking"` and a non-negative `value` with up to two decimals. Fixed rates are PLN; percentages are 0-100. For example, these agreement fields set PLN 10 per guest place by default and PLN 25 per experience for product 44:

```json
{
  "commissionRule": {"type": "fixed", "basis": "person", "value": 10},
  "productCommissions": [
    {"productId": 44, "rule": {"type": "fixed", "basis": "experience", "value": 25}}
  ]
}
```

These are fields within the complete agreement, not a replacement for its approved products, permissions and payment arrangements. Product IDs must be approved and each can have only one override. Products without an override share the default rule.

| Basis | Units for a fixed commission | Percentage calculation |
| --- | --- | --- |
| `person` | Guest places across the applicable experiences. Four guests on two experiences means eight places. | Percentage of the applicable discounted guest/experience prices, including extras. |
| `experience` | Distinct product/date/start-time departures. Repeated lines for the same departure count once; 17:00 and 19:30 count separately. | Percentage of the applicable discounted experience prices, including extras. |
| `booking` | Once for all products using the default rule; each product override applies once across its own departures. | Percentage of the applicable discounted booking portion. |

A uniform percentage produces the same total for all three bases; the booking total is never multiplied again by guests or experiences. Discounts are allocated in integer cents to the product groups. A new quote is rejected if the promised commission exceeds its customer total.

Authenticated quotes expose `partnerCommission` with the currency, total, aggregate commission and per-rule groups (`productId`, `rule`, `units`, `base`, `commission`). Public customer quotes exclude this private breakdown. Bookings save their agreement and calculation; later agreement edits do not rewrite existing bookings or their amendment rates. Legacy agreements without these fields continue using `commissionPercent` as a percentage per booking.

An amount-only refund reduces percentage commissions proportionally to retained customer payment. Fixed commissions stay payable until the booked guests/experiences change or the booking is cancelled. A fixed fee can therefore exceed the remaining customer money, including after a full monetary refund. Amend the selection to remove guest places or experiences; cancel to remove the whole commission. A fully refunded booking can still be cancelled within the existing permissions/deadline.

Statements distinguish earned commission, verified transferred money, outstanding amounts and overpayments. For partner-collected payments, a refund can create a credit owed to the partner. Management records an already completed outgoing credit payment using `POST /bookings/{id}/settlement-return` with `amount`, a unique `reference`, and `reason`; this records evidence and does not send money. The original incoming settlements and outgoing credit payments remain separately auditable. Reusing a receipt cannot pay it twice; later cancellation can make a previously paid credit recoverable.

## Payment arrangements

Payment arrangements, where enabled:

| Value | Customer payment | Confirmation |
| --- | --- | --- |
| `platform` | Customer follows the returned Stripe `checkoutUrl` | After verified payment |
| `partner` | Your company already collected payment; provide `paymentReference` | Confirmed, with net debt owed to OmniLodge |
| `arrival` | Customer pays at the experience | Confirmed reservation, still unpaid |

Set `requestApproval: true` for a group request. It does not hold inventory or create a manifest booking until management approves. Packages/referral vouchers use `offeringCode`. Different start times remain separate experience lines.

`GET /bookings?limit=25&offset=0&status=confirmed&search=your-order` returns paginated results. `GET /bookings/{id}` returns the company booking, operational manifest references and amendment history. A browser returning from payment is not evidence of success.

## Amendments

`POST /bookings/{id}/amend/quote` accepts `items` and optional `discountCode`, and returns the revised total and price difference. `POST /bookings/{id}/amend` accepts the complete replacement experience list:

```json
{
  "reference": "change-123-1",
  "reason": "Customer added another guest",
  "notifyCustomer": true,
  "items": [{
    "productId": 28,
    "quantity": 3,
    "experienceDate": "2027-01-15",
    "experienceTime": "21:00",
    "options": {"participants": {"men": 2, "women": 1}},
    "addons": []
  }]
}
```

The replacement list replaces quantities and extras completely. Product scope, availability, change deadlines and checked-in restrictions still apply.

- Same price: apply immediately.
- Higher Stripe price: return `pending_payment` and a secure `checkoutUrl` for the difference. Keep the existing booking until verified payment and successful fulfillment.
- Lower Stripe price: apply the change and submit the refund difference to the original payments, up to the remaining paid balance.
- If a paid upgrade cannot be fulfilled: return its extra payment and keep the original reservation. The amendment history shows the failure.
- Unpaid arrival booking: update its amount due.
- Externally collected payments: the collector handles the actual payment/refund; operations supplies a verified `paymentReference` to apply the financial adjustment. The platform cannot refund money it did not collect.

`POST /bookings/{id}/amendments/{amendmentId}/cancel` expires an unpaid amendment payment link. It does not cancel the original reservation. A paid amendment must complete or be reconciled. Do not send another amendment while one is pending.

## Cancellations and partial refunds

`POST /bookings/{id}/cancel` accepts `reason` and optional `notifyCustomer` (default true). It cancels all experiences in the order. Platform-collected remaining payments are refunded; external collectors remain responsible for their refunds.

`POST /bookings/{id}/refund` has a separate agreement permission and API scope:

```json
{
  "reference": "refund-123-1",
  "amount": 30.00,
  "reason": "Agreed customer adjustment",
  "notifyCustomer": true
}
```

Amounts are PLN with at most two decimals. The server verifies original payments and remaining balances directly with Stripe. A refund may span original and amendment charges. Provider history and stable keys protect retries. `pending` means submitted, not that the bank already returned the money. Monetary refunds leave guest counts and add-ons unchanged; amend the selection when those must change. Commission and transferred allocations are adjusted separately and provider failures remain visible for reconciliation.

## Bulk import

`POST /import` accepts `{"rows":[BOOKING_BODY]}` or `{"csv":"..."}`. It validates by default. Add `"commit":true` to submit. Inspect every result; one failed booking does not undo successful rows.

CSV columns: `reference,firstName,lastName,email,phone,productId,quantity,experienceDate,experienceTime,men,women,paymentMode,paymentReference,discountCode`. Rows with the same reference become one multi-experience order and must use consistent customer/payment details. Use JSON for sized add-ons and more complex selections.

## Signed updates

Configure one HTTPS webhook endpoint per company. The signing secret is shown once; rotation replaces it. Payloads contain stable event IDs, event type, booking ID and event data. Verify `X-OmniLodge-Signature: t=timestamp,v1=hex` with `HMAC-SHA256(secret, timestamp + "." + exact_request_body)`. Reject old timestamps and deduplicate `X-OmniLodge-Event`. Acknowledge quickly with HTTP 2xx. Duplicate delivery is normal; failures retry and can be replayed from Integrations.

Use an isolated non-production installation and Stripe test merchant for integration testing. Adding a parameter to a production request never switches it to test mode. Connect onboarding and payout activation require actual platform setup and completed company verification.
