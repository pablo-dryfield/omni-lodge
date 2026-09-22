#!/usr/bin/node

import {
  constants,
  fstatSync,
  lstatSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RELEASE_ID = /^omnilodge-r[1-9][0-9]*-a[1-9][0-9]*-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const LOCK_HASH = /^[0-9a-f]{64}$/;
const LOCKFILE_PATHS = Object.freeze([
  'be/package-lock.json',
  'ui/package-lock.json',
  'ui-server/package-lock.json',
]);
const PINNED_NODE_VERSION = '22.23.2';
const PINNED_NPM_VERSION = '10.9.8';
const TARGET_PLATFORM = 'linux';
const TARGET_ARCH = 'x64';
const DEPENDENCY_INSTALL_FLAGS = Object.freeze([
  'ci',
  '--omit=dev',
  '--no-audit',
  '--no-fund',
  '--ignore-scripts',
]);
const LOCKFILE_BY_COMPONENT = Object.freeze({
  backend: 'be/package-lock.json',
  'ui-server': 'ui-server/package-lock.json',
});
const PACKAGE_FILE_BY_COMPONENT = Object.freeze({
  backend: 'be/package.json',
  'ui-server': 'ui-server/package.json',
});
const ROOT = '/opt/omnilodge';
const RELEASES = `${ROOT}/releases`;
const NODE = '/usr/bin/node';
const BASE_ENV = Object.freeze({
  HOME: '/root',
  LOGNAME: 'root',
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  USER: 'root',
});

const fail = (message) => {
  throw new Error(message);
};

const canonicalDigest = (value) => createHash('sha256')
  .update(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))
  .digest('hex');

const manifestFileHash = (manifest, filePath) => {
  const match = manifest.files?.find((file) => file?.path === filePath);
  if (typeof match?.sha256 !== 'string' || !LOCK_HASH.test(match.sha256)) {
    fail(`Release manifest is missing ${filePath}`);
  }
  return match.sha256;
};

const dependencyLayerKey = ({ lockSha256, packageSha256, toolchain }) => canonicalDigest({
  lockSha256,
  packageSha256,
  node: toolchain.node,
  npm: toolchain.npm,
  platform: TARGET_PLATFORM,
  arch: TARGET_ARCH,
  installFlags: DEPENDENCY_INSTALL_FLAGS,
});

const dependencyLayerKeysFromManifest = ({ manifest, lockfiles }) => {
  const toolchain = manifest.toolchain;
  if (
    toolchain === null
    || typeof toolchain !== 'object'
    || Array.isArray(toolchain)
    || toolchain.node !== PINNED_NODE_VERSION
    || toolchain.npm !== PINNED_NPM_VERSION
  ) fail('Release manifest toolchain is invalid');

  return Object.freeze({
    backend: dependencyLayerKey({
      lockSha256: lockfiles[LOCKFILE_BY_COMPONENT.backend],
      packageSha256: manifestFileHash(manifest, PACKAGE_FILE_BY_COMPONENT.backend),
      toolchain,
    }),
    'ui-server': dependencyLayerKey({
      lockSha256: lockfiles[LOCKFILE_BY_COMPONENT['ui-server']],
      packageSha256: manifestFileHash(manifest, PACKAGE_FILE_BY_COMPONENT['ui-server']),
      toolchain,
    }),
  });
};

const assertRootFile = (filePath, { allowedModes = [0o600], nonEmpty = false } = {}) => {
  const before = lstatSync(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) fail(`${filePath} must be a regular file`);
  if (process.platform !== 'win32') {
    if (before.uid !== 0n || before.gid !== 0n) fail(`${filePath} must be owned by root:root`);
    if (!allowedModes.includes(Number(before.mode) & 0o777)) {
      fail(`${filePath} has unsafe permissions`);
    }
  }
  const descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let opened;
  try {
    opened = fstatSync(descriptor, { bigint: true });
  } finally {
    closeSync(descriptor);
  }
  const after = lstatSync(filePath, { bigint: true });
  if (
    before.dev !== opened.dev
    || before.ino !== opened.ino
    || before.dev !== after.dev
    || before.ino !== after.ino
  ) fail(`${filePath} changed during validation`);
  if (nonEmpty && opened.size === 0n) fail(`${filePath} must not be empty`);
  return opened;
};

const assertRootDirectory = (directoryPath) => {
  const value = lstatSync(directoryPath, { bigint: true });
  if (!value.isDirectory() || value.isSymbolicLink()) fail(`${directoryPath} must be a directory`);
  if (process.platform !== 'win32') {
    if (value.uid !== 0n || value.gid !== 0n) fail(`${directoryPath} must be owned by root:root`);
    if ((Number(value.mode) & 0o022) !== 0) fail(`${directoryPath} must not be group/world writable`);
  }
};

const requireManagedSymlink = (linkPath, expectedRoot, expectedSuffix = '') => {
  const link = lstatSync(linkPath, { bigint: true });
  if (!link.isSymbolicLink()) fail(`${linkPath} must be a symbolic link`);
  if (process.platform !== 'win32' && (link.uid !== 0n || link.gid !== 0n)) {
    fail(`${linkPath} must be owned by root:root`);
  }
  const target = realpathSync(linkPath);
  const relative = path.relative(expectedRoot, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${linkPath} escapes ${expectedRoot}`);
  }
  if (expectedSuffix && !target.endsWith(expectedSuffix)) fail(`${linkPath} has an unexpected target`);
  assertRootDirectory(target);
  return target;
};

export const validateReleaseManifestIdentity = (manifest, releaseId) => {
  if (manifest?.schemaVersion !== 1 || manifest.releaseId !== releaseId || !RELEASE_ID.test(releaseId)) {
    fail('Release manifest identity is invalid');
  }
  if (typeof manifest.sourceSha !== 'string' || !SHA.test(manifest.sourceSha)) {
    fail('Release manifest source SHA is invalid');
  }
  if (releaseId.split('-').at(-1) !== manifest.sourceSha.slice(0, 12)) {
    fail('Release ID is not bound to its source SHA');
  }
  const lockfiles = manifest.lockfiles;
  if (
    lockfiles === null
    || typeof lockfiles !== 'object'
    || Array.isArray(lockfiles)
    || Object.keys(lockfiles).length !== LOCKFILE_PATHS.length
    || !Object.keys(lockfiles).every((key, index) => key === LOCKFILE_PATHS[index])
    || !LOCKFILE_PATHS.every((key) => typeof lockfiles[key] === 'string' && LOCK_HASH.test(lockfiles[key]))
  ) fail('Release manifest lockfile inventory is invalid');
  if (
    manifest.productionEligibility?.candidate !== true
    || !Array.isArray(manifest.productionEligibility.reasons)
    || manifest.productionEligibility.reasons.length !== 0
  ) fail('Release is not production eligible');
  const frozenLockfiles = Object.freeze({ ...lockfiles });
  return Object.freeze({
    releaseId,
    sourceSha: manifest.sourceSha,
    lockfiles: frozenLockfiles,
    dependencyLayerKeys: dependencyLayerKeysFromManifest({ manifest, lockfiles: frozenLockfiles }),
  });
};

const readManifest = (releaseRoot) => {
  const manifestPath = path.join(releaseRoot, 'release-manifest.json');
  assertRootFile(manifestPath, { allowedModes: [0o400, 0o444, 0o600, 0o640, 0o644] });
  const bytes = readFileSync(manifestPath);
  if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) fail('Release manifest has an invalid size');
  const manifest = JSON.parse(bytes.toString('utf8'));
  const releaseId = path.basename(releaseRoot);
  return validateReleaseManifestIdentity(manifest, releaseId);
};

const requireReleaseFile = (filePath, componentRoot) => {
  const resolvedRoot = realpathSync(componentRoot);
  const resolvedFile = realpathSync(filePath);
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${filePath} escapes its release component`);
  }
  assertRootFile(filePath, { allowedModes: [0o644], nonEmpty: true });
};

const requireDependencyLink = (componentRoot, component, expectedLayerKey) => {
  const nodeModulesPath = path.join(componentRoot, 'node_modules');
  const target = requireManagedSymlink(
    nodeModulesPath,
    `${ROOT}/dependencies/${component}`,
    '/node_modules',
  );
  const layerDirectory = path.basename(path.dirname(target));
  if (!LOCK_HASH.test(layerDirectory) || layerDirectory !== expectedLayerKey) {
    fail(`${nodeModulesPath} is not keyed by the release dependency layer`);
  }
};

const requirePersistentFileLink = (componentRoot, name, expected) => {
  const linkPath = path.join(componentRoot, name);
  const value = lstatSync(linkPath, { bigint: true });
  if (!value.isSymbolicLink()) fail(`${linkPath} must be a persistent-file link`);
  if (process.platform !== 'win32' && (value.uid !== 0n || value.gid !== 0n)) {
    fail(`${linkPath} must be owned by root:root`);
  }
  if (realpathSync(linkPath) !== expected) fail(`${linkPath} has an unexpected persistent target`);
  assertRootFile(expected);
};

const requirePersistentDirectoryLink = (componentRoot, name, expected) => {
  const target = requireManagedSymlink(path.join(componentRoot, name), path.dirname(expected));
  if (target !== expected) fail(`${path.join(componentRoot, name)} has an unexpected persistent target`);
};

const buildBackend = () => {
  const componentRoot = requireManagedSymlink(`${ROOT}/backend-current`, RELEASES, '/be');
  const releaseRoot = path.dirname(componentRoot);
  const identity = readManifest(releaseRoot);
  const envFile = '/etc/omnilodge/backend.env';
  assertRootFile(envFile);
  requireDependencyLink(componentRoot, 'backend', identity.dependencyLayerKeys.backend);
  requirePersistentFileLink(componentRoot, 'error.log', '/var/lib/omnilodge/logs/backend/error.log');
  requirePersistentFileLink(componentRoot, 'combined.log', '/var/lib/omnilodge/logs/backend/combined.log');
  requirePersistentDirectoryLink(componentRoot, 'runtime', '/var/lib/omnilodge/runtime/backend');
  requireReleaseFile(path.join(componentRoot, 'scripts/startMonitored.js'), componentRoot);
  requireReleaseFile(path.join(componentRoot, 'dist/app.js'), componentRoot);
  return {
    cwd: componentRoot,
    args: [
      `--env-file=${envFile}`,
      '--enable-source-maps',
      'scripts/startMonitored.js',
      'dist/app.js',
    ],
    env: {
      NODE_ENV: 'production',
      APP_RUNTIME_MODE: 'primary',
      NODE_OPTIONS: '--max-old-space-size=4096',
      APP_VERSION: identity.releaseId,
      GIT_COMMIT_SHA: identity.sourceSha,
      SKIP_DB_SYNC: 'true',
      DB_SYNC_ALTER: 'false',
      SEED_ACCESS_CONTROL: 'false',
      ERROR_MONITORING_SPOOL_PATH: '/var/lib/omnilodge/runtime/error-monitoring/failed-events.ndjson',
      ERROR_MONITORING_SOURCE_MAP_DIR: '/var/lib/omnilodge/source-maps',
      NIGHT_REPORT_UPLOAD_DIR: '/var/lib/omnilodge/uploads/night-reports',
      PROFILE_PHOTO_UPLOAD_DIR: '/var/lib/omnilodge/uploads/profile-photos',
      PUPPETEER_CACHE_DIR: '/var/cache/omnilodge/puppeteer',
    },
  };
};

const buildUiServer = () => {
  const releaseRoot = requireManagedSymlink(`${ROOT}/ui-current`, RELEASES);
  const identity = readManifest(releaseRoot);
  const componentRoot = path.join(releaseRoot, 'ui-server');
  const envFile = '/etc/omnilodge/ui-server.env';
  assertRootFile(envFile);
  assertRootDirectory(componentRoot);
  requireDependencyLink(componentRoot, 'ui-server', identity.dependencyLayerKeys['ui-server']);
  requirePersistentFileLink(componentRoot, 'error.log', '/var/lib/omnilodge/logs/ui-server/error.log');
  requirePersistentFileLink(componentRoot, 'combined.log', '/var/lib/omnilodge/logs/ui-server/combined.log');
  requireReleaseFile(path.join(componentRoot, 'server.js'), componentRoot);
  assertRootFile('/etc/omnilodge/tls/origin.key', { nonEmpty: true });
  assertRootFile('/etc/omnilodge/tls/origin.pem', {
    allowedModes: [0o600, 0o640, 0o644],
    nonEmpty: true,
  });
  return {
    cwd: componentRoot,
    args: [`--env-file=${envFile}`, 'server.js'],
    env: {
      NODE_ENV: 'production',
      APP_VERSION: identity.releaseId,
      GIT_COMMIT_SHA: identity.sourceSha,
      UI_EXPECTED_RELEASE: identity.releaseId,
      UI_BUILD_PATH: path.join(releaseRoot, 'ui/build'),
      UI_TLS_KEY_PATH: '/etc/omnilodge/tls/origin.key',
      UI_TLS_CERT_PATH: '/etc/omnilodge/tls/origin.pem',
      UI_SERVER_HOST: '0.0.0.0',
      UI_SERVER_PORT: '443',
      UI_SERVER_TELEMETRY_SPOOL_PATH: '/var/lib/omnilodge/runtime/error-monitoring/ui-server-errors-443.json',
      ERROR_MONITORING_SOURCE_MAP_DIR: '/var/lib/omnilodge/source-maps',
    },
  };
};

export const buildLaunch = (component) => {
  if (component === 'backend') return buildBackend();
  if (component === 'ui-server') return buildUiServer();
  fail('Expected exactly one component: backend or ui-server');
};

const isRuntimeComponent = (value) => value === 'backend' || value === 'ui-server';

export const resolveRuntimeComponent = ({ argv = process.argv, env = process.env } = {}) => {
  if (isRuntimeComponent(env.OMNILODGE_RUNTIME_COMPONENT)) return env.OMNILODGE_RUNTIME_COMPONENT;
  if (argv.length === 3 && isRuntimeComponent(argv[2])) return argv[2];
  fail('Runtime launcher accepts exactly one component: backend or ui-server');
};

export const shouldRunRuntimeLauncher = ({
  argv = process.argv,
  env = process.env,
  modulePath = fileURLToPath(import.meta.url),
} = {}) => {
  if (isRuntimeComponent(env.OMNILODGE_RUNTIME_COMPONENT)) return true;
  if (!argv[1]) return false;
  return path.resolve(modulePath) === path.resolve(argv[1]);
};

const run = () => {
  if (process.getuid?.() !== 0) fail('Runtime launcher must run as root');
  const launch = buildLaunch(resolveRuntimeComponent());
  const child = spawn(NODE, launch.args, {
    cwd: launch.cwd,
    // Node gives an existing process variable precedence over --env-file.
    // Deliberately do not inherit the PM2 daemon/control-panel environment;
    // the two root-owned env files remain the authoritative runtime source.
    env: { ...BASE_ENV, ...launch.env },
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
  child.once('error', (error) => {
    console.error(`Runtime process could not start: ${error.message}`);
    process.exit(1);
  });
  child.once('exit', (code, signal) => {
    if (signal) {
      process.removeAllListeners(signal);
      process.kill(process.pid, signal);
      return;
    }
    const exitCode = Number.isInteger(code) ? code : 1;
    if (exitCode !== 0) {
      console.error(`Runtime process exited before the launcher stopped: code=${exitCode}`);
    }
    process.exit(exitCode);
  });
};

if (shouldRunRuntimeLauncher()) {
  try {
    run();
  } catch (error) {
    console.error(`Runtime launcher refused to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(78);
  }
}
