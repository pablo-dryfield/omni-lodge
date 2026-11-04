# Database Workspace operations and recovery

This runbook accompanies the complete Database Workspace release. It is not a record of production activation. Use the immutable GitHub Actions release/control plane; do not build on the production host or replace live release directories manually.

## Verified topology and prerequisites

Production discovery on 3 November 2026 was read-only: PostgreSQL 16.8, an application login with superuser privileges, approximately 2.69 GB application data, a 2 GB RAM host and approximately 4.1 GB free disk. The application backup was approximately 988 MB. The implementation uses separate restricted execution identities and an independent control database; it never uses the application pool for workspace SQL.

Local integration runs use PostgreSQL 17. CI covers PostgreSQL 16 and 17. The Linux worker rehearsal must pass on a Linux/systemd runner: it verifies the actual cgroup memory/CPU/task limits, external Buffer memory enforcement and exact-parent lifetime. A Windows skip is not evidence that these Linux checks passed.

Before activation, require:

- All feature/acceptance gates in `sql-helper-postgresql-workbench-plan.md`, relevant repository checks and release builds.
- Reviewed target/schema/protected-object scope and PostgreSQL role grants, including PUBLIC grants, invoker views, callable security-definer routines and extension capabilities.
- A private control database and retained encryption key independent of an application restore. The initial same-cluster control database survives an application-database restore; it does not survive loss/restoration of the whole PostgreSQL cluster by itself.
- Trusted PostgreSQL client tools matching the destination server major. Never use a newer archive with an older restore server.
- Space for application backups, control backups, encrypted artifacts, temporary archive copies, the restored database and normal application growth. Logical archive size is not restored database size.

## Coordinated first activation

Infrastructure/bootstrap secrets remain in the root-owned mode 0600 `/etc/omnilodge/backend.env`. `DB_WORKSPACE_CONTROL_URL` is a bootstrap exception: it must be available when the application database is unavailable. `CONFIG_ENCRYPTION_KEY` is also required independently. Neither value belongs in source, workflow output, shell arguments, screenshots or this runbook.

The production bootstrap entry point defaults to a read-only plan. It only runs as root, with `NODE_ENV=production`, from an immutable backend directory matching `/opt/omnilodge/releases/omnilodge-…/be`. A trusted operator/control-plane step may invoke:

```sh
node --env-file=/etc/omnilodge/backend.env dist/scripts/provisionDatabaseWorkspaceRuntime.js
```

After reviewing that plan, apply from the same trusted release context using the exact application database confirmation:

```sh
node --env-file=/etc/omnilodge/backend.env dist/scripts/provisionDatabaseWorkspaceRuntime.js \
  --apply --confirm-database=omni_lodge_db --manage-unprotected-ownership \
  --restrict-unsafe-public-functions
```

The ownership option is a substantive schema-administration change. PostgreSQL 16 maintenance needs ownership for several supported operations because that version has no MAINTAIN privilege. It moves eligible, unprotected relations into a dedicated nonsuperuser NOLOGIN owner group; it never grants the application superuser role to an ordinary workspace identity. Explicit application grants are retained. Review dependent views and sequences, and rehearse this option before production use.

The PUBLIC-function option is also substantive: it retains explicit execution grants for the original application role, then revokes PUBLIC execution on network-capable extension routines and application security-definer routines in the registered schemas. Existing named grants remain. Discovery found dblink installed with PUBLIC execution. Without this restriction, dedicated nonsuperuser roles would still inherit dangerous capabilities; provisioning and runtime identity checks fail closed. Review the printed routine addresses before applying. The application superuser retains its existing access.

Provisioning creates separate read, write, maintenance, restore, role-administration and control identities, SCRAM verifiers, encrypted Control Panel credentials and the independent control database. It initializes the control store and leaves admission disabled. It refuses implicit adoption or credential rotation if the bootstrap URL is already present. Preserve a partial failure for investigation rather than blindly rerunning it. Reload the protected environment through the release control plane, then enable `DB_WORKSPACE_ENABLED` in Control Panel and verify restricted execution and the current worker heartbeat. Enabling admission before the primary process has loaded its bootstrap URL would unnecessarily fail readiness.

The release control plane must load the updated protected environment when activating the backend. Candidate/dry-run readiness does not start primary workers. The primary production backend supervises a transient systemd worker using the compiled script from that same release. Public UI activation follows primary readiness, including a heartbeat bound to the new backend PID and Linux start time. An old-release heartbeat cannot satisfy this check.

Initial conservative host budgets are a 512 MiB worker memory ceiling, 50% CPU and one active ordinary job per target. Set operating values through Settings / Control Panel. Observe application latency, PostgreSQL temporary space and host memory before increasing them. A PostgreSQL work_mem setting is not a total database memory ceiling.

## Configuration and emergency stop

Use the existing Control Panel Database Workspace category for targets, encrypted credentials, feature switches, capacity, timeouts, retention, import/export limits and schedules. New jobs use a validated policy snapshot; changing policy invalidates previous reviews and captured-result authority where applicable. Resource/path changes drain and restart the worker. Do not create a second settings store.

`DB_WORKSPACE_ENABLED=false` stops new admission. Existing work retains its observed outcome; it is not a promise that a running write was rolled back. Use exact-session cancellation and the durable job status. Never resubmit an uncertain write simply because its HTTP request failed.

`DB_WORKSPACE_EXTERNAL_WORKER` is an infrastructure supervisor selector. An external production worker still needs enforced cgroup limits, the exact release/environment, and the current primary backend PID/start identity; otherwise readiness must fail. The default managed transient service is preferred.

Readiness/status checks:

- `/api/health/live` checks process liveness; `/api/health/ready` includes primary workspace worker readiness when enabled.
- Workspace capabilities report target identity, control-store capacity and worker availability. Unavailable statistics/extensions must have reasons rather than fabricated zero values.
- Inspect systemd unit state for startup/resource failures. SQL/results/credentials are not emitted to the general application error tracker. Exact SQL and detailed outcomes remain encrypted in the control store.

## Server and Google Drive backups

A migration-bearing deployment runs the existing host backup gate, which creates a **server archive**. That gate does not upload to Google Drive. The application backup job later synchronizes local archives to Drive according to the configured copy policy.

Control Panel / Backups supports:

- `DB_BACKUP_STORAGE=local`, `drive` or `both`.
- `DB_BACKUP_KEEP_LOCAL_COPY=true` to retain a verified server archive in Drive mode. Both mode always retains it, even if a sync caller asks to remove uploaded files.
- `DB_BACKUP_WORKSPACE_CONTROL_ENABLED=true` to capture the independent journal as a separate `workspace-control-….backup` archive whenever the application backup script runs and its loopback control connection is configured.
- `PG_DUMP_BIN` and `DB_BACKUP_COMMAND_TIMEOUT_MS` for the trusted control dump client and backup command deadline. These settings do not change the external deployment backup script by themselves.

Application and control archives share the existing server/Drive storage integration; they are separate files with separate restore scopes. Before a control-store upgrade, the coordinated release/operator procedure must explicitly capture a fresh control backup as well as the application backup; the legacy deployment shell gate alone does not provide that second archive.

The workspace inventory lists server and Drive copies independently. IDs bind `local:<filename>` or `drive:<fileId>`; matching filenames do not prove identical contents. Listing Drive does not create folders. A Drive upload or existing same-name copy must match size and SHA-256 before the server file can be removed.

Deletion is reviewed, audited and location-specific. Server deletion does not delete Drive copies. Drive deletion moves the exact selected file to trash by default; permanent removal requires its explicit reviewed option. A changed file/fingerprint must be reviewed again. No production backup is deleted merely by installing this release.

Downloads require current backup and export permissions. Large files stream to disk through supported desktop browser file APIs; browsers without those APIs have a 32 MiB memory fallback limit. Long downloads recheck authority and respect the configurable export timeout.

Keeping both copies can fill the current small server quickly. Review independent server-script/Drive retention and actual free space before enabling it. The existing server script's optional seven-day cleanup was commented out at discovery. Artifact/history cleanup is not backup retention. Do not assume retention or PITR coverage from a daily logical dump.

## Isolated restore and offline operator recovery

The workspace restores trusted custom archives into a **new private database**, preserving the application/source database. It validates copy identity, checksum, authenticated encryption, archive/client/server versions, dedicated nonsuperuser CREATEDB identity and free space. It does not run Sequelize sync, seed permissions, adopt migrations or cut application traffic over afterward.

The default capacity allowance includes archive copies, six times archive size for expansion and a free-space floor. The discovered production disk cannot safely stage/restore its approximately 988 MB archive under this policy. Production restore remains disabled until a larger/isolated volume or target has sufficient measured capacity and the full drill passes. Do not lower the allowance merely to bypass a real disk shortage.

Before an outage, prepare and review the exact queued restore job and destination while the control store, backup and key are available. For an unavailable application database, the trusted independent entry point is:

```sh
node --env-file=/etc/omnilodge/backend.env dist/scripts/offlineDatabaseRecovery.js \
  --job REVIEWED_QUEUED_JOB_UUID \
  --confirm-destination omnilodge_restore_YYYYMMDD_HEX8 \
  --reason 'Recorded operator recovery reason' --execute
```

Use the exact server-generated destination, not the illustrative placeholder. This command accepts only a previously reviewed, unstarted queued restore, claims/fences it in the independent store and refuses running/uncertain/completed replays. It requires neither application authentication tables nor Sequelize. Its output contains job/outcome/destination metadata, not credentials. A disposable process-level rehearsal verifies this path with an unavailable application database name.

Cancellation/failure can leave a private partial destination. Inspect the recorded outcome and PostgreSQL sessions before removing it through a separately reviewed operator action. An acknowledgement lost around a commit is **unknown**, not automatically failed or retried. Orphan reconciliation uses the recorded backend incarnation and restore application name; temporary decrypted files are cleaned only after the old process/session is proven gone.

Application production cutover, full-cluster restore, remote-control-store backup and WAL/PITR are infrastructure procedures, not ordinary query-tab buttons. They require their own verified capacity, service coordination, fresh recovery point and rollback procedure.

## Control journal, keys and retention

Control archives contain encrypted SQL, parameter values, results metadata and audit history. Protect their downloads like application backups. Back up the required encryption key separately through the existing secret-management/escrow process; an encrypted database archive alone cannot recover it. The same-cluster journal also needs off-host copies to survive host loss.

Do not replace `CONFIG_ENCRYPTION_KEY` in place. A key change requires stopping new work, draining jobs/sessions, backing up both stores, retaining the old protected key, re-encrypting configuration/history/control documents and staged artifacts under a tested operator procedure, and rehearsing recovery before retiring old key material. This release does not offer a one-click global key rotation.

Artifact/history/audit retention is configurable and removes only eligible expired workspace records/files. Physical PostgreSQL database allocation may remain after deletion; admission uses physical allocated size and reserves capacity for terminal outcomes. Review bloat/vacuum/storage expansion rather than deleting active audit rows to regain admission.

## Rollback

Use immutable release rollback through GitHub Actions/host control. Stop/drain the current worker; verify no orphan still owns an execution slot. Preserve the independent journal, artifacts and key when changing application releases. A code rollback does not undo committed SQL, payouts, imports or schema changes.

Keep SQL Helper access disabled if rolling back to a version with the old unrestricted executor. The retired SQL Helper execute route and application-pool Performance Explain route must not become alternative execution paths. Review recorded drift and commit a repository migration for emergency schema changes; never edit migration tracking to imply an unexecuted migration ran.
