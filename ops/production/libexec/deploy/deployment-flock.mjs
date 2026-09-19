import { constants as fsConstants } from 'node:fs';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';

import { invariant } from './canonical-json.mjs';
import { HOST_DEPLOY_PATHS } from './constants.mjs';
import { createSecurePathValidator, sameStatIdentity } from './secure-filesystem.mjs';

export class DeploymentBusyError extends Error {
  constructor() {
    super('Another production deployment holds the host deployment lock');
    this.name = 'DeploymentBusyError';
    this.code = 'DEPLOYMENT_BUSY';
  }
}

export class FlockAdapterUnavailableError extends Error {
  constructor() {
    super('A native flock adapter is required; external flock commands are not executed');
    this.name = 'FlockAdapterUnavailableError';
    this.code = 'FLOCK_ADAPTER_UNAVAILABLE';
  }
}

const validateLockStat = (stat, trustedUid, trustedGid) => {
  invariant(stat.isFile() && !stat.isSymbolicLink(), 'Deployment lock is not a regular file');
  invariant(BigInt(stat.uid) === BigInt(trustedUid), 'Deployment lock has an unexpected owner');
  invariant(BigInt(stat.gid) === BigInt(trustedGid), 'Deployment lock has an unexpected group');
  invariant(Number(BigInt(stat.mode) & 0o777n) === 0o600, 'Deployment lock has an unexpected mode');
};

export const withDeploymentFlock = async ({
  task,
  flockAdapter,
  lockPath = HOST_DEPLOY_PATHS.lockFile,
  fs = nativeFs,
  security: providedSecurity,
  trustedUid = 0,
  trustedGid = 0,
  syncDirectory = async (directory) => {
    const directoryHandle = await fs.open(
      directory,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY || 0)
        | (fsConstants.O_CLOEXEC || 0),
    );
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  },
} = {}) => {
  invariant(typeof task === 'function', 'Deployment lock task is required');
  if (flockAdapter === undefined
    || typeof flockAdapter.acquireExclusiveNonBlocking !== 'function'
    || typeof flockAdapter.release !== 'function') {
    throw new FlockAdapterUnavailableError();
  }

  const security = providedSecurity ?? createSecurePathValidator({
    fs,
    trustedUid,
    trustedGid,
  });
  const normalized = security.requireNormalizedAbsolute(lockPath);
  const parent = path.dirname(normalized);
  await security.inspectDirectory(parent);
  const flags = fsConstants.O_RDWR
    | (fsConstants.O_NOFOLLOW || 0)
    | (fsConstants.O_CLOEXEC || 0);
  let handle;
  let created = false;
  try {
    handle = await fs.open(
      normalized,
      flags | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    created = true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    handle = await fs.open(normalized, flags);
  }
  let acquired = false;
  let taskError;
  try {
    if (created) await handle.chmod(0o600);
    const opened = await handle.stat({ bigint: true });
    validateLockStat(opened, trustedUid, trustedGid);
    const current = await fs.lstat(normalized, { bigint: true });
    validateLockStat(current, trustedUid, trustedGid);
    invariant(sameStatIdentity(opened, current), 'Deployment lock path changed while being opened');
    await security.inspectDirectory(parent);
    if (created) {
      await handle.sync();
      await syncDirectory(parent);
    }

    const acquisition = await flockAdapter.acquireExclusiveNonBlocking(handle);
    invariant(typeof acquisition === 'boolean', 'Native flock adapter returned an invalid result');
    acquired = acquisition;
    if (!acquired) throw new DeploymentBusyError();
    return await task(Object.freeze({ handle, path: normalized, stat: opened }));
  } catch (error) {
    taskError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    if (acquired) {
      try {
        await flockAdapter.release(handle);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await handle.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      if (taskError !== undefined) {
        throw new AggregateError(
          [taskError, ...cleanupErrors],
          'Deployment task failed and its flock could not be released cleanly',
        );
      }
      throw new AggregateError(cleanupErrors, 'Deployment flock could not be released cleanly');
    }
  }
};
