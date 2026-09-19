# Production Phase 0 Evidence — 2026-09-16

This document records the sanitized evidence collected for the OmniLodge production baseline before artifact-based deployment. It contains no credentials, secret values, TLS material, customer data, backup filename, or database name. It does not authorize a production deployment.

## Outcome

Phase 0 inventory, backup validation, full restore, and production-shaped migration compatibility checks are complete. No application code was deployed, no process was restarted, no database schema was changed in production, and no TLS material was replaced.

`PRODUCTION_DEPLOY_MODE` remained `disabled` throughout this work.

## Production baseline

- Host: Ubuntu 20.04.6 LTS, x86_64.
- Checkout: `/root/omni-lodge`, branch `master`, commit `f27d2f32e54c2d806719f706feb10d26bbb91a47` at the time of inventory.
- Runtime toolchain: `/usr/bin/node` 22.23.2 and `/usr/bin/npm` 10.9.8.
- PM2 is managed by the enabled and active root systemd unit `pm2-root`.
- The live PM2 definitions and saved `/root/.pm2/dump.pm2` definitions matched after normalization.
- Backend: `omni-lodge-be`, PM2 id 1, one fork-mode instance, autorestart enabled, watch disabled, cwd `/root/omni-lodge/be`, launched through `/usr/bin/npm run start:prod`.
- UI server: `omni-lodge-ui-server`, PM2 id 0, one fork-mode instance, autorestart enabled, watch disabled, cwd `/root/omni-lodge/ui-server`, launched from `/root/omni-lodge/ui-server/server.js`.
- PostgreSQL 16.8 listens only on loopback port 5432.
- The backend listens on `127.0.0.1:3001`; the UI server listens on `0.0.0.0:443`.
- The legacy `/api/health` route and public UI returned HTTP 200. The branch's new `/api/health/live` and `/api/health/ready` routes correctly remain absent from the unmodified legacy production release.

## Repository and recoverability

- The checked-in production UI build contained 750 tracked files and 750 filesystem files. It matched production `HEAD` and is recoverable from Git.
- The UI build tree SHA-256 was `40c32699b304cbab51a7508e27d6340c4b0b1907b7d3c385118f0ee8a1cbe2d2`.
- One unexplained root-owned untracked text file was found without reading or logging its contents. It was moved recoverably to a root-only quarantine outside the checkout, mode 600. The production checkout is clean after quarantine.
- The current checkout and saved PM2 dump remain the legacy rollback fallback until the artifact cutover and rollback drill succeed.

## Runtime data and permissions

The following permissions were narrowed without restarting the application:

- Backend production environment file: mode 600.
- Existing Cloudflare Origin private-key file: mode 600.
- PM2 saved dump: mode 600.
- Backend and UI application log files: mode 600.
- Server backup script and backup directory: mode 700.
- Newly generated backup archive: mode 600.

Observed mutable storage at inventory time:

- Error-monitoring runtime tree: approximately 301 MB and 2,410 files; private source-map directories were mode 700.
- Local upload tree: approximately 8.5 MB and 10 files.

Secret values and private material were never printed or copied into this document.

## TLS accepted-risk exception

The existing Cloudflare Origin certificate and private key matched, and the certificate was valid through September 2040. The repository is public and the private key exists in Git history, so the key must be treated as exposed even though its permissions are now restricted on the host.

On 2026-09-16 the owner explicitly directed the project to retain this existing pair and not rotate or revoke it. This is an accepted-risk exception, not a claim that the key is secure.

Before artifact deployment, the retained pair must be copied to a root-owned server path outside the repository and release artifacts, such as `/etc/omnilodge/tls`, with restrictive permissions. Production must use explicit `UI_TLS_KEY_PATH` and `UI_TLS_CERT_PATH` values, strict TLS must be verified, and the certificate/key must be removed from the Git tip. Rotation and historical cleanup remain recommended deferred hardening.

## Database and backup evidence

At inventory time, production contained:

- 185 applied migrations.
- 0 migrations pending against the deployed production checkout/source tree; the pull-request branch added four migrations afterward.
- 0 migration records unknown to the production source tree.
- A successful latest migration audit with no reported error.
- `SKIP_DB_SYNC=true`, `SEED_ACCESS_CONTROL=false`, and `DB_SYNC_ALTER=false` in the effective PM2 environment.

Effective backup configuration was verified as:

- Storage mode: Drive.
- Schedule: `0 6 * * *` in UTC.
- Server script: `/home/postgres/backup.sh`.
- Local staging directory: `/home/postgres/backups`.
- Successful scheduled backup runs were observed for September 13–16, 2026.

A new production backup was then created and validated:

- Size: 966,676,562 bytes.
- SHA-256: `5e0d7dff0e98b274b11715ccb097ba6c167dee038b0f52a0b76d594234697722`.
- `pg_restore --list` completed successfully.

The archive was streamed through a one-time FIFO over the restricted deployment account and fully restored into an isolated local PostgreSQL 17.5 database. This validates the production schema and data shape; the separate PostgreSQL 16.10 CI gate remains the runtime-version proof. The FIFO and its temporary directory self-cleaned. The restored database contained:

- 165 public base tables.
- 185 applied production migrations.
- Database size 2,289,691,795 bytes.

Using the exact pinned Node.js 22.23.2/npm 10.9.8 branch toolchain:

1. The backend typecheck and compilation succeeded.
2. The four branch migrations missing from the production baseline applied successfully.
3. The second migration execution applied zero steps.
4. The compiled and applied inventories matched exactly: 189 expected, 189 applied, 0 missing, 0 unexpected.
5. Both new migration audit runs succeeded; the first recorded four successful steps and the second zero.
6. All 159 compiled Sequelize models successfully queried their mapped restored tables.

The disposable local restore database was then dropped and confirmed absent. Production data and schema were not changed by this proof.

## Capacity observation

The production host had approximately 6.3 GB free before creating the approximately 967 MB backup. A restored copy occupied approximately 2.29 GB locally. The Phase 3 deploy command therefore needs a fail-closed free-space preflight covering the candidate release, dependency layer, a newly verified backup, temporary extraction, and retained releases before it downloads or migrates anything.

## Post-check

After permission hardening and quarantine:

- `omni-lodge-be` remained online.
- `omni-lodge-ui-server` remained online.
- Local backend health returned HTTP 200.
- Public proxied health returned HTTP 200.
- The public UI returned HTTP 200.

Phase 0 is complete. Phase 3 host preparation, the first trusted `master` release, dry run, controlled cutover, and rollback drill remain incomplete.
