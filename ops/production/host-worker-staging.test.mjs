import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createHostAuditLog } from './libexec/deploy/audit-log.mjs';
import { serializeCanonicalJson } from './libexec/deploy/canonical-json.mjs';
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
  backupRequired: true,
  backupReason: 'PENDING_MIGRATIONS',
  pendingMigrationCount: 1,
  pendingMigrationNames: ['20260922090000-example-change.js'],
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

const migrationGateResult = (requestState, {
  pendingMigrationNames = ['20260922090000-example-change.js'],
} = {}) => ({
  schemaVersion: 1,
  requestId: requestState.request.requestId,
  releaseId: requestState.intent.releaseId,
  sourceSha: requestState.intent.sourceSha,
  migrationRequired: pendingMigrationNames.length > 0,
  migrationReason: pendingMigrationNames.length > 0 ? 'PENDING_MIGRATIONS' : 'NO_PENDING_MIGRATIONS',
  pendingMigrationCountBefore: pendingMigrationNames.length,
  pendingMigrationNamesBefore: pendingMigrationNames,
  backupRequired: pendingMigrationNames.length > 0,
  selectedBackup: pendingMigrationNames.length > 0
    ? {
        path: `/home/postgres/backups/${requestState.request.requestId}.tar.gz`,
        sizeBytes: 1024,
        sha256: '4'.repeat(64),
        mtimeUtc: '2026-09-17T10:00:00.000Z',
      }
    : null,
  command: pendingMigrationNames.length > 0
    ? {
        label: 'run-migrations',
        executable: '/usr/bin/node',
        args: ['--env-file=/etc/omnilodge/backend.env', '--enable-source-maps', 'dist/scripts/runMigrations.js'],
        cwd: '/opt/omnilodge/releases/test/be',
        stdoutBytes: 128,
        stderrBytes: 0,
      }
    : null,
  postMigrationStatus: {
    schemaVersion: 1,
    kind: 'omnilodge-migration-status',
    ok: true,
    classification: 'managed',
    lineage: 'strict',
    metadataTableExists: true,
    appliedMigrationCount: 189 + pendingMigrationNames.length,
    compiledMigrationCount: 189 + pendingMigrationNames.length,
    pendingMigrationCount: 0,
    pendingMigrationNames: [],
  },
  startedAtUtc: '2026-09-17T10:01:00.000Z',
  completedAtUtc: '2026-09-17T10:02:00.000Z',
});

const activationPreparationResult = (requestState) => ({
  schemaVersion: 1,
  requestId: requestState.request.requestId,
  releaseId: requestState.intent.releaseId,
  sourceSha: requestState.intent.sourceSha,
  transactionPhase: 'prepared',
  previousSnapshot: {
    activationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    snapshotSha256: '6'.repeat(64),
  },
  targetSnapshot: {
    activationId: requestState.request.requestId,
    snapshotSha256: '7'.repeat(64),
  },
  recoveryAction: 'abort_without_pointer_change',
  databaseAction: 'none',
  preparedAtUtc: '2026-09-17T10:02:00.000Z',
});

const dryRunChecksResult = (requestState, {
  pendingMigrationNames = [],
} = {}) => ({
  schemaVersion: 1,
  releaseId: requestState.intent.releaseId,
  sourceSha: requestState.intent.sourceSha,
  preparationPlanSha256: '5'.repeat(64),
  backendEnvironmentFile: '/etc/omnilodge/backend.env',
  commands: [],
  migrationStatus: {
    schemaVersion: 1,
    kind: 'omnilodge-migration-status',
    ok: true,
    classification: 'managed',
    lineage: 'strict',
    metadataTableExists: true,
    appliedMigrationCount: 189,
    compiledMigrationCount: 189 + pendingMigrationNames.length,
    pendingMigrationCount: pendingMigrationNames.length,
    pendingMigrationNames,
  },
  runtimePreflight: {
    schemaVersion: 1,
    kind: 'omnilodge-backend-runtime-preflight',
    ok: true,
    checks: {},
  },
  privateSmoke: {
    schemaVersion: 1,
    ok: true,
    checks: [],
  },
  capturedAtUtc: '2026-09-17T10:00:00.000Z',
});

const dryRunChecksPath = (requestId) => path.join(
  TEST_PATHS.stateRoot,
  `${requestId}.dry-run-checks-result.json`,
);

const publishDryRunChecks = async (harness, requestState, options) => {
  await harness.fileOps.publishExclusiveBuffer(
    dryRunChecksPath(requestState.request.requestId),
    serializeCanonicalJson(dryRunChecksResult(requestState, options)),
  );
};

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

const advanceHarnessRequest = async (harness, entry, phases) => {
  let current = entry;
  for (const nextPhase of phases) {
    current = await harness.store.advance({
      requestId: current.requestState.request.requestId,
      requestSha256: current.requestState.request.requestSha256,
      fromPhase: current.requestState.phase,
      nextPhase,
    });
  }
  return current;
};

test('detached worker activates a deploy request after backup and migration gates', async () => {
  const harness = createHarness();
  await admit(harness, { requestId: '723e4567-e89b-42d3-a456-426614174011', operation: 'deploy' });
  const prepared = [];
  const backupGatePhases = [];
  const migrationGatePhases = [];
  const activationPhases = [];
  const cutoverPhases = [];
  const result = await handleHostDeployWorkerRequest({
    requestId: '723e4567-e89b-42d3-a456-426614174011',
    paths: TEST_PATHS,
    requestStore: harness.store,
    auditLog: harness.audit,
    clock: harness.clock,
    fileOps: harness.fileOps,
    fs: { unlink: async () => {} },
    prepareRelease: async ({ requestState }) => {
      prepared.push(requestState.intent.operation);
      await publishDryRunChecks(harness, requestState, {
        pendingMigrationNames: ['20260922090000-example-change.js'],
      });
      return { releaseId: requestState.intent.releaseId };
    },
    runBackupGate: async ({ requestState }) => {
      backupGatePhases.push(requestState.phase);
      return backupGateResult(requestState);
    },
    runMigrationGate: async ({ requestState, migrationStatus, backupGateResult: backupResult }) => {
      migrationGatePhases.push(requestState.phase);
      assert.equal(migrationStatus.pendingMigrationCount, 1);
      assert.equal(backupResult.backupRequired, true);
      return migrationGateResult(requestState);
    },
    prepareActivationState: async ({ requestState }) => {
      activationPhases.push(requestState.phase);
      return activationPreparationResult(requestState);
    },
    activateDeployment: async ({ entry }) => {
      cutoverPhases.push(entry.requestState.phase);
      const requestEntry = await advanceHarnessRequest(harness, entry, [
        'pointer_switching',
        'pointers_switched',
        'smoke_verified',
        'succeeded',
      ]);
      return {
        schemaVersion: 1,
        requestPhase: requestEntry.requestState.phase,
        requestEntry,
      };
    },
  });

  assert.deepEqual(prepared, ['deploy']);
  assert.deepEqual(backupGatePhases, ['preflight_passed']);
  assert.deepEqual(migrationGatePhases, ['backup_verified']);
  assert.deepEqual(activationPhases, ['activation_prepared']);
  assert.deepEqual(cutoverPhases, ['activation_prepared']);
  assert.equal(result.status.lifecycle, 'succeeded');
  assert.equal(result.status.resultCode, 'REQUEST_SUCCEEDED');
  assert.ok(harness.fileOps.files.has(path.join(
    TEST_PATHS.stateRoot,
    '723e4567-e89b-42d3-a456-426614174011.backup-gate-result.json',
  )));
  assert.ok(harness.fileOps.files.has(path.join(
    TEST_PATHS.stateRoot,
    '723e4567-e89b-42d3-a456-426614174011.migration-gate-result.json',
  )));
  const activationEvidence = JSON.parse(harness.fileOps.files
    .get(path.join(TEST_PATHS.stateRoot, '723e4567-e89b-42d3-a456-426614174011.activation-preparation-result.json'))
    .bytes.toString('utf8'));
  assert.equal(activationEvidence.transactionPhase, 'prepared');
  assert.equal(activationEvidence.recoveryAction, 'abort_without_pointer_change');
  const cutoverEvidence = JSON.parse(harness.fileOps.files
    .get(path.join(TEST_PATHS.stateRoot, '723e4567-e89b-42d3-a456-426614174011.activation-cutover-result.json'))
    .bytes.toString('utf8'));
  assert.equal(cutoverEvidence.requestPhase, 'succeeded');
  const entry = await finishedEntry(harness, '723e4567-e89b-42d3-a456-426614174011');
  assert.equal(entry.requestState.phase, 'succeeded');
  assert.equal(entry.requestState.resultCode, 'REQUEST_SUCCEEDED');
});

test('detached worker skips production backup when migration status has no pending migrations', async () => {
  const harness = createHarness();
  const requestId = '823e4567-e89b-42d3-a456-426614174012';
  await admit(harness, { requestId, operation: 'deploy' });
  const prepared = [];
  const migrationGatePhases = [];
  const activationPhases = [];
  const cutoverPhases = [];

  await handleHostDeployWorkerRequest({
    requestId,
    paths: TEST_PATHS,
    requestStore: harness.store,
    auditLog: harness.audit,
    clock: harness.clock,
    fileOps: harness.fileOps,
    fs: { unlink: async () => {} },
    prepareRelease: async ({ requestState }) => {
      prepared.push(requestState.intent.operation);
      await publishDryRunChecks(harness, requestState);
      return { releaseId: requestState.intent.releaseId };
    },
    runMigrationGate: async ({ requestState, migrationStatus, backupGateResult: backupResult }) => {
      migrationGatePhases.push(requestState.phase);
      assert.equal(migrationStatus.pendingMigrationCount, 0);
      assert.equal(backupResult.backupRequired, false);
      return migrationGateResult(requestState, { pendingMigrationNames: [] });
    },
    prepareActivationState: async ({ requestState }) => {
      activationPhases.push(requestState.phase);
      return activationPreparationResult(requestState);
    },
    activateDeployment: async ({ entry }) => {
      cutoverPhases.push(entry.requestState.phase);
      const requestEntry = await advanceHarnessRequest(harness, entry, [
        'pointer_switching',
        'pointers_switched',
        'smoke_verified',
        'succeeded',
      ]);
      return {
        schemaVersion: 1,
        requestPhase: requestEntry.requestState.phase,
        requestEntry,
      };
    },
  });

  assert.deepEqual(prepared, ['deploy']);
  const backupEvidence = JSON.parse(harness.fileOps.files
    .get(path.join(TEST_PATHS.stateRoot, `${requestId}.backup-gate-result.json`))
    .bytes.toString('utf8'));
  assert.equal(backupEvidence.backupRequired, false);
  assert.equal(backupEvidence.backupReason, 'NO_PENDING_MIGRATIONS');
  assert.equal(backupEvidence.pendingMigrationCount, 0);
  assert.equal(backupEvidence.command, null);
  assert.equal(backupEvidence.selectedBackup, null);
  assert.deepEqual(migrationGatePhases, ['backup_verified']);
  const migrationEvidence = JSON.parse(harness.fileOps.files
    .get(path.join(TEST_PATHS.stateRoot, `${requestId}.migration-gate-result.json`))
    .bytes.toString('utf8'));
  assert.equal(migrationEvidence.migrationRequired, false);
  assert.equal(migrationEvidence.command, null);
  assert.deepEqual(activationPhases, ['activation_prepared']);
  const activationEvidence = JSON.parse(harness.fileOps.files
    .get(path.join(TEST_PATHS.stateRoot, `${requestId}.activation-preparation-result.json`))
    .bytes.toString('utf8'));
  assert.equal(activationEvidence.transactionPhase, 'prepared');
  assert.deepEqual(cutoverPhases, ['activation_prepared']);

  const entry = await finishedEntry(harness, requestId);
  assert.equal(entry.requestState.phase, 'succeeded');
  assert.equal(entry.requestState.resultCode, 'REQUEST_SUCCEEDED');
});

test('detached worker records recovery evidence when activation fails after pointer switching starts', async () => {
  const harness = createHarness();
  const requestId = 'a23e4567-e89b-42d3-a456-426614174014';
  await admit(harness, { requestId, operation: 'deploy' });
  const recoveryPhases = [];

  await assert.rejects(
    handleHostDeployWorkerRequest({
      requestId,
      paths: TEST_PATHS,
      requestStore: harness.store,
      auditLog: harness.audit,
      clock: harness.clock,
      fileOps: harness.fileOps,
      fs: { unlink: async () => {} },
      prepareRelease: async ({ requestState }) => {
        await publishDryRunChecks(harness, requestState);
        return { releaseId: requestState.intent.releaseId };
      },
      runMigrationGate: async ({ requestState }) => migrationGateResult(requestState, { pendingMigrationNames: [] }),
      prepareActivationState: async ({ requestState }) => activationPreparationResult(requestState),
      activateDeployment: async ({ entry }) => {
        await advanceHarnessRequest(harness, entry, ['pointer_switching']);
        throw new Error('simulated pointer switch failure');
      },
      recoverDeployment: async ({ entry }) => {
        recoveryPhases.push(entry.requestState.phase);
        const requestEntry = await advanceHarnessRequest(harness, entry, [
          'restore_required',
          'restoring_previous',
          'previous_restored',
          'failed',
        ]);
        return {
          schemaVersion: 1,
          action: 'converge_previous_snapshot',
          requestPhase: requestEntry.requestState.phase,
          requestEntry,
        };
      },
    }),
    /simulated pointer switch failure/,
  );

  assert.deepEqual(recoveryPhases, ['pointer_switching']);
  const recoveryEvidence = JSON.parse(harness.fileOps.files
    .get(path.join(TEST_PATHS.stateRoot, `${requestId}.activation-recovery-result.json`))
    .bytes.toString('utf8'));
  assert.equal(recoveryEvidence.action, 'converge_previous_snapshot');
  assert.equal(recoveryEvidence.requestPhase, 'failed');
  const entry = await finishedEntry(harness, requestId);
  assert.equal(entry.requestState.phase, 'failed');
  assert.equal(entry.requestState.resultCode, 'REQUEST_FAILED');
});

test('detached worker fails closed when activation baseline is missing', async () => {
  const harness = createHarness();
  const requestId = '923e4567-e89b-42d3-a456-426614174013';
  await admit(harness, { requestId, operation: 'deploy' });

  await assert.rejects(
    handleHostDeployWorkerRequest({
      requestId,
      paths: TEST_PATHS,
      requestStore: harness.store,
      auditLog: harness.audit,
      clock: harness.clock,
      fileOps: harness.fileOps,
      fs: { unlink: async () => {} },
      prepareRelease: async ({ requestState }) => {
        await publishDryRunChecks(harness, requestState);
        return { releaseId: requestState.intent.releaseId };
      },
      runMigrationGate: async ({ requestState }) => migrationGateResult(requestState, { pendingMigrationNames: [] }),
    }),
    /Active activation snapshot is missing/,
  );

  assert.equal(harness.fileOps.files.has(path.join(
    TEST_PATHS.stateRoot,
    `${requestId}.activation-preparation-result.json`,
  )), false);
  const entry = await finishedEntry(harness, requestId);
  assert.equal(entry.requestState.phase, 'failed');
  assert.equal(entry.requestState.resultCode, 'REQUEST_FAILED');
});
