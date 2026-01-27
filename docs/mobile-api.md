# Mobile API Contract (Omni-Lodge)

This document describes the current backend API surfaces used for the iOS/Android v1 app.

## Base URL
- Development: `http://<host>:3001/api`
- Production: `https://<your-domain>/api`

## Auth
- Login returns a JWT. The backend also sets an httpOnly cookie named `token`.
- Mobile should use the bearer token for all requests: `Authorization: Bearer <jwt>`.

### Login
- `POST /users/login`
- Body: `{ "email": "...", "password": "..." }`
- Response (array):
  - `{ message: string, userId: number, token: string }`

### Logout
- `POST /users/logout`
- Response (array): `{ message: string }`

### Session
- `GET /session`
- Response (array): `{ authenticated: boolean, userId?: number }`

## Manifest (Bookings)
### List manifest
- `GET /bookings/manifest`
- Query:
  - `date` (YYYY-MM-DD, defaults to today)
  - `productId` (string/number)
  - `time` (timeslot string)
  - `search` (overrides product/time filters)
- Response:
  - `date` string
  - `filters` object
  - `orders` array of `UnifiedOrder`
  - `manifest` array of `ManifestGroup`
  - `summary` object

### Types
```
UnifiedOrder {
  id: string
  platformBookingId: string
  platformBookingUrl?: string | null
  productId: string
  productName: string
  date: string
  timeslot: string
  quantity: number
  menCount: number
  womenCount: number
  customerName: string
  customerPhone?: string
  platform: string
  pickupDateTime?: string
  extras?: { tshirts: number, cocktails: number, photos: number }
  status: string
  rawData?: unknown
}

ManifestGroup {
  productId: string
  productName: string
  date: string
  time: string
  totalPeople: number
  men: number
  women: number
  extras: { tshirts: number, cocktails: number, photos: number }
  orders: UnifiedOrder[]
  platformBreakdown: { platform: string, totalPeople: number, men: number, women: number, orderCount: number }[]
}
```

## Counters (Registry)
All endpoints require `format=registry` for the registry payloads.

### Create or load
- `POST /counters?format=registry`
- Body: `{ date: "YYYY-MM-DD", userId?: number, productId?: number | null, notes?: string | null }`

### Get by date
- `GET /counters?format=registry&date=YYYY-MM-DD&productId=<id|null>`

### Get by id
- `GET /counters/:id?format=registry`

### Update staff
- `PATCH /counters/:id/staff?format=registry`
- Body: `{ userIds: number[] }`

### Commit/metadata
- `POST /counters/:id/commit?format=registry`
- Body: `{ metrics?: MetricInput[], status?: "draft"|"platforms"|"reservations"|"final", notes?: string | null }`

### Update metrics
- `PUT /counters/:id/metrics?format=registry`
- Body: `MetricInput[]`

### Registry payload
```
CounterRegistryPayload {
  counter: {
    id: number
    date: string
    userId: number
    status: string
    notes: string | null
    productId: number | null
    createdAt: string
    updatedAt: string
    manager?: { id: number, firstName: string | null, lastName: string | null, fullName: string } | null
    product?: { id: number, name: string } | null
  }
  staff: { userId: number, role: string, name: string, userTypeSlug: string | null, userTypeName: string | null }[]
  metrics: MetricCell[]
  derivedSummary: CounterSummary
  addons: { addonId: number, name: string, key: string, maxPerAttendee: number | null, sortOrder: number }[]
  channels: { id: number, name: string, sortOrder: number, paymentMethodId: number | null, paymentMethodName: string | null, cashPrice: number | null, cashPaymentEligible: boolean }[]
}

MetricCell {
  id?: number
  counterId: number
  channelId: number
  kind: "people" | "addon" | "cash_payment"
  addonId: number | null
  tallyType: "booked" | "attended"
  period: "before_cutoff" | "after_cutoff" | null
  qty: number
}

MetricInput {
  channelId: number
  kind: "people" | "addon" | "cash_payment"
  addonId: number | null
  tallyType: "booked" | "attended"
  period: "before_cutoff" | "after_cutoff" | null
  qty: number
}
```

## Venue Numbers
### Entries bootstrap
- `GET /venueNumbers/bootstrap`
- Returns: counters, venues, nightReports, managers

### Summary bootstrap
- `GET /venueNumbers/bootstrap?tab=summary&period=this_month|last_month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- Returns: venues, finance basics, and summary

### Summary only
- `GET /venueNumbers/summary?period=this_month|last_month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

### Summary types
```
VenuePayoutSummary {
  period: string
  range: { startDate: string, endDate: string }
  totalsByCurrency: VenuePayoutCurrencyTotals[]
  venues: VenuePayoutVenueBreakdown[]
  rangeIsCanonical?: boolean
}

VenuePayoutCurrencyTotals {
  currency: string
  receivable: number
  receivableCollected: number
  receivableOutstanding: number
  payable: number
  payableCollected: number
  payableOutstanding: number
  net: number
  receivableLedger: { opening: number, due: number, paid: number, closing: number }
  payableLedger: { opening: number, due: number, paid: number, closing: number }
}

VenuePayoutVenueBreakdown {
  rowKey: string
  venueId: number | null
  venueName: string
  currency: string
  allowsOpenBar?: boolean
  receivable: number
  receivableCollected: number
  receivableOutstanding: number
  payable: number
  payableCollected: number
  payableOutstanding: number
  net: number
  totalPeople: number
  totalPeopleReceivable: number
  totalPeoplePayable: number
  daily: VenuePayoutVenueDaily[]
  receivableLedger: { opening: number, due: number, paid: number, closing: number }
  payableLedger: { opening: number, due: number, paid: number, closing: number }
}

VenuePayoutVenueDaily {
  date: string
  reportId: number | null
  totalPeople: number
  amount: number
  direction: "receivable" | "payable"
  normalCount: number
  cocktailsCount: number
  brunchCount: number
}
```

### Collections (record payments)
- `POST /nightReports/venue-collections`
- Body:
  - `venueId`: number
  - `direction`: "receivable" | "payable"
  - `currency`: string
  - `amount`: number
  - `rangeStart`: YYYY-MM-DD (start of month)
  - `rangeEnd`: YYYY-MM-DD (end of same month)
  - `financeTransactionId?`: number
  - `note?`: string

## Roles and permissions
- Auth context contains `id`, `userTypeId`, and `roleSlug`.
- Module/page access is enforced server-side (role-based and permission-based). Mobile should keep feature gating in sync with the server.
