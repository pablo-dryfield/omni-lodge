# Production host bootstrap

These assets prepare the fixed, root-owned Phase 3 filesystem and privilege
boundaries. They do **not** deploy a release, change the live pointers, reload
SSH, reload systemd, restart PM2, run a migration, or enable a service.

The checked-in deploy entry point and worker are deliberate fail-closed
scaffolds. Do not give a workflow production credentials until the reviewed
protocol submitter, detached worker, recovery implementation, backup gate,
preflight, activation, smoke tests, and rollback path have replaced those
scaffolds and passed a dummy-artifact exercise.

The scaffold also does not implement request replay/idempotency records,
request-size and concurrency admission, free-space/inode capacity gates, or
artifact extraction quotas. Those are explicit activation blockers for the
completed submitter/worker, not behavior supplied by this bootstrap.

## Security model

- The already-created `omnilodge-deploy` account and its existing public key
  are retained. Before bootstrap, an operator copies that public key without
  displaying it into the root-owned
  `/etc/ssh/authorized_keys/omnilodge-deploy`. SSH is explicitly bound to that
  file, so a compromised deploy account cannot authorize another key through
  its writable home. Bootstrap never creates the account, reads or rewrites
  the home copy, or handles a private key.
- Every SSH session for that account is forced through
  `/usr/local/libexec/omnilodge/ssh-gateway`. Interactive shells, TTYs, user RC
  files, agent/X11/TCP/stream forwarding, and tunnels are disabled.
- Effective sshd checks also reject an alternate `AuthorizedKeysCommand`, a
  trusted user CA, or key-controlled user environment values, so the single
  staged Ed25519 key remains the only accepted deployment credential.
- The only accepted original SSH command is the literal
  `omnilodge-deploy-v1`. The request frame travels on stdin.
- The gateway can sudo exactly `/usr/local/sbin/omnilodge-deploy` with no
  command arguments. Caller text never becomes a shell, sudo argument, path,
  or environment variable.
- The server-owned deployment policy starts as canonical JSON with mode
  `disabled`. Changing repository evidence cannot change this host policy.
- Runtime secrets, TLS material, uploads, telemetry spools, logs, private
  source maps, backups, and request state stay outside immutable releases.
- The bootstrap installs inactive systemd worker/recovery units. The worker is
  a root oneshot because it must call the existing root-owned PM2 service and
  backup path; only the narrow, protocol-validating submitter may start it.

The retained root credential is outside this mechanism. Its continued
availability is an owner-accepted exception; it is not copied into these files
or GitHub Actions.

## Fixed paths

```text
/opt/omnilodge/
  incoming/
  releases/
  dependencies/backend/
  dependencies/ui-server/
  backend-current        # created only during cutover
  ui-current             # created only during cutover

/etc/omnilodge/
  deploy-policy.json     # initially disabled, root:root 0600
  backend.env            # server values only, root:root 0600
  ui-server.env          # server values only, root:root 0600
  ecosystem.production.cjs
  tls/origin.key         # copied separately, never by this repository
  tls/origin.pem

/etc/ssh/authorized_keys/
  omnilodge-deploy       # retained public key, root:root 0600

/var/lib/omnilodge/
  uploads/
  runtime/
  logs/
  source-maps/
  deploy/requests/{pending,running,finished}/
  deploy/{state,audit}/

/var/cache/omnilodge/
  npm/
  puppeteer/
```

The stable PM2 launcher requires host-created, exact symlinks in a verified
candidate before it will start:

- each component's `node_modules` must point into the dependency directory for
  its 64-character lockfile hash;
- backend `error.log`, `combined.log`, and `runtime` must point to their fixed
  `/var/lib/omnilodge` targets;
- UI-server `error.log` and `combined.log` must point to their fixed persistent
  targets.

The launcher derives `APP_VERSION`, `GIT_COMMIT_SHA`, and the UI build path from
the selected release manifest. It also requires each dependency link's
64-character directory to equal the corresponding lockfile hash in that
manifest and binds the release-ID suffix to the full source SHA. It forces
production schema sync and access-control seeding off, pins Puppeteer's cache
to `/var/cache/omnilodge/puppeteer`, and uses Node's `--env-file` support for
the two root-only configuration files. The detached worker pins both npm and
Puppeteer caches below `/var/cache/omnilodge`; real runtime values are never
placed in the ecosystem file.

The launcher does not inherit the PM2 daemon or control-panel environment.
It passes only a fixed root identity/PATH plus its enforced invariants to Node;
Node then fills application configuration from the relevant root-owned
`--env-file`. This prevents stale daemon variables from overriding the reviewed
server configuration.

The first cutover intentionally retains the observed root-owned PM2 runtime.
That is a high-privilege inherited risk, not a security improvement. The
forced-command/sudo boundary limits who may request work but cannot sandbox a
compromised root application. Moving the application processes to dedicated
unprivileged service accounts remains follow-up hardening after the artifact
cutover and rollback path are proven.

## Review and install (no activation)

Use a trusted root-owned checkout. Do not paste secrets into the terminal or
the repository.

First place the retained public key under root control. This copies the key; it
does not rotate or display it. Keep the original home file as a recoverable but
ignored copy until the forced-command login is tested from a second session.

```sh
sudo install -d -o root -g root -m 0700 /etc/ssh/authorized_keys
sudo test -f /home/omnilodge-deploy/.ssh/authorized_keys
sudo test ! -L /home/omnilodge-deploy/.ssh/authorized_keys
sudo install -o root -g root -m 0600 \
  /home/omnilodge-deploy/.ssh/authorized_keys \
  /etc/ssh/authorized_keys/omnilodge-deploy
sudo ssh-keygen -l -f /etc/ssh/authorized_keys/omnilodge-deploy >/dev/null
```

Have the operator compare the source and target fingerprints locally if there
is any doubt, without copying them into logs or chat. Bootstrap refuses
`--install` unless the external key file and directory have their exact
root-owned modes and `ssh-keygen` can parse the file.

```sh
sudo sh ops/production/bootstrap-primitives.test.sh
sudo sh ops/production/bootstrap-host.sh --check
sudo sh ops/production/bootstrap-host.sh --dry-run
sudo sh ops/production/bootstrap-host.sh --install
```

The primitive integration test creates one `mktemp` directory, exercises real
idempotent file installation twice, rejects a symbolic-link target, and removes
only that guarded temporary directory. CI runs it on an isolated Linux runner;
do not run repository shell code with sudo from an untrusted checkout.

`--check` is the default and is non-mutating. `--dry-run` performs the same
source, shell, Node, sshd, and sudoers checks, then prints the fixed plan.
`--install` is the only mutating mode. It is idempotent: managed executable and
unit assets are atomically refreshed, while existing policy and environment
files are validated but never overwritten. Existing symlinks, non-root-owned
targets, unsafe modes, an absent deploy account, invalid sshd/sudoers syntax,
an untrusted/missing external AuthorizedKeysFile, an unpinned production
toolchain, or a non-canonical policy stop the install. The required executables
are exactly `/usr/bin/node` 22.23.2 and `/usr/bin/npm` 10.9.8.
The install also requires the effective `omnilodge-deploy` account to have no
supplementary groups or sudo command grant other than the one exact installed
entry point.

The install runs `visudo -cf` and an `sshd -t` candidate check before placing
the privilege-boundary files, then validates the installed forms. Its final
`sshd -T -C` assertions prove the host's real configuration actually includes
the forced command, external key file, password denial, and forwarding denial.
It uses `systemctl show` only to verify the already-observed
`pm2-root.service` identity, plus offline `systemd-analyze verify` and
logrotate debug validation. It does not start, stop, enable, restart, reload,
or switch any service or process.

After install, inspect metadata without displaying environment or key content:

```sh
sudo stat -c '%U:%G %a %n' \
  /etc/ssh/authorized_keys \
  /etc/ssh/authorized_keys/omnilodge-deploy \
  /etc/omnilodge \
  /etc/omnilodge/deploy-policy.json \
  /etc/omnilodge/backend.env \
  /etc/omnilodge/ui-server.env \
  /usr/local/sbin/omnilodge-deploy \
  /usr/local/libexec/omnilodge/ssh-gateway
sudo visudo -cf /etc/sudoers.d/omnilodge-deploy
sudo sshd -t
```

Do not print `/etc/omnilodge/*.env`, TLS key material, deployment requests, or
GitHub environment secrets into a log or support conversation.

## Separate operator-only configuration

These are not bootstrap actions and must be performed from a protected root
session:

1. Populate `/etc/omnilodge/backend.env` and `ui-server.env` from the existing
   server/control-panel values. Keep owner `root:root` and mode `0600`.
2. Copy the retained matching Origin CA key/certificate to
   `/etc/omnilodge/tls/origin.key` and `origin.pem` without echoing them. Keep
   the directory `0700`, private key `0600`, and certificate non-writable by
   group/world. The owner chose to defer rotation; that exception does not
   permit the files to enter an artifact or Git.
3. Configure the reviewed backup command/path in the completed deploy worker.
   A deployment with pending migrations must prove a fresh, non-empty,
   checksummed backup before migration.
4. Replace the three fail-closed deploy scaffolds with the reviewed submitter,
   worker, and recovery implementation. The root submitter must rederive
   authorization from `/etc/omnilodge/deploy-policy.json`; GitHub's claimed
   authorization is audit evidence only.
5. Re-run `--check`, the repository tests, `visudo -cf`, `sshd -t`, and unit
   verification.

## Deliberate activation sequence

Activation is intentionally outside the bootstrap script:

1. Keep the host and repository deployment modes `disabled`.
2. Open and keep a separate working root session before reloading SSH.
3. Complete and test recovery before running `systemctl daemon-reload`. The
   installed PM2 drop-in has both `Requires=` and `After=` on the recovery gate,
   so a failed recovery start blocks PM2 when the new unit graph becomes live.
   The detached worker template and recovery service are not separately
   enabled.
4. Run `systemctl daemon-reload`, inspect the effective PM2 dependencies, and
   confirm a clean recovery run. Do not restart PM2 yet.
5. Reload (not blindly restart) SSH, test a second connection using the deploy
   key and exact forced command, and confirm shell/scp/sftp/forwarding attempts
   are refused. The bootstrap stub must still return a disabled response.
6. Exercise accepted and rejected dummy request frames while production still
   runs from the legacy checkout. Confirm detached worker state and audit logs
   contain no request payload or secret.
7. Perform the real dry run with no pointer switch or service restart.
8. Preserve the legacy checkout and saved PM2 dump. Change the repository mode
   to `manual` only immediately before the approved first cutover; change the
   root-owned policy separately through a protected operator procedure.
9. At cutover, load `/etc/omnilodge/ecosystem.production.cjs` only after the
   backend and UI candidates, dependency links, persistent links, environment,
   TLS, backup, migration, private readiness, public smoke, and rollback gates
   have passed.

Never enable automatic deployment merely by editing evidence submitted over
SSH. The host's canonical policy, protected GitHub environment, workflow mode,
and successful canonical `master` release provenance are independent gates.

## Recovery and rollback

`omnilodge-deploy-recovery.service` is installed but not enabled. Its bootstrap
implementation does not mutate state: it exits successfully when no
`*.in-progress` marker exists and fails closed when one does. The completed
implementation must serialize with the deployment `flock`, validate every
pointer and marker, and either resume a documented safe step or restore the
last verified pointers. It must never guess, run a migration `down`, or overlap
two backend instances.

Rollback remains manual in every deployment mode. Retain current plus at least
three previous verified releases and every dependency directory referenced by
current/previous pointers.
