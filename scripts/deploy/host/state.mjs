import { createHash } from 'node:crypto';

import { parseCanonicalHostJson, serializeCanonicalHostJson } from './protocol.mjs';
import {
  validateActivationSnapshotRef,
  validateHostV2RequestIdentity,
  validateHostV2RequestStatus,
} from './protocol-v2.mjs';

export const HOST_REQUEST_STATE_SCHEMA_VERSION = 1;
export const HOST_ACTIVATION_SNAPSHOT_SCHEMA_VERSION = 1;
export const HOST_ACTIVATION_TRANSACTION_SCHEMA_VERSION = 1;
export const MAX_HOST_STATE_BYTES = 32 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_ID_PATTERN = /^omnilodge-r([1-9][0-9]*)-a([1-9][0-9]*)-([0-9a-f]{12})$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+\[\]-]{0,127}$/;
const MAX_SAFE_INTEGER_DECIMAL_DIGITS = String(Number.MAX_SAFE_INTEGER).length;
const TERMINAL_PHASES = new Set(['succeeded', 'failed', 'rejected']);
const REJECTION_CODES_BY_KIND = Object.freeze({
  forward_submit: new Set([
    'POLICY_DENIED',
    'REQUEST_REJECTED',
    'REQUEST_TIMESTAMP_REJECTED',
    'REPLAY_REJECTED',
  ]),
  rollback_submit: new Set([
    'REQUEST_REJECTED',
    'REQUEST_TIMESTAMP_REJECTED',
    'REPLAY_REJECTED',
    'ROLLBACK_TARGET_UNAVAILABLE',
    'STALE_ACTIVE_SNAPSHOT',
  ]),
});
const ARTIFACT_SNAPSHOT_KIND = 'artifact_release';
const LEGACY_BASELINE_SNAPSHOT_KIND = 'legacy_baseline';
const RELEASES_ROOT = '/opt/omnilodge/releases';
const ACTIVATION_TRANSACTION_PHASES = new Set([
  'prepared',
  'pointer_switching',
  'pointers_switched',
  'smoke_verified',
  'restore_required',
  'restoring_previous',
  'previous_restored',
  'committed',
  'failed',
]);

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const requireExactKeys = (value, keys, label) => {
  invariant(isPlainObject(value), `${label} must be a JSON object`);
  const actual = Object.keys(value);
  invariant(
    actual.length === keys.length && actual.every((key, index) => key === keys[index]),
    `${label} schema is not canonical`,
  );
  return value;
};

const requireUuid = (value, label) => {
  invariant(typeof value === 'string' && UUID_PATTERN.test(value), `${label} must be a canonical lowercase UUID v4`);
  return value;
};

const requireSha256 = (value, label) => {
  invariant(typeof value === 'string' && SHA256_PATTERN.test(value), `${label} must be a lowercase SHA-256 digest`);
  return value;
};

const requireUtc = (value, label) => {
  invariant(typeof value === 'string', `${label} must be text`);
  const parsed = new Date(value);
  invariant(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return value;
};

const requireActor = (value, label) => {
  invariant(typeof value === 'string' && ACTOR_PATTERN.test(value), `${label} is invalid`);
  return value;
};

const requireAbsolutePosixPath = (value, label) => {
  invariant(typeof value === 'string' && value.length > 1 && value.length <= 4096, `${label} is invalid`);
  invariant(value.startsWith('/') && !value.endsWith('/'), `${label} must be a canonical absolute path`);
  invariant(!/[\u0000-\u001f\u007f]/.test(value), `${label} contains a control character`);
  const segments = value.slice(1).split('/');
  invariant(
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    `${label} must be a canonical absolute path`,
  );
  return value;
};

const assertNondecreasingTime = (earlier, later, label) => {
  invariant(new Date(later).getTime() >= new Date(earlier).getTime(), `${label} must not move backwards`);
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const requireReleaseId = (value, sourceSha, label) => {
  const match = typeof value === 'string' ? RELEASE_ID_PATTERN.exec(value) : null;
  invariant(
    match
      && match[1].length <= MAX_SAFE_INTEGER_DECIMAL_DIGITS
      && match[2].length <= MAX_SAFE_INTEGER_DECIMAL_DIGITS
      && BigInt(match[1]) <= BigInt(Number.MAX_SAFE_INTEGER)
      && BigInt(match[2]) <= BigInt(Number.MAX_SAFE_INTEGER)
      && match[3] === sourceSha.slice(0, 12),
    `${label} is invalid`,
  );
  return value;
};

const validateBackendBaselineTarget = (rawTarget) => {
  const target = requireExactKeys(rawTarget, ['path', 'sourceSha'], 'legacy backend restore target');
  invariant(typeof target.sourceSha === 'string' && SOURCE_SHA_PATTERN.test(target.sourceSha), 'Legacy backend restore target source SHA is invalid');
  return Object.freeze({
    path: requireAbsolutePosixPath(target.path, 'Legacy backend restore target path'),
    sourceSha: target.sourceSha,
  });
};

const validateUiBaselineTarget = (rawTarget) => {
  const target = requireExactKeys(rawTarget, ['path', 'buildTreeSha256'], 'legacy UI restore target');
  return Object.freeze({
    path: requireAbsolutePosixPath(target.path, 'Legacy UI restore target path'),
    buildTreeSha256: requireSha256(target.buildTreeSha256, 'Legacy UI restore target tree digest'),
  });
};

const validatePm2BaselineState = (rawState) => {
  const state = requireExactKeys(
    rawState,
    ['dumpPath', 'dumpSha256', 'backendProcessName', 'uiProcessName'],
    'legacy PM2 restore state',
  );
  invariant(state.backendProcessName === 'omni-lodge-be', 'Legacy PM2 backend process name is invalid');
  invariant(state.uiProcessName === 'omni-lodge-ui-server', 'Legacy PM2 UI process name is invalid');
  return Object.freeze({
    dumpPath: requireAbsolutePosixPath(state.dumpPath, 'Legacy PM2 dump path'),
    dumpSha256: requireSha256(state.dumpSha256, 'Legacy PM2 dump digest'),
    backendProcessName: state.backendProcessName,
    uiProcessName: state.uiProcessName,
  });
};

const validateSnapshotPredecessor = (rawReference, activationId) => {
  const predecessorSnapshot = validateActivationSnapshotRef(rawReference, 'predecessor activation snapshot');
  invariant(predecessorSnapshot.activationId !== activationId, 'Host activation snapshot cannot name itself as predecessor');
  return predecessorSnapshot;
};

const validateArtifactActivationSnapshot = (rawSnapshot) => {
  const snapshot = requireExactKeys(
    rawSnapshot,
    [
      'schemaVersion',
      'snapshotKind',
      'activationId',
      'releaseId',
      'sourceSha',
      'evidenceSha256',
      'artifactZipSha256',
      'activatedByRequestId',
      'activatedByRequestSha256',
      'activatedAtUtc',
      'backendRestoreTarget',
      'uiRestoreTarget',
      'predecessorSnapshot',
    ],
    'host artifact activation snapshot',
  );
  invariant(snapshot.schemaVersion === HOST_ACTIVATION_SNAPSHOT_SCHEMA_VERSION, 'Host activation snapshot schema version is unsupported');
  invariant(snapshot.snapshotKind === ARTIFACT_SNAPSHOT_KIND, 'Host artifact activation snapshot kind is invalid');
  const activationId = requireUuid(snapshot.activationId, 'Host activation snapshot ID');
  invariant(typeof snapshot.sourceSha === 'string' && SOURCE_SHA_PATTERN.test(snapshot.sourceSha), 'Host activation snapshot source SHA is invalid');
  const releaseId = requireReleaseId(snapshot.releaseId, snapshot.sourceSha, 'Host activation snapshot release ID');
  const releaseRoot = `${RELEASES_ROOT}/${releaseId}`;
  invariant(snapshot.backendRestoreTarget === `${releaseRoot}/be`, 'Host activation snapshot backend restore target is invalid');
  invariant(snapshot.uiRestoreTarget === releaseRoot, 'Host activation snapshot UI restore target is invalid');
  return Object.freeze({
    schemaVersion: HOST_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
    snapshotKind: ARTIFACT_SNAPSHOT_KIND,
    activationId,
    releaseId,
    sourceSha: snapshot.sourceSha,
    evidenceSha256: requireSha256(snapshot.evidenceSha256, 'Host activation snapshot evidence digest'),
    artifactZipSha256: requireSha256(snapshot.artifactZipSha256, 'Host activation snapshot artifact digest'),
    activatedByRequestId: requireUuid(snapshot.activatedByRequestId, 'Host activation snapshot request ID'),
    activatedByRequestSha256: requireSha256(snapshot.activatedByRequestSha256, 'Host activation snapshot request digest'),
    activatedAtUtc: requireUtc(snapshot.activatedAtUtc, 'Host activation snapshot activation time'),
    backendRestoreTarget: snapshot.backendRestoreTarget,
    uiRestoreTarget: snapshot.uiRestoreTarget,
    predecessorSnapshot: validateSnapshotPredecessor(snapshot.predecessorSnapshot, activationId),
  });
};

const validateLegacyBaselineActivationSnapshot = (rawSnapshot) => {
  const snapshot = requireExactKeys(
    rawSnapshot,
    [
      'schemaVersion',
      'snapshotKind',
      'activationId',
      'backendRestoreTarget',
      'uiRestoreTarget',
      'pm2State',
      'capturedAtUtc',
      'capturedBy',
    ],
    'host legacy baseline activation snapshot',
  );
  invariant(snapshot.schemaVersion === HOST_ACTIVATION_SNAPSHOT_SCHEMA_VERSION, 'Host activation snapshot schema version is unsupported');
  invariant(snapshot.snapshotKind === LEGACY_BASELINE_SNAPSHOT_KIND, 'Host legacy baseline activation snapshot kind is invalid');
  return Object.freeze({
    schemaVersion: HOST_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
    snapshotKind: LEGACY_BASELINE_SNAPSHOT_KIND,
    activationId: requireUuid(snapshot.activationId, 'Host activation snapshot ID'),
    backendRestoreTarget: validateBackendBaselineTarget(snapshot.backendRestoreTarget),
    uiRestoreTarget: validateUiBaselineTarget(snapshot.uiRestoreTarget),
    pm2State: validatePm2BaselineState(snapshot.pm2State),
    capturedAtUtc: requireUtc(snapshot.capturedAtUtc, 'Legacy baseline capture time'),
    capturedBy: requireActor(snapshot.capturedBy, 'Legacy baseline capturing actor'),
  });
};

export const validateHostActivationSnapshot = (rawSnapshot) => {
  invariant(isPlainObject(rawSnapshot), 'Host activation snapshot must be a JSON object');
  if (rawSnapshot.snapshotKind === ARTIFACT_SNAPSHOT_KIND) return validateArtifactActivationSnapshot(rawSnapshot);
  if (rawSnapshot.snapshotKind === LEGACY_BASELINE_SNAPSHOT_KIND) return validateLegacyBaselineActivationSnapshot(rawSnapshot);
  throw new Error('Host activation snapshot kind is invalid');
};

export const serializeCanonicalHostActivationSnapshot = (snapshot) => serializeCanonicalHostJson(
  validateHostActivationSnapshot(snapshot),
);

export const parseCanonicalHostActivationSnapshotBytes = (bytes) => validateHostActivationSnapshot(
  parseCanonicalHostJson(bytes, {
    label: 'Host activation snapshot',
    maximumBytes: MAX_HOST_STATE_BYTES,
  }),
);

export const createHostActivationSnapshotReference = (snapshot) => {
  const validated = validateHostActivationSnapshot(snapshot);
  return validateActivationSnapshotRef({
    activationId: validated.activationId,
    snapshotSha256: sha256(serializeCanonicalHostActivationSnapshot(validated)),
  });
};

const sameSnapshotReference = (left, right) => left.activationId === right.activationId
  && left.snapshotSha256 === right.snapshotSha256;

const requireSnapshotReferenceMatch = (snapshot, expectedReference, label) => {
  const validatedSnapshot = validateHostActivationSnapshot(snapshot);
  const actualReference = createHostActivationSnapshotReference(validatedSnapshot);
  const expected = validateActivationSnapshotRef(expectedReference, `${label} expected reference`);
  invariant(sameSnapshotReference(actualReference, expected), `${label} document does not match its stored reference`);
  return Object.freeze({ snapshot: validatedSnapshot, reference: actualReference });
};

const validateStateRequest = (rawRequest) => {
  const request = requireExactKeys(
    rawRequest,
    ['requestId', 'kind', 'requestSha256', 'requestedAtUtc', 'actor'],
    'host request state identity',
  );
  requireUuid(request.requestId, 'Host request state ID');
  invariant(request.kind === 'forward_submit' || request.kind === 'rollback_submit', 'Host request state kind is invalid');
  requireSha256(request.requestSha256, 'Host request state digest');
  requireUtc(request.requestedAtUtc, 'Host request state requested time');
  invariant(typeof request.actor === 'string' && ACTOR_PATTERN.test(request.actor), 'Host request state actor is invalid');
  return Object.freeze({ ...request });
};

const validateStateIntent = (rawIntent, kind) => {
  if (kind === 'forward_submit') {
    const intent = requireExactKeys(
      rawIntent,
      ['operation', 'trigger', 'releaseId', 'sourceSha', 'evidenceSha256', 'artifactZipSha256'],
      'host forward request state intent',
    );
    invariant(new Set(['stage', 'dry-run', 'deploy']).has(intent.operation), 'Host forward request state operation is invalid');
    invariant(new Set(['manual', 'automatic']).has(intent.trigger), 'Host forward request state trigger is invalid');
    invariant(intent.operation === 'deploy' || intent.trigger === 'manual', `Automatic ${intent.operation} operations are not allowed`);
    invariant(typeof intent.sourceSha === 'string' && SOURCE_SHA_PATTERN.test(intent.sourceSha), 'Host forward request state source SHA is invalid');
    requireReleaseId(intent.releaseId, intent.sourceSha, 'Host forward request state release ID');
    return Object.freeze({
      ...intent,
      evidenceSha256: requireSha256(intent.evidenceSha256, 'Host forward request state evidence digest'),
      artifactZipSha256: requireSha256(intent.artifactZipSha256, 'Host forward request state artifact digest'),
    });
  }
  const intent = requireExactKeys(rawIntent, ['trigger', 'expectedActiveSnapshot', 'targetSnapshot'], 'host rollback request state intent');
  invariant(intent.trigger === 'manual', 'Host rollback request state must be manually triggered');
  const expectedActiveSnapshot = validateActivationSnapshotRef(intent.expectedActiveSnapshot, 'expected active snapshot');
  const targetSnapshot = validateActivationSnapshotRef(intent.targetSnapshot, 'rollback target snapshot');
  invariant(expectedActiveSnapshot.activationId !== targetSnapshot.activationId, 'Host rollback request state target must differ from the expected active snapshot');
  return Object.freeze({ trigger: 'manual', expectedActiveSnapshot, targetSnapshot });
};

const pathForState = (state) => {
  const { kind } = state.request;
  if (kind === 'rollback_submit') {
    return new Set([
      'received', 'authorized', 'activation_prepared', 'pointer_switching',
      'pointers_switched', 'smoke_verified', 'restore_required',
      'restoring_previous', 'previous_restored', 'succeeded', 'failed', 'rejected',
    ]);
  }
  if (state.intent.operation === 'deploy') {
    return new Set([
      'received', 'authorized', 'artifact_staged', 'preflight_passed',
      'backup_verified', 'migrations_applied', 'activation_prepared',
      'pointer_switching', 'pointers_switched', 'smoke_verified',
      'restore_required', 'restoring_previous', 'previous_restored',
      'succeeded', 'failed', 'rejected',
    ]);
  }
  return new Set([
    'received', 'authorized', 'artifact_staged', 'preflight_passed',
    'succeeded', 'failed', 'rejected',
  ]);
};

const validateResultForPhase = (kind, phase, resultCode) => {
  if (!TERMINAL_PHASES.has(phase)) {
    invariant(resultCode === null, 'Nonterminal host request state cannot have a result code');
  } else if (phase === 'succeeded') {
    invariant(resultCode === 'REQUEST_SUCCEEDED', 'Successful host request state has an invalid result code');
  } else if (phase === 'failed') {
    invariant(resultCode === 'REQUEST_FAILED', 'Failed host request state has an invalid result code');
  } else {
    invariant(
      typeof resultCode === 'string' && REJECTION_CODES_BY_KIND[kind].has(resultCode),
      `Rejected ${kind} host request state has an invalid result code`,
    );
  }
};

export const validateHostRequestState = (rawState) => {
  const state = requireExactKeys(
    rawState,
    ['schemaVersion', 'request', 'intent', 'phase', 'receivedAtUtc', 'updatedAtUtc', 'resultCode'],
    'host request state',
  );
  invariant(state.schemaVersion === HOST_REQUEST_STATE_SCHEMA_VERSION, 'Host request state schema version is unsupported');
  const request = validateStateRequest(state.request);
  const intent = validateStateIntent(state.intent, request.kind);
  const normalized = { ...state, request, intent };
  invariant(typeof state.phase === 'string' && pathForState(normalized).has(state.phase), 'Host request state phase is invalid for its intent');
  const receivedAtUtc = requireUtc(state.receivedAtUtc, 'Host request state receipt time');
  const updatedAtUtc = requireUtc(state.updatedAtUtc, 'Host request state update time');
  assertNondecreasingTime(receivedAtUtc, updatedAtUtc, 'Host request state update time');
  validateResultForPhase(request.kind, state.phase, state.resultCode);
  return Object.freeze({
    schemaVersion: HOST_REQUEST_STATE_SCHEMA_VERSION,
    request,
    intent,
    phase: state.phase,
    receivedAtUtc,
    updatedAtUtc,
    resultCode: state.resultCode,
  });
};

export const createInitialHostRequestState = ({ requestIdentity, receivedAtUtc }) => {
  const identity = validateHostV2RequestIdentity(requestIdentity);
  invariant(identity.kind !== 'status_query', 'Status queries do not create durable deployment request state');
  const request = {
    requestId: identity.requestId,
    kind: identity.kind,
    requestSha256: identity.requestSha256,
    requestedAtUtc: identity.requestedAtUtc,
    actor: identity.actor,
  };
  const intent = identity.kind === 'forward_submit'
    ? {
      operation: identity.operation,
      trigger: identity.trigger,
      releaseId: identity.releaseId,
      sourceSha: identity.sourceSha,
      evidenceSha256: identity.evidenceSha256,
      artifactZipSha256: identity.artifactZipSha256,
    }
    : {
      trigger: 'manual',
      expectedActiveSnapshot: identity.expectedActiveSnapshot,
      targetSnapshot: identity.targetSnapshot,
    };
  return validateHostRequestState({
    schemaVersion: HOST_REQUEST_STATE_SCHEMA_VERSION,
    request,
    intent,
    phase: 'received',
    receivedAtUtc,
    updatedAtUtc: receivedAtUtc,
    resultCode: null,
  });
};

export const createHostLegacyBaselineActivationSnapshot = ({
  activationId,
  backendRestoreTarget,
  uiRestoreTarget,
  pm2State,
  capturedAtUtc,
  capturedBy,
}) => validateHostActivationSnapshot({
  schemaVersion: HOST_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
  snapshotKind: LEGACY_BASELINE_SNAPSHOT_KIND,
  activationId,
  backendRestoreTarget,
  uiRestoreTarget,
  pm2State,
  capturedAtUtc,
  capturedBy,
});

export const createHostArtifactActivationSnapshot = ({
  requestState: rawRequestState,
  activationId,
  activatedAtUtc,
  predecessorSnapshot,
}) => {
  const requestState = validateHostRequestState(rawRequestState);
  invariant(requestState.request.kind === 'forward_submit', 'Only a forward request can create an artifact activation snapshot');
  invariant(requestState.intent.operation === 'deploy', 'Only a deploy request can create an artifact activation snapshot');
  invariant(requestState.phase === 'activation_prepared', 'Artifact activation snapshot requires an activation-prepared request');
  const predecessor = validateHostActivationSnapshot(predecessorSnapshot);
  const timestamp = requireUtc(activatedAtUtc, 'Host activation snapshot activation time');
  assertNondecreasingTime(requestState.updatedAtUtc, timestamp, 'Host activation snapshot activation time');
  const releaseRoot = `${RELEASES_ROOT}/${requestState.intent.releaseId}`;
  return validateHostActivationSnapshot({
    schemaVersion: HOST_ACTIVATION_SNAPSHOT_SCHEMA_VERSION,
    snapshotKind: ARTIFACT_SNAPSHOT_KIND,
    activationId,
    releaseId: requestState.intent.releaseId,
    sourceSha: requestState.intent.sourceSha,
    evidenceSha256: requestState.intent.evidenceSha256,
    artifactZipSha256: requestState.intent.artifactZipSha256,
    activatedByRequestId: requestState.request.requestId,
    activatedByRequestSha256: requestState.request.requestSha256,
    activatedAtUtc: timestamp,
    backendRestoreTarget: `${releaseRoot}/be`,
    uiRestoreTarget: releaseRoot,
    predecessorSnapshot: createHostActivationSnapshotReference(predecessor),
  });
};

const normalNextPhase = (state) => {
  if (state.phase === 'received') return 'authorized';
  if (state.phase === 'authorized') return state.request.kind === 'forward_submit' ? 'artifact_staged' : 'activation_prepared';
  if (state.phase === 'artifact_staged') return 'preflight_passed';
  if (state.phase === 'preflight_passed') return state.intent.operation === 'deploy' ? 'backup_verified' : 'succeeded';
  if (state.phase === 'backup_verified') return 'migrations_applied';
  if (state.phase === 'migrations_applied') return 'activation_prepared';
  if (state.phase === 'activation_prepared') return 'pointer_switching';
  if (state.phase === 'pointer_switching') return 'pointers_switched';
  if (state.phase === 'pointers_switched') return 'smoke_verified';
  if (state.phase === 'smoke_verified') return 'succeeded';
  if (state.phase === 'restore_required') return 'restoring_previous';
  if (state.phase === 'restoring_previous') return 'previous_restored';
  if (state.phase === 'previous_restored') return 'failed';
  return null;
};

const canFailDirectly = (phase) => !new Set([
  'pointer_switching',
  'pointers_switched',
  'smoke_verified',
  'restore_required',
  'restoring_previous',
  'previous_restored',
]).has(phase);

export const transitionHostRequestState = ({ state: rawState, nextPhase, updatedAtUtc, resultCode = null }) => {
  const state = validateHostRequestState(rawState);
  invariant(!TERMINAL_PHASES.has(state.phase), 'Terminal host request state cannot transition');
  const allowed = new Set([normalNextPhase(state)]);
  if (state.phase === 'received' || state.phase === 'authorized') allowed.add('rejected');
  if (canFailDirectly(state.phase)) allowed.add('failed');
  if (state.phase === 'pointer_switching' || state.phase === 'pointers_switched' || state.phase === 'smoke_verified') {
    allowed.add('restore_required');
  }
  invariant(allowed.has(nextPhase), `Illegal host request state transition from ${state.phase} to ${nextPhase}`);
  const timestamp = requireUtc(updatedAtUtc, 'Host request state transition time');
  assertNondecreasingTime(state.updatedAtUtc, timestamp, 'Host request state transition time');
  const effectiveResultCode = nextPhase === 'succeeded'
    ? 'REQUEST_SUCCEEDED'
    : nextPhase === 'failed'
      ? 'REQUEST_FAILED'
      : resultCode;
  return validateHostRequestState({
    ...state,
    phase: nextPhase,
    updatedAtUtc: timestamp,
    resultCode: effectiveResultCode,
  });
};

export const serializeCanonicalHostRequestState = (state) => serializeCanonicalHostJson(
  validateHostRequestState(state),
);

export const parseCanonicalHostRequestStateBytes = (bytes) => validateHostRequestState(
  parseCanonicalHostJson(bytes, { label: 'Host request state', maximumBytes: MAX_HOST_STATE_BYTES }),
);

export const createHostRequestStatus = (rawState) => {
  const state = validateHostRequestState(rawState);
  const lifecycle = state.phase === 'succeeded'
    ? 'succeeded'
    : state.phase === 'failed'
      ? 'failed'
      : state.phase === 'rejected'
        ? 'rejected'
        : state.phase === 'received'
          ? 'accepted'
          : 'running';
  return validateHostV2RequestStatus({
    requestId: state.request.requestId,
    kind: state.request.kind,
    lifecycle,
    phase: state.phase,
    resultCode: state.resultCode,
    updatedAtUtc: state.updatedAtUtc,
  });
};

export const validateHostActivationTransaction = (rawTransaction) => {
  const transaction = requireExactKeys(
    rawTransaction,
    [
      'schemaVersion',
      'requestId',
      'requestKind',
      'requestSha256',
      'phase',
      'previousSnapshot',
      'targetSnapshot',
      'createdAtUtc',
      'updatedAtUtc',
    ],
    'host activation transaction',
  );
  invariant(transaction.schemaVersion === HOST_ACTIVATION_TRANSACTION_SCHEMA_VERSION, 'Host activation transaction schema version is unsupported');
  requireUuid(transaction.requestId, 'Host activation transaction request ID');
  invariant(transaction.requestKind === 'forward_submit' || transaction.requestKind === 'rollback_submit', 'Host activation transaction request kind is invalid');
  requireSha256(transaction.requestSha256, 'Host activation transaction request digest');
  invariant(typeof transaction.phase === 'string' && ACTIVATION_TRANSACTION_PHASES.has(transaction.phase), 'Host activation transaction phase is invalid');
  const previousSnapshot = validateActivationSnapshotRef(transaction.previousSnapshot, 'previous activation snapshot');
  const targetSnapshot = validateActivationSnapshotRef(transaction.targetSnapshot, 'target activation snapshot');
  invariant(previousSnapshot.activationId !== targetSnapshot.activationId, 'Host activation transaction snapshots must differ');
  const createdAtUtc = requireUtc(transaction.createdAtUtc, 'Host activation transaction creation time');
  const updatedAtUtc = requireUtc(transaction.updatedAtUtc, 'Host activation transaction update time');
  assertNondecreasingTime(createdAtUtc, updatedAtUtc, 'Host activation transaction update time');
  return Object.freeze({
    schemaVersion: HOST_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    requestId: transaction.requestId,
    requestKind: transaction.requestKind,
    requestSha256: transaction.requestSha256,
    phase: transaction.phase,
    previousSnapshot,
    targetSnapshot,
    createdAtUtc,
    updatedAtUtc,
  });
};

const requireArtifactSnapshotBoundToRequest = (snapshot, requestState) => {
  invariant(snapshot.snapshotKind === ARTIFACT_SNAPSHOT_KIND, 'Forward activation target must be an artifact release snapshot');
  invariant(snapshot.releaseId === requestState.intent.releaseId, 'Artifact activation snapshot release does not match its request');
  invariant(snapshot.sourceSha === requestState.intent.sourceSha, 'Artifact activation snapshot source does not match its request');
  invariant(snapshot.evidenceSha256 === requestState.intent.evidenceSha256, 'Artifact activation snapshot evidence does not match its request');
  invariant(snapshot.artifactZipSha256 === requestState.intent.artifactZipSha256, 'Artifact activation snapshot artifact does not match its request');
  invariant(snapshot.activatedByRequestId === requestState.request.requestId, 'Artifact activation snapshot request ID does not match its request');
  invariant(snapshot.activatedByRequestSha256 === requestState.request.requestSha256, 'Artifact activation snapshot request digest does not match its request');
};

export const validateHostActivationTransactionBinding = ({
  transaction: rawTransaction,
  requestState: rawRequestState,
  previousSnapshot: rawPreviousSnapshot,
  targetSnapshot: rawTargetSnapshot,
}) => {
  const transaction = validateHostActivationTransaction(rawTransaction);
  const requestState = validateHostRequestState(rawRequestState);
  invariant(transaction.requestId === requestState.request.requestId, 'Host activation transaction request ID does not match durable request state');
  invariant(transaction.requestSha256 === requestState.request.requestSha256, 'Host activation transaction request digest does not match durable request state');
  invariant(transaction.requestKind === requestState.request.kind, 'Host activation transaction request kind does not match durable request state');

  const previous = requireSnapshotReferenceMatch(
    rawPreviousSnapshot,
    transaction.previousSnapshot,
    'Previous activation snapshot',
  );
  const target = requireSnapshotReferenceMatch(
    rawTargetSnapshot,
    transaction.targetSnapshot,
    'Target activation snapshot',
  );
  invariant(previous.reference.activationId !== target.reference.activationId, 'Host activation transaction snapshots must differ');

  if (requestState.request.kind === 'forward_submit') {
    invariant(requestState.intent.operation === 'deploy', 'Only a deploy request can bind an activation transaction');
    requireArtifactSnapshotBoundToRequest(target.snapshot, requestState);
    invariant(
      sameSnapshotReference(target.snapshot.predecessorSnapshot, previous.reference),
      'Artifact activation snapshot predecessor does not match the transaction previous snapshot',
    );
  } else {
    invariant(
      sameSnapshotReference(previous.reference, requestState.intent.expectedActiveSnapshot),
      'Rollback transaction previous snapshot does not match its durable request',
    );
    invariant(
      sameSnapshotReference(target.reference, requestState.intent.targetSnapshot),
      'Rollback transaction target snapshot does not match its durable request',
    );
  }

  return Object.freeze({
    transaction,
    requestState,
    previousSnapshot: previous.snapshot,
    targetSnapshot: target.snapshot,
  });
};

export const createHostActivationTransaction = ({
  requestState: rawRequestState,
  previousSnapshot,
  targetSnapshot,
  createdAtUtc,
}) => {
  const requestState = validateHostRequestState(rawRequestState);
  invariant(
    requestState.request.kind === 'rollback_submit' || requestState.intent.operation === 'deploy',
    'Only deploy and rollback requests can create activation transactions',
  );
  invariant(requestState.phase === 'activation_prepared', 'Activation transaction requires an activation-prepared request');
  const previous = validateHostActivationSnapshot(previousSnapshot);
  const target = validateHostActivationSnapshot(targetSnapshot);
  const timestamp = requireUtc(createdAtUtc, 'Host activation transaction creation time');
  assertNondecreasingTime(requestState.updatedAtUtc, timestamp, 'Host activation transaction creation time');
  if (target.snapshotKind === ARTIFACT_SNAPSHOT_KIND && target.activatedByRequestId === requestState.request.requestId) {
    assertNondecreasingTime(target.activatedAtUtc, timestamp, 'Host activation transaction creation time');
  }
  const transaction = validateHostActivationTransaction({
    schemaVersion: HOST_ACTIVATION_TRANSACTION_SCHEMA_VERSION,
    requestId: requestState.request.requestId,
    requestKind: requestState.request.kind,
    requestSha256: requestState.request.requestSha256,
    phase: 'prepared',
    previousSnapshot: createHostActivationSnapshotReference(previous),
    targetSnapshot: createHostActivationSnapshotReference(target),
    createdAtUtc: timestamp,
    updatedAtUtc: timestamp,
  });
  return validateHostActivationTransactionBinding({
    transaction,
    requestState,
    previousSnapshot: previous,
    targetSnapshot: target,
  }).transaction;
};

const activationNext = Object.freeze({
  prepared: new Set(['pointer_switching', 'failed']),
  pointer_switching: new Set(['pointers_switched', 'restore_required']),
  pointers_switched: new Set(['smoke_verified', 'restore_required']),
  smoke_verified: new Set(['committed', 'restore_required']),
  restore_required: new Set(['restoring_previous']),
  restoring_previous: new Set(['previous_restored']),
  previous_restored: new Set(['failed']),
  committed: new Set(),
  failed: new Set(),
});

export const transitionHostActivationTransaction = ({
  transaction: rawTransaction,
  requestState,
  previousSnapshot,
  targetSnapshot,
  nextPhase,
  updatedAtUtc,
}) => {
  const binding = validateHostActivationTransactionBinding({
    transaction: rawTransaction,
    requestState,
    previousSnapshot,
    targetSnapshot,
  });
  const { transaction } = binding;
  invariant(activationNext[transaction.phase].has(nextPhase), `Illegal host activation transition from ${transaction.phase} to ${nextPhase}`);
  if (nextPhase === 'committed') {
    invariant(binding.requestState.phase === 'smoke_verified', 'Committing an activation requires smoke-verified durable request state');
  }
  const timestamp = requireUtc(updatedAtUtc, 'Host activation transaction transition time');
  assertNondecreasingTime(transaction.updatedAtUtc, timestamp, 'Host activation transaction transition time');
  return validateHostActivationTransaction({ ...transaction, phase: nextPhase, updatedAtUtc: timestamp });
};

export const serializeCanonicalHostActivationTransaction = (transaction) => serializeCanonicalHostJson(
  validateHostActivationTransaction(transaction),
);

export const parseCanonicalHostActivationTransactionBytes = (bytes) => validateHostActivationTransaction(
  parseCanonicalHostJson(bytes, { label: 'Host activation transaction', maximumBytes: MAX_HOST_STATE_BYTES }),
);

export const planHostActivationRecovery = ({
  transaction: rawTransaction,
  requestState,
  previousSnapshot,
  targetSnapshot,
}) => {
  const binding = validateHostActivationTransactionBinding({
    transaction: rawTransaction,
    requestState,
    previousSnapshot,
    targetSnapshot,
  });
  const { transaction } = binding;
  const actionByPhase = {
    prepared: 'abort_without_pointer_change',
    pointer_switching: 'converge_previous_snapshot',
    pointers_switched: 'converge_previous_snapshot',
    smoke_verified: 'commit_target_snapshot',
    restore_required: 'converge_previous_snapshot',
    restoring_previous: 'converge_previous_snapshot',
    previous_restored: 'mark_request_failed',
    committed: 'none',
    failed: 'none',
  };
  return Object.freeze({
    action: actionByPhase[transaction.phase],
    databaseAction: 'none',
    requestId: transaction.requestId,
    previousSnapshotReference: transaction.previousSnapshot,
    targetSnapshotReference: transaction.targetSnapshot,
    previousSnapshot: binding.previousSnapshot,
    targetSnapshot: binding.targetSnapshot,
  });
};
