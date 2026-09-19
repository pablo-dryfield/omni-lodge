import * as nativeFs from 'node:fs/promises';

import { invariant, requireExactKeys } from './canonical-json.mjs';

const REQUIREMENT_KEYS = Object.freeze([
  'incomingArchive',
  'temporaryExtraction',
  'candidateRelease',
  'dependencyLayer',
  'databaseBackup',
  'retainedReleaseFloor',
  'safetyMargin',
]);

const toNonNegativeBigInt = (value, label) => {
  invariant(
    typeof value === 'bigint' || Number.isSafeInteger(value),
    `${label} must be a bigint or safe integer`,
  );
  const converted = BigInt(value);
  invariant(converted >= 0n, `${label} must not be negative`);
  return converted;
};

const validateRequirements = (requirements, unit) => {
  const value = requireExactKeys(requirements, REQUIREMENT_KEYS, `${unit} requirements`);
  return Object.freeze(Object.fromEntries(
    REQUIREMENT_KEYS.map((key) => [
      key,
      toNonNegativeBigInt(value[key], `${unit} requirement ${key}`),
    ]),
  ));
};

const sumValues = (value) => Object.values(value).reduce((sum, item) => sum + item, 0n);

export const calculateCapacityAdmission = ({
  availableBytes,
  availableInodes,
  requiredBytes,
  requiredInodes,
}) => {
  const bytesAvailable = toNonNegativeBigInt(availableBytes, 'Available bytes');
  const inodesAvailable = toNonNegativeBigInt(availableInodes, 'Available inodes');
  const bytes = validateRequirements(requiredBytes, 'Byte');
  const inodes = validateRequirements(requiredInodes, 'Inode');
  const bytesRequired = sumValues(bytes);
  const inodesRequired = sumValues(inodes);
  const insufficientBytes = bytesAvailable < bytesRequired;
  const insufficientInodes = inodesAvailable < inodesRequired;

  return Object.freeze({
    admitted: !insufficientBytes && !insufficientInodes,
    availableBytes: bytesAvailable,
    requiredBytes: bytesRequired,
    requiredByteBreakdown: bytes,
    remainingBytes: bytesAvailable - bytesRequired,
    availableInodes: inodesAvailable,
    requiredInodes: inodesRequired,
    requiredInodeBreakdown: inodes,
    remainingInodes: inodesAvailable - inodesRequired,
    reasons: Object.freeze([
      ...(insufficientBytes ? ['INSUFFICIENT_BYTES'] : []),
      ...(insufficientInodes ? ['INSUFFICIENT_INODES'] : []),
    ]),
  });
};

export const capacityRequirements = (overrides = {}) => Object.freeze({
  incomingArchive: 0n,
  temporaryExtraction: 0n,
  candidateRelease: 0n,
  dependencyLayer: 0n,
  databaseBackup: 0n,
  retainedReleaseFloor: 0n,
  safetyMargin: 0n,
  ...overrides,
});

export const readFilesystemAvailability = async ({
  targetPath,
  statfs = nativeFs.statfs,
}) => {
  invariant(typeof targetPath === 'string' && targetPath.length > 0, 'Capacity path is required');
  invariant(typeof statfs === 'function', 'Filesystem stat function is required');
  const stats = await statfs(targetPath, { bigint: true });
  const blockSize = toNonNegativeBigInt(stats.bsize, 'Filesystem block size');
  const availableBlocks = toNonNegativeBigInt(
    stats.bavail,
    'Filesystem available blocks',
  );
  return Object.freeze({
    targetPath,
    // bavail, rather than bfree, respects blocks reserved by the filesystem.
    availableBytes: blockSize * availableBlocks,
    availableInodes: toNonNegativeBigInt(stats.ffree, 'Filesystem free inodes'),
  });
};
