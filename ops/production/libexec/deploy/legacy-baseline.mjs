import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  createHostActivationSnapshotReference,
  createHostLegacyBaselineActivationSnapshot,
} from '../../../../scripts/deploy/host/state.mjs';
import { createActivationStateStore } from './activation-state-store.mjs';

const execFile = promisify(execFileCallback);
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const POSIX_ABSOLUTE_PATH_PATTERN = /^\/(?:[^/\0]+\/)*[^/\0]+$/;
const MAX_BASELINE_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_PM2_DUMP_BYTES = 16 * 1024 * 1024;
const MAX_UI_BUILD_FILES = 50_000;

const fail = (message) => {
  throw new Error(message);
};

const validatePosixRestorePath = (value, label) => {
  if (typeof value !== 'string' || !POSIX_ABSOLUTE_PATH_PATTERN.test(value)) {
    fail(`${label} must be a canonical absolute POSIX path`);
  }
  if (value.includes('/./') || value.includes('/../') || value.endsWith('/.')) {
    fail(`${label} must not contain traversal segments`);
  }
  return value;
};

const stableRegularFileDigest = async ({
  fs = nativeFs,
  filePath,
  label,
  maximumBytes = MAX_BASELINE_FILE_BYTES,
}) => {
  const before = await fs.lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) fail(`${label} must be a regular file`);
  if (before.size <= 0n || before.size > BigInt(maximumBytes)) fail(`${label} has an invalid size`);
  const bytes = await fs.readFile(filePath);
  if (bytes.length !== Number(before.size)) fail(`${label} changed while being read`);
  const after = await fs.lstat(filePath, { bigint: true });
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs
  ) {
    fail(`${label} changed while being hashed`);
  }
  return Object.freeze({
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
};

const safeRelativePath = (value) => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.includes('\0')
    || value.startsWith('/')
    || value.startsWith('\\')
  ) fail('Legacy UI build contains an unsafe relative path');
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail('Legacy UI build contains traversal-shaped paths');
  }
  return normalized;
};

export const hashLegacyUiBuildTree = async ({
  fs = nativeFs,
  pathApi = path,
  uiBuildPath,
} = {}) => {
  if (typeof uiBuildPath !== 'string' || uiBuildPath.length === 0) {
    fail('Legacy UI build path is required');
  }
  const root = pathApi.resolve(uiBuildPath);
  const rootStat = await fs.lstat(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail('Legacy UI build path must be a real directory');
  }
  const files = [];
  const visit = async (directory, relativeDirectory = '') => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = pathApi.join(directory, entry.name);
      const relativePath = safeRelativePath(
        relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
      );
      if (entry.isSymbolicLink()) fail('Legacy UI build must not contain symbolic links');
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) fail('Legacy UI build must not contain special files');
      if (files.length >= MAX_UI_BUILD_FILES) fail('Legacy UI build contains too many files');
      const snapshot = await stableRegularFileDigest({
        fs,
        filePath: absolutePath,
        label: `Legacy UI build file ${relativePath}`,
      });
      files.push(Object.freeze({
        path: relativePath,
        size: snapshot.size,
        sha256: snapshot.sha256,
      }));
    }
  };
  await visit(root);
  if (files.length === 0) fail('Legacy UI build must not be empty');
  files.sort((left, right) => left.path.localeCompare(right.path));
  const treeHash = createHash('sha256');
  for (const file of files) {
    treeHash.update(`${file.path}\0${file.size}\0${file.sha256}\n`);
  }
  const afterRoot = await fs.lstat(root, { bigint: true });
  if (rootStat.dev !== afterRoot.dev || rootStat.ino !== afterRoot.ino) {
    fail('Legacy UI build root changed while being hashed');
  }
  return Object.freeze({
    fileCount: files.length,
    buildTreeSha256: treeHash.digest('hex'),
  });
};

const readGitHead = async ({
  execFileImpl = execFile,
  gitBinary = '/usr/bin/git',
  repositoryPath,
}) => {
  const result = await execFileImpl(
    gitBinary,
    ['-C', repositoryPath, 'rev-parse', 'HEAD'],
    {
      timeout: 10_000,
      maxBuffer: 1024,
      windowsHide: true,
    },
  );
  const stdout = typeof result === 'string' ? result : result.stdout;
  const value = String(stdout).trim();
  if (!SOURCE_SHA_PATTERN.test(value)) fail('Legacy Git HEAD is not a full lowercase source SHA');
  return value;
};

export const createLegacyBaselineSnapshot = async ({
  fs = nativeFs,
  pathApi = path,
  execFileImpl = execFile,
  gitBinary = '/usr/bin/git',
  activationId = randomUUID(),
  capturedAtUtc,
  capturedBy,
  repositoryPath = '/root/omni-lodge',
  backendRestorePath = '/root/omni-lodge/be',
  uiBuildPath = '/root/omni-lodge/ui/build',
  uiRestorePath = '/root/omni-lodge/ui/build',
  pm2DumpPath = '/root/.pm2/dump.pm2',
  pm2DumpRestorePath = '/root/.pm2/dump.pm2',
} = {}) => {
  const capturedAt = capturedAtUtc ?? new Date().toISOString();
  const sourceSha = await readGitHead({
    execFileImpl,
    gitBinary,
    repositoryPath,
  });
  const uiTree = await hashLegacyUiBuildTree({
    fs,
    pathApi,
    uiBuildPath,
  });
  const pm2Dump = await stableRegularFileDigest({
    fs,
    filePath: pm2DumpPath,
    label: 'Legacy PM2 dump',
    maximumBytes: MAX_PM2_DUMP_BYTES,
  });
  return createHostLegacyBaselineActivationSnapshot({
    activationId,
    backendRestoreTarget: {
      path: validatePosixRestorePath(backendRestorePath, 'Legacy backend restore path'),
      sourceSha,
    },
    uiRestoreTarget: {
      path: validatePosixRestorePath(uiRestorePath, 'Legacy UI restore path'),
      buildTreeSha256: uiTree.buildTreeSha256,
    },
    pm2State: {
      dumpPath: validatePosixRestorePath(pm2DumpRestorePath, 'Legacy PM2 dump restore path'),
      dumpSha256: pm2Dump.sha256,
      backendProcessName: 'omni-lodge-be',
      uiProcessName: 'omni-lodge-ui-server',
    },
    capturedAtUtc: capturedAt,
    capturedBy,
  });
};

export const captureAndInitializeLegacyBaseline = async ({
  store = createActivationStateStore(),
  ...snapshotOptions
} = {}) => {
  const snapshot = await createLegacyBaselineSnapshot(snapshotOptions);
  const stored = await store.initializeActiveSnapshot(snapshot);
  return Object.freeze({
    snapshot,
    reference: createHostActivationSnapshotReference(snapshot),
    activePath: stored.activePath,
  });
};
