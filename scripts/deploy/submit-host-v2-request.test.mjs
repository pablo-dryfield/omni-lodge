import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
  createHostV2ForwardRequestFile,
  createHostV2StatusRequestFile,
} from './create-host-v2-request.mjs';
import {
  buildSshArguments,
  serializeHostV2SubmitResult,
  submitHostV2Request,
} from './submit-host-v2-request.mjs';
import { serializeCanonicalHostJson } from './host/protocol.mjs';
import {
  createHostV2Response,
  decodeHostV2RequestFrame,
  encodeHostV2ResponseFrame,
} from './host/protocol-v2.mjs';

const SOURCE_SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const RUN_ID = '35625425675';
const RUN_ATTEMPT = '1';
const ARTIFACT_ID = '10651797247';
const RELEASE_ID = `omnilodge-r${RUN_ID}-a${RUN_ATTEMPT}-${SOURCE_SHA.slice(0, 12)}`;
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const SUBJECT_REQUEST_ID = '223e4567-e89b-42d3-a456-426614174001';
const REQUESTED_AT_UTC = '2026-09-21T16:36:28.000Z';
const ARTIFACT = Buffer.from('PK\x03\x04submit-host-v2-request-test-artifact', 'binary');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const evidenceBytes = ({
  operation = 'dry-run',
  trigger = 'manual',
  mode = 'disabled',
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

const makeFixture = async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-submit-host-v2-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactPath = path.join(root, 'artifact.zip');
  const evidencePath = path.join(root, 'evidence.json');
  const requestPath = path.join(root, 'host-request.bin');
  const identityPath = path.join(root, 'host-request-identity.json');
  const keyPath = path.join(root, 'deploy-key');
  const knownHostsPath = path.join(root, 'known_hosts');
  fs.writeFileSync(artifactPath, ARTIFACT);
  fs.writeFileSync(evidencePath, evidenceBytes());
  fs.writeFileSync(keyPath, 'not-a-real-private-key-for-unit-tests\n');
  fs.writeFileSync(knownHostsPath, '203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest\n');
  await createHostV2ForwardRequestFile({
    artifactZipPath: artifactPath,
    evidencePath,
    requestId: REQUEST_ID,
    requestedAtUtc: REQUESTED_AT_UTC,
    actor: 'github-actions[bot]',
    operation: 'dry-run',
    trigger: 'manual',
    outputPath: requestPath,
    identityOutputPath: identityPath,
  });
  return {
    root,
    requestPath,
    identityPath,
    keyPath,
    knownHostsPath,
  };
};

const makeStatusFixture = async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-submit-host-v2-status-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requestPath = path.join(root, 'host-status-request.bin');
  const identityPath = path.join(root, 'host-status-request-identity.json');
  const keyPath = path.join(root, 'deploy-key');
  const knownHostsPath = path.join(root, 'known_hosts');
  fs.writeFileSync(keyPath, 'not-a-real-private-key-for-unit-tests\n');
  fs.writeFileSync(knownHostsPath, '203.0.113.10 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest\n');
  await createHostV2StatusRequestFile({
    requestId: REQUEST_ID,
    requestedAtUtc: REQUESTED_AT_UTC,
    actor: 'github-actions[bot]',
    subjectRequestId: SUBJECT_REQUEST_ID,
    outputPath: requestPath,
    identityOutputPath: identityPath,
  });
  return {
    root,
    requestPath,
    identityPath,
    keyPath,
    knownHostsPath,
  };
};

const createMockSpawn = ({
  responseCode = 'REQUEST_ACCEPTED',
  requestStatus = null,
  exitCode = 0,
  mutateResponse = (response) => response,
  onSpawn = () => {},
} = {}) => (command, args, options) => {
  onSpawn({ command, args, options });
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
    child.emit('close', null, 'SIGTERM');
  };

  const chunks = [];
  child.stdin.on('data', (chunk) => {
    chunks.push(chunk);
  });
  child.stdin.on('finish', () => {
    if (child.killed) return;
    try {
      const decoded = decodeHostV2RequestFrame(Buffer.concat(chunks));
      const response = mutateResponse(createHostV2Response({
        requestIdentity: decoded.identity,
        code: responseCode,
        requestStatus,
      }));
      child.stdout.end(encodeHostV2ResponseFrame(response));
      child.stderr.end();
      setImmediate(() => child.emit('close', exitCode, null));
    } catch (error) {
      child.stdout.end();
      child.stderr.end(error instanceof Error ? error.message : String(error));
      setImmediate(() => child.emit('close', 1, null));
    }
  });
  return child;
};

test('builds strict SSH arguments without shell interpolation', () => {
  assert.deepEqual(buildSshArguments({
    keyPath: '/tmp/key',
    knownHostsPath: '/tmp/known_hosts',
    port: '22',
    user: 'omnilodge-deploy',
    host: '23.95.192.213',
    sshCommand: 'omnilodge-deploy-v1',
  }), [
    '-i',
    '/tmp/key',
    '-p',
    '22',
    '-o',
    'BatchMode=yes',
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    'PreferredAuthentications=publickey',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'UserKnownHostsFile=/tmp/known_hosts',
    '-o',
    'LogLevel=ERROR',
    'omnilodge-deploy@23.95.192.213',
    'omnilodge-deploy-v1',
  ]);
});

test('streams a prepared host v2 request over SSH and validates the response', async (context) => {
  const fixture = await makeFixture(context);
  let observedSpawn;
  const result = await submitHostV2Request({
    requestPath: fixture.requestPath,
    identityPath: fixture.identityPath,
    host: '23.95.192.213',
    port: '22',
    user: 'omnilodge-deploy',
    keyPath: fixture.keyPath,
    knownHostsPath: fixture.knownHostsPath,
    spawnCommand: createMockSpawn({
      responseCode: 'REQUEST_ACCEPTED',
      onSpawn: (details) => {
        observedSpawn = details;
      },
    }),
  });
  assert.equal(observedSpawn.command, 'ssh');
  assert.equal(observedSpawn.options.stdio.join(','), 'pipe,pipe,pipe');
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.requestKind, 'forward_submit');
  assert.equal(result.responseCode, 'REQUEST_ACCEPTED');
  assert.equal(result.responseStatus, 'accepted');
  assert.equal(result.releaseId, RELEASE_ID);
  assert.equal(result.operation, 'dry-run');
  assert.equal(result.trigger, 'manual');
  assert.equal(result.subjectRequestId, null);
  assert.equal(result.requestStatus, null);
  assert.equal(serializeHostV2SubmitResult(result), `${JSON.stringify(result, null, 2)}\n`);
});

test('returns status details for a host v2 status query', async (context) => {
  const fixture = await makeStatusFixture(context);
  const requestStatus = {
    requestId: SUBJECT_REQUEST_ID,
    kind: 'forward_submit',
    lifecycle: 'succeeded',
    phase: 'succeeded',
    resultCode: 'REQUEST_SUCCEEDED',
    updatedAtUtc: '2026-09-21T16:37:28.000Z',
  };
  const result = await submitHostV2Request({
    requestPath: fixture.requestPath,
    identityPath: fixture.identityPath,
    host: '23.95.192.213',
    port: '22',
    user: 'omnilodge-deploy',
    keyPath: fixture.keyPath,
    knownHostsPath: fixture.knownHostsPath,
    spawnCommand: createMockSpawn({
      responseCode: 'STATUS_FOUND',
      requestStatus,
    }),
  });

  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.requestKind, 'status_query');
  assert.equal(result.responseCode, 'STATUS_FOUND');
  assert.equal(result.subjectRequestId, SUBJECT_REQUEST_ID);
  assert.deepEqual(result.requestStatus, requestStatus);
  assert.equal(result.releaseId, null);
  assert.equal(result.operation, null);
  assert.equal(result.trigger, null);
});

test('rejects a protocol response that does not match the saved request identity', async (context) => {
  const fixture = await makeFixture(context);
  await assert.rejects(
    submitHostV2Request({
      requestPath: fixture.requestPath,
      identityPath: fixture.identityPath,
      host: '23.95.192.213',
      port: '22',
      user: 'omnilodge-deploy',
      keyPath: fixture.keyPath,
      knownHostsPath: fixture.knownHostsPath,
      spawnCommand: createMockSpawn({
        mutateResponse: (response) => ({
          ...response,
          requestId: '223e4567-e89b-42d3-a456-426614174001',
        }),
      }),
    }),
    /request ID does not match/,
  );
});

test('reports sanitized SSH failures without requiring a protocol response', async (context) => {
  const fixture = await makeFixture(context);
  const failingSpawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.emit('close', null, 'SIGTERM');
    };
    child.stdin.on('finish', () => {
      child.stdout.end();
      child.stderr.end('Permission denied (publickey).\n');
      setImmediate(() => child.emit('close', 255, null));
    });
    return child;
  };
  await assert.rejects(
    submitHostV2Request({
      requestPath: fixture.requestPath,
      identityPath: fixture.identityPath,
      host: '23.95.192.213',
      port: '22',
      user: 'omnilodge-deploy',
      keyPath: fixture.keyPath,
      knownHostsPath: fixture.knownHostsPath,
      spawnCommand: failingSpawn,
    }),
    /exit 255/,
  );
});
