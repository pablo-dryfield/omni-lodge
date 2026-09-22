const DEFAULT_RESTART_COMPONENTS = Object.freeze(['backend', 'ui-server']);

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

const releaseIdentity = (targetSnapshot) => {
  requireObject(targetSnapshot, 'Activation target snapshot');
  invariant(typeof targetSnapshot.releaseId === 'string' && targetSnapshot.releaseId.length > 0, 'Activation target release ID is missing');
  invariant(typeof targetSnapshot.sourceSha === 'string' && targetSnapshot.sourceSha.length > 0, 'Activation target source SHA is missing');
  return Object.freeze({
    releaseId: targetSnapshot.releaseId,
    sourceSha: targetSnapshot.sourceSha,
  });
};

export const createActivationOrchestrator = ({
  activationStore,
  requestStore,
  pointerSwitcher,
  pm2Controller,
  publicSmokeRunner,
  now = () => new Date(),
} = {}) => {
  const checkedActivationStore = requireObject(activationStore, 'Activation state store');
  const checkedRequestStore = requireObject(requestStore, 'Request record store');
  const checkedPointerSwitcher = requireObject(pointerSwitcher, 'Activation pointer switcher');
  const checkedPm2Controller = requireObject(pm2Controller, 'PM2 service controller');
  const runSmoke = requireFunction(publicSmokeRunner, 'Public smoke runner');
  requireFunction(checkedActivationStore.transitionTransaction, 'Activation transaction transition function');
  requireFunction(checkedActivationStore.commitActiveSnapshot, 'Activation active-snapshot commit function');
  requireFunction(checkedRequestStore.advance, 'Request phase advance function');
  requireFunction(checkedPointerSwitcher.switchArtifactPointers, 'Artifact pointer switch function');
  requireFunction(checkedPm2Controller.restartComponentsInOrder, 'PM2 ordered restart function');
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
    const publicSmoke = await runSmoke({
      releaseId: identity.releaseId,
      sourceSha: identity.sourceSha,
      targets: smokeTargets,
      requestState: currentEntry.requestState,
      targetSnapshot: pointersSwitched.targetSnapshot,
      now,
    });

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
      publicSmoke,
      pm2Save,
      activeSnapshotReference: activeSnapshot.reference ?? null,
      activationTransaction: committed.transaction,
      requestEntry: currentEntry,
      smokeVerifiedTransaction: smokeVerified.transaction,
    });
  };

  return Object.freeze({
    activateForwardDeployment,
  });
};
