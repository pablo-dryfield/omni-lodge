# Search Console Reporting

M01 corrects reporting only. It does not alter website content/indexing, tracking,
bookings, payment records, or Google account settings.

## Verified Delivery

PR252 merged as `c4007f7d84a93976b5564478427a2172d07b3312` after all
required CI43313743742 passed. Immutable Release43315813139 attempt1 and actual
managed deployment43317776455 succeeded; host terminal success2026-11-12T22:22:37Z.
Public healthy-primary backend and UI metadata match
`omnilodge-r43315813139-a1-c4007f7d84a9`. The reporting bundle's actual SHA256
matches the trusted release artifact, not merely a stale HTML asset reference.

Authenticated, provider-backed checks passed: independent28-day totals,1000 to2000
unique query rows, matching exact-query filters in both periods, and matching
homepage-only summary/direct-page metrics. The original top100-derived figures
were incomplete; the higher corrected totals are not new traffic caused by this
release. Native Google Search Console UI comparison remains separate.

No paid SERP sample, action save, account/consent change, booking or payment
mutation was performed. The report was restored to its unfiltered view. Full
delivery details and preserved initial old-release check are in the adjacent
website project's `docs/seo/omnilodge-reporting-2026-11-12/README.md`.

## Metrics And Coverage

- Date coverage is separate from row coverage. Google retains approximately16
  months; a12-month comparison can reach beyond that history even when current
  metrics are available. The API exposes its Pacific-date history-boundary
  estimate and future-date flags without silently clipping the requested range.
  The UI warns and suppresses deltas when either period is date-limited. This is
  not a guarantee that every day inside the boundary has observations. Use saved
  historical exports for older comparisons. The16-month value is Google's provider
  retention contract, not an administrator-tunable reporting threshold.

- Overview and comparison metrics come from separate ungrouped Google requests,
  never the sum of a limited query/page table. The native summary aggregation is
  shown. With a page filter, Google cannot aggregate by property; the API chooses
  the supported aggregation. Discover/Google News also use automatic aggregation.
- Every summary and detail request uses identical dates, search type, country,
  device, and query/page filters. Reports use finalized data and Pacific dates.
- Detail requests fetch one lookahead row. Only the configured page size is
  returned, with an explicit next offset. Each table has Load more rows and
  coverage text. Reaching the end means the end of returned rows, not complete
  Google data: anonymized queries and provider limits still apply.
- Landing-page metrics are queried by page, not reconstructed from query/page
  rows. Target-query metrics use exact normalized query matching and query-only
  grouping. Pages/Queries drill-downs use native exact filters, the corresponding
  date range and matching dimensions.
- Recommendations are labeled partial-data heuristics. Unobserved target queries
  become low-priority verification prompts, never automatic Create page orders.
  Empty/error reports do not become zero metrics or indexing diagnoses.

## Operations

Browser date presets derive today's calendar day in America/Los_Angeles, then
subtract two calendar days for the existing finalized-data buffer. Mantine's
DateInput receives local calendar values for those Pacific dates, not Pacific
midnight instants that might display as a different day in another browser zone.
Custom user-selected calendar dates are not reinterpreted or silently clipped.
This fixes the interval after European/UTC midnight but before Pacific midnight.

`SEARCH_CONSOLE_PAGE_SIZE` is a non-secret Google API Control Panel setting,
default1000, validated100..24999. It is refreshed on every report request; no
restart/cache flush is required. The provider's25000-row per-call maximum leaves
one row for lookahead. Loading more is explicit, not an unbounded server crawl.
Existing Google OAuth credentials, authorization and error handling are retained.

The API additionally accepts `startRow`, `type`, `country` (ISO alpha3), `device`,
`query`, `queryMatch`, `page`, `pageMatch`. Match operators are equals/contains/
notEquals/notContains; UI offers exact/contains. Invalid dates, dimensions, filters
and offsets return400 instead of silently changing meaning. Provider errors remain
errors; a failed summary is never replaced with partial detail totals.

## Verification And Release

Production reporting and both date follow-ups are delivered. Latest exact identity
`omnilodge-r43331452337-a1-20f0366712b4`: Release43331452337, managed deployment
43333310604, host terminal13 November2026 00:06:25.519UTC. Trusted artifact13995757715
was independently extracted/verified (2804 files), and public backend/UI/reporting
bundle matched3/3. Real signed-in Europe/Warsaw presets now match Pacific dates:
28 days14Oct..10Nov958 clicks/45,215 impressions;365 days11Nov2025..10Nov2026 with
the previous period correctly warning and no comparison deltas. Native Google
28-day totals/leading query rows agree. Changes correct reporting, not traffic.
Latest full local UI183 suites/1279 tests, focus24, browser49 and all required
prospective-merge CI passed. Earlier failures remain in dated private evidence in
the adjacent KTK website repository; no account/consent/commerce changes occurred.

Focused backend27 and UI7 tests passed. The first whole UI run had seven failures
in five unchanged suites under concurrent load; preserve that log and require the
serial repeat/full CI before release. The initial page fixture lacked JSDOM
matchMedia; only the test environment was corrected. Existing React testing-library
act deprecation warnings are not new application failures.

Actual-page browser QA uses synthetic hooks and cannot certify native GSC totals.
After managed deployment, verify exact backend/UI release identity and assets,
then compare one authenticated report with native Google using identical property,
dates, search type and filters. Document aggregation/privacy differences rather
than requiring detail sums to equal totals.

Sources: [Google query contract](https://developers.google.com/webmaster-tools/v1/searchanalytics/query),
[Google extraction limits](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data).

Deployment must use required PR CI, a trusted-master immutable Release and the
managed Production Deploy Request. A green skipped deployment is not delivery.
Rollback uses the previous immutable release, not a production-host build.
