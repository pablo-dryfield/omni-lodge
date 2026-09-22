import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  captureLegacyBaselineOnce,
  runCaptureLegacyBaselineCli,
} from './libexec/deploy/capture-legacy-baseline-cli.mjs';
import {
  captureAndInitializeLegacyBaseline,
  createLegacyBaselineSnapshot,
  hashLegacyUiBuildTree,
} from './libexec/deploy/legacy-baseline.mjs';
import { createHostActivationSnapshotReference } from '../../scripts/deploy/host/state.mjs';

const SOURCE_SHA = 'c'.repeat(40);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const mkdir = (directory) => mkdirSync(directory, { recursive: true, mode: 0o755 });

const writeFile = (filePath, contents) => {
  mkdir(path.dirname(filePath));
  writeFileSync(filePath, contents, { mode: 0o600 });
};

const createStringSink = () => {
  const chunks = [];
  return {
    write: (chunk) => {
      chunks.push(String(chunk));
    },
    value: () => chunks.join(''),
  };
};

const createFixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-legacy-baseline-'));
  const repositoryPath = path.join(root, 'repo');
  const uiBuildPath = path.join(repositoryPath, 'ui/build');
  const pm2DumpPath = path.join(root, 'pm2/dump.pm2');
  mkdir(repositoryPath);
  writeFile(path.join(uiBuildPath, 'index.html'), '<div id="root"></div>\n');
  writeFile(path.join(uiBuildPath, 'static/js/main.fixture.js'), 'globalThis.fixture = true;\n');
  writeFile(path.join(uiBuildPath, 'asset-manifest.json'), '{"files":{}}\n');
  writeFile(pm2DumpPath, '{"apps":[{"name":"omni-lodge-be"},{"name":"omni-lodge-ui-server"}]}\n');
  return {
    root,
    repositoryPath,
    uiBuildPath,
    pm2DumpPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
};

const fakeGit = async (expectedRepositoryPath) => async (binary, args, options) => {
  assert.equal(binary, '/usr/bin/git');
  assert.deepEqual(args, ['-C', expectedRepositoryPath, 'rev-parse', 'HEAD']);
  assert.equal(options.windowsHide, true);
  return { stdout: `${SOURCE_SHA}\n` };
};

test('legacy baseline snapshot binds current source, UI tree, and PM2 dump evidence', async () => {
  const fixture = createFixture();
  try {
    const uiTree = await hashLegacyUiBuildTree({
      uiBuildPath: fixture.uiBuildPath,
    });
    const snapshot = await createLegacyBaselineSnapshot({
      activationId: '11111111-1111-4111-8111-111111111111',
      capturedAtUtc: '2026-09-22T01:40:00.000Z',
      capturedBy: 'pablo-dryfield',
      repositoryPath: fixture.repositoryPath,
      backendRestorePath: '/root/omni-lodge/be',
      uiBuildPath: fixture.uiBuildPath,
      uiRestorePath: '/root/omni-lodge/ui/build',
      pm2DumpPath: fixture.pm2DumpPath,
      pm2DumpRestorePath: '/root/.pm2/dump.pm2',
      execFileImpl: await fakeGit(fixture.repositoryPath),
    });

    assert.equal(snapshot.snapshotKind, 'legacy_baseline');
    assert.equal(snapshot.backendRestoreTarget.sourceSha, SOURCE_SHA);
    assert.equal(snapshot.backendRestoreTarget.path, '/root/omni-lodge/be');
    assert.equal(snapshot.uiRestoreTarget.path, '/root/omni-lodge/ui/build');
    assert.equal(snapshot.uiRestoreTarget.buildTreeSha256, uiTree.buildTreeSha256);
    assert.equal(
      snapshot.pm2State.dumpSha256,
      sha256('{"apps":[{"name":"omni-lodge-be"},{"name":"omni-lodge-ui-server"}]}\n'),
    );
    assert.equal(snapshot.pm2State.backendProcessName, 'omni-lodge-be');
    assert.equal(snapshot.pm2State.uiProcessName, 'omni-lodge-ui-server');
  } finally {
    fixture.cleanup();
  }
});

test('legacy baseline capture initializes the provided activation store', async () => {
  const fixture = createFixture();
  try {
    const calls = [];
    const result = await captureAndInitializeLegacyBaseline({
      store: {
        initializeActiveSnapshot: async (snapshot) => {
          calls.push(snapshot);
          return { activePath: '/var/lib/omnilodge/deploy/state/active-activation-snapshot.json' };
        },
      },
      activationId: '22222222-2222-4222-8222-222222222222',
      capturedAtUtc: '2026-09-22T01:41:00.000Z',
      capturedBy: 'pablo-dryfield',
      repositoryPath: fixture.repositoryPath,
      backendRestorePath: '/root/omni-lodge/be',
      uiBuildPath: fixture.uiBuildPath,
      uiRestorePath: '/root/omni-lodge/ui/build',
      pm2DumpPath: fixture.pm2DumpPath,
      pm2DumpRestorePath: '/root/.pm2/dump.pm2',
      execFileImpl: await fakeGit(fixture.repositoryPath),
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(result.snapshot, calls[0]);
    assert.equal(result.reference.activationId, '22222222-2222-4222-8222-222222222222');
    assert.equal(result.activePath, '/var/lib/omnilodge/deploy/state/active-activation-snapshot.json');
  } finally {
    fixture.cleanup();
  }
});

test('legacy baseline command refuses non-root callers and command arguments', async () => {
  const stdout = createStringSink();
  const stderr = createStringSink();
  assert.equal(
    await runCaptureLegacyBaselineCli({
      uid: 1000,
      argv: [],
      stdout,
      stderr,
    }),
    64,
  );
  assert.equal(stdout.value(), '');
  assert.match(stderr.value(), /Legacy baseline capture refused/);

  const rootStdout = createStringSink();
  const rootStderr = createStringSink();
  assert.equal(
    await runCaptureLegacyBaselineCli({
      uid: 0,
      argv: ['--force'],
      stdout: rootStdout,
      stderr: rootStderr,
    }),
    64,
  );
  assert.equal(rootStdout.value(), '');
  assert.match(rootStderr.value(), /Legacy baseline capture refused/);
});

test('legacy baseline command is idempotent when an active snapshot already exists', async () => {
  const fixture = createFixture();
  try {
    const snapshot = await createLegacyBaselineSnapshot({
      activationId: '33333333-3333-4333-8333-333333333333',
      capturedAtUtc: '2026-09-22T01:42:00.000Z',
      capturedBy: 'root',
      repositoryPath: fixture.repositoryPath,
      backendRestorePath: '/root/omni-lodge/be',
      uiBuildPath: fixture.uiBuildPath,
      uiRestorePath: '/root/omni-lodge/ui/build',
      pm2DumpPath: fixture.pm2DumpPath,
      pm2DumpRestorePath: '/root/.pm2/dump.pm2',
      execFileImpl: await fakeGit(fixture.repositoryPath),
    });
    const reference = createHostActivationSnapshotReference(snapshot);
    let captureCalled = false;
    const summary = await captureLegacyBaselineOnce({
      store: {
        readActiveSnapshot: async () => ({
          snapshot,
          reference,
          path: '/var/lib/omnilodge/deploy/state/active-activation-snapshot.json',
        }),
        activePath: () => '/unused-active-path.json',
      },
      capture: async () => {
        captureCalled = true;
        throw new Error('capture must not run');
      },
    });

    assert.equal(captureCalled, false);
    assert.equal(summary.disposition, 'already-initialized');
    assert.equal(summary.snapshotKind, 'legacy_baseline');
    assert.equal(summary.activationId, snapshot.activationId);
    assert.equal(summary.snapshotSha256, reference.snapshotSha256);
    assert.equal(summary.activePath, '/var/lib/omnilodge/deploy/state/active-activation-snapshot.json');
  } finally {
    fixture.cleanup();
  }
});

test('legacy baseline command creates one baseline and emits a bounded JSON summary', async () => {
  const fixture = createFixture();
  try {
    const snapshot = await createLegacyBaselineSnapshot({
      activationId: '44444444-4444-4444-8444-444444444444',
      capturedAtUtc: '2026-09-22T01:43:00.000Z',
      capturedBy: 'root',
      repositoryPath: fixture.repositoryPath,
      backendRestorePath: '/root/omni-lodge/be',
      uiBuildPath: fixture.uiBuildPath,
      uiRestorePath: '/root/omni-lodge/ui/build',
      pm2DumpPath: fixture.pm2DumpPath,
      pm2DumpRestorePath: '/root/.pm2/dump.pm2',
      execFileImpl: await fakeGit(fixture.repositoryPath),
    });
    const reference = createHostActivationSnapshotReference(snapshot);
    const stdout = createStringSink();
    const stderr = createStringSink();

    const exitCode = await runCaptureLegacyBaselineCli({
      uid: 0,
      argv: [],
      stdout,
      stderr,
      store: {
        readActiveSnapshot: async () => null,
      },
      capture: async ({ capturedBy }) => {
        assert.equal(capturedBy, 'root');
        return {
          snapshot,
          reference,
          activePath: '/var/lib/omnilodge/deploy/state/active-activation-snapshot.json',
        };
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.value(), '');
    const parsed = JSON.parse(stdout.value());
    assert.deepEqual(parsed, {
      schemaVersion: 1,
      disposition: 'created',
      activePath: '/var/lib/omnilodge/deploy/state/active-activation-snapshot.json',
      activationId: snapshot.activationId,
      snapshotSha256: reference.snapshotSha256,
      snapshotKind: 'legacy_baseline',
      capturedAtUtc: snapshot.capturedAtUtc,
      capturedBy: 'root',
      backendRestoreTarget: snapshot.backendRestoreTarget,
      uiRestoreTarget: snapshot.uiRestoreTarget,
      pm2State: snapshot.pm2State,
    });
  } finally {
    fixture.cleanup();
  }
});

test('legacy UI build hashing fails closed for empty build directories', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-empty-ui-build-'));
  try {
    const uiBuildPath = path.join(root, 'ui/build');
    mkdir(uiBuildPath);
    await assert.rejects(
      hashLegacyUiBuildTree({ uiBuildPath }),
      /must not be empty/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
