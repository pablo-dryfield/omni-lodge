# Advanced product storefront JSON

In **Settings / Products**, open **Edit product** (or **Add product**) and expand
**Advanced storefront JSON**. This editor manages additional top-level fields in
the existing `products.storefront_config` JSONB value. No `extra` wrapper, new
database column, migration, or separate configuration store is needed.

```json
{
  "duration": "3 hours",
  "inclusions": ["Food tastings", "Local guide"],
  "faqs": [
    { "question": "Are vegetarian options available?", "answer": "On request." }
  ]
}
```

Values may contain nested objects, arrays, strings, finite numbers, booleans and
null. The root must be an object; blank text is treated as `{}`. Syntax errors,
non-finite numbers and attempts to edit fields managed by the ordinary form block
saving. **Format JSON** changes whitespace only. Deleting an additional key removes
it on save; `{}` clears only the additional fields. Cancel discards unsaved edits.

Booking rules, availability, section order and the existing `content` fields stay
in the normal form. The advanced editor does not include those keys and refuses
to overwrite them. Saving combines the latest normal form values with the
additional JSON; existing custom fields load back into the editor. Permissions
remain the existing product-catalog create/update permission and product-type
scope, including Food Tour-scoped editors.

## Public API contract

Both endpoints return additional fields directly under each product's `config`:

- `GET https://omni-lodge.com/api/storefront/products`: `products[i].config.duration`,
  `products[i].config.faqs`, etc.
- `GET https://omni-lodge.com/api/storefront/products/<slug>`:
  `product.config.duration`, `product.config.faqs`, etc.

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
