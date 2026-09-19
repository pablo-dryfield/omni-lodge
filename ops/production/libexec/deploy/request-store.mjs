import path from 'node:path';

import {
  HOST_DEPLOY_RETENTION,
  HOST_DEPLOY_PATHS,
  REQUEST_STATES,
  REQUEST_TRANSITIONS,
} from './constants.mjs';
import { createDurableFileOps, sameStatIdentity } from './secure-filesystem.mjs';
import {
  createRequestNonceRecord,
  parseCanonicalRequestNonceBytes,
  serializeCanonicalRequestNonce,
} from './state-schema.mjs';
import { validateHostV2RequestIdentity } from '../../../../scripts/deploy/host/protocol-v2.mjs';
import {
  createInitialHostRequestState,
  parseCanonicalHostRequestStateBytes,
  serializeCanonicalHostRequestState,
  transitionHostRequestState,
} from '../../../../scripts/deploy/host/state.mjs';

const MAX_REQUEST_STATE_BYTES = 32 * 1024;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STATE_RANK = new Map(REQUEST_STATES.map((state, index) => [state, index]));
const TERMINAL_PHASES = new Set(['succeeded', 'failed', 'rejected']);
const RECORD_FILE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/;

const isMissing = (error) => error?.code === 'ENOENT';
const isExisting = (error) => error?.code === 'EEXIST';

const validateRequestId = (value) => {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    throw new Error('Request ID must be a canonical lowercase UUID v4');
  }
  return value;
};

const validateRequestSha256 = (value) => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error('Request digest must be a lowercase SHA-256 digest');
  }
  return value;
};

export class RequestIdentityCollisionError extends Error {
  constructor(requestId) {
    super(`Request ID ${requestId} is already bound to a different full request digest`);
    this.name = 'RequestIdentityCollisionError';
    this.code = 'REQUEST_IDENTITY_COLLISION';
  }
}

export class RequestStateTransitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestStateTransitionError';
    this.code = 'REQUEST_STATE_TRANSITION_INVALID';
  }
}

export class RequestRetentionCapacityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestRetentionCapacityError';
    this.code = 'REQUEST_RETENTION_CAPACITY_EXHAUSTED';
  }
}

const validatePaths = (paths) => {
  const result = {
    pending: paths.pendingRequests,
    running: paths.runningRequests,
    finished: paths.finishedRequests,
  };
  for (const state of REQUEST_STATES) {
    if (typeof result[state] !== 'string' || result[state].length === 0) {
      throw new Error(`Request store ${state} path is missing`);
    }
  }
  if (typeof paths.requestNonces !== 'string' || paths.requestNonces.length === 0) {
    throw new Error('Request nonce store path is missing');
  }
  return Object.freeze({
    states: Object.freeze(result),
    nonces: paths.requestNonces,
  });
};

const validateRetentionPolicy = (policy) => {
  const positiveInteger = (value, label) => {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid`);
    return value;
  };
  return Object.freeze({
    requestNonceRetentionMs: positiveInteger(
      policy.requestNonceRetentionMs,
      'Request nonce retention',
    ),
    finishedRequestRetentionMs: positiveInteger(
      policy.finishedRequestRetentionMs,
      'Finished request retention',
    ),
    maximumNonceRecords: positiveInteger(
      policy.maximumNonceRecords,
      'Maximum request nonce records',
    ),
    maximumDeploymentRecords: positiveInteger(
      policy.maximumDeploymentRecords,
      'Maximum deployment request records',
    ),
  });
};

const stateIdentity = (state) => Object.freeze({
  requestId: state.request.requestId,
  requestSha256: state.request.requestSha256,
});

export const createRequestRecordStore = ({
  paths = HOST_DEPLOY_PATHS,
  retentionPolicy = HOST_DEPLOY_RETENTION,
  fileOps = createDurableFileOps(),
  clock = () => new Date(),
  pathApi = path,
  identityValidator = validateHostV2RequestIdentity,
  initialStateFactory = createInitialHostRequestState,
  stateParser = parseCanonicalHostRequestStateBytes,
  stateSerializer = serializeCanonicalHostRequestState,
  stateTransition = transitionHostRequestState,
} = {}) => {
  const storePaths = validatePaths(paths);
  const stateDirectories = storePaths.states;
  const retention = validateRetentionPolicy(retentionPolicy);
  let mutationTail = Promise.resolve();

  const serializeMutation = (operation) => {
    const result = mutationTail.then(operation);
    mutationTail = result.catch(() => undefined);
    return result;
  };

  const recordPath = (state, requestId) => {
    if (!STATE_RANK.has(state)) throw new Error(`Unknown request state: ${state}`);
    return pathApi.join(stateDirectories[state], `${validateRequestId(requestId)}.json`);
  };

  const noncePath = (requestId) => pathApi.join(
    storePaths.nonces,
    `${validateRequestId(requestId)}.json`,
  );

  const idsInDirectory = async (directory, maximumEntries, label) => {
    const names = await fileOps.listSecureDirectory(directory, {
      maximumEntries: maximumEntries + 1,
    });
    if (names.length > maximumEntries) {
      throw new RequestRetentionCapacityError(`${label} exceeds its retained record limit`);
    }
    return names.map((name) => {
      const match = RECORD_FILE_PATTERN.exec(name);
      if (match === null) throw new Error(`${label} contains an invalid record filename`);
      return match[1];
    });
  };

  const readNonce = async (requestId) => {
    const validatedRequestId = validateRequestId(requestId);
    const targetPath = noncePath(validatedRequestId);
    try {
      const loaded = await fileOps.readSecureBuffer(targetPath, {
        maximumBytes: 2 * 1024,
      });
      const record = parseCanonicalRequestNonceBytes(loaded.bytes);
      if (record.requestId !== validatedRequestId) {
        throw new Error('Request nonce filename does not match its request ID');
      }
      return Object.freeze({ record, path: targetPath, stat: loaded.stat });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  const readAt = async (state, requestId) => {
    const targetPath = recordPath(state, requestId);
    try {
      const loaded = await fileOps.readSecureBuffer(targetPath, {
        maximumBytes: MAX_REQUEST_STATE_BYTES,
      });
      const requestState = stateParser(loaded.bytes);
      if (requestState.request.requestId !== requestId) {
        throw new Error('Request state filename does not match its request ID');
      }
      return Object.freeze({
        state,
        requestState,
        identity: stateIdentity(requestState),
        path: targetPath,
        stat: loaded.stat,
      });
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  const lookup = async (requestId) => {
    const validatedRequestId = validateRequestId(requestId);
    const found = (await Promise.all(
      REQUEST_STATES.map((state) => readAt(state, validatedRequestId)),
    )).filter(Boolean);
    if (found.length === 0) return null;

    const first = found[0];
    for (const entry of found.slice(1)) {
      if (first.identity.requestSha256 !== entry.identity.requestSha256) {
        throw new RequestIdentityCollisionError(validatedRequestId);
      }
      if (!sameStatIdentity(first.stat, entry.stat)) {
        throw new Error(`Request ${validatedRequestId} has conflicting durable state records`);
      }
    }
    const selected = [...found].sort(
      (left, right) => STATE_RANK.get(right.state) - STATE_RANK.get(left.state),
    )[0];
    return Object.freeze({
      ...selected,
      duplicateStates: Object.freeze(found
        .map((entry) => entry.state)
        .filter((state) => state !== selected.state)),
      recoveryNeeded: found.length > 1,
    });
  };

  const requireMatchingDigest = (existing, requestSha256) => {
    if (existing.identity.requestSha256 !== requestSha256) {
      throw new RequestIdentityCollisionError(existing.identity.requestId);
    }
    return existing;
  };

  const requireMatchingAdmissionIdentity = (existing, validatedIdentity) => {
    requireMatchingDigest(existing, validatedIdentity.requestSha256);
    const expected = initialStateFactory({
      requestIdentity: validatedIdentity,
      receivedAtUtc: existing.requestState.receivedAtUtc,
    });
    if (JSON.stringify(existing.requestState.request) !== JSON.stringify(expected.request)
      || JSON.stringify(existing.requestState.intent) !== JSON.stringify(expected.intent)) {
      throw new RequestIdentityCollisionError(validatedIdentity.requestId);
    }
    return existing;
  };

  const requireMatchingNonce = (nonce, validatedIdentity) => {
    if (nonce.record.requestSha256 !== validatedIdentity.requestSha256
      || nonce.record.requestKind !== validatedIdentity.kind) {
      throw new RequestIdentityCollisionError(validatedIdentity.requestId);
    }
    return nonce;
  };

  const deploymentRecordIds = async () => {
    const identifiers = new Set();
    for (const state of REQUEST_STATES) {
      const ids = await idsInDirectory(
        stateDirectories[state],
        retention.maximumDeploymentRecords,
        `${state} request store`,
      );
      for (const requestId of ids) identifiers.add(requestId);
    }
    if (identifiers.size > retention.maximumDeploymentRecords) {
      throw new RequestRetentionCapacityError('Deployment request store is at capacity');
    }
    return identifiers;
  };

  const removeFinishedRecord = async (entry) => {
    let selected = entry;
    if (selected.recoveryNeeded) {
      await cleanEarlierHardLinks(selected);
      selected = await lookup(selected.identity.requestId);
    }
    if (selected === null || selected.state !== 'finished') {
      throw new Error('Finished request record changed during retention cleanup');
    }
    await fileOps.unlinkVerified(selected.path, selected.stat);
  };

  const pruneExpiredInternal = async (now) => {
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) throw new Error('Retention clock is invalid');
    const finishedCutoffMs = nowMs - retention.finishedRequestRetentionMs;
    let noncesRemoved = 0;
    let finishedRemoved = 0;

    const nonceIds = await idsInDirectory(
      storePaths.nonces,
      retention.maximumNonceRecords,
      'Request nonce store',
    );
    for (const requestId of nonceIds) {
      const nonce = await readNonce(requestId);
      if (nonce === null || new Date(nonce.record.expiresAtUtc).getTime() > nowMs) continue;
      const existing = await lookup(requestId);
      if (existing !== null) {
        requireMatchingDigest(existing, nonce.record.requestSha256);
        if (existing.state !== 'finished') continue;
        const finishedAtMs = new Date(existing.requestState.updatedAtUtc).getTime();
        if (finishedAtMs > finishedCutoffMs) continue;
      }

      // Removing the nonce first is deliberate. If the host crashes here, the
      // still-present finished record continues to reject collisions/replays.
      await fileOps.unlinkVerified(nonce.path, nonce.stat);
      noncesRemoved += 1;
      if (existing !== null) {
        await removeFinishedRecord(existing);
        finishedRemoved += 1;
      }
    }

    const finishedIds = await idsInDirectory(
      stateDirectories.finished,
      retention.maximumDeploymentRecords,
      'finished request store',
    );
    for (const requestId of finishedIds) {
      const nonce = await readNonce(requestId);
      if (nonce !== null) continue;
      const existing = await lookup(requestId);
      if (existing === null || existing.state !== 'finished') continue;
      const finishedAtMs = new Date(existing.requestState.updatedAtUtc).getTime();
      if (finishedAtMs > finishedCutoffMs) continue;
      await removeFinishedRecord(existing);
      finishedRemoved += 1;
    }

    return Object.freeze({ noncesRemoved, finishedRemoved });
  };

  const reserveNonce = async (validatedIdentity, now) => {
    const existingNonce = await readNonce(validatedIdentity.requestId);
    if (existingNonce !== null) {
      return Object.freeze({
        disposition: 'replay',
        ...requireMatchingNonce(existingNonce, validatedIdentity),
      });
    }

    const nonceIds = await idsInDirectory(
      storePaths.nonces,
      retention.maximumNonceRecords,
      'Request nonce store',
    );
    if (nonceIds.length >= retention.maximumNonceRecords) {
      throw new RequestRetentionCapacityError('Request nonce store is at capacity');
    }
    const reservedAtUtc = now.toISOString();
    const expiresAtUtc = new Date(
      now.getTime() + retention.requestNonceRetentionMs,
    ).toISOString();
    const record = createRequestNonceRecord({
      identity: validatedIdentity,
      reservedAtUtc,
      expiresAtUtc,
    });
    const targetPath = noncePath(validatedIdentity.requestId);
    try {
      const published = await fileOps.publishExclusiveBuffer(
        targetPath,
        serializeCanonicalRequestNonce(record),
      );
      return Object.freeze({
        disposition: 'created',
        record,
        path: targetPath,
        stat: published.stat,
      });
    } catch (error) {
      if (!isExisting(error)) throw error;
      const raced = await readNonce(validatedIdentity.requestId);
      if (raced === null) throw error;
      return Object.freeze({
        disposition: 'replay',
        ...requireMatchingNonce(raced, validatedIdentity),
      });
    }
  };

  const admitInternal = async ({ identity }) => {
    const validatedIdentity = identityValidator(identity);
    const now = clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('Request reservation clock is invalid');
    }
    await pruneExpiredInternal(now);

    const existingBeforeNonce = await lookup(validatedIdentity.requestId);
    if (existingBeforeNonce !== null) {
      if (validatedIdentity.kind === 'status_query') {
        throw new RequestIdentityCollisionError(validatedIdentity.requestId);
      }
      requireMatchingAdmissionIdentity(existingBeforeNonce, validatedIdentity);
    }
    if (validatedIdentity.kind !== 'status_query'
      && existingBeforeNonce === null
      && (await deploymentRecordIds()).size >= retention.maximumDeploymentRecords) {
      throw new RequestRetentionCapacityError('Deployment request store is at capacity');
    }

    const nonce = await reserveNonce(validatedIdentity, now);
    if (validatedIdentity.kind === 'status_query') {
      return Object.freeze({
        disposition: nonce.disposition,
        state: null,
        requestState: null,
        identity: Object.freeze({
          requestId: nonce.record.requestId,
          requestSha256: nonce.record.requestSha256,
        }),
        nonce,
      });
    }

    const existing = existingBeforeNonce ?? await lookup(validatedIdentity.requestId);
    if (existing !== null) {
      return Object.freeze({
        disposition: 'replay',
        nonce,
        ...requireMatchingAdmissionIdentity(existing, validatedIdentity),
      });
    }

    const requestState = initialStateFactory({
      requestIdentity: validatedIdentity,
      receivedAtUtc: nonce.record.reservedAtUtc,
    });
    const targetPath = recordPath('pending', validatedIdentity.requestId);
    try {
      const published = await fileOps.publishExclusiveBuffer(
        targetPath,
        stateSerializer(requestState),
      );
      return Object.freeze({
        disposition: 'created',
        state: 'pending',
        requestState,
        identity: stateIdentity(requestState),
        path: targetPath,
        stat: published.stat,
        duplicateStates: Object.freeze([]),
        recoveryNeeded: false,
        nonce,
      });
    } catch (error) {
      if (!isExisting(error)) throw error;
      const raced = await lookup(validatedIdentity.requestId);
      if (raced === null) throw error;
      return Object.freeze({
        disposition: 'replay',
        nonce,
        ...requireMatchingAdmissionIdentity(raced, validatedIdentity),
      });
    }
  };

  const cleanEarlierHardLinks = async (entry) => {
    for (const duplicateState of entry.duplicateStates) {
      if (STATE_RANK.get(duplicateState) >= STATE_RANK.get(entry.state)) continue;
      const duplicate = await readAt(duplicateState, entry.identity.requestId);
      if (duplicate === null) continue;
      if (!sameStatIdentity(duplicate.stat, entry.stat)) {
        throw new Error('Refusing to remove a conflicting request transition record');
      }
      await fileOps.unlinkVerified(duplicate.path, duplicate.stat);
    }
  };

  const transition = async ({ requestId, requestSha256, from, to }) => {
    const validatedRequestId = validateRequestId(requestId);
    const validatedRequestSha256 = validateRequestSha256(requestSha256);
    if (REQUEST_TRANSITIONS[from] !== to) {
      throw new RequestStateTransitionError(`Transition ${from} -> ${to} is not allowed`);
    }

    let existing = await lookup(validatedRequestId);
    if (existing === null) {
      throw new RequestStateTransitionError(`Request ${validatedRequestId} does not exist`);
    }
    requireMatchingDigest(existing, validatedRequestSha256);
    if (existing.state === to) {
      await cleanEarlierHardLinks(existing);
      existing = await lookup(validatedRequestId);
      return Object.freeze({ disposition: 'already-transitioned', ...existing });
    }
    if (existing.state !== from) {
      throw new RequestStateTransitionError(
        `Request ${validatedRequestId} is ${existing.state}, not ${from}`,
      );
    }
    if (to === 'finished' && !TERMINAL_PHASES.has(existing.requestState.phase)) {
      throw new RequestStateTransitionError(
        `Request ${validatedRequestId} cannot finish from phase ${existing.requestState.phase}`,
      );
    }

    const destinationPath = recordPath(to, validatedRequestId);
    try {
      await fileOps.linkNoReplace(existing.path, destinationPath);
    } catch (error) {
      if (!isExisting(error)) throw error;
      const raced = await lookup(validatedRequestId);
      if (raced === null || STATE_RANK.get(raced.state) < STATE_RANK.get(to)) throw error;
      requireMatchingDigest(raced, validatedRequestSha256);
      await cleanEarlierHardLinks(raced);
      const settled = await lookup(validatedRequestId);
      return Object.freeze({ disposition: 'already-transitioned', ...settled });
    }

    try {
      await fileOps.unlinkVerified(existing.path, existing.stat);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const transitioned = await lookup(validatedRequestId);
    if (transitioned === null || transitioned.state !== to) {
      throw new Error(`Request ${validatedRequestId} transition was not durable`);
    }
    return Object.freeze({ disposition: 'transitioned', ...transitioned });
  };

  const advance = async ({
    requestId,
    requestSha256,
    fromPhase,
    nextPhase,
    resultCode = null,
  }) => {
    const validatedRequestId = validateRequestId(requestId);
    const validatedRequestSha256 = validateRequestSha256(requestSha256);
    if (typeof fromPhase !== 'string' || typeof nextPhase !== 'string') {
      throw new RequestStateTransitionError('Request phase transition is invalid');
    }
    let existing = await lookup(validatedRequestId);
    if (existing === null) {
      throw new RequestStateTransitionError(`Request ${validatedRequestId} does not exist`);
    }
    requireMatchingDigest(existing, validatedRequestSha256);
    if (existing.recoveryNeeded) {
      await cleanEarlierHardLinks(existing);
      existing = await lookup(validatedRequestId);
    }
    if (existing.requestState.phase === nextPhase) {
      return Object.freeze({ disposition: 'already-advanced', ...existing });
    }
    if (existing.requestState.phase !== fromPhase) {
      throw new RequestStateTransitionError(
        `Request ${validatedRequestId} phase is ${existing.requestState.phase}, not ${fromPhase}`,
      );
    }
    const nextRequestState = stateTransition({
      state: existing.requestState,
      nextPhase,
      updatedAtUtc: clock().toISOString(),
      resultCode,
    });
    const replaced = await fileOps.replaceBuffer(
      existing.path,
      stateSerializer(nextRequestState),
      existing.stat,
    );
    const updated = await lookup(validatedRequestId);
    if (updated === null
      || updated.requestState.phase !== nextRequestState.phase
      || !sameStatIdentity(updated.stat, replaced.stat)) {
      throw new Error(`Request ${validatedRequestId} state update was not durable`);
    }
    return Object.freeze({ disposition: 'advanced', ...updated });
  };

  return Object.freeze({
    admit: (options) => serializeMutation(() => admitInternal(options)),
    advance: (options) => serializeMutation(() => advance(options)),
    lookup,
    lookupNonce: readNonce,
    pruneExpired: () => serializeMutation(() => pruneExpiredInternal(clock())),
    transition: (options) => serializeMutation(() => transition(options)),
    recordPath,
    noncePath,
  });
};
