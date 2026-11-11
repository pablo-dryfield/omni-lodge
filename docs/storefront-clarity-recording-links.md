# Storefront history and Clarity recordings

The owner approved storefront and OmniLodge deployment together. No database migration, commerce rule, price, payment behavior, sampling rate or consent-setting change is required.

## Correlation contract

The existing `claritySessionId` field is the storefront's custom visit UUID, **not** Clarity's native recording session ID. Never substitute it into a player URL. Older histories retain a copyable custom-session lookup ID where replay was requested, not a promise that a recording exists.

New storefront code subscribes to Clarity's exported `metadata` callback. It waits for playback mode, validates native `projectId`, `userId` and `sessionId`, verifies the configured project and current analytics consent, then queues `clarity_recording_linked` in the existing bounded event stream. Production only; staging replay remains disabled. No cookies, contact values or payment details are parsed for correlation, and no new request endpoint is introduced.

Source contract checked 2026-11-11: Microsoft's public `packages/clarity-js/src/clarity.ts` exports `metadata`; `src/data/metadata.ts` implements `(callback, wait, recall)`. The active website tag loaded SDK 0.8.77 during development. This export is present in the public SDK but not documented alongside every client API in Microsoft Learn. If it becomes unavailable, capture fails closed and the legacy lookup path remains; do not invent native IDs from custom IDs or cookie internals.

The backend accepts only bounded alphanumeric identifiers and the production environment for this event. It discards extra fields and arbitrary URLs. Reference events use ordinary journey-detail retention, are scoped to their owning visit/cart, and retain normal request authentication/authorization.

## UI coverage

`StorefrontReplayLinks` is used by the shared `StorefrontActivityTimeline`. Booking manifest details and the bookings executive dashboard already share `BookingDetailsModal`, which uses this timeline. Payment Links' cart activity (including ongoing and recovered carts) now uses the same timeline instead of its separate renderer. Historical legacy server-event lists remain unchanged.

Native references produce `https://clarity.microsoft.com/player/{projectId}/{userId}/{sessionId}` links. Multiple native sessions remain distinct; repeated page references are deduplicated. Opening requires appropriate Clarity account/project access; this is not a public share link. Client playback metadata establishes a reference, not successful server upload, retention or availability. Controls therefore do not say Replay available. Processing, blocking, consent, expiry and sampling can still leave no usable recording.

Each unique native project/user pair also has a compact **Find visitor in Clarity** search control. It opens Clarity's recordings list with the native User ID filter and the last 30 days selected, so staff can look for other retained sessions when a direct player is empty. The search and player links share the same strict client-event, production-environment and identifier validation; no event-supplied URL is trusted. Neither control verifies that a recording was uploaded or retained, and search can legitimately return no sessions. The custom-session copy fallback remains for older histories without native metadata.

No attempt is made to reconstruct historical recordings that were never captured. The existing custom visit ID and `ongoing_cart_id` tag may help a staff member locate retained older sessions using Clarity's custom filters. A copied lookup ID always comes from the actual visit rather than a possibly stale request context that was applied across queued visits.

## Release order and rollback

1. Run backend typecheck/full tests and UI check/full tests; test capture, malformed IDs, withdrawal, multiple sessions, legacy states and both shared UI callers.
2. Merge the scoped PR through normal CI; wait for the immutable Release and authorized production host deployment; verify `/api/health/ready` and `/healthz` identify the same release.
3. Publish the storefront's local ten-file payload to staging, verify hashes and browser fixtures, require local/staging parity, then promote production with the existing DPAPI/FTPS wrapper.
4. Verify public asset versions/hashes across desktop/Android/iPad caches. Never submit real orders/payments or generate recovery emails as a test.

Rollback storefront first to the publisher's exact backup if necessary. The additive backend event allowlist/UI are compatible with old storefront clients and need no data rewrite. Use the managed-release rollback workflow for OmniLodge, not builds or checkout mutation on the host.

The company project override in the WordPress Clarity MU plugin remains untouched. Global tracking loaders, GTM, consent providers, original WordPress settings/posts, homepage artwork/layout and the Ecwid fallback are outside this change.
