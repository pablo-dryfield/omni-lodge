#!/usr/bin/env node

import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
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
import {
  RequestIdentityCollisionError,
  RequestRetentionCapacityError,
  createRequestRecordStore,
} from './request-store.mjs';
import { createSecurePathValidator } from './secure-filesystem.mjs';

const HOST_POLICY_PATH = '/etc/omnilodge/deploy-policy.json';
const TRANSPORT_KEY_LABEL = 'github-actions-production';
const FRAME_REJECTED_MESSAGE = 'Production deployment request rejected.\n';
const INTERNAL_FAILURE_MESSAGE = 'Production deployment request failed.\n';

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

    // Endpoint-only slice: the host can authenticate, validate, record, audit,
    // and answer protocol-v2 requests. It deliberately does not activate the
    // detached staging/worker path yet, so authorized submit requests are
    // durably rejected instead of being left in a pending state.
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
