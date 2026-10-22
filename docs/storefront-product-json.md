# Advanced product storefront JSON

In **Settings / Products**, open **Edit product** (or **Add product**) and expand
**Advanced storefront JSON**. This editor manages additional top-level fields and
custom fields under `content` in the existing `products.storefront_config` JSONB
value. No `extra` wrapper, new database column, migration, or separate
configuration store is needed.

```json
{
  "durationMinutes": 180,
  "inclusions": ["Food tastings", "Local guide"],
  "content": {
    "card": {
      "subtitle": "Polish classics & local stories",
      "description": "A short description for the tour card.",
      "stats": [
        { "icon": "plate", "count": 10, "label": "Food tastings" }
      ]
    }
  }
}
```

Values may contain nested objects, arrays, strings, finite numbers, booleans and
null. The root must be an object; blank text is treated as `{}`. Syntax errors,
non-finite numbers and attempts to edit fields managed by the ordinary form block
saving. **Format JSON** changes whitespace only. Deleting an additional key removes
it on save; `{}` clears only the additional fields, including custom content.
`"content": {}` removes custom content fields while keeping standard content.
Cancel discards unsaved edits. If present, `content` must itself be an object.

Booking rules, availability and section order stay in the normal form. Within
`content`, the standard `summary`, `description`, `highlights`,
`importantInformation` and complete `meetingPoint` object also remain protected.
The advanced editor omits those fields and refuses to overwrite them; other
content fields (such as `card`, `kicker` or future custom objects) are editable.
In particular, `content.card.description` is separate from the protected long
`content.description`. Saving combines the latest normal form values with the
additional JSON. Existing custom fields load back into the editor, and deleting a
custom content field removes it without erasing standard descriptions or meeting
details. Icon names and other display-specific constraints are validated by the
consuming storefront, not interpreted as instructions or executable markup here.
Permissions remain the existing product-catalog create/update permission and
product-type scope, including Food Tour-scoped editors.

## Public API contract

Both endpoints return additional fields directly under each product's `config`:

- `GET https://omni-lodge.com/api/storefront/products`: `products[i].config.durationMinutes`,
  `products[i].config.content.card`, etc.
- `GET https://omni-lodge.com/api/storefront/products/<slug>`:
  `product.config.durationMinutes`, `product.config.content.card`, etc.

The KTK WordPress proxy forwards these responses at
`/wp-json/ktk-storefront/v1/products` and `/products/<slug>`. Food Tour already
fetches the same OmniLodge catalog and filters it to Food Tour products. No new
endpoint, credentials or storefront rendering change is required to expose the
fields upstream. Food Tour's `normalizeOmniCatalog` currently maps an allowlist
into its `Tour` model; future display changes must explicitly read the desired
`config` fields there. KTK's content mapping also needs explicit support for any
new fields it should render. Neither website starts displaying them merely
because they exist. As with other proxy metadata, WordPress's associative JSON
decoding can represent empty nested objects as empty arrays; consumers should
not depend on empty-object identity through that proxy.

KTK catalog/product proxy caches last up to five minutes; Food Tour's catalog
fetch revalidates after sixty seconds. Those existing consumer caches may delay
visibility of product edits; the OmniLodge API reads the saved config directly.

**All of this data is public. Never store credentials, private notes, customer
information or other secrets here.** Custom metadata is data only: it does not
change authoritative pricing, payment, participant limits or booking rules.
Future consumers must validate new fields and render text safely rather than
execute arbitrary HTML/scripts from them.
