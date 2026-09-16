import { createHash } from 'node:crypto';

import {
  HOST_AUDIT_SCHEMA_VERSION,
  createHostRequestHeader,
  decodeHostResponseFrame,
  encodeHostRequestFrame,
  inspectCanonicalEvidenceBytes,
  serializeCanonicalHostJson,
  validateHostAuditRequest,
  validateHostRequestIdentity,
} from './host/protocol.mjs';

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requireBuffer = (value, label) => {
  invariant(Buffer.isBuffer(value), `${label} must be a Buffer`);
  invariant(value.buffer instanceof ArrayBuffer, `${label} must not use shared memory`);
  return value;
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const prepareHostProtocolRequest = ({
  requestId,
  requestedAtUtc,
  actor,
  operation,
  trigger,
  evidenceBytes,
  artifactZipBytes,
}) => {
  const evidenceInput = requireBuffer(evidenceBytes, 'Canonical release evidence');
  const artifactInput = requireBuffer(artifactZipBytes, 'GitHub artifact ZIP');
  const evidence = inspectCanonicalEvidenceBytes(evidenceInput);
  invariant(evidence.operation.name === operation, 'Requested operation does not match release evidence');
  invariant(evidence.operation.trigger === trigger, 'Requested trigger does not match release evidence');

  const evidenceSha256 = sha256(evidenceInput);
  const artifactZipSha256 = sha256(artifactInput);
  invariant(
    evidence.evidenceSha256 === evidenceSha256,
    'Calculated release evidence digest is inconsistent',
  );
  invariant(
    evidence.artifactZipSha256 === artifactZipSha256,
    'Raw artifact ZIP does not match the authenticated release evidence digest',
  );

  const audit = validateHostAuditRequest({
    schemaVersion: HOST_AUDIT_SCHEMA_VERSION,
    requestId,
    requestedAtUtc,
    actor,
    operation: { name: operation, trigger },
    evidenceSha256,
    artifactZipSha256,
  });
  const auditBytes = serializeCanonicalHostJson(audit);
  const auditSha256 = sha256(auditBytes);
  const identity = validateHostRequestIdentity({
    requestId: audit.requestId,
    releaseId: evidence.releaseId,
    sourceSha: evidence.sourceSha,
    operation: audit.operation.name,
    trigger: audit.operation.trigger,
    auditSha256,
    evidenceSha256,
    artifactZipSha256,
  });

  return {
    audit,
    auditBytes,
    evidenceInput,
    artifactInput,
    identity,
  };
};

export const createHostProtocolRequestChunks = (options) => {
  const prepared = prepareHostProtocolRequest(options);
  const header = createHostRequestHeader({
    auditLength: prepared.auditBytes.length,
    evidenceLength: prepared.evidenceInput.length,
    artifactZipLength: prepared.artifactInput.length,
  });
  return Object.freeze({
    chunks: Object.freeze([
      header,
      prepared.auditBytes,
      prepared.evidenceInput,
      prepared.artifactInput,
    ]),
    identity: prepared.identity,
    totalLength: header.length
      + prepared.auditBytes.length
      + prepared.evidenceInput.length
      + prepared.artifactInput.length,
  });
};

export const createHostProtocolRequestFrame = (options) => {
  const prepared = prepareHostProtocolRequest(options);
  return Object.freeze({
    frame: encodeHostRequestFrame({
      auditBytes: prepared.auditBytes,
      evidenceBytes: prepared.evidenceInput,
      artifactZipBytes: prepared.artifactInput,
    }),
    identity: prepared.identity,
  });
};

export const validateHostProtocolResponse = ({ responseFrame, requestIdentity }) => {
  const expected = validateHostRequestIdentity(requestIdentity);
  const response = decodeHostResponseFrame(
    requireBuffer(responseFrame, 'Host response frame'),
  );
  invariant(response.requestId === expected.requestId, 'Host response request ID does not match');
  invariant(response.releaseId === expected.releaseId, 'Host response release ID does not match');
  invariant(response.operation === expected.operation, 'Host response operation does not match');
  invariant(response.trigger === expected.trigger, 'Host response trigger does not match');
  invariant(
    response.auditSha256 === expected.auditSha256,
    'Host response audit digest does not match',
  );
  invariant(
    response.evidenceSha256 === expected.evidenceSha256,
    'Host response evidence digest does not match',
  );
  return response;
};
