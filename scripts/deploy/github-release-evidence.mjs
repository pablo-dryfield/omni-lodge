#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  CANONICAL_RELEASE_REF,
  CANONICAL_REPOSITORY,
  CANONICAL_WORKFLOW_PATH,
  parseStrictCliArguments,
} from '../release/lib.mjs';

const EVIDENCE_SCHEMA_VERSION = 2;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const MAX_JSON_INPUT_BYTES = 8 * 1024 * 1024;
const DEPLOYMENT_MODES = new Set(['disabled', 'manual', 'automatic']);
const DEPLOYMENT_TRIGGERS = new Set(['manual', 'automatic']);
const RELEASE_OPERATIONS = new Set(['stage', 'dry-run', 'deploy']);

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);

const requirePlainObject = (value, label) => {
  invariant(isPlainObject(value), `${label} must be a JSON object`);
  return value;
};

const requireExactText = (value, expected, label) => {
  invariant(typeof value === 'string' && value === expected, `${label} does not match`);
  return value;
};

const requireSourceSha = (value, label) => {
  invariant(
    typeof value === 'string' && SOURCE_SHA_PATTERN.test(value),
    `${label} must be a full lowercase Git SHA`,
  );
  return value;
};

const requireArtifactDigest = (value, label) => {
  invariant(
    typeof value === 'string' && ARTIFACT_DIGEST_PATTERN.test(value),
    `${label} must be sha256 followed by 64 lowercase hexadecimal characters`,
  );
  return value;
};

const positiveIntegerText = (value, label) => {
  if (typeof value === 'number') {
    invariant(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
    return String(value);
  }
  invariant(
    typeof value === 'string' && POSITIVE_INTEGER_PATTERN.test(value),
    `${label} must be a positive integer`,
  );
  invariant(
    BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
    `${label} must be a positive safe integer`,
  );
  return value;
};

const normalizeFilesystemPath = (value) => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const readJsonFile = (filePath, label) => {
  const resolvedPath = path.resolve(filePath);
  invariant(fs.existsSync(resolvedPath), `${label} does not exist`);
  const stat = fs.lstatSync(resolvedPath);
  invariant(!stat.isSymbolicLink() && stat.isFile(), `${label} must be a real regular file`);
  invariant(stat.size > 0, `${label} is empty`);
  invariant(stat.size <= MAX_JSON_INPUT_BYTES, `${label} exceeds the JSON input size limit`);
  const realPath = fs.realpathSync.native(resolvedPath);
  invariant(
    normalizeFilesystemPath(realPath) === normalizeFilesystemPath(resolvedPath),
    `${label} or one of its ancestors resolves through a symbolic link or junction`,
  );
  try {
    return JSON.parse(fs.readFileSync(realPath, 'utf8'));
  } catch {
    throw new Error(`${label} does not contain valid JSON`);
  }
};

export const selectDeploymentAuthorization = ({ configuredMode, trigger }) => {
  const modeRecognized = typeof configuredMode === 'string'
    && DEPLOYMENT_MODES.has(configuredMode);
  const normalizedMode = modeRecognized ? configuredMode : 'disabled';
  const triggerRecognized = typeof trigger === 'string'
    && DEPLOYMENT_TRIGGERS.has(trigger);

  if (!triggerRecognized) {
    return Object.freeze({
      authorized: false,
      mode: normalizedMode,
      trigger: null,
      reason: 'deployment_trigger_invalid',
    });
  }
  if (!modeRecognized) {
    return Object.freeze({
      authorized: false,
      mode: 'disabled',
      trigger,
      reason: configuredMode === undefined || configuredMode === null || configuredMode === ''
        ? 'deployment_mode_missing'
        : 'deployment_mode_invalid',
    });
  }
  if (normalizedMode === 'disabled') {
    return Object.freeze({
      authorized: false,
      mode: normalizedMode,
      trigger,
      reason: 'deployment_mode_disabled',
    });
  }
  if (trigger === 'automatic' && normalizedMode !== 'automatic') {
    return Object.freeze({
      authorized: false,
      mode: normalizedMode,
      trigger,
      reason: 'automatic_deployment_not_enabled',
    });
  }
  return Object.freeze({
    authorized: true,
    mode: normalizedMode,
    trigger,
    reason: 'authorized',
  });
};

export const validateReleaseOperation = ({ configuredMode, trigger, operation }) => {
  invariant(
    typeof configuredMode === 'string' && DEPLOYMENT_MODES.has(configuredMode),
    configuredMode === undefined || configuredMode === null || configuredMode === ''
      ? 'Deployment mode is missing'
      : 'Deployment mode is invalid',
  );
  invariant(
    typeof trigger === 'string' && DEPLOYMENT_TRIGGERS.has(trigger),
    'Deployment trigger is invalid',
  );
  invariant(
    typeof operation === 'string' && RELEASE_OPERATIONS.has(operation),
    'Release operation is invalid',
  );
  if (operation !== 'deploy') {
    invariant(
      trigger === 'manual',
      `Automatic ${operation} operations are not allowed`,
    );
  }
  return Object.freeze({ name: operation, trigger, configuredMode });
};

export const deriveReleaseId = ({ runId, runAttempt, sourceSha }) => {
  const normalizedRunId = positiveIntegerText(runId, 'expected run ID');
  const normalizedRunAttempt = positiveIntegerText(runAttempt, 'expected run attempt');
  const normalizedSourceSha = requireSourceSha(sourceSha, 'expected source SHA');
  return `omnilodge-r${normalizedRunId}-a${normalizedRunAttempt}-${normalizedSourceSha.slice(0, 12)}`;
};

const validateRepository = (repository, expectedId, label) => {
  const value = requirePlainObject(repository, label);
  requireExactText(value.full_name, CANONICAL_REPOSITORY, `${label} full name`);
  const id = positiveIntegerText(value.id, `${label} ID`);
  if (expectedId !== undefined) {
    invariant(id === expectedId, `${label} ID does not match`);
  }
  return id;
};

export const validateReleaseRun = ({
  run,
  expectedRunId,
  expectedRunAttempt,
  expectedSourceSha,
}) => {
  const value = requirePlainObject(run, 'release workflow run');
  const runId = positiveIntegerText(expectedRunId, 'expected run ID');
  const runAttempt = positiveIntegerText(expectedRunAttempt, 'expected run attempt');
  const sourceSha = requireSourceSha(expectedSourceSha, 'expected source SHA');

  invariant(positiveIntegerText(value.id, 'workflow run ID') === runId, 'Workflow run ID does not match');
  invariant(
    positiveIntegerText(value.run_attempt, 'workflow run attempt') === runAttempt,
    'Workflow run attempt does not match',
  );
  requireExactText(value.path, CANONICAL_WORKFLOW_PATH, 'Workflow path');
  requireExactText(value.event, 'push', 'Workflow event');
  requireExactText(value.head_branch, 'master', 'Workflow branch');
  requireExactText(value.head_sha, sourceSha, 'Workflow source SHA');
  requireExactText(value.status, 'completed', 'Workflow status');
  requireExactText(value.conclusion, 'success', 'Workflow conclusion');

  const repositoryId = validateRepository(value.repository, undefined, 'Workflow repository');
  const headRepositoryId = validateRepository(
    value.head_repository,
    repositoryId,
    'Workflow head repository',
  );
  const releaseId = deriveReleaseId({ runId, runAttempt, sourceSha });

  return Object.freeze({
    runId,
    runAttempt,
    sourceSha,
    releaseId,
    repositoryId,
    headRepositoryId,
  });
};

const validateArtifactListEnvelope = (artifactsResponse) => {
  const response = requirePlainObject(artifactsResponse, 'workflow artifacts response');
  invariant(Array.isArray(response.artifacts), 'Workflow artifacts response must contain an artifacts array');
  invariant(
    Number.isSafeInteger(response.total_count) && response.total_count >= 0,
    'Workflow artifacts total_count must be a non-negative safe integer',
  );
  invariant(
    response.total_count === response.artifacts.length,
    'Workflow artifacts response is incomplete or inconsistently paginated',
  );

  const artifactIds = new Set();
  response.artifacts.forEach((artifact, index) => {
    const value = requirePlainObject(artifact, `workflow artifact[${index}]`);
    const artifactId = positiveIntegerText(value.id, `workflow artifact[${index}] ID`);
    invariant(!artifactIds.has(artifactId), 'Workflow artifacts response contains duplicate artifact IDs');
    artifactIds.add(artifactId);
    invariant(
      typeof value.name === 'string' && value.name.length > 0,
      `workflow artifact[${index}] name must be a non-empty string`,
    );
  });
  return response.artifacts;
};

export const validateReleaseArtifact = ({
  artifactsResponse,
  runIdentity,
  expectedArtifactId,
}) => {
  const identity = requirePlainObject(runIdentity, 'validated workflow run identity');
  const runId = positiveIntegerText(identity.runId, 'validated workflow run ID');
  const runAttempt = positiveIntegerText(
    identity.runAttempt,
    'validated workflow run attempt',
  );
  const sourceSha = requireSourceSha(identity.sourceSha, 'validated workflow source SHA');
  const repositoryId = positiveIntegerText(
    identity.repositoryId,
    'validated workflow repository ID',
  );
  const headRepositoryId = positiveIntegerText(
    identity.headRepositoryId,
    'validated workflow head repository ID',
  );
  invariant(
    headRepositoryId === repositoryId,
    'Validated workflow head repository ID does not match',
  );
  const releaseId = deriveReleaseId({ runId, runAttempt, sourceSha });
  invariant(identity.releaseId === releaseId, 'Validated workflow release ID does not match');
  const artifactIdExpected = positiveIntegerText(expectedArtifactId, 'expected artifact ID');
  const artifacts = validateArtifactListEnvelope(artifactsResponse);
  const candidates = artifacts.filter((artifact) => artifact.name === releaseId);
  invariant(candidates.length === 1, 'Expected exactly one artifact with the derived release name');

  const artifact = candidates[0];
  invariant(artifact.expired === false, 'The release artifact is expired');
  const artifactId = positiveIntegerText(artifact.id, 'release artifact ID');
  invariant(artifactId === artifactIdExpected, 'Release artifact ID does not match');
  const artifactDigest = requireArtifactDigest(artifact.digest, 'release artifact digest');

  const workflowRun = requirePlainObject(artifact.workflow_run, 'release artifact workflow run');
  invariant(
    positiveIntegerText(workflowRun.id, 'release artifact workflow run ID') === runId,
    'Release artifact workflow run ID does not match',
  );
  invariant(
    positiveIntegerText(workflowRun.repository_id, 'release artifact repository ID')
      === repositoryId,
    'Release artifact repository ID does not match',
  );
  invariant(
    positiveIntegerText(workflowRun.head_repository_id, 'release artifact head repository ID')
      === headRepositoryId,
    'Release artifact head repository ID does not match',
  );
  requireExactText(workflowRun.head_branch, 'master', 'Release artifact workflow branch');
  requireExactText(workflowRun.head_sha, sourceSha, 'Release artifact source SHA');

  return Object.freeze({ artifactId, artifactName: releaseId, artifactDigest });
};

export const createGitHubReleaseEvidence = ({
  run,
  artifactsResponse,
  expectedRunId,
  expectedRunAttempt,
  expectedSourceSha,
  expectedArtifactId,
  configuredMode,
  trigger,
  operation,
}) => {
  const releaseOperation = validateReleaseOperation({ configuredMode, trigger, operation });
  const activationAuthorization = operation === 'deploy'
    ? selectDeploymentAuthorization({ configuredMode, trigger })
    : Object.freeze({
      authorized: false,
      mode: configuredMode,
      trigger,
      reason: 'activation_not_requested',
    });
  if (operation === 'deploy') {
    invariant(
      activationAuthorization.authorized,
      `Deployment is not authorized: ${activationAuthorization.reason}`,
    );
  }
  const runIdentity = validateReleaseRun({
    run,
    expectedRunId,
    expectedRunAttempt,
    expectedSourceSha,
  });
  const artifactIdentity = validateReleaseArtifact({
    artifactsResponse,
    runIdentity,
    expectedArtifactId,
  });

  const productionEvidence = Object.freeze({
    workflowConclusion: 'success',
    artifactId: artifactIdentity.artifactId,
    artifactDigest: artifactIdentity.artifactDigest,
    expectedReleaseId: runIdentity.releaseId,
    expectedSourceSha: runIdentity.sourceSha,
    expectedRepository: CANONICAL_REPOSITORY,
    expectedWorkflowPath: CANONICAL_WORKFLOW_PATH,
    expectedEvent: 'push',
    expectedRef: CANONICAL_RELEASE_REF,
    expectedRunId: runIdentity.runId,
    expectedRunAttempt: runIdentity.runAttempt,
    expectedArtifactName: artifactIdentity.artifactName,
  });

  return Object.freeze({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    operation: Object.freeze({
      name: releaseOperation.name,
      trigger: releaseOperation.trigger,
    }),
    activationAuthorization: Object.freeze({
      mode: activationAuthorization.mode,
      authorized: activationAuthorization.authorized,
      reason: activationAuthorization.reason,
    }),
    release: Object.freeze({
      releaseId: runIdentity.releaseId,
      sourceSha: runIdentity.sourceSha,
      runId: runIdentity.runId,
      runAttempt: runIdentity.runAttempt,
      artifactId: artifactIdentity.artifactId,
      artifactName: artifactIdentity.artifactName,
      artifactDigest: artifactIdentity.artifactDigest,
    }),
    productionEvidence,
  });
};

export const serializeGitHubReleaseEvidence = (evidence) =>
  `${JSON.stringify(evidence, null, 2)}\n`;

const VALUE_OPTIONS = [
  'run-json',
  'artifacts-json',
  'expected-run-id',
  'expected-run-attempt',
  'expected-source-sha',
  'expected-artifact-id',
  'deploy-mode',
  'trigger',
  'operation',
];

const requiredCliValue = (values, name) => {
  invariant(values[name] !== undefined, `--${name} is required`);
  return values[name];
};

export const runCli = (argv = process.argv.slice(2)) => {
  const { values } = parseStrictCliArguments(argv, { valueOptions: VALUE_OPTIONS });
  const evidence = createGitHubReleaseEvidence({
    run: readJsonFile(requiredCliValue(values, 'run-json'), 'Workflow run JSON'),
    artifactsResponse: readJsonFile(
      requiredCliValue(values, 'artifacts-json'),
      'Workflow artifacts JSON',
    ),
    expectedRunId: requiredCliValue(values, 'expected-run-id'),
    expectedRunAttempt: requiredCliValue(values, 'expected-run-attempt'),
    expectedSourceSha: requiredCliValue(values, 'expected-source-sha'),
    expectedArtifactId: requiredCliValue(values, 'expected-artifact-id'),
    configuredMode: requiredCliValue(values, 'deploy-mode'),
    trigger: requiredCliValue(values, 'trigger'),
    operation: requiredCliValue(values, 'operation'),
  });
  return serializeGitHubReleaseEvidence(evidence);
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    process.stdout.write(runCli());
  } catch (error) {
    process.stderr.write(
      `GitHub release evidence validation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
