import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createHostAuditLog } from './libexec/deploy/audit-log.mjs';
import { createRequestRecordStore } from './libexec/deploy/request-store.mjs';
import { handleHostDeployWorkerRequest } from './libexec/deploy/worker.mjs';
import { createHostRequestStatus } from '../../scripts/deploy/host/state.mjs';

const SOURCE_SHA = 'd'.repeat(40);
const RELEASE_ID = `omnilodge-r654-a2-${SOURCE_SHA.slice(0, 12)}`;
const AUDIT_PATH = '/audit/events.ndjson';
const TEST_PATHS = Object.freeze({
  incomingRoot: '/incoming',
  deployRoot: '/deploy',
  stagingRoot: '/deploy/staging',
  pendingRequests: '/state/pending',
  runningRequests: '/state/running',
  finishedRequests: '/state/finished',
  requestNonces: '/state/nonces',
  stateRoot: '/deploy/state',
  auditSegments: '/audit',
});

const fakeStat = ({
  inode,
  type = 'file',
  size = 0,
}) => ({
  dev: 1n,
  ino: BigInt(inode),
  uid: 0n,
  gid: 0n,
  mode: BigInt((type === 'directory' ? 0o040000 : 0o100000) | (type === 'directory' ? 0o700 : 0o600)),
  size: BigInt(size),
  isDirectory: () => type === 'directory',
  isFile: () => type === 'file',
  isSymbolicLink: () => false,
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
      const stat = fakeStat({ inode: nextInode, size: bytes.length });
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
      const stat = fakeStat({ inode: nextInode, size: bytes.length });
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
        stat: fakeStat({ inode: 900, size: existing.length + line.length }),
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

const createHarness = ({ now = '2026-09-17T10:00:00.000Z' } = {}) => {
  const fileOps = createMemoryFileOps();
  const clock = () => new Date(now);
  const store = createRequestRecordStore({
    paths: TEST_PATHS,
    fileOps,
    clock,
    pathApi: path.posix,
  });
  const audit = createHostAuditLog({
    auditPath: AUDIT_PATH,
    fileOps,
    clock,
  });
  return {
    fileOps,
    store,
    audit,
    clock,
  };
};

const identity = ({
  requestId = '623e4567-e89b-42d3-a456-426614174010',
  operation = 'stage',
} = {}) => ({
  requestId,
  kind: 'forward_submit',
  requestSha256: '1'.repeat(64),
  requestedAtUtc: '2026-09-17T09:59:30.000Z',
  actor: 'github-actions[bot]',
  releaseId: RELEASE_ID,
  sourceSha: SOURCE_SHA,
  operation,
  trigger: 'manual',
  evidenceSha256: '2'.repeat(64),
  artifactZipSha256: '3'.repeat(64),
});

const backupGateResult = (requestState) => ({
  schemaVersion: 1,
  requestId: requestState.request.requestId,
  releaseId: requestState.intent.releaseId,
  sourceSha: requestState.intent.sourceSha,
  command: {
    path: '/home/postgres/backup.sh',
    timeoutMs: 60 * 60 * 1000,
    stdoutBytes: 12,
    stderrBytes: 0,
  },
  backupRoot: '/home/postgres/backups',
  availableBytesBefore: 6 * 1024 * 1024 * 1024,
  availableBytesAfter: 5 * 1024 * 1024 * 1024,
  selectedBackup: {
    path: `/home/postgres/backups/${requestState.request.requestId}.tar.gz`,
    sizeBytes: 1024,
    sha256: '4'.repeat(64),
    mtimeUtc: '2026-09-17T10:00:00.000Z',
  },
  createdBackupCount: 1,
  startedAtUtc: '2026-09-17T10:00:00.000Z',
  completedAtUtc: '2026-09-17T10:01:00.000Z',
});

const admit = async (harness, options) => harness.store.admit({ identity: identity(options) });

const finishedEntry = async (harness, requestId) => {
  const entry = await harness.store.lookup(requestId);
  assert.equal(entry.state, 'finished');
  return entry;
};

test('detached worker stages a non-activation request and marks it succeeded', async () => {
  const harness = createHarness();
  await admit(harness, { requestId: '623e4567-e89b-42d3-a456-426614174010', operation: 'stage' });
  const prepared = [];
  const result = await handleHostDeployWorkerRequest({
    requestId: '623e4567-e89b-42d3-a456-426614174010',
    paths: TEST_PATHS,
    requestStore: harness.store,
    auditLog: harness.audit,
    clock: harness.clock,
    fileOps: harness.fileOps,
    fs: { unlink: async () => {} },
    prepareRelease: async ({ requestState }) => {
      prepared.push(requestState.intent.operation);
      return { releaseId: requestState.intent.releaseId };
    },
  });

  assert.deepEqual(prepared, ['stage']);
  assert.equal(result.status.lifecycle, 'succeeded');
  assert.equal(result.status.resultCode, 'REQUEST_SUCCEEDED');

  const entry = await finishedEntry(harness, '623e4567-e89b-42d3-a456-426614174010');
  assert.deepEqual(createHostRequestStatus(entry.requestState), result.status);
  const auditLines = harness.fileOps.files.get(AUDIT_PATH).bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(auditLines.map((event) => [event.eventType, event.outcomeCode]), [
    ['request_running', null],
    ['request_finished', 'REQUEST_SUCCEEDED'],
  ]);
});

test('detached worker fails deploy requests before activation is implemented', async () => {
  const harness = createHarness();
  await admit(harness, { requestId: '723e4567-e89b-42d3-a456-426614174011', operation: 'deploy' });
  const prepared = [];
  const backupGatePhases = [];
  await assert.rejects(
    handleHostDeployWorkerRequest({
      requestId: '723e4567-e89b-42d3-a456-426614174011',
      paths: TEST_PATHS,
      requestStore: harness.store,
      auditLog: harness.audit,
      clock: harness.clock,
      fileOps: harness.fileOps,
      fs: { unlink: async () => {} },
      prepareRelease: async ({ requestState }) => {
        prepared.push(requestState.intent.operation);
        return { releaseId: requestState.intent.releaseId };
      },
      runBackupGate: async ({ requestState }) => {
        backupGatePhases.push(requestState.phase);
        return backupGateResult(requestState);
      },
    }),
    /Production migration and activation switching gates are not enabled/,
  );

  assert.deepEqual(prepared, ['deploy']);
  assert.deepEqual(backupGatePhases, ['preflight_passed']);
  assert.ok(harness.fileOps.files.has(path.join(
    TEST_PATHS.stateRoot,
    '723e4567-e89b-42d3-a456-426614174011.backup-gate-result.json',
  )));
  const entry = await finishedEntry(harness, '723e4567-e89b-42d3-a456-426614174011');
  assert.equal(entry.requestState.phase, 'failed');
  assert.equal(entry.requestState.resultCode, 'REQUEST_FAILED');
});
