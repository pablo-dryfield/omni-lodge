import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as nativeFs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import {
  invariant,
  parseCanonicalJson,
  requireExactKeys,
  serializeCanonicalJson,
} from './canonical-json.mjs';

const execFile = promisify(execFileCallback);

export const PRODUCTION_BACKUP_GATE_RESULT_SCHEMA_VERSION = 1;

export const DEFAULT_PRODUCTION_BACKUP_GATE = Object.freeze({
  backupCommandPath: '/home/postgres/backup.sh',
  backupRoot: '/home/postgres/backups',
  commandTimeoutMs: 60 * 60 * 1000,
  outputLimitBytes: 1024 * 1024,
  freshnessToleranceMs: 5 * 1000,
  maximumBackupBytes: 64 * 1024 * 1024 * 1024,
  minimumAvailableBytes: 2 * 1024 * 1024 * 1024,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const RELEASE_ID_PATTERN = /^omnilodge-r([1-9][0-9]*)-a([1-9][0-9]*)-([0-9a-f]{12})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const PERMISSION_MASK = 0o777n;
const GROUP_OR_WORLD_WRITE = 0o022n;
const GROUP_OR_WORLD_ACCESS = 0o077n;

const asBigInt = (value) => (typeof value === 'bigint' ? value : BigInt(value));

const requireUuid = (value, label) => {
  invariant(typeof value === 'string' && UUID_PATTERN.test(value), `${label} must be a canonical lowercase UUID v4`);
  return value;
};

const requireSourceSha = (value, label) => {
  invariant(typeof value === 'string' && SOURCE_SHA_PATTERN.test(value), `${label} must be a lowercase Git commit SHA`);
  return value;
};

const requireReleaseId = (value, sourceSha, label) => {
  const match = typeof value === 'string' ? RELEASE_ID_PATTERN.exec(value) : null;
  invariant(match !== null && match[3] === sourceSha.slice(0, 12), `${label} is invalid`);
  return value;
};

const requireSha256 = (value, label) => {
  invariant(typeof value === 'string' && SHA256_PATTERN.test(value), `${label} must be a lowercase SHA-256 digest`);
  return value;
};

const requireUtc = (value, label) => {
  invariant(typeof value === 'string', `${label} must be text`);
  const parsed = new Date(value);
  invariant(!Number.isNaN(parsed.getTime()) && parsed.toISOString() === value, `${label} must be a canonical UTC timestamp`);
  return value;
};

const requireNonNegativeSafeInteger = (value, label) => {
  invariant(Number.isSafeInteger(value) && value >= 0, `${label} must be a non-negative safe integer`);
  return value;
};

const requirePositiveSafeInteger = (value, label) => {
  invariant(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`);
  return value;
};

const requireOptionalNonNegativeSafeInteger = (value, label) => {
  if (value === null) return null;
  return requireNonNegativeSafeInteger(value, label);
};

const requireAbsolutePath = (value, label) => {
  invariant(typeof value === 'string' && value.length > 1 && value.length <= 4096, `${label} is invalid`);
  invariant(!/[\u0000-\u001f\u007f]/.test(value), `${label} contains a control character`);
  invariant(value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value), `${label} must be absolute`);
  return value;
};

const validateDate = (value, label) => {
  invariant(value instanceof Date && !Number.isNaN(value.getTime()), `${label} must be a valid Date`);
  return value;
};

const toIso = (value, label) => validateDate(value, label).toISOString();

const modePermissions = (stat) => Number(asBigInt(stat.mode) & PERMISSION_MASK);

const mtimeNs = (stat) => {
  if (stat.mtimeNs !== undefined) return asBigInt(stat.mtimeNs);
  if (stat.mtimeMs !== undefined) return BigInt(Math.floor(stat.mtimeMs * 1_000_000));
  if (stat.mtime instanceof Date) return BigInt(stat.mtime.getTime()) * 1_000_000n;
  throw new Error('File timestamp is unavailable');
};

const sizeBytes = (stat, label) => {
  const size = asBigInt(stat.size);
  invariant(size <= MAX_SAFE_BIGINT, `${label} is too large to record safely`);
  return Number(size);
};

const statIdentity = (stat) => ({
  dev: asBigInt(stat.dev),
  ino: asBigInt(stat.ino),
  size: asBigInt(stat.size),
  mtimeNs: mtimeNs(stat),
});

const sameVerifiedStat = (left, right) => (
  asBigInt(left.dev) === asBigInt(right.dev)
  && asBigInt(left.ino) === asBigInt(right.ino)
  && asBigInt(left.size) === asBigInt(right.size)
  && mtimeNs(left) === mtimeNs(right)
);

const normalizePath = (value, label, pathApi) => {
  invariant(typeof value === 'string' && value.length > 0, `${label} is required`);
  invariant(pathApi.isAbsolute(value), `${label} must be absolute`);
  const resolved = pathApi.resolve(value);
  invariant(resolved === value, `${label} must be normalized`);
  invariant(!/[\u0000-\u001f\u007f]/.test(value), `${label} contains a control character`);
  return resolved;
};

const sameResolvedPath = (left, right, pathApi) => {
  const normalizedLeft = pathApi.resolve(left);
  const normalizedRight = pathApi.resolve(right);
  if (process.platform === 'win32') {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
};

const requireContainedPath = (root, candidate, label, pathApi) => {
  const relative = pathApi.relative(root, candidate);
  invariant(
    relative.length > 0 && !relative.startsWith('..') && !pathApi.isAbsolute(relative),
    `${label} must be inside the backup root`,
  );
};

const verifyOwnedStat = ({
  stat,
  label,
  trustedUid,
  trustedGid,
  enforceOwnership,
}) => {
  if (!enforceOwnership) return;
  invariant(asBigInt(stat.uid) === BigInt(trustedUid), `${label} has an unexpected owner`);
  invariant(asBigInt(stat.gid) === BigInt(trustedGid), `${label} has an unexpected group`);
};

const verifySafeMode = ({
  stat,
  label,
  enforceNoGroupWorldWrite,
  enforcePrivateMode,
}) => {
  const permissions = BigInt(modePermissions(stat));
  if (enforcePrivateMode) {
    invariant((permissions & GROUP_OR_WORLD_ACCESS) === 0n, `${label} is group/world accessible`);
  } else if (enforceNoGroupWorldWrite) {
    invariant((permissions & GROUP_OR_WORLD_WRITE) === 0n, `${label} is group/world writable`);
  }
};

const verifyDirectory = async ({
  fs,
  targetPath,
  label,
  security,
  pathApi,
}) => {
  const stat = await fs.lstat(targetPath, { bigint: true });
  invariant(stat.isDirectory(), `${label} is not a directory`);
  invariant(!stat.isSymbolicLink(), `${label} must not be a symbolic link`);
  verifyOwnedStat({ stat, label, ...security });
  verifySafeMode({
    stat,
    label,
    enforceNoGroupWorldWrite: security.enforceNoGroupWorldWrite,
    enforcePrivateMode: false,
  });
  const real = await fs.realpath(targetPath);
  invariant(sameResolvedPath(real, targetPath, pathApi), `${label} must not resolve through a symbolic link`);
  return stat;
};

const verifyRegularFile = async ({
  fs,
  targetPath,
  label,
  security,
  pathApi,
  requireOwnerExecute = false,
  requirePrivateMode = false,
}) => {
  const stat = await fs.lstat(targetPath, { bigint: true });
  invariant(stat.isFile(), `${label} is not a regular file`);
  invariant(!stat.isSymbolicLink(), `${label} must not be a symbolic link`);
  verifyOwnedStat({ stat, label, ...security });
  verifySafeMode({
    stat,
    label,
    enforceNoGroupWorldWrite: security.enforceNoGroupWorldWrite,
    enforcePrivateMode: requirePrivateMode && security.enforcePrivateBackupFileMode,
  });
  if (requireOwnerExecute && security.enforceCommandExecutable) {
    invariant((modePermissions(stat) & 0o100) !== 0, `${label} is not owner-executable`);
  }
  const real = await fs.realpath(targetPath);
  invariant(sameResolvedPath(real, targetPath, pathApi), `${label} must not resolve through a symbolic link`);
  return stat;
};

const bytesLength = (value) => {
  if (value === undefined || value === null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  return Buffer.byteLength(String(value));
};

const measureAvailableBytes = async ({
  fs,
  backupRoot,
  minimumAvailableBytes,
}) => {
  if (typeof fs.statfs !== 'function') {
    invariant(
      minimumAvailableBytes === 0,
      'Production backup free-space verification requires fs.statfs support',
    );
    return null;
  }
  const stat = await fs.statfs(backupRoot, { bigint: true });
  const available = asBigInt(stat.bavail) * asBigInt(stat.bsize);
  invariant(available <= MAX_SAFE_BIGINT, 'Production backup free-space value is too large to record safely');
  const availableNumber = Number(available);
  invariant(availableNumber >= minimumAvailableBytes, 'Production backup directory does not have enough free space');
  return availableNumber;
};

const listBackupDirectoryNames = async ({ fs, backupRoot }) => {
  const dirents = await fs.readdir(backupRoot, { withFileTypes: true });
  return new Set(dirents.map((entry) => entry.name));
};

const listFreshBackupCandidates = async ({
  fs,
  backupRoot,
  beforeNames,
  startedAt,
  freshnessToleranceMs,
  maximumBackupBytes,
  security,
  pathApi,
}) => {
  const cutoffNs = BigInt(startedAt.getTime() - freshnessToleranceMs) * 1_000_000n;
  const dirents = await fs.readdir(backupRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of dirents) {
    if (beforeNames.has(entry.name)) continue;
    invariant(!/[\u0000-\u001f\u007f/\\]/.test(entry.name), 'Production backup filename is unsafe');
    const candidatePath = pathApi.join(backupRoot, entry.name);
    requireContainedPath(backupRoot, candidatePath, 'Production backup file', pathApi);
    const stat = await verifyRegularFile({
      fs,
      targetPath: candidatePath,
      label: 'Production backup file',
      security,
      pathApi,
      requirePrivateMode: true,
    });
    const size = sizeBytes(stat, 'Production backup file');
    invariant(size > 0, 'Production backup file is empty');
    invariant(size <= maximumBackupBytes, 'Production backup file exceeds the maximum expected backup size');
    invariant(mtimeNs(stat) >= cutoffNs, 'Production backup file is not fresh');
    candidates.push(Object.freeze({
      name: entry.name,
      path: candidatePath,
      stat,
      sizeBytes: size,
      mtimeNs: mtimeNs(stat),
    }));
  }
  candidates.sort((left, right) => {
    if (left.mtimeNs !== right.mtimeNs) return left.mtimeNs > right.mtimeNs ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return Object.freeze(candidates);
};

const sha256File = async ({
  fs,
  targetPath,
  expectedStat,
}) => {
  const before = await fs.lstat(targetPath, { bigint: true });
  invariant(sameVerifiedStat(before, expectedStat), 'Production backup file changed before checksum');
  const hash = createHash('sha256');
  let bytesRead = 0;
  await new Promise((resolve, reject) => {
    const stream = createReadStream(targetPath, { flags: 'r' });
    stream.on('data', (chunk) => {
      bytesRead += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  const after = await fs.lstat(targetPath, { bigint: true });
  invariant(sameVerifiedStat(after, expectedStat), 'Production backup file changed during checksum');
  return Object.freeze({
    sha256: hash.digest('hex'),
    bytesRead,
  });
};

const runBackupCommand = async ({
  commandPath,
  commandTimeoutMs,
  outputLimitBytes,
  execFileImpl,
}) => {
  try {
    const output = await execFileImpl(commandPath, [], {
      timeout: commandTimeoutMs,
      maxBuffer: outputLimitBytes,
      windowsHide: true,
      encoding: 'buffer',
      env: process.env,
    });
    return Object.freeze({
      stdoutBytes: bytesLength(output?.stdout),
      stderrBytes: bytesLength(output?.stderr),
    });
  } catch (error) {
    const wrapped = new Error('Production backup command failed');
    wrapped.cause = error;
    throw wrapped;
  }
};

const validateRequestStateForBackup = (requestState) => {
  invariant(requestState?.request?.kind === 'forward_submit', 'Backup gate only supports forward deploy requests');
  invariant(requestState.intent?.operation === 'deploy', 'Backup gate only runs for deploy requests');
  invariant(requestState.phase === 'preflight_passed', 'Backup gate requires the preflight_passed phase');
  const requestId = requireUuid(requestState.request.requestId, 'Backup gate request ID');
  const sourceSha = requireSourceSha(requestState.intent.sourceSha, 'Backup gate source SHA');
  const releaseId = requireReleaseId(requestState.intent.releaseId, sourceSha, 'Backup gate release ID');
  return Object.freeze({ requestId, sourceSha, releaseId });
};

export const validateProductionBackupGateResult = (rawResult) => {
  const result = requireExactKeys(
    rawResult,
    [
      'schemaVersion',
      'requestId',
      'releaseId',
      'sourceSha',
      'command',
      'backupRoot',
      'availableBytesBefore',
      'availableBytesAfter',
      'selectedBackup',
      'createdBackupCount',
      'startedAtUtc',
      'completedAtUtc',
    ],
    'production backup gate result',
  );
  invariant(result.schemaVersion === PRODUCTION_BACKUP_GATE_RESULT_SCHEMA_VERSION, 'Production backup gate schema version is unsupported');
  const requestId = requireUuid(result.requestId, 'Production backup gate request ID');
  const sourceSha = requireSourceSha(result.sourceSha, 'Production backup gate source SHA');
  const releaseId = requireReleaseId(result.releaseId, sourceSha, 'Production backup gate release ID');
  const command = requireExactKeys(
    result.command,
    ['path', 'timeoutMs', 'stdoutBytes', 'stderrBytes'],
    'production backup gate command result',
  );
  const selectedBackup = requireExactKeys(
    result.selectedBackup,
    ['path', 'sizeBytes', 'sha256', 'mtimeUtc'],
    'production backup gate selected backup',
  );
  return Object.freeze({
    schemaVersion: PRODUCTION_BACKUP_GATE_RESULT_SCHEMA_VERSION,
    requestId,
    releaseId,
    sourceSha,
    command: Object.freeze({
      path: requireAbsolutePath(command.path, 'Production backup gate command path'),
      timeoutMs: requirePositiveSafeInteger(command.timeoutMs, 'Production backup gate command timeout'),
      stdoutBytes: requireNonNegativeSafeInteger(command.stdoutBytes, 'Production backup gate stdout byte count'),
      stderrBytes: requireNonNegativeSafeInteger(command.stderrBytes, 'Production backup gate stderr byte count'),
    }),
    backupRoot: requireAbsolutePath(result.backupRoot, 'Production backup gate backup root'),
    availableBytesBefore: requireOptionalNonNegativeSafeInteger(result.availableBytesBefore, 'Production backup gate available bytes before'),
    availableBytesAfter: requireOptionalNonNegativeSafeInteger(result.availableBytesAfter, 'Production backup gate available bytes after'),
    selectedBackup: Object.freeze({
      path: requireAbsolutePath(selectedBackup.path, 'Production backup gate selected backup path'),
      sizeBytes: requirePositiveSafeInteger(selectedBackup.sizeBytes, 'Production backup gate selected backup size'),
      sha256: requireSha256(selectedBackup.sha256, 'Production backup gate selected backup digest'),
      mtimeUtc: requireUtc(selectedBackup.mtimeUtc, 'Production backup gate selected backup mtime'),
    }),
    createdBackupCount: requirePositiveSafeInteger(result.createdBackupCount, 'Production backup gate created backup count'),
    startedAtUtc: requireUtc(result.startedAtUtc, 'Production backup gate start time'),
    completedAtUtc: requireUtc(result.completedAtUtc, 'Production backup gate completion time'),
  });
};

export const serializeProductionBackupGateResult = (result) => serializeCanonicalJson(
  validateProductionBackupGateResult(result),
);

export const parseProductionBackupGateResult = (bytes) => parseCanonicalJson(bytes, {
  label: 'Production backup gate result',
  maximumBytes: 8 * 1024,
  validate: validateProductionBackupGateResult,
});

export const runProductionBackupGate = async ({
  requestState,
  fs = nativeFs,
  execFileImpl = execFile,
  clock = () => new Date(),
  pathApi = path.posix,
  backupCommandPath = DEFAULT_PRODUCTION_BACKUP_GATE.backupCommandPath,
  backupRoot = DEFAULT_PRODUCTION_BACKUP_GATE.backupRoot,
  commandTimeoutMs = DEFAULT_PRODUCTION_BACKUP_GATE.commandTimeoutMs,
  outputLimitBytes = DEFAULT_PRODUCTION_BACKUP_GATE.outputLimitBytes,
  freshnessToleranceMs = DEFAULT_PRODUCTION_BACKUP_GATE.freshnessToleranceMs,
  maximumBackupBytes = DEFAULT_PRODUCTION_BACKUP_GATE.maximumBackupBytes,
  minimumAvailableBytes = DEFAULT_PRODUCTION_BACKUP_GATE.minimumAvailableBytes,
  trustedUid = 0,
  trustedGid = 0,
  enforceOwnership = true,
  enforceNoGroupWorldWrite = true,
  enforcePrivateBackupFileMode = true,
  enforceCommandExecutable = true,
} = {}) => {
  const identity = validateRequestStateForBackup(requestState);
  const normalizedCommandPath = normalizePath(backupCommandPath, 'Production backup command path', pathApi);
  const normalizedBackupRoot = normalizePath(backupRoot, 'Production backup root', pathApi);
  const security = Object.freeze({
    trustedUid,
    trustedGid,
    enforceOwnership,
    enforceNoGroupWorldWrite,
    enforcePrivateBackupFileMode,
    enforceCommandExecutable,
  });

  validateDate(clock(), 'Backup gate clock');
  requirePositiveSafeInteger(commandTimeoutMs, 'Production backup command timeout');
  requirePositiveSafeInteger(outputLimitBytes, 'Production backup command output limit');
  requireNonNegativeSafeInteger(freshnessToleranceMs, 'Production backup freshness tolerance');
  requirePositiveSafeInteger(maximumBackupBytes, 'Production backup maximum size');
  requireNonNegativeSafeInteger(minimumAvailableBytes, 'Production backup minimum free space');

  await verifyRegularFile({
    fs,
    targetPath: normalizedCommandPath,
    label: 'Production backup command',
    security,
    pathApi,
    requireOwnerExecute: true,
  });
  await verifyDirectory({
    fs,
    targetPath: normalizedBackupRoot,
    label: 'Production backup root',
    security,
    pathApi,
  });

  const availableBytesBefore = await measureAvailableBytes({
    fs,
    backupRoot: normalizedBackupRoot,
    minimumAvailableBytes,
  });
  const beforeNames = await listBackupDirectoryNames({
    fs,
    backupRoot: normalizedBackupRoot,
  });
  const startedAt = validateDate(clock(), 'Backup gate start time');
  const command = await runBackupCommand({
    commandPath: normalizedCommandPath,
    commandTimeoutMs,
    outputLimitBytes,
    execFileImpl,
  });
  const candidates = await listFreshBackupCandidates({
    fs,
    backupRoot: normalizedBackupRoot,
    beforeNames,
    startedAt,
    freshnessToleranceMs,
    maximumBackupBytes,
    security,
    pathApi,
  });
  invariant(candidates.length > 0, 'Production backup command did not create a fresh backup file');
  const selected = candidates[0];
  const checksum = await sha256File({
    fs,
    targetPath: selected.path,
    expectedStat: selected.stat,
  });
  invariant(checksum.bytesRead === selected.sizeBytes, 'Production backup checksum byte count does not match file size');
  const availableBytesAfter = await measureAvailableBytes({
    fs,
    backupRoot: normalizedBackupRoot,
    minimumAvailableBytes: 0,
  });
  const completedAt = validateDate(clock(), 'Backup gate completion time');

  return validateProductionBackupGateResult({
    schemaVersion: PRODUCTION_BACKUP_GATE_RESULT_SCHEMA_VERSION,
    requestId: identity.requestId,
    releaseId: identity.releaseId,
    sourceSha: identity.sourceSha,
    command: {
      path: normalizedCommandPath,
      timeoutMs: commandTimeoutMs,
      stdoutBytes: command.stdoutBytes,
      stderrBytes: command.stderrBytes,
    },
    backupRoot: normalizedBackupRoot,
    availableBytesBefore,
    availableBytesAfter,
    selectedBackup: {
      path: selected.path,
      sizeBytes: selected.sizeBytes,
      sha256: checksum.sha256,
      mtimeUtc: new Date(Number(selected.mtimeNs / 1_000_000n)).toISOString(),
    },
    createdBackupCount: candidates.length,
    startedAtUtc: toIso(startedAt, 'Backup gate start time'),
    completedAtUtc: toIso(completedAt, 'Backup gate completion time'),
  });
};
