# Omni-lodge

Omni-lodge is a full-stack operations console for the nightly pub-crawl business. The application coordinates bookings, staffing, channel management, and the new daily counter registry. The backend is Node.js/Express with Sequelize (PostgreSQL), and the frontend is a React (CRA) client that talks to the API through a `/api` proxy.

## Getting Started

### Requirements
- Node.js 22.x LTS
- npm 10+
- PostgreSQL 14+

### Backend
```bash
cd be
npm install
# configure .env.dev / .env.prod (DB credentials, JWT secret, etc.)
npm run migrate           # runs Sequelize + Umzug migrations
npm run dev               # watches and restarts on change
```

When testing a local production database clone, set `HOST=127.0.0.1`,
`DISABLE_BACKGROUND_JOBS=true`, `SKIP_DB_SYNC=true`, `DB_SYNC_ALTER=false`, and
`SEED_ACCESS_CONTROL=false` in the ignored `be/.env.dev`. Apply pending migrations
to the local database first. This disables automatic background jobs (including
mailbox polling and reminder emails); manually triggered integration actions can
still contact external services if live credentials are configured.

### Frontend
```bash
cd ui
npm install
npm start                 # CRA dev server with /api proxy to http://localhost:3001
```

The dev client now defaults to the proxy (`/api`) so cross-origin CORS is no longer required during local development. Set `BACKEND_URL` before `npm start` if the API runs on a non-default host (the proxy middleware uses this environment variable).

### Product-scoped management

A non-empty User Type product scope enables a server-side, default-deny API
boundary, not just filtered navigation. Delegated owners can manage exclusively
scoped users, products, currency prices and product add-on overrides, and view
scoped bookings and finance reports. Company-wide users/roles, shared scopes,
unassigned financial entries, bank balances, budgets, credentials, generic report
queries and global settings remain inaccessible. User roles must also have no
more module-action permissions than the delegating owner. User deletion, badge
printing, affiliate changes and password resets remain company-administration
operations; scoped user creation creates no staff badge or external side effects.

Assign explicit product types to a separate owner User Type first. For local
testing only, an existing active company-wide owner/admin can then enable the
curated permissions and create a separate scoped team-member role:

```powershell
cd be
npm run build:dev
$env:NODE_ENV='development'
node dist/scripts/configureProductScopedOwner.js --role-id=<scoped-role-id> --actor-id=<company-owner-id>
```

The helper requires a loopback database connection, refuses company-wide target
roles, and audits its changes. It does not modify existing shared staff roles or
assign legacy financial data. Reload the browser after configuration. Scoped
finance reports include only ledger entries explicitly linked through `productId`;
booking revenue remains in Bookings Summary and must not be added to the ledger
report a second time. Production activation still requires the approved release
and administration workflow, never this local helper.

## Database & Migrations

All new schema changes live under `be/src/migrations`. We use Umzug with Sequelize's query interface:

- `npm run migrate` � apply all pending migrations.
- `npm run migrate:undo` � roll back the last migration.

The counter registry migration (`202510020001-counter-registry.ts`) introduces:

- `addons`
- `product_addons`
- `counter_channel_metrics`
- new columns and constraints on `counters` and `counterUsers`

Run the migration once per environment after pulling this branch. No backfill is required; historical counter data stays in the legacy tables.

## Seeding

Seed scripts for users, channels, and base products are unchanged. To exercise the new counters flow you will need:

- Channels: Fareharbor, Viator, GetYourGuide, FreeTour, Walk-In, Ecwid, Email, Hostel Atlantis, XperiencePoland, TopDeck
- Product: �Pub Crawl� (mark as active)
- Add-ons: Cocktail (max_per_attendee = 1), T-shirt, Instant Photo
- Staff users typed as Guide or Assistant Manager

If you already have a seed routine, extend it to populate the new tables; otherwise insert them manually or via the API.

## Counters API & UI

### Catalog endpoints
```
GET /api/addons?active=true
GET /api/channels
GET /api/products?active=true
GET /api/users?types=Guide,Assistant
```

### Counter workflow
```
POST /api/counters
Body: { counterDate: "YYYY-MM-DD", userId, productId?, notes? }

GET /api/counters?counterDate=YYYY-MM-DD
GET /api/counters/:id
PATCH /api/counters/:id           # { status?, notes? }
PATCH /api/counters/:id/staff     # { userIds: number[] }
PUT   /api/counters/:id/metrics   # Metric grid payload
```

Every counter response follows the shape:
```json
{
  "counter": {
    "id": 42,
    "counterDate": "2025-10-01",
    "userId": 3,
    "status": "draft",
    "notes": "",
    "productId": 1,
    "createdAt": "2025-10-01T17:00:00.000Z",
    "updatedAt": "2025-10-01T17:00:00.000Z",
    "manager": { "id": 3, "fullName": "Ala Manager" },
    "product": { "id": 1, "name": "Pub Crawl" }
  },
  "staff": [
    { "userId": 7, "name": "Ala Guide", "role": "guide" },
    { "userId": 9, "name": "Miko�aj Assistant", "role": "assistant_manager" }
  ],
  "metrics": [... full channel/add-on grid ...],
  "derivedSummary": { "byChannel": [...], "totals": {...} },
  "addons": [... allowed add-ons with max_per_attendee ...],
  "channels": [... counter channel registry order ...]
}
```

### Example day (2025-10-01)

1. Open Counters page � date defaults to today.
2. The UI `POST /api/counters` with `{ counterDate: "2025-10-01", userId: <current user> }`.
3. Assign staff Ala (Guide), Miko�aj (Assistant) � `PATCH /api/counters/:id/staff`.
4. Enter tallies per channel and bucket:
   - Fareharbor booked before: people 42, cocktails 30, t-shirts 8, photos 14
   - Viator booked before: people 20, cocktails 10
   - GetYourGuide booked before: people 18, cocktails 12
   - Walk-In booked after: people 9, cocktails 5
   - Ecwid booked after: people 3, t-shirts 1
   - Attended: Fareharbor 37/28/7/12; Viator 17/9; GetYourGuide 15/10; Walk-In 11/6; Ecwid 4/1
5. Metrics are synced via `PUT /api/counters/:id/metrics` with incremental cells.
6. Summary computes non-show as `(bookedBefore + bookedAfter) - attended` clamped ? 0 for people and add-ons.
7. Add notes, keep as draft or finish the shift and `PATCH /api/counters/:id { "status": "final" }`.

The Counters page is fully responsive (three columns collapse to stacked cards on mobile) and locks edits once the counter is marked final. Reopen is available to the manager assigned to the counter.

## Local Development Proxy

`ui/src/setupProxy.js` proxies `/api` during `npm start`. Override the backend target with `BACKEND_URL=http://localhost:4000 npm start` if required. Production builds assume the API is served from the same origin (`/api`).

## Production Notes

- Keep the backend CORS disabled in production; the UI should be served behind the same host and reverse proxy.
- Run `npm run build` in `be` before deploying to ensure migrations and TypeScript succeed.
- Apply migrations as part of your release pipeline.

## Logs & Progress

See `docs/progress-log.md` for a running history of major implementation steps.

## License

Exclusive rights � see [LICENSE.md](LICENSE.md).

## Contact

Pablo Jos� Cabrera Camposeco � [LinkedIn](https://www.linkedin.com/in/pablo-jose-cabrera-camposeco/)

Project Link: [https://github.com/pablo-dryfield/omni-lodge](https://github.com/pablo-dryfield/omni-lodge)
