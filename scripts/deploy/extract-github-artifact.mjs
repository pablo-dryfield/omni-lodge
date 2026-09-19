#!/usr/bin/env node

import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createInflateRaw } from 'node:zlib';

import {
  CANONICAL_RELEASE_REF,
  CANONICAL_REPOSITORY,
  CANONICAL_WORKFLOW_PATH,
  RELEASE_LIMITS,
  parseStrictCliArguments,
} from '../release/lib.mjs';

const EVIDENCE_SCHEMA_VERSION = 2;
const OUTPUT_SCHEMA_VERSION = 2;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const DEPLOYMENT_MODES = new Set(['disabled', 'manual', 'automatic']);
const DEPLOYMENT_TRIGGERS = new Set(['manual', 'automatic']);
const RELEASE_OPERATIONS = new Set(['stage', 'dry-run', 'deploy']);
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_ZIP_BYTES = RELEASE_LIMITS.maxCompressedArchiveBytes + (64 * 1024 * 1024);
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024;
const MAX_ZIP_NAME_BYTES = 512;
const MAX_ZIP_EXTRA_BYTES = 4 * 1024;
const MAX_CHECKSUM_BYTES = 512;
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const AES_EXTRA_FIELD_ID = 0x9901;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_DATA_DESCRIPTOR_FLAG = 1 << 3;
const ZIP_UTF8_FLAG = 1 << 11;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value);

const requirePlainObject = (value, label) => {
  invariant(isPlainObject(value), `${label} must be a JSON object`);
  return value;
};

const requireExactKeys = (value, expectedKeys, label) => {
  const object = requirePlainObject(value, label);
  const actualKeys = Object.keys(object);
  invariant(
    actualKeys.length === expectedKeys.length
      && actualKeys.every((key, index) => key === expectedKeys[index]),
    `${label} schema does not match the canonical evidence schema`,
  );
  return object;
};

const requireExactText = (value, expected, label) => {
  invariant(typeof value === 'string' && value === expected, `${label} does not match`);
  return value;
};

const requirePositiveIntegerText = (value, label) => {
  invariant(
    typeof value === 'string' && POSITIVE_INTEGER_PATTERN.test(value),
    `${label} must be a positive integer string`,
  );
  invariant(BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER), `${label} exceeds the safe integer range`);
  return value;
};

const normalizeFilesystemPath = (value) => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const samePath = (left, right) => normalizeFilesystemPath(left) === normalizeFilesystemPath(right);

// Node reports different synthetic `dev` values for path- and descriptor-based
// stats on Windows, while the file ID (`ino`) remains stable.
const sameIdentity = (left, right) => left.ino === right.ino
  && (process.platform === 'win32' || left.dev === right.dev);

const toSafeSize = (value, label) => {
  invariant(value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER), `${label} is outside the safe size range`);
  return Number(value);
};

const openCanonicalRegularFile = (filePath, label, maximumBytes) => {
  const resolvedPath = path.resolve(filePath);
  invariant(existsSync(resolvedPath), `${label} does not exist`);
  const pathStat = lstatSync(resolvedPath, { bigint: true });
  invariant(!pathStat.isSymbolicLink() && pathStat.isFile(), `${label} must be a real regular file`);
  const realPath = realpathSync.native(resolvedPath);
  invariant(
    samePath(realPath, resolvedPath),
    `${label} or one of its ancestors resolves through a symbolic link or junction`,
  );
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW || 0);
  const descriptor = openSync(realPath, fsConstants.O_RDONLY | noFollow);
  try {
    const descriptorStat = fstatSync(descriptor, { bigint: true });
    invariant(descriptorStat.isFile(), `${label} descriptor is not a regular file`);
    invariant(sameIdentity(pathStat, descriptorStat), `${label} changed while it was opened`);
    const size = toSafeSize(descriptorStat.size, `${label} size`);
    invariant(size > 0, `${label} is empty`);
    invariant(size <= maximumBytes, `${label} exceeds the ${maximumBytes}-byte size limit`);
    return { descriptor, path: realPath, size, stat: descriptorStat };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
};

const readExactly = (descriptor, position, length, label) => {
  invariant(Number.isSafeInteger(position) && position >= 0, `${label} has an invalid read offset`);
  invariant(Number.isSafeInteger(length) && length >= 0, `${label} has an invalid read length`);
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = readSync(descriptor, buffer, offset, length - offset, position + offset);
    invariant(bytesRead > 0, `${label} is truncated`);
    offset += bytesRead;
  }
  return buffer;
};

const readCanonicalEvidence = (evidencePath) => {
  const opened = openCanonicalRegularFile(evidencePath, 'Canonical release evidence', MAX_EVIDENCE_BYTES);
  try {
    const bytes = readExactly(opened.descriptor, 0, opened.size, 'Canonical release evidence');
    const finalStat = fstatSync(opened.descriptor, { bigint: true });
    invariant(
      finalStat.size === opened.stat.size
        && finalStat.mtimeNs === opened.stat.mtimeNs
        && finalStat.ctimeNs === opened.stat.ctimeNs,
      'Canonical release evidence changed while it was being read',
    );
    let text;
    try {
      text = UTF8_DECODER.decode(bytes);
    } catch {
      throw new Error('Canonical release evidence is not valid UTF-8');
    }
    let evidence;
    try {
      evidence = JSON.parse(text);
    } catch {
      throw new Error('Canonical release evidence is not valid JSON');
    }
    invariant(
      text === `${JSON.stringify(evidence, null, 2)}\n`,
      'Canonical release evidence bytes are not in canonical JSON form',
    );
    return evidence;
  } finally {
    closeSync(opened.descriptor);
  }
};

const validateCanonicalEvidence = (rawEvidence) => {
  const evidence = requireExactKeys(
    rawEvidence,
    [
      'schemaVersion',
      'operation',
      'activationAuthorization',
      'release',
      'productionEvidence',
    ],
    'release evidence',
  );
  invariant(evidence.schemaVersion === EVIDENCE_SCHEMA_VERSION, 'Release evidence schema version is unsupported');

  const operation = requireExactKeys(
    evidence.operation,
    ['name', 'trigger'],
    'release evidence operation',
  );
  invariant(
    typeof operation.name === 'string' && RELEASE_OPERATIONS.has(operation.name),
    'Release evidence operation is invalid',
  );
  invariant(
    typeof operation.trigger === 'string' && DEPLOYMENT_TRIGGERS.has(operation.trigger),
    'Release evidence operation trigger is invalid',
  );

  const activationAuthorization = requireExactKeys(
    evidence.activationAuthorization,
    ['mode', 'authorized', 'reason'],
    'release evidence activationAuthorization',
  );
  invariant(
    typeof activationAuthorization.mode === 'string'
      && DEPLOYMENT_MODES.has(activationAuthorization.mode),
    'Release evidence deployment mode is invalid',
  );
  invariant(
    typeof activationAuthorization.authorized === 'boolean',
    'Release evidence activation authorization must be boolean',
  );
  invariant(
    typeof activationAuthorization.reason === 'string',
    'Release evidence activation authorization reason must be text',
  );
  if (operation.name === 'deploy') {
    invariant(
      activationAuthorization.authorized === true
        && activationAuthorization.reason === 'authorized',
      'Release evidence does not authorize production activation',
    );
    invariant(
      activationAuthorization.mode !== 'disabled',
      'Release evidence deployment mode does not authorize activation',
    );
    invariant(
      activationAuthorization.mode === 'automatic' || operation.trigger === 'manual',
      'Automatic deployment is not authorized by the release evidence mode',
    );
  } else {
    invariant(
      operation.trigger === 'manual',
      `Automatic ${operation.name} operations are not allowed`,
    );
    invariant(
      activationAuthorization.authorized === false
        && activationAuthorization.reason === 'activation_not_requested',
      'Non-activation release evidence must not authorize production activation',
    );
  }

  const release = requireExactKeys(
    evidence.release,
    [
      'releaseId',
      'sourceSha',
      'runId',
      'runAttempt',
      'artifactId',
      'artifactName',
      'artifactDigest',
    ],
    'release evidence release',
  );
  invariant(
    typeof release.sourceSha === 'string' && SOURCE_SHA_PATTERN.test(release.sourceSha),
    'Release evidence source SHA must be a full lowercase Git SHA',
  );
  const runId = requirePositiveIntegerText(release.runId, 'Release evidence run ID');
  const runAttempt = requirePositiveIntegerText(release.runAttempt, 'Release evidence run attempt');
  const artifactId = requirePositiveIntegerText(release.artifactId, 'Release evidence artifact ID');
  const expectedReleaseId = `omnilodge-r${runId}-a${runAttempt}-${release.sourceSha.slice(0, 12)}`;
  requireExactText(release.releaseId, expectedReleaseId, 'Release evidence release ID');
  requireExactText(release.artifactName, expectedReleaseId, 'Release evidence artifact name');
  invariant(
    typeof release.artifactDigest === 'string'
      && ARTIFACT_DIGEST_PATTERN.test(release.artifactDigest),
    'Release evidence artifact digest must be a lowercase SHA-256 digest',
  );

  const productionEvidence = requireExactKeys(
    evidence.productionEvidence,
    [
      'workflowConclusion',
      'artifactId',
      'artifactDigest',
      'expectedReleaseId',
      'expectedSourceSha',
      'expectedRepository',
      'expectedWorkflowPath',
      'expectedEvent',
      'expectedRef',
      'expectedRunId',
      'expectedRunAttempt',
      'expectedArtifactName',
    ],
    'release evidence productionEvidence',
  );
  const derivedProductionEvidence = {
    workflowConclusion: 'success',
    artifactId,
    artifactDigest: release.artifactDigest,
    expectedReleaseId,
    expectedSourceSha: release.sourceSha,
    expectedRepository: CANONICAL_REPOSITORY,
    expectedWorkflowPath: CANONICAL_WORKFLOW_PATH,
    expectedEvent: 'push',
    expectedRef: CANONICAL_RELEASE_REF,
    expectedRunId: runId,
    expectedRunAttempt: runAttempt,
    expectedArtifactName: expectedReleaseId,
  };
  invariant(
    JSON.stringify(productionEvidence) === JSON.stringify(derivedProductionEvidence),
    'Release evidence productionEvidence is not the exact verifier-compatible evidence derived from the release',
  );

  return Object.freeze({
    releaseId: expectedReleaseId,
    artifactDigest: release.artifactDigest,
    operation: Object.freeze({ ...operation }),
    activationAuthorization: Object.freeze({ ...activationAuthorization }),
    productionEvidence: Object.freeze({ ...derivedProductionEvidence }),
  });
};

const hashOpenFile = async (descriptor, size) => {
  const hash = createHash('sha256');
  const stream = createReadStream(null, {
    fd: descriptor,
    autoClose: false,
    start: 0,
    end: size - 1,
  });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
};

const decodeZipName = (bytes, label) => {
  invariant(bytes.length > 0 && bytes.length <= MAX_ZIP_NAME_BYTES, `${label} has an invalid length`);
  let decoded;
  try {
    decoded = UTF8_DECODER.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  invariant(Buffer.from(decoded, 'utf8').equals(bytes), `${label} is not canonically encoded UTF-8`);
  invariant(!decoded.includes('\0'), `${label} contains a null byte`);
  return decoded;
};

const validateExtraFields = (bytes, label) => {
  invariant(bytes.length <= MAX_ZIP_EXTRA_BYTES, `${label} exceeds the extra-field size limit`);
  let offset = 0;
  while (offset < bytes.length) {
    invariant(offset + 4 <= bytes.length, `${label} is malformed`);
    const id = bytes.readUInt16LE(offset);
    const size = bytes.readUInt16LE(offset + 2);
    offset += 4;
    invariant(offset + size <= bytes.length, `${label} is truncated`);
    invariant(id !== ZIP64_EXTRA_FIELD_ID, `${label} uses unsupported ZIP64 metadata`);
    invariant(id !== AES_EXTRA_FIELD_ID, `${label} uses unsupported AES metadata`);
    offset += size;
  }
};

const validateZipFlags = (flags, method, label) => {
  invariant((flags & 1) === 0, `${label} is encrypted`);
  const allowed = method === ZIP_METHOD_DEFLATE
    ? (0x0006 | ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG)
    : (ZIP_DATA_DESCRIPTOR_FLAG | ZIP_UTF8_FLAG);
  invariant((flags & ~allowed) === 0, `${label} uses unsupported general-purpose flags`);
};

const validateEntryType = ({ versionMadeBy, externalAttributes, name }, label) => {
  invariant(!name.endsWith('/'), `${label} is a directory`);
  invariant((externalAttributes & 0x10) === 0, `${label} is marked as a directory`);
  const hostSystem = versionMadeBy >>> 8;
  const unixMode = externalAttributes >>> 16;
  const fileType = unixMode & 0o170000;
  // Treat any recognizable Unix file type as authoritative even if a ZIP
  // producer incorrectly labels its host OS. We never materialize metadata,
  // but rejecting it removes cross-tool ambiguity from the trust boundary.
  invariant(
    fileType === 0 || fileType === 0o100000,
    `${label} is a link or special filesystem entry`,
  );
  if (hostSystem === 3 || hostSystem === 19) {
    invariant(fileType === 0o100000, `${label} is missing a regular-file Unix type`);
  }
};

const parseZipMetadata = (descriptor, fileSize, expectedNames) => {
  invariant(fileSize >= 22, 'GitHub artifact ZIP is too small to contain an end record');
  const endOffset = fileSize - 22;
  const end = readExactly(descriptor, endOffset, 22, 'GitHub artifact ZIP end record');
  invariant(end.readUInt32LE(0) === ZIP_END_SIGNATURE, 'GitHub artifact ZIP has trailing or missing end metadata');
  invariant(end.readUInt16LE(4) === 0 && end.readUInt16LE(6) === 0, 'Multi-disk ZIP artifacts are unsupported');
  const entriesOnDisk = end.readUInt16LE(8);
  const totalEntries = end.readUInt16LE(10);
  invariant(entriesOnDisk !== 0xffff && totalEntries !== 0xffff, 'ZIP64 entry counts are unsupported');
  invariant(entriesOnDisk === totalEntries, 'GitHub artifact ZIP has inconsistent disk entry counts');
  invariant(totalEntries === 2, 'GitHub artifact ZIP must contain exactly two entries');
  const centralSize = end.readUInt32LE(12);
  const centralOffset = end.readUInt32LE(16);
  invariant(end.readUInt16LE(20) === 0, 'GitHub artifact ZIP comments are unsupported');
  invariant(centralSize > 0 && centralSize <= MAX_CENTRAL_DIRECTORY_BYTES, 'GitHub artifact ZIP central directory is oversized');
  invariant(
    centralOffset + centralSize === endOffset,
    'GitHub artifact ZIP central directory boundaries are ambiguous',
  );
  const central = readExactly(descriptor, centralOffset, centralSize, 'GitHub artifact ZIP central directory');
  const entries = [];
  const names = new Set();
  const localOffsets = new Set();
  let cursor = 0;

  for (let index = 0; index < totalEntries; index += 1) {
    invariant(cursor + 46 <= central.length, `GitHub artifact ZIP central entry ${index} is truncated`);
    invariant(
      central.readUInt32LE(cursor) === ZIP_CENTRAL_HEADER_SIGNATURE,
      `GitHub artifact ZIP central entry ${index} has an invalid signature`,
    );
    const versionMadeBy = central.readUInt16LE(cursor + 4);
    const versionNeeded = central.readUInt16LE(cursor + 6);
    const flags = central.readUInt16LE(cursor + 8);
    const method = central.readUInt16LE(cursor + 10);
    const crc32 = central.readUInt32LE(cursor + 16);
    const compressedSize = central.readUInt32LE(cursor + 20);
    const uncompressedSize = central.readUInt32LE(cursor + 24);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const diskStart = central.readUInt16LE(cursor + 34);
    const externalAttributes = central.readUInt32LE(cursor + 38);
    const localOffset = central.readUInt32LE(cursor + 42);
    invariant(versionNeeded > 0 && versionNeeded <= 20, `GitHub artifact ZIP central entry ${index} requires an unsupported ZIP version`);
    invariant(method === ZIP_METHOD_STORE || method === ZIP_METHOD_DEFLATE, `GitHub artifact ZIP central entry ${index} uses unsupported compression`);
    validateZipFlags(flags, method, `GitHub artifact ZIP central entry ${index}`);
    invariant(nameLength > 0 && nameLength <= MAX_ZIP_NAME_BYTES, `GitHub artifact ZIP central entry ${index} has an invalid name length`);
    invariant(extraLength <= MAX_ZIP_EXTRA_BYTES, `GitHub artifact ZIP central entry ${index} has oversized extra metadata`);
    invariant(commentLength === 0, `GitHub artifact ZIP central entry ${index} has an unsupported comment`);
    invariant(diskStart === 0, `GitHub artifact ZIP central entry ${index} references another disk`);
    invariant(compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff && localOffset !== 0xffffffff, `GitHub artifact ZIP central entry ${index} uses unsupported ZIP64 values`);
    const variableEnd = cursor + 46 + nameLength + extraLength + commentLength;
    invariant(variableEnd <= central.length, `GitHub artifact ZIP central entry ${index} is truncated`);
    const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeZipName(nameBytes, `GitHub artifact ZIP central entry ${index} name`);
    const extra = central.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength);
    validateExtraFields(extra, `GitHub artifact ZIP central entry ${index} extra metadata`);
    validateEntryType({ versionMadeBy, externalAttributes, name }, `GitHub artifact ZIP entry ${name}`);
    invariant(!names.has(name), `GitHub artifact ZIP contains a duplicate entry name: ${name}`);
    invariant(!localOffsets.has(localOffset), 'GitHub artifact ZIP contains duplicate local-header offsets');
    names.add(name);
    localOffsets.add(localOffset);
    entries.push({
      name,
      nameBytes: Buffer.from(nameBytes),
      versionNeeded,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = variableEnd;
  }
  invariant(cursor === central.length, 'GitHub artifact ZIP central directory contains trailing metadata');
  invariant(
    names.size === expectedNames.size && [...names].every((name) => expectedNames.has(name)),
    'GitHub artifact ZIP entries do not exactly match the expected release archive and checksum',
  );

  const archiveName = [...expectedNames].find((name) => name.endsWith('.tar.gz'));
  const checksumName = `${archiveName}.sha256`;
  for (const entry of entries) {
    invariant(entry.compressedSize > 0, `GitHub artifact ZIP entry ${entry.name} is empty or malformed`);
    if (entry.name === archiveName) {
      invariant(entry.uncompressedSize > 0, 'Inner release archive is empty');
      invariant(
        entry.uncompressedSize <= RELEASE_LIMITS.maxCompressedArchiveBytes,
        'Inner release archive exceeds the release archive size limit',
      );
    } else {
      invariant(entry.name === checksumName, 'GitHub artifact ZIP contains an unexpected entry');
      invariant(
        entry.uncompressedSize > 0 && entry.uncompressedSize <= MAX_CHECKSUM_BYTES,
        'Inner detached checksum has an invalid size',
      );
    }
  }

  entries.sort((left, right) => left.localOffset - right.localOffset);
  invariant(entries[0].localOffset === 0, 'GitHub artifact ZIP contains data before its first local entry');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const label = `GitHub artifact ZIP local entry ${entry.name}`;
    invariant(entry.localOffset + 30 <= centralOffset, `${label} starts outside the local-data region`);
    const local = readExactly(descriptor, entry.localOffset, 30, label);
    invariant(local.readUInt32LE(0) === ZIP_LOCAL_HEADER_SIGNATURE, `${label} has an invalid signature`);
    invariant(local.readUInt16LE(4) === entry.versionNeeded, `${label} ZIP version disagrees with the central directory`);
    invariant(local.readUInt16LE(6) === entry.flags, `${label} flags disagree with the central directory`);
    invariant(local.readUInt16LE(8) === entry.method, `${label} compression disagrees with the central directory`);
    const localCrc32 = local.readUInt32LE(14);
    const localCompressedSize = local.readUInt32LE(18);
    const localUncompressedSize = local.readUInt32LE(22);
    const localNameLength = local.readUInt16LE(26);
    const localExtraLength = local.readUInt16LE(28);
    invariant(localNameLength > 0 && localNameLength <= MAX_ZIP_NAME_BYTES, `${label} has an invalid name length`);
    invariant(localExtraLength <= MAX_ZIP_EXTRA_BYTES, `${label} has oversized extra metadata`);
    const variable = readExactly(
      descriptor,
      entry.localOffset + 30,
      localNameLength + localExtraLength,
      label,
    );
    const localNameBytes = variable.subarray(0, localNameLength);
    invariant(localNameBytes.equals(entry.nameBytes), `${label} name disagrees with the central directory`);
    validateExtraFields(variable.subarray(localNameLength), `${label} extra metadata`);
    entry.dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = entry.dataOffset + entry.compressedSize;
    const boundary = index + 1 < entries.length ? entries[index + 1].localOffset : centralOffset;
    invariant(dataEnd <= boundary, `${label} compressed data overlaps another ZIP record`);
    const descriptorLength = boundary - dataEnd;
    if ((entry.flags & ZIP_DATA_DESCRIPTOR_FLAG) === 0) {
      invariant(descriptorLength === 0, `${label} has ambiguous trailing local data`);
      invariant(localCrc32 === entry.crc32, `${label} CRC disagrees with the central directory`);
      invariant(localCompressedSize === entry.compressedSize, `${label} compressed size disagrees with the central directory`);
      invariant(localUncompressedSize === entry.uncompressedSize, `${label} uncompressed size disagrees with the central directory`);
    } else {
      invariant(
        (localCrc32 === 0 || localCrc32 === entry.crc32)
          && (localCompressedSize === 0 || localCompressedSize === entry.compressedSize)
          && (localUncompressedSize === 0 || localUncompressedSize === entry.uncompressedSize),
        `${label} placeholder metadata disagrees with the central directory`,
      );
      invariant(descriptorLength === 12 || descriptorLength === 16, `${label} has an invalid data descriptor length`);
      const dataDescriptor = readExactly(descriptor, dataEnd, descriptorLength, `${label} data descriptor`);
      const valueOffset = descriptorLength === 16 ? 4 : 0;
      if (descriptorLength === 16) {
        invariant(dataDescriptor.readUInt32LE(0) === ZIP_DATA_DESCRIPTOR_SIGNATURE, `${label} has an invalid data descriptor signature`);
      }
      invariant(dataDescriptor.readUInt32LE(valueOffset) === entry.crc32, `${label} data descriptor CRC does not match`);
      invariant(dataDescriptor.readUInt32LE(valueOffset + 4) === entry.compressedSize, `${label} data descriptor compressed size does not match`);
      invariant(dataDescriptor.readUInt32LE(valueOffset + 8) === entry.uncompressedSize, `${label} data descriptor uncompressed size does not match`);
    }
  }
  return entries;
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const updateCrc32 = (current, bytes) => {
  let value = current;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
};

class VerifiedFileSink extends Writable {
  constructor({ descriptor, expectedSize, calculateSha256 }) {
    super();
    this.descriptor = descriptor;
    this.expectedSize = expectedSize;
    this.size = 0;
    this.crc = 0xffffffff;
    this.hash = calculateSha256 ? createHash('sha256') : null;
  }

  _write(chunk, _encoding, callback) {
    try {
      invariant(this.size + chunk.length <= this.expectedSize, 'ZIP entry expands beyond its declared size');
      let offset = 0;
      while (offset < chunk.length) {
        const written = writeSync(this.descriptor, chunk, offset, chunk.length - offset);
        invariant(written > 0, 'Unable to write extracted ZIP entry');
        offset += written;
      }
      this.size += chunk.length;
      this.crc = updateCrc32(this.crc, chunk);
      if (this.hash) this.hash.update(chunk);
      callback();
    } catch (error) {
      callback(error);
    }
  }

  result() {
    return {
      size: this.size,
      crc32: (this.crc ^ 0xffffffff) >>> 0,
      sha256: this.hash ? this.hash.digest('hex') : null,
    };
  }
}

const writeEntry = async ({ zipDescriptor, zipPath, entry, outputPath, calculateSha256 }) => {
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW || 0);
  const outputDescriptor = openSync(
    outputPath,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollow,
    0o600,
  );
  try {
    const outputStat = fstatSync(outputDescriptor, { bigint: true });
    invariant(outputStat.isFile() && outputStat.nlink === 1n, `Extraction target is not a new regular file: ${entry.name}`);
    const source = createReadStream(null, {
      fd: zipDescriptor,
      autoClose: false,
      start: entry.dataOffset,
      end: entry.dataOffset + entry.compressedSize - 1,
    });
    const sink = new VerifiedFileSink({
      descriptor: outputDescriptor,
      expectedSize: entry.uncompressedSize,
      calculateSha256,
    });
    let inflater = null;
    if (entry.method === ZIP_METHOD_DEFLATE) {
      inflater = createInflateRaw();
      await pipeline(source, inflater, sink);
      invariant(
        inflater.bytesWritten === entry.compressedSize,
        `Compressed ZIP entry contains trailing data: ${entry.name}`,
      );
    } else {
      await pipeline(source, sink);
    }
    const result = sink.result();
    invariant(result.size === entry.uncompressedSize, `ZIP entry size does not match metadata: ${entry.name}`);
    invariant(result.crc32 === entry.crc32, `ZIP entry CRC does not match metadata: ${entry.name}`);
    fchmodSync(outputDescriptor, 0o600);
    fsyncSync(outputDescriptor);
    const pathStat = lstatSync(outputPath, { bigint: true });
    invariant(
      !pathStat.isSymbolicLink() && pathStat.isFile() && sameIdentity(pathStat, outputStat),
      `Extracted ZIP entry changed during publication: ${entry.name}`,
    );
    return result;
  } catch (error) {
    throw new Error(`Unable to extract ${entry.name} from ${zipPath}: ${error.message}`);
  } finally {
    closeSync(outputDescriptor);
  }
};

const inspectStagingParent = (stagingDirectory) => {
  const resolved = path.resolve(stagingDirectory);
  invariant(!existsSync(resolved), `Staging directory already exists: ${resolved}`);
  const parent = path.dirname(resolved);
  invariant(existsSync(parent), `Staging directory parent does not exist: ${parent}`);
  const parentStat = lstatSync(parent, { bigint: true });
  invariant(!parentStat.isSymbolicLink() && parentStat.isDirectory(), 'Staging directory parent must be a real directory');
  const realParent = realpathSync.native(parent);
  invariant(samePath(parent, realParent), 'Staging directory parent or one of its ancestors resolves through a symbolic link or junction');
  if (typeof process.getuid === 'function') {
    invariant(
      parentStat.uid === BigInt(process.getuid()),
      'Staging directory parent must be owned by the extraction process user',
    );
    invariant(
      (Number(parentStat.mode) & 0o022) === 0,
      'Staging directory parent cannot be group- or world-writable',
    );
  }
  return {
    path: resolved,
    parent: realParent,
    parentIdentity: { dev: parentStat.dev, ino: parentStat.ino },
  };
};

const assertStagingParentStable = ({ parent, parentIdentity }) => {
  const current = lstatSync(parent, { bigint: true });
  invariant(
    !current.isSymbolicLink()
      && current.isDirectory()
      && sameIdentity(current, parentIdentity)
      && samePath(realpathSync.native(parent), parent),
    'Staging directory parent changed during extraction',
  );
};

const fsyncDirectory = (directoryPath) => {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directoryPath, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY || 0));
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const extractGitHubArtifact = async ({
  artifactZipPath,
  evidencePath,
  stagingDirectory,
}) => {
  invariant(typeof artifactZipPath === 'string' && artifactZipPath.length > 0, 'artifactZipPath is required');
  invariant(typeof evidencePath === 'string' && evidencePath.length > 0, 'evidencePath is required');
  invariant(typeof stagingDirectory === 'string' && stagingDirectory.length > 0, 'stagingDirectory is required');

  const canonicalEvidence = validateCanonicalEvidence(readCanonicalEvidence(evidencePath));
  const expectedArchiveName = `${canonicalEvidence.releaseId}.tar.gz`;
  const expectedChecksumName = `${expectedArchiveName}.sha256`;
  const expectedNames = new Set([expectedArchiveName, expectedChecksumName]);
  const openedZip = openCanonicalRegularFile(
    artifactZipPath,
    'GitHub artifact ZIP',
    MAX_ARTIFACT_ZIP_BYTES,
  );
  let stagingCreated = false;
  let createdStagingIdentity = null;
  let resolvedStaging;
  try {
    const initialZipHash = await hashOpenFile(openedZip.descriptor, openedZip.size);
    const expectedDigest = `sha256:${initialZipHash}`;
    invariant(
      canonicalEvidence.artifactDigest === expectedDigest,
      'GitHub artifact ZIP SHA-256 does not match the authenticated artifact digest',
    );
    const entries = parseZipMetadata(openedZip.descriptor, openedZip.size, expectedNames);
    const stagingRoot = inspectStagingParent(stagingDirectory);
    resolvedStaging = stagingRoot.path;
    assertStagingParentStable(stagingRoot);
    mkdirSync(resolvedStaging, { mode: 0o700 });
    assertStagingParentStable(stagingRoot);
    stagingCreated = true;
    createdStagingIdentity = lstatSync(resolvedStaging, { bigint: true });
    invariant(
      createdStagingIdentity.isDirectory() && !createdStagingIdentity.isSymbolicLink(),
      'New staging path is not a real directory',
    );
    invariant(samePath(realpathSync.native(resolvedStaging), resolvedStaging), 'New staging directory resolves through a symbolic link or junction');

    let archiveSha256 = null;
    for (const entry of entries) {
      const outputPath = path.join(resolvedStaging, entry.name);
      const result = await writeEntry({
        zipDescriptor: openedZip.descriptor,
        zipPath: openedZip.path,
        entry,
        outputPath,
        calculateSha256: entry.name === expectedArchiveName,
      });
      if (entry.name === expectedArchiveName) archiveSha256 = result.sha256;
    }

    const finalZipHash = await hashOpenFile(openedZip.descriptor, openedZip.size);
    invariant(finalZipHash === initialZipHash, 'GitHub artifact ZIP changed while it was being verified');
    const finalZipStat = fstatSync(openedZip.descriptor, { bigint: true });
    invariant(
      finalZipStat.size === openedZip.stat.size
        && finalZipStat.mtimeNs === openedZip.stat.mtimeNs
        && finalZipStat.ctimeNs === openedZip.stat.ctimeNs,
      'GitHub artifact ZIP metadata changed while it was being verified',
    );

    invariant(typeof archiveSha256 === 'string' && SHA256_PATTERN.test(archiveSha256), 'Inner release archive hash was not calculated');
    const checksumPath = path.join(resolvedStaging, expectedChecksumName);
    const checksumText = readFileSync(checksumPath, 'utf8');
    const checksumPattern = new RegExp(`^([0-9a-f]{64})  ${escapeRegExp(expectedArchiveName)}\\n$`);
    const checksumMatch = checksumPattern.exec(checksumText);
    invariant(checksumMatch, 'Inner detached checksum is not in canonical form');
    invariant(checksumMatch[1] === archiveSha256, 'Inner detached checksum does not match the release archive');

    const currentStagingIdentity = lstatSync(resolvedStaging, { bigint: true });
    invariant(
      currentStagingIdentity.isDirectory()
        && !currentStagingIdentity.isSymbolicLink()
        && sameIdentity(currentStagingIdentity, createdStagingIdentity),
      'Staging directory changed while the artifact was being extracted',
    );
    fsyncDirectory(resolvedStaging);
    assertStagingParentStable(stagingRoot);
    fsyncDirectory(stagingRoot.parent);
    assertStagingParentStable(stagingRoot);

    return Object.freeze({
      schemaVersion: OUTPUT_SCHEMA_VERSION,
      releaseId: canonicalEvidence.releaseId,
      artifactZipSha256: initialZipHash,
      archiveSha256,
      archivePath: path.join(resolvedStaging, expectedArchiveName),
      checksumPath,
      operation: canonicalEvidence.operation,
      activationAuthorization: canonicalEvidence.activationAuthorization,
      productionEvidence: canonicalEvidence.productionEvidence,
    });
  } catch (error) {
    if (!stagingCreated || !resolvedStaging) throw error;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Staging residue was preserved at ${resolvedStaging} for operator inspection and trusted cleanup.`,
      { cause: error },
    );
  } finally {
    closeSync(openedZip.descriptor);
  }
};

export const serializeExtractionResult = (result) => `${JSON.stringify(result, null, 2)}\n`;

const VALUE_OPTIONS = ['artifact-zip', 'evidence-json', 'staging-dir'];

const requiredCliValue = (values, name) => {
  invariant(values[name] !== undefined, `--${name} is required`);
  return values[name];
};

export const runCli = async (argv = process.argv.slice(2)) => {
  const { values } = parseStrictCliArguments(argv, { valueOptions: VALUE_OPTIONS });
  const result = await extractGitHubArtifact({
    artifactZipPath: requiredCliValue(values, 'artifact-zip'),
    evidencePath: requiredCliValue(values, 'evidence-json'),
    stagingDirectory: requiredCliValue(values, 'staging-dir'),
  });
  return serializeExtractionResult(result);
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    process.stdout.write(await runCli());
  } catch (error) {
    process.stderr.write(
      `GitHub artifact extraction failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
