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
  captureAndInitializeLegacyBaseline,
  createLegacyBaselineSnapshot,
  hashLegacyUiBuildTree,
} from './libexec/deploy/legacy-baseline.mjs';

const SOURCE_SHA = 'c'.repeat(40);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const mkdir = (directory) => mkdirSync(directory, { recursive: true, mode: 0o755 });

const writeFile = (filePath, contents) => {
  mkdir(path.dirname(filePath));
  writeFileSync(filePath, contents, { mode: 0o600 });
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
