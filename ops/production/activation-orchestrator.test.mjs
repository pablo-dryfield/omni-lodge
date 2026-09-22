import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActivationOrchestrator,
} from './libexec/deploy/activation-orchestrator.mjs';

const REQUEST_ID = '12345678-1234-4234-9234-123456789abc';
const REQUEST_SHA = 'a'.repeat(64);
const SOURCE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const RELEASE_ID = `omnilodge-r357-a1-${SOURCE_SHA.slice(0, 12)}`;

const requestEntry = (phase) => Object.freeze({
  state: 'running',
  requestState: Object.freeze({
    schemaVersion: 1,
    phase,
    request: Object.freeze({
      kind: 'forward_submit',
      requestId: REQUEST_ID,
      requestSha256: REQUEST_SHA,
    }),
    intent: Object.freeze({
      operation: 'deploy',
      releaseId: RELEASE_ID,
      sourceSha: SOURCE_SHA,
    }),
  }),
});

const rollbackEntry = (phase) => Object.freeze({
  state: 'running',
  requestState: Object.freeze({
    schemaVersion: 1,
    phase,
    request: Object.freeze({
      kind: 'rollback_submit',
      requestId: REQUEST_ID,
      requestSha256: REQUEST_SHA,
    }),
    intent: Object.freeze({
      trigger: 'manual',
      expectedActiveSnapshot: Object.freeze({
        activationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        snapshotSha256: '1'.repeat(64),
      }),
      targetSnapshot: Object.freeze({
        activationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        snapshotSha256: '2'.repeat(64),
      }),
    }),
  }),
});

const createFixture = ({
  initialTransactionPhase = 'prepared',
  recoveryAction = 'converge_previous_snapshot',
  previousSnapshotKind = 'artifact_release',
} = {}) => {
  const calls = [];
  const previousSnapshot = Object.freeze({
    snapshotKind: previousSnapshotKind,
    releaseId: 'legacy-checkout',
    sourceSha: 'b'.repeat(40),
    ...(previousSnapshotKind === 'legacy_baseline' ? {
      pm2State: Object.freeze({
        dumpPath: '/root/.pm2/dump.pm2',
        dumpSha256: 'd'.repeat(64),
        backendProcessName: 'omni-lodge-be',
        uiProcessName: 'omni-lodge-ui-server',
      }),
    } : {}),
  });
  const targetSnapshot = Object.freeze({
    snapshotKind: 'artifact',
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    backendRestoreTarget: '/opt/omnilodge/releases/target/be',
    uiRestoreTarget: '/opt/omnilodge/releases/target',
  });
  let transactionPhase = initialTransactionPhase;

  const transaction = (phase) => Object.freeze({
    requestId: REQUEST_ID,
    requestSha256: REQUEST_SHA,
    requestKind: 'forward_submit',
    phase,
  });

  const activationStore = Object.freeze({
    readTransaction: async ({ requestState }) => {
      calls.push(`tx:read:${transactionPhase}@${requestState.phase}`);
      return Object.freeze({
        transaction: transaction(transactionPhase),
        previousSnapshot,
        targetSnapshot,
      });
    },
    planRecovery: async ({ requestState }) => {
      calls.push(`plan:${recoveryAction}@${requestState.phase}`);
      return Object.freeze({
        action: recoveryAction,
        databaseAction: 'none',
        requestId: requestState.request.requestId,
        previousSnapshot,
        targetSnapshot,
      });
    },
    transitionTransaction: async ({ requestState, nextPhase }) => {
      calls.push(`tx:${transactionPhase}->${nextPhase}@${requestState.phase}`);
      if (nextPhase === 'committed') {
        assert.equal(requestState.phase, 'smoke_verified');
      }
      transactionPhase = nextPhase;
      return Object.freeze({
        transaction: transaction(transactionPhase),
        previousSnapshot,
        targetSnapshot,
      });
    },
    commitActiveSnapshot: async ({ transaction: rawTransaction, targetSnapshot: rawTargetSnapshot }) => {
      calls.push('active:commit');
      assert.equal(rawTransaction.phase, 'committed');
      assert.equal(rawTargetSnapshot.releaseId, RELEASE_ID);
      return Object.freeze({
        reference: Object.freeze({
          activationId: REQUEST_ID,
          snapshotSha256: 'c'.repeat(64),
        }),
      });
    },
  });

  const requestStore = Object.freeze({
    advance: async ({ fromPhase, nextPhase, resultCode }) => {
      calls.push(`request:${fromPhase}->${nextPhase}`);
      assert.equal(resultCode, null);
      return requestEntry(nextPhase);
    },
  });

  const pointerSwitcher = Object.freeze({
    switchArtifactPointers: async ({ targetSnapshot: rawTargetSnapshot }) => {
      calls.push('pointer:switch');
      assert.equal(rawTargetSnapshot.releaseId, RELEASE_ID);
      return Object.freeze({
        schemaVersion: 1,
        backend: Object.freeze({ changed: true }),
        ui: Object.freeze({ changed: true }),
      });
    },
    switchActivationSnapshotPointers: async ({ targetSnapshot: rawTargetSnapshot }) => {
      calls.push('pointer:switch-snapshot');
      assert.equal(rawTargetSnapshot, previousSnapshot);
      return Object.freeze({
        schemaVersion: 1,
        backend: Object.freeze({ changed: true }),
        ui: Object.freeze({ changed: true }),
      });
    },
  });

  const pm2Controller = Object.freeze({
    restartComponentsInOrder: async ({ components, persist }) => {
      calls.push(`pm2:restart:${components.join(',')}:persist=${persist}`);
      return Object.freeze({
        schemaVersion: 1,
        restarted: Object.freeze(components.map((component) => Object.freeze({ component }))),
      });
    },
    saveProcessList: async () => {
      calls.push('pm2:save');
      return Object.freeze({
        savedAtUtc: '2026-09-22T12:45:00.000Z',
      });
    },
    restoreSavedProcessList: async () => {
      calls.push('pm2:restore-saved');
      return Object.freeze({
        restoredAtUtc: '2026-09-22T12:45:00.000Z',
      });
    },
  });

  const publicSmokeRunner = async ({ releaseId, sourceSha, targets }) => {
    calls.push(`smoke:${releaseId}:${sourceSha}`);
    assert.deepEqual(targets, { applicationOrigin: 'https://omni-lodge.example' });
    return Object.freeze({
      schemaVersion: 1,
      releaseId,
      sourceSha,
    });
  };

  return {
    calls,
    orchestrator: createActivationOrchestrator({
      activationStore,
      requestStore,
      pointerSwitcher,
      pm2Controller,
      publicSmokeRunner,
      now: () => new Date('2026-09-22T12:45:00.000Z'),
    }),
  };
};

test('activation orchestrator sequences request, pointer, PM2, smoke, save, and commit steps', async () => {
  const { calls, orchestrator } = createFixture();

  const result = await orchestrator.activateForwardDeployment({
    entry: requestEntry('activation_prepared'),
    smokeTargets: { applicationOrigin: 'https://omni-lodge.example' },
  });

  assert.deepEqual(calls, [
    'tx:prepared->pointer_switching@activation_prepared',
    'request:activation_prepared->pointer_switching',
    'pointer:switch',
    'tx:pointer_switching->pointers_switched@pointer_switching',
    'request:pointer_switching->pointers_switched',
    'pm2:restart:backend,ui-server:persist=false',
    `smoke:${RELEASE_ID}:${SOURCE_SHA}`,
    'tx:pointers_switched->smoke_verified@pointers_switched',
    'request:pointers_switched->smoke_verified',
    'pm2:save',
    'tx:smoke_verified->committed@smoke_verified',
    'active:commit',
    'request:smoke_verified->succeeded',
  ]);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.releaseId, RELEASE_ID);
  assert.equal(result.sourceSha, SOURCE_SHA);
  assert.equal(result.transactionPhase, 'committed');
  assert.equal(result.requestPhase, 'succeeded');
  assert.equal(result.activeSnapshotReference.activationId, REQUEST_ID);
});

test('activation orchestrator fails closed until all mutating dependencies are injected', () => {
  assert.throws(
    () => createActivationOrchestrator(),
    /Activation state store is required/,
  );
});

test('activation orchestrator only accepts activation-prepared deploy requests', async () => {
  const { orchestrator } = createFixture();

  await assert.rejects(
    orchestrator.activateForwardDeployment({
      entry: requestEntry('pointers_switched'),
      smokeTargets: { applicationOrigin: 'https://omni-lodge.example' },
    }),
    /activation-prepared request/,
  );
});

test('activation orchestrator sequences artifact rollback through snapshot pointers', async () => {
  const calls = [];
  const previousSnapshot = Object.freeze({
    snapshotKind: 'artifact',
    releaseId: 'omnilodge-r111-a1-bbbbbbbbbbbb',
    sourceSha: 'b'.repeat(40),
  });
  const targetSnapshot = Object.freeze({
    snapshotKind: 'artifact',
    releaseId: RELEASE_ID,
    sourceSha: SOURCE_SHA,
    backendRestoreTarget: '/opt/omnilodge/releases/target/be',
    uiRestoreTarget: '/opt/omnilodge/releases/target',
  });
  let transactionPhase = 'prepared';
  const transaction = (phase) => Object.freeze({
    requestId: REQUEST_ID,
    requestSha256: REQUEST_SHA,
    requestKind: 'rollback_submit',
    phase,
  });
  const orchestrator = createActivationOrchestrator({
    activationStore: Object.freeze({
      readTransaction: async ({ requestState }) => {
        calls.push(`tx:read:${transactionPhase}@${requestState.phase}`);
        return Object.freeze({
          transaction: transaction(transactionPhase),
          previousSnapshot,
          targetSnapshot,
        });
      },
      planRecovery: async () => {
        throw new Error('not used');
      },
      transitionTransaction: async ({ requestState, nextPhase }) => {
        calls.push(`tx:${transactionPhase}->${nextPhase}@${requestState.phase}`);
        transactionPhase = nextPhase;
        return Object.freeze({
          transaction: transaction(transactionPhase),
          previousSnapshot,
          targetSnapshot,
        });
      },
      commitActiveSnapshot: async ({ transaction: rawTransaction, targetSnapshot: rawTargetSnapshot }) => {
        calls.push('active:commit');
        assert.equal(rawTransaction.phase, 'committed');
        assert.equal(rawTargetSnapshot.releaseId, RELEASE_ID);
        return Object.freeze({
          reference: Object.freeze({
            activationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            snapshotSha256: '2'.repeat(64),
          }),
        });
      },
    }),
    requestStore: Object.freeze({
      advance: async ({ fromPhase, nextPhase, resultCode }) => {
        calls.push(`request:${fromPhase}->${nextPhase}`);
        assert.equal(resultCode, null);
        return rollbackEntry(nextPhase);
      },
    }),
    pointerSwitcher: Object.freeze({
      switchArtifactPointers: async () => {
        throw new Error('rollback must not use artifact-only pointer switching');
      },
      switchActivationSnapshotPointers: async ({ targetSnapshot: rawTargetSnapshot }) => {
        calls.push('pointer:switch-snapshot');
        assert.equal(rawTargetSnapshot, targetSnapshot);
        return Object.freeze({
          schemaVersion: 1,
          backend: Object.freeze({ changed: true }),
          ui: Object.freeze({ changed: true }),
        });
      },
    }),
    pm2Controller: Object.freeze({
      restartComponentsInOrder: async ({ components, persist }) => {
        calls.push(`pm2:restart:${components.join(',')}:persist=${persist}`);
        return Object.freeze({
          schemaVersion: 1,
          restarted: Object.freeze(components.map((component) => Object.freeze({ component }))),
        });
      },
      saveProcessList: async () => {
        calls.push('pm2:save');
        return Object.freeze({ savedAtUtc: '2026-09-22T12:45:00.000Z' });
      },
      restoreSavedProcessList: async () => {
        calls.push('pm2:restore-saved');
        return Object.freeze({ restoredAtUtc: '2026-09-22T12:45:00.000Z' });
      },
    }),
    publicSmokeRunner: async ({ releaseId, sourceSha }) => {
      calls.push(`smoke:${releaseId}:${sourceSha}`);
      return Object.freeze({ schemaVersion: 1, releaseId, sourceSha });
    },
    now: () => new Date('2026-09-22T12:45:00.000Z'),
  });

  const result = await orchestrator.activateRollbackDeployment({
    entry: rollbackEntry('activation_prepared'),
  });

  assert.deepEqual(calls, [
    'tx:read:prepared@activation_prepared',
    'tx:prepared->pointer_switching@activation_prepared',
    'request:activation_prepared->pointer_switching',
    'pointer:switch-snapshot',
    'tx:pointer_switching->pointers_switched@pointer_switching',
    'request:pointer_switching->pointers_switched',
    'pm2:restart:backend,ui-server:persist=false',
    `smoke:${RELEASE_ID}:${SOURCE_SHA}`,
    'tx:pointers_switched->smoke_verified@pointers_switched',
    'request:pointers_switched->smoke_verified',
    'pm2:save',
    'tx:smoke_verified->committed@smoke_verified',
    'active:commit',
    'request:smoke_verified->succeeded',
  ]);
  assert.equal(result.releaseId, RELEASE_ID);
  assert.equal(result.transactionPhase, 'committed');
  assert.equal(result.requestPhase, 'succeeded');
});

test('activation recovery converges pointers back to the previous snapshot and fails the request', async () => {
  const { calls, orchestrator } = createFixture({
    initialTransactionPhase: 'pointers_switched',
    recoveryAction: 'converge_previous_snapshot',
  });

  const result = await orchestrator.recoverForwardDeployment({
    entry: requestEntry('pointers_switched'),
  });

  assert.deepEqual(calls, [
    'tx:read:pointers_switched@pointers_switched',
    'plan:converge_previous_snapshot@pointers_switched',
    'tx:pointers_switched->restore_required@pointers_switched',
    'request:pointers_switched->restore_required',
    'tx:restore_required->restoring_previous@restore_required',
    'request:restore_required->restoring_previous',
    'pointer:switch-snapshot',
    'pm2:restart:backend,ui-server:persist=false',
    'pm2:save',
    'tx:restoring_previous->previous_restored@restoring_previous',
    'request:restoring_previous->previous_restored',
    'tx:previous_restored->failed@previous_restored',
    'request:previous_restored->failed',
  ]);
  assert.equal(result.action, 'converge_previous_snapshot');
  assert.equal(result.transactionPhase, 'failed');
  assert.equal(result.requestPhase, 'failed');
});

test('activation recovery restores the saved PM2 process list when converging to a legacy baseline', async () => {
  const { calls, orchestrator } = createFixture({
    initialTransactionPhase: 'restoring_previous',
    recoveryAction: 'converge_previous_snapshot',
    previousSnapshotKind: 'legacy_baseline',
  });

  const result = await orchestrator.recoverForwardDeployment({
    entry: requestEntry('restoring_previous'),
  });

  assert.deepEqual(calls, [
    'tx:read:restoring_previous@restoring_previous',
    'plan:converge_previous_snapshot@restoring_previous',
    'pointer:switch-snapshot',
    'pm2:restore-saved',
    'tx:restoring_previous->previous_restored@restoring_previous',
    'request:restoring_previous->previous_restored',
    'tx:previous_restored->failed@previous_restored',
    'request:previous_restored->failed',
  ]);
  assert.equal(result.action, 'converge_previous_snapshot');
  assert.equal(result.transactionPhase, 'failed');
  assert.equal(result.requestPhase, 'failed');
  assert.equal(result.pm2Restart, null);
  assert.equal(result.pm2Restore.restoredAtUtc, '2026-09-22T12:45:00.000Z');
  assert.equal(result.pm2Save, null);
});

test('activation recovery marks previous-restored requests failed after an interrupted retry', async () => {
  const { calls, orchestrator } = createFixture({
    initialTransactionPhase: 'previous_restored',
    recoveryAction: 'mark_request_failed',
  });

  const result = await orchestrator.recoverForwardDeployment({
    entry: requestEntry('previous_restored'),
  });

  assert.deepEqual(calls, [
    'tx:read:previous_restored@previous_restored',
    'plan:mark_request_failed@previous_restored',
    'tx:previous_restored->failed@previous_restored',
    'request:previous_restored->failed',
  ]);
  assert.equal(result.action, 'mark_request_failed');
  assert.equal(result.transactionPhase, 'failed');
  assert.equal(result.requestPhase, 'failed');
});

test('activation recovery commits the target when smoke already verified the new release', async () => {
  const { calls, orchestrator } = createFixture({
    initialTransactionPhase: 'smoke_verified',
    recoveryAction: 'commit_target_snapshot',
  });

  const result = await orchestrator.recoverForwardDeployment({
    entry: requestEntry('pointers_switched'),
  });

  assert.deepEqual(calls, [
    'tx:read:smoke_verified@pointers_switched',
    'plan:commit_target_snapshot@pointers_switched',
    'request:pointers_switched->smoke_verified',
    'pm2:save',
    'tx:smoke_verified->committed@smoke_verified',
    'active:commit',
    'request:smoke_verified->succeeded',
  ]);
  assert.equal(result.action, 'commit_target_snapshot');
  assert.equal(result.transactionPhase, 'committed');
  assert.equal(result.requestPhase, 'succeeded');
  assert.equal(result.activeSnapshotReference.activationId, REQUEST_ID);
});
