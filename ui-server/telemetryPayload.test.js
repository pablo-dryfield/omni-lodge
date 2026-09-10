import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pruneUiServerTelemetryQueueToBytes,
  safeUiServerRead,
  safeUiServerRequestPath,
  sanitizeUiServerContext,
  sanitizeUiServerCorrelationId,
  sanitizeUiServerRelease,
  sanitizeUiServerText,
  uiServerTelemetryByteLength,
} from './telemetryPayload.js';

test('redacts nested encoding and finance identifiers from private-spool paths', () => {
  assert.equal(
    safeUiServerRequestPath('/customer/jamie%252540example.com/orders'),
    '/customer/[redacted]/orders',
  );
  assert.equal(
    safeUiServerRequestPath('/bank/PL61%201090%201014%200000%200712%201981%202874'),
    '/bank/[redacted]',
  );
  assert.equal(
    safeUiServerRequestPath('/token/eyJabcdefghijk%252Eabcdefghijk%252Eabcdefghijk'),
    '/token/[redacted]',
  );
});

test('sanitizers and safe reads do not throw on hostile values', () => {
  const hostile = new Proxy({}, {
    get: () => { throw new Error('getter failed'); },
    ownKeys: () => { throw new Error('keys failed'); },
  });
  const hostileString = { toString: () => { throw new Error('string failed'); } };

  assert.doesNotThrow(() => sanitizeUiServerText(hostileString));
  assert.doesNotThrow(() => sanitizeUiServerContext(hostile));
  assert.equal(safeUiServerRead(hostile, 'message'), undefined);
  assert.match(sanitizeUiServerText(hostileString), /unavailable/);
});

test('redacts sensitive correlation IDs before applying the allowlist', () => {
  assert.equal(sanitizeUiServerCorrelationId('4111111111111111'), '[redacted-number]');
  assert.equal(
    sanitizeUiServerCorrelationId('1234567890123456789012345678901234'),
    '[redacted-number]',
  );
  assert.equal(sanitizeUiServerCorrelationId('request-123'), 'request-123');
});

test('preserves dated release tokens while rejecting unsafe release values', () => {
  const release = 'omnilodge-2026-09-10-error-monitoring-r1.5';
  const jwt = 'eyJabcdefghijk.abcdefghijk.abcdefghijk';

  assert.equal(sanitizeUiServerRelease(release), release);
  assert.equal(sanitizeUiServerRelease('release with arbitrary free text'), null);
  assert.equal(sanitizeUiServerRelease(jwt), null);
  assert.equal(sanitizeUiServerRelease('4111111111111111'), null);
});

test('enforces the spool limit in UTF-8 bytes and preserves fatal events first', () => {
  const queue = [
    { eventId: 'fatal-1', level: 'fatal', message: '☃'.repeat(80) },
    { eventId: 'warning-1', level: 'warning', message: '☃'.repeat(80) },
    { eventId: 'fatal-2', level: 'fatal', message: '☃'.repeat(80) },
  ];
  const characterLength = JSON.stringify(queue).length;
  const byteLength = uiServerTelemetryByteLength(queue);
  assert.ok(byteLength > characterLength);

  const result = pruneUiServerTelemetryQueueToBytes(queue, byteLength - 100);
  assert.ok(result.bytes <= byteLength - 100);
  assert.deepEqual(queue.map((event) => event.eventId), ['fatal-1', 'fatal-2']);
  assert.equal(result.dropped, 1);
});

test('compacts an individually oversized fatal event instead of writing an oversized spool', () => {
  const queue = [{
    eventId: 'fatal-large',
    type: 'exception',
    level: 'fatal',
    name: 'LargeFailure',
    message: 'x'.repeat(5_000),
    stack: 'y'.repeat(5_000),
  }];

  const result = pruneUiServerTelemetryQueueToBytes(queue, 1_000);
  assert.ok(result.bytes <= 1_000);
  assert.equal(queue[0].level, 'fatal');
  assert.equal(queue[0].context.payloadTruncated, true);
  assert.equal(queue[0].stack, undefined);
});
