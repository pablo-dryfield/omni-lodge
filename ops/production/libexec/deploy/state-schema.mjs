import {
  invariant,
  parseCanonicalJson,
  requireExactKeys,
  serializeCanonicalJson,
} from './canonical-json.mjs';
import {
  HOST_AUDIT_EVENT_SCHEMA_VERSION,
  HOST_AUDIT_EVENT_TYPES,
  HOST_REQUEST_NONCE_SCHEMA_VERSION,
} from './constants.mjs';
import { validateHostV2RequestIdentity } from '../../../../scripts/deploy/host/protocol-v2.mjs';

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+\[\]-]{0,127}$/;
const TRANSPORT_KEY_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+/=-]{0,127}$/;
const OUTCOME_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const REQUEST_KINDS = new Set(['forward_submit', 'rollback_submit', 'status_query']);
const AUDIT_EVENT_TYPES = new Set(HOST_AUDIT_EVENT_TYPES);
const MAX_REQUEST_NONCE_BYTES = 2 * 1024;

export const validateCanonicalUtc = (value, label) => {
  invariant(typeof value === 'string', `${label} must be text`);
  const parsed = new Date(value);
  invariant(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} is invalid`);
  return value;
};

export const validateTransportKeyLabel = (value) => {
  invariant(
    typeof value === 'string' && TRANSPORT_KEY_LABEL_PATTERN.test(value),
    'Transport key label is invalid',
  );
  return value;
};

export const validateAuditEvent = (rawEvent) => {
  const event = requireExactKeys(
    rawEvent,
    [
      'schemaVersion',
      'serverReceivedAtUtc',
      'transportKeyLabel',
      'eventType',
      'requestId',
      'requestKind',
      'requestSha256',
      'requestedAtUtc',
      'actor',
      'outcomeCode',
    ],
    'host audit event',
  );
  invariant(
    event.schemaVersion === HOST_AUDIT_EVENT_SCHEMA_VERSION,
    'Host audit event schema version is unsupported',
  );
  invariant(AUDIT_EVENT_TYPES.has(event.eventType), 'Host audit event type is invalid');
  invariant(
    typeof event.requestId === 'string' && REQUEST_ID_PATTERN.test(event.requestId),
    'Audit event request ID is invalid',
  );
  invariant(REQUEST_KINDS.has(event.requestKind), 'Audit event request kind is invalid');
  invariant(
    typeof event.requestSha256 === 'string' && SHA256_PATTERN.test(event.requestSha256),
    'Audit event request digest is invalid',
  );
  invariant(
    typeof event.actor === 'string' && ACTOR_PATTERN.test(event.actor),
    'Audit event actor is invalid',
  );
  invariant(
    event.outcomeCode === null
      || (typeof event.outcomeCode === 'string' && OUTCOME_CODE_PATTERN.test(event.outcomeCode)),
    'Host audit event outcome code is invalid',
  );

  return Object.freeze({
    schemaVersion: HOST_AUDIT_EVENT_SCHEMA_VERSION,
    serverReceivedAtUtc: validateCanonicalUtc(
      event.serverReceivedAtUtc,
      'Audit event server receipt time',
    ),
    transportKeyLabel: validateTransportKeyLabel(event.transportKeyLabel),
    eventType: event.eventType,
    requestId: event.requestId,
    requestKind: event.requestKind,
    requestSha256: event.requestSha256,
    requestedAtUtc: validateCanonicalUtc(event.requestedAtUtc, 'Audit event requested time'),
    actor: event.actor,
    outcomeCode: event.outcomeCode,
  });
};

export const createAuditEvent = ({
  identity,
  clock,
  transportKeyLabel,
  eventType,
  outcomeCode = null,
}) => {
  const validatedIdentity = validateHostV2RequestIdentity(identity);
  return validateAuditEvent({
    schemaVersion: HOST_AUDIT_EVENT_SCHEMA_VERSION,
    serverReceivedAtUtc: validateCanonicalUtc(
      clock().toISOString(),
      'Audit event server receipt time',
    ),
    transportKeyLabel: validateTransportKeyLabel(transportKeyLabel),
    eventType,
    requestId: validatedIdentity.requestId,
    requestKind: validatedIdentity.kind,
    requestSha256: validatedIdentity.requestSha256,
    requestedAtUtc: validatedIdentity.requestedAtUtc,
    actor: validatedIdentity.actor,
    outcomeCode,
  });
};

export const validateRequestNonceRecord = (rawRecord) => {
  const record = requireExactKeys(
    rawRecord,
    [
      'schemaVersion',
      'requestId',
      'requestSha256',
      'requestKind',
      'reservedAtUtc',
      'expiresAtUtc',
    ],
    'request nonce record',
  );
  invariant(
    record.schemaVersion === HOST_REQUEST_NONCE_SCHEMA_VERSION,
    'Request nonce schema version is unsupported',
  );
  invariant(
    typeof record.requestId === 'string' && REQUEST_ID_PATTERN.test(record.requestId),
    'Request nonce ID is invalid',
  );
  invariant(
    typeof record.requestSha256 === 'string' && SHA256_PATTERN.test(record.requestSha256),
    'Request nonce digest is invalid',
  );
  invariant(REQUEST_KINDS.has(record.requestKind), 'Request nonce kind is invalid');
  const reservedAtUtc = validateCanonicalUtc(record.reservedAtUtc, 'Request nonce reservation time');
  const expiresAtUtc = validateCanonicalUtc(record.expiresAtUtc, 'Request nonce expiry time');
  invariant(
    new Date(expiresAtUtc).getTime() > new Date(reservedAtUtc).getTime(),
    'Request nonce expiry must be after its reservation time',
  );
  return Object.freeze({
    schemaVersion: HOST_REQUEST_NONCE_SCHEMA_VERSION,
    requestId: record.requestId,
    requestSha256: record.requestSha256,
    requestKind: record.requestKind,
    reservedAtUtc,
    expiresAtUtc,
  });
};

export const createRequestNonceRecord = ({
  identity,
  reservedAtUtc,
  expiresAtUtc,
}) => {
  const validatedIdentity = validateHostV2RequestIdentity(identity);
  return validateRequestNonceRecord({
    schemaVersion: HOST_REQUEST_NONCE_SCHEMA_VERSION,
    requestId: validatedIdentity.requestId,
    requestSha256: validatedIdentity.requestSha256,
    requestKind: validatedIdentity.kind,
    reservedAtUtc,
    expiresAtUtc,
  });
};

export const serializeCanonicalRequestNonce = (record) => (
  serializeCanonicalJson(validateRequestNonceRecord(record))
);

export const parseCanonicalRequestNonceBytes = (bytes) => parseCanonicalJson(bytes, {
  label: 'Request nonce record',
  maximumBytes: MAX_REQUEST_NONCE_BYTES,
  validate: validateRequestNonceRecord,
});
