## Booking Email Ingestion

Incoming reservations from Fareharbor, Ecwid, Viator, GetYourGuide, FreeTour, Airbnb, or manual sources are now synchronized by inspecting the Gmail mailbox connected through the existing Google OAuth credentials.

### Required Environment Variables

| Variable | Description |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | OAuth credentials with the `gmail.readonly` scope. |
| `BOOKING_GMAIL_QUERY` | Gmail search query limiting which messages are processed. Defaults to `(subject:(booking OR reservation))`. |
| `BOOKING_GMAIL_BATCH_SIZE` | Maximum number of Gmail messages to pull per cron execution (default `20`). |
| `BOOKING_EMAIL_POLL_CRON` / `BOOKING_EMAIL_POLL_TZ` | Cron frequency (default every 5 minutes, UTC) used by the background ingestion job. |

### Database Artifacts

| Table | Purpose |
| --- | --- |
| `bookings` | Canonical booking record with guest, schedule, amounts, and the latest Gmail message reference. |
| `booking_emails` | Raw Gmail message metadata and payload snapshot for replay/debugging. |
| `booking_events` | Immutable history of create/amend/cancel events linked to the originating email. |
| `booking_addons` | Structured add-on details parsed from email payloads. |

Each `booking` row enforces uniqueness on `(platform, platform_booking_id)` to keep amendments/cancellations idempotent.

### Runtime Flow

1. `startBookingEmailIngestionJob` (triggered automatically from `app.ts`) polls Gmail on the configured cron schedule.
2. Each Gmail message is stored in `booking_emails` and labeled with an ingestion status (`pending`, `processing`, `processed`, `ignored`, `failed`).
3. Parsers (starting with a heuristic `BasicBookingParser`) attempt to normalize the booking payload. Their output drives `booking_events` inserts, `booking` upserts, and an optional rebuild of `booking_addons`.
4. Failed or ignored emails can be replayed by calling `reprocessBookingEmails()` from a script/REPL; the latest Gmail payload is kept in `booking_emails.raw_payload`.

Extending parsing logic is as simple as adding new implementations to `src/services/bookings/parsers` and exporting them from `getBookingParsers()`.
