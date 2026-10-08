# Storefront Discount Rules

## Calculation

One distinct discount code is accepted per quote/checkout. Repeating the same
case-insensitive code through `discountCode` and `discountCodes` remains valid.
Different codes return HTTP 400 before any product lookup or order creation.

Promotion metadata stores two validated settings, exposed as top-level fields by
the promotion administration API:

- `applicationBasis`: `booking` or `person`.
- `discountScope`: `tour` or `tour_and_addons`.

Old codes without these keys retain `booking` and `tour_and_addons`. No migration,
existing code-value change, paid-order rewrite, or payment adjustment is made.
New codes in the admin form default to booking/tour-only and local-only sync.

Fixed booking discounts apply once to the combined eligible amount. Fixed
per-person discounts multiply the value by eligible line quantities, capped at
each line's eligible charge. Only configured product IDs qualify. Add-on units
never increase participant count. Tour-only scope excludes add-on charges from
the cap; inclusive scope permits those charges to be discounted too.

Percentage discounts apply the rate to the selected eligible charges. Applying
the same percentage to each person is mathematically equivalent to applying it
to their combined eligible charges; the percentage is never multiplied by the
participant count. Money is rounded to two decimals at the combined discount.
Currency, minimum subtotal, validity and redemption-limit checks remain intact.
New order discount snapshots include basis, scope, type, value and participant
count alongside the applied amount so later promotion edits do not obscure the
checkout calculation.

Example: two 120 PLN tickets and two 30 PLN cocktails total 300 PLN. A fixed
10 PLN/person code deducts 20 PLN (280 PLN due). A fixed 10 PLN/booking code
deducts 10 PLN (290 PLN due). A 10% tour-only code deducts 24 PLN; a 10% inclusive
code deducts 30 PLN.

## Ecwid Boundary

The existing Ecwid coupon adapter cannot express per-person or tour-only scope.
Those combinations cannot be pushed, including through direct API calls. A
create/update that requests an incompatible sync fails before the local write.
Imports skip existing codes using either setting, preserving their local values.
Previously synced Ecwid coupons are not automatically changed or deleted when a
code becomes local-only; staff must manage that older coupon separately.

## Frontend Release

The WordPress storefront replaces the selected code when another is entered.
Legacy browser/recovery arrays retain only their most recent code. Admin payment
links now present a singular discount-code field; the server enforces the limit.
Old shared prepared carts with multiple codes fail re-quote and require staff to
prepare a new single-code link. Existing payment sessions are not retroactively
cancelled, and historical paid orders retain their original amounts.

Deploy this backend/UI release through the immutable GitHub Actions workflow,
then deploy the matching WordPress storefront. Cached old clients can receive a
one-code validation error, but cannot obtain a newly stacked quote.

## Verification

Backend tests cover legacy behavior, two distinct codes, duplicate codes,
fixed/percentage and person/booking rules, add-ons, eligible products, caps,
rounding, existing restrictions, API persistence and Ecwid import/export guards.
UI tests cover new settings, save payloads and Ecwid control availability.
WordPress browser evidence and publisher reports live in the companion
`krawlthroughkrakow-wordpress/docs/storefront-discounts/` directory.
