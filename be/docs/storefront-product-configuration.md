# Storefront product configuration

OmniLodge is the source of truth for storefront behavior. Configuration is stored
in the `storefrontConfig` JSON fields on `Product` and `ProductAddon`; the server
always validates and prices submitted selections.

## Product configuration

| Field | Values | Purpose |
| --- | --- | --- |
| `participantMode` | `quantity`, `gender_split` | Use one participant count or separate Man/Woman counts. |
| `minParticipants` / `maxParticipants` | integer | Enforced against the calculated participant total. |
| `dateRequired` | boolean | Requires a valid activity date. |
| `availability.dateMode` | `flexible`, `fixed`, `allowed_dates` | Controls whether guests choose any valid date, see one fixed date, or choose only configured dates. |
| `availability.fixedDate` | `YYYY-MM-DD` | Required when `dateMode` is `fixed`; quote/checkout auto-submit this date and reject any other date. |
| `availability.allowedDates` | `YYYY-MM-DD[]` | Required when `dateMode` is `allowed_dates`; all other dates are unavailable. |
| `availability.cutoffMinutes` | integer | Minutes before the start time when same-day booking closes; `0` means no cutoff. |
| `timeMode` | `fixed`, `select`, `manual` | Fixed default, configured list, or customer-entered time. |
| `defaultStartTime` | `HH:mm` | Submitted automatically for fixed-time products. |
| `startTimes` | `HH:mm[]` | Allowed choices for select-time products. |
| `fullNameRequired` | boolean | Requires the lead guest's full name. |
| `emailRequired` | boolean | Requires a syntactically valid email address. |
| `phoneRequired` | boolean | Requires a valid international phone number. |
| `content` | object | Storefront copy, highlights, important information, and meeting-point details. |

Participant pricing uses the total participant count. For `gender_split`, that is
`man + woman`; customers do not enter an additional quantity.

### Pub Crawl example

```json
{
  "participantMode": "gender_split",
  "minParticipants": 1,
  "maxParticipants": 100,
  "dateRequired": true,
  "timeMode": "fixed",
  "defaultStartTime": "21:00",
  "fullNameRequired": true,
  "emailRequired": true,
  "phoneRequired": true,
  "content": {
    "summary": "A social night out through Krakow's best bars and clubs.",
    "description": "Meet the local team and experience Krakow nightlife with an organised group.",
    "highlights": ["Local party guides", "Multiple venues"],
    "importantInformation": ["Bring valid photo identification", "Wear comfortable shoes"],
    "meetingPoint": {
      "name": "Adam Mickiewicz Monument",
      "address": "Rynek Glowny, Krakow",
      "instructions": "Look for the Krawl Through Krakow team.",
      "mapUrl": "https://maps.google.com/..."
    }
  }
}
```

### Fixed-date event example

Use this for one-off products such as NYE Pub Crawl where the customer should
see the event date but not choose a different date:

```json
{
  "dateRequired": true,
  "timeMode": "fixed",
  "defaultStartTime": "21:00",
  "availability": {
    "dateMode": "fixed",
    "fixedDate": "2026-12-31",
    "cutoffMinutes": 0
  }
}
```

Use `allowed_dates` for products that run only on a small configured set of
dates:

```json
{
  "availability": {
    "dateMode": "allowed_dates",
    "allowedDates": ["2026-10-31", "2026-12-31"]
  }
}
```

Edit these fields in **Settings > Products > Storefront product information**.
The product endpoints return this object unchanged under `config.content`.
Clients should hide an information section when its corresponding value is empty.

## Global cancellation policy

`GET /api/storefront/config` returns one global `cancellationPolicy` for every
product:

```json
{
  "currency": "PLN",
  "checkoutEnabled": true,
  "cancellationPolicy": {
    "title": "Cancellation policy",
    "summary": "Cancel at least 24 hours before the experience start time for a full refund or credit.",
    "items": [
      {
        "title": "24 hours or more before the start time",
        "description": "You can receive a full refund or credit."
      }
    ]
  }
}
```

Manage it in **Settings > Control Panel > Storefront cancellation policy**. The
same policy is used in storefront customer confirmation emails, keeping the
website and email wording aligned. If product-specific policies are introduced
later, products can reference a policy key without duplicating policy text.

The browser presents a country selector containing supported ISO countries and a
digits-only local-number field. It submits one compact E.164 value such as
`+48123456789`; spaces and formatting characters are display-only.

## Add-on configuration

| Field | Values | Purpose |
| --- | --- | --- |
| `selectionMode` | `boolean`, `quantity`, `options` | Toggle, numeric/bundled amount, or named choice. |
| `allowedQuantities` | integer array | Restricts quantities to sellable bundles such as `0,1,3,5,10`. |
| `quantityPrices` | quantity-to-price map | Sets a total bundle price for each allowed quantity. |
| `options` | object array | Defines allowed values and their price adjustments. |

Use `quantity` for cocktails, T-shirts, and instant photos when customers choose
how many they need. Use `boolean` only for a true yes/no extra. Use `options`
where each choice has business meaning beyond a quantity.

### Instant Photos example

```json
{
  "selectionMode": "quantity",
  "allowedQuantities": [0, 1, 3, 5, 10],
  "quantityPrices": {
    "1": 0,
    "3": 0,
    "5": 0,
    "10": 0
  }
}
```

Replace the zero placeholders with approved total bundle prices in OmniLodge.

## Cart and checkout behavior

- Cart lines retain participant counts, date, time, customer details, and add-ons.
- Editing a cart line requests a new server quote; the browser never calculates the authoritative price.
- More than one discount code can be applied and each applied code can be removed.
- Product-scoped and cart-wide discounts can be combined when their promotion rules permit it.
- Checkout revalidates configuration, prices, availability, and discounts before creating payment.

## Migration checklist

- Configure every product's participant, date, time, and required-customer-detail rules.
- Configure every add-on's selection mode, allowed quantities, options, and approved prices.
- Verify product/add-on storefront visibility and active price schedules.
- Test editing and removing every cart-line type.
- Test valid, invalid, stacked, scoped, and removed discount codes.
- Verify availability and capacity enforcement before enabling production checkout.

## Add-on experience-date availability

Settings / Product Add-ons provides everyday, selected-weekday, and unavailable
options. These use the **booked experience date**, never the purchase date.
The existing public catalog exposes the configuration as `addon.config` for
both KTK and Food Tour:

```json
{
  "availability": {
    "enabled": true,
    "daysOfWeek": [5, 6],
    "unavailableMessage": "Cocktails are only available on Friday and Saturday tours."
  }
}
```

Weekdays use ISO numbers: Monday `1` through Sunday `7`. Omit `daysOfWeek`
for every day; set `enabled: false` to make the add-on unavailable. An empty
weekday array is rejected. Missing availability retains existing behavior.
These settings are per product/add-on combination, not global to the add-on.

Storefront consumers should disable unavailable choices and show the configured
message, recalculating when the experience date changes. Restricted add-ons need
an experience date before availability can be determined. OmniLodge quote and
checkout validation enforces the rules even if a client submits a stale cart.
Changing the rules does not remove add-ons from previously paid bookings.

The advanced JSON editor preserves extra nested objects, arrays, and values
directly in `addon.config`. It does not wrap them in `extra`. Availability,
selection styles, quantities, and prices remain controlled by the form.
Custom keys are public data for storefront consumers; they do not define
executable server rules and must never contain secrets.

## Meeting-point photos

Settings / Products / Meeting point accepts a photo and accessible description.
The existing product-media upload service stores the image, compressed as JPEG
for storefront and email compatibility. Save the product to publish a new photo;
cancelled uploads are cleaned up. Previously saved meeting-point photos remain
available so replacing a photo does not break emails already sent.

Both catalog APIs expose `product.config.content.meetingPoint.photoUrl` and
`photoAlt`. Storefront consumers can render these alongside the existing name,
address, instructions, and map link. This backend release does not change the
separately deployed storefront clients.

Storefront order emails include the photo automatically. Booking-linked email
template previews and sends resolve `{{meetingPointPhotoUrl}}` and
`{{meetingPointPhotoAlt}}` from the saved booking's product. React templates also
receive `meetingPoint.photoUrl` and `meetingPoint.photoAlt`; render the image
conditionally when a URL exists. Plain-text templates can include the URL.
Existing booking/product authorization and template restrictions still apply.

The Settings / Email Previews storefront confirmation uses the current Pub Crawl
product content, including its saved meeting-point photo. Customer details and
booking references remain fictitious, and loading a preview never sends mail.

## Customer confirmation barcodes

Paid storefront customer confirmations include a Code 128 barcode for each
linked OmniLodge booking. It encodes the internal numeric booking ID accepted by
manifest search, with the same ID shown alongside as a fallback. Barcodes appear
in the booking reference section; orders containing multiple experiences show
each barcode with its product name and booking ID there. No
barcode is generated for an item without a persisted booking ID.

The backend generates PNG images locally and embeds them as inline MIME parts
referenced by Content-ID. The preview uses the same PNG bytes as data URLs so
they render in the browser without sending an email or hosting a public barcode
endpoint. This identifies the booking; it does not automatically check guests in.
Bank-transfer payment instructions and
internal notifications remain separate from paid customer confirmations.

In Counters / Reservation Check, the search-field scanner button opens an inline
camera in place of the stepper, with optional fullscreen expansion. Scanning
continuously replaces the search with the exact internal booking ID, within the
current counter's date, product, and channels. It never changes the selected
Remaining / Checked In view or records attendance. The same barcode held in view
is suppressed until it is no longer detected for two seconds; different tickets
are accepted immediately. Already-checked-in and unmatched bookings require an
explicit warning acknowledgment before more results can update the search.
Camera access requires HTTPS (or localhost), and frames are decoded locally.

## Homepage volunteer progress

The `home-volunteer-progress` section is configured in Settings / Home
Experience alongside Planned payments. It appears before Modules for staff
whose profile is `volunteer`, subject to the saved audience and existing
Volunteer Progress access. It always fetches the signed-in user's own stay,
including when their role also has management access. No new database migration
or environment variable is required for these features.

## Live add-on inventory

Storefront catalog responses (`GET /storefront/products` and
`GET /storefront/products/:slug`) use response version `3`. Every add-on now
contains an `inventory` object sourced from active OmniLodge inventory mappings
and live available stock.

```json
{
  "id": 2,
  "name": "T-Shirts",
  "inventory": {
    "tracked": true,
    "availableQuantity": 83,
    "inStock": true,
    "variantSelectionRequired": true,
    "variants": [
      { "value": "S", "label": "S", "availableQuantity": 14, "inStock": true },
      { "value": "M", "label": "M", "availableQuantity": 22, "inStock": true },
      { "value": "L", "label": "L", "availableQuantity": 20, "inStock": true },
      { "value": "XL", "label": "XL", "availableQuantity": 17, "inStock": true },
      { "value": "XXL", "label": "XXL", "availableQuantity": 10, "inStock": true }
    ]
  }
}
```

- Show only variants where `inStock` is `true`, or show sold-out variants as disabled.
- Refresh the catalog before checkout so customers see recent availability.
- `availableQuantity` is expressed in sellable add-on units after applying each
  inventory mapping's `quantityPerAddon` value and subtracting allocated mail-later fulfillments.
- Untracked add-ons return `tracked: false`, `availableQuantity: null`,
  `inStock: null`, and an empty `variants` array. They must not be treated as sold out.

For an inventory-tracked add-on where `variantSelectionRequired` is true, send
the complete variant breakdown on the cart add-on. The sum of variant
quantities must equal the add-on `quantity`.

```json
{
  "addonId": 2,
  "quantity": 7,
  "variants": [
    { "value": "S", "quantity": 2 },
    { "value": "M", "quantity": 2 },
    { "value": "L", "quantity": 1 },
    { "value": "XL", "quantity": 1 },
    { "value": "XXL", "quantity": 1 }
  ]
}
```

The quote and checkout endpoints reject unknown sizes, duplicate size rows,
out-of-stock quantities, or a breakdown that does not equal the requested
add-on quantity. The normalized breakdown is returned in the quote and stored
on the storefront order, booking add-on snapshot, and `BookingAddon.metadata`.
