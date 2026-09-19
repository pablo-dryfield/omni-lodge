import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { invariant } from './canonical-json.mjs';

const FILE_TYPE_MASK = 0o170000n;
const REGULAR_FILE_TYPE = 0o100000n;
const DIRECTORY_TYPE = 0o040000n;
const PERMISSION_MASK = 0o777n;
const GROUP_OR_WORLD_WRITE = 0o022n;

const asBigInt = (value) => (typeof value === 'bigint' ? value : BigInt(value));

const statIdentity = (stat) => Object.freeze({
  device: asBigInt(stat.dev),
  inode: asBigInt(stat.ino),
});

export const sameStatIdentity = (left, right) => (
  asBigInt(left.dev) === asBigInt(right.dev)
  && asBigInt(left.ino) === asBigInt(right.ino)
);

const modeType = (stat) => asBigInt(stat.mode) & FILE_TYPE_MASK;
const modePermissions = (stat) => Number(asBigInt(stat.mode) & PERMISSION_MASK);

const normalizeForComparison = (value, platform) => (
  platform === 'win32' ? value.toLowerCase() : value
);

const pathChain = (absolutePath, pathApi) => {
  const result = [];
  let current = absolutePath;
  for (;;) {
    result.push(current);
    const parent = pathApi.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result.reverse();
};

const isMissing = (error) => error?.code === 'ENOENT';

export const createSecurePathValidator = ({
  fs = nativeFs,
  pathApi = path,
  platform = process.platform,
  trustedUid = 0,
  trustedGid = 0,
} = {}) => {
  const expectedUid = BigInt(trustedUid);
  const expectedGid = BigInt(trustedGid);

  const requireNormalizedAbsolute = (targetPath) => {
    invariant(typeof targetPath === 'string' && targetPath.length > 0, 'Managed path is required');
    invariant(pathApi.isAbsolute(targetPath), `Managed path is not absolute: ${targetPath}`);
    const resolved = pathApi.resolve(targetPath);
    invariant(
      normalizeForComparison(resolved, platform)
        === normalizeForComparison(targetPath, platform),
      `Managed path is not normalized: ${targetPath}`,
    );
    return resolved;
  };

  const validateStat = (stat, targetPath, expectedType, expectedMode) => {
    invariant(!stat.isSymbolicLink(), `Managed path traverses a symbolic link: ${targetPath}`);
    invariant(asBigInt(stat.uid) === expectedUid, `Managed path is not owned by root: ${targetPath}`);
    invariant(asBigInt(stat.gid) === expectedGid, `Managed path group is not root: ${targetPath}`);
    invariant(
      (asBigInt(stat.mode) & GROUP_OR_WORLD_WRITE) === 0n,
      `Managed path is group/world writable: ${targetPath}`,
    );
    if (expectedType === 'directory') {
      invariant(modeType(stat) === DIRECTORY_TYPE, `Managed path is not a directory: ${targetPath}`);
    } else if (expectedType === 'file') {
      invariant(modeType(stat) === REGULAR_FILE_TYPE, `Managed path is not a regular file: ${targetPath}`);
    }
    if (expectedMode !== undefined) {
      invariant(
        modePermissions(stat) === expectedMode,
        `Managed path has an unexpected mode: ${targetPath}`,
      );
    }
  };

  const inspect = async (targetPath, { expectedType, expectedMode } = {}) => {
    const resolved = requireNormalizedAbsolute(targetPath);
    const chain = pathChain(resolved, pathApi);
    const firstPass = [];
    for (let index = 0; index < chain.length; index += 1) {
      const component = chain[index];
      const stat = await fs.lstat(component, { bigint: true });
      const isLeaf = index === chain.length - 1;
      validateStat(
        stat,
        component,
        isLeaf ? expectedType : 'directory',
        isLeaf ? expectedMode : undefined,
      );
      firstPass.push(stat);
    }

    const real = await fs.realpath(resolved);
    invariant(
      normalizeForComparison(pathApi.resolve(real), platform)
        === normalizeForComparison(resolved, platform),
      `Managed path resolves through a symbolic link: ${targetPath}`,
    );

    for (let index = 0; index < chain.length; index += 1) {
      const component = chain[index];
      const second = await fs.lstat(component, { bigint: true });
      const isLeaf = index === chain.length - 1;
      validateStat(
        second,
        component,
        isLeaf ? expectedType : 'directory',
        isLeaf ? expectedMode : undefined,
      );
      invariant(
        sameStatIdentity(firstPass[index], second),
        `Managed path changed during validation: ${component}`,
      );
    }
    return Object.freeze({ path: resolved, stat: firstPass.at(-1) });
  };

  return Object.freeze({
    requireNormalizedAbsolute,
    inspectDirectory: (targetPath, options = {}) => inspect(targetPath, {
      expectedType: 'directory',
      expectedMode: options.expectedMode,
    }),
    inspectFile: (targetPath, options = {}) => inspect(targetPath, {
      expectedType: 'file',
      expectedMode: options.expectedMode,
    }),
  });
};

const validateOpenFileStat = (stat, {
  label,
  trustedUid,
  trustedGid,
  expectedMode = 0o600,
}) => {
  invariant(modeType(stat) === REGULAR_FILE_TYPE, `${label} is not a regular file`);
  invariant(asBigInt(stat.uid) === BigInt(trustedUid), `${label} has an unexpected owner`);
  invariant(asBigInt(stat.gid) === BigInt(trustedGid), `${label} has an unexpected group`);
  if (expectedMode !== undefined) {
    invariant(modePermissions(stat) === expectedMode, `${label} has an unexpected mode`);
  }
};

const writeAll = async (handle, bytes) => {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
    invariant(bytesWritten > 0, 'Durable file write made no progress');
    offset += bytesWritten;
  }
};

const nativeDirectorySync = async (directory, fs = nativeFs) => {
  const directoryFlags = fsConstants.O_RDONLY
    | (fsConstants.O_DIRECTORY || 0)
    | (fsConstants.O_CLOEXEC || 0);
  const handle = await fs.open(directory, directoryFlags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

export const createDurableFileOps = ({
  fs = nativeFs,
  pathApi = path,
  security: providedSecurity,
  trustedUid = 0,
  trustedGid = 0,
  createId = randomUUID,
  syncDirectoryImpl = (directory) => nativeDirectorySync(directory, fs),
} = {}) => {
  const security = providedSecurity ?? createSecurePathValidator({
    fs,
    pathApi,
    trustedUid,
    trustedGid,
  });
  const noFollow = fsConstants.O_NOFOLLOW || 0;
  const closeOnExec = fsConstants.O_CLOEXEC || 0;

  const verifyPathMatchesHandle = async (targetPath, handleStat, expectedMode = 0o600) => {
    const pathStat = await fs.lstat(targetPath, { bigint: true });
    validateOpenFileStat(pathStat, {
      label: targetPath,
      trustedUid,
      trustedGid,
      expectedMode,
    });
    invariant(sameStatIdentity(pathStat, handleStat), `Managed file changed during validation: ${targetPath}`);
  };

  const validateParent = async (targetPath) => {
    const normalized = security.requireNormalizedAbsolute(targetPath);
    const parent = pathApi.dirname(normalized);
    await security.inspectDirectory(parent);
    return { normalized, parent };
  };

  const removeIfSame = async (targetPath, expectedStat) => {
    try {
      const current = await fs.lstat(targetPath, { bigint: true });
      invariant(
        sameStatIdentity(current, expectedStat),
        `Refusing to remove a replaced temporary file: ${targetPath}`,
      );
      await fs.unlink(targetPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  };

  const syncDirectory = async (directory) => {
    await security.inspectDirectory(directory);
    await syncDirectoryImpl(directory);
    await security.inspectDirectory(directory);
  };

  const publishExclusiveBuffer = async (targetPath, bytes) => {
    invariant(Buffer.isBuffer(bytes), 'Published value must be a Buffer');
    invariant(bytes.length > 0, 'Published value must not be empty');
    const { normalized, parent } = await validateParent(targetPath);
    const temporaryPath = pathApi.join(
      parent,
      `.${pathApi.basename(normalized)}.${createId()}.tmp`,
    );
    security.requireNormalizedAbsolute(temporaryPath);

    let handle;
    let temporaryStat;
    try {
      handle = await fs.open(
        temporaryPath,
        fsConstants.O_WRONLY
          | fsConstants.O_CREAT
          | fsConstants.O_EXCL
          | noFollow
          | closeOnExec,
        0o600,
      );
      temporaryStat = await handle.stat({ bigint: true });
      validateOpenFileStat(temporaryStat, {
        label: temporaryPath,
        trustedUid,
        trustedGid,
        expectedMode: undefined,
      });
      await handle.chmod(0o600);
      temporaryStat = await handle.stat({ bigint: true });
      validateOpenFileStat(temporaryStat, {
        label: temporaryPath,
        trustedUid,
        trustedGid,
      });
      await writeAll(handle, bytes);
      await handle.sync();
      await verifyPathMatchesHandle(temporaryPath, temporaryStat);
      await handle.close();
      handle = undefined;

      await security.inspectDirectory(parent);
      await fs.link(temporaryPath, normalized);
      await syncDirectory(parent);
      await verifyPathMatchesHandle(normalized, temporaryStat);
      await removeIfSame(temporaryPath, temporaryStat);
      await syncDirectory(parent);
      return Object.freeze({ path: normalized, stat: temporaryStat });
    } catch (error) {
      const cleanupErrors = [];
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (temporaryStat !== undefined) {
        try {
          await removeIfSame(temporaryPath, temporaryStat);
          await syncDirectory(parent);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Atomic publication failed and its temporary file could not be cleaned up safely',
        );
      }
      throw error;
    }
  };

  const readSecureBuffer = async (targetPath, { maximumBytes = 64 * 1024 } = {}) => {
    invariant(Number.isSafeInteger(maximumBytes) && maximumBytes > 0, 'Read limit is invalid');
    const { normalized, parent } = await validateParent(targetPath);
    const handle = await fs.open(
      normalized,
      fsConstants.O_RDONLY | noFollow | closeOnExec,
    );
    try {
      const before = await handle.stat({ bigint: true });
      validateOpenFileStat(before, {
        label: normalized,
        trustedUid,
        trustedGid,
      });
      invariant(before.size <= BigInt(maximumBytes), `Managed file exceeds its read limit: ${normalized}`);
      await verifyPathMatchesHandle(normalized, before);
      const bytes = await handle.readFile();
      invariant(bytes.length === Number(before.size), `Managed file changed while being read: ${normalized}`);
      const after = await handle.stat({ bigint: true });
      invariant(sameStatIdentity(before, after) && before.size === after.size, `Managed file changed while being read: ${normalized}`);
      await security.inspectDirectory(parent);
      return Object.freeze({ bytes, stat: after, path: normalized });
    } finally {
      await handle.close();
    }
  };

  const replaceBuffer = async (targetPath, bytes, expectedStat) => {
    invariant(Buffer.isBuffer(bytes), 'Replacement value must be a Buffer');
    invariant(bytes.length > 0, 'Replacement value must not be empty');
    invariant(expectedStat !== null && typeof expectedStat === 'object', 'Expected file identity is required');
    const { normalized, parent } = await validateParent(targetPath);
    const existing = await security.inspectFile(normalized, { expectedMode: 0o600 });
    invariant(
      sameStatIdentity(existing.stat, expectedStat),
      `Refusing to replace a changed managed file: ${normalized}`,
    );
    const temporaryPath = pathApi.join(
      parent,
      `.${pathApi.basename(normalized)}.${createId()}.replace`,
    );
    security.requireNormalizedAbsolute(temporaryPath);

    let handle;
    let temporaryStat;
    try {
      handle = await fs.open(
        temporaryPath,
        fsConstants.O_WRONLY
          | fsConstants.O_CREAT
          | fsConstants.O_EXCL
          | noFollow
          | closeOnExec,
        0o600,
      );
      temporaryStat = await handle.stat({ bigint: true });
      validateOpenFileStat(temporaryStat, {
        label: temporaryPath,
        trustedUid,
        trustedGid,
        expectedMode: undefined,
      });
      await handle.chmod(0o600);
      temporaryStat = await handle.stat({ bigint: true });
      validateOpenFileStat(temporaryStat, {
        label: temporaryPath,
        trustedUid,
        trustedGid,
      });
      await writeAll(handle, bytes);
      await handle.sync();
      await verifyPathMatchesHandle(temporaryPath, temporaryStat);
      await handle.close();
      handle = undefined;

      const current = await security.inspectFile(normalized, { expectedMode: 0o600 });
      invariant(
        sameStatIdentity(current.stat, expectedStat),
        `Refusing to replace a changed managed file: ${normalized}`,
      );
      await fs.rename(temporaryPath, normalized);
      await syncDirectory(parent);
      await verifyPathMatchesHandle(normalized, temporaryStat);
      return Object.freeze({ path: normalized, stat: temporaryStat });
    } catch (error) {
      const cleanupErrors = [];
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (temporaryStat !== undefined) {
        try {
          await removeIfSame(temporaryPath, temporaryStat);
          await syncDirectory(parent);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Atomic replacement failed and its temporary file could not be cleaned up safely',
        );
      }
      throw error;
    }
  };

  const linkNoReplace = async (sourcePath, destinationPath) => {
    const source = await security.inspectFile(sourcePath, { expectedMode: 0o600 });
    const destination = await validateParent(destinationPath);
    await fs.link(source.path, destination.normalized);
    try {
      await syncDirectory(destination.parent);
      const destinationStat = await fs.lstat(destination.normalized, { bigint: true });
      invariant(
        sameStatIdentity(source.stat, destinationStat),
        `Request transition destination does not match its source: ${destination.normalized}`,
      );
      return Object.freeze({ path: destination.normalized, stat: destinationStat });
    } catch (error) {
      try {
        const destinationStat = await fs.lstat(destination.normalized, { bigint: true });
        if (sameStatIdentity(source.stat, destinationStat)) {
          await fs.unlink(destination.normalized);
          await syncDirectory(destination.parent);
        }
      } catch (cleanupError) {
        if (!isMissing(cleanupError)) {
          throw new AggregateError([error, cleanupError], 'Request transition link cleanup failed');
        }
      }
      throw error;
    }
  };

  const unlinkVerified = async (targetPath, expectedStat) => {
    const inspected = await security.inspectFile(targetPath, { expectedMode: 0o600 });
    invariant(
      sameStatIdentity(inspected.stat, expectedStat),
      `Refusing to unlink a replaced managed file: ${targetPath}`,
    );
    const parent = pathApi.dirname(inspected.path);
    await fs.unlink(inspected.path);
    await syncDirectory(parent);
  };

  const listSecureDirectory = async (targetPath, { maximumEntries = 1024 } = {}) => {
    invariant(
      Number.isSafeInteger(maximumEntries) && maximumEntries > 0,
      'Directory entry limit is invalid',
    );
    const normalized = security.requireNormalizedAbsolute(targetPath);
    const before = await security.inspectDirectory(normalized);
    const directory = await fs.opendir(normalized);
    const names = [];
    try {
      for await (const entry of directory) {
        invariant(
          entry.isFile() && !entry.isSymbolicLink(),
          `Managed directory contains a non-regular entry: ${pathApi.join(normalized, entry.name)}`,
        );
        names.push(entry.name);
        invariant(
          names.length <= maximumEntries,
          `Managed directory exceeds its entry limit: ${normalized}`,
        );
      }
    } finally {
      try {
        await directory.close();
      } catch (error) {
        if (error?.code !== 'ERR_DIR_CLOSED') throw error;
      }
    }
    const after = await security.inspectDirectory(normalized);
    invariant(
      sameStatIdentity(before.stat, after.stat),
      `Managed directory changed identity while being listed: ${normalized}`,
    );
    return Object.freeze(names.sort());
  };

  const appendDurableLine = async (targetPath, line, {
    maximumBytes = 16 * 1024,
    maximumFileBytes = 256 * 1024,
    expectedStat = null,
  } = {}) => {
    invariant(Buffer.isBuffer(line), 'Audit line must be a Buffer');
    invariant(line.length > 0 && line.length <= maximumBytes, 'Audit line exceeds its byte limit');
    invariant(line.at(-1) === 0x0a, 'Audit line must end with one newline');
    invariant(
      Number.isSafeInteger(maximumFileBytes) && maximumFileBytes >= maximumBytes,
      'Audit file byte limit is invalid',
    );
    const { normalized, parent } = await validateParent(targetPath);
    const baseFlags = fsConstants.O_WRONLY | fsConstants.O_APPEND | noFollow | closeOnExec;
    let handle;
    let created = false;
    try {
      try {
        handle = await fs.open(
          normalized,
          baseFlags | fsConstants.O_CREAT | fsConstants.O_EXCL,
          0o600,
        );
        created = true;
        await handle.chmod(0o600);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        handle = await fs.open(normalized, baseFlags);
      }
      const opened = await handle.stat({ bigint: true });
      validateOpenFileStat(opened, {
        label: normalized,
        trustedUid,
        trustedGid,
      });
      await verifyPathMatchesHandle(normalized, opened);
      if (expectedStat !== null) {
        invariant(
          sameStatIdentity(opened, expectedStat) && opened.size === expectedStat.size,
          `Refusing to append to a changed managed file: ${normalized}`,
        );
      }
      invariant(
        opened.size + BigInt(line.length) <= BigInt(maximumFileBytes),
        `Audit file exceeds its byte limit: ${normalized}`,
      );
      const { bytesWritten } = await handle.write(line, 0, line.length, null);
      invariant(bytesWritten === line.length, 'Audit append was partial');
      await handle.sync();
      const after = await handle.stat({ bigint: true });
      invariant(
        sameStatIdentity(opened, after)
          && after.size === opened.size + BigInt(line.length),
        `Audit file changed during append: ${normalized}`,
      );
      await verifyPathMatchesHandle(normalized, after);
      await security.inspectDirectory(parent);
      await handle.close();
      handle = undefined;
      if (created) await syncDirectory(parent);
      return Object.freeze({ path: normalized, bytesWritten });
    } finally {
      if (handle !== undefined) await handle.close();
    }
  };

  return Object.freeze({
    publishExclusiveBuffer,
    replaceBuffer,
    readSecureBuffer,
    linkNoReplace,
    unlinkVerified,
    listSecureDirectory,
    appendDurableLine,
    syncDirectory,
    validateParent,
  });
};
