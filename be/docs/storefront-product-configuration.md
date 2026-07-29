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
