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

## Expected payload

Required fields:

- `platformBookingId`
- `experienceDate`
- `productName`
- `guestEmail`
- `partySizeTotal`

Common fields supported:

- `platform`
- `platformOrderId`
- `status`
- `paymentStatus`
- `paymentMethod`
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

## Response

Created:

```json
{
  "status": "created",
  "bookingId": 123,
  "platform": "direct",
  "platformBookingId": "ftk_...",
  "eventType": "created"
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
