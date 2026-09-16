import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createHostProtocolRequestChunks,
  createHostProtocolRequestFrame,
  validateHostProtocolResponse,
} from './host-protocol-client.mjs';
import {
  createHostResponse,
  decodeHostRequestFrame,
  encodeHostResponseFrame,
  serializeCanonicalHostJson,
} from './host/protocol.mjs';

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
