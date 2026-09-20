# OmniLodge Production Runtime Contract

Status: Phase 0 inventory, backup, full restore, and production-shaped migration verification were completed on 2026-09-16. The Phase 1 runtime changes and Phase 2 validation/release workflows were merged to `master` in PR #16. Hosted pull-request and branch CI were green, `CI / required` is enforced on `master`, and the first trusted `master` release run `35459235360` succeeded for `0ff723bafc588970d2650dc435dbc8a2b4d469de`. Those changes have not been used to deploy production. This file contains no credentials and does not authorize deployment.

This contract is the handoff between the repository, GitHub Actions, and the production host. It records the reviewed baseline, what the release pipeline must preserve, and which Phase 3 controls must still be implemented before artifact-based deployment.

Evidence labels used below:

- **Repository**: derived from checked-in code or package metadata.
- **Host**: observed through the restricted `omnilodge-deploy` account.
- **Root host verification**: observed through a temporary authenticated root operator session; secret values and private material were not recorded.
- **Phase 0 evidence**: recorded in [Production Phase 0 Evidence — 2026-09-16](production-phase0-evidence-2026-09-16.md).

## Release and repository controls

| Contract item | Current value |
| --- | --- |
| Canonical repository | `pablo-dryfield/omni-lodge` |
| Permanent source branch | `master` |
| Repository visibility | Public; confirm that this remains intentional before any later visibility change |
| Write/admin access | One current collaborator, the owner, at the Phase 0 audit |
| `master` protection | Pull request required; the GitHub Actions app-bound `CI / required` check is strictly required; zero approvals while there is only one collaborator; force pushes and deletion blocked; rules apply to administrators |
| Merge freshness | Pull-request CI checks out GitHub's prospective merge result, and strict required-check protection requires the branch to be current before merge |
| Required check | `.github/workflows/ci.yml` defines the stable pull-request aggregate `CI / required`, backed by `CI / backend`, `CI / ui`, `CI / ui-server`, and `CI / migrations`. Reviewed hosted PR run `34902107741` passed and the app-bound aggregate is required on `master`. The workflow also exposes `Branch / required` for diagnostic `codex/**` pushes |
| Branch cleanup | Repository auto-delete after merge is enabled for ordinary topic branches; do not delete `origin/dev-1`, `origin/release-1`, or local `migration/omni-ha-prep` until their unique commits are audited |
| Production environment | `production`, restricted to exact branch `master`, required reviewer configured, administrator bypass disabled |
| Deployment mode | Repository Actions variable `PRODUCTION_DEPLOY_MODE=disabled`; missing or unknown values also mean disabled |
| Workflow permissions | Default token is read-only; Actions cannot approve pull requests; actions must be pinned to full commit SHAs |
| Artifact/log retention | Repository default observed as 90 days; the release workflow explicitly uses one day for internal handoffs and 90 days for the combined release |
| Production credentials | Not configured in GitHub at this baseline; the current CI and release workflows do not request a production environment, credentials, or host access |

The initial release identifier is:

```text
omnilodge-r<GITHUB_RUN_ID>-a<GITHUB_RUN_ATTEMPT>-<first 12 characters of GITHUB_SHA>
```

The manifest always records the full 40-character SHA, run ID, run attempt, workflow identity, repository, event, and ref. The combined archive and detached checksum use the release identifier as their filename stem. A production release is eligible only when it was built by the reviewed release workflow from a successful canonical `push` to `refs/heads/master`.

The release workflow retains its backend and UI handoff artifacts for one day and the final combined release artifact for 90 days. The CI workflow publishes no artifact. The server must eventually retain the active release and at least three previous verified releases, so rollback never depends on GitHub artifact retention.

Approval, emergency freeze, and rollback are currently owned by the repository owner. A future forward deployment must pass the protected environment gate. An emergency freeze sets `PRODUCTION_DEPLOY_MODE` to `disabled`; rollback remains an explicit manual operation while forward deployment is disabled. A second server-owned automatic-deploy allow flag is not required for the first manual releases and must be reconsidered before removing the environment reviewer.

## Toolchain and package contract

The selected shared toolchain is **Node.js 22.23.2 and npm 10.9.8**. It matches the production binaries observed during Phase 0 and is pinned in `.nvmrc` and every package manifest. The developer shell used for the initial inventory happened to run Node.js 22.14.0/npm 11.17.0; that incidental pair is not an accepted build toolchain.

There are exactly three independently installed npm projects:

| Project | Lockfile | Build output | Canonical validation commands |
| --- | --- | --- | --- |
| Backend | `be/package-lock.json` | `be/dist/**` | `npm ci`; `npm run check`; `npm test -- --runInBand`; `npm run build:prod` |
| Browser UI | `ui/package-lock.json` | `ui/build/**` | `npm ci`; `npm run check`; `CI=true npm test -- --watchAll=false`; `CI=true GENERATE_SOURCEMAP=true REACT_APP_RELEASE=<release-id> REACT_APP_GIT_SHA=<full-sha> npm run build` |
| UI server | `ui-server/package-lock.json` | No compiled output | `npm ci`; `npm test`; syntax-check every checked-in `.js` file below `ui-server`, excluding `node_modules` |

There is no root npm workspace and no root `package.json`. The former empty root `package-lock.json` is not an install input and is removed as part of the reproducibility change. CI must run `npm ci` separately in all three package directories and cache against the matching package-local lockfile.

The current branch implements strict UI artifact validation, the disposable-PostgreSQL migration gate, compiled-model schema probing, pull-request CI, and the trusted `master` release workflow. Backend validation currently consists of TypeScript checking, Jest tests, compilation, and compiled-monitoring-model verification; it does not claim a separate lint gate. On 2026-09-14 the disposable database gate passed locally from empty state with all 189 migrations, a zero-change second run, 165 public tables, and 159/159 compiled models. Reviewed hosted PR run `34902107741` then succeeded with backend, UI, UI-server, migrations, and `CI / required` all green. Reviewed branch push run `34902103089` was also green, with migrations intentionally skipped by design. On 2026-09-16 a full production backup was restored locally; the exact branch applied four pending migrations, applied zero on the second run, matched all 189 migration names, and queried all 159 compiled models.

During the legacy transition, `ui/build` remains tracked and manual UI releases still follow `AGENTS.md`: build locally, commit the exact generated UI artifact, and fast-forward production to that commit. Backend `dist` is never committed. After the artifact deployment and rollback drill succeed, remove `ui/build` from Git in the dedicated cutover cleanup.

## Implemented CI and release boundary

`.github/workflows/ci.yml` and `.github/workflows/release.yml` are build-and-validation workflows only:

- A `codex/**` push runs backend checks/tests, UI checks/tests, and UI-server tests/syntax checks. It intentionally skips the slower migration and application builds and reports the aggregate as `Branch / required`.
- A pull request targeting `master` runs those gates plus backend compilation, a source-SHA-bound UI build, strict UI artifact/source-map validation, and a disposable PostgreSQL migration gate. Its aggregate is `CI / required`.
- A push to `master` runs the separate release workflow. Backend, UI, UI-server, and PostgreSQL jobs run independently; packaging waits for all of them.
- The PostgreSQL gate compiles migrations, migrates a fresh PostgreSQL 16.10 database, runs the migration command a second time, checks the applied migration set and required schema/index/foreign-key contract, then exercises every compiled Sequelize model against that schema.
- The release UI job explicitly deletes tracked or stale `ui/build` output before building. Both full UI build paths stamp `release-metadata.json`, require usable source maps for emitted JavaScript/CSS and the service worker, and validate all referenced assets.
- Backend and UI build trees pass the same recursive release preflight before their one-day handoff artifacts are uploaded and again after download. The packaging job removes checkout build output, downloads only outputs created by that same workflow run, validates them again, runs the packager tests, and emits one immutable `<release-id>.tar.gz` plus detached `.sha256` file. Packaging and verification reject links, special files, credential-like paths, unexpected runtime content, non-canonical manifests/archives, limit violations, and attempts to replace an existing release name.

All referenced GitHub Actions are pinned to full commit SHAs and workflow token permissions are `contents: read` for CI/release work. The CI and release workflows do not deploy, read `PRODUCTION_DEPLOY_MODE`, reference the protected `production` environment, or connect to the VPS. The deploy-request preparation workflow on the current branch reads `PRODUCTION_DEPLOY_MODE`, verifies a trusted `master` release, and writes a host v2 request artifact, but it still does not reference the protected `production` environment, receive production secrets, or contact the VPS. `PRODUCTION_DEPLOY_MODE=disabled` remains a fail-closed repository setting for forward deployment. The manifest's production-candidate flag is self-contained build metadata, not deployment authorization; a future privileged submit job must independently verify the successful GitHub run and immutable artifact identity before production credentials are exposed.

The first trusted `master` release run completed successfully after the PR #16 merge. No production action has occurred, no workflow can contact the VPS, and `PRODUCTION_DEPLOY_MODE` remains `disabled`.

### Release identity and runtime environment

The release job binds all components to one identity:

```text
omnilodge-r<GITHUB_RUN_ID>-a<GITHUB_RUN_ATTEMPT>-<first 12 characters of GITHUB_SHA>
```

The browser build receives `REACT_APP_RELEASE=<release-id>` and `REACT_APP_GIT_SHA=<full-sha>`. Its `release-metadata.json` must contain schema version `1`, that exact release ID, and the lowercase full 40-character SHA; the main JavaScript bundle and service worker must also embed the release ID.

At artifact runtime, the backend must receive `APP_VERSION=<release-id>` and `GIT_COMMIT_SHA=<full-sha>`. In production, `/api/health/ready` also requires valid `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `JWT_SECRET`, and returns `503` when configuration or the database probe fails. Database probes are coalesced and briefly cached to prevent readiness polling from creating an unbounded query backlog.

The UI server must be given explicit release paths at cutover:

- `UI_BUILD_PATH` for the extracted browser bundle.
- `UI_TLS_KEY_PATH` and `UI_TLS_CERT_PATH` for server-owned TLS material outside the release.
- `UI_EXPECTED_RELEASE=<release-id>` so startup preflight rejects a missing or inconsistent browser artifact.

`UI_SERVER_HOST` and `UI_SERVER_PORT` configure its listener when needed. After successful preflight, `GET /healthz` reports the UI-server release and sanitized artifact-validation status. These variables are runtime configuration; secrets and TLS contents never belong in a workflow artifact or manifest.

## Current production baseline

| Item | Observed baseline | Evidence and constraint |
| --- | --- | --- |
| OS | Ubuntu 20.04.6 LTS, x86_64 | Root host verification |
| Node/npm | `/usr/bin/node` 22.23.2; `/usr/bin/npm` 10.9.8 | Root host verification |
| Checkout | `/root/omni-lodge`, `master` at `f27d2f32e54c2d806719f706feb10d26bbb91a47` during inventory | Root host verification; one unexpected untracked file was quarantined recoverably outside the checkout, which is now clean |
| Service owner | Root owns the PM2 daemon and both application processes | Root host verification; target service-user hardening remains future work |
| PM2 | `/usr/bin/pm2`, daemon version 5.3.1; enabled/active `pm2-root` systemd unit; saved dump matches live definitions | Root host verification |
| Deployment account | `omnilodge-deploy`; key authentication works; password is locked; no passwordless sudo | Host; keep unprivileged until a root-owned validated deploy command exists |
| Backend process | `omni-lodge-be`, PM2 id 1, cwd `/root/omni-lodge/be`, `/usr/bin/npm run start:prod` | Root host verification |
| UI process | `omni-lodge-ui-server`, PM2 id 0, cwd `/root/omni-lodge/ui-server`, `/root/omni-lodge/ui-server/server.js` | Root host verification |
| PM2 execution metadata | Both processes use one fork-mode instance, autorestart enabled, and watch disabled; normalized live and saved definitions match | Root host verification; the single backend instance also owns scheduled jobs |
| Backend listener | `127.0.0.1:3001` | Root host verification and repository |
| Public UI/TLS listener | `0.0.0.0:443` | Root host verification and repository |
| Development UI-server listener | `0.0.0.0:3005` unless `UI_SERVER_PORT` overrides it | Repository; not a production listener |
| PostgreSQL | PostgreSQL 16.8, loopback `127.0.0.1/[::1]:5432` | Root host verification; database name and role remain private |
| Legacy health | Local `/api/health`, proxied public `/api/health`, and the public UI return HTTP 200; `/api/health/live` and `/api/health/ready` return 404 on the current legacy production release as expected until the merged runtime changes are deployed | Root host verification after permission hardening |
| Target release directories | `/opt/omnilodge`, `/etc/omnilodge`, and `/var/lib/omnilodge` do not exist at this baseline | Host; create only in Phase 3 |

The current backend start script compiles before every production start. The current UI server runs directly from the checkout. These are baseline facts, not the target: artifact deployment must use runtime-only commands and immutable release directories.

## Runtime paths and mutable state

| Concern | Current code/default | Production state |
| --- | --- | --- |
| Backend environment | `be/.env.prod`, resolved relative to the backend working directory when `NODE_ENV=production` | Verified present and restricted to mode 600; never print its contents |
| UI build | `UI_BUILD_PATH`; fallback `ui-server/../ui/build` for the legacy checkout | Active production still follows the checkout. Artifact cutover must set an explicit absolute extracted-release path and `UI_EXPECTED_RELEASE` |
| TLS key/certificate | `UI_TLS_KEY_PATH` and `UI_TLS_CERT_PATH`; legacy fallbacks are `be/src/ssl/cf-origin.key` and `be/src/ssl/cf-origin.pem` | The matching pair is valid through September 2040 and the key file is mode 600, but the key exists in public Git history and must be treated as exposed. The owner accepted retaining it without rotation. Before cutover, copy it to a restricted server-owned path, set explicit paths, verify strict TLS, exclude it from artifacts, and remove it from the Git tip |
| Backend logs | Winston writes `error.log` and `combined.log` relative to the backend cwd, plus PM2 stdout/stderr | Active application log files were restricted to mode 600; release activation must preserve log continuity and add explicit retention |
| UI-server logs | Winston writes `error.log` and `combined.log` relative to the UI-server cwd, plus PM2 stdout/stderr | Active application log files were restricted to mode 600; release activation must preserve log continuity and add explicit retention |
| Backend error spool | `ERROR_MONITORING_SPOOL_PATH`, otherwise `runtime/error-monitoring/failed-events.ndjson` below the backend cwd | Effective monitoring tree is `/root/omni-lodge/runtime/error-monitoring`; the combined tree was approximately 301 MB and 2,410 files at inventory time |
| UI-server error spool | `UI_SERVER_TELEMETRY_SPOOL_PATH`, otherwise `runtime/error-monitoring/ui-server-errors-443.json` below the repository at the current layout | Effective monitoring tree verified as above; move it outside immutable releases during Phase 3 |
| Private browser source maps | `ERROR_MONITORING_SOURCE_MAP_DIR`, otherwise `runtime/error-monitoring/source-maps` below the repository at the current UI-server layout | Source-map directories were mode 700; public `.map` access must remain denied, and the private archive must move outside immutable releases |
| Night-report images | Config key `NIGHT_REPORT_UPLOAD_DIR`; fallback `be/uploads/night-reports` | Aggregate across all local upload categories was approximately 8.5 MB and 10 files; the per-category split was not recorded. Preserve uploads outside releases and retain any Drive configuration |
| Profile photos | Config key `PROFILE_PHOTO_UPLOAD_DIR`; fallback `be/uploads/profile-photos` | Aggregate across all local upload categories was approximately 8.5 MB and 10 files; the per-category split was not recorded. Preserve uploads outside releases and retain any Drive configuration |
| Social-media compatibility upload | Temporary file in the OS temp directory; current large-file flow uploads resumably to Drive | Temp data is not a release asset; Drive configuration is server runtime configuration |
| Database backup uploads/restores | Temporary files use the OS temp directory | Temp data is not a release asset and must be cleaned after use |

No runtime secret, `.env` file, TLS material, upload, log, telemetry spool, source-map archive, backup, or temporary upload may enter a release artifact.

## Database migrations and backups

- The migration source is `be/src/migrations/*.ts`; production executes compiled `be/dist/migrations/*.js` through `dist/scripts/runMigrations.js`.
- `202510010000-initial-schema.ts` is an idempotent baseline for databases that do not predate Umzug. It recreates the historical pre-migration table contract, creates only missing tables inside one transaction, and is a table-by-table no-op on an existing production-shaped database. Its `down` is intentionally a no-op because a later rollback cannot safely distinguish baseline-created tables from pre-existing tables.
- Historical schema that production previously gained through Sequelize sync is now represented by explicit idempotent migrations for User profile fields, report preview ordering, and the physical timestamp names used by legacy models. Those migrations no-op on the production-shaped schema and use intentionally non-destructive rollback behavior for pre-existing columns.
- Umzug records applied migrations in `sequelize_meta`; the application also records runs and steps in `migration_audit_runs` and `migration_audit_steps`.
- Before Phase 3, replace the current empty-`sequelize_meta` legacy-adoption heuristic with an explicit schema fingerprint and fail-closed operator path. Its present any-table test can classify an unknown partial schema as fully migrated, bypassing the baseline's table-by-table repair behavior.
- Before Phase 3, require same-named indexes and constraints to match their expected definitions; name equality alone is not sufficient drift verification.
- The legacy `npm run migrate:prod` compiles and enables access-control seeding before executing the runner. Artifact deployment must instead call the already-compiled `npm run migrate:runtime` exactly once.
- Against the deployed production checkout/source tree, production had 185 applied migrations, zero pending source migrations, zero unknown migration records, and a successful latest audit at the Phase 0 inventory; the pull-request branch added four migrations afterward. `MIGRATION_VERIFY_STRICT` remains supported; the deploy preflight must record its effective value without exposing unrelated environment data.
- Production explicitly has `SKIP_DB_SYNC=true`, `SEED_ACCESS_CONTROL=false`, and `DB_SYNC_ALTER=false` in the PM2 environment. The artifact runtime must preserve authoritative migrations and must not re-enable startup-time schema mutation.
- The effective backup command is `/home/postgres/backup.sh`, staging through `/home/postgres/backups`. Both are root-owned and mode 700; a newly generated archive was restricted to mode 600.
- Effective backup storage is `drive`, with schedule `0 6 * * *` in UTC. Successful scheduled runs were observed for September 13–16, 2026.
- A fresh 966,676,562-byte archive with SHA-256 `5e0d7dff0e98b274b11715ccb097ba6c167dee038b0f52a0b76d594234697722` passed `pg_restore --list` and a full isolated restore on PostgreSQL 17.5. The restored copy contained 165 public base tables, 185 production migrations, and 2,289,691,795 bytes of database data. This validates production schema/data shape; the PostgreSQL 16.10 CI gate remains the runtime-version proof.
- The exact branch then applied its four missing migrations to that restored copy successfully. A second run was a no-op, all 189 compiled/applied migration names matched, both audit runs succeeded, and all 159 compiled Sequelize models queried their mapped tables. The disposable database was dropped afterward. See [Production Phase 0 Evidence — 2026-09-16](production-phase0-evidence-2026-09-16.md).

Before a deployment runs a pending migration, the root-owned deployment command must pass a free-space preflight, invoke the verified backup command, and prove that it created a new non-empty backup with a recorded checksum. An exit code alone is not sufficient. Application rollback never runs migration `down` automatically.

## Scheduled jobs and process topology

The production backend starts HTTP and the following in-process jobs together: finance recurring rules, database backup, booking-email ingestion, daily closure, review synchronization, abandoned-cart handling, bank-transfer expiry, WhatsApp retention and webhook processing, and error-monitoring retention/spool replay. Scheduling and assistant-manager push cron groups are currently disabled by code constants.

Therefore:

- Keep exactly one backend instance in PM2 fork mode.
- Never use PM2 cluster mode or overlap old and new backend processes during activation.
- Perform dependency installation and all preflight work before the short backend restart.
- Separating HTTP from background workers is a later architecture change, not part of the first pipeline.

## Existing maintenance controls

The authenticated maintenance page currently exposes three server-side actions:

| UI action | Command executed by the backend |
| --- | --- |
| Git Pull (master) | `git pull origin master` from the checkout root |
| Run Migrate (prod) | `npm run migrate:prod` from `be` |
| Sync Access Control (prod) | `npm run sync:access-control:prod` from `be` |

Because the backend currently runs as root, these controls execute with root authority and the last two compile on production. Preserve them only as the legacy fallback through the dry run. At artifact cutover, disable the mutating actions and replace them with read-only release/health/rollback status. Do not add a second, UI-triggered deployment path in the first release.

## Deployment smoke-test contract

The 2026-09-14 baseline returned `200` for the main homepage, the proxied health route, both companion domains, and the main manifest. A JavaScript source-map request derived from the current asset manifest returned `404`. Never hard-code the current hashed asset filename; derive it from the candidate release's `asset-manifest.json`.

| Surface | Required check |
| --- | --- |
| Main UI | `GET https://omni-lodge.com/` returns `200` HTML and references the candidate release's hashed assets |
| Legacy API health | `GET https://omni-lodge.com/api/health` returns `200` JSON with `status`, `ready`, and `uptimeSeconds`; this remains a compatibility liveness response and must not gate deployment |
| API liveness | `GET https://omni-lodge.com/api/health/live` returns `200` with process uptime and sanitized release ID/Git SHA matching the candidate release |
| API readiness | Poll `GET https://omni-lodge.com/api/health/ready`; require `200`, `ready: true`, successful required-configuration and database checks, and the expected release ID/full Git SHA. The endpoint is implemented in the repository but is not part of the 2026-09-14 production baseline until deployed |
| UI-server health | Query the UI server's private `GET /healthz`; require `200`, the expected release ID, and `artifactValidation.status: "valid"`. Do not expose this endpoint as a substitute for public asset smoke tests |
| Main PWA | `GET https://omni-lodge.com/manifest.json` and `/service-worker.js` return `200`; manifest/service-worker release metadata must match the release |
| Transaction companion | `GET https://transaction.omni-lodge.com/` and `/finance/new-transaction/install.html` return `200`; `/finance/new-transaction/new-transaction.webmanifest` is valid |
| Counter companion | `GET https://counter.omni-lodge.com/` and `/counters/new-counter/install.html` return `200`; `/counters/new-counter/new-counter.webmanifest` is valid |
| Hashed assets | Resolve the main JavaScript path from `asset-manifest.json`; require `200`, the expected checksum, and immutable cache headers |
| Source-map denial | Append `.map` to a real shipped JavaScript asset and require `404` plus `Cache-Control: no-store`; test encoded `.map` variants as well |
| API failure behavior | A temporary private-port UI-server preflight must return controlled JSON `502` for an unavailable backend, never an HTML error masquerading as API JSON |

The UI proxy is configured with WebSocket upgrade support for `/api`, but the repository defines no application WebSocket endpoint. Phase 0 therefore records **no WebSocket smoke route**. Add a route-specific handshake check only when an actual WebSocket consumer is introduced; do not invent a passing URL.

The readiness endpoint does not yet inspect pending migrations or verified artifact state. Those remain deployment preflight gates and must be added to readiness only when they can be checked without mutating the database.

## Root-only verification gate

All six Phase 0 evidence items were completed and reviewed on 2026-09-16:

1. Exact `pm2 jlist` metadata and the normalized saved startup configuration were captured for both processes.
2. Ownership and permissions—not contents—were reviewed for the production environment, TLS files, uploads, logs, telemetry spools, private source maps, and backups; sensitive files were permission-restricted where necessary.
3. Effective storage paths and backup schedule/mode were captured without credentials.
4. The production migration inventory and latest audit were checked without dumping application data.
5. A fresh non-empty backup was checksummed, archive-validated, fully restored, upgraded with the branch migrations, rerun as a no-op, and model-probed.
6. The current Git SHA/status, PM2 dump, and exact live UI build were recorded as recoverable cutover baselines.

The sanitized record is [Production Phase 0 Evidence — 2026-09-16](production-phase0-evidence-2026-09-16.md). Phase 0 is **complete**. `PRODUCTION_DEPLOY_MODE` remains `disabled` because Phase 3 host preparation, dry run, controlled cutover, and rollback drill are still pending.
