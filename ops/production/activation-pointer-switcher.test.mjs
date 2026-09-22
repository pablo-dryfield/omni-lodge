import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readlink, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createActivationPointerSwitcher,
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
