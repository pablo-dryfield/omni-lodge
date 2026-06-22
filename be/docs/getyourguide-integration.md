## GetYourGuide Supplier API Integration

This backend exposes supplier-facing endpoints under `GET/POST /api/gyg` so GetYourGuide can push bookings and cancellation updates into OmniLodge.

### Portal setup

In the GetYourGuide Integrator Portal, the testing configuration should point to:

- **Host**: your public backend host
- **Port**: `443`
- **Path**: `/api/gyg/`
- **Auth**: HTTP Basic Auth using the configured test credentials

The production configuration should use the same path and the production Basic Auth credentials.

### Required environment variables

| Variable | Purpose |
| --- | --- |
| `GYG_TEST_SUPPLIER_API_USERNAME` / `GYG_TEST_SUPPLIER_API_PASSWORD` | Basic Auth credentials accepted by the testing supplier endpoint. |
| `GYG_PROD_SUPPLIER_API_USERNAME` / `GYG_PROD_SUPPLIER_API_PASSWORD` | Basic Auth credentials accepted by the production supplier endpoint. |

The backend accepts either credential pair, so the same deployment can serve both portal environments.

### Exposed endpoints

- `GET /api/gyg/health` — simple connectivity check.
- `GET /api/gyg/1/get-availabilities?productId=123&fromDateTime=...&toDateTime=...` — availability query.
- `GET /api/gyg/availability?date=YYYY-MM-DD&productId=123` — local fallback summary endpoint.
- `POST /api/gyg/1/reserve` — reservation hold request.
- `POST /api/gyg/1/cancel-reservation` — reservation cancellation.
- `POST /api/gyg/1/book` — booking creation.
- `POST /api/gyg/1/cancel-booking` — booking cancellation.
- `POST /api/gyg/1/bookings` — legacy booking creation alias.
- `POST /api/gyg/1/bookings/:platformBookingId/cancel` — legacy booking cancellation alias.
- `GET /api/gyg/1/bookings/:platformBookingId` — fetch the normalized booking record for verification.

### Behavior

- Each payload is normalized into `bookings` and `booking_events`.
- The route reuses the existing `getyourguide` platform slug and assigns the `GetYourGuide` channel via the existing booking platform-channel map.
- Bookings are matched by `platform='getyourguide'` and the external booking reference.
- Cancellation payloads set the booking status to `cancelled`.
- Availability lookups return `data.availabilities[]` with `productId`, `dateTime`, `vacancies`, and `cutoffSeconds`.
- Reserve responses return `data.reservationReference`; `reservationExpiration` is optional in the spec and omitted by our implementation.
- Booking responses return `data.bookingReference` plus a `tickets[]` array with a valid `COLLECTIVE` ticket.

### Portal notes

The GetYourGuide docs require a live product before the integration can be completed. Their testing flow also distinguishes between time-point and time-period products and between individual and group sales, so make sure the portal configuration matches the product setup you actually sell.
