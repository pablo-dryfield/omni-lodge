import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

import { createHostAuditLog } from './libexec/deploy/audit-log.mjs';
import {
  calculateCapacityAdmission,
  capacityRequirements,
  readFilesystemAvailability,
} from './libexec/deploy/capacity.mjs';
import {
  createInitialHostRequestState,
  parseCanonicalHostRequestStateBytes,
  serializeCanonicalHostRequestState,
} from '../../scripts/deploy/host/state.mjs';
import { HOST_DEPLOY_PATHS } from './libexec/deploy/constants.mjs';
import {
  DeploymentBusyError,
  FlockAdapterUnavailableError,
  withDeploymentFlock,
} from './libexec/deploy/deployment-flock.mjs';
import {
  RequestIdentityCollisionError,
  createRequestRecordStore,
} from './libexec/deploy/request-store.mjs';
import {
  createDurableFileOps,
  createSecurePathValidator,
} from './libexec/deploy/secure-filesystem.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const REQUEST_ID = '12345678-1234-4abc-8def-1234567890ab';

const identity = (overrides = {}) => ({
  requestId: REQUEST_ID,
  kind: 'forward_submit',
  requestSha256: 'b'.repeat(64),
  requestedAtUtc: '2026-09-16T19:59:00.000Z',
  actor: 'pablo-dryfield',
  releaseId: `omnilodge-r123-a1-${SOURCE_SHA.slice(0, 12)}`,
  sourceSha: SOURCE_SHA,
  operation: 'stage',
  trigger: 'manual',
  evidenceSha256: 'c'.repeat(64),
  artifactZipSha256: 'd'.repeat(64),
  ...overrides,
});

const rollbackIdentity = () => ({
  requestId: REQUEST_ID,
  kind: 'rollback_submit',
  requestSha256: 'e'.repeat(64),
  requestedAtUtc: '2026-09-16T19:59:00.000Z',
  actor: 'pablo-dryfield',
  trigger: 'manual',
  expectedActiveSnapshot: {
    activationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    snapshotSha256: '1'.repeat(64),
  },
  targetSnapshot: {
    activationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    snapshotSha256: '2'.repeat(64),
  },
});

const statusIdentity = () => ({
  requestId: REQUEST_ID,
  kind: 'status_query',
  requestSha256: 'f'.repeat(64),
  requestedAtUtc: '2026-09-16T19:59:00.000Z',
  actor: 'pablo-dryfield',
  subjectRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
});

const fakeStat = ({
  inode,
  type = 'directory',
  mode = type === 'directory' ? 0o700 : 0o600,
  uid = 0,
  gid = 0,
  symlink = false,
  size = 0,
}) => ({
  dev: 1n,
  ino: BigInt(inode),
  uid: BigInt(uid),
  gid: BigInt(gid),
  mode: BigInt((type === 'directory' ? 0o040000 : 0o100000) | mode),
  size: BigInt(size),
  isDirectory: () => type === 'directory',
  isFile: () => type === 'file',
  isSymbolicLink: () => symlink,
});

const virtualPathFs = (entries, { swapPath, swappedInode } = {}) => {
  const calls = new Map();
  return {
    async lstat(targetPath) {
      if (!entries.has(targetPath)) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      const count = (calls.get(targetPath) || 0) + 1;
      calls.set(targetPath, count);
      const stat = entries.get(targetPath);
      if (targetPath === swapPath && count > 1) {
        return { ...stat, ino: BigInt(swappedInode) };
      }
      return stat;
    },
    async realpath(targetPath) {
      return targetPath;
    },
  };
};

test('fixed production state paths cannot be redirected by environment values', () => {
  assert.deepEqual(HOST_DEPLOY_PATHS, {
    incomingRoot: '/opt/omnilodge/incoming',
    deployRoot: '/var/lib/omnilodge/deploy',
    stagingRoot: '/var/lib/omnilodge/deploy/staging',
    requestsRoot: '/var/lib/omnilodge/deploy/requests',
    pendingRequests: '/var/lib/omnilodge/deploy/requests/pending',
    runningRequests: '/var/lib/omnilodge/deploy/requests/running',
    finishedRequests: '/var/lib/omnilodge/deploy/requests/finished',
    requestNonces: '/var/lib/omnilodge/deploy/requests/nonces',
    stateRoot: '/var/lib/omnilodge/deploy/state',
    auditRoot: '/var/lib/omnilodge/deploy/audit',
    auditSegments: '/var/lib/omnilodge/deploy/audit/segments',
    deployLog: '/var/lib/omnilodge/logs/deploy/worker.log',
    lockFile: '/run/omnilodge/deploy.lock',
  });
});

test('secure path validation rejects symlink ancestors', async () => {
  const entries = new Map([
    ['/', fakeStat({ inode: 1 })],
    ['/secure', fakeStat({ inode: 2, symlink: true })],
    ['/secure/state', fakeStat({ inode: 3 })],
  ]);
  const validator = createSecurePathValidator({
    fs: virtualPathFs(entries),
    pathApi: path.posix,
    platform: 'linux',
  });
  await assert.rejects(
    validator.inspectDirectory('/secure/state'),
    /symbolic link/,
  );
});

test('secure path validation rejects writable parents', async () => {
  const entries = new Map([
    ['/', fakeStat({ inode: 1, mode: 0o755 })],
    ['/secure', fakeStat({ inode: 2, mode: 0o770 })],
    ['/secure/state', fakeStat({ inode: 3 })],
  ]);
  const validator = createSecurePathValidator({
    fs: virtualPathFs(entries),
    pathApi: path.posix,
    platform: 'linux',
  });
  await assert.rejects(
    validator.inspectDirectory('/secure/state'),
    /group\/world writable/,
  );
});

test('secure path validation rejects a non-root-owned component', async () => {
  const entries = new Map([
    ['/', fakeStat({ inode: 1, mode: 0o755 })],
    ['/secure', fakeStat({ inode: 2, uid: 1000 })],
    ['/secure/state', fakeStat({ inode: 3 })],
  ]);
  const validator = createSecurePathValidator({
    fs: virtualPathFs(entries),
    pathApi: path.posix,
    platform: 'linux',
  });
  await assert.rejects(
    validator.inspectDirectory('/secure/state'),
    /not owned by root/,
  );
});

test('secure path validation detects path swaps between inspection passes', async () => {
  const entries = new Map([
    ['/', fakeStat({ inode: 1, mode: 0o755 })],
    ['/secure', fakeStat({ inode: 2 })],
    ['/secure/state', fakeStat({ inode: 3 })],
  ]);
  const validator = createSecurePathValidator({
    fs: virtualPathFs(entries, { swapPath: '/secure', swappedInode: 99 }),
    pathApi: path.posix,
    platform: 'linux',
  });
  await assert.rejects(
    validator.inspectDirectory('/secure/state'),
    /changed during validation/,
  );
});

test('canonical replay states reject alternate formatting and unknown fields', () => {
  const state = createInitialHostRequestState({
    requestIdentity: identity(),
    receivedAtUtc: '2026-09-16T20:00:00.000Z',
  });
  const canonical = serializeCanonicalHostRequestState(state);
  assert.deepEqual(parseCanonicalHostRequestStateBytes(canonical), state);
  assert.throws(
    () => parseCanonicalHostRequestStateBytes(Buffer.from(JSON.stringify(state))),
    /exact canonical JSON form/,
  );
  assert.throws(
    () => serializeCanonicalHostRequestState({ ...state, extra: true }),
    /schema is not canonical/,
  );
});

const createMemoryFileOps = () => {
  const files = new Map();
  let nextInode = 10n;
  const missing = () => {
    const error = new Error('missing');
    error.code = 'ENOENT';
    return error;
  };
  return {
    files,
    async publishExclusiveBuffer(targetPath, bytes) {
      if (files.has(targetPath)) {
        const error = new Error('exists');
        error.code = 'EEXIST';
        throw error;
      }
      const stat = fakeStat({ inode: nextInode, type: 'file', size: bytes.length });
      nextInode += 1n;
      files.set(targetPath, { bytes: Buffer.from(bytes), stat });
      return { path: targetPath, stat };
    },
    async readSecureBuffer(targetPath) {
      const file = files.get(targetPath);
      if (!file) throw missing();
      return { path: targetPath, bytes: Buffer.from(file.bytes), stat: file.stat };
    },
    async replaceBuffer(targetPath, bytes, expectedStat) {
      const file = files.get(targetPath);
      if (!file) throw missing();
      assert.equal(file.stat.ino, expectedStat.ino);
      const stat = fakeStat({ inode: nextInode, type: 'file', size: bytes.length });
      nextInode += 1n;
      files.set(targetPath, { bytes: Buffer.from(bytes), stat });
      return { path: targetPath, stat };
    },
    async linkNoReplace(sourcePath, destinationPath) {
      if (files.has(destinationPath)) {
        const error = new Error('exists');
        error.code = 'EEXIST';
        throw error;
      }
      const source = files.get(sourcePath);
      if (!source) throw missing();
      files.set(destinationPath, source);
      return { path: destinationPath, stat: source.stat };
    },
    async unlinkVerified(targetPath, expectedStat) {
      const file = files.get(targetPath);
      if (!file) throw missing();
      assert.equal(file.stat.ino, expectedStat.ino);
      files.delete(targetPath);
    },
    async appendDurableLine(targetPath, line) {
      const existing = files.get(targetPath)?.bytes || Buffer.alloc(0);
      files.set(targetPath, {
        bytes: Buffer.concat([existing, line]),
        stat: fakeStat({ inode: 900, type: 'file', size: existing.length + line.length }),
      });
      return { path: targetPath, bytesWritten: line.length };
    },
    async listSecureDirectory(targetPath, { maximumEntries = 1024 } = {}) {
      const prefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`;
      const names = [];
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (rest.length === 0 || rest.includes('/')) continue;
        names.push(rest);
      }
      names.sort();
      return names.slice(0, maximumEntries + 1);
    },
  };
};

const TEST_PATHS = Object.freeze({
  pendingRequests: '/state/pending',
  runningRequests: '/state/running',
  finishedRequests: '/state/finished',
  requestNonces: '/state/nonces',
});

test('request store treats an exact replay idempotently and detects digest collisions', async () => {
  const fileOps = createMemoryFileOps();
  const store = createRequestRecordStore({
    paths: TEST_PATHS,
    fileOps,
    clock: () => new Date('2026-09-16T20:00:00.000Z'),
    pathApi: path.posix,
  });
  const first = await store.admit({
    identity: identity(),
  });
  assert.equal(first.disposition, 'created');
  assert.equal(first.state, 'pending');

  const replay = await store.admit({
    identity: identity(),
  });
  assert.equal(replay.disposition, 'replay');
  assert.equal(replay.requestState.request.actor, 'pablo-dryfield');
  assert.equal(fileOps.files.size, 2);

  await assert.rejects(
    store.admit({
      identity: identity({ requestSha256: 'e'.repeat(64) }),
    }),
    RequestIdentityCollisionError,
  );
});

test('request store persists rollback intent and never persists status queries', async () => {
  const rollbackFiles = createMemoryFileOps();
  const rollbackStore = createRequestRecordStore({
    paths: TEST_PATHS,
    fileOps: rollbackFiles,
    clock: () => new Date('2026-09-16T20:00:00.000Z'),
    pathApi: path.posix,
  });
  const admitted = await rollbackStore.admit({ identity: rollbackIdentity() });
  assert.equal(admitted.requestState.request.kind, 'rollback_submit');
  assert.equal(
    admitted.requestState.intent.targetSnapshot.activationId,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  );

  const statusFiles = createMemoryFileOps();
  const statusStore = createRequestRecordStore({
    paths: TEST_PATHS,
    fileOps: statusFiles,
    pathApi: path.posix,
  });
  const status = await statusStore.admit({ identity: statusIdentity() });
  assert.equal(status.requestState, null);
  assert.equal(status.state, null);
  assert.equal(status.nonce.record.requestKind, 'status_query');
  assert.equal(statusFiles.files.size, 1);
});

test('request store durably transitions pending to running to finished', async () => {
  const fileOps = createMemoryFileOps();
  const store = createRequestRecordStore({
    paths: TEST_PATHS,
    fileOps,
    clock: () => new Date('2026-09-16T20:00:00.000Z'),
    pathApi: path.posix,
  });
  await store.admit({ identity: identity() });
  const authorized = await store.advance({
    requestId: REQUEST_ID,
    requestSha256: 'b'.repeat(64),
    fromPhase: 'received',
    nextPhase: 'authorized',
  });
  assert.equal(authorized.requestState.phase, 'authorized');
  const authorizedReplay = await store.advance({
    requestId: REQUEST_ID,
    requestSha256: 'b'.repeat(64),
    fromPhase: 'received',
    nextPhase: 'authorized',
  });
  assert.equal(authorizedReplay.disposition, 'already-advanced');
  const running = await store.transition({
    requestId: REQUEST_ID,
    requestSha256: 'b'.repeat(64),
    from: 'pending',
    to: 'running',
  });
  assert.equal(running.state, 'running');
  assert.equal(running.disposition, 'transitioned');
  assert.equal(running.requestState.phase, 'authorized');
  const replay = await store.transition({
    requestId: REQUEST_ID,
    requestSha256: 'b'.repeat(64),
    from: 'pending',
    to: 'running',
  });
  assert.equal(replay.disposition, 'already-transitioned');
  await assert.rejects(
    store.transition({
      requestId: REQUEST_ID,
      requestSha256: 'b'.repeat(64),
      from: 'running',
      to: 'finished',
    }),
    /cannot finish from phase authorized/,
  );
  for (const [fromPhase, nextPhase] of [
    ['authorized', 'artifact_staged'],
    ['artifact_staged', 'preflight_passed'],
    ['preflight_passed', 'succeeded'],
  ]) {
    await store.advance({
      requestId: REQUEST_ID,
      requestSha256: 'b'.repeat(64),
      fromPhase,
      nextPhase,
    });
  }
  const finished = await store.transition({
    requestId: REQUEST_ID,
    requestSha256: 'b'.repeat(64),
    from: 'running',
    to: 'finished',
  });
  assert.equal(finished.state, 'finished');
  assert.equal(fileOps.files.size, 2);
});

test('request lookup recognizes and repairs an interrupted hard-link transition', async () => {
  const fileOps = createMemoryFileOps();
  const store = createRequestRecordStore({
    paths: TEST_PATHS,
    fileOps,
    clock: () => new Date('2026-09-16T20:00:00.000Z'),
    pathApi: path.posix,
  });
  const admitted = await store.admit({
    identity: identity(),
  });
  const runningPath = store.recordPath('running', REQUEST_ID);
  fileOps.files.set(runningPath, fileOps.files.get(admitted.path));

  const interrupted = await store.lookup(REQUEST_ID);
  assert.equal(interrupted.state, 'running');
  assert.equal(interrupted.recoveryNeeded, true);
  assert.deepEqual(interrupted.duplicateStates, ['pending']);

  const recovered = await store.transition({
    requestId: REQUEST_ID,
    requestSha256: 'b'.repeat(64),
    from: 'pending',
    to: 'running',
  });
  assert.equal(recovered.disposition, 'already-transitioned');
  assert.equal(recovered.recoveryNeeded, false);
  assert.equal(fileOps.files.size, 2);
});

test('audit append stamps server time and authenticated transport key label', async () => {
  const fileOps = createMemoryFileOps();
  const auditPath = '/audit/events.ndjson';
  const audit = createHostAuditLog({
    auditPath,
    fileOps,
    clock: () => new Date('2026-09-16T21:22:23.000Z'),
  });
  await audit.append({
    identity: identity(),
    transportKeyLabel: 'github-actions-production',
    eventType: 'request_admitted',
  });
  const line = fileOps.files.get(auditPath).bytes.toString('utf8');
  assert.equal(line.endsWith('\n'), true);
  const event = JSON.parse(line);
  assert.equal(event.serverReceivedAtUtc, '2026-09-16T21:22:23.000Z');
  assert.equal(event.transportKeyLabel, 'github-actions-production');
  assert.equal(event.requestSha256, 'b'.repeat(64));
  assert.equal(event.requestKind, 'forward_submit');
});

const permissiveNativeSecurity = {
  requireNormalizedAbsolute(targetPath) {
    assert.equal(path.resolve(targetPath), targetPath);
    return targetPath;
  },
  async inspectDirectory(targetPath) {
    const stat = await fs.lstat(targetPath, { bigint: true });
    assert.equal(stat.isDirectory(), true);
    return { path: targetPath, stat };
  },
  async inspectFile(targetPath) {
    const stat = await fs.lstat(targetPath, { bigint: true });
    assert.equal(stat.isFile(), true);
    return { path: targetPath, stat };
  },
};

test('exclusive publication is 0600, durable, and never overwrites', async (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX ownership and mode semantics are required');
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omnilodge-state-'));
  try {
    const directoryStat = await fs.lstat(directory, { bigint: true });
    const fileOps = createDurableFileOps({
      security: permissiveNativeSecurity,
      trustedUid: directoryStat.uid,
      trustedGid: directoryStat.gid,
      syncDirectoryImpl: async () => {},
    });
    const target = path.join(directory, 'request.json');
    const first = await fileOps.publishExclusiveBuffer(target, Buffer.from('first'));
    await assert.rejects(
      fileOps.publishExclusiveBuffer(target, Buffer.from('second')),
      (error) => error?.code === 'EEXIST',
    );
    assert.equal(await fs.readFile(target, 'utf8'), 'first');
    await fileOps.replaceBuffer(target, Buffer.from('third'), first.stat);
    assert.equal(await fs.readFile(target, 'utf8'), 'third');
    if (process.platform !== 'win32') {
      const stat = await fs.lstat(target);
      assert.equal(stat.mode & 0o777, 0o600);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed publication removes its private temporary file and publishes nothing', async (context) => {
  if (process.platform === 'win32') {
    context.skip('POSIX ownership and mode semantics are required');
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omnilodge-state-fail-'));
  try {
    const directoryStat = await fs.lstat(directory, { bigint: true });
    const failingFs = {
      ...fs,
      async open(...args) {
        const handle = await fs.open(...args);
        if (!String(args[0]).endsWith('.tmp')) return handle;
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'sync') return async () => { throw new Error('injected fsync failure'); };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    const fileOps = createDurableFileOps({
      fs: failingFs,
      security: permissiveNativeSecurity,
      trustedUid: directoryStat.uid,
      trustedGid: directoryStat.gid,
      syncDirectoryImpl: async () => {},
    });
    const target = path.join(directory, 'request.json');
    await assert.rejects(
      fileOps.publishExclusiveBuffer(target, Buffer.from('never-published')),
      /injected fsync failure/,
    );
    assert.deepEqual(await fs.readdir(directory), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('flock helper rejects missing adapters, reports contention, and releases after work', async () => {
  const lockStat = fakeStat({ inode: 44, type: 'file' });
  const handle = {
    chmod: async () => {},
    stat: async () => lockStat,
    sync: async () => {},
    close: async () => {},
  };
  const fakeFs = {
    open: async () => handle,
    lstat: async () => lockStat,
  };
  const security = {
    requireNormalizedAbsolute: (value) => value,
    inspectDirectory: async (value) => ({ path: value, stat: fakeStat({ inode: 1 }) }),
  };
  await assert.rejects(
    withDeploymentFlock({ task: async () => {}, fs: fakeFs, security }),
    FlockAdapterUnavailableError,
  );
  await assert.rejects(
    withDeploymentFlock({
      task: async () => {},
      fs: fakeFs,
      security,
      flockAdapter: {
        acquireExclusiveNonBlocking: async () => false,
        release: async () => assert.fail('busy lock must not be released'),
      },
    }),
    DeploymentBusyError,
  );
  const calls = [];
  const result = await withDeploymentFlock({
    task: async () => {
      calls.push('task');
      return 42;
    },
    fs: fakeFs,
    security,
    flockAdapter: {
      acquireExclusiveNonBlocking: async () => {
        calls.push('acquire');
        return true;
      },
      release: async () => calls.push('release'),
    },
  });
  assert.equal(result, 42);
  assert.deepEqual(calls, ['acquire', 'task', 'release']);
});

test('capacity admission accepts exact boundaries and rejects bytes and free-inode deficits', () => {
  const requiredBytes = capacityRequirements({
    incomingArchive: 10n,
    temporaryExtraction: 20n,
    candidateRelease: 30n,
    dependencyLayer: 40n,
    databaseBackup: 50n,
    retainedReleaseFloor: 60n,
    safetyMargin: 70n,
  });
  const requiredInodes = capacityRequirements({
    incomingArchive: 1n,
    temporaryExtraction: 2n,
    candidateRelease: 3n,
    dependencyLayer: 4n,
    databaseBackup: 5n,
    retainedReleaseFloor: 6n,
    safetyMargin: 7n,
  });
  const exact = calculateCapacityAdmission({
    availableBytes: 280n,
    availableInodes: 28n,
    requiredBytes,
    requiredInodes,
  });
  assert.equal(exact.admitted, true);
  assert.equal(exact.remainingBytes, 0n);
  assert.equal(exact.remainingInodes, 0n);

  const deficient = calculateCapacityAdmission({
    availableBytes: 279n,
    availableInodes: 27n,
    requiredBytes,
    requiredInodes,
  });
  assert.equal(deficient.admitted, false);
  assert.deepEqual(deficient.reasons, ['INSUFFICIENT_BYTES', 'INSUFFICIENT_INODES']);
  assert.equal(deficient.remainingBytes, -1n);
  assert.equal(deficient.remainingInodes, -1n);
});

test('filesystem availability uses reserved-block-aware bavail and free inodes', async () => {
  const availability = await readFilesystemAvailability({
    targetPath: '/opt/omnilodge',
    statfs: async (targetPath, options) => {
      assert.equal(targetPath, '/opt/omnilodge');
      assert.deepEqual(options, { bigint: true });
      return {
        bsize: 4096n,
        bfree: 500n,
        bavail: 400n,
        ffree: 300n,
      };
    },
  });
  assert.deepEqual(availability, {
    targetPath: '/opt/omnilodge',
    availableBytes: 1_638_400n,
    availableInodes: 300n,
  });
});
