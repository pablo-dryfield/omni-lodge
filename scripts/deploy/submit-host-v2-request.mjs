#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { parseStrictCliArguments } from '../release/lib.mjs';
import { validateHostV2ProtocolResponse } from './host-protocol-client.mjs';
import {
  HOST_V2_RESPONSE_HEADER_BYTES,
  MAX_HOST_V2_RESPONSE_BYTES,
  validateHostV2RequestIdentity,
} from './host/protocol-v2.mjs';

const VALUE_OPTIONS = [
  'request',
  'identity',
  'host',
  'port',
  'user',
  'key',
  'known-hosts',
  'ssh-command',
  'timeout-ms',
];

const DEFAULT_SSH_COMMAND = 'omnilodge-deploy-v1';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDERR_BYTES = 16 * 1024;
const MAX_RESPONSE_FRAME_BYTES = HOST_V2_RESPONSE_HEADER_BYTES + MAX_HOST_V2_RESPONSE_BYTES;
const HOST_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const normalizeFilesystemPath = (value) => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const requiredCliValue = (values, name) => {
  invariant(values[name] !== undefined, `--${name} is required`);
  return values[name];
};

const requireSafeText = (value, pattern, label) => {
  invariant(typeof value === 'string' && pattern.test(value), `${label} is invalid`);
  return value;
};

const parsePort = (value) => {
  invariant(typeof value === 'string' && /^[1-9][0-9]{0,4}$/.test(value), '--port must be a TCP port');
  const port = Number(value);
  invariant(port >= 1 && port <= 65535, '--port must be between 1 and 65535');
  return String(port);
};

const parseTimeoutMs = (value = String(DEFAULT_TIMEOUT_MS)) => {
  invariant(typeof value === 'string' && /^[1-9][0-9]{0,8}$/.test(value), '--timeout-ms must be a positive integer');
  const timeoutMs = Number(value);
  invariant(timeoutMs >= 1000 && timeoutMs <= 900_000, '--timeout-ms must be between 1000 and 900000');
  return timeoutMs;
};

const requireRealRegularFile = async (filePath, label) => {
  invariant(typeof filePath === 'string' && filePath.length > 0, `${label} path is required`);
  const resolvedPath = path.resolve(filePath);
  const pathStat = await lstat(resolvedPath);
  invariant(pathStat.isFile() && !pathStat.isSymbolicLink(), `${label} must be a real regular file`);
  const realPath = await realpath(resolvedPath);
  invariant(
    normalizeFilesystemPath(realPath) === normalizeFilesystemPath(resolvedPath),
    `${label} or one of its ancestors resolves through a symbolic link or junction`,
  );
  invariant(pathStat.size > 0, `${label} is empty`);
  return { path: realPath, size: pathStat.size };
};

const loadRequestIdentity = async (identityPath) => {
  const file = await requireRealRegularFile(identityPath, 'Host v2 request identity');
  invariant(file.size <= 64 * 1024, 'Host v2 request identity is too large');
  const parsed = JSON.parse(await readFile(file.path, 'utf8'));
  invariant(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'Host v2 request identity must be a JSON object');
  invariant(parsed.hostProtocolVersion === 2, 'Host v2 request identity has an unsupported protocol version');
  invariant(parsed.requestIdentity !== null && typeof parsed.requestIdentity === 'object', 'Host v2 request identity is missing');
  return {
    creationResult: parsed,
    requestIdentity: validateHostV2RequestIdentity(parsed.requestIdentity),
  };
};

export const buildSshArguments = ({
  keyPath,
  knownHostsPath,
  port,
  user,
  host,
  sshCommand = DEFAULT_SSH_COMMAND,
}) => [
  '-i',
  keyPath,
  '-p',
  port,
  '-o',
  'BatchMode=yes',
  '-o',
  'IdentitiesOnly=yes',
  '-o',
  'PasswordAuthentication=no',
  '-o',
  'KbdInteractiveAuthentication=no',
  '-o',
  'PreferredAuthentications=publickey',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  `UserKnownHostsFile=${knownHostsPath}`,
  '-o',
  'LogLevel=ERROR',
  `${user}@${host}`,
  sshCommand,
];

const readBoundedOutput = ({ stream, maximumBytes, label, kill }) => new Promise((resolve, reject) => {
  const chunks = [];
  let total = 0;
  stream.on('data', (chunk) => {
    total += chunk.length;
    if (total > maximumBytes) {
      kill();
      reject(new Error(`${label} exceeded the maximum size`));
      return;
    }
    chunks.push(chunk);
  });
  stream.on('error', reject);
  stream.on('end', () => resolve(Buffer.concat(chunks)));
});

const writeRequestToChild = ({ requestPath, child }) => new Promise((resolve, reject) => {
  const requestStream = createReadStream(requestPath);
  requestStream.on('error', reject);
  child.stdin.on('error', reject);
  child.stdin.on('finish', resolve);
  requestStream.pipe(child.stdin);
});

const redactStderr = (stderr) => {
  const text = stderr.toString('utf8').replace(/[^\t\n\r -~]/g, '?').trim();
  if (text.length === 0) return '';
  return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
};

export const submitHostV2Request = async ({
  requestPath,
  identityPath,
  host,
  port,
  user,
  keyPath,
  knownHostsPath,
  sshCommand = DEFAULT_SSH_COMMAND,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnCommand = spawn,
}) => {
  const requestFile = await requireRealRegularFile(requestPath, 'Host v2 request frame');
  const keyFile = await requireRealRegularFile(keyPath, 'SSH private key');
  const knownHostsFile = await requireRealRegularFile(knownHostsPath, 'SSH known_hosts');
  const { creationResult, requestIdentity } = await loadRequestIdentity(identityPath);
  invariant(creationResult.requestFrameBytes === requestFile.size, 'Host v2 request frame size does not match identity');

  const safeHost = requireSafeText(host, HOST_PATTERN, '--host');
  const safeUser = requireSafeText(user, USER_PATTERN, '--user');
  const safeCommand = requireSafeText(sshCommand, COMMAND_PATTERN, '--ssh-command');
  const safePort = parsePort(String(port));
  const safeTimeoutMs = parseTimeoutMs(String(timeoutMs));

  const child = spawnCommand('ssh', buildSshArguments({
    keyPath: keyFile.path,
    knownHostsPath: knownHostsFile.path,
    port: safePort,
    user: safeUser,
    host: safeHost,
    sshCommand: safeCommand,
  }), {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let timedOut = false;
  const kill = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    kill();
  }, safeTimeoutMs);

  const exitPromise = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  });

  try {
    const [stdout, stderr, exit] = await Promise.all([
      readBoundedOutput({
        stream: child.stdout,
        maximumBytes: MAX_RESPONSE_FRAME_BYTES,
        label: 'Host v2 response',
        kill,
      }),
      readBoundedOutput({
        stream: child.stderr,
        maximumBytes: MAX_STDERR_BYTES,
        label: 'Host stderr',
        kill,
      }),
      exitPromise,
      writeRequestToChild({ requestPath: requestFile.path, child }),
    ]);
    if (timedOut) throw new Error('Host v2 request submission timed out');
    if (exit.code !== 0) {
      const stderrText = redactStderr(stderr);
      throw new Error(`Host v2 SSH command failed with exit ${exit.code ?? `signal ${exit.signal}`}${stderrText ? `: ${stderrText}` : ''}`);
    }
    const response = validateHostV2ProtocolResponse({
      responseFrame: stdout,
      requestIdentity,
    });
    return Object.freeze({
      schemaVersion: 1,
      hostProtocolVersion: 2,
      requestId: response.requestId,
      requestKind: response.kind,
      responseCode: response.code,
      responseStatus: response.status,
      responseMessage: response.message,
      releaseId: requestIdentity.releaseId ?? null,
      operation: requestIdentity.operation ?? null,
      trigger: requestIdentity.trigger ?? null,
      responseReceived: true,
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const serializeHostV2SubmitResult = (result) =>
  `${JSON.stringify(result, null, 2)}\n`;

export const runCli = async (argv = process.argv.slice(2)) => {
  const { values } = parseStrictCliArguments(argv, { valueOptions: VALUE_OPTIONS });
  const result = await submitHostV2Request({
    requestPath: requiredCliValue(values, 'request'),
    identityPath: requiredCliValue(values, 'identity'),
    host: requiredCliValue(values, 'host'),
    port: requiredCliValue(values, 'port'),
    user: requiredCliValue(values, 'user'),
    keyPath: requiredCliValue(values, 'key'),
    knownHostsPath: requiredCliValue(values, 'known-hosts'),
    sshCommand: values['ssh-command'] ?? DEFAULT_SSH_COMMAND,
    timeoutMs: values['timeout-ms'] ?? String(DEFAULT_TIMEOUT_MS),
  });
  return serializeHostV2SubmitResult(result);
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    process.stdout.write(await runCli());
  } catch (error) {
    process.stderr.write(
      `Host v2 request submission failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
