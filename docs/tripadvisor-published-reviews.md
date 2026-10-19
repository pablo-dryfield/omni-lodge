# TripAdvisor published-reviews integration

The 2026-10-19 browser capture identified reviews query `1eeac11193438f8a`.
Query `928136d2240e1ed3` is an advertising query (it asks for `$page` and
`$platform`); `3f2df7139a71a643` generates pagination URLs, not review records.
These are public persisted-query identifiers, not API keys or session secrets.

## Request and response contract

The scraper sends one reviews query to `/data/graphql/ids`, with
`clientId: ATTRACTION_DETAIL_LIST`, the configured location, limit and offset,
`sortBy: SERVER_DETERMINED`, language in `filterOptions.language.languageTag`,
and locale (`en-US` for `en`). It reads configuration for each request. The
browser capture's offset `10` was the second page; sync starts at `0` and
advances by the actual number of returned records, not the requested limit.

The current response is
`data.ReviewsProxy_getPublishedReviewsForLocation[0].result`, containing
`totalCount` and `reviews`. Older review-list responses remain readable.
`submittedDateTime` supplies the source creation date when `createdDate` is
absent; it never becomes today's date. A supplied publication date retains its
existing precedence. Nested translation metadata, `userProfile.userId`, and
`locationNode.detail.info` are normalized without replacing stable review IDs.

Unknown response formats, nested application errors, invalid source dates/IDs,
and unexpectedly empty pages fail closed. The UI and scheduled full sync permit
up to 1,000 TripAdvisor pages, but reaching the cap, non-advancing pagination, or
fetching fewer rows than the reported total must not mark missing reviews as
deleted. Fast sync remains non-destructive. Counts represent the configured
source/language scope, not an assumed unfiltered TripAdvisor site total.

## Configuration and verification

Use Settings > Control Panel > Review Scrapers. After deploying this code, edit
`TRIP_ADVISOR_QUERY_ID` and choose **Find, validate, and save latest query ID**.
The finder tests the configured query and the captured reviews candidate before
trying external discovery, and saves only a candidate returning valid reviews.
Existing saved values are not silently overwritten by a default-value change.

Test a small fetch/fast sync first; confirm IDs, dates and pagination before
starting Full sync. Full sync updates archive records; this change does not
automatically unlock review months or change assignments/payment ledgers.

An HTTP 401/403 after the query/schema fix is a separate access problem. Refresh
`TRIP_ADVISOR_COOKIE` only through its secret field, using the full Cookie header
from a successful TripAdvisor request and password confirmation. Never commit,
paste into chat, or log that header. Error reporting must not serialize Axios
request configuration. Refreshing a browser cookie does not guarantee the
production server will be accepted by TripAdvisor.

Regression fixtures use synthetic reviews; do not commit copied production or
browser-response data, profile identifiers, HAR files, or cookies.
