import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createGitHubReleaseEvidence,
  deriveReleaseId,
  selectDeploymentAuthorization,
  serializeGitHubReleaseEvidence,
  validateReleaseOperation,
  validateReleaseArtifact,
  validateReleaseRun,
} from './github-release-evidence.mjs';

const sourceSha = '1234567890abcdef1234567890abcdef12345678';
const runId = '34902107741';
const runAttempt = '2';
const repositoryId = 9001;
const releaseId = `omnilodge-r${runId}-a${runAttempt}-${sourceSha.slice(0, 12)}`;
const artifactDigest = `sha256:${'ab'.repeat(32)}`;

const buildRun = (overrides = {}) => ({
  id: Number(runId),
  run_attempt: Number(runAttempt),
  path: '.github/workflows/release.yml',
  event: 'push',
  head_branch: 'master',
  head_sha: sourceSha,
  status: 'completed',
  conclusion: 'success',
  repository: {
    id: repositoryId,
    full_name: 'pablo-dryfield/omni-lodge',
  },
  head_repository: {
    id: repositoryId,
    full_name: 'pablo-dryfield/omni-lodge',
  },
  ...overrides,
});

const buildArtifact = (overrides = {}) => ({
  id: 880044,
  name: releaseId,
  expired: false,
  digest: artifactDigest,
  workflow_run: {
    id: Number(runId),
    repository_id: repositoryId,
    head_repository_id: repositoryId,
    head_branch: 'master',
    head_sha: sourceSha,
  },
  ...overrides,
});

const buildArtifactsResponse = (artifacts = [
  buildArtifact({
    id: 880041,
    name: `release-backend-${runId}-a${runAttempt}`,
    digest: `sha256:${'11'.repeat(32)}`,
  }),
  buildArtifact({
    id: 880042,
    name: `release-ui-${runId}-a${runAttempt}`,
    digest: `sha256:${'22'.repeat(32)}`,
  }),
  buildArtifact(),
]) => ({ total_count: artifacts.length, artifacts });

const validInput = (overrides = {}) => ({
  run: buildRun(),
  artifactsResponse: buildArtifactsResponse(),
  expectedRunId: runId,
  expectedRunAttempt: runAttempt,
  expectedSourceSha: sourceSha,
  expectedArtifactId: '880044',
  configuredMode: 'manual',
  trigger: 'manual',
  operation: 'deploy',
  ...overrides,
});

const DEPLOYMENT_MODE_FOR_EXPECTATION = (value) =>
  value === 'disabled' || value === 'manual' || value === 'automatic' ? value : 'disabled';

test('selects deployment modes and triggers with a strict fail-closed matrix', () => {
  const cases = [
    ['disabled', 'manual', false, 'deployment_mode_disabled'],
    ['disabled', 'automatic', false, 'deployment_mode_disabled'],
    ['manual', 'manual', true, 'authorized'],
    ['manual', 'automatic', false, 'automatic_deployment_not_enabled'],
    ['automatic', 'manual', true, 'authorized'],
    ['automatic', 'automatic', true, 'authorized'],
    [undefined, 'manual', false, 'deployment_mode_missing'],
    ['', 'manual', false, 'deployment_mode_missing'],
    ['MANUAL', 'manual', false, 'deployment_mode_invalid'],
    [' manual', 'manual', false, 'deployment_mode_invalid'],
    ['automatic ', 'automatic', false, 'deployment_mode_invalid'],
    ['manual', 'workflow_dispatch', false, 'deployment_trigger_invalid'],
    ['automatic', undefined, false, 'deployment_trigger_invalid'],
  ];

  for (const [configuredMode, trigger, authorized, reason] of cases) {
    assert.deepEqual(
      selectDeploymentAuthorization({ configuredMode, trigger }),
      {
        authorized,
        mode: DEPLOYMENT_MODE_FOR_EXPECTATION(configuredMode),
        trigger: trigger === 'manual' || trigger === 'automatic' ? trigger : null,
        reason,
      },
    );
  }
});

test('keeps non-activation operations separate from deployment authorization', () => {
  for (const operation of ['stage', 'dry-run']) {
    assert.deepEqual(
      validateReleaseOperation({ configuredMode: 'disabled', trigger: 'manual', operation }),
      { name: operation, trigger: 'manual', configuredMode: 'disabled' },
    );
    assert.throws(
      () => validateReleaseOperation({
        configuredMode: 'disabled',
        trigger: 'automatic',
        operation,
      }),
      new RegExp(`Automatic ${operation} operations are not allowed`),
    );
  }
  assert.deepEqual(
    validateReleaseOperation({
      configuredMode: 'automatic',
      trigger: 'automatic',
      operation: 'deploy',
    }),
    { name: 'deploy', trigger: 'automatic', configuredMode: 'automatic' },
  );
  assert.throws(
    () => validateReleaseOperation({ trigger: 'manual', operation: 'stage' }),
    /Deployment mode is missing/,
  );
  assert.throws(
    () => validateReleaseOperation({
      configuredMode: 'MANUAL',
      trigger: 'manual',
      operation: 'stage',
    }),
    /Deployment mode is invalid/,
  );
  assert.throws(
    () => validateReleaseOperation({
      configuredMode: 'disabled',
      trigger: 'manual',
      operation: 'inspect',
    }),
    /Release operation is invalid/,
  );
});

test('derives the immutable release identity from exact run evidence', () => {
  assert.equal(deriveReleaseId({ runId, runAttempt, sourceSha }), releaseId);
  assert.throws(
    () => deriveReleaseId({ runId, runAttempt, sourceSha: sourceSha.toUpperCase() }),
    /full lowercase Git SHA/,
  );
  assert.throws(() => deriveReleaseId({ runId: '0', runAttempt, sourceSha }), /positive integer/);
  assert.throws(() => deriveReleaseId({ runId, runAttempt: '01', sourceSha }), /positive integer/);
  assert.throws(
    () => deriveReleaseId({ runId: '9007199254740992', runAttempt, sourceSha }),
    /positive safe integer/,
  );
});

test('creates canonical, verifier-ready evidence without copying untrusted fields', () => {
  const run = buildRun({
    actor: { login: 'do-not-copy' },
    token: 'github_pat_do-not-copy',
    html_url: 'https://example.invalid/private-run',
  });
  const artifactsResponse = buildArtifactsResponse();
  artifactsResponse.secret = 'do-not-copy';
  artifactsResponse.artifacts.at(-1).archive_download_url = 'https://example.invalid/private-artifact';

  const evidence = createGitHubReleaseEvidence(validInput({ run, artifactsResponse }));
  assert.deepEqual(evidence, {
    schemaVersion: 2,
    operation: { name: 'deploy', trigger: 'manual' },
    activationAuthorization: { mode: 'manual', authorized: true, reason: 'authorized' },
    release: {
      releaseId,
      sourceSha,
      runId,
      runAttempt,
      artifactId: '880044',
      artifactName: releaseId,
      artifactDigest,
    },
    productionEvidence: {
      workflowConclusion: 'success',
      artifactId: '880044',
      artifactDigest,
      expectedReleaseId: releaseId,
      expectedSourceSha: sourceSha,
      expectedRepository: 'pablo-dryfield/omni-lodge',
      expectedWorkflowPath: '.github/workflows/release.yml',
      expectedEvent: 'push',
      expectedRef: 'refs/heads/master',
      expectedRunId: runId,
      expectedRunAttempt: runAttempt,
      expectedArtifactName: releaseId,
    },
  });
  const serialized = serializeGitHubReleaseEvidence(evidence);
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(serialized, `${JSON.stringify(evidence, null, 2)}\n`);
  assert.doesNotMatch(serialized, /do-not-copy|archive_download_url|html_url|token/);
});

test('accepts the manual path while automatic mode is enabled', () => {
  const evidence = createGitHubReleaseEvidence(validInput({
    configuredMode: 'automatic',
    trigger: 'manual',
  }));
  assert.deepEqual(evidence.operation, { name: 'deploy', trigger: 'manual' });
  assert.deepEqual(
    evidence.activationAuthorization,
    { mode: 'automatic', authorized: true, reason: 'authorized' },
  );
});

test('creates trusted stage and dry-run evidence while activation is disabled', () => {
  for (const operation of ['stage', 'dry-run']) {
    const evidence = createGitHubReleaseEvidence(validInput({
      configuredMode: 'disabled',
      trigger: 'manual',
      operation,
    }));
    assert.deepEqual(evidence.operation, { name: operation, trigger: 'manual' });
    assert.deepEqual(evidence.activationAuthorization, {
      mode: 'disabled',
      authorized: false,
      reason: 'activation_not_requested',
    });
    assert.equal(evidence.release.artifactDigest, artifactDigest);
  }
});

test('rejects every noncanonical or mismatched workflow-run field', () => {
  const cases = [
    ['run ID', { id: Number(runId) + 1 }, /run ID does not match/i],
    ['run attempt', { run_attempt: 3 }, /run attempt does not match/i],
    ['workflow path', { path: '.github/workflows/other.yml' }, /Workflow path does not match/],
    ['event', { event: 'pull_request' }, /Workflow event does not match/],
    ['branch', { head_branch: 'feature' }, /Workflow branch does not match/],
    ['SHA', { head_sha: sourceSha.toUpperCase() }, /Workflow source SHA does not match/],
    ['status', { status: 'in_progress' }, /Workflow status does not match/],
    ['conclusion', { conclusion: 'failure' }, /Workflow conclusion does not match/],
    ['repository', {
      repository: { id: repositoryId, full_name: 'attacker/fork' },
    }, /repository full name does not match/i],
    ['head repository', {
      head_repository: { id: repositoryId, full_name: 'attacker/fork' },
    }, /head repository full name does not match/i],
    ['head repository ID', {
      head_repository: { id: repositoryId + 1, full_name: 'pablo-dryfield/omni-lodge' },
    }, /head repository ID does not match/i],
  ];

  for (const [label, overrides, pattern] of cases) {
    assert.throws(
      () => validateReleaseRun({
        run: buildRun(overrides),
        expectedRunId: runId,
        expectedRunAttempt: runAttempt,
        expectedSourceSha: sourceSha,
      }),
      pattern,
      label,
    );
  }
});

test('requires strict expected run identity inputs', () => {
  for (const input of [
    { expectedRunId: '0' },
    { expectedRunId: '01' },
    { expectedRunAttempt: '0' },
    { expectedRunAttempt: '1.5' },
    { expectedSourceSha: sourceSha.toUpperCase() },
    { expectedSourceSha: sourceSha.slice(1) },
  ]) {
    assert.throws(() => validateReleaseRun({
      run: buildRun(),
      expectedRunId: runId,
      expectedRunAttempt: runAttempt,
      expectedSourceSha: sourceSha,
      ...input,
    }));
  }
});

test('emits the digest from the exact release artifact, not an unrelated handoff', () => {
  const runIdentity = validateReleaseRun({
    run: buildRun(),
    expectedRunId: runId,
    expectedRunAttempt: runAttempt,
    expectedSourceSha: sourceSha,
  });
  assert.deepEqual(validateReleaseArtifact({
    artifactsResponse: buildArtifactsResponse(),
    runIdentity,
    expectedArtifactId: '880044',
  }), { artifactId: '880044', artifactName: releaseId, artifactDigest });
});

test('rejects a missing expected artifact ID and a forged validated-run identity', () => {
  const runIdentity = validateReleaseRun({
    run: buildRun(),
    expectedRunId: runId,
    expectedRunAttempt: runAttempt,
    expectedSourceSha: sourceSha,
  });
  assert.throws(
    () => validateReleaseArtifact({
      artifactsResponse: buildArtifactsResponse(),
      runIdentity,
    }),
    /expected artifact ID must be a positive integer/,
  );
  assert.throws(
    () => validateReleaseArtifact({
      artifactsResponse: buildArtifactsResponse(),
      runIdentity: { ...runIdentity, releaseId: 'omnilodge-r1-a1-000000000000' },
      expectedArtifactId: '880044',
    }),
    /validated workflow release ID does not match/i,
  );
});

test('rejects incomplete, duplicate, expired, or mismatched artifact evidence', () => {
  const runIdentity = validateReleaseRun({
    run: buildRun(),
    expectedRunId: runId,
    expectedRunAttempt: runAttempt,
    expectedSourceSha: sourceSha,
  });
  const cases = [
    ['incomplete page', { ...buildArtifactsResponse(), total_count: 99 }, '880044', /incomplete/],
    ['duplicate IDs', buildArtifactsResponse([
      buildArtifact({ id: 880044, name: 'unrelated' }),
      buildArtifact({ id: 880044 }),
    ]), '880044', /duplicate artifact IDs/],
    ['missing release artifact', buildArtifactsResponse([
      buildArtifact({ name: 'not-the-release' }),
    ]), '880044', /exactly one artifact/],
    ['duplicate release names', buildArtifactsResponse([
      buildArtifact({ id: 1 }),
      buildArtifact({ id: 2, expired: true }),
    ]), '880044', /exactly one artifact/],
    ['expired release', buildArtifactsResponse([
      buildArtifact({ expired: true }),
    ]), '880044', /expired/],
    ['missing digest', buildArtifactsResponse([
      buildArtifact({ digest: undefined }),
    ]), '880044', /artifact digest must be sha256/],
    ['wrong digest algorithm', buildArtifactsResponse([
      buildArtifact({ digest: `sha512:${'ab'.repeat(32)}` }),
    ]), '880044', /artifact digest must be sha256/],
    ['short digest', buildArtifactsResponse([
      buildArtifact({ digest: `sha256:${'a'.repeat(63)}` }),
    ]), '880044', /artifact digest must be sha256/],
    ['uppercase digest', buildArtifactsResponse([
      buildArtifact({ digest: `sha256:${'AB'.repeat(32)}` }),
    ]), '880044', /artifact digest must be sha256/],
    ['digest with surrounding whitespace', buildArtifactsResponse([
      buildArtifact({ digest: ` ${artifactDigest}` }),
    ]), '880044', /artifact digest must be sha256/],
    ['artifact ID', buildArtifactsResponse(), '880045', /artifact ID does not match/i],
    ['run ID', buildArtifactsResponse([
      buildArtifact({ workflow_run: { ...buildArtifact().workflow_run, id: 1 } }),
    ]), '880044', /workflow run ID does not match/i],
    ['repository ID', buildArtifactsResponse([
      buildArtifact({
        workflow_run: { ...buildArtifact().workflow_run, repository_id: repositoryId + 1 },
      }),
    ]), '880044', /repository ID does not match/i],
    ['head repository ID', buildArtifactsResponse([
      buildArtifact({
        workflow_run: { ...buildArtifact().workflow_run, head_repository_id: repositoryId + 1 },
      }),
    ]), '880044', /head repository ID does not match/i],
    ['branch', buildArtifactsResponse([
      buildArtifact({
        workflow_run: { ...buildArtifact().workflow_run, head_branch: 'feature' },
      }),
    ]), '880044', /workflow branch does not match/i],
    ['SHA', buildArtifactsResponse([
      buildArtifact({
        workflow_run: { ...buildArtifact().workflow_run, head_sha: `${sourceSha.slice(0, 39)}0` },
      }),
    ]), '880044', /source SHA does not match/i],
  ];

  for (const [label, artifactsResponse, expectedArtifactId, pattern] of cases) {
    assert.throws(
      () => validateReleaseArtifact({ artifactsResponse, runIdentity, expectedArtifactId }),
      pattern,
      label,
    );
  }
});

test('the CLI reads offline API responses and emits only canonical JSON evidence', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-release-evidence-'));
  const runPath = path.join(temporaryRoot, 'run.json');
  const artifactsPath = path.join(temporaryRoot, 'artifacts.json');
  const scriptPath = fileURLToPath(new URL('./github-release-evidence.mjs', import.meta.url));
  try {
    fs.writeFileSync(runPath, JSON.stringify(buildRun()));
    fs.writeFileSync(artifactsPath, JSON.stringify(buildArtifactsResponse()));
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--run-json', runPath,
      '--artifacts-json', artifactsPath,
      '--expected-run-id', runId,
      '--expected-run-attempt', runAttempt,
      '--expected-source-sha', sourceSha,
      '--expected-artifact-id', '880044',
      '--deploy-mode', 'automatic',
      '--trigger', 'automatic',
      '--operation', 'deploy',
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.operation, { name: 'deploy', trigger: 'automatic' });
    assert.deepEqual(
      parsed.activationAuthorization,
      { mode: 'automatic', authorized: true, reason: 'authorized' },
    );
    assert.equal(parsed.release.releaseId, releaseId);
    assert.equal(parsed.release.artifactDigest, artifactDigest);
    assert.equal(result.stdout, `${JSON.stringify(parsed, null, 2)}\n`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('the CLI emits no evidence when mode authorization or strict arguments fail', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-release-evidence-'));
  const runPath = path.join(temporaryRoot, 'run.json');
  const artifactsPath = path.join(temporaryRoot, 'artifacts.json');
  const scriptPath = fileURLToPath(new URL('./github-release-evidence.mjs', import.meta.url));
  try {
    fs.writeFileSync(runPath, JSON.stringify(buildRun()));
    fs.writeFileSync(artifactsPath, JSON.stringify(buildArtifactsResponse()));
    const baseArguments = [
      scriptPath,
      '--run-json', runPath,
      '--artifacts-json', artifactsPath,
      '--expected-run-id', runId,
      '--expected-run-attempt', runAttempt,
      '--expected-source-sha', sourceSha,
      '--expected-artifact-id', '880044',
      '--deploy-mode', 'disabled',
      '--trigger', 'manual',
      '--operation', 'deploy',
    ];
    const disabled = spawnSync(process.execPath, baseArguments, { encoding: 'utf8' });
    assert.notEqual(disabled.status, 0);
    assert.equal(disabled.stdout, '');
    assert.match(disabled.stderr, /deployment_mode_disabled/);

    const unknownOption = spawnSync(
      process.execPath,
      [...baseArguments, '--unknown', 'value'],
      { encoding: 'utf8' },
    );
    assert.notEqual(unknownOption.status, 0);
    assert.equal(unknownOption.stdout, '');
    assert.match(unknownOption.stderr, /Unknown CLI option/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('the CLI can generate dry-run evidence while deployment is disabled', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnilodge-release-evidence-'));
  const runPath = path.join(temporaryRoot, 'run.json');
  const artifactsPath = path.join(temporaryRoot, 'artifacts.json');
  const scriptPath = fileURLToPath(new URL('./github-release-evidence.mjs', import.meta.url));
  try {
    fs.writeFileSync(runPath, JSON.stringify(buildRun()));
    fs.writeFileSync(artifactsPath, JSON.stringify(buildArtifactsResponse()));
    const baseArguments = [
      scriptPath,
      '--run-json', runPath,
      '--artifacts-json', artifactsPath,
      '--expected-run-id', runId,
      '--expected-run-attempt', runAttempt,
      '--expected-source-sha', sourceSha,
      '--expected-artifact-id', '880044',
      '--deploy-mode', 'disabled',
      '--operation', 'dry-run',
    ];
    const manual = spawnSync(
      process.execPath,
      [...baseArguments, '--trigger', 'manual'],
      { encoding: 'utf8' },
    );
    assert.equal(manual.status, 0, manual.stderr);
    const parsed = JSON.parse(manual.stdout);
    assert.deepEqual(parsed.operation, { name: 'dry-run', trigger: 'manual' });
    assert.deepEqual(parsed.activationAuthorization, {
      mode: 'disabled',
      authorized: false,
      reason: 'activation_not_requested',
    });

    const automatic = spawnSync(
      process.execPath,
      [...baseArguments, '--trigger', 'automatic'],
      { encoding: 'utf8' },
    );
    assert.notEqual(automatic.status, 0);
    assert.equal(automatic.stdout, '');
    assert.match(automatic.stderr, /Automatic dry-run operations are not allowed/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
