import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createHostAuditLog } from './libexec/deploy/audit-log.mjs';
import { createRequestRecordStore } from './libexec/deploy/request-store.mjs';
import {
  appendSubmitDiagnostic,
  handleHostV2SubmitRequest,
  resolveSystemctlPath,
  startHostDeployWorker,
} from './libexec/deploy/submit-request.mjs';
import {
  decodeHostV2ResponseFrame,
  encodeHostV2RequestFrame,
  serializeCanonicalHostV2Request,
} from '../../scripts/deploy/host/protocol-v2.mjs';
import { serializeCanonicalHostDeployPolicy } from '../../scripts/deploy/host/deploy-policy.mjs';
import { serializeCanonicalHostJson } from '../../scripts/deploy/host/protocol.mjs';
import { parseCanonicalHostRequestStateBytes } from '../../scripts/deploy/host/state.mjs';

const SOURCE_SHA = 'c'.repeat(40);
const RELEASE_ID = `omnilodge-r321-a4-${SOURCE_SHA.slice(0, 12)}`;
const ARTIFACT = Buffer.from('PK\x03\x04host-endpoint-artifact', 'binary');
const AUDIT_PATH = '/audit/events.ndjson';
const TEST_PATHS = Object.freeze({
  pendingRequests: '/state/pending',
  runningRequests: '/state/running',
  finishedRequests: '/state/finished',
  requestNonces: '/state/nonces',
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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

const chunks = async function* (bytes) {
  for (let offset = 0; offset < bytes.length; offset += 11) {
    yield bytes.subarray(offset, Math.min(offset + 11, bytes.length));
  }
};

const captureStream = () => {
  const chunksWritten = [];
  return {
    chunks: chunksWritten,
    async write(bytes) {
      chunksWritten.push(Buffer.from(bytes));
      return true;
    },
    bytes() {
      return Buffer.concat(chunksWritten);
    },
    text() {
      return this.bytes().toString('utf8');
    },
  };
};

const evidenceBytes = ({ artifact = ARTIFACT, operation = 'deploy', trigger = 'manual' } = {}) => {
  const artifactDigest = `sha256:${sha256(artifact)}`;
  return serializeCanonicalHostJson({
    schemaVersion: 2,
    operation: { name: operation, trigger },
    activationAuthorization: operation === 'deploy'
      ? { mode: 'manual', authorized: true, reason: 'authorized' }
      : { mode: 'manual', authorized: false, reason: 'activation_not_requested' },
    release: {
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      runId: '321',
      runAttempt: '4',
      artifactId: '789',
      artifactName: RELEASE_ID,
      artifactDigest,
    },
    productionEvidence: {
      workflowConclusion: 'success',
      artifactId: '789',
      artifactDigest,
      expectedReleaseId: RELEASE_ID,
      expectedSourceSha: SOURCE_SHA,
      expectedRepository: 'pablo-dryfield/omni-lodge',
      expectedWorkflowPath: '.github/workflows/release.yml',
      expectedEvent: 'push',
      expectedRef: 'refs/heads/master',
      expectedRunId: '321',
      expectedRunAttempt: '4',
      expectedArtifactName: RELEASE_ID,
    },
  });
};

const forwardFrame = ({
  requestId = '123e4567-e89b-42d3-a456-426614174000',
  requestedAtUtc = '2026-09-16T12:00:00.000Z',
  operation = 'deploy',
  trigger = 'manual',
  artifact = ARTIFACT,
} = {}) => {
  const evidence = evidenceBytes({ artifact, operation, trigger });
  const requestBytes = serializeCanonicalHostV2Request({
    schemaVersion: 2,
    requestId,
    requestedAtUtc,
    actor: 'github-actions[bot]',
    kind: 'forward_submit',
    payload: {
      operation,
      trigger,
      evidenceSha256: sha256(evidence),
      artifactZipSha256: sha256(artifact),
    },
  });
  return encodeHostV2RequestFrame({
    requestBytes,
    evidenceBytes: evidence,
    artifactZipBytes: artifact,
  });
};

const statusFrame = ({
  requestId = '223e4567-e89b-42d3-a456-426614174001',
  subjectRequestId = '123e4567-e89b-42d3-a456-426614174000',
  requestedAtUtc = '2026-09-16T12:00:00.000Z',
} = {}) => encodeHostV2RequestFrame({
  requestBytes: serializeCanonicalHostV2Request({
    schemaVersion: 2,
    requestId,
    requestedAtUtc,
    actor: 'github-actions[bot]',
    kind: 'status_query',
    payload: { subjectRequestId },
  }),
});

const rollbackFrame = ({
  requestId = '723e4567-e89b-42d3-a456-426614174006',
  requestedAtUtc = '2026-09-16T12:00:00.000Z',
} = {}) => encodeHostV2RequestFrame({
  requestBytes: serializeCanonicalHostV2Request({
    schemaVersion: 2,
    requestId,
    requestedAtUtc,
    actor: 'github-actions[bot]',
    kind: 'rollback_submit',
    payload: {
      trigger: 'manual',
      expectedActiveSnapshot: {
        activationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        snapshotSha256: '1'.repeat(64),
      },
      targetSnapshot: {
        activationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        snapshotSha256: '2'.repeat(64),
      },
    },
  }),
});

const policyBytes = (deploymentMode) => serializeCanonicalHostDeployPolicy({
  schemaVersion: 1,
  deploymentMode,
});

const createHarness = ({
  deploymentMode = 'disabled',
  now = '2026-09-16T12:00:00.000Z',
} = {}) => {
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
    readPolicyBytes: async () => policyBytes(deploymentMode),
  };
};

const submit = async ({ frame, artifactDirectory, harness, overrides = {} }) => {
  const output = captureStream();
  const errorOutput = captureStream();
  const result = await handleHostV2SubmitRequest({
    input: chunks(frame),
    output,
    errorOutput,
    clock: harness.clock,
    readPolicyBytes: harness.readPolicyBytes,
    requestStore: harness.store,
    auditLog: harness.audit,
    artifactDirectory,
    ...overrides,
  });
  return { result, output, errorOutput };
};

const readFinishedState = (fileOps, requestId) => parseCanonicalHostRequestStateBytes(
  fileOps.files.get(`/state/finished/${requestId}.json`).bytes,
);

const readPendingState = (fileOps, requestId) => parseCanonicalHostRequestStateBytes(
  fileOps.files.get(`/state/pending/${requestId}.json`).bytes,
);

test('host submit endpoint starts detached workers through a fixed systemd unit name', async () => {
  const calls = [];
  const result = await startHostDeployWorker({
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    systemctlPath: '/bin/systemctl',
    runCommand: async (...args) => {
      calls.push(args);
    },
  });
  assert.deepEqual(result, {
    requestId: '123e4567-e89b-42d3-a456-426614174000',
    started: true,
  });
  assert.deepEqual(calls, [[
    '/bin/systemctl',
    ['--no-block', 'start', 'omnilodge-deploy-worker@123e4567-e89b-42d3-a456-426614174000.service'],
    {
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    },
  ]]);
});

test('host submit endpoint resolves systemctl from fixed absolute candidates', async () => {
  const checked = [];
  const fs = {
    async access(candidate) {
      checked.push(candidate);
      if (candidate === '/usr/bin/systemctl') {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
    },
  };
  assert.equal(await resolveSystemctlPath({ fs }), '/bin/systemctl');
  assert.deepEqual(checked, ['/usr/bin/systemctl', '/bin/systemctl']);

  const calls = [];
  await startHostDeployWorker({
    requestId: '823e4567-e89b-42d3-a456-426614174007',
    fs,
    runCommand: async (...args) => {
      calls.push(args);
    },
  });
  assert.equal(calls[0][0], '/bin/systemctl');
});

test('host submit diagnostics are bounded JSON lines without control characters', async () => {
  const appends = [];
  await appendSubmitDiagnostic({
    fs: {
      appendFile: async (targetPath, line, options) => {
        appends.push({ targetPath, line, options });
      },
    },
    paths: { deployLog: '/deploy/worker.log' },
    clock: () => new Date('2026-09-16T12:00:00.000Z'),
    identity: {
      requestId: '723e4567-e89b-42d3-a456-426614174006',
      kind: 'forward_submit',
      operation: 'stage',
      trigger: 'manual',
      releaseId: 'release-with\nnewline',
    },
    phase: 'start_worker',
    error: Object.assign(new Error('systemctl failed\nsecret second line'), {
      code: 'SYSTEMCTL_FAILED',
    }),
  });
  assert.equal(appends.length, 1);
  assert.equal(appends[0].targetPath, '/deploy/worker.log');
  assert.deepEqual(appends[0].options, { mode: 0o600 });
  assert.equal(appends[0].line.endsWith('\n'), true);
  const parsed = JSON.parse(appends[0].line);
  assert.equal(parsed.timestampUtc, '2026-09-16T12:00:00.000Z');
  assert.equal(parsed.component, 'host-v2-submit');
  assert.equal(parsed.releaseId, 'release-with?newline');
  assert.equal(parsed.error.message, 'systemctl failed?secret second line');
});

test('host submit endpoint policy-denies disabled forward deploys and cleans staged artifacts', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-submit-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const harness = createHarness({ deploymentMode: 'disabled' });
  const { result, output, errorOutput } = await submit({
    frame: forwardFrame(),
    artifactDirectory,
    harness,
  });
  const response = decodeHostV2ResponseFrame(output.bytes());
  assert.equal(result.exitCode, 0);
  assert.equal(response.code, 'POLICY_DENIED');
  assert.equal(response.message, 'The host policy does not authorize this request.');
  assert.equal(errorOutput.text(), '');
  assert.deepEqual(await readdir(artifactDirectory), []);

  const state = readFinishedState(harness.fileOps, '123e4567-e89b-42d3-a456-426614174000');
  assert.equal(state.phase, 'rejected');
  assert.equal(state.resultCode, 'POLICY_DENIED');
  const auditLines = harness.fileOps.files.get(AUDIT_PATH).bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(auditLines.map((event) => [event.eventType, event.outcomeCode]), [
    ['request_admitted', null],
    ['request_rejected', 'POLICY_DENIED'],
  ]);
});

test('host submit endpoint accepts authorized requests and starts the detached worker', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-submit-stage-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const harness = createHarness({ deploymentMode: 'disabled' });
  const persisted = [];
  const started = [];
  const { output } = await submit({
    frame: forwardFrame({
      requestId: '323e4567-e89b-42d3-a456-426614174002',
      operation: 'stage',
    }),
    artifactDirectory,
    harness,
    overrides: {
      persistForWorker: async ({ received }) => {
        persisted.push({
          requestId: received.identity.requestId,
          evidenceBytes: received.evidenceBytes.length,
          artifactZipLength: received.artifactZipLength,
        });
        return {
          requestId: received.identity.requestId,
          artifactPath: path.join(artifactDirectory, `${received.identity.requestId}.zip`),
          evidencePath: path.join(artifactDirectory, `${received.identity.requestId}.evidence.json`),
        };
      },
      startWorker: async ({ requestId }) => {
        started.push(requestId);
      },
    },
  });
  const response = decodeHostV2ResponseFrame(output.bytes());
  assert.equal(response.code, 'REQUEST_ACCEPTED');
  assert.deepEqual(await readdir(artifactDirectory), []);
  assert.deepEqual(started, ['323e4567-e89b-42d3-a456-426614174002']);
  assert.deepEqual(persisted, [{
    requestId: '323e4567-e89b-42d3-a456-426614174002',
    evidenceBytes: evidenceBytes({ operation: 'stage' }).length,
    artifactZipLength: ARTIFACT.length,
  }]);
  const state = readPendingState(harness.fileOps, '323e4567-e89b-42d3-a456-426614174002');
  assert.equal(state.intent.operation, 'stage');
  assert.equal(state.phase, 'received');
  assert.equal(state.resultCode, null);
});

test('host submit endpoint accepts manual rollback without staging worker payloads', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-submit-rollback-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const harness = createHarness({ deploymentMode: 'disabled' });
  const persisted = [];
  const started = [];
  const { output } = await submit({
    frame: rollbackFrame(),
    artifactDirectory,
    harness,
    overrides: {
      persistForWorker: async () => {
        persisted.push('unexpected');
      },
      startWorker: async ({ requestId }) => {
        started.push(requestId);
      },
    },
  });
  const response = decodeHostV2ResponseFrame(output.bytes());
  assert.equal(response.code, 'REQUEST_ACCEPTED');
  assert.deepEqual(await readdir(artifactDirectory), []);
  assert.deepEqual(persisted, []);
  assert.deepEqual(started, ['723e4567-e89b-42d3-a456-426614174006']);
  const state = readPendingState(harness.fileOps, '723e4567-e89b-42d3-a456-426614174006');
  assert.equal(state.request.kind, 'rollback_submit');
  assert.equal(state.intent.trigger, 'manual');
  assert.equal(state.phase, 'received');
  assert.equal(state.resultCode, null);
});

test('host submit endpoint records sanitized diagnostics when worker handoff fails', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-submit-worker-fail-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const harness = createHarness({ deploymentMode: 'manual' });
  const diagnostics = [];
  const stagedArtifacts = [];
  const { output } = await submit({
    frame: forwardFrame({
      requestId: '623e4567-e89b-42d3-a456-426614174005',
      operation: 'stage',
    }),
    artifactDirectory,
    harness,
    overrides: {
      persistForWorker: async ({ received }) => {
        stagedArtifacts.push(received.identity.requestId);
        return {
          requestId: received.identity.requestId,
          artifactPath: path.join(artifactDirectory, `${received.identity.requestId}.zip`),
          evidencePath: path.join(artifactDirectory, `${received.identity.requestId}.evidence.json`),
        };
      },
      startWorker: async () => {
        const error = new Error('systemctl failed with token secret-value\nsecond line');
        error.code = 'SYSTEMCTL_FAILED';
        throw error;
      },
      cleanupWorkerPayload: async ({ staged }) => {
        stagedArtifacts.push(`cleanup:${staged.requestId}`);
      },
      recordSubmitDiagnostic: async (entry) => {
        diagnostics.push(entry);
      },
    },
  });
  const response = decodeHostV2ResponseFrame(output.bytes());
  assert.equal(response.code, 'REQUEST_REJECTED');
  assert.deepEqual(stagedArtifacts, [
    '623e4567-e89b-42d3-a456-426614174005',
    'cleanup:623e4567-e89b-42d3-a456-426614174005',
  ]);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].phase, 'start_worker');
  assert.equal(diagnostics[0].identity.requestId, '623e4567-e89b-42d3-a456-426614174005');
  assert.equal(diagnostics[0].error.code, 'SYSTEMCTL_FAILED');
  const state = readFinishedState(harness.fileOps, '623e4567-e89b-42d3-a456-426614174005');
  assert.equal(state.phase, 'rejected');
  assert.equal(state.resultCode, 'REQUEST_REJECTED');
});

test('host submit endpoint rejects stale requests before creating durable request state', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-submit-stale-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const harness = createHarness({ deploymentMode: 'manual', now: '2026-09-16T12:06:00.001Z' });
  const { output } = await submit({
    frame: forwardFrame(),
    artifactDirectory,
    harness,
  });
  const response = decodeHostV2ResponseFrame(output.bytes());
  assert.equal(response.code, 'REQUEST_TIMESTAMP_REJECTED');
  assert.equal([...harness.fileOps.files.keys()].some((filePath) => filePath.startsWith('/state/finished/')), false);
  assert.deepEqual(await readdir(artifactDirectory), []);
});

test('host submit endpoint returns exact status records for status queries', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-submit-status-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const harness = createHarness({ deploymentMode: 'disabled' });
  await submit({
    frame: forwardFrame({
      requestId: '423e4567-e89b-42d3-a456-426614174003',
      operation: 'stage',
    }),
    artifactDirectory,
    harness,
    overrides: {
      persistForWorker: async ({ received }) => ({
        requestId: received.identity.requestId,
        artifactPath: path.join(artifactDirectory, `${received.identity.requestId}.zip`),
        evidencePath: path.join(artifactDirectory, `${received.identity.requestId}.evidence.json`),
      }),
      startWorker: async () => {},
    },
  });
  const { output } = await submit({
    frame: statusFrame({
      requestId: '523e4567-e89b-42d3-a456-426614174004',
      subjectRequestId: '423e4567-e89b-42d3-a456-426614174003',
    }),
    artifactDirectory,
    harness,
  });
  const response = decodeHostV2ResponseFrame(output.bytes());
  assert.equal(response.code, 'STATUS_FOUND');
  assert.equal(response.requestStatus.requestId, '423e4567-e89b-42d3-a456-426614174003');
  assert.equal(response.requestStatus.lifecycle, 'accepted');
  assert.equal(response.requestStatus.phase, 'received');
  assert.equal(response.requestStatus.resultCode, null);
});

test('host submit endpoint fails malformed frames without echoing request bytes', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-submit-bad-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const harness = createHarness();
  const { result, output, errorOutput } = await submit({
    frame: Buffer.from('<!DOCTYPE html><secret>do-not-echo</secret>'),
    artifactDirectory,
    harness,
  });
  assert.equal(result.exitCode, 65);
  assert.equal(output.bytes().length, 0);
  assert.equal(errorOutput.text(), 'Production deployment request rejected.\n');
  assert.equal(errorOutput.text().includes('do-not-echo'), false);
  assert.deepEqual(await readdir(artifactDirectory), []);
});
