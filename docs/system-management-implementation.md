# System Management implementation ledger

Status: **in progress; not deployed**. User authorized implementation and production deployment on 4 November 2026. Deliver all agreed scope together; this ledger is not a release acceptance claim.

Branch: `codex/system-management`, based on `b0bd3dd4e615dec51a070e29ea123c51b06dae4c`. Architecture: [complete plan](system-management-architecture-plan.md).

## Implemented foundations

- Existing Control Panel registry integration, strict profile/policy validation, encrypted non-revealable credentials and transactional configuration mutation/secret patch locking.
- Application login `jti` records, password-fingerprint invalidation and server-side logout revocation; global administrator/page/action/host authorization and private HMAC-authenticated authority RPC.
- Isolated React/Vite console, SSH2 broker, mandatory address and host-key pins, AES-GCM job journal, typed routes/CSRF/Origin checks, one-use attachment grants and bounded PTY replay/backpressure.
- Terminal tabs/split, mobile keyboard controls and paste preview; remote file browser, text editing/conflicts, managed and generic transfer paths, checksum/resume, capacity reservations, ZIP64 folder downloads, folder comparison, trash restore and operation reconciliation.
- Go Linux adapter with signed requests, root policy ceiling, nonroot shell units, remote execution lease/watchdog, staging-only SFTP publication, private verified copies and root-private operation journal.
- Main Settings launcher/navigation, persistent reserved-origin ingress guard, parent-bound broker supervision, resource checks and deployment-readiness integration.
- Root-only immutable-release provisioning entry points and separate authority/broker control-schema roles.

## Remaining work before a PR/release

This list must be resolved against SM01–SM11 in the architecture plan, not silently removed to imply completion.

- Verify the implemented optional encrypted segmented terminal recordings, committed-prefix recovery, viewing UI and artifact cleanup with fault tests.
- Finish connection/capability testing and polished host enrollment controls; test standalone launch when embedded cookies are blocked.
- Finish resource/admission quotas, per-actor transfer concurrency, cleanup/retention, remote unit/watchdog locking and effective remote isolation probes.
- Review file publication/copy atomicity, save conflicts, explicit overwrite choices, recursive permanent deletion/manifests and trash capacity/expiry.
- Complete fresh authorization during long reads/transfers, durable recovery and uncertain-outcome reconciliation, directory download status and transfer queue behavior.
- Consolidate/disable old PM2 controls and verify structured restart recovery/health.
- Integrate immutable release packaging/CI for the bundled broker, Go binary/schema/bootstrap assets and isolated console assets. No production build; no generated output commits.
- Add Linux OpenSSH/systemd/PostgreSQL integration and fault/security tests, browser desktop/mobile verification, required full repository checks and operations runbook.
- Verify production provisioning plan, enable through Control Panel only after readiness, create real PR, observe merge/release/deploy, verify public/management health and workflows, then clean only task-owned local branches.

## Environment and verification notes

- Windows has no Docker or installed WSL. Linux cgroup/OpenSSH adapter acceptance must run on a disposable Linux CI/fixture host; a Windows test pass does not prove it.
- Verified portable local toolchains outside the repo: `%LOCALAPPDATA%/OmniLodgeTools/node-v22.23.2-win-x64` (Node 22.23.2 / npm 10.9.8) and `%LOCALAPPDATA%/OmniLodgeTools/go` (Go 1.27.3). Prepend the Node directory to the per-command PATH before repository checks; the machine default Node/npm differs.
- Production was inspected read-only: `/usr/bin/node`, `/usr/bin/pm2`, no nginx, existing UI-server HTTPS on port 443, wildcard certificate for `*.omni-lodge.com`, approximately 3.2 GiB free. Management hostname has no DNS record yet. No runtime provisioning or production mutation has occurred.
- An asynchronous question asks the user to add a proxied A record `system` → `23.95.192.213`, or authorize using their signed-in Cloudflare browser. No answer received at this checkpoint. A stale local Wrangler OAuth credential was identified; its values were never printed or committed. Do not assume DNS has been added.
- Initial broker tests pass real SSH PTY exchange, host-key mismatch rejection, address policy, path validation and ciphertext integrity. Initial Go signature/path tests pass locally; symlink availability is OS-dependent. New Control Panel validation tests pass. UI-server full suite passed 42 tests, skipped one Windows symlink case.
- Initial full backend: 315 suites passed, two failed due to eager login-session DB imports; fixed using lazy imports and both targeted suites pass (10 tests). Initial full UI: 145 suites passed, one TableBrowser timeout; isolated rerun passes all three cases. Full reruns remain required after final edits.
- Release tooling initial suite: 80 passed, one Windows POSIX-mode skip. Reserved-origin ingress tests pass real first-request WebSocket, header/cookie isolation, unavailable-broker rollback behavior.
- Fixed private-copy publication, generic nonroot UID probes, bounded terminal input queues with attachment fencing, policy-budget restart handling and editor conflict reload. Backend, broker and isolated UI type checks pass at this checkpoint; Go path/signature tests pass.

## Packaging decision to finish implementing

Bundle broker dependencies in CI with esbuild as a single Node ESM artifact; test its pure-JavaScript SSH fallback under production's install policy. Place generated broker/adapter/schema/bootstrap assets under the existing `be/dist/systemManagement` artifact tree, and isolated UI under `ui/build/system-management`. This preserves the existing immutable host dependency-layer model and avoids a new npm installation on production. Embed the management lockfile/source identity in build metadata and require it in release validation. All generated output stays untracked.


## Rollback ingress requirement

The root-owned runtime launcher must preload `system-ingress-guard.mjs` before **every** UI release, including pre-feature releases. It reserves `system.omni-lodge.com`, strips main-application credentials, forwards only to the loopback broker and returns a console-only 503 if unavailable. The guard is installed through the reviewed production bootstrap, outside immutable release directories. Install/update this host control plane from the trusted merged SHA before activating the release or adding public DNS; do not rely on release-owned SPA middleware for isolation. The isolated-origin Control Panel value is validated against this provisioned hostname. Rollback never removes the guard or revives an old console authorization generation.


## Second checkpoint: durability and executable release gates

- Local commit `989efc1f` preserves the initial isolated runtime; subsequent work adds encrypted bounded history summaries, PostgreSQL-enforced quotas and transactional intent/audit insertion, one-use terminal input fencing, optional authenticated recordings, idle/absolute session lifetimes and retained-session handling.
- Managed copies/publication now use separate bounded root workers with renewable leases and a publication critical section; root service restarts run independently of SSH and check actual backend/UI readiness. Generic copies use a private verified temporary file and create-only rename. Uncertain publication cannot be relabelled cancelled or resumed as a staging write.
- Managed recursive permanent deletion uses a bounded directory digest that is rebuilt before mutation. Trash quota/expiry and root-owned cleanup are implemented. Authority-owned history cleanup retains uncertain operations. Further tests and UX work below remain necessary.
- Old main-app PM2 endpoints return 410 and Settings directs users to System Management. Console sessions are revoked on authority/backend restart; broker-only recovery can retain a still-valid authority session.
- A root-owned ingress preload permanently reserves the console hostname across application rollback. Release verification accepts complete legacy payloads for rollback, while any payload containing console files must contain the complete console runtime. New release construction still requires all console assets.
- Shared CI/release Linux validation provisions disposable OS identities/chroots and PostgreSQL databases, tests actual broker authority/SSH/SFTP/PTY/restart recovery, and verifies orphan shutdown. It must pass before deployment; Windows skips are not acceptance.
- Real local PostgreSQL integration passed using a temporary database and unique restricted roles, all removed afterwards. It caught and fixed an attempted `SELECT FOR UPDATE` that would have required inappropriate UPDATE privileges on quota counters. Tests cover role boundaries, atomic intent rollback, concurrent idempotency, secret-free history summaries, update failure semantics, capacity reservations and hard quota triggers.
- Latest local results: broker 8 tests passed; isolated UI 3 passed; backend configuration/health 13 passed; Settings landing 6 passed; release/preparation 101 passed with five Windows platform skips; broker/isolated UI/backend/main UI type checks passed at their checkpoints. Full backend/UI suites must still be rerun after final edits. Linux execution and visual desktop/mobile QA remain pending.


The next branch push is for Linux CI validation while final UX/recovery work continues. It does not publish an incomplete application release. No PR is opened and no production activation occurs until the full checklist is cleared. The real PostgreSQL test command is `MANAGEMENT_TEST_ADMIN_URL=<local test cluster> node management-server/node_modules/tsx/dist/cli.mjs --test management-server/test/postgres.integration.ts`; no connection secret belongs in this document or CI logs.
