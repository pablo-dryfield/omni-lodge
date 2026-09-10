import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../models/ErrorMonitoringIssue.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ErrorMonitoringOccurrence.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ErrorMonitoringNote.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Notification.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

import {
  buildErrorFingerprint,
  captureProcessErrorSafe,
  getExpressRoutePattern,
  normalizeErrorMessage,
  prepareCaptureEventForSpool,
  redactSensitiveText,
  sanitizeCorrelationId,
  sanitizeClientEvent,
  sanitizeMonitoringJson,
  sanitizeUrlPath,
  terminateAfterBootstrapFailure,
} from '../errorMonitoringService.js';

describe('error monitoring sanitization and grouping', () => {
  it('redacts credentials and common personal identifiers before persistence', () => {
    const sanitized = redactSensitiveText(
      'Bearer abc.def.ghi contact pablo@example.com card 4111 1111 1111 1111 '
        + 'password=hunter2 https://example.test/path?reference=query-secret call +48 555 444 333 '
        + 'booking 9d2f3f4c-4a6a-4f13-8d36-9aa073dc9355 upload AbCdEfGhIjKlMnOpQrStUv123456',
    );

    expect(sanitized).not.toContain('abc.def.ghi');
    expect(sanitized).not.toContain('pablo@example.com');
    expect(sanitized).not.toContain('4111 1111 1111 1111');
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('query-secret');
    expect(sanitized).not.toContain('+48 555 444 333');
    expect(sanitized).not.toContain('9d2f3f4c-4a6a-4f13-8d36-9aa073dc9355');
    expect(sanitized).not.toContain('AbCdEfGhIjKlMnOpQrStUv123456');
  });

  it('fully redacts bank identifiers and monetary values from backend text', () => {
    const sensitiveValues = [
      'PL61109010140000071219812874',
      '12 3456 7890 1234 5678 9012 3456',
      '3,555.20',
      '1 234,56',
      '99.90',
      '815.25',
    ];
    const sanitized = redactSensitiveText(
      'IBAN PL61109010140000071219812874 bank account 12 3456 7890 1234 5678 9012 3456 '
        + 'amount=3,555.20 PLN balance: 1 234,56 zł charged €99.90 salary 815.25',
    );

    sensitiveValues.forEach((sensitive) => expect(sanitized).not.toContain(sensitive));
    expect(sanitized).toContain('[redacted-iban]');
    expect(sanitized).toContain('[redacted-bank-account]');
    expect(sanitized.match(/\[redacted-amount\]/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('redacts a sensitive value that crosses a stored-text truncation boundary', () => {
    const event = sanitizeClientEvent({
      type: 'exception',
      message: `${'x'.repeat(1_983)} pablo@example.com`,
    }, {});

    expect(event.message.length).toBeLessThanOrEqual(2_000);
    expect(event.message).not.toContain('pablo@');
    expect(event.message).toContain('[redacted-email]');
  });

  it('recursively removes sensitive object fields and handles cycles', () => {
    const source: Record<string, unknown> = {
      route: '/finance',
      password: 'do-not-store',
      customerName: 'Private Guest',
      photo: 'data:image/jpeg;base64,private',
      nested: { authorization: 'Bearer secret', safe: true },
    };
    source.self = source;

    expect(sanitizeMonitoringJson(source)).toEqual({
      route: '/finance',
      password: '[redacted]',
      customerName: '[redacted]',
      photo: '[redacted]',
      nested: { authorization: '[redacted]', safe: true },
      self: '[circular]',
    });
  });

  it('never throws while sanitizing hostile proxies or getters', () => {
    const throwingGetter: Record<string, unknown> = { safe: 'kept' };
    Object.defineProperty(throwingGetter, 'explodes', {
      enumerable: true,
      get: () => {
        throw new Error('getter must not escape');
      },
    });
    const hostileProxy = new Proxy({}, {
      ownKeys: () => {
        throw new Error('proxy must not escape');
      },
    });

    expect(() => sanitizeMonitoringJson(throwingGetter)).not.toThrow();
    expect(sanitizeMonitoringJson(throwingGetter)).toEqual({
      safe: 'kept',
      explodes: '[unreadable-value]',
    });
    expect(() => sanitizeMonitoringJson(hostileProxy)).not.toThrow();
    expect(sanitizeMonitoringJson(hostileProxy)).toEqual({ unavailable: '[unreadable-object]' });
  });

  it('stores URL paths without query strings, fragments, or origins', () => {
    expect(sanitizeUrlPath('https://omni-lodge.com/finance/transactions?token=secret#modal'))
      .toBe('/finance/transactions');
  });

  it('preserves safe request correlation ids without mistaking timestamps for phone numbers', () => {
    const requestId = '1757520000000-1';
    const clientEvent = sanitizeClientEvent({
      type: 'api_error',
      message: 'Request failed',
      requestId,
      http: { requestId },
    }, {});
    const spooledEvent = prepareCaptureEventForSpool({
      source: 'request',
      kind: 'http_500',
      level: 'error',
      message: 'Request failed',
      requestId,
    });

    expect(clientEvent.requestId).toBe(requestId);
    expect(spooledEvent.requestId).toBe(requestId);
    expect(sanitizeCorrelationId('9d2f3f4c-4a6a-4f13-8d36-9aa073dc9355')).toBe(
      '9d2f3f4c-4a6a-4f13-8d36-9aa073dc9355',
    );
    expect(sanitizeCorrelationId('eyJabcdefgh.abcdefgh.abcdefgh')).toBeNull();
    expect(sanitizeCorrelationId('4111111111111111')).toBeNull();
  });

  it('decodes and redacts sensitive path data while pseudonymizing record ids', () => {
    const path = sanitizeUrlPath(
      'https://omni-lodge.com/bookings/pablo%2540example.com/9d2f3f4c-4a6a-4f13-8d36-9aa073dc9355/12345?token=secret',
    );
    const malformed = sanitizeUrlPath('/uploads/%ZZ/private%2540example.com/AbCdEfGhIjKlMnOpQrStUv123456');

    expect(path).toBe('/bookings/[redacted-email]/:id/:id');
    expect(malformed).not.toContain('private@example.com');
    expect(malformed).not.toContain('AbCdEfGhIjKlMnOpQrStUv123456');
    expect(malformed).toContain('/:id');
  });

  it('groups dynamic ids and line numbers under a stable fingerprint', () => {
    const first = buildErrorFingerprint({
      source: 'client',
      kind: 'react_error',
      message: 'Cannot load booking 12345',
      errorName: 'TypeError',
      stack: 'TypeError\n at BookingPage (/assets/main.abc12345.js:120:9)',
      route: '/bookings/12345',
      httpMethod: null,
      httpStatus: null,
    });
    const second = buildErrorFingerprint({
      source: 'client',
      kind: 'react_error',
      message: 'Cannot load booking 98765',
      errorName: 'TypeError',
      stack: 'TypeError\n at BookingPage (/assets/main.def45678.js:999:4)',
      route: '/bookings/98765',
      httpMethod: null,
      httpStatus: null,
    });

    expect(first).toBe(second);
    expect(normalizeErrorMessage('Order 123 failed')).toBe('order <n> failed');
  });

  it('separates failed endpoints while grouping dynamic ids within one endpoint', () => {
    const base = {
      source: 'client' as const,
      kind: 'api_error',
      message: 'Request failed with status 500',
      errorName: 'HttpError',
      stack: null,
      route: '/bookings',
      httpMethod: 'GET',
      httpStatus: 500,
    };
    const firstBooking = buildErrorFingerprint({ ...base, httpUrl: '/api/bookings/123' });
    const secondBooking = buildErrorFingerprint({ ...base, httpUrl: '/api/bookings/987' });
    const staffPayment = buildErrorFingerprint({ ...base, httpUrl: '/api/staff-payments/123' });

    expect(firstBooking).toBe(secondBooking);
    expect(firstBooking).not.toBe(staffPayment);
  });

  it('groups duplicate client runtime channels for the same crash', () => {
    const base = {
      source: 'client' as const,
      message: 'Cannot read properties of null',
      stack: 'TypeError: Cannot read properties of null\n at TaskPlanner (TaskPlanner.tsx:9006:73)',
      route: '/assistant-manager-tasks',
      httpMethod: null,
      httpUrl: null,
      httpStatus: null,
    };
    const react = buildErrorFingerprint({
      ...base,
      kind: 'react_error',
      errorName: 'TypeError',
    });
    const browser = buildErrorFingerprint({
      ...base,
      kind: 'exception',
      errorName: 'TypeError',
    });
    const consoleEvent = buildErrorFingerprint({
      ...base,
      kind: 'console_error',
      errorName: 'ConsoleError',
    });
    const rejection = buildErrorFingerprint({
      ...base,
      kind: 'unhandled_rejection',
      errorName: 'UnhandledRejection',
    });

    expect(react).toBe(browser);
    expect(react).toBe(consoleEvent);
    expect(react).toBe(rejection);
  });

  it('never trusts a client-supplied identity and hashes session data later', () => {
    const event = sanitizeClientEvent({
      type: 'exception',
      message: 'Boom',
      pageUrl: 'https://omni-lodge.com/home?email=person@example.com',
      sessionId: 'private-session',
      tags: { localOccurrences: 1_500 },
      context: {
        user: { id: 999, role: 'owner' },
        currentUser: { id: 998 },
        safeDiagnostic: 'kept',
        details: {
          userId: 997,
          user_id: 995,
          authenticatedUser: { id: 996 },
          authContext: { id: 994, role: 'owner' },
          operation: 'save-booking',
        },
      },
      ...({ userId: 999 } as Record<string, unknown>),
    }, {
      userId: 42,
      userAgent: 'Test browser',
      ip: '127.0.0.1',
    });

    expect(event.userId).toBe(42);
    expect(event.pageUrl).toBe('/home');
    expect(event.sessionId).toBe('private-session');
    expect(event.occurrenceWeight).toBe(1_000);
    expect(event.context).toEqual({
      safeDiagnostic: 'kept',
      details: { operation: 'save-booking' },
    });
  });

  it('uses captured user identity only to prevent cross-account attribution', () => {
    const input = {
      type: 'exception',
      message: 'Queued browser failure',
      capturedUserId: 41,
    };

    expect(sanitizeClientEvent(input, { userId: 41 }).userId).toBe(41);
    expect(sanitizeClientEvent(input, { userId: 42 }).userId).toBeNull();
    expect(sanitizeClientEvent(input, {}).userId).toBeNull();
    expect(sanitizeClientEvent({ ...input, capturedUserId: null }, { userId: 42 }).userId).toBeNull();
    expect(sanitizeClientEvent({ ...input, capturedUserId: -1 }, { userId: 42 }).userId).toBeNull();
    expect(sanitizeClientEvent({ type: 'exception', message: 'Legacy event' }, { userId: 42 }).userId).toBe(42);
  });

  it('normalizes client environment and rejects unsafe release labels', () => {
    const base = { type: 'exception', message: 'Boom' };
    expect(sanitizeClientEvent({
      ...base,
      environment: 'PROD',
      release: 'web-2026.09.10+abc123',
    }, {})).toMatchObject({
      environment: 'production',
      release: 'web-2026.09.10+abc123',
    });
    expect(sanitizeClientEvent({
      ...base,
      environment: 'attacker-controlled-cardinality',
      release: 'release with arbitrary free text',
    }, {})).toMatchObject({ environment: 'unknown', release: null });
  });

  it('downgrades anonymous client fatal reports but preserves authenticated fatal severity', () => {
    const input = {
      type: 'exception',
      level: 'fatal',
      message: 'Browser crashed',
      tags: { localOccurrences: 1_000 },
      ...({ source: 'server' } as Record<string, unknown>),
    };

    const anonymous = sanitizeClientEvent(input, {});
    const authenticated = sanitizeClientEvent(input, { userId: 42 });
    const internal = sanitizeClientEvent(input, { trustedInternal: true });

    expect(anonymous).toMatchObject({ source: 'client', level: 'error', occurrenceWeight: 1 });
    expect(sanitizeClientEvent(input, { userId: 0 })).toMatchObject({
      source: 'client',
      level: 'error',
      occurrenceWeight: 1,
    });
    expect(authenticated).toMatchObject({ source: 'client', level: 'fatal', occurrenceWeight: 1_000 });
    expect(internal).toMatchObject({ source: 'server', level: 'fatal', occurrenceWeight: 1_000 });
  });

  it('promotes a nested failed resource path into trusted fingerprint input', () => {
    const event = sanitizeClientEvent({
      type: 'resource_error',
      message: 'Failed to load script',
      context: {
        details: { resourceUrl: 'https://omni-lodge.com/static/main.js?token=private' },
      },
    }, {});

    expect(event.httpUrl).toBe('/static/main.js');

    const cspEvent = sanitizeClientEvent({
      type: 'csp_violation',
      message: 'Content Security Policy blocked script-src',
      context: { details: { blockedUri: 'https://cdn.example.com/tracker.js?key=private' } },
    }, {});
    expect(cspEvent.httpUrl).toBe('/tracker.js');
  });

  it('uses the complete mounted Express route pattern', () => {
    const request = {
      baseUrl: '/api/bookings',
      route: { path: '/:id' },
      path: '/123',
    } as never;

    expect(getExpressRoutePattern(request)).toBe('/api/bookings/:id');
  });

  it('prepares only redacted, bounded data for the emergency disk spool', () => {
    const event = prepareCaptureEventForSpool({
      source: 'request',
      kind: 'http_500',
      level: 'error',
      message: `password=private ${'x'.repeat(3_000)}`,
      stack: 'Error: token=private\n at job (worker.ts:1:1)\nemail@example.com +48 555 444 333',
      httpUrl: '/api/orders?token=private',
      pageUrl: 'https://omni-lodge.com/bookings?guest=private',
      sessionId: 'raw-session',
      ip: '192.0.2.4',
      context: {
        body: { password: 'private' },
        customerName: 'Private Guest',
        safeCode: 'WORKER_TIMEOUT',
      },
      ...({ unexpectedPayload: 'must-not-cross-whitelist' } as Record<string, unknown>),
    });

    expect(event.clientEventId).toMatch(/^server-spool:/);
    expect(event.message).not.toContain('private');
    expect(event.message.length).toBeLessThanOrEqual(2_000);
    expect(event.stack).not.toContain('email@example.com');
    expect(event.stack).not.toContain('+48 555 444 333');
    expect(event.httpUrl).toBe('/api/orders');
    expect(event.pageUrl).toBe('/bookings');
    expect(event.sessionId).toBeNull();
    expect(event.ip).toBeNull();
    expect(event.context).toEqual({
      body: '[redacted]',
      customerName: '[redacted]',
      safeCode: 'WORKER_TIMEOUT',
    });
    expect(JSON.stringify(event)).not.toContain('must-not-cross-whitelist');
  });

  it('durably spools bootstrap failures as fatal before process termination', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'omnilodge-bootstrap-failure-'));
    const previousPath = process.env.ERROR_MONITORING_SPOOL_PATH;
    process.env.ERROR_MONITORING_SPOOL_PATH = path.join(directory, 'failed-events.ndjson');

    try {
      captureProcessErrorSafe('bootstrap_failure', new Error('Database startup exploded'));

      const spoolFiles = readdirSync(directory);
      expect(spoolFiles).toHaveLength(1);
      const line = readFileSync(path.join(directory, spoolFiles[0]), 'utf8').trim();
      const envelope = JSON.parse(line) as { event: Record<string, unknown> };
      expect(envelope.event).toMatchObject({
        source: 'process',
        kind: 'bootstrap_failure',
        level: 'fatal',
        message: 'Database startup exploded',
      });

      // Let the deliberately mocked database persistence attempt settle before
      // removing the temporary spool directory.
      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      if (previousPath === undefined) delete process.env.ERROR_MONITORING_SPOOL_PATH;
      else process.env.ERROR_MONITORING_SPOOL_PATH = previousPath;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('captures and logs a bootstrap failure before terminating nonzero', () => {
    const order: string[] = [];
    const capture = jest.fn(() => order.push('capture'));
    const beforeExit = jest.fn(() => order.push('log'));
    const exit = jest.fn((code: number) => {
      order.push(`exit:${code}`);
      throw new Error('test-exit');
    }) as unknown as (code: number) => never;

    expect(() => terminateAfterBootstrapFailure(new Error('startup failed'), {
      capture,
      beforeExit,
      exit,
    })).toThrow('test-exit');
    expect(order).toEqual(['capture', 'log', 'exit:1']);
    expect(capture).toHaveBeenCalledWith('bootstrap_failure', expect.any(Error));
  });
});
