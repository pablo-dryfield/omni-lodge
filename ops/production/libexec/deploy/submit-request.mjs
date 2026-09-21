#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  createHostV2Response,
  encodeHostV2ResponseFrame,
  validateHostV2RequestFreshness,
} from '../../../../scripts/deploy/host/protocol-v2.mjs';
import { receiveHostV2RequestToFile } from '../../../../scripts/deploy/host/request-receiver.mjs';
import {
  createHostRequestStatus,
} from '../../../../scripts/deploy/host/state.mjs';
import {
  evaluateHostV2DeployPolicy,
  parseCanonicalHostDeployPolicyBytes,
} from '../../../../scripts/deploy/host/deploy-policy.mjs';
import { createHostAuditLog } from './audit-log.mjs';
import { HOST_DEPLOY_PATHS } from './constants.mjs';
import { invariant } from './canonical-json.mjs';
import {
  RequestIdentityCollisionError,
  RequestRetentionCapacityError,
  createRequestRecordStore,
} from './request-store.mjs';
import {
  createDurableFileOps,
  createSecurePathValidator,
} from './secure-filesystem.mjs';

const HOST_POLICY_PATH = '/etc/omnilodge/deploy-policy.json';
const TRANSPORT_KEY_LABEL = 'github-actions-production';
const FRAME_REJECTED_MESSAGE = 'Production deployment request rejected.\n';
const INTERNAL_FAILURE_MESSAGE = 'Production deployment request failed.\n';
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const execFile = promisify(execFileCallback);

const sanitizeDiagnosticText = (value, maximumLength = 512) => {
  const source = String(value ?? '');
  let output = '';
  for (const character of source) {
    const codePoint = character.codePointAt(0);
    output += codePoint >= 32 && codePoint <= 126 ? character : '?';
    if (output.length >= maximumLength) return output.slice(0, maximumLength);
  }
  return output;
};

const summarizeErrorForDiagnostic = (error) => Object.freeze({
  name: sanitizeDiagnosticText(error?.name || 'Error', 96),
  code: sanitizeDiagnosticText(error?.code || '', 96),
  message: sanitizeDiagnosticText(error?.message || 'Unknown error'),
});

export const appendSubmitDiagnostic = async ({
  fs = nativeFs,
  paths = HOST_DEPLOY_PATHS,
  clock = () => new Date(),
  identity,
  phase,
  error,
} = {}) => {
  const line = `${JSON.stringify({
    timestampUtc: clock().toISOString(),
    component: 'host-v2-submit',
    phase: sanitizeDiagnosticText(phase, 96),
    requestId: sanitizeDiagnosticText(identity?.requestId, 96),
    kind: sanitizeDiagnosticText(identity?.kind, 64),
    operation: sanitizeDiagnosticText(identity?.operation, 64),
    trigger: sanitizeDiagnosticText(identity?.trigger, 64),
    releaseId: sanitizeDiagnosticText(identity?.releaseId, 128),
    error: summarizeErrorForDiagnostic(error),
  })}\n`;
  await fs.appendFile(paths.deployLog, line, { mode: 0o600 });
};

const requestStateIdentity = (entry) => ({
  requestId: entry.requestState.request.requestId,
  requestSha256: entry.requestState.request.requestSha256,
});

const readPolicy = async ({
  policyPath,
  fs,
  security,
  readPolicyBytes,
}) => {
  if (readPolicyBytes !== null) {
    return parseCanonicalHostDeployPolicyBytes(await readPolicyBytes());
  }
  const inspected = await security.inspectFile(policyPath, { expectedMode: 0o600 });
  return parseCanonicalHostDeployPolicyBytes(await fs.readFile(inspected.path));
};

const safeCleanupArtifact = async (received) => {
  if (!received || typeof received.cleanupArtifact !== 'function') return;
  await received.cleanupArtifact();
};

const validateRequestId = (requestId) => {
  invariant(
    typeof requestId === 'string' && REQUEST_ID_PATTERN.test(requestId),
    'Worker request ID must be a canonical lowercase UUID v4',
  );
  return requestId;
};

export const incomingArtifactZipPath = ({ paths = HOST_DEPLOY_PATHS, requestId }) =>
  path.join(paths.incomingRoot, `${validateRequestId(requestId)}.zip`);

export const incomingEvidencePath = ({ paths = HOST_DEPLOY_PATHS, requestId }) =>
  path.join(paths.incomingRoot, `${validateRequestId(requestId)}.evidence.json`);

export const startHostDeployWorker = async ({
  requestId,
  systemctlPath = '/usr/bin/systemctl',
  runCommand = execFile,
} = {}) => {
  const validatedRequestId = validateRequestId(requestId);
  invariant(typeof systemctlPath === 'string' && systemctlPath.length > 0, 'systemctl path is required');
  invariant(typeof runCommand === 'function', 'worker start command is required');
  await runCommand(
    systemctlPath,
    ['--no-block', 'start', `omnilodge-deploy-worker@${validatedRequestId}.service`],
    {
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    },
  );
  return Object.freeze({ requestId: validatedRequestId, started: true });
};

const unlinkIfPresent = async (fs, targetPath) => {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

export const persistReceivedRequestForWorker = async ({
  received,
  fs = nativeFs,
  paths = HOST_DEPLOY_PATHS,
  fileOps = createDurableFileOps({ fs }),
} = {}) => {
  invariant(received?.identity?.kind === 'forward_submit', 'Only forward submit requests have worker payloads');
  invariant(Buffer.isBuffer(received.evidenceBytes) && received.evidenceBytes.length > 0, 'Received evidence bytes are required');
  invariant(typeof received.artifactZipPath === 'string' && received.artifactZipPath.length > 0, 'Received artifact ZIP path is required');

  const requestId = validateRequestId(received.identity.requestId);
  const artifactPath = incomingArtifactZipPath({ paths, requestId });
  const evidencePath = incomingEvidencePath({ paths, requestId });
  let evidenceWritten = false;
  let evidenceStat = null;
  let artifactLinked = false;

  try {
    const evidence = await fileOps.publishExclusiveBuffer(evidencePath, received.evidenceBytes);
    evidenceWritten = true;
    evidenceStat = evidence.stat;

    const source = await fs.lstat(received.artifactZipPath, { bigint: true });
    await fileOps.linkNoReplace(received.artifactZipPath, artifactPath);
    artifactLinked = true;
    await fileOps.unlinkVerified(received.artifactZipPath, source);
    await fileOps.syncDirectory(paths.incomingRoot);
    return Object.freeze({ requestId, artifactPath, evidencePath });
  } catch (error) {
    const cleanupErrors = [];
    if (artifactLinked) {
      try {
        await unlinkIfPresent(fs, artifactPath);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (evidenceWritten) {
      try {
        await fileOps.unlinkVerified(evidencePath, evidenceStat);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Worker request persistence failed and cleanup was incomplete',
      );
    }
    throw error;
  }
};

export const cleanupPersistedWorkerPayload = async ({
  staged,
  fs = nativeFs,
} = {}) => {
  if (!staged) return;
  await Promise.all([
    unlinkIfPresent(fs, staged.artifactPath),
    unlinkIfPresent(fs, staged.evidencePath),
  ]);
};

const appendAudit = async ({
  audit,
  identity,
  eventType,
  outcomeCode = null,
}) => audit.append({
  identity,
  transportKeyLabel: TRANSPORT_KEY_LABEL,
  eventType,
  outcomeCode,
});

const finishRejectedRequest = async ({
  store,
  admission,
  resultCode,
}) => {
  if (admission?.requestState === null || admission?.state === null) return admission;
  let current = admission;
  if (current.requestState.phase === 'received') {
    current = await store.advance({
      ...requestStateIdentity(current),
      fromPhase: 'received',
      nextPhase: 'rejected',
      resultCode,
    });
  }
  if (current.state === 'pending') {
    current = await store.transition({
      ...requestStateIdentity(current),
      from: 'pending',
      to: 'running',
    });
  }
  if (current.state === 'running') {
    current = await store.transition({
      ...requestStateIdentity(current),
      from: 'running',
      to: 'finished',
    });
  }
  return current;
};

export const createHostV2SubmitResponseFrame = ({
  identity,
  code,
  requestStatus = null,
}) => {
  const response = createHostV2Response({
    requestIdentity: identity,
    code,
    requestStatus,
  });
  return Object.freeze({
    response,
    frame: encodeHostV2ResponseFrame(response),
  });
};

export const handleHostV2SubmitRequest = async ({
  input,
  output,
  errorOutput,
  clock = () => new Date(),
  fs = nativeFs,
  security = createSecurePathValidator(),
  policyPath = HOST_POLICY_PATH,
  artifactDirectory = HOST_DEPLOY_PATHS.incomingRoot,
  paths = HOST_DEPLOY_PATHS,
  readPolicyBytes = null,
  requestStore = createRequestRecordStore({ paths, clock }),
  auditLog = createHostAuditLog({ clock }),
  receiveRequest = receiveHostV2RequestToFile,
  startWorker = startHostDeployWorker,
  persistForWorker = persistReceivedRequestForWorker,
  cleanupWorkerPayload = cleanupPersistedWorkerPayload,
  recordSubmitDiagnostic = appendSubmitDiagnostic,
} = {}) => {
  if (!input || typeof input[Symbol.asyncIterator] !== 'function') {
    throw new Error('Host submit input must be an async iterable');
  }
  if (!output || typeof output.write !== 'function') {
    throw new Error('Host submit output must be writable');
  }
  if (!errorOutput || typeof errorOutput.write !== 'function') {
    throw new Error('Host submit error output must be writable');
  }

  let received = null;
  const writeResponse = async ({ identity, code, requestStatus = null }) => {
    const responseFrame = createHostV2SubmitResponseFrame({
      identity,
      code,
      requestStatus,
    });
    await output.write(responseFrame.frame);
    return Object.freeze({
      exitCode: 0,
      response: responseFrame.response,
    });
  };

  try {
    const receivedAtUtc = clock().toISOString();
    received = await receiveRequest({ input, artifactDirectory });
    const { identity } = received;

    try {
      validateHostV2RequestFreshness({
        requestedAtUtc: identity.requestedAtUtc,
        receivedAtUtc,
      });
    } catch {
      await appendAudit({
        audit: auditLog,
        identity,
        eventType: 'request_rejected',
        outcomeCode: 'REQUEST_TIMESTAMP_REJECTED',
      });
      return await writeResponse({
        identity,
        code: 'REQUEST_TIMESTAMP_REJECTED',
      });
    }

    const policy = await readPolicy({
      policyPath,
      fs,
      security,
      readPolicyBytes,
    });
    const policyDecision = evaluateHostV2DeployPolicy({
      policy,
      requestIdentity: identity,
    });

    let admission;
    try {
      admission = await requestStore.admit({ identity });
    } catch (error) {
      if (
        error instanceof RequestIdentityCollisionError
        || error instanceof RequestRetentionCapacityError
      ) {
        await appendAudit({
          audit: auditLog,
          identity,
          eventType: 'request_rejected',
          outcomeCode: 'REPLAY_REJECTED',
        });
        return await writeResponse({ identity, code: 'REPLAY_REJECTED' });
      }
      throw error;
    }

    if (admission.disposition === 'replay') {
      await appendAudit({
        audit: auditLog,
        identity,
        eventType: 'request_replayed',
        outcomeCode: 'REPLAY_REJECTED',
      });
      return await writeResponse({ identity, code: 'REPLAY_REJECTED' });
    }

    await appendAudit({
      audit: auditLog,
      identity,
      eventType: 'request_admitted',
    });

    if (identity.kind === 'status_query') {
      const found = await requestStore.lookup(identity.subjectRequestId);
      if (found === null) {
        return await writeResponse({ identity, code: 'STATUS_NOT_FOUND' });
      }
      return await writeResponse({
        identity,
        code: 'STATUS_FOUND',
        requestStatus: createHostRequestStatus(found.requestState),
      });
    }

    if (!policyDecision.authorized) {
      await finishRejectedRequest({
        store: requestStore,
        admission,
        resultCode: 'POLICY_DENIED',
      });
      await appendAudit({
        audit: auditLog,
        identity,
        eventType: 'request_rejected',
        outcomeCode: 'POLICY_DENIED',
      });
      return await writeResponse({ identity, code: 'POLICY_DENIED' });
    }

    let staged = null;
    try {
      staged = await persistForWorker({
        received,
        fs,
        paths,
      });
      await startWorker({ requestId: identity.requestId });
    } catch (error) {
      await recordSubmitDiagnostic({
        fs,
        paths,
        clock,
        identity,
        phase: staged === null ? 'persist_worker_payload' : 'start_worker',
        error,
      }).catch(() => {});
      await cleanupWorkerPayload({ staged, fs });
      await finishRejectedRequest({
        store: requestStore,
        admission,
        resultCode: 'REQUEST_REJECTED',
      });
      await appendAudit({
        audit: auditLog,
        identity,
        eventType: 'request_rejected',
        outcomeCode: 'REQUEST_REJECTED',
      });
      return await writeResponse({ identity, code: 'REQUEST_REJECTED' });
    }

    return await writeResponse({ identity, code: 'REQUEST_ACCEPTED' });
  } catch (error) {
    if (received?.identity) {
      return await writeResponse({
        identity: received.identity,
        code: 'REQUEST_FAILED',
      });
    }
    await errorOutput.write(FRAME_REJECTED_MESSAGE);
    return Object.freeze({ exitCode: 65, response: null });
  } finally {
    try {
      await safeCleanupArtifact(received);
    } catch {
      await errorOutput.write(INTERNAL_FAILURE_MESSAGE);
    }
  }
};

export const runHostV2SubmitCli = async ({
  argv = process.argv.slice(2),
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
} = {}) => {
  if (argv.length !== 0 || uid !== 0) {
    await errorOutput.write('Deployment entry point refused.\n');
    return 64;
  }
  const result = await handleHostV2SubmitRequest({
    input,
    output,
    errorOutput,
  });
  return result.exitCode;
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  runHostV2SubmitCli().then((exitCode) => {
    process.exitCode = exitCode;
  }, async () => {
    await process.stderr.write(INTERNAL_FAILURE_MESSAGE);
    process.exitCode = 1;
  });
}
