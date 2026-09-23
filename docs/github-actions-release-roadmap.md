# OmniLodge GitHub Actions Release Roadmap

Status: Phases 0-6 are complete. The repository now validates PRs, builds trusted immutable `master` releases for backend/UI/UI-server in GitHub Actions, deploys those artifacts without compiling on production, blocks generated UI/backend build artifacts from Git, and runs production from managed release pointers. Automatic production deployment is configured and proven with the host policy and repository `PRODUCTION_DEPLOY_MODE` both restored to `automatic`.

Latest evidence: production is healthy on `omnilodge-r35864299959-a1-ba96006a4682` from source SHA `ba96006a468273640446843b35ae162d3f0dfceb`. The emergency freeze drill completed on 2026-09-23: Release rerun `35864299959` attempt 2 succeeded while `PRODUCTION_DEPLOY_MODE=disabled`, automatic Production Deploy Request run `35866959846` skipped host submission, rollback run `35867068044` restored retained predecessor `omnilodge-r35862318917-a1-d977f64749b3`, rollback run `35867270236` returned production to `omnilodge-r35864299959-a1-ba96006a4682`, public `/healthz` and `/api/health/ready` returned HTTP 200, and `PRODUCTION_DEPLOY_MODE` was restored to `automatic`.

Baseline when this plan was written: `080fa5db5e568c7f005f60c7b8aa39eaf8272c1d`

Initial repository review refreshed on 2026-09-14 at `f27d2f32e54c2d806719f706feb10d26bbb91a47`; implementation status in this document reflects the merged Phase 0-2 implementation and partial Phase 3 repository foundations on the current worktree.

## Phase completion ledger

| Phase | Current status | Completed evidence | Missing / remaining |
| --- | --- | --- | --- |
| Phase 0: Baseline inventory and workflow contract | **Completed** | Production runtime contract, sanitized production inventory, backup/restore proof, and production-shaped migration proof were recorded on 2026-09-16. | Nothing required for this phase. Deferred hardening remains in later phases, especially TLS history cleanup and root/password SSH reduction. |
| Phase 1: Reproducible builds | **Completed** | Node 22.23.2/npm 10.9.8 are pinned; backend runtime commands, readiness checks, configurable UI server paths, and artifact validation were merged in PR #16. | Nothing required for this phase. |
| Phase 2: CI without deployment | **Completed** | Required PR validation, trusted `master` release packaging, source-built UI validation, release manifest/checksums, and disposable PostgreSQL migration gate were merged in PR #16 and proven by trusted release run `35459235360`. | Nothing required for this phase. |
| Phase 3: Production host preparation | **Completed** | Restricted deploy user/key, forced SSH/sudo submitter, host v2 protocol/state/audit, detached worker, root-owned deployment directories, runtime env placement, control-plane bootstrap, and non-activation stage evidence all passed on production. | Nothing required for this phase. Audit-log rotation discovered later is Phase 6 operational hardening, not a Phase 3 blocker. |
| Phase 4: Dry-run release | **Completed** | Trusted releases were transferred, extracted, dependency layers were published/reused, managed links and Puppeteer cache were prepared, backend migration-status/runtime preflight passed, and private backend/UI smoke checks succeeded without public activation. | Nothing required for this phase. |
| Phase 5: First controlled cutover | **Completed** | Manual deploys reached public cutover, rollback drill run `35812156678` succeeded, post-rollback forward deploy run `35812350402` succeeded, and the no-committed-UI cleanup release deploy run `35828883438` succeeded on 2026-09-23. | Nothing required for this phase. Legacy-baseline rollback was proven but is no longer the documented normal rollback target. |
| Phase 6: Operationalize | **Completed** | `ui/build` was removed from the Git tip, `/ui/build/` is ignored, `AGENTS.md` forbids committed generated UI build files and production builds, production is running release `omnilodge-r35864299959-a1-ba96006a4682` built from source in Actions, deployment audit-log rotation/retention is installed and accepted production audit events, rollback is documented as a retained managed-release operation, Dependabot is configured for npm plus GitHub Actions, maintenance shows release/deploy links, docs-only master pushes skip release packaging, docs-only PRs have a lightweight required-check path, old-release/dependency garbage collection is production-verified by dry-run `35846364912`, synthetic audit-threshold rotation/retention is production-proven, recent CI/release duration was reviewed, branch cleanup removed retired `dev-1`/`release-1`, unattended automatic deployment is configured and production-proven with a `master`-only production branch policy, `codex/*` task PRs are configured for squash auto-merge after green checks, merged same-repository PR branches are explicitly cleaned up after merge, and the emergency `disabled` freeze plus retained-release rollback drill completed successfully on 2026-09-23. | Nothing required for this phase. |
| Phase 7: Optional cleanup and hardening | **Optional / future** | Not started. | Optional staging, TLS termination move to nginx/Caddy, unprivileged Node service user, backend worker split, provenance attestations, and coordinated historical TLS/UI-bundle cleanup. |

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
    -> automatic squash merge when required checks are green
    -> new build of the resulting master SHA
    -> immutable release artifact
    -> manual or switch-controlled automatic deployment
    -> existing VPS
```

- `master` is the only permanent source branch and represents the latest approved code.
- Each independent Codex task starts from current `origin/master` and uses its own short-lived `codex/<type>-<slug>` branch and isolated worktree or clone.
- Collaborating subagents working on one pull request may share that task's worktree and branch; unrelated tasks must not share either.
- Codex may create and push meaningful checkpoint commits, open a draft pull request, respond to CI failures, and prepare the merge summary. For same-repository, non-draft `codex/*` PRs targeting `master`, the auto-merge workflow requests squash auto-merge using `OMNILODGE_AUTOMERGE_TOKEN` and GitHub merges only after branch protection and required checks are satisfied. Do not fall back to `GITHUB_TOKEN` for auto-merge, because merges performed only with `GITHUB_TOKEN` can skip downstream Release/Deploy workflow triggers. Dependabot and other non-`codex/*` branches require intentional review/merge even when green.
- Delete short-lived task branches after merge. Audit `origin/dev-1`, `origin/release-1`, local `migration/omni-ha-prep`, and any already-merged retained Codex branches such as `origin/codex/docs-cicd-roadmap` before archiving or deleting them; do not remove them automatically.
- Codex does not need production credentials or direct production access for normal development work.
- A feature-branch artifact is diagnostic only. Production eligibility begins with the clean release built from the resulting `master` SHA after merge.

## Delivery status matrix

The status labels in this document mean `[Current]`, `[Partial]`, `[Planned]`, `[Blocked]`, or `[Optional/Future]`.

| Area | Repository today | Target | Status |
| --- | --- | --- | --- |
| GitHub Actions | Bootstrap controls plus SHA-pinned CI and trusted `master` release workflows are implemented. Reviewed PR and branch runs are green, and the first trusted `master` release run `35459235360` succeeded for `0ff723bafc588970d2650dc435dbc8a2b4d469de`. The deploy-request workflow validates trusted release evidence, writes a host v2 request artifact, and uses the `production` submit job to stream approved requests over the retained deploy key. The deploy and rollback submit paths now poll terminal host request status and upload both submit-response and status evidence. The production environment has host metadata variables and a protected deploy-key secret configured. Repository `PRODUCTION_DEPLOY_MODE=automatic` enables workflow-run production deploy requests after trusted `master` releases, with the environment still restricted to the `master` branch. Manual release deployment is proven by run `35828883438`; unattended automatic deployment is proven by run `35855177424`. | PR validation, trusted `master` release, deploy, and rollback workflows. | `[Current]` |
| Repository layout | `be`, `ui`, and `ui-server` are independent packages with separate lockfiles; the unused empty root lockfile has been removed. | Install, cache, validate, and package each application independently. | `[Current]` |
| Toolchain | Node 22.23.2 and npm 10.9.8 are selected and pinned in `.nvmrc` and all three package manifests. | Use that exact pair in local development, CI, release manifests, and production. | `[Current]` |
| Source workflow | `master` requires pull requests, strictly requires the GitHub Actions app-bound `CI / required` check, and blocks force pushes/deletion. Repository auto-merge and branch auto-delete after merge are enabled; same-repository, non-draft `codex/*` PRs targeting `master` are automatically marked for squash auto-merge with `OMNILODGE_AUTOMERGE_TOKEN`, while fork, Dependabot, and other non-`codex/*` PRs are excluded from automatic merge. The workflow also explicitly deletes merged same-repository PR branches on `closed` events so squash-merged task branches do not linger. Retired `origin/dev-1`, `origin/release-1`, and `origin/codex/docs-cicd-roadmap` branches were removed after audit. Local stale Codex branches were pruned, `migration/omni-ha-prep` was retained as unique HA work, and the remaining remote Dependabot branches correspond to active open dependency-update PRs. | Isolated short-lived branches, required merge-result checks, auto-merge when green, and branch cleanup. | `[Current]` |
| Runtime contract | `docs/production-runtime-contract.md` records the non-secret package, runtime, repository, release, and smoke-test contract. Root PM2, storage, migration, backup, restore, and production-shaped upgrade facts were verified on 2026-09-16 and are recorded in `docs/production-phase0-evidence-2026-09-16.md`. | Reviewed and fully verified production/runtime contract. | `[Current]` |
| Backend | Check, test, build, and runtime-only start/migrate/access-sync scripts exist and compile-on-install is removed. The compiled artifact also contains a read-only migration-status command and a fail-closed runtime preflight covering release identity, migration lineage/state, runtime safety settings, read-only database access, Sharp, and the pinned Puppeteer cache/browser. CI and release jobs run check/tests/build; deploy dry-run and activation now execute migration-status and runtime-preflight from the staged release before public cutover. Legacy production aliases still compile for fallback, and no separate backend lint command exists. | Runtime-only artifact activation with complete CI coverage. | `[Current]` |
| UI | Typecheck, lint, tests, and build scripts exist; generated `ui/build` files are ignored and no longer tracked for deployment. Actions rebuild from a clean directory and validate release metadata/assets/source maps. | Build once in Actions and ship only in the verified release artifact after cutover. | `[Current]` |
| UI server | Build/TLS paths are configurable, startup performs strict release-aware artifact/TLS preflight, `/healthz` reports release/artifact status, and Actions run tests plus syntax checks. Managed production now starts the release-local UI server through `/opt/omnilodge/ui-current` with server-owned TLS paths and health-gated activation. | Explicit release paths with server-owned TLS and deployment health gating. | `[Current]` |
| Health checks | The legacy `/api/health` remains shallow for compatibility; `/api/health/live` and `/api/health/ready` are implemented with database, required-config, and release checks. Deployment dry-runs, private smoke, managed-origin readiness, public smoke, and post-deploy checks now consume these endpoints before and after activation. | Separate liveness and DB/config/migration/release-aware readiness checks. | `[Current]` |
| Database validation | An idempotent historical baseline and explicit legacy schema bridges support empty and production-shaped databases without modifying production-owned data. The PostgreSQL 16 fresh-database gate passed locally and in hosted CI. A one-time production backup was restored on PostgreSQL 17.5; four pending branch migrations applied successfully, a second run was a no-op, all 189 migration records matched, and 159 compiled models queried successfully. Shared fail-closed migration-lineage checks, the compiled read-only migration-status command, the conditional backup gate, and the production migration gate are now wired into deploy activation. | Keep the PostgreSQL 16 fresh gate required and preserve backup/migration-gate enforcement for every deploy. | `[Current]` |
| TLS | The matching Cloudflare Origin CA pair is still read from tracked source paths. The owner accepted the known exposure risk and directed that the pair be retained without rotation. | Reuse the retained pair from a permission-restricted server-owned path outside Git and artifacts; untrack it from the Git tip. Rotation remains recommended deferred hardening. This is an accepted-risk prerequisite. | `[Partial]` |
| Deployment | Production now runs the Actions-built managed release `omnilodge-r35864299959-a1-ba96006a4682` through `/opt/omnilodge/backend-current`, `/opt/omnilodge/ui-current`, and the root-owned PM2 runtime launcher. A restricted deployment account, its existing Ed25519 deploy key, and the protected GitHub environment are retained; key rotation is not part of this work. The production host has the strict versioned host protocol/client, fail-closed bootstrap, server-owned automatic policy, directory scaffolding, PM2/systemd/recovery scaffolds, a protocol-aware root submitter, detached worker, legacy-baseline recovery hardening, JSON PM2 ecosystem installation, switch-controlled deployment workflow, delete-and-start managed PM2 activation, saved legacy PM2 restore on fallback, PM2/public-smoke warm-up retries, durable activation-failure evidence, local managed-origin readiness checks, backend env validation, explicit PM2 runtime-component contract, CRA-compatible public smoke verification, legacy-baseline rollback activation support, and retryable status polling installed. Approved manual non-activation stage, dry-run, forward deploy, rollback, post-rollback redeploy, no-committed-UI release deploy, unattended automatic deploy requests, and a `disabled` freeze plus retained-release rollback drill have succeeded for Actions-built releases. Generated `ui/build` files are no longer tracked or deployed from Git. | Verified release directories, atomic pointers, serialized activation, and rollback. | `[Current]` |
| Staging | No separate staging environment is established in this roadmap. | Optional promotion of the same `master` artifact to a separate environment. | `[Optional/Future]` |

This matrix must be updated as roadmap phases land; adding a planned section below does not make that capability current.

## Rules that remain in force during the migration

- Do not build the UI on production.
- The first artifact-based production deployment and rollback drill have succeeded; `ui/build` is ignored and no longer tracked from the Phase 6 cleanup commit onward.
- Do not rely on Git-tracked `ui/build` for new production deployments; GitHub Actions release artifacts are now the authoritative deployable UI source.
- Never commit backend `dist`.
- Never put production application secrets, database credentials, TLS private keys, uploads, logs, or runtime data in a GitHub Actions artifact.
- Keep the existing checkout available as historical evidence of the captured legacy baseline, but use retained managed release snapshots for normal rollback going forward.

## Important TLS accepted-risk prerequisite

`be/src/ssl/cf-origin.key` is currently tracked in public Git history, and the UI server reads the key and certificate from the source tree. The private key must therefore be treated as exposed and must never be copied into release artifacts.

On 2026-09-16 the owner explicitly directed the project to retain the existing matching Cloudflare Origin CA pair without rotating or revoking it. This is an accepted-risk exception, not a claim that the key is secure. Before any Actions-driven production deployment is permitted:

1. Keep using the implemented explicit `UI_TLS_KEY_PATH` and `UI_TLS_CERT_PATH` runtime settings.
2. Copy the retained certificate and key to a server-owned path outside the repository and releases, preferably `/etc/omnilodge/tls`, readable only by the service account.
3. Start the candidate UI server with those explicit paths and verify the origin while Cloudflare remains in strict TLS mode.
4. Remove the key and certificate from the Git tip and add their source paths to `.gitignore`; never include either file in an artifact, manifest, cache, or workflow log.
5. Keep rotation, revocation, and coordinated Git-history cleanup as recommended deferred hardening. Do not silently convert this exception into a claim that the historical key is protected.

The verified host and certificate facts are recorded without private material in [Production Phase 0 Evidence — 2026-09-16](production-phase0-evidence-2026-09-16.md).

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
7. GitHub auto-merges eligible `codex/*` pull requests after required checks pass. The auto-merge workflow must use `OMNILODGE_AUTOMERGE_TOKEN`, not the default `GITHUB_TOKEN`, so the resulting `master` push starts Release and automatic production deploy. Dependabot and other non-`codex/*` branches are intentionally left for manual review/merge. The cleanup job deletes merged same-repository task branches after merge.

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

The current Phase 2 implementation has these triggers:

- `.github/workflows/ci.yml` runs on `push` to `codex/**` and on pull requests targeting `master`.
- A branch push runs backend checks/tests, UI checks/tests, and UI-server tests/syntax checks. The migration gate and application builds are intentionally skipped, and the aggregate check is named `Branch / required`.
- A pull request runs the canonical full validation against GitHub's prospective merge result. It adds backend/UI builds, strict source-SHA-bound UI artifact validation, and the disposable PostgreSQL gate; the aggregate check is named `CI / required`.
- CI concurrency cancels obsolete runs for the same branch or pull request.
- `.github/workflows/release.yml` runs only on `push` to `master`. It validates and builds the exact resulting SHA, then publishes one immutable combined release artifact. It has no deployment step and intentionally has no workflow concurrency rule that could replace a pending `master` release.

Open a draft pull request early so each later push triggers the authoritative merge-context suite. After the first successful real `CI / required` run, configure that exact name as the branch-protection requirement. If GitHub merge queue is enabled later, add `merge_group` to the required validation workflow.

The deployment implementation now adds these production-only triggers and serialization controls:

- `workflow_dispatch` manually deploys an explicitly selected, previously successful trusted `master` release.
- The successful `master` release path can request automatic deployment, gated by `PRODUCTION_DEPLOY_MODE` as described below. Artifact creation remains independent of that switch.
- One `production-deploy` concurrency group with `cancel-in-progress: false`, backed by server-side serialization, prevents a migration or activation from being interrupted by a newer run. GitHub keeps at most one pending member of a concurrency group and replaces an older pending run when another arrives, so this is intentionally a latest-pending-release policy rather than an unlimited queue.

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

Current production state on 2026-09-23: step 3 is active. Repository `PRODUCTION_DEPLOY_MODE` is `automatic`, the production environment required reviewer gate is removed, the production environment still restricts deployments to `master`, and the root-owned host policy is `automatic`.

Keep rollback separate from forward deployment. The `rollback-production` workflow is always an explicit manual action against a known retained release, uses the same environment and concurrency group, validates the retained manifest, switches only to an approved known-good version, and never runs migration `down`. For an operator-initiated rollback: set forward mode to `disabled`, cancel pending (not actively migrating/activating) forward runs, wait for any active deployment to settle or perform its immediate recovery, and then dispatch rollback. This prevents a pending automatic release from redeploying immediately afterward. Rollback remains available during the freeze. A failed automatic activation performs the deploy script's immediate code-pointer rollback once, fails the run, and does not enter an automatic retry loop; operators should return the mode to `manual` while investigating.

### Permissions

- Default workflow token permission: `contents: read`.
- Grant the unprivileged trusted-release verifier only the read permission needed to inspect workflow runs and download their artifacts (for example `actions: read`).
- The build and artifact jobs must not push generated UI files back to the repository and therefore do not need `contents: write`.
- Grant elevated repository permissions only if a later, separately reviewed job publishes durable GitHub Releases, and scope that permission to that job.
- The production deployment job alone receives production environment secrets.
- Pin official GitHub actions to reviewed immutable commit SHAs, not floating branches.

### Parallel validation jobs

There is no root npm workspace. The unused root `package-lock.json` has been removed. Each workflow runs `npm ci` in the relevant package directory and caches against that package's own lockfile.

Use stable, documented required-check names so branch protection does not silently stop enforcing validation after workflow refactors. Target feedback in a few minutes by parallelizing independent jobs and caching dependencies, but record actual command durations before deciding which suites can be split safely.

#### Backend

1. Use the pinned Node 22.23.2 and npm 10.9.8 pair and fail if the runner does not expose that exact pair.
2. Run `npm ci` from `be`.
3. Run `npm run check`.
4. Run `npm test -- --runInBand` initially for memory safety, then optimize only from measured CI timings.
5. On pull requests and trusted releases, run `npm run build:prod`, including compiled-monitoring-model verification.
6. In the release workflow, upload `be/dist` as a one-day handoff artifact for the packaging job. Do not commit it.

The backend currently has no separate lint script, so Phase 2 does not claim a backend lint gate.

The pull-request and release workflows now define a disposable PostgreSQL 16.10 service. They migrate a fresh database, invoke the migration runner a second time, verify the complete applied migration set and selected schema/index/foreign-key invariants, and query every registered compiled Sequelize model. On 2026-09-14 the same gate passed locally from an empty PostgreSQL 16 database: 189 migrations applied on the first run, the second run was a no-op, 165 public tables passed the schema checks, and all 159 compiled models queried successfully. Reviewed hosted pull-request run `34902107741` is the authoritative hosted-run proof for the current checkpoint. Tests that require external integrations must use disposable test credentials or mocks and must never receive production secrets.

#### UI

1. Run `npm ci` from `ui`.
2. Run `npm run check`.
3. Run `npm test -- --watchAll=false` (or the equivalent stable CI command) with watch mode disabled.
4. Build with the run-specific `REACT_APP_RELEASE`, full `REACT_APP_GIT_SHA`, and source maps enabled. The trusted release job explicitly deletes tracked/stale output first.
5. Stamp `release-metadata.json` and validate `asset-manifest.json`, `index.html`, service worker assets, PWA manifests, referenced/lazy assets, release consistency, and usable source-map coverage.
6. In the release workflow, upload `ui/build` as a one-day handoff artifact for the packaging job.

No value prefixed with `REACT_APP_` may contain a secret because those values are public in the browser bundle.

#### UI server

1. Run `npm ci` from `ui-server`.
2. Run all Node tests.
3. Run `node --check` on every checked-in JavaScript file below `ui-server`, excluding `node_modules`.
4. Verify that a missing or inconsistent UI artifact causes preflight validation to fail.

The release workflow runs these application jobs in parallel where dependencies permit, then packages only after every required job and the PostgreSQL migration gate succeed.

### UI build tracking transition

The target architecture does not commit generated `ui/build` files. GitHub Actions builds and validates the UI directly from the source SHA, and the resulting files exist only inside the immutable release artifact and retained production release directories. The workflow must not create generated commits or bot pull requests for `ui/build`.

The artifact deployment and rollback drill completed on 2026-09-23. The legacy Git-tracked build is no longer a production source; GitHub Actions release artifacts are authoritative for deployment.

Phase 6 cleanup completed the transition steps:

1. Update `AGENTS.md` and the deployment documentation so the artifact is the authoritative UI build source.
2. Add `/ui/build/` to `.gitignore`.
3. Run `git rm -r --cached ui/build` so generated files remain local when needed but disappear from the tip of `master`.
4. Confirm the production deploy and rollback scripts no longer read UI assets from the Git checkout.
5. Commit the untracking and instruction changes as one dedicated, reviewable cleanup.

Do not rewrite Git history as part of this transition. Historical UI bundles may remain in old commits; any future repository-history cleanup is a separate operation.

## Required application changes

### Backend scripts

Implemented in Phase 1: compilation is separated from artifact execution:

- `build:prod`: compile and verify only.
- `start:runtime`: start `scripts/startMonitored.js dist/app.js` without compiling.
- `migrate:runtime`: run the compiled migration runner without compiling.
- `sync-access-control:runtime`: run the compiled sync script without compiling.
- Remove the TypeScript compile from `postinstall`.

Keep `scripts/startMonitored.js`; starting `dist/app.js` directly would lose monitoring of early import/startup failures.

Move TypeScript, build tools, and type-only packages to development dependencies where safe. Do this in a separate reviewed dependency commit.

### Backend readiness

Implemented in Phase 1: `/api/health/live` remains process-only, while `/api/health/ready` verifies:

- The HTTP process is accepting requests.
- The database responds through a bounded, coalesced, briefly cached lightweight query, so repeated readiness requests do not create an unbounded query backlog.
- Required runtime configuration is loaded.
- The running release ID and Git SHA are valid and exposed for the deployment verifier to compare with its expected release.

Production readiness requires `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, a valid `APP_VERSION`, and a full 40-character `GIT_COMMIT_SHA`. Migration state is deliberately enforced by the release/deployment gate rather than the request-time endpoint today.

### UI server

Implemented in Phase 1: the UI server accepts environment-configurable paths:

- `UI_BUILD_PATH`
- `UI_TLS_KEY_PATH`
- `UI_TLS_CERT_PATH`
- Existing private source-map and telemetry paths must point to persistent storage.

`UI_EXPECTED_RELEASE` binds startup to the expected browser release. A local `/healthz` endpoint reports the release ID and artifact-validation status without exposing secrets.

UI preflight fails before listening when TLS material, the index, manifest, referenced hashed assets, service worker, or expected release metadata is missing or inconsistent.

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
  health.js
  runtimeConfig.js
  uiArtifactValidation.js
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
- Workflow run ID, run attempt, run number, actor, and immutable artifact name.
- Workflow name/path, trigger event, ref, head SHA, and repository identity.
- An explicit production-candidate decision that is true only for the canonical repository, reviewed workflow path, `push` event, and `refs/heads/master` provenance.

The Phase 2 release job uploads the tar archive and a detached SHA-256 checksum covering the complete archive, including its manifest, as one GitHub Actions artifact named with the release ID. The internal manifest verifies every payload file; the detached archive checksum protects the manifest and archive as a whole. The release is created without production credentials or host access and is retained for 90 days. Never overwrite an artifact identifier. Production must not depend on GitHub retention for rollback because it will keep verified releases locally. A durable GitHub Release is optional later if longer retention is required.

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
4. Fail closed unless free space covers the incoming archive, temporary extraction, candidate release, dependency layer, a newly verified database backup, and the retained-release floor with an explicit safety margin. Phase 0 observed approximately 6.3 GB free before a 967 MB backup and a 2.29 GB restored database, so this check cannot be inferred from current usage alone.
5. Verify the outer SHA-256 checksum before extraction.
6. Reject absolute paths, `..` traversal, symlinks escaping the release, unexpected owners, and unexpected artifact contents.
7. Extract to a new temporary release directory.
8. Validate every manifest file and checksum.
9. Confirm Node/npm compatibility and prepare lock-hash dependency directories.
10. Attach server-owned environment, uploads, logs, runtime, TLS, and source-map locations.
11. Run all preflight checks.
12. Determine whether migrations are pending and, before any schema change, invoke the validated server-owned backup command configured during Phase 0. Require a newly created, non-empty backup and record its path/checksum; an exit code alone is insufficient.
13. Run the compiled migration command once.
14. Save the current backend pointer as the previous backend.
15. Atomically switch the backend pointer and restart the single PM2 backend process in fork mode.
16. Poll local readiness and require the expected release ID.
17. If backend readiness fails, restore the previous backend pointer and restart it.
18. Save and switch the UI pointer only after backend success.
19. Restart the UI server with the matching release ID.
20. Verify the main public homepage, `transaction.omni-lodge.com`, `counter.omni-lodge.com`, the web manifest, main hashed asset, API health, required proxy/WebSocket paths, and public source-map denial.
21. If UI verification fails, restore the previous UI pointer without rolling back the healthy backend unless compatibility requires both to roll back.
22. Persist the PM2 process list and write an auditable deployment record containing the release/run/artifact identity, trigger mode, actor, timings, checks, and rollback result.
23. Keep the current and at least three previous releases; prune only releases not referenced by current/previous pointers.

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

Store `PRODUCTION_DEPLOY_MODE` as a repository configuration variable, not an environment variable or secret, so the workflow can evaluate it before a production job is scheduled. Start at `disabled` during bootstrap, move to `manual` for the first controlled releases, then switch to `automatic` only after controlled deploy and rollback evidence is sufficient. Current setting: `automatic`.

Enable required reviewers during the first controlled releases, prevent self-review where practical, disallow administrator bypass, and restrict deployment branches when supported by the repository's GitHub plan. Environment protections are independent of the deployment-mode switch, and environment secrets must not become available until those protections pass. On 2026-09-23 the owner explicitly approved fully unattended automatic deployment; the required reviewer gate was removed, while the production environment remains restricted to the exact `master` branch.

GitHub Actions must use only the dedicated deployment key; it must never receive the root password. The owner has explicitly chosen to retain the existing root credential as a narrow accepted-risk exception. Do not describe that credential as secure or generalize the exception to future leaks. After the deploy user/key and rollback path are proven, disabling routine root/password SSH login remains recommended separate hardening rather than part of the first cutover.

## Explicit non-goals

This roadmap does not introduce Docker, Jenkins, Kubernetes, complex GitFlow, permanent `develop`/`staging`/`release` branches, a PM2 replacement, preview environments, or a migration of application hosting to Cloudflare. Existing Cloudflare DNS, TLS proxying, and email ingress remain in place unless a separate project changes them.

The native Android/Google Play project is not built or released by this VPS pipeline. It may consume the deployed web application, but its store build/signing/release process needs a separate roadmap if automation is desired.

A staging environment is optional later. If added, it must receive the same verified `master` artifact that is eligible for production; it does not get a staging source branch or a rebuild.

## Phased implementation

### Phase 0: Baseline inventory and workflow contract

Current status: **complete**. The checked-in [production runtime contract](production-runtime-contract.md) records the selected toolchain, package boundaries and commands, repository/release controls, verified host topology and mutable paths, maintenance controls, and public smoke routes. The sanitized root inventory, backup/restore proof, and production-shaped migration proof are recorded in [Production Phase 0 Evidence — 2026-09-16](production-phase0-evidence-2026-09-16.md).

- Inventory and record the exact local and production Node/npm versions, package scripts, build outputs, lockfiles, and expected CI commands. Select one exact Node 22/npm pair instead of relying on the current machine's incidental npm version.
- Confirm that `be`, `ui`, and `ui-server` are independent npm projects and decide whether the unused root `package-lock.json` should be removed.
- Inventory production read-only before changing it: current checkout path, PM2 process names/mode/cwd/start commands, service user, ports, Node/npm path, TLS ownership, persistent paths, upload/log/source-map locations, database migration state, server-owned backup command, and existing maintenance/deploy controls.
- Record all public smoke-test origins and critical routes, including the main site, transaction shortcut domain, counter shortcut domain, API, proxy, WebSocket, PWA, and source-map denial behavior.
- Inventory repository rules, collaborators with write access, and legacy branches. Define the required PR check names, merge-freshness policy, branch cleanup policy, release naming, artifact retention, production environment, `PRODUCTION_DEPLOY_MODE`, whether an administrator-only server allow flag is needed, and owners of approval, emergency freeze, and rollback.
- Add a non-secret checked-in deployment contract or PM2 ecosystem description after the inventory. Do not copy production secrets into it.
- Update the delivery status matrix with anything that changed since this review.

Recorded on 2026-09-14 and completed on 2026-09-16:

- Node 22.23.2/npm 10.9.8 selected; independent package-local lockfiles and CI command contract recorded.
- Repository rules, protected production environment, disabled deployment mode, release naming/retention, ownership, and branch policy recorded.
- Public homepage, proxied health, companion-domain, manifest, hashed-asset, PWA, and source-map-denial checks recorded; there is no application WebSocket route to test today.
- Root verification confirmed the exact live and saved PM2 definitions, process paths, one-instance fork topology, restart/watch settings, systemd ownership, listeners, PostgreSQL 16.8, and rollback fallback.
- Effective mutable paths and permissions were reviewed. Sensitive runtime files were permission-restricted without restarting the application, and one unexplained untracked file was moved recoverably into root-only quarantine without reading or deleting it.
- Against the deployed production checkout, production had 185 applied migrations, zero pending or unknown migrations, a successful latest audit, and runtime schema sync disabled. The pull-request branch added four migrations. A fresh 966,676,562-byte backup passed archive validation and a full isolated restore with 165 public tables on PostgreSQL 17.5; the PostgreSQL 16.10 CI gate remains the runtime-version proof.
- The exact branch then upgraded that production-shaped restore by four migrations; the second run was a no-op, the 189 compiled/applied names matched exactly, and all 159 compiled models queried successfully. The disposable restore was dropped afterward.
- Both PM2 processes remained online and local health, proxied public health, and the public UI returned HTTP 200 after the inventory and permission hardening.
- The owner accepted the known risk of retaining the historically public Origin CA key. Rotation is deferred; server-owned placement, explicit runtime paths, artifact exclusion, and removal from the Git tip remain mandatory before cutover.

Exit condition: **met**. The actual production/runtime contract and exact CI commands are reviewed and recorded. Phase 0 made only permission hardening, fresh-backup creation, and recoverable quarantine changes; it did not deploy code, restart a process, alter the production schema, or activate different TLS material.

### Phase 1: Reproducible builds

Current status: **complete for build reproducibility and merged to `master` in PR #16**. Release-path activation is intentionally separate Phase 3+ work.

- Pin the exact selected Node 22 and npm versions.
- Add engine/package-manager metadata to all three packages.
- Split backend build/runtime scripts and remove compile-on-install.
- Add tests for the runtime-only commands.
- Add configurable UI build/TLS paths and strict UI artifact validation.
- Add release-aware liveness/readiness endpoints.

Implemented results:

- Node 22.23.2/npm 10.9.8 are pinned in `.nvmrc` and all three package manifests.
- Backend artifact runtime commands start, migrate, and sync access control without compiling; legacy compile-on-start aliases remain only for the transition.
- Production readiness validates the complete required configuration and full Git SHA, probes PostgreSQL with timeout/coalescing/caching, and is rate limited separately from application traffic.
- The UI server accepts explicit build/TLS paths, validates TLS and the complete expected UI artifact before listening, and reports release/artifact status at `/healthz`.

Exit condition: local tests pass and starting an already-built backend performs no compilation.

### Phase 2: CI without deployment

Current status: **implemented, independently reviewed, merged to `master` in PR #16, and proven by the first trusted `master` release run `35459235360` for `0ff723bafc588970d2650dc435dbc8a2b4d469de`**. No Phase 2 job contacts production.

- Add parallel backend, UI, and UI-server jobs.
- Add dependency caching keyed by each lockfile.
- Establish fast `codex/**` push checks, the short-lived branch/draft-PR flow, stable required checks, authoritative merge-result validation, and per-branch/per-PR concurrency cancellation.
- Build and validate the UI from the source SHA without committing generated output.
- Add the disposable PostgreSQL fresh-migration, integration-verification, and second no-op migration gate.
- Generate and validate the combined release artifact and manifest.
- On every `master` push, rebuild the merged SHA cleanly and publish a production-eligible artifact distinct from all branch artifacts.
- Upload artifacts; do not contact production.

Implemented results:

- `.github/workflows/ci.yml` has parallel backend, UI, UI-server, and pull-request-only migration jobs, with stable `CI / required` and `Branch / required` aggregates.
- `.github/workflows/release.yml` rebuilds every pushed `master` SHA in clean jobs, uses one-day backend/UI handoff artifacts, and publishes one 90-day combined artifact named with the immutable release ID.
- The CI and release workflows pin the exact Node/npm pair, use package-local npm caches, use SHA-pinned official Actions, and run with `contents: read`.
- The UI validator stamps and checks exact release metadata, all referenced assets, PWA files, hashed assets, and usable source maps.
- The PostgreSQL job performs two migration runs and validates the applied migration inventory, selected schema/index/foreign-key invariants, and every compiled Sequelize model.
- The earliest migration reconstructs the historical pre-Umzug schema on an empty database, creates only missing tables on an existing database, and has an intentionally non-destructive no-op `down`.
- Explicit, idempotent bridges now own profile fields, report preview ordering, and legacy physical timestamp names that production previously acquired through Sequelize sync; their rollback paths preserve pre-existing data.
- The complete PostgreSQL gate passed locally from empty state (189 migrations, zero second-run changes, 165 public tables, and 159/159 compiled models) before the first GitHub run.
- Reviewed hosted pull-request run `34902107741` succeeded, with backend, UI, UI-server, migrations, and `CI / required` all green. Reviewed branch push run `34902103089` was also green, with migrations intentionally skipped by the branch workflow.
- A fresh production backup was restored in isolation on 2026-09-16. Four branch migrations applied successfully to that production-shaped copy, a second run applied zero steps, all 189 compiled/applied migration names matched, and all 159 compiled models queried successfully. Production itself was not migrated.
- `master` now strictly requires the GitHub Actions app-bound `CI / required` check, and repository branch auto-delete after merge is enabled.
- Backend and UI producer trees pass the packager's recursive preflight before upload and again after download. The release packager uses an explicit runtime-file contract, rejects special/escaping or credential-like content, enforces file/count/archive limits, requires canonical manifest/archive bytes, publishes without overwriting an existing release, records file hashes and workflow provenance, emits a detached archive checksum, and distinguishes a canonical `master` release candidate from non-production inputs.
- The release workflow has no `workflow_dispatch`, production environment, deployment secret, SSH connection, host mutation, or automatic-deployment step. Those remain deployment-workflow responsibilities outside release packaging. The separate deploy-production workflow validates trusted release evidence, creates a host request artifact, uses a protected submit job, polls terminal host status, and has completed approved production deploy requests.

The manifest's candidate flag is not deployment authorization. Phase 3 must independently obtain the successful GitHub run and immutable artifact identity, pass that external evidence to the strict verifier, and complete any security-review findings before credentials or host access are introduced.

Exit condition: multiple real runs from the same source produce an equivalent release payload apart from declared metadata, branch artifacts cannot pass the production eligibility verifier, the fresh-database gate succeeds, and no production secret is requested by build jobs. Pull-request and branch CI have run successfully, and the first trusted `master` release run succeeded after the PR #16 merge.

### Phase 3: Production host preparation

Current status: **complete**. The forced SSH/sudo boundary, host v2 protocol endpoint, durable request/audit state, detached worker, root-owned host layout, and non-activation staging proof are implemented and proven on production. Later phases completed dry-run validation, public cutover, rollback, and post-rollback redeploy.

Endpoint slice starting checkpoint, 2026-09-21:

- Next work item is deliberately limited to replacing the plain-text fail-closed root submitter with a protocol-aware endpoint that receives host v2 frames, validates freshness, rederives host policy from `/etc/omnilodge/deploy-policy.json`, records bounded non-secret audit/request state, and returns canonical host v2 response frames.
- This slice must not activate a release, switch PM2 pointers, run migrations, install dependency layers, start a detached worker, or implement rollback.
- A successful endpoint-only manual `dry-run` proves the forced SSH/sudo/protocol boundary, not production staging. The release extraction/staging worker remains a separate follow-up.

Endpoint slice completion checkpoint, 2026-09-21:

- The repository now contains a protocol-aware endpoint-only root submitter. `/usr/local/sbin/omnilodge-deploy` remains a no-argument, root-only wrapper, but now execs `/usr/bin/node` against the installed immutable control-plane copy at `/usr/local/libexec/omnilodge/control-plane/ops/production/libexec/deploy/submit-request.mjs`.
- Bootstrap now installs the reviewed endpoint and its protocol/state/policy dependencies under the preserved `control-plane` subtree, creates the missing request nonce and audit segment directories, and verifies installed control-plane files against reviewed source bytes.
- The endpoint receives host v2 frames, validates request freshness, re-derives policy from the root-owned host deploy policy, admits requests through the nonce/state store, appends bounded audit events, cleans the transient artifact ZIP in this endpoint-only phase, and returns canonical host v2 response frames. Authorized submit requests are deliberately finished as `REQUEST_REJECTED` until the detached worker/staging path exists; disabled forward deploys are `POLICY_DENIED`; malformed frames fail closed without echoing request bytes.
- Focused local validation passed with `node --test ops/production/bootstrap-assets.test.mjs ops/production/host-state-primitives.test.mjs ops/production/host-submit-endpoint.test.mjs scripts/deploy/host/protocol.test.mjs scripts/deploy/submit-host-v2-request.test.mjs` plus `node --check ops/production/libexec/deploy/submit-request.mjs` and `git diff --check`.
- Hosted verification passed in PR #20. The merge result is `5618c663ecac1a81aef27c7a593de19d9dffbb35`; trusted release run `35632794270` succeeded and produced artifact `omnilodge-r35632794270-a1-5618c663ecac` (`10655341770`). The automatic production deploy-request run `35633402178` completed with its prepare job reporting the disabled-mode skip and its submit job skipped, so no host connection or production mutation occurred.
- This remains repository-only and not installed on production. No release was activated, no PM2 pointer was switched, no migration or dependency install ran, no detached worker was started, and no rollback path was implemented.

Host install/dry-run starting checkpoint, 2026-09-21:

- This slice is deliberately limited to installing the already-reviewed endpoint/control-plane bootstrap assets on the production host, validating the installed files and privilege boundary, and attempting endpoint-only `dry-run` evidence.
- This slice must not activate a release, switch PM2 pointers, run migrations, install dependency layers, start a detached worker, enable automatic deployment, or implement rollback.
- `PRODUCTION_DEPLOY_MODE` remains `disabled` unless explicitly changed later. A successful endpoint-only `dry-run` may prove the forced SSH/sudo/protocol boundary, but authorized submit requests are still expected to be rejected until the worker/staging path exists.

Host install access checkpoint, 2026-09-21:

- Non-interactive root SSH from the local operator workstation is not available; root login with existing keys is denied and the root password was not placed into a command, log, repository file, or automation.
- The retained deploy key currently authenticates as `omnilodge-deploy`, but the host has not yet installed the forced-command SSH boundary: the account opens a normal deploy-user shell, has no passwordless sudo, and cannot access the root-owned `/root/omni-lodge` checkout.
- The next safe action is a one-time root operator bootstrap from the trusted production checkout: copy the retained deploy public key into `/etc/ssh/authorized_keys/omnilodge-deploy`, run `sudo sh ops/production/bootstrap-primitives.test.sh`, `sudo sh ops/production/bootstrap-host.sh --check`, `--dry-run`, and `--install`, then verify metadata with the README commands. That still must not restart app services, switch PM2 pointers, run migrations, stage a release, or enable automatic deployment.

Host install completion checkpoint, 2026-09-21:

- The production checkout was fast-forwarded to `cfe64ed1c05552278aebf36c99fcdfa64410d500`, and the reviewed bootstrap/control-plane assets were installed on the host in fail-closed mode. No release was activated, no PM2 pointer was switched, no migration ran, no dependency layer was installed, no detached worker was started, and no application service was restarted or reloaded.
- Two host-observed bootstrap compatibility fixes were reviewed through PRs before final installation: PR #23 (`dc7ce4dfa682ea9c3f175bcd570765f7228c06ca`) accepts Ubuntu's escaped `sudo -l` rendering for the exact no-argument deploy command, and PR #24 (`cfe64ed1c05552278aebf36c99fcdfa64410d500`) keeps the retained deploy public key root-owned while making the external `AuthorizedKeysFile` readable/traversable by OpenSSH (`0755` directory, `0644` public key file). Both PRs passed required CI before merge.
- Bootstrap verification passed on production after install. Verified metadata included `/etc/ssh/authorized_keys` as `root:root 755`, `/etc/ssh/authorized_keys/omnilodge-deploy` as `root:root 644`, `/etc/omnilodge` as `root:root 700`, root-owned `0600` policy/runtime env placeholders, `/usr/local/sbin/omnilodge-deploy` as `root:root 755`, and `/usr/local/libexec/omnilodge/ssh-gateway` as `root:root 755`. `visudo -cf /etc/sudoers.d/omnilodge-deploy` and `sshd -t` passed.
- SSH was reloaded only to apply the restricted deploy-account Match block; the SSH service remained active. A normal deploy-user shell command was refused by the gateway with `unsupported command`, proving the deploy key no longer opens an interactive shell.
- A dummy endpoint-only host-v2 `dry-run` request submitted through `omnilodge-deploy-v1` returned canonical response `REQUEST_REJECTED` with `responseStatus: rejected` for request `2ba75f7d-0124-4ab6-8358-39ef0b7d9111`, which is the expected endpoint-only result while the detached worker/staging path is intentionally inactive. `/opt/omnilodge/incoming` remained empty after cleanup; bounded request/audit state was recorded under `finished/`, `nonces/`, and `audit/segments/events.ndjson`.
- The latest trusted `master` release after these bootstrap fixes is run `35643392241`, artifact `omnilodge-r35643392241-a1-cfe64ed1c055` (`10659740944`). The automatic deploy-request run `35644082008` completed with disabled-mode skip evidence and did not create or submit a host request. `PRODUCTION_DEPLOY_MODE` remains `disabled`.

Detached worker/staging starting checkpoint, 2026-09-21:

- This slice is deliberately limited to accepting authorized host-v2 forward requests into durable pending state and adding a detached root worker path that can stage, verify, and extract the release artifact into release/dependency candidate locations without changing live pointers or traffic.
- This slice must not activate a release, switch PM2 pointers, restart app services, run migrations against production, enable automatic deployment, implement rollback, or change `PRODUCTION_DEPLOY_MODE`.
- A successful staging-only dry-run should end in a terminal rejected or staged state with sanitized audit evidence, cleaned transient upload bytes, and no changes to the live legacy checkout/PM2 process.

Detached worker/staging completion checkpoint, 2026-09-21:

- The repository now has a root worker entrypoint that accepts a single canonical request ID from the inactive systemd template, transitions the durable request from pending/running, appends running/finished audit events, verifies the raw GitHub artifact ZIP against authenticated evidence, extracts the trusted inner release archive into `/opt/omnilodge/releases/<releaseId>` if it is not already present, writes release-preparation plan/state/evidence under `/var/lib/omnilodge/deploy/state`, cleans transient incoming ZIP/evidence bytes, and marks non-activation `stage`/`dry-run` requests succeeded.
- Authorized `deploy` requests still fail after staging with `REQUEST_FAILED` because activation is intentionally not enabled in this slice. No PM2 pointer is switched, no service is restarted, no migration runs, no dependency layer is installed, and no rollback path is implemented.
- The endpoint now persists authorized forward payloads under request-id names, starts `omnilodge-deploy-worker@<requestId>.service` with `systemctl --no-block`, and returns canonical `REQUEST_ACCEPTED`. Policy-denied deploys and malformed/stale frames still fail closed and clean temporary artifacts.
- Bootstrap assets now install the worker module, raw artifact extractor, and `/var/lib/omnilodge/deploy/staging`; CI/release trust tooling now includes endpoint and worker tests.
- Local verification passed on Windows on 2026-09-21: the focused production deploy set (`bootstrap-assets`, endpoint, worker, state primitives, release preparation) passed 48 tests with 7 platform skips, and the broader release/deploy trust tooling suite passed 257 tests with 10 platform skips.
- PR #26 installed the detached staging worker path into `master` and release run `35648620252` passed. Follow-up production proof exposed host-layout issues that were fixed through reviewed PRs #28, #29, and #30: `systemctl` resolution now supports Ubuntu's `/bin/systemctl`, filesystem-root trusted layouts are accepted correctly, and bootstrap creates `/var/lib/omnilodge/deploy/installer-home`.
- Production control-plane install for merge `8a11a7caef30225557d56ef6c998c5ca4590685f` passed `bootstrap-primitives`, `bootstrap-host --install`, and `bootstrap-host --check`. Host policy is `manual`; repository `PRODUCTION_DEPLOY_MODE=disabled` still caused the automatic deploy-request workflow `35657678587` to skip without contacting the host.
- Approved manual stage run `35657904294` submitted release artifact `omnilodge-r35657136245-a1-8a11a7caef30` (`10664947619`) from trusted release run `35657136245`. Production request `64659566-a92c-4b33-b298-4cd0c4da8906` finished as `REQUEST_SUCCEEDED`, created `/opt/omnilodge/releases/omnilodge-r35657136245-a1-8a11a7caef30`, wrote release-preparation plan/state/extraction result under `/var/lib/omnilodge/deploy/state`, and left `pending=0`, `running=0`, and `incoming=0`.
- Additional production readiness checks on 2026-09-21 verified `/usr/bin/node` `22.23.2`, `/usr/bin/npm` `10.9.8`, executable `/bin/systemctl`, safe root-owned directory modes, clean queues, valid staged-release preparation plans for every staged release, and sufficient dependency-layer capacity using the conservative trusted budget. No release activation, service restart, production migration, dependency-layer publication, live pointer switch, or rollback was performed.

Implemented repository foundations:

- The compiled backend artifact exposes a read-only migration-status command and a runtime preflight. The preflight binds the canonical release identifier to the source SHA, applies the shared fail-closed migration-lineage and safety checks, requires schema sync and access-control seeding to be disabled for artifact runtime, proves read-only database access, and smoke-tests Sharp and Puppeteer using a fixed cache location.
- A strict, versioned host protocol and client define bounded binary frames, exact end-of-input handling, canonical JSON, exact request schemas, release/evidence/archive binding, an independent server-side deployment-mode policy, and sanitized response codes.
- Production bootstrap/runtime assets define intended fixed release, dependency, configuration, persistent-data, cache, lock, PM2, systemd, SSH, log, and recovery locations. The deployed submitter and detached worker can stage verified release candidates, run dry-run dependency/link/cache/preflight/private-smoke checks, and poll terminal request status. Recovery and activation code paths exist in the repository but still require the first controlled cutover and rollback-drill proof before operational use.
- The existing restricted deploy account and existing Ed25519 deploy key are retained without rotation. The intended installation moves the retained public key authorization to a root-owned external `AuthorizedKeysFile`; no private key material is added to the repository, artifacts, or documentation.
- A deploy-request workflow validates a successful trusted `master` release through the GitHub API, honors `PRODUCTION_DEPLOY_MODE`, downloads the raw immutable artifact, and writes a host v2 forward request plus sanitized identity evidence as a short-retention Actions artifact. Manual `stage` and `dry-run` requests can be prepared while the mode is `disabled`; automatic requests are skipped unless the mode is exactly `automatic`. The protected production-environment submit job downloads the prepared request, verifies the pinned host key fingerprint, streams the frame through SSH, validates the protocol response, polls terminal host request status, and uploads sanitized submit/status evidence.

Post-Phase-3 carry-forward status:

- Activation, migration, backup, readiness, smoke, rollback, and deployment-mode enablement were intentionally deferred out of Phase 3 and completed or proven in Phases 4-5.
- Historical Phase 3 carry-forward: automatic production deployment remained intentionally disabled by repository mode (`PRODUCTION_DEPLOY_MODE=manual`) until Phase 6 operational evidence was sufficient.
- The audit-log size-cap issue found during the rollback drill is Phase 6 operational hardening, not a Phase 3 blocker.

- Decouple TLS from the checkout and artifacts by placing the retained Origin CA pair in a permission-restricted server-owned path and using explicit runtime paths. Under the documented owner-accepted exception, rotation is deferred hardening rather than a cutover prerequisite.
- Replace the migration runner's broad empty-`sequelize_meta` adoption heuristic with an explicit, fingerprinted, fail-closed legacy adoption procedure. An unknown or partially constructed schema must never be marked as fully migrated merely because one application table exists.
- Strengthen migration drift checks so a same-named index or constraint is accepted only when its columns, uniqueness/type, and foreign-key target also match the expected definition.
- Make migrations authoritative for schema changes before artifact deployment. Production startup must set `SKIP_DB_SYNC=true`, and the application must fail clearly rather than silently repairing schema through `sequelize.sync()`.
- The release, dependency, configuration, cache, and persistent-data directories now exist from bootstrap; keep them root-owned and do not repurpose them outside the deploy workflow.
- The existing restricted deploy user/key is retained, and its public authorization is installed through the root-owned restricted SSH configuration. Do not rotate it as part of this roadmap unless the owner changes direction.
- Recovery, validation/deploy activation, manual forward deploy, conditional automatic request path, and always-manual rollback workflow are now implemented and proven through later phases.
- PM2 now uses stable current-release pointers only after candidate staging, runtime env/TLS, backup, migration, readiness, smoke, and rollback/recovery gates.
- Historical Phase 3 carry-forward: keep `PRODUCTION_DEPLOY_MODE=manual` while the first operational releases are observed. Phase 6 later moved production to automatic mode after rollback and operational evidence. Do not place production runtime secrets in the build workflow.
- Preserve retained managed release snapshots for normal rollback. The legacy checkout baseline was useful for the drill but should not be the preferred future rollback target.

Exit condition: **met**. A real trusted `master` release artifact traversed the protected GitHub submit job, forced SSH/sudo/protocol endpoint, detached root worker, authenticated artifact extraction, release-preparation plan/state writing, transient cleanup, and terminal host request state without changing the live application. Later phases then completed dependency publication, migrations, private-port smoke tests, traffic switching, and rollback proof.

### Phase 4: Dry-run release

Current status: **complete**. Production dry-runs have verified trusted release transfer/extraction, dependency-layer publication/reuse, managed links, Puppeteer browser-cache preparation, migration-status, runtime-preflight, and private backend/UI smoke checks without public pointer switching.

Current branch checkpoint, 2026-09-22:

- Keep `stage` lightweight: it only verifies/transfers/extracts the trusted release and writes release-preparation evidence.
- Extend explicit manual `dry-run` to publish or reuse immutable backend and UI-server dependency layers, recalculating disk/inode capacity before each component so a proof cannot be reused after host state changes.
- After dependencies exist, prepare the staged release's local managed symlinks (`node_modules`, logs, runtime directories) and write bounded dependency/link evidence under `/var/lib/omnilodge/deploy/state`.
- Prepare Puppeteer's browser cache through the reviewed backend package entrypoint after dependencies are linked, because global dependency installation intentionally keeps `npm ci --ignore-scripts`.
- Run the backend migration-status reporter and runtime preflight from the staged release using `/usr/bin/node`, `/etc/omnilodge/backend.env`, and the release-local backend directory; record only bounded JSON results and command shape, not environment contents.
- Still do not switch live pointers, restart app services, run migrations, expose private test ports, change repository deploy mode, or implement rollback in this checkpoint.
- Local production-control validation on Windows passed with `node --test ops/production/*.test.mjs` (57 tests, 50 passed, 7 Windows/POSIX skips, 0 failures); POSIX shell, POSIX ownership/mode, and symlink behavior must still be proven by Linux CI/host checks.

Interim host proof checkpoint, 2026-09-22:

- Trusted release run `35662622715` produced artifact `omnilodge-r35662622715-a1-3dbb99b22425` (`10667159465`) for merge `3dbb99b224250c00ad6b58d8511e6e12f1a01ee9`. Its automatic deploy-request run `35663042530` skipped as expected because repository `PRODUCTION_DEPLOY_MODE=disabled`.
- Production control-plane assets were installed from an isolated, root-owned archive of that merge and passed `bootstrap-primitives` plus `bootstrap-host --check`; the legacy live checkout was not fast-forwarded for this install.
- Manual dry-run request `43916851-9941-4b15-9195-4ddb84aa93d1` first exposed that `/etc/omnilodge/backend.env` was still the bootstrap placeholder, so migration-status/preflight could not read the production DB configuration. The server-owned backend env was populated from the currently running backend PM2 environment without printing values, with artifact safety flags forced to `SKIP_DB_SYNC=true`, `DB_SYNC_ALTER=false`, and `SEED_ACCESS_CONTROL=false`.
- Direct continuation proved dependency publication/reuse, managed links, Puppeteer browser-cache preparation, migration-status, and runtime preflight can pass for the staged release. A fresh official dry-run request `9b8efe79-4708-4c3c-a9ed-5bbe07ca0df4` then exposed an idempotency gap: dependency publication-state inspection still required an unlinked release and failed once the managed links existed. This branch fixes that check to validate release snapshots with `linkState: auto`, preserving the managed-link allowlist while allowing safe dry-run replay.
- The next official dry-run request `b6f14aba-485e-4ec3-b81e-e0401604ef38` on release `omnilodge-r35665519539-a1-35f1abaf7b6c` then exposed that the 30-second capacity proof freshness window is too short after dependency layers exist, because dependency tree sealing can consume most of the window before the proof is checked. The follow-up fix raises the deploy-control capacity proof window to the validator's existing five-minute upper bound while still recalculating capacity before each component.
- No activation, live pointer switch, app restart, production migration, automatic deployment enablement, private-port smoke, or rollback action was performed.

Dry-run completion checkpoint, 2026-09-22:

- Release run `35667111052` for merge `53e71612c2cb952e19fc353a9dfb91e149531c05` succeeded and produced artifact `omnilodge-r35667111052-a1-53e71612c2cb` (`10669604146`). Automatic deploy-request run `35667568269` skipped as expected with repository `PRODUCTION_DEPLOY_MODE=disabled`.
- Production control-plane assets from that merge were installed from an isolated, root-owned source archive and passed `bootstrap-primitives` plus `bootstrap-host --install`/`--check`; the installer reported that no service was enabled, started, restarted, reloaded, or switched.
- Manual dry-run request `db257a48-8ac4-4d8c-a10f-f6f336ea2a8c` completed with `REQUEST_SUCCEEDED`. It verified/transferred/extracted the release, reused the existing backend and UI-server dependency layers, prepared seven release-local managed links, prepared the Puppeteer browser cache, and passed both backend migration-status and runtime-preflight checks.
- Host queues were clean afterward (`pending=0`, `running=0`, `incoming=0`), and host policy remained `manual`. No activation, live pointer switch, app restart, production migration, automatic deployment enablement, private-port smoke, or rollback action was performed.

Private-port smoke implementation checkpoint, 2026-09-22:

- The dry-run worker now starts the staged backend and UI-server release on ephemeral `127.0.0.1` ports after dependency/link/cache/preflight preparation, then shuts both candidate processes down without touching PM2 current-release pointers or public traffic.
- Backend private smoke checks `/api/health/ready` and requires the staged release ID, source SHA, `APP_RUNTIME_MODE=dry-run`, valid configuration, and database readiness. UI-server private smoke checks `/healthz`, `/`, and public source-map denial for the staged release using the server-owned TLS path contract.
- The private-smoke wait loop must keep the worker process alive while waiting for candidate readiness; readiness polling timers are intentionally referenced so a not-yet-ready candidate cannot leave the request stuck in `running`.
- Dry-run evidence records only bounded command shape, ports, release identity, health/static/source-map results, and TLS path names; it does not record environment file contents or secrets.
- Production proof for release `omnilodge-r35672017886-a1-9b87e417ebf7` exposed a backend runtime-contract gap: request `5971664f-165a-4efb-8e97-6b92865c126f` reached private smoke but the staged backend exited because `APP_RUNTIME_MODE=dry-run` was not accepted by backend startup validation. This branch makes `dry-run` an explicit safe backend runtime mode with the same no-mutation/no-background-job policy as `deployment-candidate`.
- PR #38 merged the backend runtime fix into `master` as `e350d29f46241be6fc156cb0dca1f8a53a1c20a2`; trusted release run `35673952541` succeeded and produced artifact `omnilodge-r35673952541-a1-e350d29f4624` (`10672506483`). The automatic deploy-request run `35674331289` completed with disabled-mode skip evidence and did not submit a host request.
- Manual dry-run request `08239b4c-3bf8-45b8-9069-0732a0487f58` for release `omnilodge-r35673952541-a1-e350d29f4624` completed with `REQUEST_SUCCEEDED`. Evidence shows migration-status and runtime-preflight passed, backend private smoke returned 200 with `APP_RUNTIME_MODE=dry-run`, UI-server private smoke returned 200 for `/healthz` and `/`, source-map probing returned 404, and public source maps remained denied. Dependency layers were reused, release-local managed links and browser cache were prepared, host queues were clean afterward (`pending=0`, `running=0`, `incoming=0`), and host policy remained `manual`.
- Local validation covered this with `npm test -- --runTestsByPath src/config/__tests__/applicationRuntimeMode.test.ts --runInBand`, `npm run build:prod` from `be/`, `node --check ops/production/libexec/deploy/worker.mjs`, and `node --test ops/production/release-preparation.test.mjs`. No activation, live pointer switch, app restart, production migration, automatic deployment enablement, public traffic change, or rollback action was performed.

- Build a real release in Actions.
- Transfer and verify it on production.
- Install its dependency layers.
- Run preflight and pending-migration checks.
- Start the staged backend and UI-server on private loopback ports, verify readiness/static/source-map behavior, and shut them down.
- Stop before pointer switching.
- Exercise both manual and automatic trigger selection without allowing the automatic path to contact production; unknown/missing mode values must demonstrate fail-closed behavior.
- After the dry run passes and immediately before Phase 5, change `PRODUCTION_DEPLOY_MODE` from `disabled` to `manual`.

Exit condition: **met**. The staged release is complete, checksummed, starts on private test ports, and production traffic remains on the old release during dry-run validation.

### Phase 5: First controlled cutover

Current status: **complete**. The first public cutover, rollback drill, post-rollback redeploy, and the follow-up no-committed-UI deploy have all succeeded on production.

Current branch checkpoint, 2026-09-22:

- Add durable activation-state primitives before enabling any pointer switch: the host must have a trusted active snapshot, a request-bound target snapshot, and a recovery-plannable activation transaction before PM2 or release pointers can be changed.
- Implemented in this branch: `activation-state-store.mjs` writes immutable activation snapshots, an active-snapshot file, and request-bound activation transactions using the existing durable file primitives. Tests prove idempotent legacy-baseline initialization, deploy-transaction preparation, missing-baseline fail-closed behavior, and recovery planning without pointer changes.
- Implemented in the follow-up branch: `legacy-baseline.mjs` captures the existing checkout/PM2 fallback as a legacy activation snapshot by binding the current Git SHA, UI build-tree digest, and PM2 dump digest to fixed restore paths before any artifact pointer can replace it.
- Implemented in this checkpoint: `capture-legacy-baseline-cli.mjs` and `/usr/local/sbin/omnilodge-capture-legacy-baseline` make the legacy baseline capture an explicit protected-root operation. The command refuses non-root callers and all command arguments, is not exposed through the deploy SSH sudo rule, returns the existing active snapshot without recapturing when one already exists, and remains separate from activation, PM2 restarts, migrations, and production traffic.
- The bootstrap install/proof lists now include `activation-state-store.mjs`, `legacy-baseline.mjs`, and `capture-legacy-baseline-cli.mjs`, so the root-owned control-plane installation cannot omit the Phase 5 state modules while tests still pass.
- Local validation for these checkpoints: `node --check ops/production/libexec/deploy/activation-state-store.mjs`, `node --check ops/production/libexec/deploy/legacy-baseline.mjs`, `node --check ops/production/libexec/deploy/capture-legacy-baseline-cli.mjs`, `node --test ops/production/host-state-primitives.test.mjs`, `node --test ops/production/legacy-baseline.test.mjs`, `node --test ops/production/bootstrap-assets.test.mjs`, and `node --test ops/production/*.test.mjs` (69 tests, 62 passed, 7 expected Windows/POSIX skips, 0 failures).
- PR #42 merged this baseline-command checkpoint into `master` as `1ffe1ce0036b74ef5d0edc3ed2303156fd42b919`; trusted release run `35677743695` succeeded and produced artifact `omnilodge-r35677743695-a1-1ffe1ce0036b` (`10673018877`). Automatic production deploy-request run `35678141196` skipped before host submission because repository deploy mode remained `disabled`.
- PR #43 merged the deploy-candidate preparation checkpoint into `master` as `020503c6077119081526e90b610c2a50c2e3dae3`; trusted release run `35678690814` succeeded and produced artifact `omnilodge-r35678690814-a1-020503c60771` (`10673654689`). Automatic production deploy-request run `35678984895` skipped before host submission because repository deploy mode remained `disabled`.
- PR #46 merged the conditional backup and migration-gate checkpoint into `master` as `00b3d2470bf780aa4decddb86bf83aeda872fc15`; trusted release run `35715304393` succeeded and produced artifact `omnilodge-r35715304393-a1-00b3d2470bf7`. Automatic production deploy-request run `35715718735` skipped before host submission because repository deploy mode remained `disabled`.
- PR #47 merged the activation-preparation checkpoint into `master` as `40bb25e15bba54c2692601644c275fc89ebf5d45`; trusted release run `35716507838` succeeded and produced artifact `omnilodge-r35716507838-a1-40bb25e15bba`. Automatic production deploy-request run `35717020386` skipped before host submission because repository deploy mode remained `disabled`.
- PR #48 merged the durable activation-transaction transition checkpoint into `master` as `f81d1f04aae9d3621096c96bb67f8bfae21a1d6b`; trusted release run `35717823241` succeeded and produced artifact `omnilodge-r35717823241-a1-f81d1f04aae9`. Automatic production deploy-request run `35718256794` skipped before host submission because repository deploy mode remained `disabled`.
- PR #49 merged the activation pointer-switcher primitive into `master` as `8b6de5225f8db413e242ec114d906f6554b4ee6e`; trusted release run `35719224318` succeeded and produced artifact `omnilodge-r35719224318-a1-8b6de5225f8d`. Automatic production deploy-request run `35719736416` skipped before host submission because repository deploy mode remained `disabled`.
- PR #50 merged the public smoke verifier primitive into `master` as `0c7fd5164c4576a11b8449744ccdf1d9cb21e2e4`; trusted release run `35721218971` succeeded and produced artifact `omnilodge-r35721218971-a1-0c7fd5164c45`. Automatic production deploy-request run `35721763419` skipped before host submission because repository deploy mode remained `disabled`.
- PR #51 merged the PM2 service-controller primitive into `master` as `f89160611b1e0ba579bb9ca2002572c657bbc98f`; trusted release run `35722803478` succeeded and produced artifact `omnilodge-r35722803478-a1-f89160611b1e`. Automatic production deploy-request run `35723370953` skipped before host submission because repository deploy mode remained `disabled`.
- PR #52 merged the activation-orchestrator primitive into `master` as `fa8e6847df352aeddf4d3a729589e2f9cbe2d6c5`; trusted release run `35724809287` succeeded and produced artifact `omnilodge-r35724809287-a1-fa8e6847df35`. Automatic production deploy-request run `35725466565` skipped before host submission because repository deploy mode remained `disabled`.
- PR #53 merged the activation-recovery orchestrator primitive into `master` as `5bfdb2465e582c780fe4fb3d668a1c6a0bddd839`; trusted release run `35726587352` succeeded and produced artifact `omnilodge-r35726587352-a1-5bfdb2465e58` (`10693970395`). Automatic production deploy-request run `35727058289` skipped before host submission because repository deploy mode remained `disabled`.
- PR #54 merged the worker activation checkpoint into `master` as `c71569fc16541e307246eb76bbcdb58072b87e73`; trusted release run `35728350854` succeeded and produced artifact `omnilodge-r35728350854-a1-c71569fc1654` (`10694571949`). Automatic production deploy-request run `35728853369` skipped before host submission because repository deploy mode remained `disabled`.
- PR #55 merged the manual rollback control-plane path into `master` as `38fe141837ffcceafa4a960c8287d9f5e0a71082`; trusted release run `35730557928` succeeded and produced artifact `omnilodge-r35730557928-a1-38fe141837ff` (`10695123058`). Automatic production deploy-request run `35731209451` skipped before host submission because repository deploy mode remained `disabled`.
- PR #56 merged the explicit manual rollback workflow entrypoint into `master` as `783b4fa791625ceaa6ab82afb0a34c8e8cd2b1dc`; trusted release run `35732335728` succeeded and produced artifact `omnilodge-r35732335728-a1-783b4fa79162` (`10695904289`). Automatic production deploy-request run `35732980286` skipped before host submission because repository deploy mode remained `disabled`.
- Manual non-activation stage probe run `35734850278` submitted release `omnilodge-r35732335728-a1-783b4fa79162` to the production host while repository mode remained `disabled`; the host accepted request `be02d94e-afa1-4cc8-9228-b8a17151b992` with response `REQUEST_ACCEPTED`. No live pointer switch, PM2 restart, public traffic change, production migration, deploy-mode change, or rollback action was performed.
- PR #57 merged terminal host-request status polling into `master` as `f379abfc44ad2a4b4c6ca5250a75a69e377f2226`; trusted release run `35736677814` succeeded and produced artifact `omnilodge-r35736677814-a1-f379abfc44ad` (`10698023546`). Automatic production deploy-request run `35737439248` skipped before host submission because repository deploy mode remained `disabled`.
- Manual non-activation stage run `35737638530` submitted release `omnilodge-r35736677814-a1-f379abfc44ad` to the production host while repository mode remained `disabled`; host request `77333619-f436-4e8f-a52c-fcb83073104f` reached terminal `REQUEST_SUCCEEDED` through the new status-polling evidence. No live pointer switch, PM2 restart, public traffic change, production migration, deploy-mode change, or rollback action was performed.
- Manual non-activation dry-run run `35738165715` submitted the same release to the production host while repository mode remained `disabled`; host request `a3644080-8c5a-4f7d-ace1-bf008bd99523` reached terminal `REQUEST_SUCCEEDED`. Evidence confirms the workflow waited for the detached worker's final status rather than trusting only the initial `REQUEST_ACCEPTED` handoff. No live pointer switch, PM2 restart, public traffic change, production migration, deploy-mode change, or rollback action was performed.
- PR #58 updated this roadmap after PR #57 and merged into `master` as `949f85198b0de42ba6515c6d0ee619a09ee65b7b`; trusted release run `35739690154` succeeded and produced artifact `omnilodge-r35739690154-a1-949f85198b0d` (`10698553979`). Automatic deploy-request run `35740374814` skipped before host submission because repository deploy mode was still `disabled`.
- Production was then fast-forwarded to `949f85198b0de42ba6515c6d0ee619a09ee65b7b` for host-control installation only. `bootstrap-primitives`, `bootstrap-host --install`, and `bootstrap-host --check` passed, and `/usr/local/sbin/omnilodge-capture-legacy-baseline` created legacy baseline activation snapshot `360905a8-03f1-4136-b4c5-22f9a85a40e0` without switching services.
- Repository `PRODUCTION_DEPLOY_MODE` was changed to `manual` for the first controlled deploy attempt. Manual deploy run `35748224056` submitted host request `65ccac54-7d4a-4cdd-a375-da7a08b1d36f` for release `omnilodge-r35739690154-a1-949f85198b0d`. The worker prepared the release, created backup `/home/postgres/backups/omni_lodge_db_202609221638.backup`, applied four pending migrations, and prepared activation state. Activation recovery then stopped in `restoring_previous` with no worker process remaining; production stayed healthy on the legacy baseline pointers and PM2 processes. The request was manually advanced through `previous_restored` to terminal `REQUEST_FAILED` after verifying the baseline pointers.
- This checkpoint patches the recovery orchestrator so an interrupted legacy-baseline restore can complete without attempting a managed-runtime PM2 restart, and adds support for the `mark_request_failed` recovery action. Local validation passed with `node --test ops/production/activation-orchestrator.test.mjs` and `node --test ops/production/*.test.mjs` (102 tests, 93 passed, 9 expected Windows/POSIX skips, 0 failures).
- PR #59 merged the recovery patch into `master` as `646bdf7035ef2a1db7a13aef28347a86b9fb1975`; trusted release run `35753841869` produced `omnilodge-r35753841869-a1-646bdf7035ef`. Production was fast-forwarded to the patched control-plane source, `bootstrap-primitives`, `bootstrap-host --install`, and `bootstrap-host --check` passed, and the host request queue was clean.
- Manual dry-run `35754851514` submitted host request `d642f45d-5a6e-4772-b749-84371f555272` for `omnilodge-r35753841869-a1-646bdf7035ef`; it reached terminal `REQUEST_SUCCEEDED`. No backup was created because no migrations were pending, no live pointer switch persisted, and production stayed on the legacy baseline.
- Manual deploy run `35755739259` submitted host request `df79a8d0-6bfa-4688-963f-7eec33ae9fc7` for the same release. Backup and migration gates correctly reported `NO_PENDING_MIGRATIONS`. Activation switched pointers to the prepared artifact, then failed before PM2 restart evidence was recorded; recovery restored `/opt/omnilodge/backend-current` and `/opt/omnilodge/ui-current` to the legacy baseline and marked the request `REQUEST_FAILED`.
- The activation failure was traced to `runtime-launcher.mjs`: release preparation correctly links `node_modules` to dependency-layer keys (`c733…` for backend and `ae27…` for ui-server), but the launcher still required those directories to equal raw package-lock hashes (`0689…` and `2e6d…`). This checkpoint updates the launcher to recompute dependency-layer keys from the manifest's lockfile hash, package hash, pinned toolchain, platform, architecture, and install flags before accepting the prepared release links.
- Local validation for this checkpoint: `node --test ops/production/bootstrap-assets.test.mjs ops/production/release-preparation.test.mjs ops/production/pm2-service-controller.test.mjs ops/production/activation-orchestrator.test.mjs` (46 tests, 41 passed, 5 expected Windows/POSIX skips, 0 failures). A patched launcher copied to `/tmp` on production successfully validated the prepared `omnilodge-r35753841869-a1-646bdf7035ef` backend and ui-server launch plans without changing live pointers or PM2 state.
- PR #60 merged the runtime dependency-layer fix into `master` as `4e20686fd9c3e8e374408a4f52cb20d0d5a7108e`; trusted release run `35758388353` produced `omnilodge-r35758388353-a1-4e20686fd9c3` (`10710035183`). Production was fast-forwarded and `bootstrap-primitives`, `bootstrap-host --install`, and `bootstrap-host --check` passed.
- Manual deploy run `35759114924` submitted host request `ce611384-e191-4aa2-9f84-9840aa368fbd`. The release prepared successfully, reused both dependency layers, passed runtime preflight and private smoke, skipped backup/migration because there were no pending migrations, then failed immediately after pointer switch. Recovery restored both live pointers to the legacy baseline and production remained healthy.
- The second activation failure was reproduced with a non-matching PM2 target: PM2 5.3.1 on the Ubuntu 20.04 host throws `TypeError: Cannot read properties of undefined (reading 'deploy')` for `pm2 startOrRestart /etc/omnilodge/ecosystem.production.cjs ...` before daemon restart evidence is produced. A throwaway JSON ecosystem file works with `startOrRestart` without matching or mutating OmniLodge processes. This checkpoint changes the installed ecosystem asset to `/etc/omnilodge/ecosystem.production.json` and keeps the same fixed runtime-launcher process definitions.
- Local validation for the PM2 JSON checkpoint: `node --test ops/production/bootstrap-assets.test.mjs ops/production/pm2-service-controller.test.mjs ops/production/activation-orchestrator.test.mjs` (25 tests, 24 passed, 1 expected Windows/POSIX skip, 0 failures). The production host stayed on `/root/omni-lodge/be` and `/root/omni-lodge/ui/build`; `/api/health` and the homepage returned 200 after the failed attempt.
- PR #61 merged the JSON PM2 ecosystem change into `master` as `198de0780603cb8b883208d0a533ce4f1a95c592`; trusted release run `35761093297` produced `omnilodge-r35761093297-a1-198de0780603` (`10709914039`). Production was fast-forwarded and `bootstrap-primitives`, `bootstrap-host --install`, and `bootstrap-host --check` passed with `/etc/omnilodge/ecosystem.production.json` installed.
- Manual deploy run `35761842582` submitted host request `78a8c938-f713-4226-8e7e-495d8bd2d823`. Release preparation, dependency reuse, runtime preflight, private smoke, backup gate, and migration gate all completed, then activation switched pointers and PM2 `startOrRestart` kept the legacy process commands while appending managed-runtime args. The backend process repeatedly ran `npm backend`, Cloudflare returned 521/502, and production was manually restored by recreating the legacy PM2 definitions and saving the process list. `/api/health` returned healthy again after the restored backend completed its legacy production build.
- This checkpoint replaces managed PM2 activation with delete-and-start for each exact managed process name, and makes recovery to a legacy baseline restore the saved PM2 process list instead of only restoring live pointers. Local validation passed with `node --test ops/production/pm2-service-controller.test.mjs ops/production/activation-orchestrator.test.mjs ops/production/bootstrap-assets.test.mjs` (26 tests, 25 passed, 1 expected Windows/POSIX skip, 0 failures) and `node --test ops/production/host-worker-staging.test.mjs ops/production/release-preparation.test.mjs` (27 tests, 23 passed, 4 expected Windows/POSIX skips, 0 failures).
- PR #62 merged the delete-and-start PM2 activation change into `master` as `6fc2b3f148ba7d4178f9ff835164f9cd5d977b6a`; trusted release run `35764371183` produced `omnilodge-r35764371183-a1-6fc2b3f148ba` (`10712175348`). Production bootstrap was reinstalled from the fast-forwarded checkout and verified that the installed control-plane contains delete-and-start PM2 activation and saved-process-list restore.
- Manual deploy run `35764867460` submitted host request `53e929b7-ba25-4fab-879d-ac2896675f45` for that release. The worker remained in `authorized` while release preparation ran, then advanced through activation in a few seconds. Activation switched pointers, started managed PM2 processes, failed before cutover evidence was persisted, and recovery restored `/opt/omnilodge/backend-current` and `/opt/omnilodge/ui-current` to the legacy checkout and resurrected the saved legacy PM2 process list. Production stayed on `/root/omni-lodge/be` and `/root/omni-lodge/ui/build` afterward.
- This checkpoint adds warm-up tolerance to the activation path: managed PM2 validation now retries for up to 60 seconds after delete-and-start, and public smoke checks retry warm-up-sensitive API/UI release checks for up to 90 seconds after cutover. Local validation passed with `node --test ops/production/pm2-service-controller.test.mjs ops/production/public-smoke-verifier.test.mjs ops/production/activation-orchestrator.test.mjs ops/production/bootstrap-assets.test.mjs` (32 tests, 31 passed, 1 expected Windows/POSIX skip, 0 failures) and `node --test ops/production/host-worker-staging.test.mjs ops/production/release-preparation.test.mjs` (27 tests, 23 passed, 4 expected Windows/POSIX skips, 0 failures).
- PR #63 merged the warm-up checkpoint into `master` as `a67ce7130c235e9b1d025604f816f26247bcac30`; trusted release run `35767309692` produced `omnilodge-r35767309692-a1-a67ce7130c23` (`10713395475`). Production bootstrap was reinstalled from the fast-forwarded checkout.
- Manual deploy run `35768171589` submitted host request `4c8ab5d7-4484-4665-968a-07da401cc68d` for `omnilodge-r35767309692-a1-a67ce7130c23`. The release prepared, skipped backup/migration because no migrations were pending, switched pointers, started managed PM2 wrapper processes, then failed during public activation smoke and recovered to the saved legacy PM2 baseline. The failure evidence at this point was still too coarse, so no exact smoke endpoint or PM2 progress was durably available.
- PR #64 merged durable activation-failure evidence into `master` as `eb369b398b57db7760c35a348ae08040845326c7`; trusted release run `35771790998` produced `omnilodge-r35771790998-a1-eb369b398b57` (`10714507432`). Production bootstrap was reinstalled and verified that the installed control-plane writes `.activation-failure-result.json` evidence.
- Manual deploy run `35772604880` submitted host request `352ce2d9-38e3-440a-adb3-51150a8c5c2d` for `omnilodge-r35771790998-a1-eb369b398b57`. The release prepared, skipped backup/migration because no migrations were pending, switched pointers, and PM2 validation reported the managed runtime-launcher wrappers online. Public smoke then failed at `api-live` after 29 attempts with Cloudflare HTTP `521`. Recovery restored `/opt/omnilodge/backend-current` to `/root/omni-lodge/be`, `/opt/omnilodge/ui-current` to `/root/omni-lodge/ui/build`, resurrected the saved legacy PM2 process list, and production returned healthy on `/api/health`.
- This checkpoint adds `managed-origin-readiness-verifier.mjs` and wires it into activation after managed PM2 restart but before public smoke. The gate proves the target release through direct backend readiness on `127.0.0.1:3001`, UI `/healthz` on `127.0.0.1:443`, and UI `/api/health/live` proxying to the backend. If it fails, activation failure evidence records the specific local endpoint attempts, making Cloudflare 521 distinguishable from backend bind, UI bind, or proxy readiness failures.
- Local validation for the managed-origin readiness checkpoint: `node --test ops/production/activation-orchestrator.test.mjs ops/production/managed-origin-readiness-verifier.test.mjs ops/production/host-worker-staging.test.mjs ops/production/pm2-service-controller.test.mjs ops/production/public-smoke-verifier.test.mjs` (31 tests, 31 passed, 0 failures) and `node --test ops/production/*.test.mjs` (110 tests, 101 passed, 9 expected Windows/POSIX skips, 0 failures).
- The bootstrap install/proof lists now include `backup-gate.mjs`, `managed-origin-readiness-verifier.mjs`, `public-smoke-verifier.mjs`, `pm2-service-controller.mjs`, and `activation-orchestrator.mjs`, so the root-owned control-plane installation cannot omit these gates while tests still pass.
- Local validation for the public-smoke checkpoint: `node --check ops/production/libexec/deploy/public-smoke-verifier.mjs`, `node --test ops/production/public-smoke-verifier.test.mjs ops/production/bootstrap-assets.test.mjs`, and `node --test ops/production/*.test.mjs` (84 tests, 75 passed, 9 expected Windows/POSIX skips, 0 failures).
- Local validation for the PM2 service-controller checkpoint: `node --check ops/production/libexec/deploy/pm2-service-controller.mjs`, `node --test ops/production/pm2-service-controller.test.mjs ops/production/bootstrap-assets.test.mjs`, and `node --test ops/production/*.test.mjs` (89 tests, 80 passed, 9 expected Windows/POSIX skips, 0 failures).
- Local validation for the activation-orchestrator checkpoint: `node --check ops/production/libexec/deploy/activation-orchestrator.mjs`, `node --check ops/production/libexec/deploy/pm2-service-controller.mjs`, `node --test ops/production/activation-orchestrator.test.mjs ops/production/pm2-service-controller.test.mjs ops/production/bootstrap-assets.test.mjs`, and `node --test ops/production/*.test.mjs` (92 tests, 83 passed, 9 expected Windows/POSIX skips, 0 failures).
- Local validation for the activation-recovery checkpoint: `node --check ops/production/libexec/deploy/activation-orchestrator.mjs`, `node --check ops/production/libexec/deploy/activation-pointer-switcher.mjs`, `node --test ops/production/activation-orchestrator.test.mjs ops/production/activation-pointer-switcher.test.mjs ops/production/bootstrap-assets.test.mjs`, and `node --test ops/production/*.test.mjs` (95 tests, 86 passed, 9 expected Windows/POSIX skips, 0 failures).
- Local validation for the worker activation checkpoint: `node --check ops/production/libexec/deploy/worker.mjs`, `node --test ops/production/host-worker-staging.test.mjs ops/production/activation-orchestrator.test.mjs`, and `node --test ops/production/*.test.mjs` (96 tests, 87 passed, 9 expected Windows/POSIX skips, 0 failures).
- Local validation for the manual rollback checkpoint: `node --check ops/production/libexec/deploy/activation-state-store.mjs`, `node --check ops/production/libexec/deploy/activation-orchestrator.mjs`, `node --check ops/production/libexec/deploy/submit-request.mjs`, `node --check ops/production/libexec/deploy/worker.mjs`, `node --test ops/production/host-state-primitives.test.mjs ops/production/host-submit-endpoint.test.mjs ops/production/host-worker-staging.test.mjs ops/production/activation-orchestrator.test.mjs`, and `node --test ops/production/*.test.mjs` (100 tests, 91 passed, 9 expected Windows/POSIX skips, 0 failures).
- Local validation for the rollback workflow checkpoint: `node --check scripts/deploy/create-host-v2-request.mjs`, `node --test scripts/deploy/create-host-v2-request.test.mjs scripts/deploy/host-protocol-client.test.mjs scripts/deploy/submit-host-v2-request.test.mjs` (19 tests, 18 passed, 1 expected Windows/POSIX skip, 0 failures), and `node --test scripts/deploy/*.test.mjs` (75 tests, 73 passed, 2 expected Windows/POSIX skips, 0 failures). Local workflow linting was not available because `actionlint` is not installed; GitHub CI remains the workflow syntax gate.
- Local validation for the host status-polling checkpoint: `node --check scripts/deploy/create-host-v2-request.mjs`, `node --check scripts/deploy/submit-host-v2-request.mjs`, `node --check scripts/deploy/poll-host-v2-request-status.mjs`, and `node --test scripts/deploy/create-host-v2-request.test.mjs scripts/deploy/submit-host-v2-request.test.mjs scripts/deploy/poll-host-v2-request-status.test.mjs scripts/deploy/host-protocol-client.test.mjs scripts/deploy/host/protocol-v2.test.mjs` (42 tests, 41 passed, 1 expected Windows/POSIX skip, 0 failures).
- PR #66 merged backend environment validation into `master` as `7d137eb4f878cd512615403116d3078f967372c6`; trusted release run `35779487150` produced `omnilodge-r35779487150-a1-7d137eb4f878`. Production bootstrap was reinstalled after rebuilding `/etc/omnilodge/backend.env` from the legacy backend env plus retained monitoring secrets and rejecting PM2/system environment pollution. Manual deploy run `35780340907` submitted host request `4b0ff85a-a96c-4047-8ecf-4c6b5fde70e9`, passed private smoke, then failed at managed-origin readiness because PM2 reported launcher wrappers online while no backend/UI child process or listener existed.
- PR #67 merged launcher child-exit hardening into `master` as `3c17ab2d0b3bbcae1c98db39b515dca1263e0832`; trusted release run `35781973554` produced `omnilodge-r35781973554-a1-3c17ab2d0b3b`. Manual deploy run `35782583409` submitted host request `350e8aea-1bb0-47ab-ab98-5e2f6b143868`, reached pointer switch, started managed PM2 launcher wrappers, then failed local `backend-direct-ready` after 61 connection-refused attempts. Production was restored to the legacy PM2 commands and verified healthy on `/api/health`.
- The `35782583409` failure proved the ESM launcher was still not entering `run()` under PM2 because PM2 imports applications through its own process container, making the direct-main `process.argv[1]` check insufficient. This checkpoint gives each PM2 app an explicit `OMNILODGE_RUNTIME_COMPONENT`, lets the launcher start when that variable is present, and makes PM2 validation reject processes without the matching component environment.
- Local validation for the PM2 ESM launcher entrypoint checkpoint: `node --test ops/production/bootstrap-assets.test.mjs ops/production/pm2-service-controller.test.mjs ops/production/activation-orchestrator.test.mjs ops/production/managed-origin-readiness-verifier.test.mjs` (33 tests, 32 passed, 1 expected Windows/POSIX skip, 0 failures) and `node --test ops/production/*.test.mjs` (111 tests, 102 passed, 9 expected Windows/POSIX skips, 0 failures).
- PR #68 merged the explicit PM2 runtime-component entrypoint contract into `master` as `d1526cea06dac36952b5cf7271ad948732313d7e`; trusted release run `35785303198` produced `omnilodge-r35785303198-a1-d1526cea06da`. Manual deploy run `35786132687` submitted host request `3ccd16a5-18fd-4251-9155-831776c885b2`, reached pointer switch, started managed backend and UI child processes, and passed managed-origin readiness: backend `/api/health/ready`, UI `/healthz`, and UI `/api/health/live` all exposed the target release. Public smoke then failed at `ui-asset-manifest` because public `/asset-manifest.json` continued returning a stale manifest release. Recovery restored legacy pointers and PM2; legacy backend rebuilt and `/api/health` returned healthy.
- This checkpoint appends a release-scoped `omnilodge-release=<releaseId>` query string to public smoke requests for mutable UI files (`/asset-manifest.json`, `/`, `/manifest.json`, and `/service-worker.js`) and sends `Cache-Control: no-cache`/`Pragma: no-cache` request headers, while still validating the hashed main asset and public source-map denial.
- Local validation for the public-smoke cache-busting checkpoint: `node --test ops/production/public-smoke-verifier.test.mjs ops/production/bootstrap-assets.test.mjs ops/production/activation-orchestrator.test.mjs` (28 tests, 27 passed, 1 expected Windows/POSIX skip, 0 failures) and `node --test ops/production/*.test.mjs` (111 tests, 102 passed, 9 expected Windows/POSIX skips, 0 failures).
- PR #69 merged the public-smoke cache-busting checkpoint into `master` as `4f29e5db86b3325fed925345a414247d40b0a3f1`; trusted release run `35788156543` produced `omnilodge-r35788156543-a1-4f29e5db86b3`. Manual deploy run `35788872884` submitted host request `a34de50d-3dc6-49a2-b70e-674770cfac2e`, reached pointer switch, started managed backend and UI child processes, and passed managed-origin readiness for the target release. Public smoke still failed at `ui-asset-manifest`, but direct inspection of `/opt/omnilodge/releases/omnilodge-r35788156543-a1-4f29e5db86b3/ui/build/asset-manifest.json` showed the generated manifest contains only `files` and `entrypoints`, not release metadata. Recovery restored legacy pointers and PM2; `/api/health` and `/healthz` returned healthy after the legacy backend rebuilt.
- This checkpoint keeps the release-scoped cache-busting, treats public `/healthz` as the UI release identity source, allows CRA `asset-manifest.json` to omit release metadata, still rejects present-but-wrong manifest release metadata, and still fails closed if `/healthz` and `asset-manifest.json` disagree on the content-hashed main asset.
- Local validation for the public-smoke manifest-format checkpoint: `node --test ops/production/public-smoke-verifier.test.mjs ops/production/bootstrap-assets.test.mjs ops/production/activation-orchestrator.test.mjs` (29 tests, 28 passed, 1 expected Windows/POSIX skip, 0 failures) and `node --test ops/production/*.test.mjs` (112 tests, 103 passed, 9 expected Windows/POSIX skips, 0 failures).
- PR #70 merged the manifest-format checkpoint into `master` as `cad1803cdfb6a819c572d6bf8e47285a5fc79164`; trusted release run `35791193540` produced `omnilodge-r35791193540-a1-cad1803cdfb6`. Manual deploy run `35791890301` submitted host request `67d183fb-e4b2-46a8-b75c-a9679862493c`, reached pointer switch, started managed backend and UI child processes, and passed managed-origin readiness for the target release. Public smoke then failed at `ui-asset-manifest` because the generated CRA manifest uses a leading slash in `files["main.js"]` (`/static/js/...`) but omits the leading slash in `entrypoints` (`static/js/...`). Recovery restored legacy pointers and PM2; `/api/health` and `/healthz` returned healthy after the legacy backend rebuilt.
- This checkpoint keeps the manifest-format behavior and normalizes `asset-manifest.json` entrypoint paths before checking that entrypoints include the content-hashed main asset.
- Local validation for the public-smoke entrypoint-normalization checkpoint: `node --test ops/production/public-smoke-verifier.test.mjs ops/production/bootstrap-assets.test.mjs ops/production/activation-orchestrator.test.mjs` (29 tests, 28 passed, 1 expected Windows/POSIX skip, 0 failures) and `node --test ops/production/*.test.mjs` (112 tests, 103 passed, 9 expected Windows/POSIX skips, 0 failures).
- PR #71 merged the public-smoke entrypoint-normalization checkpoint into `master` as `400ff8af8236e714c4f246ebca00bc4c58f5010c`; trusted release run `35793373009` produced `omnilodge-r35793373009-a1-400ff8af8236`. Manual deploy run `35793845796` submitted host request `3151a901-b581-48e0-8e7d-f204ce5fb6b5`, which completed with `REQUEST_SUCCEEDED`. Post-deploy checks returned healthy for `/api/health`, `/api/health/ready`, `/api/health/live`, and `/healthz`; both backend and UI reported release `omnilodge-r35793373009-a1-400ff8af8236`, and PM2 showed both services running through `/usr/local/libexec/omnilodge/runtime-launcher.mjs`.
- Rollback drill preparation selected current active snapshot `3151a901-b581-48e0-8e7d-f204ce5fb6b5:f752edbb08f6c9da80c715f27fbff2333d1e8ef02385f2513811efb25be34ccd` and saved legacy-baseline target snapshot `360905a8-03f1-4136-b4c5-22f9a85a40e0:0f1af0c6f0a74b1f02671cfb649f7382cde8192ec03b9caf73d3fe56db5f7535`.
- The first rollback drill dispatch, run `35808361071`, submitted host request `d3abfeed-1ab7-4e56-88ad-34051df4997e`; it failed before pointer changes with `Activation target release ID is missing` because the rollback activation path incorrectly required release metadata on a `legacy_baseline` snapshot. Production remained on `omnilodge-r35793373009-a1-400ff8af8236`. This checkpoint teaches rollback activation to restore legacy-baseline PM2 state without release-bound managed-origin/public-smoke checks while keeping artifact-release rollback unchanged.
- PR #73 merged the legacy-baseline rollback activation fix into `master` as `be83c9df4ae20a9ef111267b2f4b9b8991b60927`; trusted release run `35809156379` produced `omnilodge-r35809156379-a1-be83c9df4ae2`.
- Manual deploy run `35809603071` submitted host request `fc9b0050-6ab9-4b8d-a484-b9135ca36f1b` for `omnilodge-r35809156379-a1-be83c9df4ae2`. The GitHub polling step marked the workflow failed after a transient failed status-query response, but the host worker continued, completed with `REQUEST_SUCCEEDED`, switched `/opt/omnilodge/backend-current` and `/opt/omnilodge/ui-current`, and production reported healthy for `/api/health/ready` and `/healthz` on release `omnilodge-r35809156379-a1-be83c9df4ae2`.
- This checkpoint makes status-query `REQUEST_FAILED` responses retryable in `poll-host-v2-request-status.mjs`; actual deployment failures remain terminal because they are returned as `STATUS_FOUND` with the subject request lifecycle `failed`. Local validation: `node --test scripts/deploy/poll-host-v2-request-status.test.mjs scripts/deploy/submit-host-v2-request.test.mjs ops/production/host-submit-endpoint.test.mjs ops/production/host-state-primitives.test.mjs ops/production/host-worker-staging.test.mjs ops/production/activation-orchestrator.test.mjs` (57 tests, 55 passed, 2 expected Windows/POSIX skips, 0 failures).
- PR #74 merged the status-poller retry checkpoint into `master` as `3d35ed6109eeeb879861d36b671c4b2495109710`; trusted release run `35810598154` produced `omnilodge-r35810598154-a1-3d35ed6109ee`. The automatic deployment-request run skipped correctly because `PRODUCTION_DEPLOY_MODE=manual`.
- The production checkout and host bootstrap were fast-forwarded to `3d35ed6109eeeb879861d36b671c4b2495109710` before the final rollback drill so the root-owned control-plane used the reviewed rollback fix. `bootstrap-primitives.test.sh`, `bootstrap-host.sh --install`, `bootstrap-host.sh --check`, and an installed `activation-orchestrator.mjs` syntax check passed on the Ubuntu 20.04 host.
- A rollback drill request initially stalled because the deployment audit segment had reached its size cap. The full audit segment was preserved as `/var/lib/omnilodge/deploy/audit/segments/events-20260923T0249Z.ndjson`, a fresh root-owned `events.ndjson` was created, and the stale request was allowed to fail without pointer changes. Add durable audit-log rotation/retention before heavy repeated drills.
- Manual rollback run `35812156678` completed successfully. It restored `/opt/omnilodge/backend-current` to `/root/omni-lodge/be` and `/opt/omnilodge/ui-current` to `/root/omni-lodge/ui/build`, proving the saved legacy-baseline pointer path. The public site briefly returned Cloudflare 521 while the legacy baseline was active because the restored PM2 process list still used the managed launcher state; this is acceptable for the drill outcome but confirms the legacy Git checkout should be retired as a fallback in favor of retained managed release snapshots.
- Manual forward deploy run `35812350402` submitted host request `ad064dc5-0465-45b3-ac56-1450d5d28a32` for release `omnilodge-r35810598154-a1-3d35ed6109ee`. The worker prepared the artifact, reused dependency layers, passed browser-cache, dry-run, backup, migration, activation, managed-origin, and public-smoke checks, then completed with `REQUEST_SUCCEEDED`. Post-deploy checks returned healthy for `/api/health/ready` and `/healthz`; both backend and UI report release `omnilodge-r35810598154-a1-3d35ed6109ee`.
- Keep deploy code fail-closed and use the retained managed-release rollback runbook for normal rollback; legacy-baseline rollback remains historical emergency fallback context.
- Do not change `PRODUCTION_DEPLOY_MODE`, the root-owned host policy, current-release pointers, PM2 processes, public traffic, production migrations, or rollback behavior without a dedicated reviewed change.

- Historical Phase 5 guardrail: `PRODUCTION_DEPLOY_MODE` stayed `manual`; automatic deployment code was present but could not activate production yet. Phase 6 later moved production to automatic mode.
- Phase 5 cutover and rollback drill were completed in a controlled window on 2026-09-23.
- Production release after the Phase 6 cleanup deploy: `omnilodge-r35814013867-a1-55b2204d7a80`, source SHA `55b2204d7a805da86d5678af708a34df8aeed107`, host request `6cf577fc-b342-488c-b802-08cc73a49fbb`. Current production later advanced through the automatic deploy proof recorded in Phase 6.
- Backend readiness and UI health were verified after the post-rollback redeploy and again after the no-committed-UI cleanup deploy.
- Confirm error monitoring attributes new events to the correct release during the next normal user session.
- Exercise one critical workflow from each major module during the first normal business day on the managed release.

Exit condition: production is healthy on the Actions-built release and a rollback drill succeeds. Completed on 2026-09-23.

### Phase 6: Operationalize

Current status: **completed**. Generated UI build artifacts have been removed from `master`, the source-built release path has been proven, production is healthy on an Actions-built managed release, deployment audit-log rotation/retention is installed and has accepted new production audit events, rollback is documented as a retained managed-release operation, Dependabot is configured for npm plus GitHub Actions, maintenance exposes release/deploy links, old-release/dependency garbage collection is production-verified, synthetic audit-threshold rotation/retention has been proven on production, docs-only PR validation has a lightweight required-check path, recent CI/release duration was reviewed, stale branch cleanup is complete, same-repository branch cleanup is automated after merge, `codex/*` auto-merge is token-backed and production-proven, unattended automatic production deployment is configured and proven, and the emergency-freeze drill verified that disabled mode blocks forward automatic deployment while explicit rollback remains available.

Completed:

- Remove tracked `ui/build` from `master`, add it to `.gitignore`, and update `AGENTS.md` in one dedicated commit. Completed by PR #76 (`55b2204d7a805da86d5678af708a34df8aeed107`).
- Prove that the trusted `master` release builds the UI from source after removing `ui/build`: release run `35814013867` produced `omnilodge-r35814013867-a1-55b2204d7a80`.
- Deploy that cleanup release through the production workflow without building on the host: deploy run `35828883438` and host request `6cf577fc-b342-488c-b802-08cc73a49fbb` completed with `REQUEST_SUCCEEDED`; `/api/health/ready` and `/healthz` reported the cleanup release.
- Implement deployment audit-log rotation/retention in the repository so the active `events.ndjson` segment rotates before byte/age limits and old rotated segments are pruned by age/count. After the production control-plane refresh, dry-run request `aa3aa83b-81a4-48c8-91b8-d4d821560655` wrote `request_admitted`, `request_running`, and `request_finished` audit entries to the active segment; the previously preserved full segment remains under `audit/segments/`.
- Document rollback as a single retained managed-release operation in [Production Managed-Release Rollback Runbook](production-managed-release-rollback.md), with legacy-baseline rollback retained only as historical emergency fallback guidance.
- Configure Dependabot for weekly grouped GitHub Actions and npm dependency PRs across `/be`, `/ui`, and `/ui-server`.
- Add read-only release/deploy links to Settings > Maintenance. Completed by PR #84; the card reads `/health/live` and links to the current Release run, source commit, Production Deploy workflow, Rollback workflow, and Release workflow runs.
- Implement old-release/dependency garbage collection in repository code. Completed by PR #85 (`a5197867fb0674cbd03c1c798604f4a5fbcac5ca`) and trusted release run `35843677011`; automatic production deploy-request run `35844247409` skipped host submission because `PRODUCTION_DEPLOY_MODE=manual`. The production control-plane was then refreshed to `d3ad3c43a7524bb2b7c1969202ddc17f85b4f4dc`, and manual dry-run `35846364912` for `omnilodge-r35845106812-a1-d3ad3c43a752` completed host request `aa3aa83b-81a4-48c8-91b8-d4d821560655` with `REQUEST_SUCCEEDED`. The worker wrote `garbage-collection-result.json` with reliable activation-state protection, dependency protection complete, zero warnings, 29 releases kept, and zero active/retained releases removed.
- Configure the trusted `master` Release workflow to skip docs/markdown-only pushes so roadmap-only PRs do not build a deployable application artifact or trigger an automatic production deploy-request run. App, workflow, and ops-code changes still produce a release.
- Prove synthetic audit-threshold rotation/retention on production without touching the live audit segment. On 2026-09-23, an isolated temporary path under `/var/lib/omnilodge/deploy/audit/synthetic-rotation-tests/` appended 80 synthetic host-audit events with a 2 KiB segment cap and 3 retained rotated segments; rotation kept exactly 3 rotated segments plus a bounded active segment, then the synthetic run directory was removed successfully.
- Add a lightweight docs-only PR validation path. The CI workflow still emits the branch-protection-required `CI / required` status for docs/markdown-only pull requests, but skips backend, UI, UI-server, release-tooling, and migration jobs unless a non-docs file changes.
- Review recent CI/release duration. The eight most recent trusted `master` Release runs completed in roughly 5.5-6.2 minutes end-to-end; UI build/validation is the dominant long pole at roughly 4.9-5.5 minutes, while backend, migrations, packaging, and UI-server jobs are materially shorter. No job split is necessary yet; the lightweight docs-only PR path is the main near-term CI-time reduction.
- Clean up stale branches. Retired remote branches `dev-1`, `release-1`, and `codex/docs-cicd-roadmap` were deleted after audit; stale local Codex branches were removed; `migration/omni-ha-prep` was retained because it contains unique HA preparation work; and the remaining remote Dependabot branches were confirmed as active open dependency-update PRs.
- Enable unattended automatic production deployment. On 2026-09-23, `PRODUCTION_DEPLOY_MODE` was changed from `manual` to `automatic`, and the production environment's required reviewer gate was removed with owner approval. The production environment still enforces the custom branch policy for `master`.
- Prove unattended automatic production deployment. The first automatic attempt, Production Deploy Request run `35853819998` from PR #92, was rejected with `POLICY_DENIED` because the server-owned host policy still read `manual`; this proved the independent host-side safety gate. The host policy was then changed to `automatic` in `/etc/omnilodge/deploy-policy.json` with backup `/etc/omnilodge/deploy-policy.json.backup-20260923T112114Z`. PR #93 merged as `1cca0dea665b34379faf3b8637133fecc87db033`; trusted Release run `35854578510` produced `omnilodge-r35854578510-a1-1cca0dea665b`; automatic Production Deploy Request run `35855177424` submitted host request `dbb9947c-d949-4404-b60d-55f631ff2f81`, completed with `REQUEST_SUCCEEDED`, switched `/opt/omnilodge/backend-current` and `/opt/omnilodge/ui-current`, and public `/healthz` plus `/api/health/ready` returned HTTP 200 for the new release.
- Automate Codex-task PR auto-merge and branch cleanup. The auto-merge workflow marks non-draft same-repository `codex/*` PRs to `master` for squash auto-merge, requires `OMNILODGE_AUTOMERGE_TOKEN` so merged `master` pushes trigger downstream Release/Deploy workflows, excludes fork, Dependabot, and other non-`codex/*` PRs from automatic merge, and explicitly deletes merged same-repository head branches on PR close events.
- Prove the emergency `disabled` freeze and retained-release rollback path. On 2026-09-23, `PRODUCTION_DEPLOY_MODE` was temporarily set to `disabled`; trusted Release rerun `35864299959` attempt 2 succeeded, and automatic Production Deploy Request run `35866959846` skipped host request creation with `automatic deployment is not enabled; mode=disabled`. While still disabled, rollback run `35867068044` moved production from `omnilodge-r35864299959-a1-ba96006a4682` to retained predecessor `omnilodge-r35862318917-a1-d977f64749b3` and public `/healthz` plus `/api/health/ready` returned HTTP 200. Rollback run `35867270236` then returned production to `omnilodge-r35864299959-a1-ba96006a4682`, public health checks returned HTTP 200, and `PRODUCTION_DEPLOY_MODE` was restored to `automatic`.

Remaining:

- Nothing required for this phase.

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
11. `feat: add compiled migration status and artifact runtime preflight`
12. `security: define the strict versioned host deployment protocol`
13. `ops: add fail-closed production bootstrap and runtime scaffolds` (repository-only; do not install while the submitter, worker, and recovery entry points remain disabled)
14. `ops: implement and verify the protocol-aware submitter, detached worker, recovery path, backup gate, atomic activation, smoke checks, and rollback` (retain the existing deploy account/key without rotation)
15. `ci: add trusted manual and switchable automatic production deployment plus explicit rollback`
16. `security: decouple and untrack origin TLS material` (rotation intentionally remains deferred under the owner-accepted exception)
17. `ops: replace live build maintenance actions with release status`
18. `chore: stop tracking UI build after verified artifact cutover`

Do not combine TLS decoupling, PM2 cutover, dependency changes, and the first automated deployment into one irreversible step.

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
- `PRODUCTION_DEPLOY_MODE` behavior is proven: `disabled` blocks automatic forward submission, `manual` supports controlled dispatch, and `automatic` supports unattended production deployment; missing/invalid values block forward deployment.
- Manual dispatch itself is rejected unless its repository/ref is the canonical repository's `refs/heads/master`, and it accepts only an exact trusted successful `master` release.
- The automatic route is production-proven in `automatic` mode and still skips safely when mode is not `automatic`.
- A simulated automatic run whose SHA is no longer the current `master` head is skipped, including when the newer head failed its release build.
- The rollback drill freezes forward deployment, clears pending forward work, and proves rollback remains usable while mode is `disabled`.
- The main domain, transaction shortcut, counter shortcut, API, required proxy routes, any configured WebSocket route, PWA behavior, and source-map denial all pass public smoke checks.
- GitHub Actions uses a restricted, unexposed key for the dedicated deployment user. The explicitly documented retained-Origin-CA exception is accepted risk and is never described as secure; it does not create a general exception for future leaked credentials.

Unattended production deployment is active only after several healthy manual releases, automatic-mode deploy proof, emergency `disabled` behavior, explicit rollback while disabled, and a controlled release with the reviewer gate removed were all proven on 2026-09-23.

## Resume instructions for a future Codex session

1. Read the repository-root `AGENTS.md` and this roadmap completely.
2. Check `git status`, current branch, latest commit, and whether any workflow files now exist.
3. Confirm the work is on a current isolated task branch/worktree; do not merge the pull request autonomously.
4. Verify the accepted TLS exception and server-owned runtime paths without displaying key material. Do not re-open rotation unless the owner changes direction.
5. Phases 0-6 are complete; continue only with Phase 7 optional/future hardening or a new explicitly authorized scope.
6. Run and report tests after every phase.
7. Do not configure GitHub secrets by placing secret values in commands, files, patches, logs, or chat.
8. Inspect and report the current `PRODUCTION_DEPLOY_MODE`; never change it implicitly, deploy a branch artifact, or remove environment approval without explicit rollout authorization.
9. Do not change deployment mode, production environment settings, host policy, or rollback behavior without explicit rollout authorization and a roadmap update.
10. Update the status matrix and completed checklist in this document after each phase.

## Definition of done

The migration is complete only when GitHub Actions validates merge compatibility, builds and verifies all three applications, publishes a trusted immutable release for every merged `master` SHA, production deploys that exact release without application compilation, runtime secrets and mutable files live outside releases, health checks gate activation, deployment is serialized and auditable, rollback is proven, the manual/automatic/freeze modes behave as documented, the old build-on-start deployment controls are disabled, and `ui/build` is no longer tracked on `master`.
