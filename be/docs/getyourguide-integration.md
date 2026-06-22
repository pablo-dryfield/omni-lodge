## GetYourGuide Supplier API Integration

This backend now exposes a supplier-facing endpoint under `GET/POST /api/gyg` so GetYourGuide can push bookings and cancellation updates into OmniLodge.

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
- `GET /api/gyg/availability?date=YYYY-MM-DD&productId=123` — returns a minimal availability summary backed by the existing schedule data.
- `POST /api/gyg/reserve` — ingest a reservation-style booking payload.
- `POST /api/gyg/cancel-reserve` — ingest a cancellation payload.
- `POST /api/gyg/bookings` — generic ingest alias.
- `POST /api/gyg/bookings/:platformBookingId/cancel` — cancellation alias.
- `GET /api/gyg/bookings/:platformBookingId` — fetch the normalized booking record for verification.

### Behavior

- Each payload is normalized into `bookings` and `booking_events`.
- The route reuses the existing `getyourguide` platform slug and tries to assign the `GetYourGuide` channel via the existing booking platform-channel map.
- Bookings are matched by `platform='getyourguide'` and the external booking reference.
- Cancellation payloads set the booking status to `cancelled`.
- Availability lookups use the internal product/schedule mapping as a pragmatic baseline; if GYG needs a stricter category-level availability contract, that should be wired next against the exact portal schema.

### Portal notes

The GetYourGuide docs require a live product before the integration can be completed. Their testing flow also distinguishes between time-point and time-period products and between individual and group sales, so make sure the portal configuration matches the product setup you actually sell.
