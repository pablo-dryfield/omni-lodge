#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { parseStrictCliArguments } from '../release/lib.mjs';
import {
  createHostV2ForwardRequestFileStream,
  createHostV2RollbackRequestChunks,
} from './host-protocol-client.mjs';
import { MAX_HOST_V2_EVIDENCE_BYTES } from './host/protocol-v2.mjs';

const OPERATIONS = new Set(['stage', 'dry-run', 'deploy']);
const TRIGGERS = new Set(['manual', 'automatic']);
const REQUEST_KINDS = new Set(['forward', 'forward_submit', 'rollback', 'rollback_submit']);
const SNAPSHOT_REFERENCE_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f]{64})$/;

const VALUE_OPTIONS = [
  'kind',
  'artifact-zip',
  'evidence-json',
  'request-id',
  'requested-at-utc',
  'actor',
  'operation',
  'trigger',
  'expected-active-snapshot',
  'target-snapshot',
  'output',
  'identity-output',
];

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const normalizeFilesystemPath = (value) => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const samePath = (left, right) =>
  normalizeFilesystemPath(left) === normalizeFilesystemPath(right);

const requiredCliValue = (values, name) => {
  invariant(values[name] !== undefined, `--${name} is required`);
  return values[name];
};

const parseRequestKind = (value = 'forward') => {
  invariant(REQUEST_KINDS.has(value), '--kind must be forward or rollback');
  return value === 'rollback' || value === 'rollback_submit' ? 'rollback_submit' : 'forward_submit';
};

const parseSnapshotReference = (value, label) => {
  invariant(typeof value === 'string', `${label} must be a snapshot reference`);
  const match = SNAPSHOT_REFERENCE_PATTERN.exec(value);
  invariant(match, `${label} must be formatted as activationId:snapshotSha256`);
  return Object.freeze({
    activationId: match[1],
    snapshotSha256: match[2],
  });
};

const readCanonicalEvidenceBytes = async (filePath) => {
  const resolvedPath = path.resolve(filePath);
  const pathStat = await lstat(resolvedPath);
  invariant(pathStat.isFile() && !pathStat.isSymbolicLink(), 'Canonical release evidence must be a real regular file');
  invariant(pathStat.size > 0, 'Canonical release evidence is empty');
  invariant(pathStat.size <= MAX_HOST_V2_EVIDENCE_BYTES, 'Canonical release evidence exceeds the host v2 evidence limit');
  const realPath = await realpath(resolvedPath);
  invariant(
    samePath(realPath, resolvedPath),
    'Canonical release evidence or one of its ancestors resolves through a symbolic link or junction',
  );
  return readFile(realPath);
};

const openExclusiveOutput = async (filePath, label) => {
  const resolvedPath = path.resolve(filePath);
  invariant(path.basename(resolvedPath).length > 0, `${label} path is invalid`);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY;
  const handle = await open(resolvedPath, flags, 0o600);
  return { handle, resolvedPath };
};

const writeChunksExclusive = async ({ filePath, chunks, createdPaths }) => {
  const { handle, resolvedPath } = await openExclusiveOutput(filePath, 'Host v2 request output');
  createdPaths.add(resolvedPath);
  const hash = createHash('sha256');
  let written = 0;
  try {
    for await (const chunk of chunks) {
      invariant(Buffer.isBuffer(chunk), 'Host v2 request stream emitted a non-buffer chunk');
      hash.update(chunk);
      await handle.write(chunk);
      written += chunk.length;
    }
    await handle.sync();
    return { path: resolvedPath, bytes: written, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
};

const writeTextExclusive = async ({ filePath, text, createdPaths }) => {
  const { handle, resolvedPath } = await openExclusiveOutput(filePath, 'Host v2 request identity output');
  createdPaths.add(resolvedPath);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return resolvedPath;
};

const removeCreatedPath = async (filePath) => {
  try {
    await rm(filePath, { force: true });
  } catch {
    // Best-effort cleanup only; preserve the original failure.
  }
};

export const serializeHostV2RequestCreationResult = (result) =>
  `${JSON.stringify(result, null, 2)}\n`;

export const createHostV2ForwardRequestFile = async ({
  artifactZipPath,
  evidencePath,
  requestId,
  requestedAtUtc,
  actor,
  operation,
  trigger,
  outputPath,
  identityOutputPath,
}) => {
  invariant(typeof operation === 'string' && OPERATIONS.has(operation), 'Host v2 request operation is invalid');
  invariant(typeof trigger === 'string' && TRIGGERS.has(trigger), 'Host v2 request trigger is invalid');
  const resolvedOutputPath = path.resolve(outputPath);
  const resolvedIdentityOutputPath = path.resolve(identityOutputPath);
  invariant(
    !samePath(resolvedOutputPath, resolvedIdentityOutputPath),
    'Host v2 request output and identity output must be different files',
  );

  const createdPaths = new Set();
  let request = null;
  try {
    const evidenceBytes = await readCanonicalEvidenceBytes(evidencePath);
    request = await createHostV2ForwardRequestFileStream({
      artifactZipPath,
      evidenceBytes,
      requestId,
      requestedAtUtc,
      actor,
      operation,
      trigger,
    });
    const frame = await writeChunksExclusive({
      filePath: resolvedOutputPath,
      chunks: request.chunks,
      createdPaths,
    });
    invariant(frame.bytes === request.totalLength, 'Host v2 request output length does not match the request identity');
    const result = Object.freeze({
      schemaVersion: 1,
      hostProtocolVersion: 2,
      requestIdentity: request.identity,
      requestFrameBytes: frame.bytes,
      requestFrameSha256: frame.sha256,
      artifactZipLength: request.artifactZipLength,
      artifactZipSha256: request.artifactZipSha256,
    });
    await writeTextExclusive({
      filePath: resolvedIdentityOutputPath,
      text: serializeHostV2RequestCreationResult(result),
      createdPaths,
    });
    return result;
  } catch (error) {
    await Promise.all([...createdPaths].reverse().map(removeCreatedPath));
    throw error;
  } finally {
    if (request) await request.close();
  }
};

export const createHostV2RollbackRequestFile = async ({
  requestId,
  requestedAtUtc,
  actor,
  expectedActiveSnapshot,
  targetSnapshot,
  outputPath,
  identityOutputPath,
}) => {
  const resolvedOutputPath = path.resolve(outputPath);
  const resolvedIdentityOutputPath = path.resolve(identityOutputPath);
  invariant(
    !samePath(resolvedOutputPath, resolvedIdentityOutputPath),
    'Host v2 request output and identity output must be different files',
  );

  const createdPaths = new Set();
  try {
    const request = createHostV2RollbackRequestChunks({
      requestId,
      requestedAtUtc,
      actor,
      expectedActiveSnapshot,
      targetSnapshot,
    });
    const frame = await writeChunksExclusive({
      filePath: resolvedOutputPath,
      chunks: request.chunks,
      createdPaths,
    });
    invariant(frame.bytes === request.totalLength, 'Host v2 request output length does not match the request identity');
    const result = Object.freeze({
      schemaVersion: 1,
      hostProtocolVersion: 2,
      requestIdentity: request.identity,
      requestFrameBytes: frame.bytes,
      requestFrameSha256: frame.sha256,
      artifactZipLength: 0,
      artifactZipSha256: null,
    });
    await writeTextExclusive({
      filePath: resolvedIdentityOutputPath,
      text: serializeHostV2RequestCreationResult(result),
      createdPaths,
    });
    return result;
  } catch (error) {
    await Promise.all([...createdPaths].reverse().map(removeCreatedPath));
    throw error;
  }
};

export const runCli = async (argv = process.argv.slice(2)) => {
  const { values } = parseStrictCliArguments(argv, { valueOptions: VALUE_OPTIONS });
  const kind = parseRequestKind(values.kind);
  if (kind === 'rollback_submit') {
    const result = await createHostV2RollbackRequestFile({
      requestId: requiredCliValue(values, 'request-id'),
      requestedAtUtc: requiredCliValue(values, 'requested-at-utc'),
      actor: requiredCliValue(values, 'actor'),
      expectedActiveSnapshot: parseSnapshotReference(
        requiredCliValue(values, 'expected-active-snapshot'),
        '--expected-active-snapshot',
      ),
      targetSnapshot: parseSnapshotReference(
        requiredCliValue(values, 'target-snapshot'),
        '--target-snapshot',
      ),
      outputPath: requiredCliValue(values, 'output'),
      identityOutputPath: requiredCliValue(values, 'identity-output'),
    });
    return serializeHostV2RequestCreationResult(result);
  }
  const result = await createHostV2ForwardRequestFile({
    artifactZipPath: requiredCliValue(values, 'artifact-zip'),
    evidencePath: requiredCliValue(values, 'evidence-json'),
    requestId: requiredCliValue(values, 'request-id'),
    requestedAtUtc: requiredCliValue(values, 'requested-at-utc'),
    actor: requiredCliValue(values, 'actor'),
    operation: requiredCliValue(values, 'operation'),
    trigger: requiredCliValue(values, 'trigger'),
    outputPath: requiredCliValue(values, 'output'),
    identityOutputPath: requiredCliValue(values, 'identity-output'),
  });
  return serializeHostV2RequestCreationResult(result);
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    process.stdout.write(await runCli());
  } catch (error) {
    process.stderr.write(
      `Host v2 request creation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
