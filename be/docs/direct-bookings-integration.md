# Direct bookings integration

This endpoint allows `foodtourkrakow.com` to send confirmed Stripe bookings into Omni-Lodge.

## Endpoint

- `POST /api/integrations/direct-bookings`

## Authentication

The endpoint accepts either:

- standard Omni-Lodge bearer auth through `POST /api/users/login`
- `x-api-key` matching `DIRECT_BOOKINGS_API_KEY`

## Idempotency

Bookings are matched by:

- `platform`
- `platformBookingId`

If the same request arrives again:

- no duplicate booking is created
- the booking is updated if fields changed
- a `booking_events` record is still created for audit
- the customer confirmation email is not sent again

## Expected payload

Required fields:

- `platformBookingId`
- `experienceDate`
- `productName`
- `guestEmail`
- `partySizeTotal`

`productId` is optional. When it is not provided, Omni-Lodge tries to resolve it from `productName` using exact product names, canonical product naming, product aliases, and a safe name fallback. If no product exists, the booking is still created with `productId: null`.

Common fields supported:

- `platform`
- `platformOrderId`
- `status`
- `paymentStatus`
- `paymentMethod`
- `paymentMethodCountry`
- `stripeLivemode`
- `currency`
- `baseAmount`
- `priceGross`
- `priceNet`
- `experienceStartAt`
- `guestFirstName`
- `guestLastName`
- `guestPhone`
- `partySizeAdults`
- `partySizeChildren`
- `addonsSnapshot`
- `notes`
- `utmSource`
- `utmMedium`
- `utmCampaign`
- `sourceReceivedAt`
- `processedAt`

## Customer confirmation email

When a direct booking is newly created, Omni-Lodge automatically sends the customer a booking confirmation email through the same Gmail sending infrastructure used by the booking manifest email tools.

The email includes:

- Omni-Lodge booking ID as the customer-facing order number
- tour name
- experience date and start time
- guest count
- paid amount and payment method
- customer contact details
- dietary notes or requests, when provided
- meeting point instructions

Email delivery failure is logged, but it does not roll back the booking ingestion request.

When a direct booking is newly created, Omni-Lodge also sends an internal notification email to `DIRECT_BOOKINGS_NOTIFICATION_EMAIL`. The default recipient is `foodtourkrk@gmail.com`. The subject format is `New Booking for Thu, Sep 10, 2026 (1234)`, where the date is the experience date and the number is the Omni-Lodge booking reference.

Manifest direct booking actions also send internal notification emails to `DIRECT_BOOKINGS_NOTIFICATION_EMAIL`. The action subjects use the same date/reference format, for example `Booking Cancelled for Thu, Sep 10, 2026 (1234)`, `Booking Amended for Thu, Sep 10, 2026 (1234)`, and `Partial Refund for Thu, Sep 10, 2026 (1234)`.

Direct booking customer emails can use a separate Gmail send-as alias:

- `DIRECT_BOOKINGS_EMAIL_FROM_ADDRESS`
- `DIRECT_BOOKINGS_EMAIL_FROM_NAME`
- `DIRECT_BOOKINGS_NOTIFICATION_EMAIL`

The address must be configured and verified in Gmail as a `Send mail as` alias for the Google account connected to Omni-Lodge. If Gmail has not verified the alias, Gmail may reject the send or replace the From address with the authenticated mailbox.

## Manifest actions

Food Tour bookings ingested with `platform: "direct"` expose these manifest actions:

- `Confirmation` resends the direct booking confirmation email.
- `Amend` updates the Omni-Lodge experience date/start time and sends an amended booking email.
- `Cancellation` issues a Stripe refund in the same Stripe environment as the original payment, cancels the Omni-Lodge booking, and sends a cancellation email.
- `Partial Refund` issues a Stripe partial refund in the same Stripe environment as the original payment, records the refund values, and sends a partial refund email.

Each action sends the customer email and a separate internal notification email to `DIRECT_BOOKINGS_NOTIFICATION_EMAIL`. Email failures are reported in the action response but do not roll back the Omni-Lodge booking action.

Cancellation and partial refund actions select the Stripe key from the original payment mode:

- `stripeLivemode: true` or `Stripe livemode: true` in notes uses `STRIPE_SECRET_KEY`.
- `stripeLivemode: false` or `Stripe livemode: false` in notes uses `STRIPE_TEST_SECRET_KEY`.
- older direct bookings without a stored mode are treated as legacy records: Omni-Lodge tries the test key first, then the live key.

Set both `STRIPE_SECRET_KEY` and `STRIPE_TEST_SECRET_KEY` in the Omni-Lodge Control Panel under Stripe if you need to refund both production and sandbox direct bookings.

## Response

Created:

```json
{
  "status": "created",
  "bookingId": 123,
  "platform": "direct",
  "platformBookingId": "ftk_...",
  "eventType": "created",
  "customerEmailStatus": "sent",
  "customerEmailMessageId": "18f..."
}
```

Replay without changes:

```json
{
  "status": "exists",
  "bookingId": 123,
  "platform": "direct",
  "platformBookingId": "ftk_...",
  "eventType": "replayed"
}
```

Replay with changed fields:

```json
{
  "status": "updated",
  "bookingId": 123,
  "platform": "direct",
  "platformBookingId": "ftk_...",
  "eventType": "amended"
}
```
