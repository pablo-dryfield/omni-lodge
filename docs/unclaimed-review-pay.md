# Unclaimed volunteer review pay

Administrators, owners, and managers can use **Send unpaid reviews to Volunteer Fund** inside **Process compensation**. A reason is required. The action moves eligible review lines into the form's existing fund-allocation section. **Process compensation** then records the allocation through the normal Volunteer Fund workflow. Saving the routing alone does not create a payment, receipt, or fund entry.

The decision applies to one staff member, review component, and full calendar month. It creates user-specific rules in the existing compensation settlement-rule store, updates that month's payout snapshot, and reconciles later carry balances in the same database transaction. The audit record includes the actor, reason, amount, rule IDs, and before/after snapshots.

Only entirely unpaid review components whose historical earning segments are Volunteer are eligible. All historical segments of a selected component move together. Components with a prior personal payment, live fund allocation, mixed staff-type history, or incomplete source authorizations require the existing reconciliation process instead. Legacy unclassified payments are rejected rather than guessed. No existing personal payment or allocation is rewritten.

The destination uses the same active fund selection as staff-payment reporting: the matching-currency fund named Volunteer Fund, or the first active matching-currency fund. Accounts and funds remain controlled by their existing Finance configuration. There is no new settings store or environment variable.

## Transfer account selection

Ordinary transfers offer every active Finance account, regardless of name or account type. Accounts linked to configured Volunteer Funds are excluded by account ID, including links to inactive funds. A fund's normal funding-source account remains eligible. Account currency and distinct source/target checks still apply.

The Finance transaction form retains its existing guided Volunteer Fund expense workflow for non-transfer transactions. Both transfer sides wait for the fund configuration to load; server-side transfer guards also protect configured fund accounts.

## Local validation

- `npm.cmd --prefix be run check` — passed.
- `npm.cmd --prefix be test -- --runInBand` — 305 suites, 3,004 tests passed; 1 existing skipped test.
- `npm.cmd --prefix ui run check` — TypeScript and ESLint passed.
- `$env:CI='true'; npm.cmd --prefix ui test -- --watchAll=false --maxWorkers=2` — 141 suites, 1,021 tests passed.
- `git diff --check` — passed.

The initial full UI run with the default worker count timed out in three existing Food Tour role/review dashboard tests while backend tests and both type/lint checks ran concurrently. The complete UI rerun with two workers passed, as did focused reruns of the changed UI behavior. No unrelated test timeouts or application behavior were modified.
