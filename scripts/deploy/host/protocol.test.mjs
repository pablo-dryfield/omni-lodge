import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import './protocol-v2.test.mjs';

import {
  HOST_AUDIT_SCHEMA_VERSION,
  HOST_REQUEST_HEADER_BYTES,
  HOST_RESPONSE_HEADER_BYTES,
  MAX_HOST_ARTIFACT_BYTES,
  MAX_HOST_AUDIT_BYTES,
  MAX_HOST_EVIDENCE_BYTES,
  MAX_HOST_RESPONSE_BYTES,
  createHostRequestHeader,
  createHostResponse,
  createHostResponseHeader,
  decodeHostRequestFrame,
  decodeHostResponseFrame,
  encodeHostRequestFrame,
  encodeHostResponseFrame,
  inspectCanonicalEvidenceBytes,
  parseHostRequestHeader,
  parseHostResponseHeader,
  serializeCanonicalHostJson,
  validateHostAuditRequest,
} from './protocol.mjs';
import {
  evaluateHostDeployPolicy,
  parseCanonicalHostDeployPolicyBytes,
  serializeCanonicalHostDeployPolicy,
} from './deploy-policy.mjs';
import { receiveHostRequestToFile } from './request-receiver.mjs';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const SOURCE_SHA = 'a'.repeat(40);
const RELEASE_ID = `omnilodge-r123-a2-${SOURCE_SHA.slice(0, 12)}`;
const ARTIFACT = Buffer.from('PK\x03\x04omnilodge-test-artifact', 'binary');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const buildEvidence = ({
  operation = 'deploy',
  trigger = 'manual',
  mode = 'manual',
  artifact = ARTIFACT,
} = {}) => {
  const artifactDigest = `sha256:${sha256(artifact)}`;
  const activationAuthorization = operation === 'deploy'
    ? { mode, authorized: true, reason: 'authorized' }
    : { mode, authorized: false, reason: 'activation_not_requested' };
  return {
    schemaVersion: 2,
    operation: { name: operation, trigger },
    activationAuthorization,
    release: {
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      runId: '123',
      runAttempt: '2',
      artifactId: '456',
      artifactName: RELEASE_ID,
      artifactDigest,
    },
    productionEvidence: {
      workflowConclusion: 'success',
      artifactId: '456',
      artifactDigest,
      expectedReleaseId: RELEASE_ID,
      expectedSourceSha: SOURCE_SHA,
      expectedRepository: 'pablo-dryfield/omni-lodge',
      expectedWorkflowPath: '.github/workflows/release.yml',
      expectedEvent: 'push',
      expectedRef: 'refs/heads/master',
      expectedRunId: '123',
      expectedRunAttempt: '2',
      expectedArtifactName: RELEASE_ID,
    },
  };
};

const buildAudit = ({
  evidenceBytes,
  artifact = ARTIFACT,
  operation = 'deploy',
  trigger = 'manual',
  requestId = REQUEST_ID,
  extra = {},
}) => ({
  schemaVersion: HOST_AUDIT_SCHEMA_VERSION,
  requestId,
  requestedAtUtc: '2026-09-16T12:34:56.000Z',
  actor: 'pablo-dryfield',
  operation: { name: operation, trigger },
  evidenceSha256: sha256(evidenceBytes),
  artifactZipSha256: sha256(artifact),
  ...extra,
});

const buildFrame = ({
  evidence = buildEvidence(),
  evidenceBytes = serializeCanonicalHostJson(evidence),
  artifact = ARTIFACT,
  audit = buildAudit({
    evidenceBytes,
    artifact,
    operation: evidence.operation.name,
    trigger: evidence.operation.trigger,
  }),
  auditBytes = serializeCanonicalHostJson(audit),
} = {}) => encodeHostRequestFrame({
  auditBytes,
  evidenceBytes,
  artifactZipBytes: artifact,
});

const expectedIdentity = () => {
  const evidenceBytes = serializeCanonicalHostJson(buildEvidence());
  const auditBytes = serializeCanonicalHostJson(buildAudit({ evidenceBytes }));
  return {
    requestId: REQUEST_ID,
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    operation: 'deploy',
    trigger: 'manual',
    auditSha256: sha256(auditBytes),
    evidenceSha256: sha256(evidenceBytes),
    artifactZipSha256: sha256(ARTIFACT),
  };
};

const chunkedBytes = async function* (bytes, chunkSizes = [1, 3, 17, 64, 5, 1024]) {
  let offset = 0;
  let index = 0;
  while (offset < bytes.length) {
    const size = chunkSizes[index % chunkSizes.length];
    const end = Math.min(bytes.length, offset + size);
    yield bytes.subarray(offset, end);
    offset = end;
    index += 1;
  }
};

const createReceiverDirectory = async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-host-request-'));
  context.after(async () => rm(directory, { recursive: true, force: true }));
  return directory;
};

test('round-trips a canonical request and binds audit, evidence, and raw ZIP identity', () => {
  const decoded = decodeHostRequestFrame(buildFrame());
  assert.deepEqual(decoded.identity, expectedIdentity());
  assert.equal(decoded.audit.actor, 'pablo-dryfield');
  assert.equal(decoded.evidence.artifactZipSha256, sha256(ARTIFACT));
  assert.deepEqual(decoded.artifactZipBytes, ARTIFACT);
});

test('binds actor and timestamp changes through the canonical audit digest', () => {
  const evidenceBytes = serializeCanonicalHostJson(buildEvidence());
  const firstAudit = buildAudit({ evidenceBytes });
  const secondAudit = {
    ...firstAudit,
    requestedAtUtc: '2026-09-16T12:34:57.000Z',
    actor: 'different-actor',
  };
  const first = decodeHostRequestFrame(buildFrame({ evidenceBytes, audit: firstAudit }));
  const second = decodeHostRequestFrame(buildFrame({ evidenceBytes, audit: secondAudit }));
  assert.notEqual(first.identity.auditSha256, second.identity.auditSha256);
  assert.deepEqual(
    { ...first.identity, auditSha256: second.identity.auditSha256 },
    second.identity,
  );
});

test('streams a request into an exclusive artifact file and supports identity-safe cleanup', async (context) => {
  const directory = await createReceiverDirectory(context);
  const frame = buildFrame();
  const received = await receiveHostRequestToFile({
    input: chunkedBytes(frame),
    artifactDirectory: directory,
  });

  assert.deepEqual(received.identity, expectedIdentity());
  assert.deepEqual(received.audit, buildAudit({
    evidenceBytes: serializeCanonicalHostJson(buildEvidence()),
  }));
  assert.deepEqual(await readFile(received.artifactZipPath), ARTIFACT);
  assert.equal(received.artifactZipLength, ARTIFACT.length);
  assert.equal((await readdir(directory)).length, 1);
  await received.cleanupArtifact();
  await received.cleanupArtifact();
  assert.deepEqual(await readdir(directory), []);
});

test('streaming receiver rejects truncation, trailing bytes, and digest substitution without residue', async (context) => {
  for (const [name, frame, expected] of [
    ['truncated', buildFrame().subarray(0, -1), /artifact ZIP is truncated/],
    ['trailing', Buffer.concat([buildFrame(), Buffer.from([0])]), /trailing bytes/],
    ['substituted', (() => {
      const value = Buffer.from(buildFrame());
      value[value.length - 1] ^= 0xff;
      return value;
    })(), /artifact digest does not match the raw ZIP/],
  ]) {
    const directory = await createReceiverDirectory(context);
    await assert.rejects(
      receiveHostRequestToFile({
        input: chunkedBytes(frame, [2, 11, 7]),
        artifactDirectory: directory,
      }),
      expected,
      name,
    );
    assert.deepEqual(await readdir(directory), [], name);
  }
});

test('streaming receiver rejects oversized metadata from the header before creating a file', async (context) => {
  const directory = await createReceiverDirectory(context);
  const header = createHostRequestHeader({
    auditLength: 1,
    evidenceLength: 1,
    artifactZipLength: 1,
  });
  header.writeUInt32BE(MAX_HOST_EVIDENCE_BYTES + 1, 16);
  await assert.rejects(
    receiveHostRequestToFile({
      input: chunkedBytes(header),
      artifactDirectory: directory,
    }),
    /release evidence length.*exceeds/,
  );
  assert.deepEqual(await readdir(directory), []);
});

test('rejects truncated and trailing request frames with mandatory EOF', () => {
  const frame = buildFrame();
  assert.throws(
    () => decodeHostRequestFrame(frame.subarray(0, HOST_REQUEST_HEADER_BYTES - 1)),
    /truncated/,
  );
  assert.throws(() => decodeHostRequestFrame(frame.subarray(0, -1)), /truncated/);
  assert.throws(
    () => decodeHostRequestFrame(Buffer.concat([frame, Buffer.from([0])])),
    /trailing bytes/,
  );
});

test('rejects invalid request magic, version, header size, and reserved fields', () => {
  for (const [offset, writer, expected] of [
    [0, (value) => value.writeUInt8(0, 0), /magic/],
    [8, (value) => value.writeUInt16BE(2, 8), /version/],
    [10, (value) => value.writeUInt16BE(31, 10), /header size/],
    [28, (value) => value.writeUInt32BE(1, 28), /reserved/],
  ]) {
    const header = createHostRequestHeader({
      auditLength: 1,
      evidenceLength: 1,
      artifactZipLength: 1,
    });
    writer(header, offset);
    assert.throws(() => parseHostRequestHeader(header), expected);
  }
});

test('bounds every request length before payload allocation or parsing', () => {
  const cases = [
    [12, MAX_HOST_AUDIT_BYTES + 1, /audit request length.*exceeds/],
    [16, MAX_HOST_EVIDENCE_BYTES + 1, /release evidence length.*exceeds/],
  ];
  for (const [offset, length, expected] of cases) {
    const header = createHostRequestHeader({
      auditLength: 1,
      evidenceLength: 1,
      artifactZipLength: 1,
    });
    header.writeUInt32BE(length, offset);
    assert.throws(() => parseHostRequestHeader(header), expected);
  }
  const artifactHeader = createHostRequestHeader({
    auditLength: 1,
    evidenceLength: 1,
    artifactZipLength: 1,
  });
  artifactHeader.writeBigUInt64BE(BigInt(MAX_HOST_ARTIFACT_BYTES) + 1n, 20);
  assert.throws(() => parseHostRequestHeader(artifactHeader), /artifact ZIP length.*exceeds/);
});

test('rejects duplicate, alternate, trailing, and unrecognized audit JSON', () => {
  const evidenceBytes = serializeCanonicalHostJson(buildEvidence());
  const audit = buildAudit({ evidenceBytes });
  const canonical = serializeCanonicalHostJson(audit);
  const duplicates = Buffer.from(
    canonical.toString('utf8').replace(
      '{\n',
      `{\n  "schemaVersion": 1,\n`,
    ),
    'utf8',
  );
  const compact = Buffer.from(JSON.stringify(audit), 'utf8');
  const trailing = Buffer.concat([canonical, Buffer.from('\n')]);
  const extra = serializeCanonicalHostJson({ ...audit, unexpected: true });

  for (const bytes of [duplicates, compact, trailing, extra]) {
    assert.throws(
      () => decodeHostRequestFrame(buildFrame({ evidenceBytes, auditBytes: bytes })),
      /canonical JSON|schema is not canonical/,
    );
  }
});

test('rejects duplicate and unrecognized evidence JSON before policy evaluation', () => {
  const canonical = serializeCanonicalHostJson(buildEvidence());
  const duplicate = Buffer.from(
    canonical.toString('utf8').replace('{\n', '{\n  "schemaVersion": 2,\n'),
    'utf8',
  );
  const extra = serializeCanonicalHostJson({ ...buildEvidence(), unexpected: true });
  for (const evidenceBytes of [duplicate, extra]) {
    const audit = buildAudit({ evidenceBytes });
    assert.throws(
      () => decodeHostRequestFrame(buildFrame({ evidenceBytes, audit })),
      /canonical JSON|schema is not canonical/,
    );
  }
});

test('rejects oversized decimal identifiers before BigInt conversion', () => {
  const evidence = buildEvidence();
  evidence.release.runId = '9'.repeat(32 * 1024);
  const evidenceBytes = serializeCanonicalHostJson(evidence);
  assert.ok(evidenceBytes.length < MAX_HOST_EVIDENCE_BYTES);
  assert.throws(
    () => inspectCanonicalEvidenceBytes(evidenceBytes),
    /run ID exceeds the safe integer decimal length/,
  );
});

test('rejects evidence whose activation fields contradict its operation and trigger', () => {
  const evidence = buildEvidence();
  evidence.activationAuthorization = {
    mode: 'manual',
    authorized: false,
    reason: 'activation_not_requested',
  };
  const evidenceBytes = serializeCanonicalHostJson(evidence);
  assert.throws(
    () => decodeHostRequestFrame(buildFrame({ evidenceBytes })),
    /activation authorization is inconsistent/,
  );

  const automaticStage = buildEvidence({
    operation: 'stage',
    trigger: 'automatic',
    mode: 'automatic',
  });
  const automaticStageBytes = serializeCanonicalHostJson(automaticStage);
  assert.throws(
    () => decodeHostRequestFrame(buildFrame({
      evidence: automaticStage,
      evidenceBytes: automaticStageBytes,
    })),
    /Automatic stage operations are not allowed/,
  );
});

test('rejects operation and trigger mismatches between audit request and evidence', () => {
  const evidenceBytes = serializeCanonicalHostJson(buildEvidence());
  assert.throws(
    () => decodeHostRequestFrame(buildFrame({
      evidenceBytes,
      audit: buildAudit({ evidenceBytes, operation: 'stage' }),
    })),
    /operation does not match/,
  );
  assert.throws(
    () => decodeHostRequestFrame(buildFrame({
      evidenceBytes,
      audit: buildAudit({ evidenceBytes, trigger: 'automatic' }),
    })),
    /trigger does not match/,
  );
});

test('rejects malformed request IDs and artifact or evidence substitution', () => {
  const evidenceBytes = serializeCanonicalHostJson(buildEvidence());
  assert.throws(
    () => decodeHostRequestFrame(buildFrame({
      evidenceBytes,
      audit: buildAudit({ evidenceBytes, requestId: 'request-123' }),
    })),
    /UUID v4/,
  );

  const artifact = Buffer.from(ARTIFACT);
  artifact[artifact.length - 1] ^= 0xff;
  assert.throws(
    () => decodeHostRequestFrame(buildFrame({ artifact })),
    /evidence artifact digest does not match|artifact digest does not match/,
  );

  const wrongEvidence = serializeCanonicalHostJson(buildEvidence());
  const audit = buildAudit({ evidenceBytes: wrongEvidence });
  wrongEvidence[wrongEvidence.length - 2] = 0x20;
  assert.throws(
    () => decodeHostRequestFrame(buildFrame({ evidenceBytes: wrongEvidence, audit })),
    /valid JSON|canonical JSON|evidence digest does not match/,
  );
});

test('parses only exact canonical host deploy policy JSON', () => {
  const canonical = serializeCanonicalHostJson({
    schemaVersion: 1,
    deploymentMode: 'disabled',
  });
  assert.deepEqual(
    serializeCanonicalHostDeployPolicy({
      schemaVersion: 1,
      deploymentMode: 'disabled',
    }),
    canonical,
  );
  assert.deepEqual(parseCanonicalHostDeployPolicyBytes(canonical), {
    schemaVersion: 1,
    deploymentMode: 'disabled',
  });
  assert.throws(
    () => parseCanonicalHostDeployPolicyBytes(Buffer.from('{"schemaVersion":1,"deploymentMode":"manual"}')),
    /canonical JSON/,
  );
  assert.throws(
    () => parseCanonicalHostDeployPolicyBytes(Buffer.from(
      '{\n  "schemaVersion": 1,\n  "schemaVersion": 1,\n  "deploymentMode": "manual"\n}\n',
    )),
    /canonical JSON/,
  );
  assert.throws(
    () => parseCanonicalHostDeployPolicyBytes(serializeCanonicalHostJson({
      schemaVersion: 1,
      deploymentMode: 'manual',
      extra: true,
    })),
    /schema is not canonical/,
  );
  assert.throws(
    () => parseCanonicalHostDeployPolicyBytes(serializeCanonicalHostJson({
      schemaVersion: 1,
      deploymentMode: 'enabled',
    })),
    /mode is invalid/,
  );
  assert.throws(
    () => parseCanonicalHostDeployPolicyBytes(Buffer.alloc(MAX_HOST_AUDIT_BYTES, 0x20)),
    /exceeds the limit/,
  );
});

test('re-derives the complete disabled/manual/automatic host operation matrix', () => {
  const identity = expectedIdentity();
  const policy = (deploymentMode) => ({ schemaVersion: 1, deploymentMode });
  const decision = (deploymentMode, operation, trigger) => evaluateHostDeployPolicy({
    policy: policy(deploymentMode),
    requestIdentity: { ...identity, operation, trigger },
  });

  assert.equal(decision('disabled', 'deploy', 'manual').authorized, false);
  assert.equal(decision('manual', 'deploy', 'manual').authorized, true);
  assert.equal(decision('manual', 'deploy', 'automatic').authorized, false);
  assert.equal(decision('automatic', 'deploy', 'manual').authorized, true);
  assert.equal(decision('automatic', 'deploy', 'automatic').authorized, true);
  for (const mode of ['disabled', 'manual', 'automatic']) {
    assert.equal(decision(mode, 'stage', 'manual').authorized, true);
    assert.equal(decision(mode, 'dry-run', 'manual').authorized, true);
    assert.throws(
      () => decision(mode, 'stage', 'automatic'),
      /Automatic stage operations are not allowed/,
    );
    assert.throws(
      () => decision(mode, 'dry-run', 'automatic'),
      /Automatic dry-run operations are not allowed/,
    );
  }
});

test('binds policy decisions to the complete validated request identity', () => {
  const identity = expectedIdentity();
  const result = evaluateHostDeployPolicy({
    policy: { schemaVersion: 1, deploymentMode: 'manual' },
    requestIdentity: identity,
  });
  assert.deepEqual(result, {
    ...identity,
    deploymentMode: 'manual',
    authorized: true,
    reason: 'authorized',
  });
  assert.throws(
    () => evaluateHostDeployPolicy({
      policy: { schemaVersion: 1, deploymentMode: 'manual' },
      requestIdentity: { ...identity, unexpected: true },
    }),
    /identity schema is not canonical/,
  );
});

test('round-trips only code-derived sanitized canonical responses', () => {
  const identity = expectedIdentity();
  const response = createHostResponse({ requestIdentity: identity, code: 'REQUEST_FAILED' });
  assert.equal(response.message, 'The host could not complete the request.');
  assert.equal(response.status, 'failed');
  assert.deepEqual(decodeHostResponseFrame(encodeHostResponseFrame(response)), response);

  const forged = serializeCanonicalHostJson({
    ...response,
    message: 'Failure in /etc/omnilodge/backend.env: SECRET=value',
  });
  const forgedFrame = Buffer.concat([createHostResponseHeader(forged.length), forged]);
  assert.throws(() => decodeHostResponseFrame(forgedFrame), /message is not canonical/);
  assert.throws(
    () => createHostResponse({ requestIdentity: identity, code: 'DATABASE_PASSWORD' }),
    /response code is invalid/,
  );
  const inconsistent = serializeCanonicalHostJson({
    ...response,
    status: 'succeeded',
  });
  assert.throws(
    () => decodeHostResponseFrame(Buffer.concat([
      createHostResponseHeader(inconsistent.length),
      inconsistent,
    ])),
    /status does not match/,
  );
});

test('rejects noncanonical, truncated, oversized, and trailing response frames', () => {
  const response = createHostResponse({
    requestIdentity: expectedIdentity(),
    code: 'REQUEST_ACCEPTED',
  });
  const canonicalFrame = encodeHostResponseFrame(response);
  assert.throws(
    () => decodeHostResponseFrame(canonicalFrame.subarray(0, HOST_RESPONSE_HEADER_BYTES - 1)),
    /truncated/,
  );
  assert.throws(() => decodeHostResponseFrame(canonicalFrame.subarray(0, -1)), /truncated/);
  assert.throws(
    () => decodeHostResponseFrame(Buffer.concat([canonicalFrame, Buffer.from([0])])),
    /trailing bytes/,
  );

  const compact = Buffer.from(JSON.stringify(response));
  assert.throws(
    () => decodeHostResponseFrame(Buffer.concat([
      createHostResponseHeader(compact.length),
      compact,
    ])),
    /canonical JSON/,
  );
  const duplicate = Buffer.from(
    serializeCanonicalHostJson(response)
      .toString('utf8')
      .replace('{\n', '{\n  "schemaVersion": 1,\n'),
    'utf8',
  );
  assert.throws(
    () => decodeHostResponseFrame(Buffer.concat([
      createHostResponseHeader(duplicate.length),
      duplicate,
    ])),
    /canonical JSON/,
  );
  const extra = serializeCanonicalHostJson({ ...response, internalPath: '/root/secret' });
  assert.throws(
    () => decodeHostResponseFrame(Buffer.concat([
      createHostResponseHeader(extra.length),
      extra,
    ])),
    /schema is not canonical/,
  );

  const oversized = Buffer.alloc(HOST_RESPONSE_HEADER_BYTES);
  createHostResponseHeader(1).copy(oversized);
  oversized.writeUInt32BE(MAX_HOST_RESPONSE_BYTES + 1, 12);
  assert.throws(() => parseHostResponseHeader(oversized), /exceeds the limit/);
});
