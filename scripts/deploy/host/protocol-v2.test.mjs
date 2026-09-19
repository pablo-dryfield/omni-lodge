import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateHostV2DeployPolicy } from './deploy-policy.mjs';
import {
  HOST_REQUEST_MAX_FUTURE_MS,
  HOST_REQUEST_MAX_PAST_MS,
  HOST_V2_REQUEST_HEADER_BYTES,
  HOST_V2_RESPONSE_HEADER_BYTES,
  MAX_HOST_V2_ARTIFACT_BYTES,
  MAX_HOST_V2_EVIDENCE_BYTES,
  MAX_HOST_V2_REQUEST_BYTES,
  MAX_HOST_V2_RESPONSE_BYTES,
  createHostV2RequestHeader,
  createHostV2Response,
  createHostV2ResponseHeader,
  decodeHostV2RequestFrame,
  decodeHostV2ResponseFrame,
  encodeHostV2RequestFrame,
  encodeHostV2ResponseFrame,
  parseHostV2RequestHeader,
  parseHostV2ResponseHeader,
  serializeCanonicalHostV2Request,
  validateHostV2RequestFreshness,
} from './protocol-v2.mjs';
import { parseHostRequestHeader, serializeCanonicalHostJson } from './protocol.mjs';
import { receiveHostV2RequestToFile } from './request-receiver.mjs';
import {
  createHostArtifactActivationSnapshot,
  createHostActivationSnapshotReference,
  createHostActivationTransaction,
  createHostLegacyBaselineActivationSnapshot,
  createHostRequestStatus,
  createInitialHostRequestState,
  parseCanonicalHostActivationSnapshotBytes,
  parseCanonicalHostRequestStateBytes,
  planHostActivationRecovery,
  serializeCanonicalHostActivationSnapshot,
  serializeCanonicalHostRequestState,
  transitionHostActivationTransaction,
  transitionHostRequestState,
  validateHostActivationSnapshot,
  validateHostActivationTransaction,
  validateHostActivationTransactionBinding,
  validateHostRequestState,
} from './state.mjs';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const SUBJECT_ID = '223e4567-e89b-42d3-a456-426614174001';
const ACTIVE_ID = '323e4567-e89b-42d3-a456-426614174002';
const TARGET_ID = '423e4567-e89b-42d3-a456-426614174003';
const SOURCE_SHA = 'c'.repeat(40);
const RELEASE_ID = `omnilodge-r321-a4-${SOURCE_SHA.slice(0, 12)}`;
const ARTIFACT = Buffer.from('PK\x03\x04host-v2-artifact', 'binary');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

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

const forwardRequestBytes = ({ evidence = evidenceBytes(), artifact = ARTIFACT, extra = {} } = {}) => serializeCanonicalHostV2Request({
  schemaVersion: 2,
  requestId: REQUEST_ID,
  requestedAtUtc: '2026-09-16T12:00:00.000Z',
  actor: 'github-actions[bot]',
  kind: 'forward_submit',
  payload: {
    operation: 'deploy',
    trigger: 'manual',
    evidenceSha256: sha256(evidence),
    artifactZipSha256: sha256(artifact),
  },
  ...extra,
});

const snapshotRef = (activationId, digestCharacter) => ({
  activationId,
  snapshotSha256: digestCharacter.repeat(64),
});

const rollbackRequestBytes = ({
  expectedActiveSnapshot = snapshotRef(ACTIVE_ID, 'a'),
  targetSnapshot = snapshotRef(TARGET_ID, 'b'),
} = {}) => serializeCanonicalHostV2Request({
  schemaVersion: 2,
  requestId: REQUEST_ID,
  requestedAtUtc: '2026-09-16T12:00:00.000Z',
  actor: 'pablo-dryfield',
  kind: 'rollback_submit',
  payload: {
    trigger: 'manual',
    expectedActiveSnapshot,
    targetSnapshot,
  },
});

const statusRequestBytes = () => serializeCanonicalHostV2Request({
  schemaVersion: 2,
  requestId: REQUEST_ID,
  requestedAtUtc: '2026-09-16T12:00:00.000Z',
  actor: 'github-actions[bot]',
  kind: 'status_query',
  payload: { subjectRequestId: SUBJECT_ID },
});

const forwardFrame = ({ artifact = ARTIFACT, evidence = evidenceBytes({ artifact }) } = {}) => encodeHostV2RequestFrame({
  requestBytes: forwardRequestBytes({ evidence, artifact }),
  evidenceBytes: evidence,
  artifactZipBytes: artifact,
});

const artifactFreeFrame = (requestBytes) => encodeHostV2RequestFrame({ requestBytes });

const chunks = async function* (bytes) {
  for (let offset = 0; offset < bytes.length; offset += 7) {
    yield bytes.subarray(offset, Math.min(offset + 7, bytes.length));
  }
};

test('v2 forward submission binds request, evidence, and artifact', () => {
  const decoded = decodeHostV2RequestFrame(forwardFrame());
  assert.equal(decoded.identity.kind, 'forward_submit');
  assert.equal(decoded.identity.releaseId, RELEASE_ID);
  assert.equal(decoded.identity.evidenceSha256, sha256(evidenceBytes()));
  assert.equal(decoded.identity.artifactZipSha256, sha256(ARTIFACT));
  assert.deepEqual(decoded.artifactZipBytes, ARTIFACT);
});

test('v2 rollback and status frames are strictly artifact-free and independently typed', () => {
  const rollbackFrame = artifactFreeFrame(rollbackRequestBytes());
  const rollback = decodeHostV2RequestFrame(rollbackFrame);
  assert.equal(rollback.identity.kind, 'rollback_submit');
  assert.equal(rollback.identity.trigger, 'manual');
  assert.equal(rollback.artifactZipBytes.length, 0);
  assert.equal(rollback.evidenceBytes.length, 0);

  const status = decodeHostV2RequestFrame(artifactFreeFrame(statusRequestBytes()));
  assert.equal(status.identity.kind, 'status_query');
  assert.equal(status.identity.subjectRequestId, SUBJECT_ID);
  assert.equal(status.artifactZipBytes.length, 0);
});

test('v1 and v2 framing are never silently reinterpreted', () => {
  const v2Header = createHostV2RequestHeader({ requestLength: 1, evidenceLength: 0, artifactZipLength: 0 });
  assert.throws(() => parseHostRequestHeader(v2Header), /magic/);
  const v1Like = Buffer.from(v2Header);
  v1Like.write('OMNIHRQ1', 0, 'ascii');
  v1Like.writeUInt16BE(1, 8);
  assert.throws(() => parseHostV2RequestHeader(v1Like), /magic/);
  assert.throws(() => decodeHostV2RequestFrame(forwardFrame().subarray(0, -1)), /truncated/);
  assert.throws(() => decodeHostV2RequestFrame(Buffer.concat([forwardFrame(), Buffer.from([0])])), /trailing bytes/);
});

test('v2 framing rejects invalid header fields and every oversized declaration', () => {
  for (const [mutate, expected] of [
    [(header) => header.writeUInt8(0, 0), /magic/],
    [(header) => header.writeUInt16BE(1, 8), /version/],
    [(header) => header.writeUInt16BE(31, 10), /header size/],
    [(header) => header.writeUInt32BE(1, 28), /reserved/],
    [(header) => header.writeUInt32BE(MAX_HOST_V2_REQUEST_BYTES + 1, 12), /request length.*exceeds/],
    [(header) => header.writeUInt32BE(MAX_HOST_V2_EVIDENCE_BYTES + 1, 16), /evidence length.*exceeds/],
    [(header) => header.writeBigUInt64BE(BigInt(MAX_HOST_V2_ARTIFACT_BYTES) + 1n, 20), /artifact ZIP length.*exceeds/],
  ]) {
    const header = createHostV2RequestHeader({ requestLength: 1, evidenceLength: 0, artifactZipLength: 0 });
    mutate(header);
    assert.throws(() => parseHostV2RequestHeader(header), expected);
  }
});

test('artifact-free request kinds reject evidence, artifact, automatic rollback, and no-op rollback', () => {
  assert.throws(
    () => encodeHostV2RequestFrame({ requestBytes: rollbackRequestBytes(), evidenceBytes: Buffer.from('x') }),
    /must not carry release evidence/,
  );
  assert.throws(
    () => encodeHostV2RequestFrame({ requestBytes: statusRequestBytes(), artifactZipBytes: Buffer.from('x') }),
    /must not carry an artifact ZIP/,
  );
  const automatic = JSON.parse(rollbackRequestBytes().toString('utf8'));
  automatic.payload.trigger = 'automatic';
  assert.throws(
    () => artifactFreeFrame(serializeCanonicalHostJson(automatic)),
    /manually triggered/,
  );
  const noOp = JSON.parse(rollbackRequestBytes().toString('utf8'));
  noOp.payload.targetSnapshot = noOp.payload.expectedActiveSnapshot;
  assert.throws(
    () => artifactFreeFrame(serializeCanonicalHostJson(noOp)),
    /must differ/,
  );
});

test('v2 rejects canonical-schema and payload digest substitutions', () => {
  const canonical = forwardRequestBytes();
  const duplicate = Buffer.from(canonical.toString('utf8').replace('{\n', '{\n  "schemaVersion": 2,\n'));
  assert.throws(
    () => encodeHostV2RequestFrame({ requestBytes: duplicate, evidenceBytes: evidenceBytes(), artifactZipBytes: ARTIFACT }),
    /canonical JSON/,
  );
  const request = JSON.parse(canonical.toString('utf8'));
  request.unexpected = true;
  assert.throws(
    () => encodeHostV2RequestFrame({ requestBytes: serializeCanonicalHostJson(request), evidenceBytes: evidenceBytes(), artifactZipBytes: ARTIFACT }),
    /schema is not canonical/,
  );
  const changedArtifact = Buffer.from(ARTIFACT);
  changedArtifact[changedArtifact.length - 1] ^= 0xff;
  assert.throws(
    () => encodeHostV2RequestFrame({ requestBytes: canonical, evidenceBytes: evidenceBytes(), artifactZipBytes: changedArtifact }),
    /digest does not match the raw ZIP/,
  );
});

test('freshness is based on server receipt with exact five-minute and one-minute bounds', () => {
  const received = '2026-09-16T12:05:00.000Z';
  assert.equal(validateHostV2RequestFreshness({ requestedAtUtc: '2026-09-16T12:00:00.000Z', receivedAtUtc: received }).ageMilliseconds, HOST_REQUEST_MAX_PAST_MS);
  assert.equal(validateHostV2RequestFreshness({ requestedAtUtc: '2026-09-16T12:06:00.000Z', receivedAtUtc: received }).ageMilliseconds, -HOST_REQUEST_MAX_FUTURE_MS);
  assert.throws(
    () => validateHostV2RequestFreshness({ requestedAtUtc: '2026-09-16T11:59:59.999Z', receivedAtUtc: received }),
    /too old/,
  );
  assert.throws(
    () => validateHostV2RequestFreshness({ requestedAtUtc: '2026-09-16T12:06:00.001Z', receivedAtUtc: received }),
    /future/,
  );
});

test('host policy freezes forward deploy but always permits manual rollback and status', () => {
  const forwardIdentity = decodeHostV2RequestFrame(forwardFrame()).identity;
  const rollbackIdentity = decodeHostV2RequestFrame(artifactFreeFrame(rollbackRequestBytes())).identity;
  const statusIdentity = decodeHostV2RequestFrame(artifactFreeFrame(statusRequestBytes())).identity;
  const policy = (deploymentMode) => ({ schemaVersion: 1, deploymentMode });

  assert.equal(evaluateHostV2DeployPolicy({ policy: policy('disabled'), requestIdentity: forwardIdentity }).authorized, false);
  for (const mode of ['disabled', 'manual', 'automatic']) {
    const rollback = evaluateHostV2DeployPolicy({ policy: policy(mode), requestIdentity: rollbackIdentity });
    assert.equal(rollback.authorized, true);
    assert.equal(rollback.reason, 'manual_rollback_allowed_during_forward_freeze');
    assert.equal(evaluateHostV2DeployPolicy({ policy: policy(mode), requestIdentity: statusIdentity }).authorized, true);
  }
});

test('streaming receiver writes only forward artifacts and leaves artifact-free requests file-free', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-v2-receiver-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const received = await receiveHostV2RequestToFile({ input: chunks(forwardFrame()), artifactDirectory: directory });
  assert.deepEqual(await readFile(received.artifactZipPath), ARTIFACT);
  await received.cleanupArtifact();
  assert.deepEqual(await readdir(directory), []);

  const rollback = await receiveHostV2RequestToFile({ input: chunks(artifactFreeFrame(rollbackRequestBytes())) });
  assert.equal(rollback.artifactZipPath, null);
  assert.equal(rollback.artifactZipLength, 0);
  await rollback.cleanupArtifact();
});

test('v2 streaming receiver removes substituted and truncated artifacts', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-v2-receiver-failure-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const valid = forwardFrame();
  const substituted = Buffer.from(valid);
  substituted[substituted.length - 1] ^= 0xff;
  for (const [frame, expected] of [
    [valid.subarray(0, -1), /artifact ZIP is truncated/],
    [substituted, /digest does not match the raw ZIP/],
  ]) {
    await assert.rejects(
      receiveHostV2RequestToFile({ input: chunks(frame), artifactDirectory: directory }),
      expected,
    );
    assert.deepEqual(await readdir(directory), []);
  }
});

test('v2 responses expose only fixed messages and exact status polling data', () => {
  const submitIdentity = decodeHostV2RequestFrame(forwardFrame()).identity;
  const accepted = createHostV2Response({ requestIdentity: submitIdentity, code: 'REQUEST_ACCEPTED' });
  assert.deepEqual(decodeHostV2ResponseFrame(encodeHostV2ResponseFrame(accepted)), accepted);

  const statusIdentity = decodeHostV2RequestFrame(artifactFreeFrame(statusRequestBytes())).identity;
  const requestStatus = {
    requestId: SUBJECT_ID,
    kind: 'forward_submit',
    lifecycle: 'failed',
    phase: 'failed',
    resultCode: 'REQUEST_FAILED',
    updatedAtUtc: '2026-09-16T12:05:00.000Z',
  };
  const found = createHostV2Response({ requestIdentity: statusIdentity, code: 'STATUS_FOUND', requestStatus });
  assert.equal(decodeHostV2ResponseFrame(encodeHostV2ResponseFrame(found)).requestStatus.phase, 'failed');
  assert.equal(
    createHostV2Response({ requestIdentity: statusIdentity, code: 'REQUEST_TIMESTAMP_REJECTED' }).status,
    'rejected',
  );
  assert.throws(
    () => createHostV2Response({ requestIdentity: statusIdentity, code: 'STATUS_FOUND', requestStatus: { ...requestStatus, requestId: REQUEST_ID } }),
    /does not match the requested subject/,
  );
  assert.throws(
    () => createHostV2Response({ requestIdentity: submitIdentity, code: 'STATUS_NOT_FOUND' }),
    /does not match the request kind/,
  );
  const forged = { ...accepted, message: '/etc/omnilodge/backend.env SECRET=value' };
  assert.throws(() => encodeHostV2ResponseFrame(forged), /message is not canonical/);
  assert.throws(
    () => createHostV2Response({
      requestIdentity: statusIdentity,
      code: 'STATUS_FOUND',
      requestStatus: { ...requestStatus, lifecycle: 'succeeded' },
    }),
    /lifecycle does not match/,
  );
});

test('v2 response framing rejects truncation, trailing content, duplicates, and oversized bodies', () => {
  const identity = decodeHostV2RequestFrame(forwardFrame()).identity;
  const response = createHostV2Response({ requestIdentity: identity, code: 'REQUEST_ACCEPTED' });
  const frame = encodeHostV2ResponseFrame(response);
  assert.throws(() => decodeHostV2ResponseFrame(frame.subarray(0, HOST_V2_RESPONSE_HEADER_BYTES - 1)), /truncated/);
  assert.throws(() => decodeHostV2ResponseFrame(frame.subarray(0, -1)), /truncated/);
  assert.throws(() => decodeHostV2ResponseFrame(Buffer.concat([frame, Buffer.from([0])])), /trailing bytes/);
  const responseBytes = serializeCanonicalHostJson(response);
  const duplicate = Buffer.from(responseBytes.toString('utf8').replace('{\n', '{\n  "schemaVersion": 2,\n'));
  assert.throws(
    () => decodeHostV2ResponseFrame(Buffer.concat([createHostV2ResponseHeader(duplicate.length), duplicate])),
    /canonical JSON/,
  );
  const oversized = createHostV2ResponseHeader(1);
  oversized.writeUInt32BE(MAX_HOST_V2_RESPONSE_BYTES + 1, 12);
  assert.throws(() => parseHostV2ResponseHeader(oversized), /exceeds the limit/);
});

const legacyBaselineSnapshot = (overrides = {}) => createHostLegacyBaselineActivationSnapshot({
  activationId: ACTIVE_ID,
  backendRestoreTarget: {
    path: '/root/omni-lodge/be',
    sourceSha: '9'.repeat(40),
  },
  uiRestoreTarget: {
    path: '/root/omni-lodge/ui/build',
    buildTreeSha256: '8'.repeat(64),
  },
  pm2State: {
    dumpPath: '/var/lib/omnilodge/baselines/first-cutover/dump.pm2',
    dumpSha256: '7'.repeat(64),
    backendProcessName: 'omni-lodge-be',
    uiProcessName: 'omni-lodge-ui-server',
  },
  capturedAtUtc: '2026-09-16T10:00:00.000Z',
  capturedBy: 'pablo-dryfield',
  ...overrides,
});

const artifactSnapshot = (overrides = {}) => ({
  schemaVersion: 1,
  snapshotKind: 'artifact_release',
  activationId: TARGET_ID,
  releaseId: RELEASE_ID,
  sourceSha: SOURCE_SHA,
  evidenceSha256: 'd'.repeat(64),
  artifactZipSha256: 'e'.repeat(64),
  activatedByRequestId: SUBJECT_ID,
  activatedByRequestSha256: '6'.repeat(64),
  activatedAtUtc: '2026-09-16T11:00:00.000Z',
  backendRestoreTarget: `/opt/omnilodge/releases/${RELEASE_ID}/be`,
  uiRestoreTarget: `/opt/omnilodge/releases/${RELEASE_ID}`,
  predecessorSnapshot: createHostActivationSnapshotReference(legacyBaselineSnapshot()),
  ...overrides,
});

test('artifact and legacy activation snapshots hash their complete canonical documents', () => {
  const legacy = legacyBaselineSnapshot();
  const artifact = validateHostActivationSnapshot(artifactSnapshot());
  for (const snapshot of [legacy, artifact]) {
    const bytes = serializeCanonicalHostActivationSnapshot(snapshot);
    assert.deepEqual(parseCanonicalHostActivationSnapshotBytes(bytes), snapshot);
    const reference = createHostActivationSnapshotReference(snapshot);
    assert.equal(reference.activationId, snapshot.activationId);
    assert.equal(reference.snapshotSha256, sha256(bytes));
    assert.throws(() => parseCanonicalHostActivationSnapshotBytes(Buffer.from(JSON.stringify(snapshot))), /canonical JSON/);
  }
  assert.equal('artifactZipSha256' in legacy, false);
  assert.throws(
    () => validateHostActivationSnapshot({ ...artifactSnapshot(), predecessorSnapshot: snapshotRef(TARGET_ID, 'f') }),
    /cannot name itself/,
  );
  assert.throws(
    () => validateHostActivationSnapshot({ ...legacy, artifactZipSha256: 'f'.repeat(64) }),
    /schema is not canonical/,
  );
});

const advance = (state, nextPhase, seconds, resultCode = null) => transitionHostRequestState({
  state,
  nextPhase,
  updatedAtUtc: `2026-09-16T12:00:${String(seconds).padStart(2, '0')}.000Z`,
  resultCode,
});

test('durable request state allows only intent-specific monotonic transitions', () => {
  const identity = decodeHostV2RequestFrame(forwardFrame()).identity;
  let state = createInitialHostRequestState({ requestIdentity: identity, receivedAtUtc: '2026-09-16T12:00:00.000Z' });
  assert.throws(() => advance(state, 'migrations_applied', 1), /Illegal/);
  const phases = [
    'authorized', 'artifact_staged', 'preflight_passed', 'backup_verified',
    'migrations_applied', 'activation_prepared', 'pointer_switching',
    'pointers_switched', 'smoke_verified', 'succeeded',
  ];
  phases.forEach((phase, index) => { state = advance(state, phase, index + 1); });
  assert.equal(state.resultCode, 'REQUEST_SUCCEEDED');
  assert.equal(createHostRequestStatus(state).lifecycle, 'succeeded');
  assert.deepEqual(parseCanonicalHostRequestStateBytes(serializeCanonicalHostRequestState(state)), state);
  assert.throws(() => advance(state, 'failed', 20), /Terminal/);

  const stageEvidence = evidenceBytes({ operation: 'stage' });
  const stageRequest = serializeCanonicalHostV2Request({
    schemaVersion: 2,
    requestId: REQUEST_ID,
    requestedAtUtc: '2026-09-16T12:00:00.000Z',
    actor: 'github-actions[bot]',
    kind: 'forward_submit',
    payload: { operation: 'stage', trigger: 'manual', evidenceSha256: sha256(stageEvidence), artifactZipSha256: sha256(ARTIFACT) },
  });
  let stageState = createInitialHostRequestState({
    requestIdentity: decodeHostV2RequestFrame(encodeHostV2RequestFrame({ requestBytes: stageRequest, evidenceBytes: stageEvidence, artifactZipBytes: ARTIFACT })).identity,
    receivedAtUtc: '2026-09-16T12:00:00.000Z',
  });
  stageState = advance(stageState, 'authorized', 1);
  stageState = advance(stageState, 'artifact_staged', 2);
  stageState = advance(stageState, 'preflight_passed', 3);
  assert.throws(() => advance(stageState, 'backup_verified', 4), /Illegal/);
  assert.equal(advance(stageState, 'succeeded', 4).phase, 'succeeded');

  const rollbackIdentity = decodeHostV2RequestFrame(artifactFreeFrame(rollbackRequestBytes())).identity;
  let rollbackState = createInitialHostRequestState({ requestIdentity: rollbackIdentity, receivedAtUtc: '2026-09-16T12:00:00.000Z' });
  rollbackState = advance(rollbackState, 'authorized', 1);
  assert.throws(() => advance(rollbackState, 'artifact_staged', 2), /Illegal/);
  assert.throws(() => advance(rollbackState, 'migrations_applied', 2), /Illegal/);
  assert.equal(advance(rollbackState, 'activation_prepared', 2).phase, 'activation_prepared');
});

test('rejected state requires a fixed sanitized reason', () => {
  const identity = decodeHostV2RequestFrame(forwardFrame()).identity;
  const state = createInitialHostRequestState({ requestIdentity: identity, receivedAtUtc: '2026-09-16T12:00:00.000Z' });
  assert.throws(() => advance(state, 'rejected', 1, '/root/private/error'), /invalid result code/);
  assert.equal(advance(state, 'rejected', 1, 'POLICY_DENIED').resultCode, 'POLICY_DENIED');
  assert.throws(() => validateHostRequestState({ ...state, updatedAtUtc: '2026-09-16T11:59:59.000Z' }), /must not move backwards/);
});

const activationBinding = (fixture) => ({
  requestState: fixture.requestState,
  previousSnapshot: fixture.previousSnapshot,
  targetSnapshot: fixture.targetSnapshot,
});

const forwardActivationFixture = ({ requestId = REQUEST_ID } = {}) => {
  const identity = decodeHostV2RequestFrame(forwardFrame()).identity;
  const boundIdentity = requestId === identity.requestId ? identity : { ...identity, requestId };
  let requestState = createInitialHostRequestState({
    requestIdentity: boundIdentity,
    receivedAtUtc: '2026-09-16T12:00:00.000Z',
  });
  for (const [index, phase] of [
    'authorized', 'artifact_staged', 'preflight_passed', 'backup_verified',
    'migrations_applied', 'activation_prepared',
  ].entries()) requestState = advance(requestState, phase, index + 1);
  const previousSnapshot = legacyBaselineSnapshot();
  const targetSnapshot = createHostArtifactActivationSnapshot({
    requestState,
    activationId: TARGET_ID,
    activatedAtUtc: '2026-09-16T12:00:07.000Z',
    predecessorSnapshot: previousSnapshot,
  });
  const transaction = createHostActivationTransaction({
    requestState,
    previousSnapshot,
    targetSnapshot,
    createdAtUtc: '2026-09-16T12:00:08.000Z',
  });
  return { requestState, previousSnapshot, targetSnapshot, transaction };
};

const rollbackActivationFixture = () => {
  const previousSnapshot = validateHostActivationSnapshot(artifactSnapshot());
  const targetSnapshot = legacyBaselineSnapshot();
  const identity = decodeHostV2RequestFrame(artifactFreeFrame(rollbackRequestBytes({
    expectedActiveSnapshot: createHostActivationSnapshotReference(previousSnapshot),
    targetSnapshot: createHostActivationSnapshotReference(targetSnapshot),
  }))).identity;
  let requestState = createInitialHostRequestState({
    requestIdentity: identity,
    receivedAtUtc: '2026-09-16T12:00:00.000Z',
  });
  requestState = advance(requestState, 'authorized', 1);
  requestState = advance(requestState, 'activation_prepared', 2);
  const transaction = createHostActivationTransaction({
    requestState,
    previousSnapshot,
    targetSnapshot,
    createdAtUtc: '2026-09-16T12:00:03.000Z',
  });
  return { requestState, previousSnapshot, targetSnapshot, transaction };
};

const transitionActivation = (fixture, nextPhase, second) => transitionHostActivationTransaction({
  transaction: fixture.transaction,
  ...activationBinding(fixture),
  nextPhase,
  updatedAtUtc: `2026-09-16T12:00:${String(second).padStart(2, '0')}.000Z`,
});

const recoveryPlan = (fixture) => planHostActivationRecovery({
  transaction: fixture.transaction,
  ...activationBinding(fixture),
});

test('first-cutover recovery retains the full legacy baseline and never migrates down', () => {
  const fixture = forwardActivationFixture();
  assert.equal(recoveryPlan(fixture).action, 'abort_without_pointer_change');
  assert.equal(recoveryPlan(fixture).databaseAction, 'none');
  fixture.transaction = transitionActivation(fixture, 'pointer_switching', 9);
  assert.equal(recoveryPlan(fixture).action, 'converge_previous_snapshot');
  assert.equal(recoveryPlan(fixture).previousSnapshot.snapshotKind, 'legacy_baseline');
  assert.equal(recoveryPlan(fixture).previousSnapshot.pm2State.backendProcessName, 'omni-lodge-be');
  fixture.requestState = advance(fixture.requestState, 'pointer_switching', 9);
  fixture.transaction = transitionActivation(fixture, 'pointers_switched', 10);
  assert.equal(recoveryPlan(fixture).action, 'converge_previous_snapshot');
  fixture.requestState = advance(fixture.requestState, 'pointers_switched', 10);
  fixture.transaction = transitionActivation(fixture, 'smoke_verified', 11);
  assert.equal(recoveryPlan(fixture).action, 'commit_target_snapshot');
  fixture.requestState = advance(fixture.requestState, 'smoke_verified', 11);
  assert.throws(() => transitionActivation(fixture, 'migrate_down', 12), /Illegal/);
  fixture.transaction = transitionActivation(fixture, 'committed', 12);
  assert.equal(recoveryPlan(fixture).action, 'none');
  assert.equal(recoveryPlan(fixture).databaseAction, 'none');
});

test('failed activation recovery must durably restore the previous full snapshot before failure', () => {
  const fixture = rollbackActivationFixture();
  fixture.transaction = transitionActivation(fixture, 'pointer_switching', 4);
  fixture.transaction = transitionActivation(fixture, 'restore_required', 5);
  assert.throws(() => transitionActivation(fixture, 'failed', 6), /Illegal/);
  fixture.transaction = transitionActivation(fixture, 'restoring_previous', 6);
  assert.equal(recoveryPlan(fixture).action, 'converge_previous_snapshot');
  fixture.transaction = transitionActivation(fixture, 'previous_restored', 7);
  assert.equal(recoveryPlan(fixture).action, 'mark_request_failed');
  fixture.transaction = transitionActivation(fixture, 'failed', 8);
  assert.equal(recoveryPlan(fixture).databaseAction, 'none');
});

test('activation state rejects cross-request snapshots, stale current state, and tampered full documents', () => {
  const requestA = forwardActivationFixture();
  const requestB = forwardActivationFixture({ requestId: '523e4567-e89b-42d3-a456-426614174004' });
  assert.throws(
    () => createHostActivationTransaction({
      requestState: requestA.requestState,
      previousSnapshot: requestA.previousSnapshot,
      targetSnapshot: requestB.targetSnapshot,
      createdAtUtc: '2026-09-16T12:00:09.000Z',
    }),
    /request ID does not match/,
  );
  assert.throws(
    () => transitionHostActivationTransaction({
      transaction: requestA.transaction,
      ...activationBinding(requestB),
      nextPhase: 'pointer_switching',
      updatedAtUtc: '2026-09-16T12:00:09.000Z',
    }),
    /request ID does not match durable request state/,
  );
  const tamperedTarget = { ...requestA.targetSnapshot, artifactZipSha256: '0'.repeat(64) };
  assert.throws(
    () => validateHostActivationTransactionBinding({
      transaction: requestA.transaction,
      ...activationBinding({ ...requestA, targetSnapshot: tamperedTarget }),
    }),
    /does not match its stored reference/,
  );
  const tamperedReference = {
    ...requestA.transaction,
    targetSnapshot: { ...requestA.transaction.targetSnapshot, snapshotSha256: '0'.repeat(64) },
  };
  assert.throws(
    () => recoveryPlan({ ...requestA, transaction: tamperedReference }),
    /does not match its stored reference/,
  );

  const rollback = rollbackActivationFixture();
  const staleCurrent = legacyBaselineSnapshot({ activationId: '623e4567-e89b-42d3-a456-426614174005' });
  assert.throws(
    () => createHostActivationTransaction({
      requestState: rollback.requestState,
      previousSnapshot: staleCurrent,
      targetSnapshot: rollback.targetSnapshot,
      createdAtUtc: '2026-09-16T12:00:04.000Z',
    }),
    /previous snapshot does not match its durable request/,
  );
  assert.throws(() => validateHostActivationTransaction({ ...requestA.transaction, secretPath: '/root' }), /schema is not canonical/);
});
