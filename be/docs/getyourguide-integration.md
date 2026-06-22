## GetYourGuide Supplier API Integration

This backend exposes supplier-facing endpoints under `GET/POST /api/gyg` so GetYourGuide can push bookings and cancellation updates into OmniLodge.

It also includes an outbound runner for the GetYourGuide self-tests that call back into GetYourGuide's sandbox API.

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
| `GYG_SUPPLIER_API_BASE_URL_TEST` | Optional override for the sandbox outbound base URL. Defaults to `https://supplier-api.getyourguide.com/sandbox/1`. |
| `GYG_SUPPLIER_API_BASE_URL_PROD` | Optional override for the production outbound base URL. Defaults to `https://supplier-api.getyourguide.com/1`. |

The backend accepts either credential pair, so the same deployment can serve both portal environments.

### Exposed endpoints

- `GET /api/gyg/health` - simple connectivity check.
- `GET /api/gyg/1/get-availabilities?productId=123&fromDateTime=...&toDateTime=...` - availability query.
- `GET /api/gyg/availability?date=YYYY-MM-DD&productId=123` - local fallback summary endpoint.
- `POST /api/gyg/1/reserve` - reservation hold request.
- `POST /api/gyg/1/cancel-reservation` - reservation cancellation.
- `POST /api/gyg/1/book` - booking creation.
- `POST /api/gyg/1/cancel-booking` - booking cancellation.
- `POST /api/gyg/1/bookings` - legacy booking creation alias.
- `POST /api/gyg/1/bookings/:platformBookingId/cancel` - legacy booking cancellation alias.
- `GET /api/gyg/1/bookings/:platformBookingId` - fetch the normalized booking record for verification.
- `GET /api/gyg/outbound/defaults` - returns the sample payload values used by the outbound runner.
- `POST /api/gyg/outbound/self-test` - runs the outbound GYG self-test suite from the backend.

### Outbound self-test runner

The quickest way to make the GetYourGuide portal tests move is to run the backend runner against the sandbox credentials:

```bash
cd be
npm run gyg:test-outbound
```

Useful overrides:

```bash
npm run gyg:test-outbound -- --mode=test
npm run gyg:test-outbound -- --mode=prod
npm run gyg:test-outbound -- --productId=prod123 --externalProductId=PPYM1U --supplierExternalId=12345XYZ
npm run gyg:test-outbound -- --includeAdditionalEndpoints=true
```

The default suite sends the active portal checks:

- `Notify Availability Update` with basic vacancies
- `Notify Availability Update` with `pricesByCategory`
- `Notify Availability Update` with `vacanciesByCategory`
- `Deals Over API` create/list/delete
- `Supplier Registration Over API`

The additional endpoints exposed in code but not run by default are:

- `Reactivate a Deactivated Product`
- `Ticket Redemption by Ticket Code`
- `Ticket Redemption by Booking Reference`

### Behavior

- Each payload is normalized into `bookings` and `booking_events`.
- The route reuses the existing `getyourguide` platform slug and assigns the `GetYourGuide` channel via the existing booking platform-channel map.
- Bookings are matched by `platform='getyourguide'` and the external booking reference.
- Cancellation payloads set the booking status to `cancelled`.
- Availability lookups return `data.availabilities[]` with `productId`, `dateTime`, `vacancies`, and `cutoffSeconds`.
- Reserve responses return `data.reservationReference` and `data.reservationExpiration` for the reservation-expiration feature test.
- Booking responses return `data.bookingReference` plus a `tickets[]` array with a valid `COLLECTIVE` ticket.

### Portal notes

The GetYourGuide docs require a live product before the integration can be completed. Their testing flow also distinguishes between time-point and time-period products and between individual and group sales, so make sure the portal configuration matches the product setup you actually sell.
