import { fileURLToPath } from 'node:url';

import { createActivationStateStore } from './activation-state-store.mjs';
import { captureAndInitializeLegacyBaseline } from './legacy-baseline.mjs';

const summarizeActivationSnapshot = ({
  activePath,
  disposition,
  reference,
  snapshot,
}) => {
  const summary = {
    schemaVersion: 1,
    disposition,
    activePath,
    activationId: reference.activationId,
    snapshotSha256: reference.snapshotSha256,
    snapshotKind: snapshot.snapshotKind,
  };

  if (snapshot.snapshotKind === 'legacy_baseline') {
    return Object.freeze({
      ...summary,
      capturedAtUtc: snapshot.capturedAtUtc,
      capturedBy: snapshot.capturedBy,
      backendRestoreTarget: snapshot.backendRestoreTarget,
      uiRestoreTarget: snapshot.uiRestoreTarget,
      pm2State: snapshot.pm2State,
    });
  }

  return Object.freeze({
    ...summary,
    releaseId: snapshot.releaseId,
    sourceSha: snapshot.sourceSha,
    activatedAtUtc: snapshot.activatedAtUtc,
  });
};

export const captureLegacyBaselineOnce = async ({
  store = createActivationStateStore(),
  capture = captureAndInitializeLegacyBaseline,
  capturedBy = 'root',
} = {}) => {
  const active = await store.readActiveSnapshot();
  if (active !== null) {
    return summarizeActivationSnapshot({
      disposition: 'already-initialized',
      activePath: active.path ?? store.activePath(),
      snapshot: active.snapshot,
      reference: active.reference,
    });
  }

  const captured = await capture({
    store,
    capturedBy,
  });

  return summarizeActivationSnapshot({
    disposition: 'created',
    activePath: captured.activePath,
    snapshot: captured.snapshot,
    reference: captured.reference,
  });
};

export const runCaptureLegacyBaselineCli = async ({
  argv = process.argv.slice(2),
  uid = typeof process.getuid === 'function' ? process.getuid() : 0,
  stdout = process.stdout,
  stderr = process.stderr,
  ...options
} = {}) => {
  if (uid !== 0 || argv.length !== 0) {
    stderr.write('Legacy baseline capture refused.\n');
    return 64;
  }

  try {
    const result = await captureLegacyBaselineOnce(options);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`Legacy baseline capture failed: ${error.message}\n`);
    return 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCaptureLegacyBaselineCli();
}
