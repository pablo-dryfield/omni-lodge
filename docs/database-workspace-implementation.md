# Database Workspace implementation record

The user authorized implementation on 3 November 2026 using GPT-6.1 Sol Extra High throughout. Deliver the complete architecture in `sql-helper-postgresql-workbench-plan.md` as one release. Current instruction is to work until everything is ready to push, open the PR and deploy; do not open an early auto-merging PR.

## Branch and preserved work

- Integration branch: `codex/database-workspace`, based on current `origin/master` plus the existing local manifest amendment commit `ce9253e1`.
- Preserve `codex/manifest-product-amend` and its commit. No production changes have been made by this implementation.

## Verified discovery

- Local PostgreSQL: 17.5, 100 maximum connections. Local application login is a superuser; it is unsuitable for workbench execution.
- Production HTTPS read connector: healthy, database `omni_lodge_db`, dedicated reader, read-only transaction enforced. This connector does not expose server-version discovery.
- Existing SQL Helper sources match the planning audit.
- Global Node/npm differ from repository pins; use a private pinned toolchain for final validation.
- Parser selection: `@supabase/pg-parser`, a PostgreSQL 15/16/17 WASM parser; version 17 matches the verified local server. Reject undeclared server majors rather than guessing grammar.

## Work packages

| Package | Status | Evidence |
|---|---|---|
| W0 Discovery/design | In progress | Local DB and production reader verified; parser/dependency compatibility being checked |
| W1 Execution foundation | In progress | Restricted connections, parser policy, encrypted durable jobs/results, atomic writes/cancel and control storage implemented; first 10 real PostgreSQL tests pass |
| W2 Workspace/editor/library/sessions | In progress | Focused responsive shell, CodeMirror, tabs, encrypted draft/library APIs, history and reviewed writes implemented; expert sessions pending |
| W3 Results/export/sharing | In progress | Typed server-paged grid, nested filters, sort/columns, exact value inspector and captured-result exports implemented; full export jobs/sharing pending |
| W4 Editing/import | In progress | Structured row editing, conflict/schema checks, signed keyset browsing and staging/review UI added; imports pending |
| W5 Analysis/monitoring | Pending | |
| W6 Schema/ERD/privileges | Pending | |
| W7 Maintenance/restore/schedules | Pending | |
| W8 Integration/release qualification | Pending | |

## Release gates

Track F01-F16 and A01-A12 from the architecture plan. No feature is complete merely because a tab or button exists. Record exact validation commands/results here as work progresses. Provisioning, backup/restore independence, worker lifecycle, and production target privileges remain release prerequisites.

## Validation recorded so far

- Pinned private toolchain installed outside repository: Node 22.23.2 and npm 10.9.8.
- `npm.cmd --prefix be run test:database-workspace`: 12 tests passed, including real PostgreSQL fixtures, bounded reads, exact/NULL/duplicate data, write rollback/row budget, reauthorization, idempotency, cancellation, optimistic row conflicts and signed keyset paging.
- `npm.cmd --prefix be run check`: passed at the current checkpoint.
- `npm.cmd --prefix ui run check`: TypeScript and ESLint passed at the current checkpoint. Full application suites and final checks remain release gates.
- `provisionDatabaseWorkspace.ts --local` completed on loopback only: separate local control database, restricted read/write identities, encrypted Control Panel credentials and workspace page/module permissions. No production provisioning performed.
- Local API-to-worker read execution passed (sample generate_series query); browser read execution returned a typed timestamp result. Desktop and 390px mobile views inspected. Mobile Query/Results separation was refined after visual inspection; final mobile/keyboard qualification remains pending.
- The local backend uses a process-specific test JWT key, so browser test tokens cannot authenticate to production. No production credentials were copied to the test browser. Private runtime artifacts and fixtures are ignored by Git.

## Known remaining engineering work

Finish all work packages in the architecture plan. In addition, review policy-aware result access, worker-orphan reconciliation, notices, review replay after expiry, library quotas/configuration and draft-save serialization before declaring W1-W3 complete. Activity/administration views are currently development placeholders and must become real tools before release.
