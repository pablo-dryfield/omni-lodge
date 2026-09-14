# OmniLodge GitHub Actions Release Roadmap

Status: planning only; this pipeline is not active yet.

Baseline when this plan was written: `080fa5db5e568c7f005f60c7b8aa39eaf8272c1d`

Repository review refreshed on 2026-09-14 at `f27d2f32e54c2d806719f706feb10d26bbb91a47`.

## Objective

Build and test the backend, UI, and UI server in GitHub Actions, create one immutable and verifiable release, and deploy that exact release without compiling application code on the production server.

The production server should only:

1. Receive and verify a release.
2. Install Linux runtime dependencies when a lockfile changes.
3. Run database migrations from the compiled backend.
4. Activate the backend and UI in a controlled order.
5. Run health checks and roll back application code if activation fails.

## Agreed operating model

The intended near-term path is:

```text
Codex task
    -> isolated short-lived branch and worktree
    -> GitHub Actions validation
    -> pull request
    -> human-approved merge
    -> new build of the resulting master SHA
    -> immutable release artifact
    -> manual or switch-controlled automatic deployment
    -> existing VPS
```

- `master` is the only permanent source branch and represents the latest approved code.
- Each independent Codex task starts from current `origin/master` and uses its own short-lived `codex/<type>-<slug>` branch and isolated worktree or clone.
- Collaborating subagents working on one pull request may share that task's worktree and branch; unrelated tasks must not share either.
- Codex may create and push meaningful checkpoint commits, open a draft pull request, respond to CI failures, and prepare the merge summary. A human decides when to merge.
- Delete short-lived task branches after merge. Audit `origin/dev-1`, `origin/release-1`, and local `migration/omni-ha-prep` before archiving or deleting them; do not remove them automatically.
- Codex does not need production credentials or direct production access for normal development work.
- A feature-branch artifact is diagnostic only. Production eligibility begins with the clean release built from the resulting `master` SHA after merge.

## Delivery status matrix

The status labels in this document mean `[Current]`, `[Partial]`, `[Planned]`, `[Blocked]`, or `[Optional/Future]`.

| Area | Repository today | Target | Status |
| --- | --- | --- | --- |
| GitHub Actions | No `.github/workflows` directory exists. | PR validation, trusted `master` release, deploy, and rollback workflows. | `[Planned]` |
| Repository layout | `be`, `ui`, and `ui-server` are independent packages with separate lockfiles; the root lockfile is not a workspace entry point. | Install, cache, validate, and package each application independently. | `[Current]` |
| Toolchain | `.nvmrc` selects Node 22; only the backend declares a Node engine; npm is not pinned project-wide. | One exact Node 22 and npm version recorded in all packages, CI, the manifest, and production. | `[Partial]` |
| Source workflow | Work has historically landed directly on `master`, and legacy branches remain. | Isolated short-lived branches, required PR checks, human merge, and branch cleanup. | `[Planned]` |
| Backend | Check, test, and build scripts exist, but production start, migration, access sync, and `postinstall` still compile TypeScript; no dedicated lint script exists. | Separate build-time and runtime-only commands with CI coverage. | `[Partial]` |
| UI | Typecheck, lint, tests, and build scripts exist; about 750 generated `ui/build` files remain tracked for the legacy deployment. | Build once in Actions and ship only in the verified release artifact after cutover. | `[Partial]` |
| UI server | Node tests exist; UI build and TLS paths are tied to the checkout, and there is no release-aware readiness contract. | Explicit runtime paths, strict preflight, syntax checks, and health reporting. | `[Partial]` |
| Health checks | `/api/health` is a shallow process liveness response. | Separate liveness and DB/config/migration/release-aware readiness checks. | `[Partial]` |
| Database validation | Production migrations exist, but there is no temporary-PostgreSQL migration gate in Actions. | Fresh migrate, verification, and second no-op migrate before any deploy can become eligible. | `[Planned]` |
| TLS | The Cloudflare Origin CA key and certificate are read from tracked source paths. | Rotated, server-owned TLS material outside Git and artifacts. | `[Blocked]` prerequisite |
| Deployment | Production uses the checkout/PM2 and legacy pull/build-oriented controls. | Verified release directories, atomic pointers, serialized activation, and rollback. | `[Planned]` |
| Staging | No separate staging environment is established in this roadmap. | Optional promotion of the same `master` artifact to a separate environment. | `[Optional/Future]` |

This matrix must be updated as roadmap phases land; adding a planned section below does not make that capability current.

## Rules that remain in force during the migration

- Do not build the UI on production.
- Keep committing `ui/build` while the legacy Git-based deployment remains the production fallback.
- Do not remove `ui/build` from `master` until the first artifact-based production deployment and its rollback drill have both succeeded.
- After that verified cutover, stop tracking `ui/build` in a dedicated cleanup commit and update the repository instruction at the same time.
- Never commit backend `dist`.
- Never put production application secrets, database credentials, TLS private keys, uploads, logs, or runtime data in a GitHub Actions artifact.
- Keep the existing deployment method available until the first artifact-based production deployment has passed all acceptance checks.

## Important security prerequisite

`be/src/ssl/cf-origin.key` is currently tracked in Git, and the UI server reads the key and certificate from the source tree. The key must not be copied into release artifacts.

Before any Actions-driven production deployment is permitted:

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

## Source-control and pull-request workflow

For each independent change:

1. Fetch the latest `origin/master` and create an isolated worktree or clone from it.
2. Create one short-lived branch such as `codex/fix-health-check`, `codex/feat-release-packager`, or `codex/docs-deployment-runbook`.
3. Make focused checkpoint commits and run the relevant local checks. Local commits do not trigger GitHub Actions; pushes do.
4. Push the branch and open a draft pull request after the first meaningful checkpoint so later pushes update the same review and CI context.
5. Resolve CI failures and update the branch when `master` advances.
6. Mark the pull request ready with a concise summary, implementation notes, checks run, deployment impact, migration/rollback notes, and known risks.
7. A human reviews and merges it. Delete the task branch after merge.

Do not create permanent `develop`, `staging`, or `release` branches. If staging is introduced later, it is a deployment environment receiving the same immutable `master` artifact, not another source-of-truth branch.

Protect `master` with stable required status-check names, no force pushes, and no ordinary direct pushes. Keep a documented administrator break-glass path for genuine emergencies, with the same post-event validation and audit requirements.

### Merge freshness with concurrent tasks

- Pull-request validation must test GitHub's prospective merge result against the current `master`, not only the feature branch head.
- Require branches to be up to date before merging, or later use GitHub's merge queue and add its `merge_group` event to the required workflow.
- If `master` changes after a green run, update/rebase the branch and rerun the required checks. A stale green result cannot authorize a merge.
- A failing branch remains isolated from other branches, `master`, releases, and production.
- Independent Codex tasks use independent worktrees. Subagents collaborating on the same task follow the owning branch and must not switch that shared worktree to an unrelated branch.

## GitHub Actions workflow design

### Triggers

- `push` to `codex/**`: run a fast branch-head validation set such as lint, typecheck, and unit tests; cancel an older run for the same branch and never deploy.
- `pull_request` targeting `master`: run the canonical full validation against the prospective merge result; never deploy.
- Open a draft pull request early so each later push also triggers `pull_request`/`synchronize`. Keep the branch-head suite fast and the merge-context suite authoritative instead of running two identical full suites for every commit.
- `push` to `master`: rerun clean validation, build the exact resulting `master` SHA, and publish a new immutable release artifact every time.
- `workflow_dispatch`: manually deploy an explicitly selected, previously successful trusted `master` release.
- The successful `master` release workflow also contains the automatic-deployment path from the outset, gated by `PRODUCTION_DEPLOY_MODE` as described below.
- CI concurrency may cancel obsolete runs for the same branch or pull request. Do not casually cancel a `master` release after artifact publication begins.
- Use one `production-deploy` concurrency group with `cancel-in-progress: false`, backed by the server-side `flock`, so a migration or activation is never interrupted by a newer run. GitHub keeps at most one pending member of a concurrency group and replaces an older pending run when another arrives, so this is intentionally a latest-pending-release policy rather than an unlimited queue.
- If GitHub merge queue is enabled later, add `merge_group` to the required validation workflow.

### Deployment modes and automatic-deployment switch

Configure both manual and automatic deployment logic when the deployment workflow is first implemented. Control forward production deployment with the non-secret repository Actions variable `PRODUCTION_DEPLOY_MODE`:

| Value | Every merged `master` release is built | Automatic production request | Manual forward deployment | Intended use |
| --- | --- | --- | --- | --- |
| `disabled` | Yes | Blocked | Blocked | Emergency deployment freeze |
| `manual` | Yes | No | Allowed | Initial releases; default |
| `automatic` | Yes | Yes, after the trusted release succeeds | Allowed | Later operational mode |

- Set the repository value to `disabled` during bootstrap. Change it to exactly `manual` only after the dry-run release passes and the first controlled deployment is ready.
- Treat a missing, misspelled, or unrecognized value as `disabled`; never interpret an arbitrary non-empty value as permission to deploy.
- Keep the value at repository scope because GitHub must evaluate it before scheduling a production-environment job. It is configuration, not a secret, and is not itself a security boundary. GitHub permits repository Actions-variable management to users with repository write access, so Phase 0 must audit/restrict that access, record each mode change in the deployment runbook, and use GitHub audit history where the account/plan provides it. If an administrator-only unattended-deployment switch is required, add a second server-owned allow flag checked by the root-owned deploy command.
- Operators change the mode in repository **Settings -> Secrets and variables -> Actions -> Variables**; moving between modes must not require editing workflow YAML.
- Both trigger paths must call one shared deployment implementation so artifact verification, backup, migration, activation, health checks, audit records, and rollback behavior cannot drift.
- The automatic path must require a successful `push` workflow for `refs/heads/master` in the canonical repository and must deploy that run's exact artifact. It must never accept a pull-request or feature-branch artifact.
- Manual dispatch remains available in `manual` and `automatic`. The dispatch run itself must come from the canonical repository at `refs/heads/master`, because GitHub's UI/API can dispatch a default-branch workflow against another selectable ref. It takes an exact release workflow run ID plus expected source SHA, or an equivalently unambiguous release ID, and verifies the trusted origin before production secrets are exposed or the VPS is contacted.
- Put artifact-origin and manifest validation in an unprivileged pre-deploy job. Only its successful result may schedule the job that references the protected `production` environment and can access deployment secrets.
- Immediately before activation, an automatically queued release must confirm its source SHA still equals the canonical repository's current `master` head. If a newer `master` build exists but failed or has not completed, the older queued release is skipped rather than deployed automatically.

The switch controls whether deployment is requested; it does not bypass the `production` GitHub Environment. Initially use `manual` mode and required environment reviewers when the repository plan supports them. This produces a deliberate progression:

1. `manual` plus required reviewer: explicit dispatch followed by environment approval.
2. `automatic` plus required reviewer: each successful `master` release queues automatically but still waits for approval.
3. `automatic` with the reviewer requirement deliberately removed: fully unattended production deployment.

The move from step 2 to step 3 is an explicit GitHub Environment settings change after repeated successful releases and a proven rollback drill; it is not something workflow code or the mode variable may bypass. If required reviewers are unavailable for this repository/plan, `manual` mode itself remains the initial human gate.

Keep rollback separate from forward deployment. `rollback-production` is always an explicit manual workflow against a known retained release, uses the same environment and concurrency group, validates the retained manifest, switches only to an approved known-good version, and never runs migration `down`. For an operator-initiated rollback: set forward mode to `disabled`, cancel pending (not actively migrating/activating) forward runs, wait for any active deployment to settle or perform its immediate recovery, and then dispatch rollback. This prevents a pending automatic release from redeploying immediately afterward. Rollback remains available during the freeze. A failed automatic activation performs the deploy script's immediate code-pointer rollback once, fails the run, and does not enter an automatic retry loop; operators should return the mode to `manual` while investigating.

### Permissions

- Default workflow token permission: `contents: read`.
- Grant the unprivileged trusted-release verifier only the read permission needed to inspect workflow runs and download their artifacts (for example `actions: read`).
- The build and artifact jobs must not push generated UI files back to the repository and therefore do not need `contents: write`.
- Grant elevated repository permissions only if a later, separately reviewed job publishes durable GitHub Releases, and scope that permission to that job.
- The production deployment job alone receives production environment secrets.
- Pin official GitHub actions to reviewed immutable commit SHAs, not floating branches.

### Parallel validation jobs

There is no root npm workspace. Do not run one root-level `npm ci` and assume it covers the applications. Each job must use the package's own directory and lockfile. Decide in Phase 0 whether the 89-byte root `package-lock.json` should be removed or documented as intentionally unused.

Use stable, documented required-check names so branch protection does not silently stop enforcing validation after workflow refactors. Target feedback in a few minutes by parallelizing independent jobs and caching dependencies, but record actual command durations before deciding which suites can be split safely.

#### Backend

1. Use the exact Node 22 and npm version selected in Phase 0; `.nvmrc` currently specifies only Node major `22`, while the repository does not yet pin npm project-wide.
2. Run `npm ci` from `be`.
3. Run `npm run check`.
4. Add and run a dedicated lint command rather than claiming the backend is linted today.
5. Run `npm test -- --runInBand` initially for memory safety, then optimize only from measured CI timings.
6. Run `npm run build:prod` once.
7. Verify the compiled monitoring models.
8. Upload the compiled output for the packaging job.

Before any Actions-driven production deploy can become eligible, add a temporary PostgreSQL Actions service and make migration verification a required release gate: migrate an empty database, run schema/integration verification, then run migrations a second time and require a clean no-op result. Tests that require external integrations must use disposable test credentials or mocks and must never receive production secrets.

#### UI

1. Run `npm ci` from `ui`.
2. Run `npm run check`.
3. Run `npm test -- --watchAll=false` (or the equivalent stable CI command) with watch mode disabled.
4. Build with a stable `REACT_APP_RELEASE` and the required source-map setting.
5. Validate `asset-manifest.json`, `index.html`, service worker assets, lazy chunks, and source-map coverage.
6. Upload the UI output for packaging.

No value prefixed with `REACT_APP_` may contain a secret because those values are public in the browser bundle.

#### UI server

1. Run `npm ci` from `ui-server`.
2. Run all Node tests.
3. Run `node --check` on the server and its helper modules.
4. Verify that a missing or inconsistent UI artifact causes preflight validation to fail.

The build/release workflow should run these application jobs in parallel where dependencies permit, then package only after every required job and the PostgreSQL migration gate succeed.

### UI build tracking transition

The target architecture does not commit generated `ui/build` files. GitHub Actions builds and validates the UI directly from the source SHA, and the resulting files exist only inside the immutable release artifact and retained production release directories. The workflow must not create generated commits or bot pull requests for `ui/build`.

The existing tracked build remains temporarily so the legacy deployment path is still usable throughout Phases 1-4. Any manual production deployment before the artifact cutover must continue following the repository's current local-build-and-commit rule.

Immediately after Phase 5 completes a successful artifact deployment and rollback drill:

1. Update `AGENTS.md` and the deployment documentation so the artifact is the authoritative UI build source.
2. Add `/ui/build/` to `.gitignore`.
3. Run `git rm -r --cached ui/build` so generated files remain local when needed but disappear from the tip of `master`.
4. Confirm the production deploy and rollback scripts no longer read UI assets from the Git checkout.
5. Commit the untracking and instruction changes as one dedicated, reviewable cleanup.

Do not rewrite Git history as part of this transition. Historical UI bundles may remain in old commits; any future repository-history cleanup is a separate operation.

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
  server.js
  reportingSecurity.js
  sourceMapArchive.js
  telemetryPayload.js
  telemetrySecurity.js
  utils/logger.js
  package.json
  package-lock.json
```

Do not include backend source, `.env*`, TLS material, logs, uploads, runtime directories, or Windows `node_modules`.

The manifest must contain:

- Schema version.
- Source SHA.
- Stable release ID.
- UTC build timestamp.
- Node and npm versions.
- Backend, UI, and UI-server lockfile hashes.
- Main UI hashed asset path.
- File count and SHA-256 for every shipped payload file except the manifest itself.
- Workflow run ID and repository identity.
- Workflow name/path, trigger event, canonical repository, and `refs/heads/master` eligibility.

Upload the tar archive and a detached SHA-256 checksum covering the complete archive, including its manifest, as an immutable GitHub Actions artifact. The internal manifest verifies the payload; the detached archive checksum protects the manifest and archive as a whole. Never overwrite an artifact identifier. Document Actions artifact retention and expiry; production must not depend on GitHub retention for rollback because it keeps verified releases locally. A durable GitHub Release is optional later if longer retention is required.

### Branch artifacts versus deployable releases

- Pull-request and feature-branch artifacts are ephemeral validation/debug outputs. They never become production releases and cannot be promoted.
- After merge, the resulting `master` commit is checked out afresh, validated again, and assigned its own release ID, manifest, archive checksum, and artifact identity.
- A production job must verify that the selected workflow run belongs to this canonical repository and reviewed release workflow, was triggered by a push to `master`, concluded successfully, and has a head SHA matching both the requested SHA and manifest.
- Integrity checks alone do not establish trust. Eligibility also depends on repository, workflow, event, ref, successful conclusion, immutable artifact identity, and the protected environment.
- Every deployment record must include release ID, source SHA, workflow run and artifact IDs, actor, trigger, deployment mode, timestamps, result, and rollback target/result.

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

The deployment workflow and root-owned server script together must:

1. Acquire an exclusive `flock`; abort if another deployment is active.
2. Have the unprivileged Actions verifier validate the canonical repository, reviewed workflow identity, `push` event, `refs/heads/master`, successful conclusion, and immutable artifact ID; then have the server compare the authenticated expected release ID/SHA with the manifest before doing any mutation.
3. Accept uploads only in a fixed incoming directory.
4. Verify the outer SHA-256 checksum before extraction.
5. Reject absolute paths, `..` traversal, symlinks escaping the release, unexpected owners, and unexpected artifact contents.
6. Extract to a new temporary release directory.
7. Validate every manifest file and checksum.
8. Confirm Node/npm compatibility and prepare lock-hash dependency directories.
9. Attach server-owned environment, uploads, logs, runtime, TLS, and source-map locations.
10. Run all preflight checks.
11. Determine whether migrations are pending and, before any schema change, invoke the validated server-owned backup command configured during Phase 0. Require a newly created, non-empty backup and record its path/checksum; an exit code alone is insufficient.
12. Run the compiled migration command once.
13. Save the current backend pointer as the previous backend.
14. Atomically switch the backend pointer and restart the single PM2 backend process in fork mode.
15. Poll local readiness and require the expected release ID.
16. If backend readiness fails, restore the previous backend pointer and restart it.
17. Save and switch the UI pointer only after backend success.
18. Restart the UI server with the matching release ID.
19. Verify the main public homepage, `transaction.omni-lodge.com`, `counter.omni-lodge.com`, the web manifest, main hashed asset, API health, required proxy/WebSocket paths, and public source-map denial.
20. If UI verification fails, restore the previous UI pointer without rolling back the healthy backend unless compatibility requires both to roll back.
21. Persist the PM2 process list and write an auditable deployment record containing the release/run/artifact identity, trigger mode, actor, timings, checks, and rollback result.
22. Keep the current and at least three previous releases; prune only releases not referenced by current/previous pointers.

One active production deployment is allowed to finish. GitHub may replace its one pending forward deployment with a newer pending release; whichever run remains must recheck the current `master` head immediately before staging/activation and skip itself when superseded. It is acceptable to skip intermediate application versions because the migration runner applies all pending migrations, but only while migrations obey the expand/contract rules below.

Do not automatically run migration `down` during application rollback. Database migrations must use an expand/contract approach so both the old and new application versions remain compatible during rollback.

## Backend process limitation

The backend process also starts scheduled/background jobs. Do not use PM2 cluster mode or briefly run old and new backend processes concurrently because jobs could execute twice.

The first pipeline should use a short fork-mode restart after all expensive work has completed. True zero-downtime API deployment requires a later separation of the HTTP API and background worker, plus database/distributed locks for scheduled jobs.

## GitHub production environment

Create a `production` environment restricted to the exact `master` branch, not merely any branch that happens to be protected, and configure, at minimum:

- `PRODUCTION_SSH_HOST`
- `PRODUCTION_SSH_PORT`
- `PRODUCTION_SSH_USER`
- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`

Use a dedicated deployment user and an Ed25519 key, not a password. The user should have only the filesystem permissions it needs and passwordless sudo access to one root-owned, validated deploy command if PM2 still runs under root.

Keep database, JWT, encryption, integration, Cloudflare Origin CA, and application-monitoring secrets only on the server/control panel. They are runtime secrets and are not GitHub build inputs.

Store `PRODUCTION_DEPLOY_MODE` as a repository configuration variable, not an environment variable or secret, so the workflow can evaluate it before a production job is scheduled. Start at `disabled` during bootstrap, then move to `manual` for the first controlled releases.

Enable required reviewers, prevent self-review where practical, disallow administrator bypass, and restrict deployment branches when supported by the repository's GitHub plan. Environment protections are independent of the deployment-mode switch, and environment secrets must not become available until those protections pass. Confirm plan support before depending on required reviewers for a private repository.

Rotate any deployment/root password or private credential that has previously been shared outside its intended secret store. After the dedicated deploy user/key and rollback path are proven, disable routine root/password SSH login in a separate hardening change rather than coupling it to the first cutover.

## Explicit non-goals

This roadmap does not introduce Docker, Jenkins, Kubernetes, complex GitFlow, permanent `develop`/`staging`/`release` branches, a PM2 replacement, preview environments, or a migration of application hosting to Cloudflare. Existing Cloudflare DNS, TLS proxying, and email ingress remain in place unless a separate project changes them.

The native Android/Google Play project is not built or released by this VPS pipeline. It may consume the deployed web application, but its store build/signing/release process needs a separate roadmap if automation is desired.

A staging environment is optional later. If added, it must receive the same verified `master` artifact that is eligible for production; it does not get a staging source branch or a rebuild.

## Phased implementation

### Phase 0: Baseline inventory and workflow contract

- Inventory and record the exact local and production Node/npm versions, package scripts, build outputs, lockfiles, and expected CI commands. Select one exact Node 22/npm pair instead of relying on the current machine's incidental npm version.
- Confirm that `be`, `ui`, and `ui-server` are independent npm projects and decide whether the unused root `package-lock.json` should be removed.
- Inventory production read-only before changing it: current checkout path, PM2 process names/mode/cwd/start commands, service user, ports, Node/npm path, TLS ownership, persistent paths, upload/log/source-map locations, database migration state, server-owned backup command, and existing maintenance/deploy controls.
- Record all public smoke-test origins and critical routes, including the main site, transaction shortcut domain, counter shortcut domain, API, proxy, WebSocket, PWA, and source-map denial behavior.
- Inventory repository rules, collaborators with write access, and legacy branches. Define the required PR check names, merge-freshness policy, branch cleanup policy, release naming, artifact retention, production environment, `PRODUCTION_DEPLOY_MODE`, whether an administrator-only server allow flag is needed, and owners of approval, emergency freeze, and rollback.
- Add a non-secret checked-in deployment contract or PM2 ecosystem description after the inventory. Do not copy production secrets into it.
- Update the delivery status matrix with anything that changed since this review.

Exit condition: the actual production/runtime contract and exact CI commands are reviewed and recorded, with no production mutation yet.

### Phase 1: Reproducible builds

- Pin the exact selected Node 22 and npm versions.
- Add engine/package-manager metadata to all three packages.
- Split backend build/runtime scripts and remove compile-on-install.
- Add tests for the runtime-only commands.
- Add configurable UI build/TLS paths and strict UI artifact validation.
- Add release-aware liveness/readiness endpoints.

Exit condition: local tests pass and starting an already-built backend performs no compilation.

### Phase 2: CI without deployment

- Add parallel backend, UI, and UI-server jobs.
- Add dependency caching keyed by each lockfile.
- Establish fast `codex/**` push checks, the short-lived branch/draft-PR flow, stable required checks, authoritative merge-result validation, and per-branch/per-PR concurrency cancellation.
- Build and validate the UI from the source SHA without committing generated output.
- Add the disposable PostgreSQL fresh-migration, integration-verification, and second no-op migration gate.
- Generate and validate the combined release artifact and manifest.
- On every `master` push, rebuild the merged SHA cleanly and publish a production-eligible artifact distinct from all branch artifacts.
- Upload artifacts; do not contact production.

Exit condition: multiple runs from the same source produce an equivalent release payload apart from declared metadata, branch artifacts cannot pass the production eligibility verifier, and no production secret is requested by build jobs.

### Phase 3: Production host preparation

- Decouple and rotate TLS material.
- Create the release, dependency, configuration, and persistent-data directories.
- Create the restricted deploy user/key.
- Install the root-owned validation/deploy script.
- Configure PM2 to use stable current-release pointers.
- Implement the unprivileged trusted-release verifier, shared deployment workflow, manual forward-deploy entry point, conditional automatic path, and always-manual rollback workflow.
- Configure the repository variable `PRODUCTION_DEPLOY_MODE=disabled` and the protected `production` environment. Do not place production runtime secrets in the build workflow.
- Preserve the current checkout and PM2 configuration as rollback fallback.

Exit condition: a dummy artifact can be staged and rejected/accepted correctly without changing the live application.

### Phase 4: Dry-run release

- Build a real release in Actions.
- Transfer and verify it on production.
- Install its dependency layers.
- Run preflight and pending-migration checks.
- Stop before pointer switching.
- Exercise both manual and automatic trigger selection without allowing the automatic path to contact production; unknown/missing mode values must demonstrate fail-closed behavior.
- After the dry run passes and immediately before Phase 5, change `PRODUCTION_DEPLOY_MODE` from `disabled` to `manual`.

Exit condition: the staged release is complete, checksummed, starts on private test ports, and production traffic remains on the old release.

### Phase 5: First controlled cutover

- Keep `PRODUCTION_DEPLOY_MODE=manual`; automatic deployment code is present but must not activate production yet.
- Schedule a low-traffic window.
- Record current commit, PM2 state, database backup, and current UI assets.
- Deploy backend first, verify readiness and monitoring.
- Deploy UI second, verify public assets and PWA behavior.
- Confirm error monitoring attributes new events to the correct release.
- Exercise one critical workflow from each major module.

Exit condition: production is healthy on the Actions-built release and a rollback drill succeeds.

### Phase 6: Operationalize

- After the verified Phase 5 cutover and rollback drill, remove tracked `ui/build` from `master`, add it to `.gitignore`, and update `AGENTS.md` in one dedicated commit.
- Keep `PRODUCTION_DEPLOY_MODE=manual` for the first several releases while collecting deployment duration, failure, readiness, and rollback evidence.
- Change the repository variable to `automatic` only after the acceptance checklist passes. Initially retain the environment reviewer so master releases queue automatically but still require human approval.
- After additional healthy releases, deliberately remove the reviewer requirement if fully unattended production deployment is desired. Test that returning the mode to `disabled` freezes forward deployments while explicit rollback remains available.
- Add GitHub notifications and release links to the maintenance/status page.
- Document rollback as a single explicit operation.
- Add dependency and old-release garbage collection.
- Add Dependabot/Renovate for GitHub actions and npm updates.
- Review CI duration and split slow integration tests if necessary.

### Phase 7: Optional cleanup and hardening

- Add a separate staging environment only if it solves a demonstrated need; promote the exact same `master` artifact.
- Move TLS termination to nginx/Caddy and run Node processes as an unprivileged service user.
- Split backend API and background workers to permit genuine rolling deployments.
- Add artifact provenance/attestations if supported by the GitHub plan.
- Plan a coordinated Git-history cleanup for the historical TLS key and accumulated UI bundles.

## Proposed commit sequence

Keep each change independently reviewable:

1. `docs: add GitHub Actions release roadmap`
2. `docs: define the Codex branch and pull-request contract`
3. `build: pin the shared Node and npm toolchain`
4. `refactor: separate backend build and runtime commands`
5. `fix: move UI TLS and build paths to runtime configuration`
6. `feat: add release-aware readiness checks`
7. `test: add disposable database migration verification`
8. `build: add deterministic release packager and verifier`
9. `ci: validate pull requests and trusted master releases`
10. `ci: package the Actions-built UI without repository writes`
11. `ops: add production host bootstrap and atomic deploy scripts`
12. `ci: add trusted manual and switchable automatic production deployment`
13. `security: rotate and untrack the origin certificate`
14. `ops: replace live build maintenance actions with release status`
15. `chore: stop tracking UI build after verified artifact cutover`

Do not combine the TLS rotation, PM2 cutover, dependency changes, and first automated deployment into one irreversible step.

## First-release acceptance checklist

- Required pull-request checks validate the prospective merge result against current `master`.
- An obsolete/stale green pull request cannot merge without fresh validation.
- GitHub Actions built the backend, UI, and UI server from the recorded source SHA.
- The production-eligible artifact was built anew from a successful canonical `master` push; a branch/PR artifact is rejected by the deployment verifier.
- The UI build exists in the verified immutable release artifact.
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
- A disposable PostgreSQL database passes fresh migration, schema/integration verification, and a second no-op migration before release eligibility.
- Production migrations show the expected state, and any required backup created a new non-empty verified file before schema changes.
- Current Git/release/PM2 status is recorded.
- Application rollback to the previous release has been tested.
- Production deployment is serialized in GitHub and on the VPS; a newer queued release cannot interrupt an active migration or activation.
- `PRODUCTION_DEPLOY_MODE` remains `disabled` throughout bootstrap/dry-run and is `manual` for the first controlled release; missing/invalid values block forward deployment.
- Manual dispatch itself is rejected unless its repository/ref is the canonical repository's `refs/heads/master`, and it accepts only an exact trusted successful `master` release.
- The automatic route is implemented but cannot run while mode is `manual`; its selection logic is tested without contacting production.
- A simulated automatic run whose SHA is no longer the current `master` head is skipped, including when the newer head failed its release build.
- The rollback drill freezes forward deployment, clears pending forward work, and proves rollback remains usable while mode is `disabled`.
- The main domain, transaction shortcut, counter shortcut, API, required proxy/WebSocket routes, PWA behavior, and source-map denial all pass public smoke checks.
- Deployment credentials are a restricted key for a dedicated user, and any previously exposed deployment credential has been rotated.

Before moving to unattended production, additionally prove several healthy manual releases, one approved `automatic`-mode release, emergency `disabled` behavior, explicit rollback while disabled, and a controlled release with the reviewer gate removed.

## Resume instructions for a future Codex session

1. Read the repository-root `AGENTS.md` and this roadmap completely.
2. Check `git status`, current branch, latest commit, and whether any workflow files now exist.
3. Confirm the work is on a current isolated task branch/worktree; do not merge the pull request autonomously.
4. Do not assume the TLS security prerequisite was completed; verify it without displaying key material.
5. Start with Phase 0, then the next incomplete phase only, unless the user authorizes a larger scope.
6. Run and report tests after every phase.
7. Do not configure GitHub secrets by placing secret values in commands, files, patches, logs, or chat.
8. Inspect and report the current `PRODUCTION_DEPLOY_MODE`; never change it implicitly, deploy a branch artifact, or remove environment approval without explicit rollout authorization.
9. Do not change the mode to `automatic` or remove environment approval before the manual dry run, initial releases, and rollback drill pass.
10. Update the status matrix and completed checklist in this document after each phase.

## Definition of done

The migration is complete only when GitHub Actions validates merge compatibility, builds and verifies all three applications, publishes a trusted immutable release for every merged `master` SHA, production deploys that exact release without application compilation, runtime secrets and mutable files live outside releases, health checks gate activation, deployment is serialized and auditable, rollback is proven, the manual/automatic/freeze modes behave as documented, the old build-on-start deployment controls are disabled, and `ui/build` is no longer tracked on `master`.
