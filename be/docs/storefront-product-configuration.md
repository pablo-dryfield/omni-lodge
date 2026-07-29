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
| `timeMode` | `fixed`, `select`, `manual` | Fixed default, configured list, or customer-entered time. |
| `defaultStartTime` | `HH:mm` | Submitted automatically for fixed-time products. |
| `startTimes` | `HH:mm[]` | Allowed choices for select-time products. |
| `fullNameRequired` | boolean | Requires the lead guest's full name. |
| `emailRequired` | boolean | Requires a syntactically valid email address. |
| `phoneRequired` | boolean | Requires a valid international phone number. |

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
  "phoneRequired": true
}
```

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
