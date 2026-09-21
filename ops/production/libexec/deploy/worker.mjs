#!/usr/bin/env node

import { existsSync } from 'node:fs';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

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
  createReleasePreparationPlan,
  inspectReleasePreparationState,
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
  });
  const state = inspectState(plan, { now });
  await publishOrVerifyBuffer({
    fileOps,
    targetPath: releasePlanPath({ paths, requestId }),
    bytes: serializeReleasePreparationPlan(plan),
  });
  await publishOrVerifyBuffer({
    fileOps,
    targetPath: releaseStatePath({ paths, requestId }),
    bytes: serializeReleasePreparationState(state, plan),
  });
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
