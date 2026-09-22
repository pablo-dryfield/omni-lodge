import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createHostV2ForwardRequestFile,
  createHostV2RollbackRequestFile,
  createHostV2StatusRequestFile,
  serializeHostV2RequestCreationResult,
} from './create-host-v2-request.mjs';
import { serializeCanonicalHostJson } from './host/protocol.mjs';
import { decodeHostV2RequestFrame } from './host/protocol-v2.mjs';

const SOURCE_SHA = '1234567890abcdef1234567890abcdef12345678';
const RUN_ID = '35459235360';
const RUN_ATTEMPT = '1';
const ARTIFACT_ID = '99112233';
const RELEASE_ID = `omnilodge-r${RUN_ID}-a${RUN_ATTEMPT}-${SOURCE_SHA.slice(0, 12)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const REQUESTED_AT_UTC = '2026-09-20T12:00:00.000Z';
const ARTIFACT = Buffer.from('PK\x03\x04host-v2-request-cli-test-artifact', 'binary');
const EXPECTED_ACTIVE_SNAPSHOT = Object.freeze({
  activationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  snapshotSha256: '1'.repeat(64),
});
const TARGET_SNAPSHOT = Object.freeze({
  activationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  snapshotSha256: '2'.repeat(64),
});

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const evidenceBytes = ({
  operation = 'deploy',
  trigger = 'manual',
  mode = 'manual',
} = {}) => {
  const artifactDigest = `sha256:${sha256(ARTIFACT)}`;
  return serializeCanonicalHostJson({
    schemaVersion: 2,
    operation: { name: operation, trigger },
    activationAuthorization: operation === 'deploy'
      ? { mode, authorized: true, reason: 'authorized' }
      : { mode, authorized: false, reason: 'activation_not_requested' },
    release: {
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      artifactId: ARTIFACT_ID,
      artifactName: RELEASE_ID,
      artifactDigest,
    },
    productionEvidence: {
      workflowConclusion: 'success',
      artifactId: ARTIFACT_ID,
      artifactDigest,
      expectedReleaseId: RELEASE_ID,
      expectedSourceSha: SOURCE_SHA,
      expectedRepository: 'pablo-dryfield/omni-lodge',
      expectedWorkflowPath: '.github/workflows/release.yml',
      expectedEvent: 'push',
      expectedRef: 'refs/heads/master',
      expectedRunId: RUN_ID,
      expectedRunAttempt: RUN_ATTEMPT,
      expectedArtifactName: RELEASE_ID,
    },
  });
};

const makeFixture = (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-host-v2-request-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactPath = path.join(root, 'artifact.zip');
  const evidencePath = path.join(root, 'evidence.json');
  const outputPath = path.join(root, 'host-request.bin');
  const identityOutputPath = path.join(root, 'host-request-identity.json');
  const evidence = evidenceBytes();
  fs.writeFileSync(artifactPath, ARTIFACT);
  fs.writeFileSync(evidencePath, evidence);
  return { root, artifactPath, evidencePath, outputPath, identityOutputPath, evidence };
};

const requestOptions = (fixture, overrides = {}) => ({
  artifactZipPath: fixture.artifactPath,
  evidencePath: fixture.evidencePath,
  requestId: REQUEST_ID,
  requestedAtUtc: REQUESTED_AT_UTC,
  actor: 'github-actions[bot]',
  operation: 'deploy',
  trigger: 'manual',
  outputPath: fixture.outputPath,
  identityOutputPath: fixture.identityOutputPath,
  ...overrides,
});

test('creates a file-backed host v2 forward request and identity document', async (context) => {
  const fixture = makeFixture(context);
  const result = await createHostV2ForwardRequestFile(requestOptions(fixture));
  const requestBytes = fs.readFileSync(fixture.outputPath);
  const identityText = fs.readFileSync(fixture.identityOutputPath, 'utf8');
  const identity = JSON.parse(identityText);
  const decoded = decodeHostV2RequestFrame(requestBytes);

  assert.deepEqual(identity, result);
  assert.equal(identityText, serializeHostV2RequestCreationResult(result));
  assert.equal(result.hostProtocolVersion, 2);
  assert.equal(result.requestIdentity.kind, 'forward_submit');
  assert.equal(result.requestIdentity.releaseId, RELEASE_ID);
  assert.equal(result.requestIdentity.operation, 'deploy');
  assert.equal(result.requestIdentity.trigger, 'manual');
  assert.equal(result.requestFrameBytes, requestBytes.length);
  assert.equal(result.requestFrameSha256, sha256(requestBytes));
  assert.equal(result.artifactZipSha256, sha256(ARTIFACT));
  assert.deepEqual(decoded.identity, result.requestIdentity);
  assert.deepEqual(decoded.evidenceBytes, fixture.evidence);
  assert.deepEqual(decoded.artifactZipBytes, ARTIFACT);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(fixture.outputPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(fixture.identityOutputPath).mode & 0o777, 0o600);
  }
});

test('creates an artifact-free host v2 rollback request and identity document', async (context) => {
  const fixture = makeFixture(context);
  const result = await createHostV2RollbackRequestFile({
    requestId: REQUEST_ID,
    requestedAtUtc: REQUESTED_AT_UTC,
    actor: 'github-actions[bot]',
    expectedActiveSnapshot: EXPECTED_ACTIVE_SNAPSHOT,
    targetSnapshot: TARGET_SNAPSHOT,
    outputPath: fixture.outputPath,
    identityOutputPath: fixture.identityOutputPath,
  });
  const requestBytes = fs.readFileSync(fixture.outputPath);
  const identityText = fs.readFileSync(fixture.identityOutputPath, 'utf8');
  const identity = JSON.parse(identityText);
  const decoded = decodeHostV2RequestFrame(requestBytes);

  assert.deepEqual(identity, result);
  assert.equal(identityText, serializeHostV2RequestCreationResult(result));
  assert.equal(result.hostProtocolVersion, 2);
  assert.equal(result.requestIdentity.kind, 'rollback_submit');
  assert.equal(result.requestIdentity.trigger, 'manual');
  assert.deepEqual(result.requestIdentity.expectedActiveSnapshot, EXPECTED_ACTIVE_SNAPSHOT);
  assert.deepEqual(result.requestIdentity.targetSnapshot, TARGET_SNAPSHOT);
  assert.equal(result.requestFrameBytes, requestBytes.length);
  assert.equal(result.requestFrameSha256, sha256(requestBytes));
  assert.equal(result.artifactZipLength, 0);
  assert.equal(result.artifactZipSha256, null);
  assert.deepEqual(decoded.identity, result.requestIdentity);
  assert.equal(decoded.evidenceBytes.length, 0);
  assert.equal(decoded.artifactZipBytes.length, 0);
});

test('creates an artifact-free host v2 status request and identity document', async (context) => {
  const fixture = makeFixture(context);
  const result = await createHostV2StatusRequestFile({
    requestId: REQUEST_ID,
    requestedAtUtc: REQUESTED_AT_UTC,
    actor: 'github-actions[bot]',
    subjectRequestId: TARGET_SNAPSHOT.activationId,
    outputPath: fixture.outputPath,
    identityOutputPath: fixture.identityOutputPath,
  });
  const requestBytes = fs.readFileSync(fixture.outputPath);
  const identityText = fs.readFileSync(fixture.identityOutputPath, 'utf8');
  const identity = JSON.parse(identityText);
  const decoded = decodeHostV2RequestFrame(requestBytes);

  assert.deepEqual(identity, result);
  assert.equal(identityText, serializeHostV2RequestCreationResult(result));
  assert.equal(result.hostProtocolVersion, 2);
  assert.equal(result.requestIdentity.kind, 'status_query');
  assert.equal(result.requestIdentity.subjectRequestId, TARGET_SNAPSHOT.activationId);
  assert.equal(result.requestFrameBytes, requestBytes.length);
  assert.equal(result.requestFrameSha256, sha256(requestBytes));
  assert.equal(result.artifactZipLength, 0);
  assert.equal(result.artifactZipSha256, null);
  assert.deepEqual(decoded.identity, result.requestIdentity);
  assert.equal(decoded.evidenceBytes.length, 0);
  assert.equal(decoded.artifactZipBytes.length, 0);
});

test('cleans up a streamed request when the identity output cannot be created', async (context) => {
  const fixture = makeFixture(context);
  fs.writeFileSync(fixture.identityOutputPath, 'existing identity');
  await assert.rejects(
    createHostV2ForwardRequestFile(requestOptions(fixture)),
    /EEXIST|already exists|file exists/i,
  );
  assert.equal(fs.existsSync(fixture.outputPath), false);
  assert.equal(fs.readFileSync(fixture.identityOutputPath, 'utf8'), 'existing identity');
});

test('CLI writes a canonical rollback identity document', (context) => {
  const fixture = makeFixture(context);
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'create-host-v2-request.mjs',
  );
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--kind',
    'rollback',
    '--request-id',
    REQUEST_ID,
    '--requested-at-utc',
    REQUESTED_AT_UTC,
    '--actor',
    'github-actions[bot]',
    '--expected-active-snapshot',
    `${EXPECTED_ACTIVE_SNAPSHOT.activationId}:${EXPECTED_ACTIVE_SNAPSHOT.snapshotSha256}`,
    '--target-snapshot',
    `${TARGET_SNAPSHOT.activationId}:${TARGET_SNAPSHOT.snapshotSha256}`,
    '--output',
    fixture.outputPath,
    '--identity-output',
    fixture.identityOutputPath,
  ], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, fs.readFileSync(fixture.identityOutputPath, 'utf8'));
  const identity = JSON.parse(result.stdout);
  assert.equal(identity.requestIdentity.kind, 'rollback_submit');
  assert.equal(identity.artifactZipLength, 0);
  assert.equal(identity.requestFrameSha256, sha256(fs.readFileSync(fixture.outputPath)));
});

test('CLI writes a canonical status identity document', (context) => {
  const fixture = makeFixture(context);
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'create-host-v2-request.mjs',
  );
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--kind',
    'status',
    '--request-id',
    REQUEST_ID,
    '--requested-at-utc',
    REQUESTED_AT_UTC,
    '--actor',
    'github-actions[bot]',
    '--subject-request-id',
    TARGET_SNAPSHOT.activationId,
    '--output',
    fixture.outputPath,
    '--identity-output',
    fixture.identityOutputPath,
  ], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, fs.readFileSync(fixture.identityOutputPath, 'utf8'));
  const identity = JSON.parse(result.stdout);
  assert.equal(identity.requestIdentity.kind, 'status_query');
  assert.equal(identity.requestIdentity.subjectRequestId, TARGET_SNAPSHOT.activationId);
  assert.equal(identity.artifactZipLength, 0);
  assert.equal(identity.requestFrameSha256, sha256(fs.readFileSync(fixture.outputPath)));
});

test('CLI writes the same canonical identity document', (context) => {
  const fixture = makeFixture(context);
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    'create-host-v2-request.mjs',
  );
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--artifact-zip',
    fixture.artifactPath,
    '--evidence-json',
    fixture.evidencePath,
    '--request-id',
    REQUEST_ID,
    '--requested-at-utc',
    REQUESTED_AT_UTC,
    '--actor',
    'github-actions[bot]',
    '--operation',
    'deploy',
    '--trigger',
    'manual',
    '--output',
    fixture.outputPath,
    '--identity-output',
    fixture.identityOutputPath,
  ], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, fs.readFileSync(fixture.identityOutputPath, 'utf8'));
  const identity = JSON.parse(result.stdout);
  assert.equal(identity.requestIdentity.releaseId, RELEASE_ID);
  assert.equal(identity.requestFrameSha256, sha256(fs.readFileSync(fixture.outputPath)));
});
