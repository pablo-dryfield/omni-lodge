import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  parseCanonicalHostDeployPolicyBytes,
  serializeCanonicalHostDeployPolicy,
} from '../../scripts/deploy/host/deploy-policy.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFile(path.join(root, relative), 'utf8');

const expectedAssets = [
  'README.md',
  'bootstrap-host.sh',
  'bootstrap-primitives.test.sh',
  'config/deploy-policy.json',
  'config/backend.env',
  'config/ui-server.env',
  'ssh/90-omnilodge-deploy.conf',
  'sudoers/omnilodge-deploy',
  'bin/ssh-gateway',
  'bin/omnilodge-deploy',
  'bin/omnilodge-deploy-worker',
  'bin/omnilodge-deploy-recover',
  'bin/runtime-launcher.mjs',
  'lib/bootstrap-functions.sh',
  'systemd/omnilodge-deploy-worker@.service',
  'systemd/omnilodge-deploy-recovery.service',
  'systemd/pm2-root-omnilodge-deploy.conf',
  'pm2/ecosystem.production.cjs',
  'logrotate/omnilodge',
];

const expectedControlPlaneAssets = [
  'ops/production/libexec/deploy/audit-log.mjs',
  'ops/production/libexec/deploy/canonical-json.mjs',
  'ops/production/libexec/deploy/capacity.mjs',
  'ops/production/libexec/deploy/constants.mjs',
  'ops/production/libexec/deploy/deployment-flock.mjs',
  'ops/production/libexec/deploy/index.mjs',
  'ops/production/libexec/deploy/release-preparation.mjs',
  'ops/production/libexec/deploy/request-store.mjs',
  'ops/production/libexec/deploy/secure-filesystem.mjs',
  'ops/production/libexec/deploy/state-schema.mjs',
  'ops/production/libexec/deploy/submit-request.mjs',
  'ops/production/libexec/deploy/worker.mjs',
  'scripts/deploy/extract-github-artifact.mjs',
  'scripts/deploy/github-release-evidence.mjs',
  'scripts/deploy/host/deploy-policy.mjs',
  'scripts/deploy/host/protocol.mjs',
  'scripts/deploy/host/protocol-v2.mjs',
  'scripts/deploy/host/request-receiver.mjs',
  'scripts/deploy/host/state.mjs',
  'scripts/release/lib.mjs',
];

test('production bootstrap asset set is complete and contains no CRLF', async () => {
  for (const relative of expectedAssets) {
    await access(path.join(root, relative));
    const contents = await read(relative);
    assert.ok(contents.length > 0, `${relative} must not be empty`);
    assert.doesNotMatch(contents, /\r/, `${relative} must use LF line endings`);
  }
  for (const relative of expectedControlPlaneAssets) {
    const source = path.resolve(root, '../..', relative);
    await access(source);
    const contents = await readFile(source, 'utf8');
    assert.ok(contents.length > 0, `${relative} must not be empty`);
  }
});

test('host deployment policy is canonical and disabled by default', async () => {
  const policy = await read('config/deploy-policy.json');
  assert.equal(policy, '{\n  "schemaVersion": 1,\n  "deploymentMode": "disabled"\n}\n');
  const expected = { schemaVersion: 1, deploymentMode: 'disabled' };
  assert.deepEqual(parseCanonicalHostDeployPolicyBytes(Buffer.from(policy)), expected);
  assert.deepEqual(Buffer.from(policy), serializeCanonicalHostDeployPolicy(expected));
});

test('SSH account is forced through a non-interactive, non-forwarding gateway', async () => {
  const sshd = await read('ssh/90-omnilodge-deploy.conf');
  for (const directive of [
    'Match User omnilodge-deploy',
    'AuthenticationMethods publickey',
    'PubkeyAuthentication yes',
    'AuthorizedKeysFile /etc/ssh/authorized_keys/omnilodge-deploy',
    'AuthorizedKeysCommand none',
    'TrustedUserCAKeys none',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PermitTTY no',
    'X11Forwarding no',
    'AllowAgentForwarding no',
    'AllowTcpForwarding no',
    'AllowStreamLocalForwarding no',
    'PermitTunnel no',
    'PermitUserRC no',
    'PermitOpen none',
    'PermitListen none',
    'ForceCommand /usr/local/libexec/omnilodge/ssh-gateway',
    'Match all',
  ]) {
    assert.match(sshd, new RegExp(`^\\s*${directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'));
  }
  assert.doesNotMatch(sshd, /^\s*(?:DisableForwarding|PermitUserEnvironment)\b/m);

  const gateway = await read('bin/ssh-gateway');
  assert.match(gateway, /SSH_ORIGINAL_COMMAND-}" != 'omnilodge-deploy-v1'/);
  assert.match(gateway, /\/usr\/bin\/sudo -n -H -- \/usr\/local\/sbin\/omnilodge-deploy\s*$/m);
  assert.doesNotMatch(gateway, /eval|\b(?:bash|sh)\s+-c\b/);
});

test('sudo boundary permits one root command with exactly zero arguments', async () => {
  const sudoers = await read('sudoers/omnilodge-deploy');
  const rules = sudoers.split('\n').filter((line) => line.trim() && !line.startsWith('Defaults:'));
  assert.deepEqual(rules, [
    'omnilodge-deploy ALL=(root) NOPASSWD: /usr/local/sbin/omnilodge-deploy ""',
  ]);
  assert.doesNotMatch(sudoers, /\*|ALL=\(ALL/);

  const rootEntry = await read('bin/omnilodge-deploy');
  assert.match(rootEntry, /\[ "\$#" -ne 0 \]/);
  assert.match(rootEntry, /CONTROL_PLANE_ENTRY='\/usr\/local\/libexec\/omnilodge\/control-plane\/ops\/production\/libexec\/deploy\/submit-request\.mjs'/);
  assert.match(rootEntry, /\/usr\/bin\/node "\$CONTROL_PLANE_ENTRY"/);
  assert.match(rootEntry, /It does not activate releases or run migrations/);
  assert.doesNotMatch(rootEntry, /eval|\b(?:bash|sh)\s+-c\b/);

  const bootstrap = await read('bootstrap-host.sh');
  assert.ok(bootstrap.includes(String.raw`gsub(/\\"/, "\"", line)`));
});

test('bootstrap has an explicit mutating mode and never activates services or keys', async () => {
  const bootstrap = await read('bootstrap-host.sh');
  assert.match(bootstrap, /--check\|--dry-run\|--install/);
  assert.match(bootstrap, /MODE='check'/);
  assert.match(bootstrap, /install_assets\(\)/);
  assert.match(bootstrap, /No service was enabled, started, restarted, reloaded, or switched/);
  assert.doesNotMatch(bootstrap, /^\s*(?:systemctl|service|pm2|ssh-keygen|adduser|useradd)(?:\s|$)/m);
  assert.doesNotMatch(bootstrap, /\bsystemctl[^\n]*(?:start|restart|reload|enable|disable|stop)\b/);
  assert.doesNotMatch(bootstrap, /\/home\/omnilodge-deploy\/\.ssh\/authorized_keys/);
  assert.match(bootstrap, /\/usr\/bin\/node 22\.23\.2 and \/usr\/bin\/npm 10\.9\.8/);
  assert.match(bootstrap, /AUTHORIZED_KEYS_TARGET='\/etc\/ssh\/authorized_keys\/omnilodge-deploy'/);
  assert.match(bootstrap, /assert_exact_directory "\$AUTHORIZED_KEYS_DIR" '755'/);
  assert.match(bootstrap, /assert_exact_file "\$AUTHORIZED_KEYS_TARGET" '644'/);
  assert.match(bootstrap, /ensure_directory "\$AUTHORIZED_KEYS_DIR" 755/);
  assert.match(bootstrap, /CONTROL_PLANE_ROOT='\/usr\/local\/libexec\/omnilodge\/control-plane'/);
  assert.match(bootstrap, /ensure_directory "\$STATE_ROOT\/deploy\/installer-home" 700/);
  assert.match(bootstrap, /deploy\/requests\/nonces/);
  assert.match(bootstrap, /deploy\/audit\/segments/);
  assert.match(bootstrap, /ops\/production\/libexec\/deploy\/submit-request\.mjs/);
  assert.match(bootstrap, /scripts\/deploy\/host\/protocol-v2\.mjs/);
  assert.ok(
    bootstrap.indexOf('bootstrap_assert_trusted_source_chain "$BOOTSTRAP_LIBRARY"')
      < bootstrap.indexOf('. "$BOOTSTRAP_LIBRARY"'),
    'root must validate the helper and its ancestor chain before sourcing it',
  );
  assert.match(bootstrap, /omni_assert_root_controlled_ancestors "\$source_path"/);
  assert.ok(
    bootstrap.indexOf('omni_assert_root_controlled_ancestors "$(source_file "$relative_path")"')
      < bootstrap.indexOf('validate_policy_file "$(source_file config/deploy-policy.json)"'),
    'root must validate every source asset chain before parsing repository-owned configuration',
  );
  for (const invariant of [
    "grep -qx 'pubkeyauthentication yes'",
    "grep -qx 'authenticationmethods publickey'",
    "grep -qx 'authorizedkeyscommand none'",
    "grep -qx 'trustedusercakeys none'",
    "grep -qx 'permituserenvironment no'",
  ]) {
    assert.equal(bootstrap.split(invariant).length - 1, 2, `${invariant} must be checked before and after install`);
  }
  assert.doesNotMatch(bootstrap, /(?:BEGIN [A-Z ]*PRIVATE KEY|ssh-ed25519\s+[A-Za-z0-9+/]{20,})/);
});

test('detached worker and recovery units are inactive with fixed commands', async () => {
  const worker = await read('systemd/omnilodge-deploy-worker@.service');
  assert.match(worker, /^Type=oneshot$/m);
  assert.match(worker, /^User=root$/m);
  assert.match(worker, /^ExecStart=\/usr\/local\/sbin\/omnilodge-deploy-worker %i$/m);
  assert.match(worker, /^ProtectSystem=full$/m);
  assert.match(worker, /^Environment=NPM_CONFIG_CACHE=\/var\/cache\/omnilodge\/npm$/m);
  assert.match(worker, /^Environment=PUPPETEER_CACHE_DIR=\/var\/cache\/omnilodge\/puppeteer$/m);
  assert.doesNotMatch(worker, /^\[Install\]$/m);

  const recovery = await read('systemd/omnilodge-deploy-recovery.service');
  assert.match(recovery, /^Before=pm2-root\.service$/m);
  assert.match(recovery, /^ExecStart=\/usr\/local\/sbin\/omnilodge-deploy-recover$/m);
  assert.doesNotMatch(recovery, /^\[Install\]$/m);
  const pm2Gate = await read('systemd/pm2-root-omnilodge-deploy.conf');
  assert.match(pm2Gate, /^Requires=omnilodge-deploy-recovery\.service$/m);
  assert.match(pm2Gate, /^After=omnilodge-deploy-recovery\.service$/m);
  const recoveryCommand = await read('bin/omnilodge-deploy-recover');
  assert.match(recoveryCommand, /Deployment state directory is missing or unsafe/);
  assert.match(recoveryCommand, /if ! find "\$STATE_DIR"[^\n]+>"\$marker_list"; then/);
  assert.doesNotMatch(recoveryCommand, /find[^\n]*\|/);
  assert.match(recoveryCommand, /flock -n 9/);
  assert.match(recoveryCommand, /'\*\.in-progress'/);
  assert.doesNotMatch(recoveryCommand, /\bmv\b|\brm\b[^\n]*(?:STATE_DIR|DEPLOY_LOCK|\/var\/lib\/omnilodge)/);

  const workerCommand = await read('bin/omnilodge-deploy-worker');
  assert.match(workerCommand, /-4\[0-9a-f\]\[0-9a-f\]\[0-9a-f\]-\[89ab\]/);
  assert.doesNotMatch(workerCommand, /-\[1-5\]\[0-9a-f\]/);
  assert.match(workerCommand, /exec \/usr\/bin\/node "\$CONTROL_PLANE_ENTRY" "\$1"/);
});

test('stable PM2 definition keeps one fork-mode instance per component', async () => {
  const ecosystemPath = path.join(root, 'pm2/ecosystem.production.cjs');
  const ecosystem = (await import(`${pathToFileURL(ecosystemPath).href}?test=${Date.now()}`)).default;
  assert.equal(ecosystem.apps.length, 2);
  assert.deepEqual(ecosystem.apps.map((app) => app.name), ['omni-lodge-be', 'omni-lodge-ui-server']);
  for (const app of ecosystem.apps) {
    assert.equal(app.cwd, '/');
    assert.equal(app.interpreter, '/usr/bin/node');
    assert.equal(app.exec_mode, 'fork');
    assert.equal(app.instances, 1);
    assert.equal(app.watch, false);
    assert.equal(app.script, '/usr/local/libexec/omnilodge/runtime-launcher.mjs');
  }
});

test('runtime launcher uses only fixed release/config/state roots', async () => {
  const launcher = await read('bin/runtime-launcher.mjs');
  for (const required of [
    "const ROOT = '/opt/omnilodge'",
    "'/etc/omnilodge/backend.env'",
    "'/etc/omnilodge/ui-server.env'",
    "'/etc/omnilodge/tls/origin.key'",
    "'/var/lib/omnilodge/runtime/error-monitoring/failed-events.ndjson'",
    "SKIP_DB_SYNC: 'true'",
    "DB_SYNC_ALTER: 'false'",
    "SEED_ACCESS_CONTROL: 'false'",
    "APP_RUNTIME_MODE: 'primary'",
    "PUPPETEER_CACHE_DIR: '/var/cache/omnilodge/puppeteer'",
    "identity.lockfiles['be/package-lock.json']",
    "identity.lockfiles['ui-server/package-lock.json']",
  ]) {
    assert.ok(launcher.includes(required), `missing launcher invariant: ${required}`);
  }
  assert.doesNotMatch(launcher, /child_process[^\n]*exec|\beval\s*\(/);
  assert.doesNotMatch(launcher, /env:\s*\{\s*\.\.\.process\.env/);
  assert.match(launcher, /env:\s*\{ \.\.\.BASE_ENV, \.\.\.launch\.env \}/);
  for (const fixedIdentity of ["HOME: '/root'", "USER: 'root'", "LOGNAME: 'root'"]) {
    assert.ok(launcher.includes(fixedIdentity), `missing minimal child identity: ${fixedIdentity}`);
  }
  assert.match(launcher, /requireReleaseFile/);
  assert.match(launcher, /escapes its release component/);
});

test('runtime launcher accepts candidate and rejects non-candidate release manifests', async () => {
  const launcherPath = path.join(root, 'bin/runtime-launcher.mjs');
  const { validateReleaseManifestIdentity } = await import(
    `${pathToFileURL(launcherPath).href}?manifest-test=${Date.now()}`
  );
  const sourceSha = 'a'.repeat(40);
  const releaseId = `omnilodge-r123-a1-${sourceSha.slice(0, 12)}`;
  const manifest = {
    schemaVersion: 1,
    releaseId,
    sourceSha,
    lockfiles: {
      'be/package-lock.json': 'b'.repeat(64),
      'ui/package-lock.json': 'c'.repeat(64),
      'ui-server/package-lock.json': 'd'.repeat(64),
    },
    productionEligibility: { candidate: true, reasons: [] },
  };
  assert.deepEqual(validateReleaseManifestIdentity(manifest, releaseId), {
    releaseId,
    sourceSha,
    lockfiles: manifest.lockfiles,
  });
  assert.throws(
    () => validateReleaseManifestIdentity({
      ...manifest,
      productionEligibility: { candidate: false, reasons: ['not-canonical'] },
    }, releaseId),
    /not production eligible/,
  );
  assert.throws(
    () => validateReleaseManifestIdentity({
      ...manifest,
      productionEligibility: { eligible: true },
    }, releaseId),
    /not production eligible/,
  );
  assert.throws(
    () => validateReleaseManifestIdentity({ ...manifest, lockfiles: {} }, releaseId),
    /lockfile inventory/,
  );
  assert.throws(
    () => validateReleaseManifestIdentity({
      ...manifest,
      sourceSha: `f${sourceSha.slice(1)}`,
    }, releaseId),
    /bound to its source SHA/,
  );
});

test('logrotate covers persistent application, PM2, and deployment logs', async () => {
  const config = await read('logrotate/omnilodge');
  for (const directory of ['backend', 'ui-server', 'pm2', 'deploy']) {
    assert.ok(config.includes(`/var/lib/omnilodge/logs/${directory}/*.log`));
  }
  assert.match(config, /create 0600 root root/);
  assert.match(config, /copytruncate/);
});

test('shell assets pass sh -n when a POSIX shell is available', async (context) => {
  const probe = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' });
  if (probe.error?.code === 'ENOENT') {
    context.skip('POSIX shell is unavailable on this platform');
    return;
  }
  assert.equal(probe.status, 0);
  const scripts = [
    'bootstrap-host.sh',
    'bin/ssh-gateway',
    'bin/omnilodge-deploy',
    'bin/omnilodge-deploy-worker',
    'bin/omnilodge-deploy-recover',
    'lib/bootstrap-functions.sh',
    'bootstrap-primitives.test.sh',
  ].map((relative) => path.join(root, relative));
  const result = spawnSync('sh', ['-n', ...scripts], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
