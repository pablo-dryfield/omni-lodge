# OmniLodge GitHub Actions Release Roadmap

Status: planning only; this pipeline is not active yet.

Baseline when this plan was written: `080fa5db5e568c7f005f60c7b8aa39eaf8272c1d`

## Objective

Build and test the UI and backend in GitHub Actions, create one immutable and verifiable release, and deploy that exact release without compiling application code on the production server.

The production server should only:

1. Receive and verify a release.
2. Install Linux runtime dependencies when a lockfile changes.
3. Run database migrations from the compiled backend.
4. Activate the backend and UI in a controlled order.
5. Run health checks and roll back application code if activation fails.

## Rules that remain in force during the migration

- Do not build the UI on production.
- Keep committing `ui/build` until the user explicitly changes the repository instruction.
- Never commit backend `dist`.
- Never put production application secrets, database credentials, TLS private keys, uploads, logs, or runtime data in a GitHub Actions artifact.
- Keep the existing deployment method available until the first artifact-based production deployment has passed all acceptance checks.

## Important security prerequisite

`be/src/ssl/cf-origin.key` is currently tracked in Git, and the UI server reads the key and certificate from the source tree. The key must not be copied into release artifacts.

Before automated deployment is enabled:

1. Add explicit runtime settings such as `UI_TLS_KEY_PATH` and `UI_TLS_CERT_PATH`.
2. Store the certificate and key outside the repository, preferably under `/etc/omnilodge/tls`, readable only by the service account.
3. Create and install a new Cloudflare Origin CA certificate and key.
4. Restart and verify the origin with the new certificate while Cloudflare remains in strict TLS mode.
5. Revoke the old Origin CA certificate only after the new certificate works. Revocation is irreversible.
6. Remove the key and certificate from Git tracking and add their paths to `.gitignore`.
7. Consider a later Git-history cleanup. Rotating the key is the urgent protection; history rewriting must be planned because it affects every clone.

## Target release architecture

```text
Source commit on master
        |
        v
GitHub Actions (Node 22 + pinned npm)
        |
        +-- Backend: install -> check -> tests -> compile
        +-- UI: install -> check -> tests -> build
        +-- UI server: install -> tests -> syntax checks
        |
        v
Release manifest + SHA-256 checksums
        |
        v
Immutable combined release artifact
        |
        v
Protected production deployment job
        |
        v
Verify -> stage -> migrate -> backend restart -> API health
                              -> UI restart -> public smoke tests
```

The backend and UI must share one stable release identifier. The browser release, UI-server release, backend `APP_VERSION`, and recorded Git SHA must all identify the same release.

## GitHub Actions workflow design

### Triggers

- Pull requests: build and test only.
- Pushes to `master`: build, test, and publish immutable artifacts.
- Production deployment: manual `workflow_dispatch` initially.
- Optional automatic production deployment can be enabled only after several successful manual releases.
- Use a production concurrency group so only one deployment can run at a time.

### Permissions

- Default workflow token permission: `contents: read`.
- Grant `contents: write` only to the job responsible for the required UI build commit.
- The production deployment job alone receives production environment secrets.
- Pin official GitHub actions to reviewed immutable commit SHAs, not floating branches.

### Parallel validation jobs

#### Backend

1. Use the exact Node 22 and npm 10 versions selected for production.
2. Run `npm ci` from `be`.
3. Run `npm run check`.
4. Run the backend test suite in a memory-safe mode.
5. Run `npm run build:prod` once.
6. Verify the compiled monitoring models.
7. Upload the compiled output for the packaging job.

Add a PostgreSQL Actions service later for migration and integration tests. Unit tests that require external production integrations must use mocks and must never receive production secrets.

#### UI

1. Run `npm ci` from `ui`.
2. Run `npm run check`.
3. Run the UI test suite with CI/watch mode disabled.
4. Build with a stable `REACT_APP_RELEASE` and the required source-map setting.
5. Validate `asset-manifest.json`, `index.html`, service worker assets, lazy chunks, and source-map coverage.
6. Upload the UI output for packaging.

No value prefixed with `REACT_APP_` may contain a secret because those values are public in the browser bundle.

#### UI server

1. Run `npm ci` from `ui-server`.
2. Run all Node tests.
3. Run `node --check` on the server and its helper modules.
4. Verify that a missing or inconsistent UI artifact causes preflight validation to fail.

### Required UI build commit

The current project rule requires `ui/build` to be committed. The first implementation must therefore use an Actions-generated release commit:

1. Build and validate the UI in Actions.
2. Confirm that the workflow started from the current remote `master`; abort if `master` advanced while building.
3. Stage only `ui/build`.
4. Refuse to commit if any file outside `ui/build` is staged.
5. Create a clearly marked generated commit and push it with no force-push.
6. Prevent workflow recursion for commits that change only `ui/build`.
7. Record both the source SHA and generated release-commit SHA in the manifest.

If branch protection prevents the generated commit, create a bot pull request containing only `ui/build` and require it to be merged before packaging/deployment.

Long-term cleaner option: after explicit user approval changes the current instruction, stop tracking `ui/build` and use the immutable Actions artifact as the sole UI build source. Do not make that switch during the first rollout.

## Required application changes

### Backend scripts

Separate compilation from execution:

- `build:prod`: compile and verify only.
- `start:runtime`: start `scripts/startMonitored.js dist/app.js` without compiling.
- `migrate:runtime`: run the compiled migration runner without compiling.
- `sync-access-control:runtime`: run the compiled sync script without compiling.
- Remove the TypeScript compile from `postinstall`.

Keep `scripts/startMonitored.js`; starting `dist/app.js` directly would lose monitoring of early import/startup failures.

Move TypeScript, build tools, and type-only packages to development dependencies where safe. Do this in a separate reviewed dependency commit.

### Backend readiness

Add a local readiness endpoint that verifies:

- The HTTP process is accepting requests.
- The database responds to a lightweight query.
- Required runtime configuration is loaded.
- The running release ID and Git SHA match the expected release.
- Startup migrations are not pending, if that check can be performed safely.

Keep the existing lightweight liveness check separate from database readiness.

### UI server

Add environment-configurable paths:

- `UI_BUILD_PATH`
- `UI_TLS_KEY_PATH`
- `UI_TLS_CERT_PATH`
- Existing private source-map and telemetry paths must point to persistent storage.

Add a local UI-server health endpoint that reports the release ID and artifact-validation status without exposing secrets.

UI preflight must fail before listening when the index, manifest, referenced hashed assets, service worker, or expected release metadata is missing or inconsistent.

### Persistent files

Move all mutable data outside immutable releases:

- Backend `.env.prod`
- TLS certificate and key
- Uploads and generated files
- Application logs
- Error-monitoring spool
- Private browser source-map archive
- Heap snapshots and other diagnostics

Use explicit absolute paths or carefully verified symlinks.

### Maintenance UI

The current maintenance actions perform `git pull` and build-on-server commands. After cutover:

- Remove or disable the live build/pull actions.
- Replace them with read-only release status, current/previous release information, and links to the GitHub Actions run.
- If a deploy trigger is later added to the UI, require strong reauthentication, authorization, auditing, rate limiting, and an explicit release selection.

## Combined release artifact

Create one compressed tar archive with a root directory containing:

```text
release-manifest.json
be/
  dist/**
  scripts/startMonitored.js
  package.json
  package-lock.json
ui/
  build/**
  public/assets/badges/ktk-guide-badge.svg
  public/assets/badges/ktk-media-badge.svg
  public/assets/badges/ktk-backside-badge.png
ui-server/
  runtime JavaScript files
  utils/**
  package.json
  package-lock.json
```

Do not include backend source, `.env*`, TLS material, logs, uploads, runtime directories, or Windows `node_modules`.

The manifest must contain:

- Schema version.
- Source SHA and UI release-commit SHA.
- Stable release ID.
- UTC build timestamp.
- Node and npm versions.
- Backend, UI, and UI-server lockfile hashes.
- Main UI hashed asset path.
- File count and SHA-256 for every shipped file.
- Workflow run ID and repository identity.

Upload the tar archive and its SHA-256 checksum as an immutable GitHub Actions artifact. Retain enough workflow artifacts for audit, while production retains its own previous releases for rollback.

## Production filesystem layout

Recommended target:

```text
/opt/omnilodge/
  incoming/
  releases/<release-id>/
  dependencies/backend/<lock-hash>/
  dependencies/ui-server/<lock-hash>/
  backend-current -> releases/<release-id>/be
  ui-current -> releases/<release-id>
  previous-backend -> ...
  previous-ui -> ...

/etc/omnilodge/
  backend.env
  ui-server.env
  tls/origin.key
  tls/origin.pem

/var/lib/omnilodge/
  uploads/
  runtime/
  logs/
  source-maps/
```

Use separate backend and UI pointers so the backend can be activated and verified before exposing a UI that depends on it.

## Runtime dependencies

Do not copy `node_modules` from Windows.

On production, create immutable dependency directories keyed by the corresponding lockfile hash. Run `npm ci --omit=dev` only when a new hash appears, while the old release remains online. Then link the staged release to that dependency directory.

Required smoke checks include:

- Import and perform a harmless `sharp` operation.
- Confirm Puppeteer's browser and required Linux libraries are available.
- Import the compiled backend entry without starting duplicate scheduled work, or add a dedicated preflight command.
- Import/start the UI server on a temporary non-public port using the staged UI build.

Retain dependency directories used by the current and previous releases.

## Production deployment algorithm

The deploy script must:

1. Acquire an exclusive `flock`; abort if another deployment is active.
2. Validate the requested release ID and source SHA.
3. Accept uploads only in a fixed incoming directory.
4. Verify the outer SHA-256 checksum before extraction.
5. Reject absolute paths, `..` traversal, symlinks escaping the release, unexpected owners, and unexpected artifact contents.
6. Extract to a new temporary release directory.
7. Validate every manifest file and checksum.
8. Confirm Node/npm compatibility and prepare lock-hash dependency directories.
9. Attach server-owned environment, uploads, logs, runtime, TLS, and source-map locations.
10. Run all preflight checks.
11. Determine whether migrations are pending and take a verified database backup before any schema change.
12. Run the compiled migration command once.
13. Save the current backend pointer as the previous backend.
14. Atomically switch the backend pointer and restart the single PM2 backend process in fork mode.
15. Poll local readiness and require the expected release ID.
16. If backend readiness fails, restore the previous backend pointer and restart it.
17. Save and switch the UI pointer only after backend success.
18. Restart the UI server with the matching release ID.
19. Verify the public homepage, manifest, main hashed asset, API health, and public source-map denial.
20. If UI verification fails, restore the previous UI pointer without rolling back the healthy backend unless compatibility requires both to roll back.
21. Persist the PM2 process list and write an auditable deployment record.
22. Keep the current and at least three previous releases; prune only releases not referenced by current/previous pointers.

Do not automatically run migration `down` during application rollback. Database migrations must use an expand/contract approach so both the old and new application versions remain compatible during rollback.

## Backend process limitation

The backend process also starts scheduled/background jobs. Do not use PM2 cluster mode or briefly run old and new backend processes concurrently because jobs could execute twice.

The first pipeline should use a short fork-mode restart after all expensive work has completed. True zero-downtime API deployment requires a later separation of the HTTP API and background worker, plus database/distributed locks for scheduled jobs.

## GitHub production environment

Create a `production` environment and configure, at minimum:

- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_PORT`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`

Use a dedicated deployment user and an Ed25519 key, not a password. The user should have only the filesystem permissions it needs and passwordless sudo access to one root-owned, validated deploy command if PM2 still runs under root.

Keep database, JWT, encryption, integration, Cloudflare Origin CA, and application-monitoring secrets only on the server/control panel. They are runtime secrets and are not GitHub build inputs.

Initially require a manual workflow dispatch. Add environment approval and branch restrictions when supported by the repository's GitHub plan.

## Phased implementation

### Phase 1: Reproducible builds

- Pin exact Node 22 and npm 10 versions.
- Add engine/package-manager metadata to all three packages.
- Split backend build/runtime scripts and remove compile-on-install.
- Add tests for the runtime-only commands.
- Add configurable UI build/TLS paths and strict UI artifact validation.
- Add release-aware liveness/readiness endpoints.

Exit condition: local tests pass and starting an already-built backend performs no compilation.

### Phase 2: CI without deployment

- Add parallel backend, UI, and UI-server jobs.
- Add dependency caching keyed by each lockfile.
- Generate the required UI build commit safely.
- Generate and validate the combined release artifact and manifest.
- Upload the artifact; do not contact production.

Exit condition: multiple runs from the same source produce an equivalent release payload apart from declared metadata, and no production secret is requested by build jobs.

### Phase 3: Production host preparation

- Decouple and rotate TLS material.
- Create the release, dependency, configuration, and persistent-data directories.
- Create the restricted deploy user/key.
- Install the root-owned validation/deploy script.
- Configure PM2 to use stable current-release pointers.
- Preserve the current checkout and PM2 configuration as rollback fallback.

Exit condition: a dummy artifact can be staged and rejected/accepted correctly without changing the live application.

### Phase 4: Dry-run release

- Build a real release in Actions.
- Transfer and verify it on production.
- Install its dependency layers.
- Run preflight and pending-migration checks.
- Stop before pointer switching.

Exit condition: the staged release is complete, checksummed, starts on private test ports, and production traffic remains on the old release.

### Phase 5: First controlled cutover

- Schedule a low-traffic window.
- Record current commit, PM2 state, database backup, and current UI assets.
- Deploy backend first, verify readiness and monitoring.
- Deploy UI second, verify public assets and PWA behavior.
- Confirm error monitoring attributes new events to the correct release.
- Exercise one critical workflow from each major module.

Exit condition: production is healthy on the Actions-built release and a rollback drill succeeds.

### Phase 6: Operationalize

- Keep deployment manual for the first several releases.
- Add GitHub notifications and release links to the maintenance/status page.
- Document rollback as a single explicit operation.
- Add dependency and old-release garbage collection.
- Add Dependabot/Renovate for GitHub actions and npm updates.
- Review CI duration and split slow integration tests if necessary.

### Phase 7: Optional cleanup and hardening

- With explicit user approval, stop committing `ui/build` and rely on immutable artifacts.
- Move TLS termination to nginx/Caddy and run Node processes as an unprivileged service user.
- Split backend API and background workers to permit genuine rolling deployments.
- Add artifact provenance/attestations if supported by the GitHub plan.
- Plan a coordinated Git-history cleanup for the historical TLS key and accumulated UI bundles.

## Proposed commit sequence

Keep each change independently reviewable:

1. `docs: add GitHub Actions release roadmap`
2. `refactor: separate backend build and runtime commands`
3. `fix: move UI TLS and build paths to runtime configuration`
4. `feat: add release-aware readiness checks`
5. `build: add deterministic release packager and verifier`
6. `ci: build and validate OmniLodge release artifacts`
7. `ci: add guarded UI build release commit`
8. `ops: add production host bootstrap and atomic deploy scripts`
9. `ci: add protected manual production deployment`
10. `security: rotate and untrack the origin certificate`
11. `ops: replace live build maintenance actions with release status`

Do not combine the TLS rotation, PM2 cutover, dependency changes, and first automated deployment into one irreversible step.

## First-release acceptance checklist

- GitHub Actions built both UI and backend from the recorded source SHA.
- The UI build exists in the required Git commit.
- Backend `dist` is absent from Git.
- Artifact checksum and internal file hashes pass on production.
- No production secrets appear in workflow logs or artifacts.
- Production performs no TypeScript or React compilation.
- Backend restarts in seconds rather than minutes.
- API readiness returns the expected release and database status.
- UI index and hashed assets all return `200`.
- Public `.map` requests return `404` and `Cache-Control: no-store`.
- Private maps are available to error symbolication.
- PWA update behavior is verified on an installed Android app and a normal browser.
- Scheduled jobs execute once, not twice.
- Database migrations show the expected state.
- Current Git/release/PM2 status is recorded.
- Application rollback to the previous release has been tested.

## Resume instructions for a future Codex session

1. Read the repository-root `AGENTS.md` and this roadmap completely.
2. Check `git status`, current branch, latest commit, and whether any workflow files now exist.
3. Do not assume the TLS security prerequisite was completed; verify it without displaying key material.
4. Start with Phase 1 only unless the user authorizes a larger phase.
5. Run and report tests after every phase.
6. Do not configure GitHub secrets by placing secret values in commands, files, patches, logs, or chat.
7. Do not enable automatic deployment before a manual dry run and rollback drill pass.
8. Update the status and completed checklist in this document after each phase.

## Definition of done

The migration is complete only when GitHub Actions builds and verifies both applications, production deploys the exact immutable release without application compilation, runtime secrets and mutable files live outside releases, health checks gate activation, rollback is proven, and the old build-on-start deployment controls are disabled.
