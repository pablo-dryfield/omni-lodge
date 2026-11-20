# Manifest booking amendments

The manifest's **Amend** and **Force amend** dialogs allow changing the booking's product, date, time, or a combination. Changing only the product is supported.

- The product selector lists active products permitted for the current account. An inactive current product can be retained when changing the schedule.
- Owners, Administrators, Managers and Assistant Managers can reassign products. Assistant Managers require Booking Management update permission; when their role has a product scope, both the source and destination must remain within it. Food Tour Owners and Food Tour Managers remain restricted to their Food Tour product scope. The backend checks the current role and both products.
- **Notify customer** is enabled by default. Turn it off for an internal correction; the normal Amend dialog saves directly without opening the email preview. Existing internal notifications retain their current behavior.
- Reassignment preserves booking IDs, customer details, participants, attendance, add-ons, prices, payments and refunds. It does not charge or refund any price difference.
- History records the actor and previous/new products. Force actions additionally require a reason and retain their existing stale-booking check.

For email-managed platforms, **Force amend** updates OmniLodge only. Ecwid's integrated **Amend** action continues to synchronize an explicitly changed schedule to Ecwid, while product reassignment is internal. Changing only the Ecwid booking's product does not update the Ecwid order.

OmniLodge amendments also update the corresponding storefront order item's product ID, name, slug and schedule. Later order projections therefore preserve the reassignment without changing sibling bookings or the amounts paid.

Older replayed provider emails do not overwrite a newer internal product correction. A genuinely newer platform update may still apply, following the existing local-amendment policy.

## Assistant Manager manifest access

Assistant Managers have the same applicable manifest actions as Managers: native amendments, product reassignment, Direct cancellations, eligible refunds, and audited local Force amend / Force cancel actions. Existing payment/provider eligibility, notification choices, required force-action reasons and stale-booking checks still apply. A force cancellation does not issue a provider refund.

Bank-transfer amendments retain their separate permission check. The Assistant Manager defaults and the `202611200001-assistant-manager-manifest-access` migration grant bank-transfer view/update permission so existing and new Assistant Manager roles can amend those reservations. The migration does not grant bank-transfer creation or change any booking, payment, product scope or unrelated role. Administrators can continue managing these permissions through Access Control.

### Access regression validation (2026-11-20)

- Backend typecheck passed. Full backend Jest: 375 suites, 3,843 tests passed, one existing skip.
- UI typecheck and ESLint passed. Focused cancellation-policy, manifest and local-action-dialog tests: 79 passed.
- Focused backend policy, amendment controllers, product authorization and migration tests: 140 passed.
- `node --import tsx --test integration-tests/assistant-manager-manifest-access.test.mjs` passed against local PostgreSQL with local `DB_*` connection variables. It executes the real migration SQL in a transaction-local schema, verifies idempotence, all role aliases, complete active grants, no grants to other roles or actions, and rolls back every test change.
- Full UI run details and hosted CI results are recorded in the delivery PR.

## Original product-amendment validation

- `npm.cmd --prefix be run check` — passed.
- `npm.cmd --prefix be test -- --runInBand` — 308 suites passed; 3,038 tests passed and one existing test skipped.
- `npm.cmd --prefix ui run check` — TypeScript and ESLint passed.
- `$env:CI='true'` followed by `npm.cmd --prefix ui test -- --watchAll=false --maxWorkers=2` — 142 suites and 1,036 tests passed. Two workers limit local resource contention; all UI suites are included.
- `$env:CI='true'` followed by `npm.cmd --prefix ui test -- --watchAll=false --runInBand --silent --runTestsByPath src/components/bookings/BookingLocalActionModal.test.tsx src/pages/BookingsManifestRefundAccess.test.tsx` — 37 amendment/refund workflow tests passed again after the final UI copy changes.
- `git diff --check` — passed.

Regression coverage includes product-only amendments, destination authorization, invalid/inactive destinations, scoped product lists, storefront order-item synchronization, Ecwid schedule synchronization, optional customer notifications, amendment email content and protection against older replayed emails.
