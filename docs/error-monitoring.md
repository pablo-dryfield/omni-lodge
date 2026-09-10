# Error monitoring

OmniLodge has a first-party, database-backed error monitor at `/error-monitoring`.
It groups repeated failures into issues while retaining recent occurrences for investigation.
Only active `admin`, `administrator`, and `owner` accounts can use the dashboard or its API.

## Coverage

- Browser startup, JavaScript, promise, React render, resource, CSP, console, Reporting API/Network Error Logging, Axios, Fetch, and service-worker failures.
- Failed browser HTTP requests, including status, sanitized path, duration, and the API's `X-Request-Id` when available.
- Every inbound API response with a 4xx or 5xx status, interrupted requests (499), and exceptions handled by Express. The ingestion endpoint itself is excluded to prevent recursive reporting.
- Failed outbound backend HTTP(S) calls, including timeouts and network errors, without headers, query values, or bodies.
- Startup import/runtime-dependency failures (before the application can install its own handlers), uncaught process failures, abnormal non-zero exits, runtime warnings, error-level logs, legacy `console.error` calls, and failure-shaped warning/`console.warn` calls in jobs or integrations.

The browser keeps a bounded offline queue and retries delivery with backoff. The service worker has its own IndexedDB queue, background-sync support, and activity-based retries for browsers without Background Sync. Repeated local events are coalesced, and the API enforces idempotency by client event ID. A browser or device that is terminated before it can persist or transmit an event cannot be guaranteed to report it. Browser storage may also be cleared by the browser or operating system, and the oldest events are discarded if a bounded queue reaches its safety cap.

Backend/request/process events that cannot reach PostgreSQL are written to a bounded local NDJSON spool and replayed at startup and once per minute. Each PM2 process writes and rotates its own segments; replay claims are atomic, and another process only recovers an abandoned writer/claim after a ten-minute stale window. Each record has a stable idempotency key, so a crash after the database commit but before spool cleanup does not double-count it. Fatal events use a synchronous, flushed emergency append before Node's normal exit path continues. Files are created with mode `0600`; their payload is independently bounded and redacted, and raw IP/session values are never placed in the spool.

Production startup uses `be/scripts/startMonitored.js`, a built-in-only launcher that runs before the compiled application is imported. If a dependency or top-level module fails to load, the launcher synchronously appends a redacted fatal event to the same replayable spool before exiting non-zero. Keep the production PM2 command on `npm run start:prod` (or invoke this launcher equivalently); launching `dist/app.js` directly bypasses this earliest failure boundary.

The production UI server also reports proxy failures, uncaught request failures, missing build assets, and fatal process errors. Its bounded private disk queue survives UI-server restarts and replays to the API when it becomes reachable again. The queue is capped by UTF-8 bytes, preserves fatal entries ahead of lower-severity noise, and redacts again before writing to disk. Trusted UI-server delivery requires the matching private secrets documented below; without them, the queue is retained on disk rather than being downgraded to anonymous browser telemetry.

## Privacy and retention

Monitoring never intentionally records request bodies, form values, cookies, authorization headers, tokens, uploaded files, or URL query values. Sensitive object keys and common credentials, email addresses, phone numbers, and payment-card-like values are redacted again by the API before persistence. Session and IP values are stored only as keyed hashes.

Detailed occurrences default to 90 days and are cleaned daily at 03:42 UTC. Grouped issues, workflow status, assignment, regression count, and investigation notes remain available after old occurrences are removed.

## Release configuration

Apply these migrations before starting the updated API:

1. `202609090001-error-monitoring-foundation`
2. `202609090002-error-monitoring-access`

Run them with `npm run migrate:prod` from `be` before restarting the updated processes. That migration grants access to the supported administrative roles; a separate access-control sync is not required for this feature. Recommended production environment values are:

```dotenv
# Use a long independent random value. If omitted, JWT_SECRET is used.
ERROR_MONITORING_HASH_SECRET=replace-with-a-private-random-secret

# Optional; accepted range is 7-365 days.
ERROR_MONITORING_RETENTION_DAYS=90

# Local database-outage fallback. Defaults shown; the path can be absolute.
ERROR_MONITORING_SPOOL_PATH=runtime/error-monitoring/failed-events.ndjson
ERROR_MONITORING_SPOOL_SEGMENT_BYTES=1048576
ERROR_MONITORING_SPOOL_MAX_BYTES=20971520
ERROR_MONITORING_SPOOL_MAX_RECORDS_PER_SEGMENT=2000

# Optional UI-server overrides. Both defaults point at the local API/private
# runtime directory and normally need no change.
UI_SERVER_TELEMETRY_ENDPOINT=http://127.0.0.1:3001/api/client-errors/batch
UI_SERVER_TELEMETRY_SPOOL_PATH=/root/omni-lodge/runtime/error-monitoring/ui-server-errors-443.json
ERROR_MONITORING_SOURCE_MAP_DIR=/root/omni-lodge/runtime/error-monitoring/source-maps
ERROR_MONITORING_SOURCE_MAP_RELEASES=20

# Canonical HTTPS origin used by CSP/Reporting API delivery. It is never
# derived from the incoming Host header.
PUBLIC_APP_ORIGIN=https://omni-lodge.com

# Required for trusted UI-server process/proxy alerts. Generate one independent
# random value of at least 32 characters and configure the identical value in
# the API process and UI-server process. Never expose it as a REACT_APP_* value.
ERROR_MONITORING_INTERNAL_SECRET=replace-with-at-least-32-random-characters
UI_SERVER_TELEMETRY_SECRET=replace-with-the-identical-random-value

# Cloudflare -> ui-server -> API is two trusted proxy hops in production.
# Allowed values are 0-5; invalid values safely fall back to 2.
TRUST_PROXY_HOPS=2

# Set one of these on the API so regressions can be tied to a deployment.
APP_VERSION=release-name-or-git-sha
GIT_COMMIT_SHA=git-sha

# Set the identical value at UI build time and in the UI-server runtime. The
# hashed main bundle is used as a fallback only when neither side is configured.
REACT_APP_RELEASE=release-name-or-git-sha

# Optional UI build-time signal shown in occurrence diagnostics.
REACT_APP_SOURCE_MAPS_EXPECTED=true
```

Spool configuration is bounded defensively: segment size 64 KiB-16 MiB, total size 64 KiB-512 MiB (and never below one segment), and 100-50,000 records per segment. Invalid values fall back to the defaults. Do not rotate `ERROR_MONITORING_HASH_SECRET` merely for a deployment: rotation intentionally breaks correlation with older pseudonymous session/IP hashes.

Keep the spool on a private persistent local volume with enough free space. The default cap is 20 MiB per backend process; once full, that process's oldest rotated segments are discarded and reported as capacity evictions in both `queue.dropped` and `queue.spool`. A destroyed/unmounted/full/unwritable host volume cannot provide durability, and a power loss can still leave the final partial line unreadable (replay safely skips malformed lines). Spool counters and current bytes/files/records are exposed in the monitoring summary's `queue.spool` object.

The UI-server telemetry endpoint must connect directly to the API. Plain HTTP is accepted only for loopback (`127.0.0.1`, `localhost`, or `[::1]`); use HTTPS for any non-loopback endpoint. Redirects are rejected so the private credential can never be forwarded to another origin. The public UI proxy strips the private header, and the API rejects a present-but-invalid secret so the UI server retains and retries its disk queue. The public `X-OmniLodge-Telemetry` marker remains informational and never grants server trust. Outside production, an omitted or invalid `PUBLIC_APP_ORIGIN` falls back to the local UI-server origin and never sends development Reporting API traffic to production.

Frontend source maps are content-verified and copied at startup into the private release archive at `runtime/error-monitoring/source-maps` (override with `ERROR_MONITORING_SOURCE_MAP_DIR`). Keep that directory outside `ui/build`, on the same private persistent volume as the telemetry spool. The tracked build copies remain in `ui/build`, but the public UI server rejects every normal or encoded `.map` request before static-file serving. Consequently, all production UI assets must be served through `ui-server`; do not configure nginx, Cloudflare, or another origin to serve `ui/build` directly. Backend production processes run with Node source-map support and emit private `.map` files alongside `dist`.

For the first deployment of private source maps, purge any previously cached `.map` responses from Cloudflare (purge the full zone cache if individual historical map URLs are not known). An old immutable CDN response can otherwise remain public even after the origin starts returning 404. Then verify all of the following:

1. The UI-server startup log says `Private source maps ready` for the intended release.
2. The archive contains that same release directory and is readable only by the service account (`0700` directories and `0600` map files on Linux).
3. `REACT_APP_RELEASE` in the browser build exactly matches the release value available to the UI-server process. A mismatch prevents reliable symbolication after a later deployment.
4. A request for a real deployed bundle with `.map` appended returns `404`, `Cache-Control: no-store`, and never a source-map body through both the origin and the public Cloudflare hostname.
5. A controlled browser exception appears with privately symbolicated original frames; source-map contents themselves must never appear in the dashboard or API response.

## Triage workflow

- `Open`: newly detected or regressed issue.
- `Investigating`: someone is actively working on it.
- `Resolved`: believed fixed; a new occurrence automatically reopens it and increments its regression count.
- `Ignored`: intentionally suppressed from the active workflow; new occurrences are still counted.

New fatal issues, new server 5xx issues, and regressions create deduplicated in-app alerts for the authorized administrative roles. Use the dashboard's issue URL or the user-visible error reference to find the exact occurrence. Notes, severity, assignment, and status can be managed in the issue drawer.

## Release check

From the repository root:

```powershell
Set-Location be
npm run check
node --check scripts/startMonitored.js
npx jest --runInBand src/services/__tests__/errorMonitoringService.test.ts src/services/__tests__/errorMonitoringPersistence.test.ts src/services/__tests__/errorMonitoringSpoolService.test.ts src/services/__tests__/consoleErrorMonitoringBridge.test.ts src/services/__tests__/externalRequestDiagnosticsService.test.ts src/services/__tests__/browserStackSymbolicationService.test.ts src/utils/__tests__/trustProxy.test.ts src/controllers/__tests__/clientErrorController.test.ts src/middleware/__tests__/optionalErrorMonitoringAuth.test.ts src/migrations/__tests__/errorMonitoringFoundationMigration.test.ts src/migrations/__tests__/errorMonitoringAccessMigration.test.ts

Set-Location ..\ui
npm run check
$env:CI='true'
npx craco test --watchAll=false --runInBand src/earlyErrorMonitoringBootstrap.test.ts src/utils/errorMonitoringSanitizer.test.ts src/utils/errorMonitoringQueue.test.ts src/utils/errorMonitoringByteBudget.test.ts src/utils/errorMonitoring.test.ts src/utils/errorMonitoringDefaultAxios.test.ts src/components/errorMonitoring/AppErrorBoundary.test.tsx src/api/errorMonitoring.test.ts src/pages/ErrorMonitoringPage.test.tsx

Set-Location ..\ui-server
npm test
node --check server.js
node --check telemetryPayload.js
node --check telemetrySecurity.js
node --check reportingSecurity.js
node --check sourceMapArchive.js
```

After deployment, deliberately trigger one controlled browser error and one controlled API 4xx in a non-sensitive test flow. Confirm that both appear, that the browser/API occurrences share a request ID where applicable, and then mark the controlled issues ignored.

No in-process monitor can guarantee delivery after a hard kill, out-of-memory termination, complete host/storage failure, or simultaneous loss of the API and its local disks. PM2/system logs and an independent external uptime check remain the final fallback for those host-level failures.
