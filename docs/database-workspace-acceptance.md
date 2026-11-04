# Database Workspace release evidence

This records the complete integration release. Procedures and capacity boundaries are in `database-workspace-operations.md`; requirements are in `sql-helper-postgresql-workbench-plan.md`.

## Local qualification, 4 November 2026

Windows HP ZBook Studio G7, 12 logical processors, approximately 32 GiB RAM, Node 22.23.2/npm 10.9.8, PostgreSQL 17, Chrome, source backend/UI with development instrumentation. Production discovery found PostgreSQL 16.8 and a 2 GiB host. Local timings are not production latency promises.

| Check | Result |
| --- | --- |
| `npm.cmd --prefix be run check` | Passed |
| `npm.cmd --prefix be test -- --runInBand` | 315 suites; 3,136 tests passed; one existing skipped test |
| `npm.cmd --prefix be run test:database-workspace` | 36 real PostgreSQL/parser/recovery tests passed |
| `npm.cmd --prefix be run build:prod` | Passed, including compiled monitoring-model verification |
| `npm.cmd --prefix ui run check` | Passed after final presentation changes |
| `CI=true npm.cmd --prefix ui test -- --watchAll=false --runInBand` | 144 suites; 1,043 tests passed |
| Focused UI workspace tests after presentation/value changes | Two suites; seven tests passed |
| `CI=true npm.cmd --prefix ui run build` | Final build compiled successfully; generated files remain ignored |
| Release-tooling Node test list from `.github/workflows/ci.yml` | 297 passed; ten platform skips; zero failures |
| `git diff --check` | Passed |

Real PostgreSQL tests exercise restricted roles/RLS, unsafe functions/views/security-definer execution, transaction failures/lost commit acknowledgement, exact cancellation, lossless values, bounded captures/imports/optimistic edits, schema round trips/drift, schedules/revocation, independent control backups, isolated restores and an offline process drill. Control migrations are advisory-locked, applied once and reject changes to applied definitions. Prepared authorization SQL sees account/page/action revocation immediately.

API suites cover administrator/scope boundaries, named sharing/revocation, backup-copy identity/deletion/retention, authentication, legacy executor retirement and primary-worker readiness. Full application tests cover existing booking, finance, configuration, reporting and access behavior.

## Browser and performance evidence

- Fourteen sequential history requests: first approximately 484 ms, warm p95 approximately **9 ms**. Twelve synthetic read admissions: warm p95 approximately **146 ms**, all completed read-only. Fixed prepared metadata plans avoid repeated planning on heavily indexed authorization tables; permission rows are never cached across requests.
- An editor document exceeding 100 KiB remained editable with undo. After separating grid rendering from editor changes, the isolated typing/undo sample produced no observed browser long task over 50 ms. Escape then Tab left the editor for result controls.
- A synthetic 10,000-row capture rendered only a 200-row page. The next page began at row 201; a condition found row 500 across the full capture. Export controls distinguish captured filters/sort/visible columns from a new full-read snapshot.
- Inspected 1440x1000 desktop, 360x800 phone and earlier 390px layouts without document overflow. Checked dark selected-query contrast, reduced motion, accessible names and phone touch controls. A simulated 460px visual viewport retained the 44px Run control, mode, environment/database/role status and usable editor. Native keyboard/IME behavior remains device/browser dependent.
- Browser reads preserved duplicate labels, bigint `9007199254740993`, decimal `1.200000000000000001`, SQL NULL and JSON null distinctly. Anonymous capabilities returned 401. Changed policy invalidated an old capture.
- Mobile table editing was exercised on a synthetic local table. An intervening database edit caused the reviewed write to roll back with the original change retained. Fixed the terminal-error dialog/focus path so the conflict is visible, added inline preparation errors, and corrected the table-mode badge. Three UI regression tests cover the consumed-review failure, visible preparation rejection and unavailable mutations on a read-only target.

## Linux and production gates

Windows has no Linux/systemd runtime. Required CI uses the actual compiled launch policy, verifies memory/CPU/task limits, allocates external Buffer memory until the bounded worker is killed and verifies shutdown after its exact parent exits. Both PostgreSQL 16 and 17 legs must pass before opening the ready PR. Linux results, PR URL, immutable release SHA and production health are recorded at final handoff; local skips are not qualification.

The first branch CI run exposed runner/fixture setup issues: Ubuntu lacked the additional PostgreSQL 17 client package, and five fixtures discarded URL authentication while switching databases. CI now installs matching clients from the official PGDG signed repository, verifies its signing-key fingerprint, and uses an explicit database user in service health checks. Fixtures retain the URL credentials; a fresh local URL-based run passed all 36 tests. The workflow-hardening suite passed four tests after the change. Package setup follows [PostgreSQL's Ubuntu instructions](https://www.postgresql.org/download/linux/ubuntu/).

The next runs passed both real PostgreSQL suites and reached the Linux rehearsal. Bounded diagnostics showed that the hosted runner has no `/usr/bin/node`; setup-node installs it in the tool cache. The synthetic rehearsal now uses that runner's exact Node binary and piped diagnostic output; production retains its verified `/usr/bin/node` path and silent output. All resource/lifetime restrictions remain enforced. Linux qualification remains a required gate.

Production setup uses the reviewed immutable bootstrap, restricted nonsuperuser identities, private control database, encrypted Control Panel credentials and protected environment. PUBLIC dblink/network routine grants are restricted while retaining application access. Admission stays off until the primary backend reloads the new environment, then must demonstrate its own current worker heartbeat and restricted read smoke.

The user accepted that current production storage cannot accommodate a second full database under the conservative reserve. **Additional-database restores remain disabled until sufficient capacity and the restore drill are verified.** This does not block workspace deployment, normal backups, server/Drive management or downloads. No production archive is deleted/restored for validation. PITR and whole-cluster recovery are not claimed.

The user authorized commits, push, PR, deployment/health verification and subsequent local cleanup. Dependabot PRs 198, 205, 216 and 220 were closed without comments and their remote branches deleted; a fresh check showed no open PRs or Dependabot heads. Future configured Dependabot runs may create updates. Preserve unrelated unmerged work.
