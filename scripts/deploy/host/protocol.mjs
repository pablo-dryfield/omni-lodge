import { createHash } from 'node:crypto';

import {
  CANONICAL_RELEASE_REF,
  CANONICAL_REPOSITORY,
  CANONICAL_WORKFLOW_PATH,
  RELEASE_LIMITS,
} from '../../release/lib.mjs';
import {
  deriveReleaseId,
  selectDeploymentAuthorization,
  validateReleaseOperation,
} from '../github-release-evidence.mjs';

export const HOST_PROTOCOL_VERSION = 1;
export const HOST_AUDIT_SCHEMA_VERSION = 1;
export const HOST_RESPONSE_SCHEMA_VERSION = 1;
export const HOST_POLICY_SCHEMA_VERSION = 1;

export const HOST_REQUEST_HEADER_BYTES = 32;
export const HOST_RESPONSE_HEADER_BYTES = 16;
export const MAX_HOST_AUDIT_BYTES = 16 * 1024;
// Schema-v2 evidence is a small, fixed-shape document. Keeping this well below
// the generic GitHub API JSON limit prevents attacker-controlled metadata from
// becoming a CPU or memory admission mechanism on the host.
export const MAX_HOST_EVIDENCE_BYTES = 64 * 1024;
export const MAX_HOST_ARTIFACT_BYTES = RELEASE_LIMITS.maxCompressedArchiveBytes
  + (64 * 1024 * 1024);
export const MAX_HOST_RESPONSE_BYTES = 16 * 1024;

const REQUEST_MAGIC = Buffer.from('OMNIHRQ1', 'ascii');
const RESPONSE_MAGIC = Buffer.from('OMNIHRS1', 'ascii');
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const MAX_SAFE_INTEGER_DECIMAL_DIGITS = String(Number.MAX_SAFE_INTEGER).length;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+\[\]-]{0,127}$/;
const DEPLOYMENT_MODES = new Set(['disabled', 'manual', 'automatic']);
const DEPLOYMENT_TRIGGERS = new Set(['manual', 'automatic']);
const RELEASE_OPERATIONS = new Set(['stage', 'dry-run', 'deploy']);
const VALIDATED_HOST_REQUEST_METADATA = new WeakSet();

export const HOST_RESPONSE_CODE_DEFINITIONS = Object.freeze({
  REQUEST_ACCEPTED: Object.freeze({
    status: 'accepted',
    message: 'The host accepted the request.',
  }),
  POLICY_DENIED: Object.freeze({
    status: 'rejected',
    message: 'The host policy does not authorize this request.',
  }),
  REQUEST_REJECTED: Object.freeze({
    status: 'rejected',
    message: 'The host rejected the request.',
  }),
  HOST_BUSY: Object.freeze({
    status: 'rejected',
    message: 'The host is already processing another deployment request.',
  }),
  REQUEST_SUCCEEDED: Object.freeze({
    status: 'succeeded',
    message: 'The host completed the request.',
  }),
  REQUEST_FAILED: Object.freeze({
    status: 'failed',
    message: 'The host could not complete the request.',
  }),
});

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const requirePlainObject = (value, label) => {
  invariant(isPlainObject(value), `${label} must be a JSON object`);
  return value;
};

const requireExactKeys = (value, expectedKeys, label) => {
  const object = requirePlainObject(value, label);
  const actualKeys = Object.keys(object);
  invariant(
    actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index]),
    `${label} schema is not canonical`,
  );
  return object;
};

const requireBuffer = (value, label) => {
  invariant(Buffer.isBuffer(value), `${label} must be a Buffer`);
  invariant(
    value.buffer instanceof ArrayBuffer,
    `${label} must not use shared memory`,
  );
  return value;
};

const requireBoundedLength = (value, minimum, maximum, label) => {
  invariant(Number.isSafeInteger(value), `${label} must be a safe integer`);
  invariant(value >= minimum, `${label} is below the minimum`);
  invariant(value <= maximum, `${label} exceeds the limit`);
  return value;
};

const requireRequestId = (value, label = 'request ID') => {
  invariant(
    typeof value === 'string' && REQUEST_ID_PATTERN.test(value),
    `${label} must be a canonical lowercase UUID v4`,
  );
  return value;
};

const requireOperation = (value, label = 'operation') => {
  invariant(
    typeof value === 'string' && RELEASE_OPERATIONS.has(value),
    `${label} is invalid`,
  );
  return value;
};

const requireTrigger = (value, label = 'trigger') => {
  invariant(
    typeof value === 'string' && DEPLOYMENT_TRIGGERS.has(value),
    `${label} is invalid`,
  );
  return value;
};

const requireSha256 = (value, label) => {
  invariant(
    typeof value === 'string' && SHA256_PATTERN.test(value),
    `${label} must be a lowercase SHA-256 digest`,
  );
  return value;
};

const requirePositiveIntegerText = (value, label) => {
  invariant(
    typeof value === 'string',
    `${label} must be a positive integer string`,
  );
  invariant(
    value.length <= MAX_SAFE_INTEGER_DECIMAL_DIGITS,
    `${label} exceeds the safe integer decimal length`,
  );
  invariant(POSITIVE_INTEGER_PATTERN.test(value), `${label} must be a positive integer string`);
  invariant(BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), `${label} exceeds the safe integer range`);
  return value;
};

const requireReleaseId = (value, label, expectedSourceSha) => {
  invariant(typeof value === 'string' && value.length <= 96, `${label} is invalid`);
  const match = /^omnilodge-r([1-9][0-9]*)-a([1-9][0-9]*)-([0-9a-f]{12})$/.exec(value);
  invariant(match, `${label} is invalid`);
  requirePositiveIntegerText(match[1], `${label} run ID`);
  requirePositiveIntegerText(match[2], `${label} run attempt`);
  if (expectedSourceSha !== undefined) {
    invariant(match[3] === expectedSourceSha.slice(0, 12), `${label} source SHA does not match`);
  }
  return value;
};

const requireCanonicalUtc = (value, label) => {
  invariant(typeof value === 'string', `${label} must be text`);
  const parsed = new Date(value);
  invariant(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return value;
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export const serializeCanonicalHostJson = (value) => {
  const serialized = JSON.stringify(value, null, 2);
  invariant(typeof serialized === 'string', 'Canonical JSON value is not serializable');
  return Buffer.from(`${serialized}\n`, 'utf8');
};

export const parseCanonicalHostJson = (bytes, { label, maximumBytes }) => {
  const input = requireBuffer(bytes, label);
  requireBoundedLength(input.length, 1, maximumBytes, `${label} length`);
  let text;
  try {
    text = UTF8_DECODER.decode(input);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  invariant(Buffer.from(text, 'utf8').equals(input), `${label} is not canonical UTF-8`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  invariant(
    input.equals(serializeCanonicalHostJson(parsed)),
    `${label} is not in exact canonical JSON form`,
  );
  return parsed;
};

export const validateHostAuditRequest = (rawAudit) => {
  const audit = requireExactKeys(
    rawAudit,
    [
      'schemaVersion',
      'requestId',
      'requestedAtUtc',
      'actor',
      'operation',
      'evidenceSha256',
      'artifactZipSha256',
    ],
    'host audit request',
  );
  invariant(
    audit.schemaVersion === HOST_AUDIT_SCHEMA_VERSION,
    'Host audit request schema version is unsupported',
  );
  const operation = requireExactKeys(
    audit.operation,
    ['name', 'trigger'],
    'host audit request operation',
  );
  const requestId = requireRequestId(audit.requestId, 'Host audit request ID');
  const requestedAtUtc = requireCanonicalUtc(
    audit.requestedAtUtc,
    'Host audit request timestamp',
  );
  invariant(
    typeof audit.actor === 'string' && ACTOR_PATTERN.test(audit.actor),
    'Host audit request actor is invalid',
  );
  const name = requireOperation(operation.name, 'Host audit request operation');
  const trigger = requireTrigger(operation.trigger, 'Host audit request trigger');
  const evidenceSha256 = requireSha256(
    audit.evidenceSha256,
    'Host audit request evidence digest',
  );
  const artifactZipSha256 = requireSha256(
    audit.artifactZipSha256,
    'Host audit request artifact digest',
  );

  return Object.freeze({
    schemaVersion: HOST_AUDIT_SCHEMA_VERSION,
    requestId,
    requestedAtUtc,
    actor: audit.actor,
    operation: Object.freeze({ name, trigger }),
    evidenceSha256,
    artifactZipSha256,
  });
};

export const parseCanonicalHostAuditBytes = (bytes) => validateHostAuditRequest(
  parseCanonicalHostJson(bytes, {
    label: 'Host audit request',
    maximumBytes: MAX_HOST_AUDIT_BYTES,
  }),
);

const validateEvidenceActivation = ({ operation, activationAuthorization }) => {
  const authorization = requireExactKeys(
    activationAuthorization,
    ['mode', 'authorized', 'reason'],
    'release evidence activationAuthorization',
  );
  invariant(
    typeof authorization.mode === 'string' && DEPLOYMENT_MODES.has(authorization.mode),
    'Release evidence deployment mode is invalid',
  );
  invariant(
    typeof authorization.authorized === 'boolean',
    'Release evidence activation authorization must be boolean',
  );
  invariant(
    typeof authorization.reason === 'string',
    'Release evidence activation authorization reason must be text',
  );

  validateReleaseOperation({
    configuredMode: authorization.mode,
    trigger: operation.trigger,
    operation: operation.name,
  });
  const expectedAuthorization = operation.name === 'deploy'
    ? selectDeploymentAuthorization({
      configuredMode: authorization.mode,
      trigger: operation.trigger,
    })
    : {
      authorized: false,
      mode: authorization.mode,
      trigger: operation.trigger,
      reason: 'activation_not_requested',
    };
  invariant(
    authorization.mode === expectedAuthorization.mode
      && authorization.authorized === expectedAuthorization.authorized
      && authorization.reason === expectedAuthorization.reason,
    'Release evidence activation authorization is inconsistent',
  );
  invariant(
    operation.name !== 'deploy' || expectedAuthorization.authorized,
    'Release evidence does not authorize its requested deployment',
  );
};

export const inspectCanonicalEvidenceBytes = (bytes) => {
  const input = requireBuffer(bytes, 'Canonical release evidence');
  const evidence = requireExactKeys(
    parseCanonicalHostJson(input, {
      label: 'Canonical release evidence',
      maximumBytes: MAX_HOST_EVIDENCE_BYTES,
    }),
    [
      'schemaVersion',
      'operation',
      'activationAuthorization',
      'release',
      'productionEvidence',
    ],
    'release evidence',
  );
  invariant(evidence.schemaVersion === 2, 'Release evidence schema version is unsupported');

  const rawOperation = requireExactKeys(
    evidence.operation,
    ['name', 'trigger'],
    'release evidence operation',
  );
  const operation = Object.freeze({
    name: requireOperation(rawOperation.name, 'Release evidence operation'),
    trigger: requireTrigger(rawOperation.trigger, 'Release evidence operation trigger'),
  });
  validateEvidenceActivation({
    operation,
    activationAuthorization: evidence.activationAuthorization,
  });

  const release = requireExactKeys(
    evidence.release,
    [
      'releaseId',
      'sourceSha',
      'runId',
      'runAttempt',
      'artifactId',
      'artifactName',
      'artifactDigest',
    ],
    'release evidence release',
  );
  invariant(
    typeof release.sourceSha === 'string' && SOURCE_SHA_PATTERN.test(release.sourceSha),
    'Release evidence source SHA must be a full lowercase Git SHA',
  );
  const runId = requirePositiveIntegerText(release.runId, 'Release evidence run ID');
  const runAttempt = requirePositiveIntegerText(
    release.runAttempt,
    'Release evidence run attempt',
  );
  const artifactId = requirePositiveIntegerText(
    release.artifactId,
    'Release evidence artifact ID',
  );
  const releaseId = deriveReleaseId({
    runId,
    runAttempt,
    sourceSha: release.sourceSha,
  });
  invariant(release.releaseId === releaseId, 'Release evidence release ID does not match');
  invariant(release.artifactName === releaseId, 'Release evidence artifact name does not match');
  const artifactDigestMatch = typeof release.artifactDigest === 'string'
    ? ARTIFACT_DIGEST_PATTERN.exec(release.artifactDigest)
    : null;
  invariant(
    artifactDigestMatch,
    'Release evidence artifact digest must be a lowercase SHA-256 digest',
  );

  const productionEvidence = requireExactKeys(
    evidence.productionEvidence,
    [
      'workflowConclusion',
      'artifactId',
      'artifactDigest',
      'expectedReleaseId',
      'expectedSourceSha',
      'expectedRepository',
      'expectedWorkflowPath',
      'expectedEvent',
      'expectedRef',
      'expectedRunId',
      'expectedRunAttempt',
      'expectedArtifactName',
    ],
    'release evidence productionEvidence',
  );
  const derivedProductionEvidence = {
    workflowConclusion: 'success',
    artifactId,
    artifactDigest: release.artifactDigest,
    expectedReleaseId: releaseId,
    expectedSourceSha: release.sourceSha,
    expectedRepository: CANONICAL_REPOSITORY,
    expectedWorkflowPath: CANONICAL_WORKFLOW_PATH,
    expectedEvent: 'push',
    expectedRef: CANONICAL_RELEASE_REF,
    expectedRunId: runId,
    expectedRunAttempt: runAttempt,
    expectedArtifactName: releaseId,
  };
  invariant(
    JSON.stringify(productionEvidence) === JSON.stringify(derivedProductionEvidence),
    'Release evidence productionEvidence does not match the release identity',
  );

  return Object.freeze({
    schemaVersion: 2,
    operation,
    releaseId,
    sourceSha: release.sourceSha,
    runId,
    runAttempt,
    artifactId,
    artifactDigest: release.artifactDigest,
    artifactZipSha256: artifactDigestMatch[1],
    evidenceSha256: sha256(input),
  });
};

export const inspectHostRequestMetadata = ({ auditBytes, evidenceBytes }) => {
  const auditInput = requireBuffer(auditBytes, 'Host audit request');
  const evidenceInput = requireBuffer(evidenceBytes, 'Canonical release evidence');
  const audit = parseCanonicalHostAuditBytes(auditInput);
  const evidence = inspectCanonicalEvidenceBytes(evidenceInput);
  const auditSha256 = sha256(auditInput);
  const evidenceSha256 = sha256(evidenceInput);

  invariant(
    audit.operation.name === evidence.operation.name,
    'Host audit request operation does not match release evidence',
  );
  invariant(
    audit.operation.trigger === evidence.operation.trigger,
    'Host audit request trigger does not match release evidence',
  );
  invariant(
    audit.evidenceSha256 === evidenceSha256,
    'Host audit request evidence digest does not match release evidence',
  );
  invariant(
    evidence.evidenceSha256 === evidenceSha256,
    'Calculated release evidence digest is inconsistent',
  );
  invariant(
    audit.artifactZipSha256 === evidence.artifactZipSha256,
    'Host audit request artifact digest does not match release evidence',
  );

  const metadata = Object.freeze({
    audit,
    evidence,
    auditSha256,
    evidenceSha256,
    expectedArtifactZipSha256: evidence.artifactZipSha256,
  });
  VALIDATED_HOST_REQUEST_METADATA.add(metadata);
  return metadata;
};

export const finalizeHostRequestMetadata = ({ metadata, artifactZipSha256 }) => {
  invariant(
    metadata !== null
      && typeof metadata === 'object'
      && VALIDATED_HOST_REQUEST_METADATA.has(metadata),
    'Host request metadata was not produced by the canonical metadata inspector',
  );
  const actualArtifactZipSha256 = requireSha256(
    artifactZipSha256,
    'Calculated GitHub artifact ZIP digest',
  );
  invariant(
    metadata.expectedArtifactZipSha256 === actualArtifactZipSha256,
    'Release evidence artifact digest does not match the raw ZIP',
  );

  return validateHostRequestIdentity({
    requestId: metadata.audit.requestId,
    releaseId: metadata.evidence.releaseId,
    sourceSha: metadata.evidence.sourceSha,
    operation: metadata.audit.operation.name,
    trigger: metadata.audit.operation.trigger,
    auditSha256: metadata.auditSha256,
    evidenceSha256: metadata.evidenceSha256,
    artifactZipSha256: actualArtifactZipSha256,
  });
};

const validateHeaderPrefix = ({
  header,
  magic,
  expectedBytes,
  label,
}) => {
  const input = requireBuffer(header, `${label} header`);
  invariant(input.length === expectedBytes, `${label} header has an invalid length`);
  invariant(input.subarray(0, 8).equals(magic), `${label} magic is invalid`);
  invariant(
    input.readUInt16BE(8) === HOST_PROTOCOL_VERSION,
    `${label} protocol version is unsupported`,
  );
  invariant(input.readUInt16BE(10) === expectedBytes, `${label} header size is invalid`);
  return input;
};

export const createHostRequestHeader = ({
  auditLength,
  evidenceLength,
  artifactZipLength,
}) => {
  requireBoundedLength(auditLength, 1, MAX_HOST_AUDIT_BYTES, 'Host audit request length');
  requireBoundedLength(
    evidenceLength,
    1,
    MAX_HOST_EVIDENCE_BYTES,
    'Canonical release evidence length',
  );
  requireBoundedLength(
    artifactZipLength,
    1,
    MAX_HOST_ARTIFACT_BYTES,
    'GitHub artifact ZIP length',
  );
  const header = Buffer.alloc(HOST_REQUEST_HEADER_BYTES);
  REQUEST_MAGIC.copy(header, 0);
  header.writeUInt16BE(HOST_PROTOCOL_VERSION, 8);
  header.writeUInt16BE(HOST_REQUEST_HEADER_BYTES, 10);
  header.writeUInt32BE(auditLength, 12);
  header.writeUInt32BE(evidenceLength, 16);
  header.writeBigUInt64BE(BigInt(artifactZipLength), 20);
  header.writeUInt32BE(0, 28);
  return header;
};

export const parseHostRequestHeader = (header) => {
  const input = validateHeaderPrefix({
    header,
    magic: REQUEST_MAGIC,
    expectedBytes: HOST_REQUEST_HEADER_BYTES,
    label: 'Host request',
  });
  const auditLength = input.readUInt32BE(12);
  const evidenceLength = input.readUInt32BE(16);
  const artifactZipLengthBigInt = input.readBigUInt64BE(20);
  invariant(
    artifactZipLengthBigInt <= BigInt(Number.MAX_SAFE_INTEGER),
    'GitHub artifact ZIP length exceeds the safe integer range',
  );
  const artifactZipLength = Number(artifactZipLengthBigInt);
  invariant(input.readUInt32BE(28) === 0, 'Host request reserved header field must be zero');
  requireBoundedLength(auditLength, 1, MAX_HOST_AUDIT_BYTES, 'Host audit request length');
  requireBoundedLength(
    evidenceLength,
    1,
    MAX_HOST_EVIDENCE_BYTES,
    'Canonical release evidence length',
  );
  requireBoundedLength(
    artifactZipLength,
    1,
    MAX_HOST_ARTIFACT_BYTES,
    'GitHub artifact ZIP length',
  );
  const totalLengthBigInt = BigInt(HOST_REQUEST_HEADER_BYTES)
    + BigInt(auditLength)
    + BigInt(evidenceLength)
    + BigInt(artifactZipLength);
  invariant(
    totalLengthBigInt <= BigInt(Number.MAX_SAFE_INTEGER),
    'Host request frame length exceeds the safe integer range',
  );
  return Object.freeze({
    protocolVersion: HOST_PROTOCOL_VERSION,
    headerLength: HOST_REQUEST_HEADER_BYTES,
    auditLength,
    evidenceLength,
    artifactZipLength,
    totalLength: Number(totalLengthBigInt),
  });
};

export const encodeHostRequestFrame = ({ auditBytes, evidenceBytes, artifactZipBytes }) => {
  const audit = requireBuffer(auditBytes, 'Host audit request');
  const evidence = requireBuffer(evidenceBytes, 'Canonical release evidence');
  const artifact = requireBuffer(artifactZipBytes, 'GitHub artifact ZIP');
  const header = createHostRequestHeader({
    auditLength: audit.length,
    evidenceLength: evidence.length,
    artifactZipLength: artifact.length,
  });
  return Buffer.concat([header, audit, evidence, artifact]);
};

// In-memory convenience decoder for tests and already-small frames. Production
// transports must use request-receiver.mjs so a maximum-size artifact is never
// accumulated and copied in the privileged process.
export const decodeHostRequestFrame = (frame) => {
  const input = requireBuffer(frame, 'Host request frame');
  invariant(input.length >= HOST_REQUEST_HEADER_BYTES, 'Host request frame is truncated');
  const header = parseHostRequestHeader(input.subarray(0, HOST_REQUEST_HEADER_BYTES));
  invariant(input.length >= header.totalLength, 'Host request frame is truncated');
  invariant(input.length === header.totalLength, 'Host request frame has trailing bytes');

  let offset = HOST_REQUEST_HEADER_BYTES;
  const auditBytes = input.subarray(offset, offset + header.auditLength);
  offset += header.auditLength;
  const evidenceBytes = input.subarray(offset, offset + header.evidenceLength);
  offset += header.evidenceLength;
  const artifactZipBytes = input.subarray(offset, offset + header.artifactZipLength);

  const metadata = inspectHostRequestMetadata({ auditBytes, evidenceBytes });
  const artifactZipSha256 = sha256(artifactZipBytes);
  const identity = finalizeHostRequestMetadata({ metadata, artifactZipSha256 });
  return Object.freeze({
    audit: metadata.audit,
    evidence: metadata.evidence,
    identity,
    // These are copies so a caller cannot change the already-validated frame
    // through an alias retained by the transport layer.
    evidenceBytes: Buffer.from(evidenceBytes),
    artifactZipBytes: Buffer.from(artifactZipBytes),
  });
};

export const validateHostRequestIdentity = (rawIdentity) => {
  const identity = requireExactKeys(
    rawIdentity,
    [
      'requestId',
      'releaseId',
      'sourceSha',
      'operation',
      'trigger',
      'auditSha256',
      'evidenceSha256',
      'artifactZipSha256',
    ],
    'host request identity',
  );
  const requestId = requireRequestId(identity.requestId, 'Host request identity ID');
  invariant(
    typeof identity.sourceSha === 'string' && SOURCE_SHA_PATTERN.test(identity.sourceSha),
    'Host request identity source SHA is invalid',
  );
  const releaseId = requireReleaseId(
    identity.releaseId,
    'Host request identity release ID',
    identity.sourceSha,
  );
  return Object.freeze({
    requestId,
    releaseId,
    sourceSha: identity.sourceSha,
    operation: requireOperation(identity.operation, 'Host request identity operation'),
    trigger: requireTrigger(identity.trigger, 'Host request identity trigger'),
    auditSha256: requireSha256(
      identity.auditSha256,
      'Host request identity audit digest',
    ),
    evidenceSha256: requireSha256(
      identity.evidenceSha256,
      'Host request identity evidence digest',
    ),
    artifactZipSha256: requireSha256(
      identity.artifactZipSha256,
      'Host request identity artifact digest',
    ),
  });
};

export const createHostResponse = ({ requestIdentity, code }) => {
  const identity = validateHostRequestIdentity(requestIdentity);
  invariant(
    typeof code === 'string'
      && Object.prototype.hasOwnProperty.call(HOST_RESPONSE_CODE_DEFINITIONS, code),
    'Host response code is invalid',
  );
  const definition = HOST_RESPONSE_CODE_DEFINITIONS[code];
  return Object.freeze({
    schemaVersion: HOST_RESPONSE_SCHEMA_VERSION,
    requestId: identity.requestId,
    releaseId: identity.releaseId,
    operation: identity.operation,
    trigger: identity.trigger,
    auditSha256: identity.auditSha256,
    evidenceSha256: identity.evidenceSha256,
    status: definition.status,
    code,
    message: definition.message,
  });
};

export const validateHostResponse = (rawResponse) => {
  const response = requireExactKeys(
    rawResponse,
    [
      'schemaVersion',
      'requestId',
      'releaseId',
      'operation',
      'trigger',
      'auditSha256',
      'evidenceSha256',
      'status',
      'code',
      'message',
    ],
    'host response',
  );
  invariant(
    response.schemaVersion === HOST_RESPONSE_SCHEMA_VERSION,
    'Host response schema version is unsupported',
  );
  requireRequestId(response.requestId, 'Host response request ID');
  requireReleaseId(response.releaseId, 'Host response release ID');
  requireOperation(response.operation, 'Host response operation');
  requireTrigger(response.trigger, 'Host response trigger');
  requireSha256(response.auditSha256, 'Host response audit digest');
  requireSha256(response.evidenceSha256, 'Host response evidence digest');
  invariant(
    typeof response.code === 'string'
      && Object.prototype.hasOwnProperty.call(HOST_RESPONSE_CODE_DEFINITIONS, response.code),
    'Host response code is invalid',
  );
  const definition = HOST_RESPONSE_CODE_DEFINITIONS[response.code];
  invariant(response.status === definition.status, 'Host response status does not match its code');
  invariant(response.message === definition.message, 'Host response message is not canonical');
  return Object.freeze({ ...response });
};

export const createHostResponseHeader = (responseLength) => {
  requireBoundedLength(
    responseLength,
    1,
    MAX_HOST_RESPONSE_BYTES,
    'Host response length',
  );
  const header = Buffer.alloc(HOST_RESPONSE_HEADER_BYTES);
  RESPONSE_MAGIC.copy(header, 0);
  header.writeUInt16BE(HOST_PROTOCOL_VERSION, 8);
  header.writeUInt16BE(HOST_RESPONSE_HEADER_BYTES, 10);
  header.writeUInt32BE(responseLength, 12);
  return header;
};

export const parseHostResponseHeader = (header) => {
  const input = validateHeaderPrefix({
    header,
    magic: RESPONSE_MAGIC,
    expectedBytes: HOST_RESPONSE_HEADER_BYTES,
    label: 'Host response',
  });
  const responseLength = input.readUInt32BE(12);
  requireBoundedLength(
    responseLength,
    1,
    MAX_HOST_RESPONSE_BYTES,
    'Host response length',
  );
  return Object.freeze({
    protocolVersion: HOST_PROTOCOL_VERSION,
    headerLength: HOST_RESPONSE_HEADER_BYTES,
    responseLength,
    totalLength: HOST_RESPONSE_HEADER_BYTES + responseLength,
  });
};

export const encodeHostResponseFrame = (response) => {
  const validated = validateHostResponse(response);
  const responseBytes = serializeCanonicalHostJson(validated);
  const header = createHostResponseHeader(responseBytes.length);
  return Buffer.concat([header, responseBytes]);
};

export const decodeHostResponseFrame = (frame) => {
  const input = requireBuffer(frame, 'Host response frame');
  invariant(input.length >= HOST_RESPONSE_HEADER_BYTES, 'Host response frame is truncated');
  const header = parseHostResponseHeader(input.subarray(0, HOST_RESPONSE_HEADER_BYTES));
  invariant(input.length >= header.totalLength, 'Host response frame is truncated');
  invariant(input.length === header.totalLength, 'Host response frame has trailing bytes');
  const responseBytes = input.subarray(HOST_RESPONSE_HEADER_BYTES);
  return validateHostResponse(
    parseCanonicalHostJson(responseBytes, {
      label: 'Host response',
      maximumBytes: MAX_HOST_RESPONSE_BYTES,
    }),
  );
};
