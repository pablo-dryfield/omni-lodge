import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  open,
  realpath,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  HOST_REQUEST_HEADER_BYTES,
  finalizeHostRequestMetadata,
  inspectHostRequestMetadata,
  parseHostRequestHeader,
} from './protocol.mjs';
import {
  HOST_V2_REQUEST_HEADER_BYTES,
  finalizeHostV2RequestMetadata,
  inspectHostV2RequestMetadata,
  parseHostV2RequestHeader,
} from './protocol-v2.mjs';

const MAX_STREAM_COPY_BYTES = 1024 * 1024;
const MAX_CONSECUTIVE_EMPTY_CHUNKS = 1024;

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const normalizeFilesystemPath = (value) => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const sameFileIdentity = (left, right) => left.ino === right.ino
  && (process.platform === 'win32' || left.dev === right.dev);

const validateArtifactDirectory = async (directory) => {
  invariant(
    typeof directory === 'string' && directory.length > 0,
    'Host request artifact directory is required',
  );
  const resolved = path.resolve(directory);
  const pathStat = await lstat(resolved);
  invariant(
    pathStat.isDirectory() && !pathStat.isSymbolicLink(),
    'Host request artifact directory must be a real directory',
  );
  const real = await realpath(resolved);
  invariant(
    normalizeFilesystemPath(real) === normalizeFilesystemPath(resolved),
    'Host request artifact directory or one of its ancestors resolves through a symbolic link or junction',
  );
  return real;
};

const openExclusiveArtifact = async (directory) => {
  const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW || 0);
  const flags = fsConstants.O_WRONLY
    | fsConstants.O_CREAT
    | fsConstants.O_EXCL
    | noFollow;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const filePath = path.join(
      directory,
      `.omnilodge-host-request-${randomUUID()}.zip.part`,
    );
    try {
      const handle = await open(filePath, flags, 0o600);
      return { filePath, handle };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to reserve an exclusive host request artifact file');
};

const unlinkIfPresent = async (filePath) => {
  if (filePath === undefined) return;
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const writeAll = async (handle, bytes) => {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.length - offset,
      null,
    );
    invariant(bytesWritten > 0, 'Host request artifact write made no progress');
    offset += bytesWritten;
  }
};

class ExactAsyncBufferReader {
  constructor(input) {
    invariant(
      input !== null
        && input !== undefined
        && typeof input[Symbol.asyncIterator] === 'function',
      'Host request input must be an async iterable of Buffers',
    );
    this.iterator = input[Symbol.asyncIterator]();
    this.current = null;
    this.offset = 0;
    this.done = false;
  }

  async loadChunk() {
    if (this.current !== null && this.offset < this.current.length) return true;
    let emptyChunks = 0;
    while (!this.done) {
      const result = await this.iterator.next();
      invariant(
        result !== null && typeof result === 'object' && typeof result.done === 'boolean',
        'Host request input returned an invalid iterator result',
      );
      if (result.done) {
        this.done = true;
        this.current = null;
        this.offset = 0;
        return false;
      }
      invariant(Buffer.isBuffer(result.value), 'Host request input must yield Buffers');
      invariant(
        result.value.buffer instanceof ArrayBuffer,
        'Host request input must not yield shared memory',
      );
      if (result.value.length === 0) {
        emptyChunks += 1;
        invariant(
          emptyChunks <= MAX_CONSECUTIVE_EMPTY_CHUNKS,
          'Host request input yielded too many empty chunks',
        );
        continue;
      }
      this.current = result.value;
      this.offset = 0;
      return true;
    }
    return false;
  }

  async readExactly(length, label) {
    invariant(Number.isSafeInteger(length) && length >= 0, `${label} length is invalid`);
    const output = Buffer.allocUnsafe(length);
    let outputOffset = 0;
    while (outputOffset < length) {
      invariant(await this.loadChunk(), `${label} is truncated`);
      const available = this.current.length - this.offset;
      const bytesToCopy = Math.min(available, length - outputOffset);
      this.current.copy(
        output,
        outputOffset,
        this.offset,
        this.offset + bytesToCopy,
      );
      this.offset += bytesToCopy;
      outputOffset += bytesToCopy;
    }
    return output;
  }

  async consumeExactly(length, label, consume) {
    invariant(Number.isSafeInteger(length) && length >= 0, `${label} length is invalid`);
    let remaining = length;
    while (remaining > 0) {
      invariant(await this.loadChunk(), `${label} is truncated`);
      const available = this.current.length - this.offset;
      const bytesToConsume = Math.min(available, remaining, MAX_STREAM_COPY_BYTES);
      // Own each bounded piece before an asynchronous write so an upstream
      // producer cannot mutate a retained Buffer between hashing and storage.
      const owned = Buffer.from(
        this.current.subarray(this.offset, this.offset + bytesToConsume),
      );
      this.offset += bytesToConsume;
      remaining -= bytesToConsume;
      await consume(owned);
    }
  }

  async requireEof() {
    if (this.current !== null && this.offset < this.current.length) {
      throw new Error('Host request frame has trailing bytes');
    }
    if (await this.loadChunk()) throw new Error('Host request frame has trailing bytes');
  }

  async cancel() {
    if (!this.done && typeof this.iterator.return === 'function') {
      await this.iterator.return();
    }
    this.done = true;
  }
}

const createArtifactCleanup = ({ filePath, expectedStat }) => {
  let complete = false;
  return async () => {
    if (complete) return;
    let currentStat;
    try {
      currentStat = await lstat(filePath, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        complete = true;
        return;
      }
      throw error;
    }
    invariant(
      currentStat.isFile()
        && !currentStat.isSymbolicLink()
        && sameFileIdentity(currentStat, expectedStat),
      'Host request artifact changed before cleanup',
    );
    await unlink(filePath);
    complete = true;
  };
};

export const receiveHostRequestToFile = async ({ input, artifactDirectory }) => {
  const directory = await validateArtifactDirectory(artifactDirectory);
  const reader = new ExactAsyncBufferReader(input);
  let artifactHandle;
  let artifactPath;

  try {
    const headerBytes = await reader.readExactly(
      HOST_REQUEST_HEADER_BYTES,
      'Host request header',
    );
    const header = parseHostRequestHeader(headerBytes);
    const auditBytes = await reader.readExactly(
      header.auditLength,
      'Host audit request',
    );
    const evidenceBytes = await reader.readExactly(
      header.evidenceLength,
      'Canonical release evidence',
    );
    const metadata = inspectHostRequestMetadata({ auditBytes, evidenceBytes });

    const reserved = await openExclusiveArtifact(directory);
    artifactHandle = reserved.handle;
    artifactPath = reserved.filePath;
    const artifactHash = createHash('sha256');
    await reader.consumeExactly(
      header.artifactZipLength,
      'GitHub artifact ZIP',
      async (chunk) => {
        artifactHash.update(chunk);
        await writeAll(artifactHandle, chunk);
      },
    );
    await reader.requireEof();
    await artifactHandle.sync();
    const artifactStat = await artifactHandle.stat({ bigint: true });
    invariant(
      artifactStat.isFile() && artifactStat.size === BigInt(header.artifactZipLength),
      'Stored GitHub artifact ZIP length does not match its request header',
    );
    await artifactHandle.close();
    artifactHandle = undefined;

    const artifactZipSha256 = artifactHash.digest('hex');
    const identity = finalizeHostRequestMetadata({ metadata, artifactZipSha256 });
    const cleanupArtifact = createArtifactCleanup({
      filePath: artifactPath,
      expectedStat: artifactStat,
    });

    return Object.freeze({
      header,
      audit: metadata.audit,
      evidence: metadata.evidence,
      identity,
      auditBytes: Buffer.from(auditBytes),
      evidenceBytes: Buffer.from(evidenceBytes),
      artifactZipPath: artifactPath,
      artifactZipLength: header.artifactZipLength,
      cleanupArtifact,
    });
  } catch (error) {
    const cleanupErrors = [];
    try {
      await reader.cancel();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (artifactHandle !== undefined) {
      try {
        await artifactHandle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await unlinkIfPresent(artifactPath);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Host request failed and its partial artifact could not be fully cleaned up',
      );
    }
    throw error;
  }
};

// Explicit v2 entry point. It never auto-detects or reinterprets a v1 frame:
// v1 and v2 have distinct magic values, parsers, and exported receivers.
export const receiveHostV2RequestToFile = async ({ input, artifactDirectory }) => {
  const reader = new ExactAsyncBufferReader(input);
  let artifactHandle;
  let artifactPath;

  try {
    const headerBytes = await reader.readExactly(
      HOST_V2_REQUEST_HEADER_BYTES,
      'Host v2 request header',
    );
    const header = parseHostV2RequestHeader(headerBytes);
    const requestBytes = await reader.readExactly(
      header.requestLength,
      'Host v2 request',
    );
    const evidenceBytes = await reader.readExactly(
      header.evidenceLength,
      'Host v2 evidence',
    );
    const metadata = inspectHostV2RequestMetadata({
      requestBytes,
      evidenceBytes,
      artifactZipLength: header.artifactZipLength,
    });

    if (metadata.request.kind !== 'forward_submit') {
      await reader.requireEof();
      const identity = finalizeHostV2RequestMetadata({ metadata, artifactZipSha256: null });
      return Object.freeze({
        header,
        request: metadata.request,
        evidence: null,
        identity,
        requestBytes: Buffer.from(requestBytes),
        evidenceBytes: Buffer.alloc(0),
        artifactZipPath: null,
        artifactZipLength: 0,
        cleanupArtifact: async () => {},
      });
    }

    const directory = await validateArtifactDirectory(artifactDirectory);
    const reserved = await openExclusiveArtifact(directory);
    artifactHandle = reserved.handle;
    artifactPath = reserved.filePath;
    const artifactHash = createHash('sha256');
    await reader.consumeExactly(
      header.artifactZipLength,
      'Host v2 artifact ZIP',
      async (chunk) => {
        artifactHash.update(chunk);
        await writeAll(artifactHandle, chunk);
      },
    );
    await reader.requireEof();
    await artifactHandle.sync();
    const artifactStat = await artifactHandle.stat({ bigint: true });
    invariant(
      artifactStat.isFile() && artifactStat.size === BigInt(header.artifactZipLength),
      'Stored host v2 artifact ZIP length does not match its request header',
    );
    await artifactHandle.close();
    artifactHandle = undefined;
    const identity = finalizeHostV2RequestMetadata({
      metadata,
      artifactZipSha256: artifactHash.digest('hex'),
    });
    const cleanupArtifact = createArtifactCleanup({
      filePath: artifactPath,
      expectedStat: artifactStat,
    });
    return Object.freeze({
      header,
      request: metadata.request,
      evidence: metadata.evidence,
      identity,
      requestBytes: Buffer.from(requestBytes),
      evidenceBytes: Buffer.from(evidenceBytes),
      artifactZipPath: artifactPath,
      artifactZipLength: header.artifactZipLength,
      cleanupArtifact,
    });
  } catch (error) {
    const cleanupErrors = [];
    try {
      await reader.cancel();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (artifactHandle !== undefined) {
      try {
        await artifactHandle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await unlinkIfPresent(artifactPath);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Host v2 request failed and its partial artifact could not be fully cleaned up',
      );
    }
    throw error;
  }
};
