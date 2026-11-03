# Database Workspace implementation record

The user authorized implementation on 3 November 2026 using GPT-6.1 Sol Extra High throughout. Deliver the complete architecture in `sql-helper-postgresql-workbench-plan.md` as one release. Current instruction is to work until everything is ready to push, open the PR and deploy; do not open an early auto-merging PR.

## Branch and preserved work

- Integration branch: `codex/database-workspace`, based on current `origin/master` plus the existing local manifest amendment commit `ce9253e1`.
- Preserve `codex/manifest-product-amend` and its commit. No production changes have been made by this implementation.

## Verified discovery

- Local PostgreSQL: 17.5, 100 maximum connections. Local application login is a superuser; it is unsuitable for workbench execution.
- Production HTTPS read connector: healthy, database `omni_lodge_db`, dedicated reader, read-only transaction enforced. A later read-only trusted-host probe confirmed PostgreSQL **16.8 (Ubuntu 16.8-1.pgdg20.04+1)**; local is 17.5. CI now covers both majors. No production settings/schema/data were changed.
- Existing SQL Helper sources match the planning audit.
- Global Node/npm differ from repository pins; use a private pinned toolchain for final validation.
- Parser selection: `@supabase/pg-parser`, a PostgreSQL 15/16/17 WASM parser; version 17 matches the verified local server. Reject undeclared server majors rather than guessing grammar.

## Work packages

| Package | Status | Evidence |
|---|---|---|
| W0 Discovery/design | In progress | Local DB and production reader verified; parser/dependency compatibility being checked |
| W1 Execution foundation | In progress | Restricted connections, parser policy, encrypted durable jobs/results, atomic writes/cancel and control storage implemented; 20 real PostgreSQL/parser/recovery tests pass at the latest recorded run |
| W2 Workspace/editor/library/sessions | In progress | Focused responsive shell, CodeMirror, tabs, encrypted draft/library APIs, history and reviewed writes implemented; dedicated expert-session engine and UI added; savepoint/aborted-state/commit test passes |
| W3 Results/export/sharing | In progress | Typed server-paged grid, nested filters, sort/columns, exact value inspector and captured-result exports implemented; full read-export jobs, streamed CSV/JSON/SQL downloads, named authenticated sharing and export audit added; qualification pending |
| W4 Editing/import | In progress | Structured row editing, conflict/schema checks, signed keyset browsing and staging/review UI added; CSV/JSON staging, mapping, conversion validation, duplicate policy and atomic import UI/API added; qualification pending |
| W5 Analysis/monitoring | In progress | Activity/locks/health/workload snapshots; estimated plan graph/tree/table/comparison; reviewed session signal engine added; full integration pending |
| W6 Schema/ERD/privileges | In progress | Expanded metadata; ERD/layout/export; schema snapshots/comparison; migration drafts; parsed reviewed DDL and privilege inspection/grant builder added; coverage hardening pending |
| W7 Maintenance/restore/schedules | In progress | Dedicated maintenance engine with nontransactional outcomes/post-checks added; existing backup inventory adapter, encrypted staging, version/checksum/headroom verification and isolated restore engine/UI added; daily/weekly DST-aware reviewed schedules added; full qualification/operations pending |
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

Finish all work packages in the architecture plan. In addition, review policy-aware result access, worker-orphan reconciliation, notices, review replay after expiry, library quotas/configuration and draft-save serialization before declaring W1-W3 complete. Activity/administration placeholders have been replaced with connected tools. Finish inspection coverage, dependency-aware comparison, privilege wizard and remaining operational features before release.

## Latest local implementation checkpoint

- Commit `56ce6676`: isolated query execution and responsive query workspace. Further work remains uncommitted on the same integration branch.
- Added fenced expert sessions with explicit commit/rollback/savepoints, per-command jobs, idle/transaction/session expiry and no takeover/replay of uncertain transactions.
- Result access now rechecks role/grants/RLS fingerprint. Lost worker jobs reserve capacity until their exact backend is reconciled. Draft saves are serialized.
- Imported CSV/JSON is staged encrypted in the independent control store. Type validation runs casts without INSERT/default/sequence execution, and actual import uses one bounded transaction.
- Administration uses a dedicated nonsuperuser maintenance identity. Ordinary raw SQL cannot invoke DDL/maintenance. Reviewed schema operations reject protected/out-of-scope objects, role/owner changes, cascading drops and security-definer routines. Broad infrastructure operations remain explicitly separate from this boundary.
- Local provisioner now prepares a maintenance identity and pg_read_all_stats (plus pg_maintain on PostgreSQL 17). Provisioner was rerun locally (maintenance identity and statistics grants). Local backend/worker/UI were restarted; newer recovery/config changes still require another final restart. Restore identity has been added to the provisioner but not yet reprovisioned.
- Latest completed verification: 20 integration/parser/recovery tests passed, including DST and a disposable encrypted custom-archive restore drill. Backend and UI checks passed at the prior source checkpoint; newer administration/export/sharing edits require a fresh run.
- No production changes, push, PR, or deployment. Full one-release gates remain open.

### Connected testing state

Local browser page 5 remains at `http://localhost:3000/settings/sql-helper`, local Admin user ID 1, process-specific JWT key (ignored `.tmp/workspace-local-test-key`). Page 3 is production and untouched. Current services: backend session 31456 (PID 12872), worker session 87078 (PID 33696), UI session 83541 (child PID 14000, parent 43704); verify PIDs before stopping. Backend skips schema sync/access seeding/background integrations.

Checks completed at recent checkpoint: backend `check` and UI `check` passed, then additional recovery/permission edits were made. No full application Jest or release build/ops suite has been run yet. Generated runtime files remain ignored.

Remaining release gates include comprehensive API permission/sharing tests, actual write-plan mode, full metadata/schema/role feature contract coverage, scheduling maintenance templates, quota/retention/audit tools, schema comparison dependency order and explicit unsupported-change handling, independent offline recovery/operator flow, worker packaging and production discovery/provisioning/rehearsal. Do not declare F01?F16/W0?W8 complete from the implemented screens alone.

### Backup management steering and live read-only evidence

User asked to manage server and Google Drive backups in this workspace, including delete and restore per location. Implement both inventories independently, exact copy IDs, location-specific reviewed deletion (Drive trash by default, optional explicit permanent delete), source-bound restores and configurable retention. Do not actually delete any production backup as part of development.

Live production host was inspected read-only via the configured trusted local maintenance SSH key; no key/secret contents were printed. Deployment worker's backup gate invokes `/home/postgres/backup.sh` only for pending migrations. It creates/checksums a local archive; there is no Drive upload in that deployment gate. The application backup job later syncs local archives to Drive and, under existing Drive mode, deletes successfully uploaded local files. At inspection there was one local backup, 988,340,842 bytes, modified 2026-11-03 14:22 UTC. The server script's optional seven-day cleanup is commented out.

New code adds `DB_BACKUP_STORAGE=both` and `DB_BACKUP_KEEP_LOCAL_COPY`, without changing production values. Drive listing no longer creates folders as a read-side effect. Backup uploads must verify Drive size/SHA-256 before deleting local files. Current dual-inventory/delete work requires fresh typechecks/tests.

### Current integration coverage and outstanding work

Added named authenticated result/query sharing, full read export jobs with separate limits and streamed CSV/JSON/SQL, private query-library organization/revisions/favorites, per-tab parameter forms, audit and cross-user job status/cancellation controls, ordinary role-management wizard/backend and a first production child-worker supervisor. These remain subject to final permission, concurrency and UI verification.

Worker lifecycle is not qualified yet: supervisor currently provides a separate 512 MiB V8 heap but **not** an OS RSS ceiling. Before release, use a trusted transient systemd service (or equivalent independent service) with MemoryMax/CPUQuota/TasksMax, protected EnvironmentFile and fixed compiled script from the activated backend. Keep credentials out of arguments. A parent PID/start-time watchdog and graceful drain must stop old-release workers; readiness must report worker heartbeat. Bootstrap environment exception: independent control-store URL/key and external-supervisor selector are infrastructure settings; operational budgets belong in Control Panel.

The production host's existing `/etc/omnilodge/backend.env` was used internally by a read-only Node/psql version probe without printing any values. Production is 16.8. Raw `psql` without that environment prompted for a password; that client was stopped and no password was supplied/printed. No production mutations, service changes, backup deletion, uploads, deployment or configuration updates have occurred.

The latest user question about deployment backups was answered with live code evidence: only migration-bearing deploys create a new local backup; deployment does not upload it to Drive; the scheduled application backup job later syncs local files and removes uploaded copies under current Drive mode. Preserve this distinction in final documentation.

Remaining particularly important gates: full metadata/DDL comparison dependency coverage and drift races, actual write EXPLAIN mode, approved maintenance schedules, library/storage quotas, complete API permission/share/revocation tests, large-value/RSS/watchdog qualification, production provisioning (including PostgreSQL 16 maintenance ownership), worker deployment/cutover/rollback and offline recovery path, full repo checks/build, complete responsive/a11y tests and acceptance evidence. Do not push an auto-merging PR until all required features and gates are ready.

### Subsequent engineering and qualification checkpoint

The following supersedes the older remaining-work notes for implemented features; final acceptance is still pending.

- Actual JSON plans for INSERT/UPDATE/DELETE run in a separate reviewed transaction that always rolls back. RETURNING is required for a reliable affected-row count. Missing RETURNING, mixed batches and expert-session write plans are rejected. Sequence/external trigger effects are disclosed.
- Added maintenance scheduling templates, exact-session cancel/terminate review, bounded lossless JSON/bytea/array value inspection, error jumps, query tab actions, plain-text editor fallback, editor size/wrapping preferences, recent/favorite objects, lazy catalog paging and foreign-key query navigation.
- Added independent control-database capacity checks, admission reserve, storage warnings and retention of worker/session/schedule metadata. Artifact reservations remain atomic and separate. Finishing/cancelling existing jobs retains reserved headroom.
- Worker supervision now builds a transient systemd service with MemoryMax, CPUQuota, TasksMax, private temporary files and a read-only system filesystem. A PID/start-time watchdog ties it to the activated backend. Linux resource detection handles v1, v2 and hybrid cgroups. Actual Linux RSS/shutdown qualification remains outstanding; default memory ceiling was reduced to 512 MiB for the discovered production capacity.
- Schema snapshots now include row-security state, policies, triggers and relation/column comments. Dependency ordering identifies cycles; unresolved conversions/renames remain explicit manual resolutions. Roles/membership/default grants are inspected through their dedicated view.
- Ordinary database identities reject privileged ownership/memberships, non-invoker readable views and executable application security-definer routines. New workspace views must declare security_invoker=true.
- Added trusted production bootstrap (`provisionDatabaseWorkspaceRuntime.ts`) and independent offline restore entry point (`offlineDatabaseRecovery.ts`). Neither has been executed in production. Bootstrap writes credentials only to encrypted Control Panel values and the protected host environment; role DDL uses SCRAM verifiers, not plaintext passwords. Existing-table ownership migration is an explicit option into a nonsuperuser NOLOGIN owner group.
- Legacy HTTP restore endpoints are retired in production before upload parsing. The existing backup screen links to the reviewed workspace recovery flow. Local development restore remains available.
- Drive copies with matching filenames are verified by content hash/size before a local copy can be removed. A matching name alone is insufficient. Server/Drive inventories, reviewed location-specific deletion, checksum verification and optional retain-both storage are implemented; no real backup was deleted or uploaded during this development.

Latest completed checks:

- `npm.cmd --prefix be run test:database-workspace`: **26 passed**, real PostgreSQL 17 fixtures. Includes restricted-role/RLS denial, ordinary ownership protection, SCRAM authentication and maintenance provisioning, lossless results, import/CRUD, expert sessions, lost commit acknowledgement, cancellation and isolated restore.
- `npm.cmd --prefix be test -- --runInBand`: initial full run had **307 suites passed, one migration-sequence collision**. Renamed the workspace migration to `202611030002-database-workspace-access.ts`; focused access/migration rerun then passed **26 tests**. Final full rerun remains required after later edits.
- `CI=true npm.cmd --prefix ui test -- --watchAll=false --runInBand`: **142 suites / 1,036 tests passed** at that source checkpoint. Additional value-inspector suite then passed **3 tests**. Later UI edits need final checks.
- Release-tooling Node suite from `ci.yml`: **297 passed, 10 platform skips, zero failures** on Windows. POSIX bootstrap shell and actual Linux unit execution remain CI/Linux checks.
- Backend and UI `check` passed at repeated checkpoints. Newer bootstrap and UI edits still need final checks.
- Browser/API local read preserved bigint, exact decimal, JSON null, SQL NULL, empty string and duplicate column labels. Anonymous capabilities request returned 401. Write validation now permits the initial empty reason before the review dialog.
- Warm local history requests measured approximately **660–945 ms**, above the 500 ms target. Removed duplicate authentication of the same request at the import-parser/router boundary and added request-local page eligibility reuse; remeasurement is required. No cross-request authorization cache was introduced.

Additional live production discovery was strictly read-only: PostgreSQL 16.8, application role postgres (superuser), 184 public relations owned by postgres, zero RLS tables, pg_stat_statements 1.10 installed, 100 maximum connections and six connections at measurement. Database size was 2,687,341,027 bytes. Host has 2,067,017,728 bytes RAM and roughly 4.1 GB free filesystem space. The independent workspace control URL is not configured. An initial metadata probe inherited an incompatible SSL default; retry used the trusted loopback connection with SSL explicitly disabled, matching the application topology. No production secrets were printed.

Production restore staging now reserves archive copies plus a configurable decompression/database expansion allowance (default six times archive size) and free-space floor. The current host cannot safely restore its approximately 988 MB archive under that policy. This must be shown as a real capacity limitation, not an enabled restore that fills the live disk. A larger/isolated restore volume or target and a measured drill are deployment prerequisites for enabling production restore.

Outstanding qualification: finish endpoint/recipient/revocation tests; Drive adapter tests; scheduler dispatch/overlap/authority tests; schema round trips and drift races; worker Linux isolation/lifetime and offline operator rehearsal; quota/concurrency/cancellation edges; full build and final suites; keyboard/mobile/accessibility and performance remeasurement. Keep the full integration branch local until the complete package passes its gates.
