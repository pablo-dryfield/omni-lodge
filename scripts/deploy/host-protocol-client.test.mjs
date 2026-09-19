import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createHostProtocolRequestChunks,
  createHostProtocolRequestFrame,
  createHostV2ForwardRequestFileStream,
  createHostV2ForwardRequestFrame,
  createHostV2RollbackRequestFrame,
  createHostV2StatusRequestFrame,
  validateHostProtocolResponse,
  validateHostV2ProtocolResponse,
} from './host-protocol-client.mjs';
import {
  createHostResponse,
  decodeHostRequestFrame,
  encodeHostResponseFrame,
  serializeCanonicalHostJson,
} from './host/protocol.mjs';
import {
  createHostV2Response,
  decodeHostV2RequestFrame,
  encodeHostV2ResponseFrame,
} from './host/protocol-v2.mjs';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const SOURCE_SHA = 'b'.repeat(40);
const RELEASE_ID = `omnilodge-r987-a3-${SOURCE_SHA.slice(0, 12)}`;
const ARTIFACT = Buffer.from('PK\x03\x04caller-framing-test', 'binary');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const evidenceBytes = ({
  operation = 'deploy',
  trigger = 'manual',
  mode = 'manual',
  artifact = ARTIFACT,
} = {}) => {
  const artifactDigest = `sha256:${sha256(artifact)}`;
  return serializeCanonicalHostJson({
    schemaVersion: 2,
    operation: { name: operation, trigger },
    activationAuthorization: operation === 'deploy'
      ? { mode, authorized: true, reason: 'authorized' }
      : { mode, authorized: false, reason: 'activation_not_requested' },
    release: {
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      runId: '987',
      runAttempt: '3',
      artifactId: '654',
      artifactName: RELEASE_ID,
      artifactDigest,
    },
    productionEvidence: {
      workflowConclusion: 'success',
      artifactId: '654',
      artifactDigest,
      expectedReleaseId: RELEASE_ID,
      expectedSourceSha: SOURCE_SHA,
      expectedRepository: 'pablo-dryfield/omni-lodge',
      expectedWorkflowPath: '.github/workflows/release.yml',
      expectedEvent: 'push',
      expectedRef: 'refs/heads/master',
      expectedRunId: '987',
      expectedRunAttempt: '3',
      expectedArtifactName: RELEASE_ID,
    },
  });
};

const requestOptions = (overrides = {}) => ({
  requestId: REQUEST_ID,
  requestedAtUtc: '2026-09-16T15:00:00.000Z',
  actor: 'github-actions[bot]',
  operation: 'deploy',
  trigger: 'manual',
  evidenceBytes: evidenceBytes(),
  artifactZipBytes: ARTIFACT,
  ...overrides,
});

test('caller framing and chunked framing produce the same exact request bytes', () => {
  const framed = createHostProtocolRequestFrame(requestOptions());
  const chunked = createHostProtocolRequestChunks(requestOptions());
  const chunkedFrame = Buffer.concat(chunked.chunks);
  assert.deepEqual(chunkedFrame, framed.frame);
  assert.equal(chunked.totalLength, chunkedFrame.length);
  assert.deepEqual(chunked.identity, framed.identity);
  assert.deepEqual(decodeHostRequestFrame(framed.frame).identity, framed.identity);
});

test('caller refuses operation, trigger, and raw-artifact substitutions', () => {
  assert.throws(
    () => createHostProtocolRequestFrame(requestOptions({ operation: 'stage' })),
    /operation does not match/,
  );
  assert.throws(
    () => createHostProtocolRequestFrame(requestOptions({ trigger: 'automatic' })),
    /trigger does not match/,
  );
  assert.throws(
    () => createHostProtocolRequestFrame(requestOptions({
      artifactZipBytes: Buffer.from('different artifact'),
    })),
    /does not match the authenticated release evidence digest/,
  );
});

test('caller validates a sanitized response against every returned request binding', () => {
  const request = createHostProtocolRequestFrame(requestOptions());
  const responseFrame = encodeHostResponseFrame(createHostResponse({
    requestIdentity: request.identity,
    code: 'REQUEST_SUCCEEDED',
  }));
  const response = validateHostProtocolResponse({
    responseFrame,
    requestIdentity: request.identity,
  });
  assert.equal(response.code, 'REQUEST_SUCCEEDED');

  const substitutions = [
    ['requestId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', /request ID does not match/],
    ['releaseId', `omnilodge-r988-a3-${SOURCE_SHA.slice(0, 12)}`, /release ID does not match/],
    ['operation', 'stage', /operation does not match/],
    ['trigger', 'automatic', /trigger does not match/],
    ['auditSha256', 'd'.repeat(64), /audit digest does not match/],
    ['evidenceSha256', 'c'.repeat(64), /evidence digest does not match/],
  ];
  for (const [field, value, expected] of substitutions) {
    const forgedFrame = encodeHostResponseFrame({
      ...createHostResponse({ requestIdentity: request.identity, code: 'REQUEST_SUCCEEDED' }),
      [field]: value,
    });
    assert.throws(
      () => validateHostProtocolResponse({
        responseFrame: forgedFrame,
        requestIdentity: request.identity,
      }),
      expected,
    );
  }
});

test('caller rejects a response for the same request ID with different audit attribution', () => {
  const first = createHostProtocolRequestFrame(requestOptions());
  const second = createHostProtocolRequestFrame(requestOptions({
    requestedAtUtc: '2026-09-16T15:00:01.000Z',
    actor: 'different-actor',
  }));
  assert.notEqual(first.identity.auditSha256, second.identity.auditSha256);

  const firstResponse = encodeHostResponseFrame(createHostResponse({
    requestIdentity: first.identity,
    code: 'REQUEST_SUCCEEDED',
  }));
  assert.throws(
    () => validateHostProtocolResponse({
      responseFrame: firstResponse,
      requestIdentity: second.identity,
    }),
    /audit digest does not match/,
  );
});

test('caller rejects response framing with mandatory EOF', () => {
  const request = createHostProtocolRequestFrame(requestOptions());
  const responseFrame = encodeHostResponseFrame(createHostResponse({
    requestIdentity: request.identity,
    code: 'REQUEST_ACCEPTED',
  }));
  assert.throws(
    () => validateHostProtocolResponse({
      responseFrame: Buffer.concat([responseFrame, Buffer.from('\n')]),
      requestIdentity: request.identity,
    }),
    /trailing bytes/,
  );
});

const V2_ACTIVE = Object.freeze({
  activationId: '223e4567-e89b-42d3-a456-426614174001',
  snapshotSha256: 'a'.repeat(64),
});
const V2_TARGET = Object.freeze({
  activationId: '323e4567-e89b-42d3-a456-426614174002',
  snapshotSha256: 'b'.repeat(64),
});

const v2Base = (overrides = {}) => ({
  requestId: REQUEST_ID,
  requestedAtUtc: '2026-09-16T15:00:00.000Z',
  actor: 'github-actions[bot]',
  ...overrides,
});

test('v2 caller creates distinct forward, rollback, and status request variants', () => {
  const forward = createHostV2ForwardRequestFrame(v2Base({
    operation: 'deploy',
    trigger: 'manual',
    evidenceBytes: evidenceBytes(),
    artifactZipBytes: ARTIFACT,
  }));
  assert.equal(decodeHostV2RequestFrame(forward.frame).identity.kind, 'forward_submit');

  const rollback = createHostV2RollbackRequestFrame(v2Base({
    expectedActiveSnapshot: V2_ACTIVE,
    targetSnapshot: V2_TARGET,
  }));
  const decodedRollback = decodeHostV2RequestFrame(rollback.frame);
  assert.equal(decodedRollback.identity.kind, 'rollback_submit');
  assert.equal(decodedRollback.artifactZipBytes.length, 0);

  const status = createHostV2StatusRequestFrame(v2Base({
    subjectRequestId: V2_ACTIVE.activationId,
  }));
  assert.equal(decodeHostV2RequestFrame(status.frame).identity.kind, 'status_query');
});

test('v2 caller correlates status responses to request and subject identities', () => {
  const request = createHostV2StatusRequestFrame(v2Base({
    subjectRequestId: V2_ACTIVE.activationId,
  }));
  const response = createHostV2Response({
    requestIdentity: request.identity,
    code: 'STATUS_FOUND',
    requestStatus: {
      requestId: V2_ACTIVE.activationId,
      kind: 'rollback_submit',
      lifecycle: 'running',
      phase: 'pointers_switched',
      resultCode: null,
      updatedAtUtc: '2026-09-16T15:00:01.000Z',
    },
  });
  assert.equal(validateHostV2ProtocolResponse({
    responseFrame: encodeHostV2ResponseFrame(response),
    requestIdentity: request.identity,
  }).requestStatus.phase, 'pointers_switched');
  assert.throws(
    () => validateHostV2ProtocolResponse({
      responseFrame: encodeHostV2ResponseFrame(response),
      requestIdentity: createHostV2StatusRequestFrame(v2Base({
        requestId: '423e4567-e89b-42d3-a456-426614174003',
        subjectRequestId: V2_ACTIVE.activationId,
      })).identity,
    }),
    /request ID does not match/,
  );
});

const collect = async (iterable) => {
  const values = [];
  for await (const value of iterable) values.push(value);
  return Buffer.concat(values);
};

const createArtifactFile = async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-v2-client-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const artifactPath = path.join(directory, 'release.zip');
  await writeFile(artifactPath, ARTIFACT);
  return { directory, artifactPath };
};

test('file-backed v2 caller streams the exact forward frame without accumulating the ZIP', async (context) => {
  const { artifactPath } = await createArtifactFile(context);
  const fileRequest = await createHostV2ForwardRequestFileStream(v2Base({
    operation: 'deploy',
    trigger: 'manual',
    evidenceBytes: evidenceBytes(),
    artifactZipPath: artifactPath,
  }));
  const streamed = await collect(fileRequest.chunks);
  const buffered = createHostV2ForwardRequestFrame(v2Base({
    operation: 'deploy',
    trigger: 'manual',
    evidenceBytes: evidenceBytes(),
    artifactZipBytes: ARTIFACT,
  }));
  assert.deepEqual(streamed, buffered.frame);
  assert.deepEqual(fileRequest.identity, buffered.identity);
  assert.equal(fileRequest.totalLength, streamed.length);
  await fileRequest.close();
});

test('file-backed v2 caller rejects in-place mutation between pre-hash and transmission', async (context) => {
  const { artifactPath } = await createArtifactFile(context);
  const request = await createHostV2ForwardRequestFileStream(v2Base({
    operation: 'deploy',
    trigger: 'manual',
    evidenceBytes: evidenceBytes(),
    artifactZipPath: artifactPath,
  }));
  const replacement = Buffer.from(ARTIFACT);
  replacement[replacement.length - 1] ^= 0xff;
  await writeFile(artifactPath, replacement);
  await assert.rejects(collect(request.chunks), /changed|replaced/);
  await request.close();
});

test('file-backed v2 caller rejects path swaps and symbolic links', { skip: process.platform === 'win32' }, async (context) => {
  const { directory, artifactPath } = await createArtifactFile(context);
  const request = await createHostV2ForwardRequestFileStream(v2Base({
    operation: 'deploy',
    trigger: 'manual',
    evidenceBytes: evidenceBytes(),
    artifactZipPath: artifactPath,
  }));
  await rename(artifactPath, path.join(directory, 'original.zip'));
  await writeFile(artifactPath, ARTIFACT);
  await assert.rejects(collect(request.chunks), /replaced|changed while it was being read/);
  await request.close();

  const linkPath = path.join(directory, 'linked.zip');
  await symlink(path.join(directory, 'original.zip'), linkPath);
  await assert.rejects(
    createHostV2ForwardRequestFileStream(v2Base({
      operation: 'deploy',
      trigger: 'manual',
      evidenceBytes: evidenceBytes(),
      artifactZipPath: linkPath,
    })),
    /symbolic link or junction/,
  );
});
