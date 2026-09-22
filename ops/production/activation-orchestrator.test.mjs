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

const createFixture = () => {
  const calls = [];
  const previousSnapshot = Object.freeze({
    snapshotKind: 'legacy',
    releaseId: 'legacy-checkout',
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
    requestKind: 'forward_submit',
    phase,
  });

  const activationStore = Object.freeze({
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
