import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { validateHostActivationSnapshot } from '../../../../scripts/deploy/host/state.mjs';
import { invariant } from './canonical-json.mjs';
import { PRODUCTION_RELEASE_LAYOUT } from './release-preparation.mjs';

const DIRECTORY_TYPE = 0o040000n;
const SYMLINK_TYPE = 0o120000n;
const FILE_TYPE_MASK = 0o170000n;
const GROUP_OR_WORLD_WRITE = 0o022n;

const asBigInt = (value) => (typeof value === 'bigint' ? value : BigInt(value));
const modeType = (stat) => asBigInt(stat.mode) & FILE_TYPE_MASK;

const isMissing = (error) => error?.code === 'ENOENT';

const normalizeAbsolute = (targetPath, pathApi) => {
  invariant(typeof targetPath === 'string' && targetPath.length > 0, 'Activation pointer path is required');
  invariant(pathApi.isAbsolute(targetPath), `Activation pointer path is not absolute: ${targetPath}`);
  const resolved = pathApi.resolve(targetPath);
  invariant(resolved === targetPath, `Activation pointer path is not normalized: ${targetPath}`);
  return resolved;
};

const validateTrustedStat = ({
  stat,
  label,
  expectedType,
  platform,
  trustedUid,
  trustedGid,
}) => {
  invariant(modeType(stat) === expectedType, `${label} has an unexpected file type`);
  if (platform !== 'win32') {
    invariant(asBigInt(stat.uid) === BigInt(trustedUid), `${label} is not owned by the trusted user`);
    invariant(asBigInt(stat.gid) === BigInt(trustedGid), `${label} is not owned by the trusted group`);
    if (expectedType !== SYMLINK_TYPE) {
      invariant((asBigInt(stat.mode) & GROUP_OR_WORLD_WRITE) === 0n, `${label} is group/world writable`);
    }
  }
};

const nativeDirectorySync = async (directory, fs) => {
  const handle = await fs.open(
    directory,
    fsConstants.O_RDONLY
      | (fsConstants.O_DIRECTORY || 0)
      | (fsConstants.O_CLOEXEC || 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const defaultActivationPointerPaths = ({
  layout = PRODUCTION_RELEASE_LAYOUT,
  pathApi = path,
} = {}) => {
  const root = pathApi.dirname(layout.releasesRoot);
  return Object.freeze({
    backend: pathApi.join(root, 'backend-current'),
    ui: pathApi.join(root, 'ui-current'),
  });
};

export const pointerSetFromArtifactSnapshot = ({
  targetSnapshot,
  layout = PRODUCTION_RELEASE_LAYOUT,
  pathApi = path,
} = {}) => {
  const snapshot = validateHostActivationSnapshot(targetSnapshot);
  invariant(snapshot.snapshotKind === 'artifact', 'Only artifact activation snapshots can become current pointers');
  const pointers = defaultActivationPointerPaths({ layout, pathApi });
  return Object.freeze({
    backend: Object.freeze({
      component: 'backend',
      linkPath: pointers.backend,
      targetPath: snapshot.backendRestoreTarget,
    }),
    ui: Object.freeze({
      component: 'ui',
      linkPath: pointers.ui,
      targetPath: snapshot.uiRestoreTarget,
    }),
  });
};

export const createActivationPointerSwitcher = ({
  fs = nativeFs,
  pathApi = path,
  platform = process.platform,
  trustedUid = 0,
  trustedGid = 0,
  createId = randomUUID,
  syncDirectory = (directory) => nativeDirectorySync(directory, fs),
} = {}) => {
  const inspectDirectory = async (directoryPath, label = directoryPath) => {
    const normalized = normalizeAbsolute(directoryPath, pathApi);
    const before = await fs.lstat(normalized, { bigint: true });
    validateTrustedStat({
      stat: before,
      label,
      expectedType: DIRECTORY_TYPE,
      platform,
      trustedUid,
      trustedGid,
    });
    const real = await fs.realpath(normalized);
    invariant(pathApi.resolve(real) === normalized, `${label} resolves through a symbolic link`);
    const after = await fs.lstat(normalized, { bigint: true });
    invariant(
      asBigInt(before.dev) === asBigInt(after.dev) && asBigInt(before.ino) === asBigInt(after.ino),
      `${label} changed during validation`,
    );
    return Object.freeze({ path: normalized, stat: before });
  };

  const readPointer = async (linkPath, { required = true } = {}) => {
    const normalized = normalizeAbsolute(linkPath, pathApi);
    try {
      const stat = await fs.lstat(normalized, { bigint: true });
      validateTrustedStat({
        stat,
        label: `Activation pointer ${normalized}`,
        expectedType: SYMLINK_TYPE,
        platform,
        trustedUid,
        trustedGid,
      });
      const targetPath = await fs.readlink(normalized);
      invariant(pathApi.isAbsolute(targetPath), `Activation pointer has a relative target: ${normalized}`);
      const resolvedTarget = await fs.realpath(normalized);
      return Object.freeze({
        linkPath: normalized,
        targetPath,
        resolvedTarget,
        stat,
      });
    } catch (error) {
      if (!required && isMissing(error)) return null;
      throw error;
    }
  };

  const assertPointerTarget = async ({ linkPath, targetPath }) => {
    const pointer = await readPointer(linkPath);
    invariant(pointer.targetPath === targetPath, `Activation pointer target changed unexpectedly: ${linkPath}`);
    return pointer;
  };

  const removeTemporaryPointer = async (temporaryPath, expectedTarget) => {
    try {
      const pointer = await readPointer(temporaryPath);
      if (pointer.targetPath === expectedTarget) await fs.unlink(temporaryPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  };

  const replacePointer = async (pointer) => {
    const component = pointer?.component;
    invariant(component === 'backend' || component === 'ui', 'Activation pointer component is invalid');
    const linkPath = normalizeAbsolute(pointer.linkPath, pathApi);
    const targetPath = normalizeAbsolute(pointer.targetPath, pathApi);
    const parent = pathApi.dirname(linkPath);
    await inspectDirectory(parent, `Activation pointer parent ${parent}`);
    await inspectDirectory(targetPath, `Activation pointer target ${targetPath}`);
    const previous = await readPointer(linkPath, { required: false });
    if (previous !== null && previous.targetPath === targetPath) {
      return Object.freeze({
        component,
        linkPath,
        targetPath,
        previousTargetPath: previous.targetPath,
        changed: false,
      });
    }

    const temporaryPath = pathApi.join(parent, `.${pathApi.basename(linkPath)}.${createId()}.tmp`);
    normalizeAbsolute(temporaryPath, pathApi);
    try {
      await fs.symlink(targetPath, temporaryPath, platform === 'win32' ? 'junction' : 'dir');
      await assertPointerTarget({ linkPath: temporaryPath, targetPath });
      await fs.rename(temporaryPath, linkPath);
      await syncDirectory(parent);
      await assertPointerTarget({ linkPath, targetPath });
      return Object.freeze({
        component,
        linkPath,
        targetPath,
        previousTargetPath: previous?.targetPath ?? null,
        changed: true,
      });
    } catch (error) {
      try {
        await removeTemporaryPointer(temporaryPath, targetPath);
        await syncDirectory(parent);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Activation pointer switch failed and cleanup failed');
      }
      throw error;
    }
  };

  const switchPointerSet = async ({ pointers }) => {
    invariant(pointers !== null && typeof pointers === 'object', 'Activation pointer set is required');
    const backend = await replacePointer(pointers.backend);
    const ui = await replacePointer(pointers.ui);
    return Object.freeze({
      schemaVersion: 1,
      backend,
      ui,
    });
  };

  const switchArtifactPointers = async ({
    targetSnapshot,
    layout = PRODUCTION_RELEASE_LAYOUT,
  }) => switchPointerSet({
    pointers: pointerSetFromArtifactSnapshot({ targetSnapshot, layout, pathApi }),
  });

  return Object.freeze({
    readPointer,
    replacePointer,
    switchPointerSet,
    switchArtifactPointers,
  });
};
