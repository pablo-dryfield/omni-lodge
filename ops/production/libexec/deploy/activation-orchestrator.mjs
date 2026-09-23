const DEFAULT_RESTART_COMPONENTS = Object.freeze(['backend', 'ui-server']);
const RESTORE_REQUIRED_REQUEST_PHASES = new Set(['pointer_switching', 'pointers_switched', 'smoke_verified']);
const RESTORE_IN_PROGRESS_REQUEST_PHASES = new Set(['restore_required', 'restoring_previous', 'previous_restored']);
const RESTORE_REQUIRED_TRANSACTION_PHASES = new Set(['pointer_switching', 'pointers_switched', 'smoke_verified']);
const RESTORE_IN_PROGRESS_TRANSACTION_PHASES = new Set(['restore_required', 'restoring_previous', 'previous_restored']);
const MANAGED_RUNTIME_SNAPSHOT_KINDS = new Set(['artifact_release']);

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requireObject = (value, label) => {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} is required`);
  return value;
};

const requireFunction = (value, label) => {
  invariant(typeof value === 'function', `${label} is required`);
  return value;
};

const requireEntry = (entry) => {
  requireObject(entry, 'Activation request entry');
  requireObject(entry.requestState, 'Activation request state');
  return entry;
};

const requireActivationPreparedDeploy = (entry) => {
  const checked = requireEntry(entry);
  const { requestState } = checked;
  invariant(requestState.request?.kind === 'forward_submit', 'Only forward deployment requests can be activated');
  invariant(requestState.intent?.operation === 'deploy', 'Only deploy requests can be activated');
  invariant(requestState.phase === 'activation_prepared', 'Activation cutover requires an activation-prepared request');
  return checked;
};

const requireActivationPreparedRollback = (entry) => {
  const checked = requireEntry(entry);
  const { requestState } = checked;
  invariant(requestState.request?.kind === 'rollback_submit', 'Only rollback requests can use rollback activation');
  invariant(requestState.intent?.trigger === 'manual', 'Only manually triggered rollback requests can be activated');
  invariant(requestState.phase === 'activation_prepared', 'Rollback cutover requires an activation-prepared request');
  return checked;
};

const requireRecoverableActivationRequest = (entry) => {
  const checked = requireEntry(entry);
  const { requestState } = checked;
  if (requestState.request?.kind === 'forward_submit') {
    invariant(requestState.intent?.operation === 'deploy', 'Only deploy requests can be recovered');
  } else {
    invariant(requestState.request?.kind === 'rollback_submit', 'Only rollback requests can be recovered');
    invariant(requestState.intent?.trigger === 'manual', 'Only manually triggered rollback requests can be recovered');
  }
  return checked;
};

const advanceRequest = async ({
  requestStore,
  entry,
  nextPhase,
  resultCode = null,
}) => {
  const requestState = requireEntry(entry).requestState;
  const advanced = await requestStore.advance({
    requestId: requestState.request.requestId,
    requestSha256: requestState.request.requestSha256,
    fromPhase: requestState.phase,
    nextPhase,
    resultCode,
  });
  invariant(advanced?.requestState?.phase === nextPhase, `Request did not advance to ${nextPhase}`);
  return advanced;
};

const advanceRequestTo = async ({
  requestStore,
  entry,
  nextPhase,
  resultCode = null,
}) => {
  const checked = requireEntry(entry);
  if (checked.requestState.phase === nextPhase) return checked;
  return advanceRequest({
    requestStore,
    entry: checked,
    nextPhase,
    resultCode,
  });
};

const transitionActivation = async ({
  activationStore,
  requestState,
  nextPhase,
}) => {
  const transitioned = await activationStore.transitionTransaction({
    requestState,
    nextPhase,
  });
  invariant(transitioned?.transaction?.phase === nextPhase, `Activation transaction did not advance to ${nextPhase}`);
  return transitioned;
};

const readActivationTransaction = async ({
  activationStore,
  requestState,
}) => {
  const record = await activationStore.readTransaction({
    requestId: requestState.request.requestId,
    requestState,
  });
  invariant(record?.transaction?.phase, 'Activation transaction record is missing a phase');
  return record;
};

const releaseIdentity = (targetSnapshot) => {
  requireObject(targetSnapshot, 'Activation target snapshot');
  invariant(typeof targetSnapshot.releaseId === 'string' && targetSnapshot.releaseId.length > 0, 'Activation target release ID is missing');
  invariant(typeof targetSnapshot.sourceSha === 'string' && targetSnapshot.sourceSha.length > 0, 'Activation target source SHA is missing');
  return Object.freeze({
    releaseId: targetSnapshot.releaseId,
    sourceSha: targetSnapshot.sourceSha,
  });
};

const usesManagedRuntime = (snapshot) => MANAGED_RUNTIME_SNAPSHOT_KINDS.has(snapshot?.snapshotKind);

const throwWithActivationProgress = (error, progress) => {
  if (error && typeof error === 'object') {
    Object.defineProperty(error, 'activationProgress', {
      value: Object.freeze(progress),
      enumerable: true,
      configurable: true,
    });
    throw error;
  }
  const wrapped = new Error(String(error));
  Object.defineProperty(wrapped, 'activationProgress', {
    value: Object.freeze(progress),
    enumerable: true,
    configurable: true,
  });
  throw wrapped;
};

export const createActivationOrchestrator = ({
  activationStore,
  requestStore,
  pointerSwitcher,
  pm2Controller,
  originReadinessRunner,
  publicSmokeRunner,
  now = () => new Date(),
} = {}) => {
  const checkedActivationStore = requireObject(activationStore, 'Activation state store');
  const checkedRequestStore = requireObject(requestStore, 'Request record store');
  const checkedPointerSwitcher = requireObject(pointerSwitcher, 'Activation pointer switcher');
  const checkedPm2Controller = requireObject(pm2Controller, 'PM2 service controller');
  const runOriginReadiness = requireFunction(originReadinessRunner, 'Managed origin readiness runner');
  const runSmoke = requireFunction(publicSmokeRunner, 'Public smoke runner');
  requireFunction(checkedActivationStore.transitionTransaction, 'Activation transaction transition function');
  requireFunction(checkedActivationStore.readTransaction, 'Activation transaction read function');
  requireFunction(checkedActivationStore.planRecovery, 'Activation recovery-plan function');
  requireFunction(checkedActivationStore.commitActiveSnapshot, 'Activation active-snapshot commit function');
  requireFunction(checkedRequestStore.advance, 'Request phase advance function');
  requireFunction(checkedPointerSwitcher.switchArtifactPointers, 'Artifact pointer switch function');
  requireFunction(checkedPointerSwitcher.switchActivationSnapshotPointers, 'Activation snapshot pointer switch function');
  requireFunction(checkedPm2Controller.restartComponentsInOrder, 'PM2 ordered restart function');
  requireFunction(checkedPm2Controller.restoreSavedProcessList, 'PM2 saved process-list restore function');
  requireFunction(checkedPm2Controller.saveProcessList, 'PM2 save function');
  requireFunction(now, 'Activation orchestrator clock');

  const activateForwardDeployment = async ({
    entry,
    smokeTargets = undefined,
    restartComponents = DEFAULT_RESTART_COMPONENTS,
  } = {}) => {
    let currentEntry = requireActivationPreparedDeploy(entry);
    const startedAtUtc = now().toISOString();

    const pointerSwitching = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'pointer_switching',
    });
    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'pointer_switching',
    });

    const pointerSwitch = await checkedPointerSwitcher.switchArtifactPointers({
      targetSnapshot: pointerSwitching.targetSnapshot,
    });

    const pointersSwitched = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'pointers_switched',
    });
    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'pointers_switched',
    });

    const pm2Restart = await checkedPm2Controller.restartComponentsInOrder({
      components: Object.freeze([...restartComponents]),
      persist: false,
    });

    const identity = releaseIdentity(pointersSwitched.targetSnapshot);
    let managedOriginReadiness;
    try {
      managedOriginReadiness = await runOriginReadiness({
        releaseId: identity.releaseId,
        sourceSha: identity.sourceSha,
        requestState: currentEntry.requestState,
        targetSnapshot: pointersSwitched.targetSnapshot,
        now,
      });
    } catch (error) {
      throwWithActivationProgress(error, {
        operation: 'deploy',
        releaseId: identity.releaseId,
        sourceSha: identity.sourceSha,
        requestPhase: currentEntry.requestState.phase,
        transactionPhase: pointersSwitched.transaction.phase,
        pointerSwitch,
        pm2Restart,
        managedOriginReadiness: error?.managedOriginReadiness ?? null,
      });
    }

    let publicSmoke;
    try {
      publicSmoke = await runSmoke({
        releaseId: identity.releaseId,
        sourceSha: identity.sourceSha,
        targets: smokeTargets,
        requestState: currentEntry.requestState,
        targetSnapshot: pointersSwitched.targetSnapshot,
        now,
      });
    } catch (error) {
      throwWithActivationProgress(error, {
        operation: 'deploy',
        releaseId: identity.releaseId,
        sourceSha: identity.sourceSha,
        requestPhase: currentEntry.requestState.phase,
        transactionPhase: pointersSwitched.transaction.phase,
        pointerSwitch,
        pm2Restart,
        managedOriginReadiness,
      });
    }

    const smokeVerified = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'smoke_verified',
    });
    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'smoke_verified',
    });

    const pm2Save = await checkedPm2Controller.saveProcessList();

    const committed = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'committed',
    });
    const activeSnapshot = await checkedActivationStore.commitActiveSnapshot({
      transaction: committed.transaction,
      requestState: currentEntry.requestState,
      previousSnapshot: committed.previousSnapshot,
      targetSnapshot: committed.targetSnapshot,
    });

    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'succeeded',
    });

    return Object.freeze({
      schemaVersion: 1,
      startedAtUtc,
      completedAtUtc: now().toISOString(),
      releaseId: identity.releaseId,
      sourceSha: identity.sourceSha,
      transactionPhase: committed.transaction.phase,
      requestPhase: currentEntry.requestState.phase,
      pointerSwitch,
      pm2Restart,
      managedOriginReadiness,
      publicSmoke,
      pm2Save,
      activeSnapshotReference: activeSnapshot.reference ?? null,
      activationTransaction: committed.transaction,
      requestEntry: currentEntry,
      smokeVerifiedTransaction: smokeVerified.transaction,
    });
  };

  const activateRollbackDeployment = async ({
    entry,
    smokeTargets = undefined,
    restartComponents = DEFAULT_RESTART_COMPONENTS,
  } = {}) => {
    let currentEntry = requireActivationPreparedRollback(entry);
    const startedAtUtc = now().toISOString();
    const prepared = await readActivationTransaction({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
    });
    const targetUsesManagedRuntime = usesManagedRuntime(prepared.targetSnapshot);
    const identity = targetUsesManagedRuntime ? releaseIdentity(prepared.targetSnapshot) : null;

    const pointerSwitching = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'pointer_switching',
    });
    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'pointer_switching',
    });

    const pointerSwitch = await checkedPointerSwitcher.switchActivationSnapshotPointers({
      targetSnapshot: pointerSwitching.targetSnapshot,
    });

    const pointersSwitched = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'pointers_switched',
    });
    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'pointers_switched',
    });

    let pm2Restart = null;
    let pm2Restore = null;
    let pm2Save = null;
    let managedOriginReadiness = null;
    let publicSmoke = null;

    if (targetUsesManagedRuntime) {
      pm2Restart = await checkedPm2Controller.restartComponentsInOrder({
        components: Object.freeze([...restartComponents]),
        persist: false,
      });

      try {
        managedOriginReadiness = await runOriginReadiness({
          releaseId: identity.releaseId,
          sourceSha: identity.sourceSha,
          requestState: currentEntry.requestState,
          targetSnapshot: pointersSwitched.targetSnapshot,
          now,
        });
      } catch (error) {
        throwWithActivationProgress(error, {
          operation: 'rollback',
          releaseId: identity.releaseId,
          sourceSha: identity.sourceSha,
          requestPhase: currentEntry.requestState.phase,
          transactionPhase: pointersSwitched.transaction.phase,
          pointerSwitch,
          pm2Restart,
          managedOriginReadiness: error?.managedOriginReadiness ?? null,
        });
      }

      try {
        publicSmoke = await runSmoke({
          releaseId: identity.releaseId,
          sourceSha: identity.sourceSha,
          targets: smokeTargets,
          requestState: currentEntry.requestState,
          targetSnapshot: pointersSwitched.targetSnapshot,
          now,
        });
      } catch (error) {
        throwWithActivationProgress(error, {
          operation: 'rollback',
          releaseId: identity.releaseId,
          sourceSha: identity.sourceSha,
          requestPhase: currentEntry.requestState.phase,
          transactionPhase: pointersSwitched.transaction.phase,
          pointerSwitch,
          pm2Restart,
          managedOriginReadiness,
        });
      }
    } else if (pointersSwitched.targetSnapshot?.pm2State) {
      try {
        pm2Restore = await checkedPm2Controller.restoreSavedProcessList({
          pm2State: pointersSwitched.targetSnapshot.pm2State,
        });
      } catch (error) {
        throwWithActivationProgress(error, {
          operation: 'rollback',
          releaseId: null,
          sourceSha: null,
          requestPhase: currentEntry.requestState.phase,
          transactionPhase: pointersSwitched.transaction.phase,
          pointerSwitch,
          pm2Restore: error?.pm2Restore ?? null,
        });
      }
    }

    const smokeVerified = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'smoke_verified',
    });
    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'smoke_verified',
    });

    if (targetUsesManagedRuntime) {
      pm2Save = await checkedPm2Controller.saveProcessList();
    }

    const committed = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'committed',
    });
    const activeSnapshot = await checkedActivationStore.commitActiveSnapshot({
      transaction: committed.transaction,
      requestState: currentEntry.requestState,
      previousSnapshot: committed.previousSnapshot,
      targetSnapshot: committed.targetSnapshot,
    });

    currentEntry = await advanceRequest({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'succeeded',
    });

    return Object.freeze({
      schemaVersion: 1,
      startedAtUtc,
      completedAtUtc: now().toISOString(),
      releaseId: identity?.releaseId ?? null,
      sourceSha: identity?.sourceSha ?? null,
      transactionPhase: committed.transaction.phase,
      requestPhase: currentEntry.requestState.phase,
      pointerSwitch,
      pm2Restart,
      pm2Restore,
      managedOriginReadiness,
      publicSmoke,
      pm2Save,
      activeSnapshotReference: activeSnapshot.reference ?? null,
      activationTransaction: committed.transaction,
      requestEntry: currentEntry,
      smokeVerifiedTransaction: smokeVerified.transaction,
    });
  };

  const recoverForwardDeployment = async ({
    entry,
    restartComponents = DEFAULT_RESTART_COMPONENTS,
  } = {}) => {
    let currentEntry = requireRecoverableActivationRequest(entry);
    const startedAtUtc = now().toISOString();
    const initial = await readActivationTransaction({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
    });
    const recoveryPlan = await checkedActivationStore.planRecovery({
      requestId: currentEntry.requestState.request.requestId,
      requestState: currentEntry.requestState,
    });

    if (recoveryPlan.action === 'none') {
      return Object.freeze({
        schemaVersion: 1,
        startedAtUtc,
        completedAtUtc: now().toISOString(),
        action: 'none',
        transactionPhase: initial.transaction.phase,
        requestPhase: currentEntry.requestState.phase,
        recoveryPlan,
      });
    }

    if (recoveryPlan.action === 'abort_without_pointer_change') {
      const failed = await transitionActivation({
        activationStore: checkedActivationStore,
        requestState: currentEntry.requestState,
        nextPhase: 'failed',
      });
      currentEntry = await advanceRequestTo({
        requestStore: checkedRequestStore,
        entry: currentEntry,
        nextPhase: 'failed',
      });
      return Object.freeze({
        schemaVersion: 1,
        startedAtUtc,
        completedAtUtc: now().toISOString(),
        action: recoveryPlan.action,
        transactionPhase: failed.transaction.phase,
        requestPhase: currentEntry.requestState.phase,
        recoveryPlan,
        activationTransaction: failed.transaction,
        requestEntry: currentEntry,
      });
    }

    if (recoveryPlan.action === 'commit_target_snapshot') {
      if (currentEntry.requestState.phase === 'pointers_switched') {
        currentEntry = await advanceRequestTo({
          requestStore: checkedRequestStore,
          entry: currentEntry,
          nextPhase: 'smoke_verified',
        });
      }
      invariant(
        currentEntry.requestState.phase === 'smoke_verified',
        'Target commit recovery requires a smoke-verified durable request state',
      );
      const pm2Save = await checkedPm2Controller.saveProcessList();
      const committed = await transitionActivation({
        activationStore: checkedActivationStore,
        requestState: currentEntry.requestState,
        nextPhase: 'committed',
      });
      const activeSnapshot = await checkedActivationStore.commitActiveSnapshot({
        transaction: committed.transaction,
        requestState: currentEntry.requestState,
        previousSnapshot: committed.previousSnapshot,
        targetSnapshot: committed.targetSnapshot,
      });
      currentEntry = await advanceRequestTo({
        requestStore: checkedRequestStore,
        entry: currentEntry,
        nextPhase: 'succeeded',
      });
      return Object.freeze({
        schemaVersion: 1,
        startedAtUtc,
        completedAtUtc: now().toISOString(),
        action: recoveryPlan.action,
        transactionPhase: committed.transaction.phase,
        requestPhase: currentEntry.requestState.phase,
        recoveryPlan,
        pm2Save,
        activeSnapshotReference: activeSnapshot.reference ?? null,
        activationTransaction: committed.transaction,
        requestEntry: currentEntry,
      });
    }

    if (recoveryPlan.action === 'mark_request_failed') {
      if (currentEntry.requestState.phase === 'restoring_previous') {
        currentEntry = await advanceRequestTo({
          requestStore: checkedRequestStore,
          entry: currentEntry,
          nextPhase: 'previous_restored',
        });
      }
      invariant(
        currentEntry.requestState.phase === 'previous_restored',
        'Failure marking recovery requires a previous-restored durable request state',
      );
      const failed = await transitionActivation({
        activationStore: checkedActivationStore,
        requestState: currentEntry.requestState,
        nextPhase: 'failed',
      });
      currentEntry = await advanceRequestTo({
        requestStore: checkedRequestStore,
        entry: currentEntry,
        nextPhase: 'failed',
      });
      return Object.freeze({
        schemaVersion: 1,
        startedAtUtc,
        completedAtUtc: now().toISOString(),
        action: recoveryPlan.action,
        transactionPhase: failed.transaction.phase,
        requestPhase: currentEntry.requestState.phase,
        recoveryPlan,
        activationTransaction: failed.transaction,
        requestEntry: currentEntry,
      });
    }

    invariant(recoveryPlan.action === 'converge_previous_snapshot', `Unsupported activation recovery action: ${recoveryPlan.action}`);

    let recoveryRecord = initial;
    if (RESTORE_REQUIRED_TRANSACTION_PHASES.has(recoveryRecord.transaction.phase)) {
      recoveryRecord = await transitionActivation({
        activationStore: checkedActivationStore,
        requestState: currentEntry.requestState,
        nextPhase: 'restore_required',
      });
    } else {
      invariant(
        RESTORE_IN_PROGRESS_TRANSACTION_PHASES.has(recoveryRecord.transaction.phase),
        `Cannot restore previous snapshot from activation transaction phase ${recoveryRecord.transaction.phase}`,
      );
    }

    if (RESTORE_REQUIRED_REQUEST_PHASES.has(currentEntry.requestState.phase)) {
      currentEntry = await advanceRequestTo({
        requestStore: checkedRequestStore,
        entry: currentEntry,
        nextPhase: 'restore_required',
      });
    } else {
      invariant(
        RESTORE_IN_PROGRESS_REQUEST_PHASES.has(currentEntry.requestState.phase),
        `Cannot restore previous snapshot from request phase ${currentEntry.requestState.phase}`,
      );
    }

    if (recoveryRecord.transaction.phase === 'restore_required') {
      recoveryRecord = await transitionActivation({
        activationStore: checkedActivationStore,
        requestState: currentEntry.requestState,
        nextPhase: 'restoring_previous',
      });
    }
    currentEntry = await advanceRequestTo({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'restoring_previous',
    });

    const pointerSwitch = await checkedPointerSwitcher.switchActivationSnapshotPointers({
      targetSnapshot: recoveryRecord.previousSnapshot,
    });
    let pm2Restart = null;
    let pm2Restore = null;
    let pm2Save = null;
    if (usesManagedRuntime(recoveryRecord.previousSnapshot)) {
      pm2Restart = await checkedPm2Controller.restartComponentsInOrder({
        components: Object.freeze([...restartComponents]),
        persist: false,
      });
      pm2Save = await checkedPm2Controller.saveProcessList();
    } else if (recoveryRecord.previousSnapshot?.pm2State) {
      pm2Restore = await checkedPm2Controller.restoreSavedProcessList({
        pm2State: recoveryRecord.previousSnapshot.pm2State,
      });
    }

    if (recoveryRecord.transaction.phase === 'restoring_previous') {
      recoveryRecord = await transitionActivation({
        activationStore: checkedActivationStore,
        requestState: currentEntry.requestState,
        nextPhase: 'previous_restored',
      });
    }
    currentEntry = await advanceRequestTo({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'previous_restored',
    });

    const failed = await transitionActivation({
      activationStore: checkedActivationStore,
      requestState: currentEntry.requestState,
      nextPhase: 'failed',
    });
    currentEntry = await advanceRequestTo({
      requestStore: checkedRequestStore,
      entry: currentEntry,
      nextPhase: 'failed',
    });

    return Object.freeze({
      schemaVersion: 1,
      startedAtUtc,
      completedAtUtc: now().toISOString(),
      action: recoveryPlan.action,
      transactionPhase: failed.transaction.phase,
      requestPhase: currentEntry.requestState.phase,
      recoveryPlan,
      pointerSwitch,
      pm2Restart,
      pm2Restore,
      pm2Save,
      activationTransaction: failed.transaction,
      requestEntry: currentEntry,
    });
  };

  return Object.freeze({
    activateForwardDeployment,
    activateRollbackDeployment,
    recoverForwardDeployment,
    recoverRollbackDeployment: recoverForwardDeployment,
  });
};
