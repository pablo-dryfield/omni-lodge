import { createHash } from 'node:crypto';

import { RELEASE_LIMITS } from '../../release/lib.mjs';
import { inspectCanonicalEvidenceBytes, parseCanonicalHostJson, serializeCanonicalHostJson } from './protocol.mjs';

export const HOST_PROTOCOL_V2 = 2;
export const HOST_V2_REQUEST_SCHEMA_VERSION = 2;
export const HOST_V2_RESPONSE_SCHEMA_VERSION = 2;
export const HOST_V2_REQUEST_HEADER_BYTES = 32;
export const HOST_V2_RESPONSE_HEADER_BYTES = 16;
export const MAX_HOST_V2_REQUEST_BYTES = 16 * 1024;
export const MAX_HOST_V2_EVIDENCE_BYTES = 64 * 1024;
export const MAX_HOST_V2_ARTIFACT_BYTES = RELEASE_LIMITS.maxCompressedArchiveBytes
  + (64 * 1024 * 1024);
export const MAX_HOST_V2_RESPONSE_BYTES = 16 * 1024;
export const HOST_REQUEST_MAX_PAST_MS = 5 * 60 * 1000;
export const HOST_REQUEST_MAX_FUTURE_MS = 60 * 1000;

const REQUEST_MAGIC = Buffer.from('OMNIHRQ2', 'ascii');
const RESPONSE_MAGIC = Buffer.from('OMNIHRS2', 'ascii');
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_ID_PATTERN = /^omnilodge-r([1-9][0-9]*)-a([1-9][0-9]*)-([0-9a-f]{12})$/;
const MAX_SAFE_INTEGER_DECIMAL_DIGITS = String(Number.MAX_SAFE_INTEGER).length;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+\[\]-]{0,127}$/;
const FORWARD_OPERATIONS = new Set(['stage', 'dry-run', 'deploy']);
const TRIGGERS = new Set(['manual', 'automatic']);
const REQUEST_KINDS = new Set(['forward_submit', 'rollback_submit', 'status_query']);
const LIFECYCLES = new Set(['accepted', 'running', 'succeeded', 'failed', 'rejected']);
const STATUS_PHASES = new Set([
  'received',
  'authorized',
  'artifact_staged',
  'preflight_passed',
  'backup_verified',
  'migrations_applied',
  'activation_prepared',
  'pointer_switching',
  'pointers_switched',
  'smoke_verified',
  'restore_required',
  'restoring_previous',
  'previous_restored',
  'succeeded',
  'failed',
  'rejected',
]);
const TERMINAL_RESULT_CODES_BY_KIND = Object.freeze({
  forward_submit: new Set([
    'REQUEST_SUCCEEDED',
    'POLICY_DENIED',
    'REQUEST_REJECTED',
    'REQUEST_FAILED',
    'REQUEST_TIMESTAMP_REJECTED',
    'REPLAY_REJECTED',
  ]),
  rollback_submit: new Set([
    'REQUEST_SUCCEEDED',
    'REQUEST_REJECTED',
    'REQUEST_FAILED',
    'REQUEST_TIMESTAMP_REJECTED',
    'REPLAY_REJECTED',
    'ROLLBACK_TARGET_UNAVAILABLE',
    'STALE_ACTIVE_SNAPSHOT',
  ]),
});
const RESPONSE_CODES_BY_KIND = Object.freeze({
  forward_submit: new Set([
    'REQUEST_ACCEPTED',
    'POLICY_DENIED',
    'REQUEST_REJECTED',
    'HOST_BUSY',
    'REQUEST_TIMESTAMP_REJECTED',
    'REPLAY_REJECTED',
    'REQUEST_SUCCEEDED',
    'REQUEST_FAILED',
  ]),
  rollback_submit: new Set([
    'REQUEST_ACCEPTED',
    'REQUEST_REJECTED',
    'HOST_BUSY',
    'REQUEST_TIMESTAMP_REJECTED',
    'REPLAY_REJECTED',
    'ROLLBACK_TARGET_UNAVAILABLE',
    'STALE_ACTIVE_SNAPSHOT',
    'REQUEST_SUCCEEDED',
    'REQUEST_FAILED',
  ]),
  status_query: new Set([
    'REQUEST_REJECTED',
    'HOST_BUSY',
    'REQUEST_TIMESTAMP_REJECTED',
    'REPLAY_REJECTED',
    'REQUEST_FAILED',
    'STATUS_FOUND',
    'STATUS_NOT_FOUND',
  ]),
});
const VALIDATED_METADATA = new WeakSet();

export const HOST_V2_RESPONSE_CODE_DEFINITIONS = Object.freeze({
  REQUEST_ACCEPTED: Object.freeze({ status: 'accepted', message: 'The host accepted the request.' }),
  POLICY_DENIED: Object.freeze({ status: 'rejected', message: 'The host policy does not authorize this request.' }),
  REQUEST_REJECTED: Object.freeze({ status: 'rejected', message: 'The host rejected the request.' }),
  HOST_BUSY: Object.freeze({ status: 'rejected', message: 'The host is already processing another deployment request.' }),
  REQUEST_TIMESTAMP_REJECTED: Object.freeze({ status: 'rejected', message: 'The host rejected the request timestamp.' }),
  REPLAY_REJECTED: Object.freeze({ status: 'rejected', message: 'The host rejected a replayed request.' }),
  ROLLBACK_TARGET_UNAVAILABLE: Object.freeze({ status: 'rejected', message: 'The requested rollback target is unavailable.' }),
  STALE_ACTIVE_SNAPSHOT: Object.freeze({ status: 'rejected', message: 'The active release changed before this request was processed.' }),
  REQUEST_SUCCEEDED: Object.freeze({ status: 'succeeded', message: 'The host completed the request.' }),
  REQUEST_FAILED: Object.freeze({ status: 'failed', message: 'The host could not complete the request.' }),
  STATUS_FOUND: Object.freeze({ status: 'succeeded', message: 'The host returned the request status.' }),
  STATUS_NOT_FOUND: Object.freeze({ status: 'succeeded', message: 'The requested status record was not found.' }),
});

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

const requireBuffer = (value, label) => {
  invariant(Buffer.isBuffer(value), `${label} must be a Buffer`);
  invariant(value.buffer instanceof ArrayBuffer, `${label} must not use shared memory`);
  return value;
};

const requireLength = (value, minimum, maximum, label) => {
  invariant(Number.isSafeInteger(value), `${label} must be a safe integer`);
  invariant(value >= minimum, `${label} is below the minimum`);
  invariant(value <= maximum, `${label} exceeds the limit`);
  return value;
};

const requireRequestId = (value, label) => {
  invariant(typeof value === 'string' && REQUEST_ID_PATTERN.test(value), `${label} must be a canonical lowercase UUID v4`);
  return value;
};

const requireSha256 = (value, label) => {
  invariant(typeof value === 'string' && SHA256_PATTERN.test(value), `${label} must be a lowercase SHA-256 digest`);
  return value;
};

const requireCanonicalUtc = (value, label) => {
  invariant(typeof value === 'string', `${label} must be text`);
  const parsed = new Date(value);
  invariant(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return value;
};

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

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const validateActivationSnapshotRef = (rawReference, label = 'activation snapshot reference') => {
  const reference = requireExactKeys(rawReference, ['activationId', 'snapshotSha256'], label);
  return Object.freeze({
    activationId: requireRequestId(reference.activationId, `${label} activation ID`),
    snapshotSha256: requireSha256(reference.snapshotSha256, `${label} digest`),
  });
};

export const validateHostV2RequestDocument = (rawRequest) => {
  const request = requireExactKeys(
    rawRequest,
    ['schemaVersion', 'requestId', 'requestedAtUtc', 'actor', 'kind', 'payload'],
    'host v2 request',
  );
  invariant(request.schemaVersion === HOST_V2_REQUEST_SCHEMA_VERSION, 'Host v2 request schema version is unsupported');
  const requestId = requireRequestId(request.requestId, 'Host v2 request ID');
  const requestedAtUtc = requireCanonicalUtc(request.requestedAtUtc, 'Host v2 request timestamp');
  invariant(typeof request.actor === 'string' && ACTOR_PATTERN.test(request.actor), 'Host v2 request actor is invalid');
  invariant(typeof request.kind === 'string' && REQUEST_KINDS.has(request.kind), 'Host v2 request kind is invalid');

  let payload;
  if (request.kind === 'forward_submit') {
    const rawPayload = requireExactKeys(
      request.payload,
      ['operation', 'trigger', 'evidenceSha256', 'artifactZipSha256'],
      'host v2 forward payload',
    );
    invariant(typeof rawPayload.operation === 'string' && FORWARD_OPERATIONS.has(rawPayload.operation), 'Host v2 forward operation is invalid');
    invariant(typeof rawPayload.trigger === 'string' && TRIGGERS.has(rawPayload.trigger), 'Host v2 forward trigger is invalid');
    invariant(rawPayload.operation === 'deploy' || rawPayload.trigger === 'manual', `Automatic ${rawPayload.operation} operations are not allowed`);
    payload = Object.freeze({
      operation: rawPayload.operation,
      trigger: rawPayload.trigger,
      evidenceSha256: requireSha256(rawPayload.evidenceSha256, 'Host v2 evidence digest'),
      artifactZipSha256: requireSha256(rawPayload.artifactZipSha256, 'Host v2 artifact digest'),
    });
  } else if (request.kind === 'rollback_submit') {
    const rawPayload = requireExactKeys(
      request.payload,
      ['trigger', 'expectedActiveSnapshot', 'targetSnapshot'],
      'host v2 rollback payload',
    );
    invariant(rawPayload.trigger === 'manual', 'Host v2 rollback must be manually triggered');
    const expectedActiveSnapshot = validateActivationSnapshotRef(rawPayload.expectedActiveSnapshot, 'expected active snapshot');
    const targetSnapshot = validateActivationSnapshotRef(rawPayload.targetSnapshot, 'rollback target snapshot');
    invariant(expectedActiveSnapshot.activationId !== targetSnapshot.activationId, 'Host v2 rollback target must differ from the expected active snapshot');
    payload = Object.freeze({ trigger: 'manual', expectedActiveSnapshot, targetSnapshot });
  } else {
    const rawPayload = requireExactKeys(request.payload, ['subjectRequestId'], 'host v2 status payload');
    payload = Object.freeze({
      subjectRequestId: requireRequestId(rawPayload.subjectRequestId, 'Host v2 status subject request ID'),
    });
  }

  return Object.freeze({
    schemaVersion: HOST_V2_REQUEST_SCHEMA_VERSION,
    requestId,
    requestedAtUtc,
    actor: request.actor,
    kind: request.kind,
    payload,
  });
};

export const parseCanonicalHostV2RequestBytes = (bytes) => validateHostV2RequestDocument(
  parseCanonicalHostJson(bytes, {
    label: 'Host v2 request',
    maximumBytes: MAX_HOST_V2_REQUEST_BYTES,
  }),
);

export const serializeCanonicalHostV2Request = (request) => serializeCanonicalHostJson(
  validateHostV2RequestDocument(request),
);

const identityKeys = Object.freeze({
  forward_submit: Object.freeze([
    'requestId', 'kind', 'requestSha256', 'requestedAtUtc', 'actor', 'releaseId', 'sourceSha',
    'operation', 'trigger', 'evidenceSha256', 'artifactZipSha256',
  ]),
  rollback_submit: Object.freeze([
    'requestId', 'kind', 'requestSha256', 'requestedAtUtc', 'actor', 'trigger',
    'expectedActiveSnapshot', 'targetSnapshot',
  ]),
  status_query: Object.freeze([
    'requestId', 'kind', 'requestSha256', 'requestedAtUtc', 'actor', 'subjectRequestId',
  ]),
});

export const validateHostV2RequestIdentity = (rawIdentity) => {
  invariant(isPlainObject(rawIdentity), 'Host v2 request identity must be a JSON object');
  invariant(typeof rawIdentity.kind === 'string' && REQUEST_KINDS.has(rawIdentity.kind), 'Host v2 request identity kind is invalid');
  const identity = requireExactKeys(rawIdentity, identityKeys[rawIdentity.kind], 'host v2 request identity');
  const common = {
    requestId: requireRequestId(identity.requestId, 'Host v2 request identity ID'),
    kind: identity.kind,
    requestSha256: requireSha256(identity.requestSha256, 'Host v2 request identity digest'),
    requestedAtUtc: requireCanonicalUtc(identity.requestedAtUtc, 'Host v2 request identity timestamp'),
    actor: identity.actor,
  };
  invariant(typeof common.actor === 'string' && ACTOR_PATTERN.test(common.actor), 'Host v2 request identity actor is invalid');

  if (identity.kind === 'forward_submit') {
    invariant(typeof identity.sourceSha === 'string' && SOURCE_SHA_PATTERN.test(identity.sourceSha), 'Host v2 request identity source SHA is invalid');
    invariant(typeof identity.operation === 'string' && FORWARD_OPERATIONS.has(identity.operation), 'Host v2 request identity operation is invalid');
    invariant(typeof identity.trigger === 'string' && TRIGGERS.has(identity.trigger), 'Host v2 request identity trigger is invalid');
    invariant(identity.operation === 'deploy' || identity.trigger === 'manual', `Automatic ${identity.operation} operations are not allowed`);
    return Object.freeze({
      ...common,
      releaseId: requireReleaseId(identity.releaseId, identity.sourceSha, 'Host v2 request identity release ID'),
      sourceSha: identity.sourceSha,
      operation: identity.operation,
      trigger: identity.trigger,
      evidenceSha256: requireSha256(identity.evidenceSha256, 'Host v2 request identity evidence digest'),
      artifactZipSha256: requireSha256(identity.artifactZipSha256, 'Host v2 request identity artifact digest'),
    });
  }
  if (identity.kind === 'rollback_submit') {
    invariant(identity.trigger === 'manual', 'Host v2 rollback identity must be manually triggered');
    const expectedActiveSnapshot = validateActivationSnapshotRef(identity.expectedActiveSnapshot, 'expected active snapshot');
    const targetSnapshot = validateActivationSnapshotRef(identity.targetSnapshot, 'rollback target snapshot');
    invariant(expectedActiveSnapshot.activationId !== targetSnapshot.activationId, 'Host v2 rollback target must differ from the expected active snapshot');
    return Object.freeze({ ...common, trigger: 'manual', expectedActiveSnapshot, targetSnapshot });
  }
  return Object.freeze({
    ...common,
    subjectRequestId: requireRequestId(identity.subjectRequestId, 'Host v2 status subject request ID'),
  });
};

const validateHeader = ({ header, magic, bytes, label }) => {
  const input = requireBuffer(header, `${label} header`);
  invariant(input.length === bytes, `${label} header has an invalid length`);
  invariant(input.subarray(0, 8).equals(magic), `${label} magic is invalid`);
  invariant(input.readUInt16BE(8) === HOST_PROTOCOL_V2, `${label} protocol version is unsupported`);
  invariant(input.readUInt16BE(10) === bytes, `${label} header size is invalid`);
  return input;
};

export const createHostV2RequestHeader = ({ requestLength, evidenceLength, artifactZipLength }) => {
  requireLength(requestLength, 1, MAX_HOST_V2_REQUEST_BYTES, 'Host v2 request length');
  requireLength(evidenceLength, 0, MAX_HOST_V2_EVIDENCE_BYTES, 'Host v2 evidence length');
  requireLength(artifactZipLength, 0, MAX_HOST_V2_ARTIFACT_BYTES, 'Host v2 artifact ZIP length');
  const header = Buffer.alloc(HOST_V2_REQUEST_HEADER_BYTES);
  REQUEST_MAGIC.copy(header, 0);
  header.writeUInt16BE(HOST_PROTOCOL_V2, 8);
  header.writeUInt16BE(HOST_V2_REQUEST_HEADER_BYTES, 10);
  header.writeUInt32BE(requestLength, 12);
  header.writeUInt32BE(evidenceLength, 16);
  header.writeBigUInt64BE(BigInt(artifactZipLength), 20);
  header.writeUInt32BE(0, 28);
  return header;
};

export const parseHostV2RequestHeader = (header) => {
  const input = validateHeader({ header, magic: REQUEST_MAGIC, bytes: HOST_V2_REQUEST_HEADER_BYTES, label: 'Host v2 request' });
  const requestLength = input.readUInt32BE(12);
  const evidenceLength = input.readUInt32BE(16);
  const rawArtifactLength = input.readBigUInt64BE(20);
  invariant(rawArtifactLength <= BigInt(Number.MAX_SAFE_INTEGER), 'Host v2 artifact ZIP length exceeds the safe integer range');
  const artifactZipLength = Number(rawArtifactLength);
  invariant(input.readUInt32BE(28) === 0, 'Host v2 request reserved header field must be zero');
  requireLength(requestLength, 1, MAX_HOST_V2_REQUEST_BYTES, 'Host v2 request length');
  requireLength(evidenceLength, 0, MAX_HOST_V2_EVIDENCE_BYTES, 'Host v2 evidence length');
  requireLength(artifactZipLength, 0, MAX_HOST_V2_ARTIFACT_BYTES, 'Host v2 artifact ZIP length');
  const total = BigInt(HOST_V2_REQUEST_HEADER_BYTES) + BigInt(requestLength) + BigInt(evidenceLength) + BigInt(artifactZipLength);
  invariant(total <= BigInt(Number.MAX_SAFE_INTEGER), 'Host v2 request frame length exceeds the safe integer range');
  return Object.freeze({
    protocolVersion: HOST_PROTOCOL_V2,
    headerLength: HOST_V2_REQUEST_HEADER_BYTES,
    requestLength,
    evidenceLength,
    artifactZipLength,
    totalLength: Number(total),
  });
};

const requirePayloadShapeForLengths = ({ request, evidenceLength, artifactZipLength }) => {
  if (request.kind === 'forward_submit') {
    invariant(evidenceLength > 0, 'Host v2 forward request requires release evidence');
    invariant(artifactZipLength > 0, 'Host v2 forward request requires an artifact ZIP');
  } else {
    invariant(evidenceLength === 0, `Host v2 ${request.kind} must not carry release evidence`);
    invariant(artifactZipLength === 0, `Host v2 ${request.kind} must not carry an artifact ZIP`);
  }
};

export const inspectHostV2RequestMetadata = ({ requestBytes, evidenceBytes, artifactZipLength }) => {
  const requestInput = requireBuffer(requestBytes, 'Host v2 request');
  const evidenceInput = requireBuffer(evidenceBytes, 'Host v2 evidence');
  requireLength(artifactZipLength, 0, MAX_HOST_V2_ARTIFACT_BYTES, 'Host v2 artifact ZIP length');
  const request = parseCanonicalHostV2RequestBytes(requestInput);
  requirePayloadShapeForLengths({ request, evidenceLength: evidenceInput.length, artifactZipLength });
  const requestSha256 = sha256(requestInput);
  let evidence = null;
  let identity;

  if (request.kind === 'forward_submit') {
    evidence = inspectCanonicalEvidenceBytes(evidenceInput);
    const evidenceSha256 = sha256(evidenceInput);
    invariant(request.payload.operation === evidence.operation.name, 'Host v2 operation does not match release evidence');
    invariant(request.payload.trigger === evidence.operation.trigger, 'Host v2 trigger does not match release evidence');
    invariant(request.payload.evidenceSha256 === evidenceSha256, 'Host v2 evidence digest does not match release evidence');
    invariant(request.payload.artifactZipSha256 === evidence.artifactZipSha256, 'Host v2 artifact digest does not match release evidence');
    identity = {
      requestId: request.requestId,
      kind: request.kind,
      requestSha256,
      requestedAtUtc: request.requestedAtUtc,
      actor: request.actor,
      releaseId: evidence.releaseId,
      sourceSha: evidence.sourceSha,
      operation: request.payload.operation,
      trigger: request.payload.trigger,
      evidenceSha256,
      artifactZipSha256: request.payload.artifactZipSha256,
    };
  } else if (request.kind === 'rollback_submit') {
    identity = {
      requestId: request.requestId,
      kind: request.kind,
      requestSha256,
      requestedAtUtc: request.requestedAtUtc,
      actor: request.actor,
      trigger: 'manual',
      expectedActiveSnapshot: request.payload.expectedActiveSnapshot,
      targetSnapshot: request.payload.targetSnapshot,
    };
  } else {
    identity = {
      requestId: request.requestId,
      kind: request.kind,
      requestSha256,
      requestedAtUtc: request.requestedAtUtc,
      actor: request.actor,
      subjectRequestId: request.payload.subjectRequestId,
    };
  }

  const metadata = Object.freeze({
    request,
    evidence,
    requestSha256,
    expectedArtifactZipSha256: request.kind === 'forward_submit'
      ? request.payload.artifactZipSha256
      : null,
    identity: validateHostV2RequestIdentity(identity),
  });
  VALIDATED_METADATA.add(metadata);
  return metadata;
};

export const finalizeHostV2RequestMetadata = ({ metadata, artifactZipSha256 = null }) => {
  invariant(metadata !== null && typeof metadata === 'object' && VALIDATED_METADATA.has(metadata), 'Host v2 request metadata was not produced by the canonical inspector');
  if (metadata.request.kind === 'forward_submit') {
    invariant(requireSha256(artifactZipSha256, 'Calculated host v2 artifact digest') === metadata.expectedArtifactZipSha256, 'Host v2 artifact digest does not match the raw ZIP');
  } else {
    invariant(artifactZipSha256 === null, `Host v2 ${metadata.request.kind} cannot finalize with an artifact digest`);
  }
  return metadata.identity;
};

export const encodeHostV2RequestFrame = ({ requestBytes, evidenceBytes = Buffer.alloc(0), artifactZipBytes = Buffer.alloc(0) }) => {
  const request = requireBuffer(requestBytes, 'Host v2 request');
  const evidence = requireBuffer(evidenceBytes, 'Host v2 evidence');
  const artifact = requireBuffer(artifactZipBytes, 'Host v2 artifact ZIP');
  const metadata = inspectHostV2RequestMetadata({ requestBytes: request, evidenceBytes: evidence, artifactZipLength: artifact.length });
  finalizeHostV2RequestMetadata({ metadata, artifactZipSha256: metadata.request.kind === 'forward_submit' ? sha256(artifact) : null });
  const header = createHostV2RequestHeader({ requestLength: request.length, evidenceLength: evidence.length, artifactZipLength: artifact.length });
  return Buffer.concat([header, request, evidence, artifact]);
};

export const decodeHostV2RequestFrame = (frame) => {
  const input = requireBuffer(frame, 'Host v2 request frame');
  invariant(input.length >= HOST_V2_REQUEST_HEADER_BYTES, 'Host v2 request frame is truncated');
  const header = parseHostV2RequestHeader(input.subarray(0, HOST_V2_REQUEST_HEADER_BYTES));
  invariant(input.length >= header.totalLength, 'Host v2 request frame is truncated');
  invariant(input.length === header.totalLength, 'Host v2 request frame has trailing bytes');
  let offset = HOST_V2_REQUEST_HEADER_BYTES;
  const requestBytes = input.subarray(offset, offset + header.requestLength);
  offset += header.requestLength;
  const evidenceBytes = input.subarray(offset, offset + header.evidenceLength);
  offset += header.evidenceLength;
  const artifactZipBytes = input.subarray(offset, offset + header.artifactZipLength);
  const metadata = inspectHostV2RequestMetadata({ requestBytes, evidenceBytes, artifactZipLength: artifactZipBytes.length });
  const identity = finalizeHostV2RequestMetadata({
    metadata,
    artifactZipSha256: metadata.request.kind === 'forward_submit' ? sha256(artifactZipBytes) : null,
  });
  return Object.freeze({
    request: metadata.request,
    evidence: metadata.evidence,
    identity,
    requestBytes: Buffer.from(requestBytes),
    evidenceBytes: Buffer.from(evidenceBytes),
    artifactZipBytes: Buffer.from(artifactZipBytes),
  });
};

export const validateHostV2RequestFreshness = ({ requestedAtUtc, receivedAtUtc }) => {
  const requested = requireCanonicalUtc(requestedAtUtc, 'Host v2 requested time');
  const received = requireCanonicalUtc(receivedAtUtc, 'Host v2 server receipt time');
  const ageMilliseconds = new Date(received).getTime() - new Date(requested).getTime();
  invariant(ageMilliseconds <= HOST_REQUEST_MAX_PAST_MS, 'Host v2 request timestamp is too old');
  invariant(ageMilliseconds >= -HOST_REQUEST_MAX_FUTURE_MS, 'Host v2 request timestamp is too far in the future');
  return Object.freeze({ requestedAtUtc: requested, receivedAtUtc: received, ageMilliseconds });
};

export const validateHostV2RequestStatus = (rawStatus) => {
  const status = requireExactKeys(
    rawStatus,
    ['requestId', 'kind', 'lifecycle', 'phase', 'resultCode', 'updatedAtUtc'],
    'host v2 request status',
  );
  const requestId = requireRequestId(status.requestId, 'Host v2 request status ID');
  invariant(typeof status.kind === 'string' && REQUEST_KINDS.has(status.kind) && status.kind !== 'status_query', 'Host v2 request status kind is invalid');
  invariant(typeof status.lifecycle === 'string' && LIFECYCLES.has(status.lifecycle), 'Host v2 request status lifecycle is invalid');
  invariant(typeof status.phase === 'string' && STATUS_PHASES.has(status.phase), 'Host v2 request status phase is invalid');
  const terminal = new Set(['succeeded', 'failed', 'rejected']).has(status.lifecycle);
  const expectedLifecycle = status.phase === 'received'
    ? 'accepted'
    : new Set(['succeeded', 'failed', 'rejected']).has(status.phase)
      ? status.phase
      : 'running';
  invariant(status.lifecycle === expectedLifecycle, 'Host v2 request status lifecycle does not match its phase');
  const validResult = status.lifecycle === 'succeeded'
    ? status.resultCode === 'REQUEST_SUCCEEDED'
    : status.lifecycle === 'failed'
      ? status.resultCode === 'REQUEST_FAILED'
      : status.lifecycle === 'rejected'
        ? typeof status.resultCode === 'string'
          && TERMINAL_RESULT_CODES_BY_KIND[status.kind].has(status.resultCode)
          && status.resultCode !== 'REQUEST_SUCCEEDED'
          && status.resultCode !== 'REQUEST_FAILED'
        : status.resultCode === null;
  invariant((terminal || status.resultCode === null) && validResult, 'Host v2 request status result code is inconsistent');
  return Object.freeze({
    requestId,
    kind: status.kind,
    lifecycle: status.lifecycle,
    phase: status.phase,
    resultCode: status.resultCode,
    updatedAtUtc: requireCanonicalUtc(status.updatedAtUtc, 'Host v2 request status update time'),
  });
};

const validateResponseCodeForKind = ({ identity, code, requestStatus }) => {
  invariant(RESPONSE_CODES_BY_KIND[identity.kind].has(code), 'Host v2 response code does not match the request kind');
  if (code === 'STATUS_FOUND') {
    invariant(requestStatus !== null, 'Host v2 status-found response requires request status');
    invariant(requestStatus.requestId === identity.subjectRequestId, 'Host v2 returned status does not match the requested subject');
  } else {
    invariant(requestStatus === null, 'Host v2 response must not include request status');
  }
};

export const createHostV2Response = ({ requestIdentity, code, requestStatus = null }) => {
  const identity = validateHostV2RequestIdentity(requestIdentity);
  invariant(typeof code === 'string' && Object.prototype.hasOwnProperty.call(HOST_V2_RESPONSE_CODE_DEFINITIONS, code), 'Host v2 response code is invalid');
  const validatedStatus = requestStatus === null ? null : validateHostV2RequestStatus(requestStatus);
  validateResponseCodeForKind({ identity, code, requestStatus: validatedStatus });
  const definition = HOST_V2_RESPONSE_CODE_DEFINITIONS[code];
  return Object.freeze({
    schemaVersion: HOST_V2_RESPONSE_SCHEMA_VERSION,
    requestId: identity.requestId,
    kind: identity.kind,
    requestSha256: identity.requestSha256,
    status: definition.status,
    code,
    message: definition.message,
    requestStatus: validatedStatus,
  });
};

export const validateHostV2Response = (rawResponse) => {
  const response = requireExactKeys(
    rawResponse,
    ['schemaVersion', 'requestId', 'kind', 'requestSha256', 'status', 'code', 'message', 'requestStatus'],
    'host v2 response',
  );
  invariant(response.schemaVersion === HOST_V2_RESPONSE_SCHEMA_VERSION, 'Host v2 response schema version is unsupported');
  requireRequestId(response.requestId, 'Host v2 response request ID');
  invariant(typeof response.kind === 'string' && REQUEST_KINDS.has(response.kind), 'Host v2 response request kind is invalid');
  requireSha256(response.requestSha256, 'Host v2 response request digest');
  invariant(typeof response.code === 'string' && Object.prototype.hasOwnProperty.call(HOST_V2_RESPONSE_CODE_DEFINITIONS, response.code), 'Host v2 response code is invalid');
  const definition = HOST_V2_RESPONSE_CODE_DEFINITIONS[response.code];
  invariant(response.status === definition.status, 'Host v2 response status does not match its code');
  invariant(response.message === definition.message, 'Host v2 response message is not canonical');
  const requestStatus = response.requestStatus === null ? null : validateHostV2RequestStatus(response.requestStatus);
  invariant(RESPONSE_CODES_BY_KIND[response.kind].has(response.code), 'Host v2 response code does not match its request kind');
  invariant(response.code === 'STATUS_FOUND' ? requestStatus !== null : requestStatus === null, 'Host v2 response request status is inconsistent');
  return Object.freeze({ ...response, requestStatus });
};

export const createHostV2ResponseHeader = (responseLength) => {
  requireLength(responseLength, 1, MAX_HOST_V2_RESPONSE_BYTES, 'Host v2 response length');
  const header = Buffer.alloc(HOST_V2_RESPONSE_HEADER_BYTES);
  RESPONSE_MAGIC.copy(header, 0);
  header.writeUInt16BE(HOST_PROTOCOL_V2, 8);
  header.writeUInt16BE(HOST_V2_RESPONSE_HEADER_BYTES, 10);
  header.writeUInt32BE(responseLength, 12);
  return header;
};

export const parseHostV2ResponseHeader = (header) => {
  const input = validateHeader({ header, magic: RESPONSE_MAGIC, bytes: HOST_V2_RESPONSE_HEADER_BYTES, label: 'Host v2 response' });
  const responseLength = input.readUInt32BE(12);
  requireLength(responseLength, 1, MAX_HOST_V2_RESPONSE_BYTES, 'Host v2 response length');
  return Object.freeze({
    protocolVersion: HOST_PROTOCOL_V2,
    headerLength: HOST_V2_RESPONSE_HEADER_BYTES,
    responseLength,
    totalLength: HOST_V2_RESPONSE_HEADER_BYTES + responseLength,
  });
};

export const encodeHostV2ResponseFrame = (response) => {
  const responseBytes = serializeCanonicalHostJson(validateHostV2Response(response));
  return Buffer.concat([createHostV2ResponseHeader(responseBytes.length), responseBytes]);
};

export const decodeHostV2ResponseFrame = (frame) => {
  const input = requireBuffer(frame, 'Host v2 response frame');
  invariant(input.length >= HOST_V2_RESPONSE_HEADER_BYTES, 'Host v2 response frame is truncated');
  const header = parseHostV2ResponseHeader(input.subarray(0, HOST_V2_RESPONSE_HEADER_BYTES));
  invariant(input.length >= header.totalLength, 'Host v2 response frame is truncated');
  invariant(input.length === header.totalLength, 'Host v2 response frame has trailing bytes');
  return validateHostV2Response(parseCanonicalHostJson(
    input.subarray(HOST_V2_RESPONSE_HEADER_BYTES),
    { label: 'Host v2 response', maximumBytes: MAX_HOST_V2_RESPONSE_BYTES },
  ));
};
