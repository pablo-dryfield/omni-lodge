import path from 'node:path';

import { HOST_DEPLOY_PATHS } from './constants.mjs';
import { createDurableFileOps, sameStatIdentity } from './secure-filesystem.mjs';
import {
  MAX_HOST_STATE_BYTES,
  createHostActivationSnapshotReference,
  createHostActivationTransaction,
  createHostArtifactActivationSnapshot,
  parseCanonicalHostActivationSnapshotBytes,
  parseCanonicalHostActivationTransactionBytes,
  planHostActivationRecovery,
  serializeCanonicalHostActivationSnapshot,
  serializeCanonicalHostActivationTransaction,
  transitionHostActivationTransaction,
  validateHostActivationSnapshot,
  validateHostActivationTransactionBinding,
} from '../../../../scripts/deploy/host/state.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const isMissing = (error) => error?.code === 'ENOENT';
const isExisting = (error) => error?.code === 'EEXIST';

const validateUuid = (value, label) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical lowercase UUID v4`);
  }
  return value;
};

const requireDeployPreparedRequest = (requestState) => {
  if (requestState?.request?.kind !== 'forward_submit') {
    throw new Error('Only forward requests can prepare activation state');
  }
  if (requestState.intent?.operation !== 'deploy') {
    throw new Error('Only deploy requests can prepare activation state');
  }
  if (requestState.phase !== 'activation_prepared') {
    throw new Error('Activation state requires an activation-prepared request');
  }
  return requestState;
};

const referenceKey = (reference) => `${reference.activationId}:${reference.snapshotSha256}`;

const snapshotRecordFromBytes = ({ bytes, path: filePath, stat }) => {
  const snapshot = parseCanonicalHostActivationSnapshotBytes(bytes);
  return Object.freeze({
    snapshot,
    reference: createHostActivationSnapshotReference(snapshot),
    path: filePath,
    stat,
  });
};

const compareReference = (left, right, label) => {
  if (referenceKey(left) !== referenceKey(right)) {
    throw new Error(`${label} does not match its expected activation snapshot reference`);
  }
};

export const activationSnapshotPath = ({ paths = HOST_DEPLOY_PATHS, activationId }) =>
  path.join(paths.stateRoot, `${validateUuid(activationId, 'Activation snapshot ID')}.activation-snapshot.json`);

export const activeActivationSnapshotPath = ({ paths = HOST_DEPLOY_PATHS } = {}) =>
  path.join(paths.stateRoot, 'active-activation-snapshot.json');

export const activationTransactionPath = ({ paths = HOST_DEPLOY_PATHS, requestId }) =>
  path.join(paths.stateRoot, `${validateUuid(requestId, 'Activation transaction request ID')}.activation-transaction.json`);

export const createActivationStateStore = ({
  paths = HOST_DEPLOY_PATHS,
  fileOps = createDurableFileOps(),
  clock = () => new Date(),
  createActivationId = (requestState) => requestState.request.requestId,
} = {}) => {
  const readSnapshotAt = async (targetPath, { required = true } = {}) => {
    try {
      const loaded = await fileOps.readSecureBuffer(targetPath, {
        maximumBytes: MAX_HOST_STATE_BYTES,
      });
      const record = snapshotRecordFromBytes({
        bytes: loaded.bytes,
        path: targetPath,
        stat: loaded.stat,
      });
      return record;
    } catch (error) {
      if (!required && isMissing(error)) return null;
      throw error;
    }
  };

  const publishOrVerifySnapshot = async (snapshot) => {
    const validated = validateHostActivationSnapshot(snapshot);
    const reference = createHostActivationSnapshotReference(validated);
    const targetPath = activationSnapshotPath({
      paths,
      activationId: reference.activationId,
    });
    const bytes = serializeCanonicalHostActivationSnapshot(validated);
    try {
      const published = await fileOps.publishExclusiveBuffer(targetPath, bytes);
      return Object.freeze({
        snapshot: validated,
        reference,
        path: targetPath,
        stat: published.stat,
      });
    } catch (error) {
      if (!isExisting(error)) throw error;
      const existing = await readSnapshotAt(targetPath);
      compareReference(existing.reference, reference, 'Existing activation snapshot');
      return existing;
    }
  };

  const readSnapshotByReference = async (reference) => {
    const targetPath = activationSnapshotPath({
      paths,
      activationId: reference.activationId,
    });
    const record = await readSnapshotAt(targetPath);
    compareReference(record.reference, reference, 'Stored activation snapshot');
    return record;
  };

  const readActiveSnapshot = async () => readSnapshotAt(
    activeActivationSnapshotPath({ paths }),
    { required: false },
  );

  const initializeActiveSnapshot = async (snapshot) => {
    const stored = await publishOrVerifySnapshot(snapshot);
    const activePath = activeActivationSnapshotPath({ paths });
    const bytes = serializeCanonicalHostActivationSnapshot(stored.snapshot);
    try {
      const published = await fileOps.publishExclusiveBuffer(activePath, bytes);
      return Object.freeze({ ...stored, activePath, activeStat: published.stat });
    } catch (error) {
      if (!isExisting(error)) throw error;
      const active = await readSnapshotAt(activePath);
      compareReference(active.reference, stored.reference, 'Active activation snapshot');
      return Object.freeze({ ...active, activePath, activeStat: active.stat });
    }
  };

  const readTransaction = async ({
    requestId,
    requestState = null,
  }) => {
    const targetPath = activationTransactionPath({ paths, requestId });
    const loaded = await fileOps.readSecureBuffer(targetPath, {
      maximumBytes: MAX_HOST_STATE_BYTES,
    });
    const transaction = parseCanonicalHostActivationTransactionBytes(loaded.bytes);
    const previous = await readSnapshotByReference(transaction.previousSnapshot);
    const target = await readSnapshotByReference(transaction.targetSnapshot);
    if (requestState !== null) {
      validateHostActivationTransactionBinding({
        transaction,
        requestState,
        previousSnapshot: previous.snapshot,
        targetSnapshot: target.snapshot,
      });
    }
    return Object.freeze({
      transaction,
      previousSnapshot: previous.snapshot,
      targetSnapshot: target.snapshot,
      path: targetPath,
      stat: loaded.stat,
    });
  };

  const publishOrVerifyTransaction = async ({
    transaction,
    requestState,
    previousSnapshot,
    targetSnapshot,
  }) => {
    const binding = validateHostActivationTransactionBinding({
      transaction,
      requestState,
      previousSnapshot,
      targetSnapshot,
    });
    const targetPath = activationTransactionPath({
      paths,
      requestId: binding.transaction.requestId,
    });
    const bytes = serializeCanonicalHostActivationTransaction(binding.transaction);
    try {
      const published = await fileOps.publishExclusiveBuffer(targetPath, bytes);
      return Object.freeze({
        transaction: binding.transaction,
        previousSnapshot: binding.previousSnapshot,
        targetSnapshot: binding.targetSnapshot,
        path: targetPath,
        stat: published.stat,
      });
    } catch (error) {
      if (!isExisting(error)) throw error;
      return readTransaction({
        requestId: binding.transaction.requestId,
        requestState,
      });
    }
  };

  const prepareForwardActivation = async ({ requestState: rawRequestState }) => {
    const requestState = requireDeployPreparedRequest(rawRequestState);
    try {
      return await readTransaction({
        requestId: requestState.request.requestId,
        requestState,
      });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }

    const previous = await readActiveSnapshot();
    if (previous === null) {
      throw new Error('Active activation snapshot is missing; capture the legacy baseline before deployment');
    }
    const activationId = validateUuid(
      createActivationId(requestState),
      'Created activation snapshot ID',
    );
    const targetSnapshot = createHostArtifactActivationSnapshot({
      requestState,
      activationId,
      activatedAtUtc: clock().toISOString(),
      predecessorSnapshot: previous.snapshot,
    });
    const target = await publishOrVerifySnapshot(targetSnapshot);
    const transaction = createHostActivationTransaction({
      requestState,
      previousSnapshot: previous.snapshot,
      targetSnapshot: target.snapshot,
      createdAtUtc: clock().toISOString(),
    });
    return publishOrVerifyTransaction({
      transaction,
      requestState,
      previousSnapshot: previous.snapshot,
      targetSnapshot: target.snapshot,
    });
  };

  const planRecovery = async ({ requestId, requestState }) => {
    const record = await readTransaction({ requestId, requestState });
    return planHostActivationRecovery({
      transaction: record.transaction,
      requestState,
      previousSnapshot: record.previousSnapshot,
      targetSnapshot: record.targetSnapshot,
    });
  };

  const transitionTransaction = async ({
    requestState,
    nextPhase,
  }) => {
    const record = await readTransaction({
      requestId: requestState.request.requestId,
      requestState,
    });
    if (record.transaction.phase === nextPhase) {
      return Object.freeze({ disposition: 'already-transitioned', ...record });
    }
    const transaction = transitionHostActivationTransaction({
      transaction: record.transaction,
      requestState,
      previousSnapshot: record.previousSnapshot,
      targetSnapshot: record.targetSnapshot,
      nextPhase,
      updatedAtUtc: clock().toISOString(),
    });
    const bytes = serializeCanonicalHostActivationTransaction(transaction);
    await fileOps.replaceBuffer(record.path, bytes, record.stat);
    const reread = await readTransaction({
      requestId: requestState.request.requestId,
      requestState,
    });
    if (reread.transaction.phase !== nextPhase) {
      throw new Error('Activation transaction did not advance to the requested phase');
    }
    return Object.freeze({ disposition: 'transitioned', ...reread });
  };

  const commitActiveSnapshot = async ({
    transaction,
    requestState,
    previousSnapshot,
    targetSnapshot,
  }) => {
    const binding = validateHostActivationTransactionBinding({
      transaction,
      requestState,
      previousSnapshot,
      targetSnapshot,
    });
    if (binding.transaction.phase !== 'committed') {
      throw new Error('Only a committed activation transaction can update the active snapshot');
    }
    const activePath = activeActivationSnapshotPath({ paths });
    const active = await readSnapshotAt(activePath);
    compareReference(
      active.reference,
      binding.transaction.previousSnapshot,
      'Current active activation snapshot',
    );
    const bytes = serializeCanonicalHostActivationSnapshot(binding.targetSnapshot);
    const replaced = await fileOps.replaceBuffer(activePath, bytes, active.stat);
    const reread = await readSnapshotAt(activePath);
    compareReference(reread.reference, binding.transaction.targetSnapshot, 'Committed active snapshot');
    if (!sameStatIdentity(replaced.stat, reread.stat)) {
      throw new Error('Committed active snapshot was not durably replaced');
    }
    return reread;
  };

  return Object.freeze({
    activePath: () => activeActivationSnapshotPath({ paths }),
    snapshotPath: (activationId) => activationSnapshotPath({ paths, activationId }),
    transactionPath: (requestId) => activationTransactionPath({ paths, requestId }),
    readActiveSnapshot,
    readSnapshotByReference,
    readTransaction,
    initializeActiveSnapshot,
    prepareForwardActivation,
    transitionTransaction,
    planRecovery,
    commitActiveSnapshot,
  });
};
