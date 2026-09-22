#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { parseStrictCliArguments } from '../release/lib.mjs';
import { createHostV2StatusRequestFile } from './create-host-v2-request.mjs';
import { submitHostV2Request } from './submit-host-v2-request.mjs';

const VALUE_OPTIONS = [
  'subject-request-id',
  'actor',
  'host',
  'port',
  'user',
  'key',
  'known-hosts',
  'ssh-command',
  'timeout-ms',
  'poll-interval-ms',
  'deadline-ms',
];

const TERMINAL_LIFECYCLES = new Set(['succeeded', 'failed', 'rejected']);
const RETRYABLE_RESPONSE_CODES = new Set(['STATUS_NOT_FOUND', 'HOST_BUSY']);
const DEFAULT_SSH_COMMAND = 'omnilodge-deploy-v1';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_DEADLINE_MS = 20 * 60 * 1000;

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+\[\]-]{0,127}$/;

const invariant = (condition, message) => {
  if (!condition) throw new Error(message);
};

const requiredCliValue = (values, name) => {
  invariant(values[name] !== undefined, `--${name} is required`);
  return values[name];
};

const parsePositiveInteger = (value, label, { minimum, maximum }) => {
  invariant(typeof value === 'string' && /^[1-9][0-9]{0,8}$/.test(value), `${label} must be a positive integer`);
  const parsed = Number(value);
  invariant(parsed >= minimum && parsed <= maximum, `${label} must be between ${minimum} and ${maximum}`);
  return parsed;
};

const requireRequestId = (value, label) => {
  invariant(typeof value === 'string' && REQUEST_ID_PATTERN.test(value), `${label} must be a host request ID`);
  return value;
};

const requireActor = (value) => {
  invariant(typeof value === 'string' && ACTOR_PATTERN.test(value), '--actor is invalid');
  return value;
};

const sleep = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

export const serializeHostV2StatusPollResult = (result) =>
  `${JSON.stringify(result, null, 2)}\n`;

export const pollHostV2RequestStatus = async ({
  subjectRequestId,
  actor,
  host,
  port,
  user,
  keyPath,
  knownHostsPath,
  sshCommand = DEFAULT_SSH_COMMAND,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  deadlineMs = DEFAULT_DEADLINE_MS,
  now = () => new Date(),
  uuid = randomUUID,
  delay = sleep,
  createStatusRequestFile = createHostV2StatusRequestFile,
  submit = submitHostV2Request,
}) => {
  const safeSubjectRequestId = requireRequestId(subjectRequestId, '--subject-request-id');
  const safeActor = requireActor(actor);
  const startedAtUtc = now().toISOString();
  const deadlineAt = Date.now() + deadlineMs;
  const attempts = [];

  let finalStatus = null;
  let timedOut = false;
  let terminalResponse = null;

  while (Date.now() <= deadlineAt) {
    const attempt = attempts.length + 1;
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'omnilodge-host-v2-status-'));
    const requestPath = path.join(temporaryDirectory, 'host-v2-status-request.bin');
    const identityPath = path.join(temporaryDirectory, 'host-v2-status-request-identity.json');
    const statusRequestId = uuid();
    const requestedAtUtc = now().toISOString();

    try {
      await createStatusRequestFile({
        requestId: statusRequestId,
        requestedAtUtc,
        actor: safeActor,
        subjectRequestId: safeSubjectRequestId,
        outputPath: requestPath,
        identityOutputPath: identityPath,
      });
      const response = await submit({
        requestPath,
        identityPath,
        host,
        port,
        user,
        keyPath,
        knownHostsPath,
        sshCommand,
        timeoutMs,
      });
      const observedStatus = response.requestStatus ?? null;
      attempts.push(Object.freeze({
        attempt,
        statusRequestId,
        requestedAtUtc,
        responseCode: response.responseCode,
        responseStatus: response.responseStatus,
        observedStatus,
      }));

      if (response.responseCode === 'STATUS_FOUND') {
        finalStatus = observedStatus;
        if (TERMINAL_LIFECYCLES.has(finalStatus.lifecycle)) {
          terminalResponse = response;
          break;
        }
      } else if (!RETRYABLE_RESPONSE_CODES.has(response.responseCode)) {
        terminalResponse = response;
        break;
      }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      timedOut = true;
      break;
    }
    await delay(Math.min(pollIntervalMs, remainingMs));
  }

  if (!terminalResponse) timedOut = true;
  const succeeded = finalStatus?.lifecycle === 'succeeded';
  return Object.freeze({
    schemaVersion: 1,
    hostProtocolVersion: 2,
    subjectRequestId: safeSubjectRequestId,
    startedAtUtc,
    completedAtUtc: now().toISOString(),
    deadlineMs,
    pollIntervalMs,
    timedOut,
    succeeded,
    finalStatus,
    terminalResponseCode: terminalResponse?.responseCode ?? null,
    attempts,
  });
};

export const runCli = async (argv = process.argv.slice(2)) => {
  const { values } = parseStrictCliArguments(argv, { valueOptions: VALUE_OPTIONS });
  const result = await pollHostV2RequestStatus({
    subjectRequestId: requiredCliValue(values, 'subject-request-id'),
    actor: requiredCliValue(values, 'actor'),
    host: requiredCliValue(values, 'host'),
    port: requiredCliValue(values, 'port'),
    user: requiredCliValue(values, 'user'),
    keyPath: requiredCliValue(values, 'key'),
    knownHostsPath: requiredCliValue(values, 'known-hosts'),
    sshCommand: values['ssh-command'] ?? DEFAULT_SSH_COMMAND,
    timeoutMs: parsePositiveInteger(values['timeout-ms'] ?? String(DEFAULT_TIMEOUT_MS), '--timeout-ms', {
      minimum: 1000,
      maximum: 900_000,
    }),
    pollIntervalMs: parsePositiveInteger(values['poll-interval-ms'] ?? String(DEFAULT_POLL_INTERVAL_MS), '--poll-interval-ms', {
      minimum: 1000,
      maximum: 120_000,
    }),
    deadlineMs: parsePositiveInteger(values['deadline-ms'] ?? String(DEFAULT_DEADLINE_MS), '--deadline-ms', {
      minimum: 1000,
      maximum: 3_600_000,
    }),
  });
  const serialized = serializeHostV2StatusPollResult(result);
  if (!result.succeeded) process.exitCode = 1;
  return serialized;
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  try {
    process.stdout.write(await runCli());
  } catch (error) {
    process.stderr.write(
      `Host v2 request status polling failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
