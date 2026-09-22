import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pollHostV2RequestStatus,
  serializeHostV2StatusPollResult,
} from './poll-host-v2-request-status.mjs';

const SUBJECT_REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const STATUS_REQUEST_IDS = [
  '223e4567-e89b-42d3-a456-426614174001',
  '323e4567-e89b-42d3-a456-426614174002',
];
const REQUESTED_AT_UTC = '2026-09-22T14:00:00.000Z';

const baseOptions = (overrides = {}) => ({
  subjectRequestId: SUBJECT_REQUEST_ID,
  actor: 'github-actions[bot]',
  host: '23.95.192.213',
  port: '22',
  user: 'omnilodge-deploy',
  keyPath: '/tmp/key',
  knownHostsPath: '/tmp/known_hosts',
  timeoutMs: 1000,
  pollIntervalMs: 1000,
  deadlineMs: 60_000,
  now: () => new Date(REQUESTED_AT_UTC),
  delay: async () => {},
  ...overrides,
});

test('polls until a host v2 request reaches terminal success', async () => {
  const created = [];
  const responses = [
    {
      responseCode: 'STATUS_FOUND',
      responseStatus: 'succeeded',
      requestStatus: {
        requestId: SUBJECT_REQUEST_ID,
        kind: 'forward_submit',
        lifecycle: 'running',
        phase: 'artifact_staged',
        resultCode: null,
        updatedAtUtc: REQUESTED_AT_UTC,
      },
    },
    {
      responseCode: 'STATUS_FOUND',
      responseStatus: 'succeeded',
      requestStatus: {
        requestId: SUBJECT_REQUEST_ID,
        kind: 'forward_submit',
        lifecycle: 'succeeded',
        phase: 'succeeded',
        resultCode: 'REQUEST_SUCCEEDED',
        updatedAtUtc: REQUESTED_AT_UTC,
      },
    },
  ];
  const result = await pollHostV2RequestStatus(baseOptions({
    uuid: () => STATUS_REQUEST_IDS[created.length],
    createStatusRequestFile: async (request) => {
      created.push(request);
    },
    submit: async () => responses.shift(),
  }));

  assert.equal(result.succeeded, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].statusRequestId, STATUS_REQUEST_IDS[0]);
  assert.equal(result.finalStatus.lifecycle, 'succeeded');
  assert.equal(result.terminalResponseCode, 'STATUS_FOUND');
  assert.equal(created[0].subjectRequestId, SUBJECT_REQUEST_ID);
  assert.equal(serializeHostV2StatusPollResult(result), `${JSON.stringify(result, null, 2)}\n`);
});

test('returns non-success when the terminal host v2 status is failed', async () => {
  const result = await pollHostV2RequestStatus(baseOptions({
    uuid: () => STATUS_REQUEST_IDS[0],
    createStatusRequestFile: async () => {},
    submit: async () => ({
      responseCode: 'STATUS_FOUND',
      responseStatus: 'succeeded',
      requestStatus: {
        requestId: SUBJECT_REQUEST_ID,
        kind: 'forward_submit',
        lifecycle: 'failed',
        phase: 'failed',
        resultCode: 'REQUEST_FAILED',
        updatedAtUtc: REQUESTED_AT_UTC,
      },
    }),
  }));

  assert.equal(result.succeeded, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.finalStatus.lifecycle, 'failed');
  assert.equal(result.attempts.length, 1);
});
