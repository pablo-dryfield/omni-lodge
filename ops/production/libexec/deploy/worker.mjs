#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  statfsSync,
} from 'node:fs';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { extractGitHubArtifact } from '../../../../scripts/deploy/extract-github-artifact.mjs';
import {
  extractVerifiedReleaseArchive,
} from '../../../../scripts/release/lib.mjs';
import {
  createHostRequestStatus,
} from '../../../../scripts/deploy/host/state.mjs';
import { createHostAuditLog } from './audit-log.mjs';
import { serializeCanonicalJson } from './canonical-json.mjs';
import { HOST_DEPLOY_PATHS } from './constants.mjs';
import {
  PRODUCTION_RELEASE_LAYOUT,
  calculateDependencyCapacity,
  createReleasePreparationPlan,
  inspectDependencyPublicationState,
  inspectReleasePreparationState,
  publishDependencyLayer,
  prepareReleaseManagedLinks,
  serializeReleasePreparationPlan,
  serializeReleasePreparationState,
} from './release-preparation.mjs';
import { createRequestRecordStore } from './request-store.mjs';
import {
  createDurableFileOps,
} from './secure-filesystem.mjs';
import {
  incomingArtifactZipPath,
  incomingEvidencePath,
} from './submit-request.mjs';

const TRANSPORT_KEY_LABEL = 'github-actions-production';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INTERNAL_FAILURE_MESSAGE = 'Production deployment worker failed.\n';
const DEPENDENCY_COMPONENTS = Object.freeze(['backend', 'ui-server']);
const DEPENDENCY_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
const BROWSER_CACHE_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;
const DRY_RUN_COMMAND_TIMEOUT_MS = 90 * 1000;
const BACKEND_ENV_FILE = '/etc/omnilodge/backend.env';
const execFile = promisify(execFileCallback);

export const DEFAULT_DEPENDENCY_CAPACITY_BUDGET = Object.freeze({
  layers: Object.freeze({
    backend: Object.freeze({ bytes: 1024 * 1024 * 1024, inodes: 150_000 }),
    'ui-server': Object.freeze({ bytes: 512 * 1024 * 1024, inodes: 50_000 }),
  }),
  caches: Object.freeze({
    npm: Object.freeze({ bytes: 1024 * 1024 * 1024, inodes: 100_000 }),
    puppeteer: Object.freeze({ bytes: 1024 * 1024 * 1024, inodes: 50_000 }),
  }),
  safetyMargin: Object.freeze({ bytes: 1024 * 1024 * 1024, inodes: 50_000 }),
});

const validateRequestId = (requestId) => {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('Worker request ID must be a canonical lowercase UUID v4');
  }
  return requestId;
};

const identityFromEntry = (entry) => ({
  requestId: entry.requestState.request.requestId,
  requestSha256: entry.requestState.request.requestSha256,
});

const auditIdentityFromRequestState = (requestState) => {
  const request = requestState.request;
  if (request.kind === 'forward_submit') {
    const intent = requestState.intent;
    return {
      requestId: request.requestId,
      kind: request.kind,
      requestSha256: request.requestSha256,
      requestedAtUtc: request.requestedAtUtc,
      actor: request.actor,
      releaseId: intent.releaseId,
      sourceSha: intent.sourceSha,
      operation: intent.operation,
      trigger: intent.trigger,
      evidenceSha256: intent.evidenceSha256,
      artifactZipSha256: intent.artifactZipSha256,
    };
  }
  return { ...request };
};

const appendAudit = async ({
  audit,
  entry,
  eventType,
  outcomeCode = null,
}) => audit.append({
  identity: auditIdentityFromRequestState(entry.requestState),
  transportKeyLabel: TRANSPORT_KEY_LABEL,
  eventType,
  outcomeCode,
});

const releaseStagingDirectory = ({ paths, requestId }) =>
  path.join(paths.stagingRoot, validateRequestId(requestId));

const releasePlanPath = ({ paths, requestId }) =>
  path.join(paths.stateRoot, `${validateRequestId(requestId)}.release-preparation-plan.json`);

const releaseStatePath = ({ paths, requestId }) =>
  path.join(paths.stateRoot, `${validateRequestId(requestId)}.release-preparation-state.json`);

const extractionResultPath = ({ paths, requestId }) =>
  path.join(paths.stateRoot, `${validateRequestId(requestId)}.artifact-extraction-result.json`);

const dependencyPreparationResultPath = ({ paths, requestId }) =>
  path.join(paths.stateRoot, `${validateRequestId(requestId)}.dependency-preparation-result.json`);

const managedLinksResultPath = ({ paths, requestId }) =>
  path.join(paths.stateRoot, `${validateRequestId(requestId)}.managed-links-result.json`);

const dryRunChecksResultPath = ({ paths, requestId }) =>
  path.join(paths.stateRoot, `${validateRequestId(requestId)}.dry-run-checks-result.json`);

const browserCacheResultPath = ({ paths, requestId }) =>
  path.join(paths.stateRoot, `${validateRequestId(requestId)}.browser-cache-result.json`);

const publishOrVerifyBuffer = async ({
  fileOps,
  targetPath,
  bytes,
}) => {
  try {
    return await fileOps.publishExclusiveBuffer(targetPath, bytes);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await fileOps.readSecureBuffer(targetPath, {
      maximumBytes: Math.max(bytes.length, 1),
    });
    if (!existing.bytes.equals(bytes)) {
      throw new Error(`Persisted deployment state differs from the verified worker output: ${targetPath}`);
    }
    return Object.freeze({ path: targetPath, stat: existing.stat, reused: true });
  }
};

const unlinkIfPresent = async (fs, targetPath) => {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const targetDependencyCapacityPaths = ({ plan, publicationState }) => {
  const targetPaths = [];
  for (const component of DEPENDENCY_COMPONENTS) {
    if (publicationState[component] !== 'reuse') {
      targetPaths.push(plan.dependencies[component].componentRoot);
    }
  }
  if (targetPaths.length > 0) {
    targetPaths.push(plan.layout.npmCacheRoot, plan.layout.puppeteerCacheRoot);
  }
  return Object.freeze([...new Set(targetPaths)].sort());
};

export const measureDependencyCapacity = ({
  plan,
  publicationState,
  now = () => new Date(),
  statfs = statfsSync,
  lstat = lstatSync,
} = {}) => {
  const measuredAtUtc = now().toISOString();
  const filesystems = targetDependencyCapacityPaths({ plan, publicationState }).map((targetPath) => {
    const filesystem = statfs(targetPath, { bigint: true });
    const directory = lstat(targetPath, { bigint: true });
    return {
      targetPath,
      device: directory.dev.toString(),
      availableBytes: filesystem.bavail * filesystem.bsize,
      availableInodes: filesystem.ffree,
    };
  });
  return Object.freeze({
    measuredAtUtc,
    filesystems: Object.freeze(filesystems),
  });
};

export const runDependencyInstall = async (execution) => {
  await execFile(execution.executable, execution.args, {
    cwd: execution.cwd,
    env: execution.env,
    timeout: DEPENDENCY_EXECUTION_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return Object.freeze({ exitCode: 0 });
};

export const runDryRunCommand = async (execution) => {
  const result = await execFile(execution.executable, execution.args, {
    cwd: execution.cwd,
    env: execution.env,
    timeout: DRY_RUN_COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  return Object.freeze({
    exitCode: 0,
    stdout: result.stdout,
    stderr: result.stderr,
  });
};

export const runBrowserCacheInstall = async (execution) => {
  await execFile(execution.executable, execution.args, {
    cwd: execution.cwd,
    env: execution.env,
    timeout: BROWSER_CACHE_EXECUTION_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return Object.freeze({ exitCode: 0 });
};

const jsonSafe = (value) => {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  }
  return value;
};

const summarizeCapacity = (calculation) => Object.freeze({
  publicationStateKey: calculation.publicationStateKey,
  measuredAtUtc: calculation.measuredAtUtc,
  expiresAtUtc: calculation.expiresAtUtc,
  targetPaths: calculation.targetPaths,
  requiredBytes: calculation.requiredBytes.toString(),
  requiredInodes: calculation.requiredInodes.toString(),
  availableBytes: calculation.availableBytes.toString(),
  availableInodes: calculation.availableInodes.toString(),
  byteShortfall: calculation.byteShortfall.toString(),
  inodeShortfall: calculation.inodeShortfall.toString(),
  sufficient: calculation.sufficient,
  installs: calculation.installs,
});

export const prepareDependencyLayers = async ({
  plan,
  now = () => new Date(),
  trustedBudget = DEFAULT_DEPENDENCY_CAPACITY_BUDGET,
  measureCapacity = measureDependencyCapacity,
  calculateCapacity = calculateDependencyCapacity,
  inspectPublicationState = inspectDependencyPublicationState,
  inspectState = inspectReleasePreparationState,
  publishLayer = publishDependencyLayer,
  executor = runDependencyInstall,
} = {}) => {
  const startedAtUtc = now().toISOString();
  const components = [];

  for (const component of DEPENDENCY_COMPONENTS) {
    const publicationState = inspectPublicationState(plan);
    const available = measureCapacity({ plan, publicationState, now });
    const capacityCalculation = calculateCapacity({
      plan,
      publicationState,
      trustedBudget,
      available,
      now,
    });
    const result = await publishLayer({
      plan,
      component,
      capacityCalculation,
      executor,
    });
    components.push(Object.freeze({
      component,
      previousState: publicationState[component],
      status: result.status,
      finalPath: result.finalPath,
      capacity: summarizeCapacity(capacityCalculation),
    }));
  }

  const finalState = inspectState(plan, { now });
  return Object.freeze({
    schemaVersion: 1,
    releaseId: plan.releaseId,
    sourceSha: plan.sourceSha,
    preparationPlanSha256: plan.planSha256,
    startedAtUtc,
    completedAtUtc: now().toISOString(),
    components: Object.freeze(components),
    preparationState: finalState.phase,
    releaseLinks: finalState.releaseLinks,
    dependencies: finalState.dependencies,
  });
};

const backendDryRunEnvironment = (plan) => Object.freeze({
  HOME: '/root',
  LOGNAME: 'root',
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  USER: 'root',
  NODE_ENV: 'production',
  NODE_OPTIONS: '--max-old-space-size=4096',
  APP_RUNTIME_MODE: 'dry-run',
  APP_VERSION: plan.releaseId,
  GIT_COMMIT_SHA: plan.sourceSha,
  SKIP_DB_SYNC: 'true',
  DB_SYNC_ALTER: 'false',
  SEED_ACCESS_CONTROL: 'false',
  ERROR_MONITORING_SPOOL_PATH: '/var/lib/omnilodge/runtime/error-monitoring/failed-events.ndjson',
  ERROR_MONITORING_SOURCE_MAP_DIR: '/var/lib/omnilodge/source-maps',
  NIGHT_REPORT_UPLOAD_DIR: '/var/lib/omnilodge/uploads/night-reports',
  PROFILE_PHOTO_UPLOAD_DIR: '/var/lib/omnilodge/uploads/profile-photos',
  PUPPETEER_CACHE_DIR: plan.layout.puppeteerCacheRoot,
});

const backendDryRunCommand = ({ plan, label, script }) => Object.freeze({
  label,
  executable: '/usr/bin/node',
  args: Object.freeze([
    `--env-file=${BACKEND_ENV_FILE}`,
    '--enable-source-maps',
    script,
  ]),
  cwd: path.join(plan.releaseRoot, 'be'),
  env: backendDryRunEnvironment(plan),
});

const backendBrowserCacheCommand = (plan) => Object.freeze({
  label: 'puppeteer-browser-cache',
  executable: '/usr/bin/node',
  args: Object.freeze(['node_modules/puppeteer/install.mjs']),
  cwd: path.join(plan.releaseRoot, 'be'),
  env: backendDryRunEnvironment(plan),
});

export const prepareBackendBrowserCache = async ({
  plan,
  now = () => new Date(),
  executor = runBrowserCacheInstall,
} = {}) => {
  const command = backendBrowserCacheCommand(plan);
  const result = await executor(command);
  if (!result || result.exitCode !== 0) throw new Error('Puppeteer browser-cache preparation failed');
  return Object.freeze({
    schemaVersion: 1,
    releaseId: plan.releaseId,
    sourceSha: plan.sourceSha,
    preparationPlanSha256: plan.planSha256,
    cacheRoot: plan.layout.puppeteerCacheRoot,
    command: Object.freeze({
      label: command.label,
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
    }),
    capturedAtUtc: now().toISOString(),
  });
};

const parseJsonCommandOutput = ({ label, result }) => {
  if (!result || result.exitCode !== 0) throw new Error(`${label} command failed`);
  if (typeof result.stdout !== 'string' || result.stdout.length === 0 || result.stdout.length > 512 * 1024) {
    throw new Error(`${label} command produced invalid stdout`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(`${label} command did not produce JSON`, { cause: error });
  }
};

const assertMigrationStatusResult = (value) => {
  if (value?.schemaVersion !== 1 || value.kind !== 'omnilodge-migration-status' || value.ok !== true) {
    throw new Error('Migration status dry-run result is invalid');
  }
  return value;
};

const assertRuntimePreflightResult = (value) => {
  if (value?.schemaVersion !== 1 || value.kind !== 'omnilodge-backend-runtime-preflight' || value.ok !== true) {
    throw new Error('Runtime preflight dry-run result is invalid');
  }
  return value;
};

export const runDryRunRuntimeChecks = async ({
  plan,
  now = () => new Date(),
  executor = runDryRunCommand,
} = {}) => {
  const migrationCommand = backendDryRunCommand({
    plan,
    label: 'migration-status',
    script: 'dist/scripts/reportMigrationStatus.js',
  });
  const runtimePreflightCommand = backendDryRunCommand({
    plan,
    label: 'runtime-preflight',
    script: 'dist/scripts/runtimePreflight.js',
  });
  const migrationStatus = assertMigrationStatusResult(parseJsonCommandOutput({
    label: migrationCommand.label,
    result: await executor(migrationCommand),
  }));
  const runtimePreflight = assertRuntimePreflightResult(parseJsonCommandOutput({
    label: runtimePreflightCommand.label,
    result: await executor(runtimePreflightCommand),
  }));
  return Object.freeze({
    schemaVersion: 1,
    releaseId: plan.releaseId,
    sourceSha: plan.sourceSha,
    preparationPlanSha256: plan.planSha256,
    backendEnvironmentFile: BACKEND_ENV_FILE,
    commands: Object.freeze([
      Object.freeze({
        label: migrationCommand.label,
        executable: migrationCommand.executable,
        args: migrationCommand.args,
        cwd: migrationCommand.cwd,
      }),
      Object.freeze({
        label: runtimePreflightCommand.label,
        executable: runtimePreflightCommand.executable,
        args: runtimePreflightCommand.args,
        cwd: runtimePreflightCommand.cwd,
      }),
    ]),
    migrationStatus,
    runtimePreflight,
    capturedAtUtc: now().toISOString(),
  });
};

export const cleanupIncomingWorkerPayload = async ({
  requestId,
  paths = HOST_DEPLOY_PATHS,
  fs = nativeFs,
} = {}) => {
  const validatedRequestId = validateRequestId(requestId);
  await Promise.all([
    unlinkIfPresent(fs, incomingArtifactZipPath({ paths, requestId: validatedRequestId })),
    unlinkIfPresent(fs, incomingEvidencePath({ paths, requestId: validatedRequestId })),
  ]);
};

export const prepareForwardReleaseArtifact = async ({
  requestState,
  paths = HOST_DEPLOY_PATHS,
  trustedLayout = PRODUCTION_RELEASE_LAYOUT,
  fileOps = createDurableFileOps(),
  now = () => new Date(),
  extractArtifact = extractGitHubArtifact,
  extractReleaseArchive = extractVerifiedReleaseArchive,
  createPlan = createReleasePreparationPlan,
  inspectState = inspectReleasePreparationState,
  prepareDependencies = prepareDependencyLayers,
  prepareManagedLinks = prepareReleaseManagedLinks,
  prepareBrowserCache = prepareBackendBrowserCache,
  runDryRunChecks = runDryRunRuntimeChecks,
} = {}) => {
  if (requestState?.request?.kind !== 'forward_submit') {
    throw new Error('Only forward submit requests can prepare release artifacts');
  }
  const { requestId } = requestState.request;
  const {
    releaseId,
    sourceSha,
    artifactZipSha256,
  } = requestState.intent;
  const artifactZipPath = incomingArtifactZipPath({ paths, requestId });
  const evidencePath = incomingEvidencePath({ paths, requestId });
  const stagingDirectory = releaseStagingDirectory({ paths, requestId });

  const extraction = await extractArtifact({
    artifactZipPath,
    evidencePath,
    stagingDirectory,
  });
  if (extraction.releaseId !== releaseId) {
    throw new Error('Extracted artifact release ID does not match the request');
  }
  if (extraction.artifactZipSha256 !== artifactZipSha256) {
    throw new Error('Extracted artifact ZIP digest does not match the request');
  }
  if (extraction.operation?.name !== requestState.intent.operation
    || extraction.operation?.trigger !== requestState.intent.trigger) {
    throw new Error('Extracted artifact operation does not match the request');
  }

  const finalReleasePath = path.join(trustedLayout.releasesRoot, releaseId);
  let releaseExtraction = null;
  if (!existsSync(finalReleasePath)) {
    releaseExtraction = extractReleaseArchive({
      archivePath: extraction.archivePath,
      checksumPath: extraction.checksumPath,
      releasesDirectory: trustedLayout.releasesRoot,
      productionEvidence: extraction.productionEvidence,
      expectedArchiveSha256: extraction.archiveSha256,
    });
  }

  const plan = createPlan({
    expectedReleaseId: releaseId,
    expectedSourceSha: sourceSha,
    trustedLayout,
    linkState: 'auto',
  });
  await publishOrVerifyBuffer({
    fileOps,
    targetPath: releasePlanPath({ paths, requestId }),
    bytes: serializeReleasePreparationPlan(plan),
  });
  let dependencyPreparation = null;
  let managedLinks = null;
  let browserCache = null;
  let dryRunChecks = null;
  if (requestState.intent.operation === 'dry-run') {
    dependencyPreparation = await prepareDependencies({
      plan,
      now,
    });
    managedLinks = prepareManagedLinks(plan);
    browserCache = await prepareBrowserCache({
      plan,
      now,
    });
    dryRunChecks = await runDryRunChecks({
      plan,
      now,
    });
  }
  const state = inspectState(plan, { now });
  await publishOrVerifyBuffer({
    fileOps,
    targetPath: releaseStatePath({ paths, requestId }),
    bytes: serializeReleasePreparationState(state, plan),
  });
  if (dependencyPreparation !== null) {
    await publishOrVerifyBuffer({
      fileOps,
      targetPath: dependencyPreparationResultPath({ paths, requestId }),
      bytes: serializeCanonicalJson(jsonSafe(dependencyPreparation)),
    });
  }
  if (managedLinks !== null) {
    await publishOrVerifyBuffer({
      fileOps,
      targetPath: managedLinksResultPath({ paths, requestId }),
      bytes: serializeCanonicalJson(jsonSafe({
        schemaVersion: 1,
        requestId,
        releaseId,
        preparationPlanSha256: plan.planSha256,
        ...managedLinks,
        capturedAtUtc: now().toISOString(),
      })),
    });
  }
  if (browserCache !== null) {
    await publishOrVerifyBuffer({
      fileOps,
      targetPath: browserCacheResultPath({ paths, requestId }),
      bytes: serializeCanonicalJson(jsonSafe(browserCache)),
    });
  }
  if (dryRunChecks !== null) {
    await publishOrVerifyBuffer({
      fileOps,
      targetPath: dryRunChecksResultPath({ paths, requestId }),
      bytes: serializeCanonicalJson(jsonSafe(dryRunChecks)),
    });
  }
  await publishOrVerifyBuffer({
    fileOps,
    targetPath: extractionResultPath({ paths, requestId }),
    bytes: serializeCanonicalJson({
      schemaVersion: 1,
      requestId,
      releaseId,
      operation: extraction.operation,
      artifactZipSha256: extraction.artifactZipSha256,
      archiveSha256: extraction.archiveSha256,
      releaseExtracted: releaseExtraction !== null,
      releasePath: finalReleasePath,
      preparationPlanSha256: plan.planSha256,
      capturedAtUtc: now().toISOString(),
    }),
  });

  return Object.freeze({
    requestId,
    releaseId,
    releasePath: finalReleasePath,
    preparationPlanSha256: plan.planSha256,
    releaseExtracted: releaseExtraction !== null,
    preparationState: state.phase,
    dependencyPreparationState: dependencyPreparation?.preparationState ?? null,
    managedLinkCount: managedLinks?.linkCount ?? 0,
    browserCachePrepared: browserCache !== null,
    dryRunChecksPassed: dryRunChecks !== null,
  });
};

const advanceIfAtPhase = async ({
  store,
  entry,
  fromPhase,
  nextPhase,
}) => {
  if (entry.requestState.phase === nextPhase) return entry;
  if (entry.requestState.phase !== fromPhase) return entry;
  return store.advance({
    ...identityFromEntry(entry),
    fromPhase,
    nextPhase,
  });
};

const failRunningRequest = async ({
  store,
  entry,
}) => {
  if (entry.requestState.phase === 'failed') return entry;
  return store.advance({
    ...identityFromEntry(entry),
    fromPhase: entry.requestState.phase,
    nextPhase: 'failed',
  });
};

const finishIfTerminal = async ({
  store,
  entry,
}) => {
  if (!['succeeded', 'failed', 'rejected'].includes(entry.requestState.phase)) return entry;
  if (entry.state !== 'running') return entry;
  return store.transition({
    ...identityFromEntry(entry),
    from: 'running',
    to: 'finished',
  });
};

export const handleHostDeployWorkerRequest = async ({
  requestId,
  paths = HOST_DEPLOY_PATHS,
  clock = () => new Date(),
  fs = nativeFs,
  requestStore = createRequestRecordStore({ paths, clock }),
  auditLog = createHostAuditLog({ clock }),
  prepareRelease = prepareForwardReleaseArtifact,
} = {}) => {
  const validatedRequestId = validateRequestId(requestId);
  let entry = await requestStore.lookup(validatedRequestId);
  if (entry === null) throw new Error(`Request ${validatedRequestId} does not exist`);
  if (entry.state === 'finished') {
    return Object.freeze({
      exitCode: 0,
      status: createHostRequestStatus(entry.requestState),
      alreadyFinished: true,
    });
  }
  if (entry.state === 'pending') {
    entry = await requestStore.transition({
      ...identityFromEntry(entry),
      from: 'pending',
      to: 'running',
    });
  }
  if (entry.state !== 'running') {
    throw new Error(`Request ${validatedRequestId} is not runnable`);
  }

  await appendAudit({
    audit: auditLog,
    entry,
    eventType: 'request_running',
  });

  try {
    entry = await advanceIfAtPhase({
      store: requestStore,
      entry,
      fromPhase: 'received',
      nextPhase: 'authorized',
    });

    if (entry.requestState.request.kind !== 'forward_submit') {
      throw new Error('Rollback worker handling is not implemented in the staging slice');
    }

    if (entry.requestState.phase === 'authorized') {
      await prepareRelease({
        requestState: entry.requestState,
        paths,
        fs,
        now: clock,
      });
      await cleanupIncomingWorkerPayload({
        requestId: validatedRequestId,
        paths,
        fs,
      });
      entry = await requestStore.advance({
        ...identityFromEntry(entry),
        fromPhase: 'authorized',
        nextPhase: 'artifact_staged',
      });
    }

    if (entry.requestState.intent.operation === 'deploy') {
      throw new Error('Release activation is not enabled in the detached staging slice');
    }

    entry = await advanceIfAtPhase({
      store: requestStore,
      entry,
      fromPhase: 'artifact_staged',
      nextPhase: 'preflight_passed',
    });
    entry = await advanceIfAtPhase({
      store: requestStore,
      entry,
      fromPhase: 'preflight_passed',
      nextPhase: 'succeeded',
    });
    entry = await finishIfTerminal({ store: requestStore, entry });
    await appendAudit({
      audit: auditLog,
      entry,
      eventType: 'request_finished',
      outcomeCode: entry.requestState.resultCode,
    });
    return Object.freeze({
      exitCode: 0,
      status: createHostRequestStatus(entry.requestState),
    });
  } catch (error) {
    entry = await requestStore.lookup(validatedRequestId);
    if (entry !== null && entry.state === 'running' && !['succeeded', 'failed', 'rejected'].includes(entry.requestState.phase)) {
      await cleanupIncomingWorkerPayload({
        requestId: validatedRequestId,
        paths,
        fs,
      });
      entry = await failRunningRequest({ store: requestStore, entry });
      entry = await finishIfTerminal({ store: requestStore, entry });
      await appendAudit({
        audit: auditLog,
        entry,
        eventType: 'request_finished',
        outcomeCode: entry.requestState.resultCode,
      });
    }
    throw error;
  }
};

export const runHostDeployWorkerCli = async ({
  argv = process.argv.slice(2),
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
  errorOutput = process.stderr,
} = {}) => {
  if (argv.length !== 1 || uid !== 0) {
    await errorOutput.write('Deployment worker refused.\n');
    return 64;
  }
  try {
    const result = await handleHostDeployWorkerRequest({
      requestId: argv[0],
    });
    return result.exitCode;
  } catch {
    await errorOutput.write(INTERNAL_FAILURE_MESSAGE);
    return 1;
  }
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  runHostDeployWorkerCli().then((exitCode) => {
    process.exitCode = exitCode;
  }, async () => {
    await process.stderr.write(INTERNAL_FAILURE_MESSAGE);
    process.exitCode = 1;
  });
}
