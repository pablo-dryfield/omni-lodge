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

## Integrated console checkpoint

- Commits through `08ce59de` add host enrollment forms, write-only key/password rotation/revocation with metadata, active sessions/termination, reviewed file mutations, native editor dialogs, mixed-newline preservation, explicit copy/upload overwrite checks, device folder writers, opaque authenticated download intents/ranges and per-file browser outcomes.
- Root policies now apply and probe real aggregate/resource limits, including legacy/hybrid cgroups and reboot-aware budget refresh. Owned staging/private-copy/trash expiry is root controlled. Fixed-size categorized lock pools prevent permanent lock-file growth and nested-category collisions.
- Linux CI run `41788314695` passed the complete real console integration at commit `08ce59de`: independent PostgreSQL grants, repeated provisioning, SSH/SFTP/chroot, upload and broker recovery, checksum publication, trash/restore, PTY nonroot execution, resource limits and watchdog shutdown after parent revocation/broker loss. Earlier failures found an isolated ESM bundle path, a test Host-header issue, unreadable public-key files, repeated bind-mount ownership changes and late SFTP CLOSE errors; each was fixed without weakening the boundary.
- New packages: broker 11 tests pass, isolated UI 3 tests pass, Go signature/path/lock tests pass and Linux cross-build passes. Whole application CI backend PostgreSQL 16/17, UI, UI-server and release tooling have passed on the preceding checkpoints. The latest additions still require a final full CI run.
- Desktop and 390 px browser inspection uses synthetic loopback data. The file list and native editor fit without horizontal document overflow; dirty state, syntax highlighting and nested save review are exercised. Physical mobile keyboard/IME/clipboard testing and production activation remain unverified.
- The next Linux run adds a real 10 GiB sparse-file stream through OpenSSH and the immutable bounded broker, with measured peak memory and byte count. No production disk or real customer file is used for this test.
- Runbook: `system-management-operations.md`. The existing independent control backup now uses the established backup maintenance identity to include both protected schemas while retaining runtime-role separation.

No real PR, production provisioning, feature activation or deployment has occurred yet. DNS remains pending the previously asked `system` record. All remaining acceptance and operational gates must be reported accurately before release.

Latest local full checks passed: 318 backend suites / 3,143 tests (one existing skip), 146 UI suites / 1,047 tests, UI-server 40 passed / one Windows symlink skip, release tooling 300 passed / ten Windows platform skips. The PostgreSQL journal integration, including concurrent download-claim exclusion, also passed using a disposable local database and roles that were removed afterward.

The large-stream rehearsal reached the real 10-minute reauthentication boundary and exposed an incorrect ongoing-read check. Continuing accepted streams now validate general authorization while admission/new mutations still require fresh password confirmation. The fixture keeps an explicitly active parent session and reauthenticates before its next mutation. Generic downloads do not advertise unsafe range resume; managed read grants bind root-owned inode/high-resolution identity, an already-open SFTP handle and source version. A fresh Linux result is still required for these changes. Production remains unmodified; the latest read-only probe found approximately 5 GiB free on its two-CPU host. DNS for the isolated hostname remains absent.


## Browser and recovery review

- Browser viewport checks now include 1440, 1024, 768, 390 and 360 px. The 360 px restart dialog was corrected to stack its confirmation label and input. Physical iOS/Android IME, clipboard and file-picker acceptance is still pending.
- A real browser terminal mount exposed the Unicode11 add-on's requirement for xterm's local proposed API. The renderer now enables that API while still blocking clipboard/link OSC sequences. A terminal-specific error boundary preserves the rest of the console if its renderer fails. The synthetic loopback WebSocket fixture confirms successful terminal mounting and Polish/emoji input echo; it executes no real commands.
- Staging cleanup retains its root-owned registration when any owned-file removal fails; unexpected directories are preserved. A Go regression covers failure and a safe retry after partial cleanup. Broker crash recovery now marks interrupted planning and download-streaming states unknown; the disposable PostgreSQL integration verifies both.
- Host bootstrap now fails before mutations if the administrator query fails or returns no eligible actor. Manual and followed log responses are fenced to their current view/request.
- Linux run 41792027045 was cancelled after its 900-second test deadline. Progress showed 1,073,789,360 bytes after 674,876 ms. The SSH socket now explicitly disables Nagle buffering; the next run retains the same 10 GiB payload and 256 MiB / 25 percent CPU ceiling, records baseline/concurrent probe timings, and aborts the HTTP request with the test deadline so a timed-out fixture cannot keep running indefinitely. A successful replacement result is required; this cancelled run is not acceptance.
