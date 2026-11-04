# Manifest booking amendments

The manifest's **Amend** and **Force amend** dialogs allow changing the booking's product, date, time, or a combination. Changing only the product is supported.

- The product selector lists active products permitted for the current account. An inactive current product can be retained when changing the schedule.
- Owners, Administrators and Managers can reassign products. Food Tour Owners and Food Tour Managers remain restricted to their Food Tour product scope. Both the source and destination are checked by the backend.
- **Notify customer** is enabled by default. Turn it off for an internal correction; the normal Amend dialog saves directly without opening the email preview. Existing internal notifications retain their current behavior.
- Reassignment preserves booking IDs, customer details, participants, attendance, add-ons, prices, payments and refunds. It does not charge or refund any price difference.
- History records the actor and previous/new products. Force actions additionally require a reason and retain their existing stale-booking check.

For email-managed platforms, **Force amend** updates OmniLodge only. Ecwid's integrated **Amend** action continues to synchronize an explicitly changed schedule to Ecwid, while product reassignment is internal. Changing only the Ecwid booking's product does not update the Ecwid order.

OmniLodge amendments also update the corresponding storefront order item's product ID, name, slug and schedule. Later order projections therefore preserve the reassignment without changing sibling bookings or the amounts paid.

Older replayed provider emails do not overwrite a newer internal product correction. A genuinely newer platform update may still apply, following the existing local-amendment policy.

## Validation

- `npm.cmd --prefix be run check` — passed.
- `npm.cmd --prefix be test -- --runInBand` — 308 suites passed; 3,038 tests passed and one existing test skipped.
- `npm.cmd --prefix ui run check` — TypeScript and ESLint passed.
- `$env:CI='true'` followed by `npm.cmd --prefix ui test -- --watchAll=false --maxWorkers=2` — 142 suites and 1,036 tests passed. Two workers limit local resource contention; all UI suites are included.
- `$env:CI='true'` followed by `npm.cmd --prefix ui test -- --watchAll=false --runInBand --silent --runTestsByPath src/components/bookings/BookingLocalActionModal.test.tsx src/pages/BookingsManifestRefundAccess.test.tsx` — 37 amendment/refund workflow tests passed again after the final UI copy changes.
- `git diff --check` — passed.

Regression coverage includes product-only amendments, destination authorization, invalid/inactive destinations, scoped product lists, storefront order-item synchronization, Ecwid schedule synchronization, optional customer notifications, amendment email content and protection against older replayed emails.
