import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readlink, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createActivationPointerSwitcher,
  pointerSetFromActivationSnapshot,
  pointerSetFromArtifactSnapshot,
} from './libexec/deploy/activation-pointer-switcher.mjs';

const skipOnWindows = process.platform === 'win32'
  ? 'POSIX symlink replacement semantics are required'
  : false;

const createFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-pointer-'));
  const releasesRoot = path.join(root, 'releases');
  const releaseOne = path.join(releasesRoot, 'omnilodge-r1-a1-aaaaaaaaaaaa');
  const releaseTwo = path.join(releasesRoot, 'omnilodge-r2-a1-bbbbbbbbbbbb');
  for (const releaseRoot of [releaseOne, releaseTwo]) {
    await mkdir(path.join(releaseRoot, 'be'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(releaseRoot, 'ui-server'), { recursive: true, mode: 0o700 });
  }
  return {
    root,
    pointersFor: (releaseRoot) => ({
      backend: {
        component: 'backend',
        linkPath: path.join(root, 'backend-current'),
        targetPath: path.join(releaseRoot, 'be'),
      },
      ui: {
        component: 'ui',
        linkPath: path.join(root, 'ui-current'),
        targetPath: releaseRoot,
      },
    }),
    releaseOne,
    releaseTwo,
  };
};

const createSwitcher = () => createActivationPointerSwitcher({
  trustedUid: process.getuid(),
  trustedGid: process.getgid(),
});

const SOURCE_SHA = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const REQUEST_SHA = 'b'.repeat(64);
const ARTIFACT_RELEASE_ID = `omnilodge-r35724809287-a1-${SOURCE_SHA.slice(0, 12)}`;
const ACTIVATION_ID = '12345678-1234-4234-9234-123456789abc';
const PREVIOUS_ACTIVATION_ID = '22345678-1234-4234-9234-123456789abc';
const SNAPSHOT_SHA = 'c'.repeat(64);

test('activation pointer plans support artifact and legacy-baseline snapshots', () => {
  const layout = {
    releasesRoot: '/opt/omnilodge/releases',
  };
  const artifactSnapshot = {
    schemaVersion: 1,
    snapshotKind: 'artifact_release',
    activationId: ACTIVATION_ID,
    releaseId: ARTIFACT_RELEASE_ID,
    sourceSha: SOURCE_SHA,
    evidenceSha256: 'd'.repeat(64),
    artifactZipSha256: 'e'.repeat(64),
    activatedByRequestId: ACTIVATION_ID,
    activatedByRequestSha256: REQUEST_SHA,
    activatedAtUtc: '2026-09-22T12:00:00.000Z',
    backendRestoreTarget: `/opt/omnilodge/releases/${ARTIFACT_RELEASE_ID}/be`,
    uiRestoreTarget: `/opt/omnilodge/releases/${ARTIFACT_RELEASE_ID}`,
    predecessorSnapshot: {
      activationId: PREVIOUS_ACTIVATION_ID,
      snapshotSha256: SNAPSHOT_SHA,
    },
  };
  const legacySnapshot = {
    schemaVersion: 1,
    snapshotKind: 'legacy_baseline',
    activationId: PREVIOUS_ACTIVATION_ID,
    backendRestoreTarget: {
      path: '/root/omni-lodge/be',
      sourceSha: SOURCE_SHA,
    },
    uiRestoreTarget: {
      path: '/root/omni-lodge/ui/build',
      buildTreeSha256: 'f'.repeat(64),
    },
    pm2State: {
      dumpPath: '/root/.pm2/dump.pm2',
      dumpSha256: 'a'.repeat(64),
      backendProcessName: 'omni-lodge-be',
      uiProcessName: 'omni-lodge-ui-server',
    },
    capturedAtUtc: '2026-09-22T11:00:00.000Z',
    capturedBy: 'root',
  };

  assert.deepEqual(pointerSetFromArtifactSnapshot({
    targetSnapshot: artifactSnapshot,
    layout,
    pathApi: path.posix,
  }), {
    backend: {
      component: 'backend',
      linkPath: '/opt/omnilodge/backend-current',
      targetPath: `/opt/omnilodge/releases/${ARTIFACT_RELEASE_ID}/be`,
    },
    ui: {
      component: 'ui',
      linkPath: '/opt/omnilodge/ui-current',
      targetPath: `/opt/omnilodge/releases/${ARTIFACT_RELEASE_ID}`,
    },
  });

  assert.deepEqual(pointerSetFromActivationSnapshot({
    targetSnapshot: legacySnapshot,
    layout,
    pathApi: path.posix,
  }), {
    backend: {
      component: 'backend',
      linkPath: '/opt/omnilodge/backend-current',
      targetPath: '/root/omni-lodge/be',
    },
    ui: {
      component: 'ui',
      linkPath: '/opt/omnilodge/ui-current',
      targetPath: '/root/omni-lodge/ui/build',
    },
  });
});

test('activation pointer switcher creates and atomically replaces current links', {
  skip: skipOnWindows,
}, async () => {
  const fixture = await createFixture();
  try {
    const switcher = createSwitcher();
    const first = await switcher.switchPointerSet({
      pointers: fixture.pointersFor(fixture.releaseOne),
    });
    assert.equal(first.backend.changed, true);
    assert.equal(first.backend.previousTargetPath, null);
    assert.equal(await readlink(path.join(fixture.root, 'backend-current')), path.join(fixture.releaseOne, 'be'));
    assert.equal(await readlink(path.join(fixture.root, 'ui-current')), fixture.releaseOne);

    const replay = await switcher.switchPointerSet({
      pointers: fixture.pointersFor(fixture.releaseOne),
    });
    assert.equal(replay.backend.changed, false);
    assert.equal(replay.ui.changed, false);

    const second = await switcher.switchPointerSet({
      pointers: fixture.pointersFor(fixture.releaseTwo),
    });
    assert.equal(second.backend.changed, true);
    assert.equal(second.backend.previousTargetPath, path.join(fixture.releaseOne, 'be'));
    assert.equal(second.ui.previousTargetPath, fixture.releaseOne);
    assert.equal(await readlink(path.join(fixture.root, 'backend-current')), path.join(fixture.releaseTwo, 'be'));
    assert.equal(await readlink(path.join(fixture.root, 'ui-current')), fixture.releaseTwo);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('activation pointer switcher refuses to replace non-symlink current paths', {
  skip: skipOnWindows,
}, async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.root, 'backend-current'), 'not a symlink\n', { mode: 0o600 });
    const switcher = createSwitcher();
    await assert.rejects(
      switcher.replacePointer(fixture.pointersFor(fixture.releaseOne).backend),
      /unexpected file type/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
