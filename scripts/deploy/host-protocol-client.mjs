import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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
import {
  HOST_V2_REQUEST_HEADER_BYTES,
  MAX_HOST_V2_ARTIFACT_BYTES,
  createHostV2RequestHeader,
  decodeHostV2ResponseFrame,
  encodeHostV2RequestFrame,
  finalizeHostV2RequestMetadata,
  inspectHostV2RequestMetadata,
  serializeCanonicalHostV2Request,
  validateHostV2RequestIdentity,
} from './host/protocol-v2.mjs';

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

const createV2RequestDocument = ({
  requestId,
  requestedAtUtc,
  actor,
  kind,
  operation,
  trigger,
  evidenceSha256,
  artifactZipSha256,
  expectedActiveSnapshot,
  targetSnapshot,
  subjectRequestId,
}) => {
  let payload;
  if (kind === 'forward_submit') {
    payload = { operation, trigger, evidenceSha256, artifactZipSha256 };
  } else if (kind === 'rollback_submit') {
    payload = { trigger: 'manual', expectedActiveSnapshot, targetSnapshot };
  } else if (kind === 'status_query') {
    payload = { subjectRequestId };
  } else {
    throw new Error('Host v2 request kind is invalid');
  }
  return {
    schemaVersion: 2,
    requestId,
    requestedAtUtc,
    actor,
    kind,
    payload,
  };
};

const prepareV2BufferRequest = (options) => {
  const kind = options.kind;
  if (kind !== 'forward_submit') {
    invariant(options.evidenceBytes === undefined, `Host v2 ${kind} must not provide release evidence`);
    invariant(options.artifactZipBytes === undefined, `Host v2 ${kind} must not provide an artifact ZIP`);
  }
  if (kind === 'rollback_submit') {
    invariant(options.trigger === undefined || options.trigger === 'manual', 'Host v2 rollback must be manually triggered');
  }
  const evidenceSource = kind === 'forward_submit'
    ? requireBuffer(options.evidenceBytes, 'Host v2 release evidence')
    : Buffer.alloc(0);
  if (kind === 'forward_submit') inspectCanonicalEvidenceBytes(evidenceSource);
  const artifactSource = kind === 'forward_submit'
    ? requireBuffer(options.artifactZipBytes, 'Host v2 artifact ZIP')
    : Buffer.alloc(0);
  invariant(artifactSource.length <= MAX_HOST_V2_ARTIFACT_BYTES, 'Host v2 artifact ZIP length exceeds the limit');
  const evidenceInput = Buffer.from(evidenceSource);
  const artifactInput = Buffer.from(artifactSource);
  const request = createV2RequestDocument({
    ...options,
    evidenceSha256: kind === 'forward_submit' ? sha256(evidenceInput) : undefined,
    artifactZipSha256: kind === 'forward_submit' ? sha256(artifactInput) : undefined,
  });
  const requestBytes = serializeCanonicalHostV2Request(request);
  const metadata = inspectHostV2RequestMetadata({
    requestBytes,
    evidenceBytes: evidenceInput,
    artifactZipLength: artifactInput.length,
  });
  const identity = finalizeHostV2RequestMetadata({
    metadata,
    artifactZipSha256: kind === 'forward_submit' ? sha256(artifactInput) : null,
  });
  return { requestBytes, evidenceInput, artifactInput, identity };
};

export const createHostV2ProtocolRequestChunks = (options) => {
  const prepared = prepareV2BufferRequest(options);
  const header = createHostV2RequestHeader({
    requestLength: prepared.requestBytes.length,
    evidenceLength: prepared.evidenceInput.length,
    artifactZipLength: prepared.artifactInput.length,
  });
  return Object.freeze({
    chunks: Object.freeze([
      header,
      prepared.requestBytes,
      prepared.evidenceInput,
      prepared.artifactInput,
    ]),
    identity: prepared.identity,
    totalLength: header.length
      + prepared.requestBytes.length
      + prepared.evidenceInput.length
      + prepared.artifactInput.length,
  });
};

export const createHostV2ProtocolRequestFrame = (options) => {
  const prepared = prepareV2BufferRequest(options);
  return Object.freeze({
    frame: encodeHostV2RequestFrame({
      requestBytes: prepared.requestBytes,
      evidenceBytes: prepared.evidenceInput,
      artifactZipBytes: prepared.artifactInput,
    }),
    identity: prepared.identity,
  });
};

export const createHostV2ForwardRequestFrame = (options) => createHostV2ProtocolRequestFrame({
  ...options,
  kind: 'forward_submit',
});

export const createHostV2ForwardRequestChunks = (options) => createHostV2ProtocolRequestChunks({
  ...options,
  kind: 'forward_submit',
});

export const createHostV2RollbackRequestFrame = (options) => createHostV2ProtocolRequestFrame({
  ...options,
  kind: 'rollback_submit',
});

export const createHostV2RollbackRequestChunks = (options) => createHostV2ProtocolRequestChunks({
  ...options,
  kind: 'rollback_submit',
});

export const createHostV2StatusRequestFrame = (options) => createHostV2ProtocolRequestFrame({
  ...options,
  kind: 'status_query',
});

export const createHostV2StatusRequestChunks = (options) => createHostV2ProtocolRequestChunks({
  ...options,
  kind: 'status_query',
});

const normalizePath = (value) => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const sameFile = (left, right) => left.ino === right.ino
  && (process.platform === 'win32' || left.dev === right.dev);

const sameStableMetadata = (left, right) => sameFile(left, right)
  && left.size === right.size
  && left.mtimeNs === right.mtimeNs
  && left.ctimeNs === right.ctimeNs;

const assertOpenedArtifactPath = async ({ artifactPath, expectedStat, handle }) => {
  const handleStat = await handle.stat({ bigint: true });
  invariant(handleStat.isFile(), 'Host v2 artifact must remain a regular file');
  invariant(sameStableMetadata(handleStat, expectedStat), 'Host v2 artifact changed while it was being read');
  let pathStat;
  try {
    pathStat = await lstat(artifactPath, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('Host v2 artifact path was replaced while it was being read');
    throw error;
  }
  invariant(pathStat.isFile() && !pathStat.isSymbolicLink(), 'Host v2 artifact path must remain a real file');
  invariant(sameFile(pathStat, handleStat), 'Host v2 artifact path was replaced while it was being read');
};

const readOpenedFile = async function* (handle, length) {
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (position < length) {
    const wanted = Math.min(buffer.length, length - position);
    const { bytesRead } = await handle.read(buffer, 0, wanted, position);
    invariant(bytesRead > 0, 'Host v2 artifact became truncated while it was being read');
    position += bytesRead;
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
};

const hashOpenedArtifact = async ({ handle, length }) => {
  const hash = createHash('sha256');
  let consumed = 0;
  for await (const chunk of readOpenedFile(handle, length)) {
    hash.update(chunk);
    consumed += chunk.length;
  }
  invariant(consumed === length, 'Host v2 artifact length changed while it was being hashed');
  return hash.digest('hex');
};

// Pre-hashes a stable opened file because the digest is part of the leading
// canonical request metadata. The returned async iterable then streams the
// same open inode and verifies a second digest while emitting it. It never
// accumulates or copies the complete artifact in memory.
export const createHostV2ForwardRequestFileStream = async ({
  artifactZipPath,
  evidenceBytes,
  ...requestOptions
}) => {
  const evidenceSource = requireBuffer(evidenceBytes, 'Host v2 release evidence');
  const inspectedEvidence = inspectCanonicalEvidenceBytes(evidenceSource);
  invariant(inspectedEvidence.operation.name === requestOptions.operation, 'Requested operation does not match release evidence');
  invariant(inspectedEvidence.operation.trigger === requestOptions.trigger, 'Requested trigger does not match release evidence');
  const evidenceInput = Buffer.from(evidenceSource);
  invariant(typeof artifactZipPath === 'string' && artifactZipPath.length > 0, 'Host v2 artifact path is required');
  const resolvedPath = path.resolve(artifactZipPath);
  const preOpenStat = await lstat(resolvedPath, { bigint: true });
  invariant(preOpenStat.isFile() && !preOpenStat.isSymbolicLink(), 'Host v2 artifact path must be a real file');
  const canonicalPath = await realpath(resolvedPath);
  invariant(normalizePath(canonicalPath) === normalizePath(resolvedPath), 'Host v2 artifact path or one of its ancestors resolves through a symbolic link or junction');
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW || 0);
  const handle = await open(resolvedPath, fsConstants.O_RDONLY | noFollow);
  let closed = false;
  let consumed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };

  try {
    const initialStat = await handle.stat({ bigint: true });
    invariant(initialStat.isFile(), 'Host v2 artifact must be a regular file');
    invariant(sameStableMetadata(preOpenStat, initialStat), 'Host v2 artifact path changed while it was being opened');
    invariant(initialStat.size > 0n, 'Host v2 forward request requires a non-empty artifact ZIP');
    invariant(initialStat.size <= BigInt(MAX_HOST_V2_ARTIFACT_BYTES), 'Host v2 artifact ZIP length exceeds the limit');
    invariant(initialStat.size <= BigInt(Number.MAX_SAFE_INTEGER), 'Host v2 artifact ZIP length exceeds the safe integer range');
    const artifactLength = Number(initialStat.size);
    await assertOpenedArtifactPath({ artifactPath: resolvedPath, expectedStat: initialStat, handle });
    const artifactZipSha256 = await hashOpenedArtifact({ handle, length: artifactLength });
    await assertOpenedArtifactPath({ artifactPath: resolvedPath, expectedStat: initialStat, handle });
    invariant(inspectedEvidence.artifactZipSha256 === artifactZipSha256, 'Raw artifact ZIP does not match the authenticated release evidence digest');

    const request = createV2RequestDocument({
      ...requestOptions,
      kind: 'forward_submit',
      evidenceSha256: sha256(evidenceInput),
      artifactZipSha256,
    });
    const requestBytes = serializeCanonicalHostV2Request(request);
    const metadata = inspectHostV2RequestMetadata({
      requestBytes,
      evidenceBytes: evidenceInput,
      artifactZipLength: artifactLength,
    });
    const identity = finalizeHostV2RequestMetadata({ metadata, artifactZipSha256 });
    const header = createHostV2RequestHeader({
      requestLength: requestBytes.length,
      evidenceLength: evidenceInput.length,
      artifactZipLength: artifactLength,
    });

    const chunks = Object.freeze({
      async *[Symbol.asyncIterator]() {
        invariant(!consumed, 'Host v2 artifact request stream can be consumed only once');
        invariant(!closed, 'Host v2 artifact request stream is closed');
        consumed = true;
        const streamedHash = createHash('sha256');
        let streamedLength = 0;
        try {
          await assertOpenedArtifactPath({ artifactPath: resolvedPath, expectedStat: initialStat, handle });
          yield Buffer.from(header);
          yield Buffer.from(requestBytes);
          yield Buffer.from(evidenceInput);
          for await (const chunk of readOpenedFile(handle, artifactLength)) {
            streamedHash.update(chunk);
            streamedLength += chunk.length;
            yield chunk;
          }
          invariant(streamedLength === artifactLength, 'Host v2 streamed artifact length does not match its header');
          invariant(streamedHash.digest('hex') === artifactZipSha256, 'Host v2 artifact changed between hashing and transmission');
          await assertOpenedArtifactPath({ artifactPath: resolvedPath, expectedStat: initialStat, handle });
        } finally {
          await close();
        }
      },
    });

    return Object.freeze({
      chunks,
      identity,
      totalLength: HOST_V2_REQUEST_HEADER_BYTES
        + requestBytes.length
        + evidenceInput.length
        + artifactLength,
      artifactZipLength: artifactLength,
      artifactZipSha256,
      close,
    });
  } catch (error) {
    await close();
    throw error;
  }
};

export const validateHostV2ProtocolResponse = ({ responseFrame, requestIdentity }) => {
  const expected = validateHostV2RequestIdentity(requestIdentity);
  const response = decodeHostV2ResponseFrame(requireBuffer(responseFrame, 'Host v2 response frame'));
  invariant(response.requestId === expected.requestId, 'Host v2 response request ID does not match');
  invariant(response.kind === expected.kind, 'Host v2 response request kind does not match');
  invariant(response.requestSha256 === expected.requestSha256, 'Host v2 response request digest does not match');
  if (expected.kind === 'status_query' && response.code === 'STATUS_FOUND') {
    invariant(response.requestStatus.requestId === expected.subjectRequestId, 'Host v2 returned status does not match the requested subject');
  }
  return response;
};
