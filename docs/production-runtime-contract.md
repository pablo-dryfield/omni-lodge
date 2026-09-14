# OmniLodge Production Runtime Contract

Status: Phase 0 baseline, partially verified on 2026-09-14. This file contains no credentials and does not authorize deployment.

This contract is the handoff between the repository, GitHub Actions, and the production host. It records what is known now, what the release pipeline must preserve, and which root-only facts must still be verified before production can be mutated.

Evidence labels used below:

- **Repository**: derived from checked-in code or package metadata.
- **Host**: observed read-only through the restricted `omnilodge-deploy` account.
- **Operator log**: observed in production output supplied by the owner, but not reconfirmed through PM2 metadata.
- **Root verification required**: inaccessible to the restricted account; a deployment must not infer the value.

## Release and repository controls

| Contract item | Current value |
| --- | --- |
| Canonical repository | `pablo-dryfield/omni-lodge` |
| Permanent source branch | `master` |
| Repository visibility | Public; confirm that this remains intentional before any later visibility change |
| Write/admin access | One current collaborator, the owner, at the Phase 0 audit |
| `master` protection | Pull request required; zero approvals while there is only one collaborator; force pushes and deletion blocked; rules apply to administrators |
| Merge freshness | Target: validate GitHub's prospective merge result and require the branch to be current before merge; no status check is required until the workflow exists |
| Required check | Reserve the stable aggregate name `CI / required`; diagnostic jobs may use `CI / backend`, `CI / ui`, `CI / ui-server`, and `CI / migrations` |
| Branch cleanup | Repository auto-delete is currently off. Enable it before routine CI pull requests begin, then automatically delete ordinary merged topic branches; do not delete `origin/dev-1`, `origin/release-1`, or local `migration/omni-ha-prep` until their unique commits are audited |
| Production environment | `production`, restricted to exact branch `master`, required reviewer configured, administrator bypass disabled |
| Deployment mode | Repository Actions variable `PRODUCTION_DEPLOY_MODE=disabled`; missing or unknown values also mean disabled |
| Workflow permissions | Default token is read-only; Actions cannot approve pull requests; actions must be pinned to full commit SHAs |
| Artifact/log retention | Repository default observed as 90 days; release workflows must set explicit retention rather than rely on a mutable default |
| Production credentials | Not configured in GitHub at this baseline |

The initial release identifier is:

```text
omnilodge-r<GITHUB_RUN_ID>-a<GITHUB_RUN_ATTEMPT>-<first 12 characters of GITHUB_SHA>
```

The manifest always records the full 40-character SHA, run ID, run attempt, workflow identity, repository, event, and ref. The combined archive and detached checksum use the release identifier as their filename stem. A production release is eligible only when it was built by the reviewed release workflow from a successful canonical `push` to `refs/heads/master`.

Validation artifacts may be retained for 14 days. Production release artifacts are retained for 90 days. The server must retain the active release and at least three previous verified releases, so rollback never depends on GitHub artifact retention.

Approval, emergency freeze, and rollback are currently owned by the repository owner. A forward release needs the protected environment gate. An emergency freeze sets `PRODUCTION_DEPLOY_MODE` to `disabled`; rollback remains an explicit manual operation while forward deployment is disabled. A second server-owned automatic-deploy allow flag is not required for the first manual releases and must be reconsidered before removing the environment reviewer.

## Toolchain and package contract

The selected shared toolchain is **Node.js 22.23.2 and npm 10.9.8**. It matches the production binaries observed during Phase 0 and is pinned in `.nvmrc` and every package manifest. The developer shell used for the initial inventory happened to run Node.js 22.14.0/npm 11.17.0; that incidental pair is not an accepted build toolchain.

There are exactly three independently installed npm projects:

| Project | Lockfile | Build output | Canonical validation commands |
| --- | --- | --- | --- |
| Backend | `be/package-lock.json` | `be/dist/**` | `npm ci`; `npm run check`; `npm test -- --runInBand`; `npm run build:prod` |
| Browser UI | `ui/package-lock.json` | `ui/build/**` | `npm ci`; `npm run check`; `CI=true npm test -- --watchAll=false`; `CI=true GENERATE_SOURCEMAP=true REACT_APP_RELEASE=<release-id> REACT_APP_GIT_SHA=<full-sha> npm run build` |
| UI server | `ui-server/package-lock.json` | No compiled output | `npm ci`; `npm test`; `node --check server.js reportingSecurity.js sourceMapArchive.js telemetryPayload.js telemetrySecurity.js utils/logger.js` |

There is no root npm workspace and no root `package.json`. The former empty root `package-lock.json` is not an install input and is removed as part of the reproducibility change. CI must run `npm ci` separately in all three package directories and cache against the matching package-local lockfile.

Backend linting, strict UI artifact validation, a disposable-PostgreSQL migration gate, and the GitHub workflow itself remain Phase 2 work. Do not mark the reserved aggregate check as required until GitHub has observed it from the real workflow.

During the legacy transition, `ui/build` remains tracked and manual UI releases still follow `AGENTS.md`: build locally, commit the exact generated UI artifact, and fast-forward production to that commit. Backend `dist` is never committed. After the artifact deployment and rollback drill succeed, remove `ui/build` from Git in the dedicated cutover cleanup.

## Current production baseline

| Item | Observed baseline | Evidence and constraint |
| --- | --- | --- |
| OS | Ubuntu 20.04.6 LTS, x86_64 | Host |
| Node/npm | `/usr/bin/node` 22.23.2; `/usr/bin/npm` 10.9.8 | Host |
| Checkout | `/root/omni-lodge` | Host process arguments; directory contents require root verification |
| Service owner | Root owns the PM2 daemon and both application processes | Host |
| PM2 | `/usr/bin/pm2`, daemon version 5.3.1 | Host |
| Deployment account | `omnilodge-deploy`; key authentication works; password is locked; no passwordless sudo | Host; keep unprivileged until a root-owned validated deploy command exists |
| Backend process | One active runtime under `/root/omni-lodge/be`, launched through `npm run start:prod` and `scripts/startMonitored.js dist/app.js` | Host |
| Backend PM2 name | `omni-lodge-be` | Operator log; current `pm2 describe` still requires root verification |
| UI process | One active `node /root/omni-lodge/ui-server/server.js` process | Host |
| UI PM2 name | Unknown | Root verification required |
| PM2 execution metadata | A single instance is observed, but exact `exec_mode`, configured cwd, startup command, restart policy, and saved dump are unknown | Root verification required; target must be one fork-mode backend instance because it also starts scheduled jobs |
| Backend listener | `127.0.0.1:3001` | Host and repository |
| Public UI/TLS listener | `0.0.0.0:443` | Host and repository |
| Development UI-server listener | `0.0.0.0:3005` unless `UI_SERVER_PORT` overrides it | Repository; not a production listener |
| PostgreSQL | PostgreSQL 16, loopback `127.0.0.1/[::1]:5432` | Host; database name, role, and migration state are private/root-only |
| Target release directories | `/opt/omnilodge`, `/etc/omnilodge`, and `/var/lib/omnilodge` do not exist at this baseline | Host; create only in Phase 3 |

The current backend start script compiles before every production start. The current UI server runs directly from the checkout. These are baseline facts, not the target: artifact deployment must use runtime-only commands and immutable release directories.

## Runtime paths and mutable state

| Concern | Current code/default | Production state |
| --- | --- | --- |
| Backend environment | `be/.env.prod`, resolved relative to the backend working directory when `NODE_ENV=production` | Existence, ownership, and effective PM2 environment require root verification; never print its contents |
| UI build | `ui-server/../ui/build`, therefore checkout-relative today | Active path follows the checkout; replace with `UI_BUILD_PATH` before release-directory cutover |
| TLS key/certificate | `be/src/ssl/cf-origin.key` and `be/src/ssl/cf-origin.pem`, read by the UI server from the checkout | Current files are tracked and unsafe; ownership requires root verification. Add configurable paths, install rotated server-owned material, verify it, then revoke/untrack the old material |
| Backend logs | Winston writes `error.log` and `combined.log` relative to the backend cwd, plus PM2 stdout/stderr | Exact active files, rotation, retention, and ownership require root verification |
| UI-server logs | Winston writes `error.log` and `combined.log` relative to the UI-server cwd, plus PM2 stdout/stderr | Exact cwd/files, rotation, retention, and ownership require root verification |
| Backend error spool | `ERROR_MONITORING_SPOOL_PATH`, otherwise `runtime/error-monitoring/failed-events.ndjson` below the backend cwd | Effective path and retained segments require root verification |
| UI-server error spool | `UI_SERVER_TELEMETRY_SPOOL_PATH`, otherwise `runtime/error-monitoring/ui-server-errors-443.json` below the repository at the current layout | Effective path and ownership require root verification |
| Private browser source maps | `ERROR_MONITORING_SOURCE_MAP_DIR`, otherwise `runtime/error-monitoring/source-maps` below the repository at the current UI-server layout | Effective archive and retention require root verification; public `.map` access must remain denied |
| Night-report images | Config key `NIGHT_REPORT_UPLOAD_DIR`; fallback `be/uploads/night-reports` | Effective local/Drive storage choice and local contents require root/config verification |
| Profile photos | Config key `PROFILE_PHOTO_UPLOAD_DIR`; fallback `be/uploads/profile-photos` | Effective local/Drive storage choice and local contents require root/config verification |
| Social-media compatibility upload | Temporary file in the OS temp directory; current large-file flow uploads resumably to Drive | Temp data is not a release asset; Drive configuration is server runtime configuration |
| Database backup uploads/restores | Temporary files use the OS temp directory | Temp data is not a release asset and must be cleaned after use |

No runtime secret, `.env` file, TLS material, upload, log, telemetry spool, source-map archive, backup, or temporary upload may enter a release artifact.

## Database migrations and backups

- The migration source is `be/src/migrations/*.ts`; production executes compiled `be/dist/migrations/*.js` through `dist/scripts/runMigrations.js`.
- Umzug records applied migrations in `sequelize_meta`; the application also records runs and steps in `migration_audit_runs` and `migration_audit_steps`.
- The legacy `npm run migrate:prod` compiles and enables access-control seeding before executing the runner. Artifact deployment must instead call the already-compiled `npm run migrate:runtime` exactly once.
- `MIGRATION_VERIFY_STRICT` is supported, but its effective production value and the exact applied/pending migration list require root/database verification.
- The configured defaults are `/home/postgres/backup.sh` and `/home/postgres/backups`. Both currently exist and are root-owned; the script is executable.
- Backup storage may be `local` or `drive`, controlled by application configuration. The effective mode, script contents, most recent successful backup, restore test, and generated-file naming require root/config verification.
- The backend registers its backup schedule from `DB_BACKUP_CRON` and `DB_BACKUP_TZ` (defaults `0 6 * * *`, UTC). Effective production values require config verification.

Before a deployment runs a pending migration, the root-owned deployment command must invoke the verified backup command and prove that it created a new non-empty backup with a recorded checksum. An exit code alone is not sufficient. Application rollback never runs migration `down` automatically.

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

## Public smoke-test contract

The 2026-09-14 baseline returned `200` for the main homepage, the proxied health route, both companion domains, and the main manifest. A JavaScript source-map request derived from the current asset manifest returned `404`. Never hard-code the current hashed asset filename; derive it from the candidate release's `asset-manifest.json`.

| Surface | Required check |
| --- | --- |
| Main UI | `GET https://omni-lodge.com/` returns `200` HTML and references the candidate release's hashed assets |
| Legacy API health | `GET https://omni-lodge.com/api/health` returns `200` JSON with `status`, `ready`, and `uptimeSeconds`; this remains a compatibility liveness response and must not gate deployment |
| API liveness | `GET https://omni-lodge.com/api/health/live` returns `200` with process uptime and sanitized release ID/Git SHA matching the candidate release |
| API readiness | Poll `GET https://omni-lodge.com/api/health/ready`; require `200`, `ready: true`, successful required-configuration and database checks, and the expected release ID/full Git SHA. The endpoint is implemented in the repository but is not part of the 2026-09-14 production baseline until deployed |
| Main PWA | `GET https://omni-lodge.com/manifest.json` and `/service-worker.js` return `200`; manifest/service-worker release metadata must match the release |
| Transaction companion | `GET https://transaction.omni-lodge.com/` and `/finance/new-transaction/install.html` return `200`; `/finance/new-transaction/new-transaction.webmanifest` is valid |
| Counter companion | `GET https://counter.omni-lodge.com/` and `/counters/new-counter/install.html` return `200`; `/counters/new-counter/new-counter.webmanifest` is valid |
| Hashed assets | Resolve the main JavaScript path from `asset-manifest.json`; require `200`, the expected checksum, and immutable cache headers |
| Source-map denial | Append `.map` to a real shipped JavaScript asset and require `404` plus `Cache-Control: no-store`; test encoded `.map` variants as well |
| API failure behavior | A temporary private-port UI-server preflight must return controlled JSON `502` for an unavailable backend, never an HTML error masquerading as API JSON |

The UI proxy is configured with WebSocket upgrade support for `/api`, but the repository defines no application WebSocket endpoint. Phase 0 therefore records **no WebSocket smoke route**. Add a route-specific handshake check only when an actual WebSocket consumer is introduced; do not invent a passing URL.

The readiness endpoint does not yet inspect pending migrations or verified artifact state. Those remain deployment preflight gates and must be added to readiness only when they can be checked without mutating the database.

## Root-only verification gate

Before Phase 3 mutates the host, a root operator must capture a redacted inventory containing:

1. `pm2 describe`/`pm2 jlist` metadata for both real processes: exact names, IDs, fork/cluster mode, instance count, cwd, interpreter, script/arguments, restart policy, log paths, and saved startup configuration.
2. Ownership and permissions (not contents) for `.env.prod`, current TLS files, uploads, logs, telemetry spools, private source maps, and backups.
3. Effective storage path keys and backup schedule/mode without printing credentials.
4. `sequelize_meta` applied/pending migrations and the latest migration-audit result without dumping application data.
5. A fresh non-empty backup, checksum, and a separately documented restore-test result.
6. Current Git SHA/status and a recoverable snapshot of PM2 configuration and the live UI build before cutover.

Until all six are reviewed, Phase 0 remains **partial** and `PRODUCTION_DEPLOY_MODE` remains `disabled`.
