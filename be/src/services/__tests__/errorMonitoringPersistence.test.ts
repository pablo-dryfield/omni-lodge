jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: {
    transaction: jest.fn(),
    query: jest.fn(),
  },
}));
jest.mock('../../models/ErrorMonitoringIssue.js', () => ({
  __esModule: true,
  default: { increment: jest.fn(), findByPk: jest.fn(), findAndCountAll: jest.fn() },
}));
jest.mock('../../models/ErrorMonitoringOccurrence.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn(), destroy: jest.fn(), findAndCountAll: jest.fn() },
}));
jest.mock('../../models/ErrorMonitoringNote.js', () => ({
  __esModule: true,
  default: { create: jest.fn(), findByPk: jest.fn(), findAll: jest.fn(), destroy: jest.fn() },
}));
jest.mock('../../models/Notification.js', () => ({
  __esModule: true,
  default: { bulkCreate: jest.fn() },
}));

import sequelize from '../../config/database.js';
import ErrorMonitoringIssue from '../../models/ErrorMonitoringIssue.js';
import ErrorMonitoringNote from '../../models/ErrorMonitoringNote.js';
import ErrorMonitoringOccurrence from '../../models/ErrorMonitoringOccurrence.js';
import {
  addErrorMonitoringNote,
  captureErrorEvent,
  captureHttpFailureSafe,
  cleanupErrorMonitoringOccurrences,
  ingestBrowserReports,
  ingestClientErrorBatch,
  listErrorMonitoringIssues,
  updateErrorMonitoringIssue,
} from '../errorMonitoringService.js';
import { API_PROCESS_STARTED_AT_MS } from '../errorMonitoringNoisePolicy.js';

const database = sequelize as unknown as {
  transaction: jest.Mock;
  query: jest.Mock;
};
const issueModel = ErrorMonitoringIssue as unknown as {
  increment: jest.Mock;
  findByPk: jest.Mock;
  findAndCountAll: jest.Mock;
};
const noteModel = ErrorMonitoringNote as unknown as {
  create: jest.Mock;
  findByPk: jest.Mock;
};
const occurrenceModel = ErrorMonitoringOccurrence as unknown as {
  findOne: jest.Mock;
  create: jest.Mock;
  destroy: jest.Mock;
};

describe('error monitoring persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    database.transaction.mockImplementation(async (callback: (transaction: object) => unknown) => callback({
      id: 'tx',
      LOCK: { UPDATE: 'UPDATE' },
    }));
    occurrenceModel.findOne.mockResolvedValue(null);
    occurrenceModel.create.mockResolvedValue({ id: 99 });
    occurrenceModel.destroy.mockResolvedValue(0);
    issueModel.increment.mockResolvedValue(undefined);
    issueModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
  });

  it('atomically upserts a fingerprint and inserts its occurrence', async () => {
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 7,
        occurrence_count: 1,
        reopened_count: 0,
        is_new: true,
        regressed: false,
      }]);

    await expect(captureErrorEvent({
      source: 'client',
      kind: 'exception',
      level: 'error',
      message: 'Example failure 123',
      clientEventId: 'client-event-1',
    })).resolves.toEqual({
      eventId: expect.any(String),
      issueId: '7',
      duplicate: false,
      isNew: true,
      regressed: false,
      reopenedCount: 0,
    });

    expect(String(database.query.mock.calls[0][0])).toContain('pg_advisory_xact_lock_shared');
    const upsertSql = String(database.query.mock.calls[1][0]);
    expect(upsertSql).toContain('ON CONFLICT (fingerprint) DO UPDATE');
    expect(upsertSql).toContain("error_monitoring_issues.status = 'resolved'");
    expect(upsertSql).toContain('EXCLUDED.last_seen_at > COALESCE');
    expect(upsertSql).toContain('resolved_at = CASE WHEN');
    expect(upsertSql).toContain('reopened_count = error_monitoring_issues.reopened_count');
    expect(upsertSql).toContain('kind = CASE');
    expect(upsertSql).toContain("WHEN 'react_error' THEN 4");
    expect(occurrenceModel.create).toHaveBeenCalledTimes(1);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it('treats a repeated client event id as idempotent without incrementing the issue', async () => {
    occurrenceModel.findOne.mockResolvedValue({ eventId: 'stored-event', issueId: 12 });

    await expect(captureErrorEvent({
      source: 'client',
      kind: 'exception',
      level: 'error',
      message: 'Retry',
      clientEventId: 'same-client-event',
    })).resolves.toEqual({
      eventId: 'stored-event',
      issueId: '12',
      duplicate: true,
      isNew: false,
      regressed: false,
      reopenedCount: 0,
    });

    expect(database.query).toHaveBeenCalledTimes(1);
    expect(String(database.query.mock.calls[0][0])).toContain('pg_advisory_xact_lock_shared');
    expect(occurrenceModel.create).not.toHaveBeenCalled();
  });

  it('does not fan out direct fatal alerts from an anonymous client capture', async () => {
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 14,
        occurrence_count: 1,
        reopened_count: 0,
        is_new: true,
        regressed: false,
      }]);

    await captureErrorEvent({
      source: 'client',
      kind: 'react_error',
      level: 'fatal',
      message: 'Anonymous fatal report',
      userId: null,
    });
    await Promise.resolve();

    expect(database.query).toHaveBeenCalledTimes(2);
  });

  it('increments affected-user count only when the issue/user pair is new', async () => {
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 8,
        occurrence_count: 2,
        reopened_count: 0,
        is_new: false,
        regressed: false,
      }])
      .mockResolvedValueOnce([{ user_id: 42 }]);

    await captureErrorEvent({
      source: 'request',
      kind: 'http_400',
      level: 'warning',
      message: 'Bad request',
      userId: 42,
    });

    expect(String(database.query.mock.calls[2][0])).toContain('ON CONFLICT (issue_id, user_id) DO NOTHING');
    expect(issueModel.increment).toHaveBeenCalledWith(
      'affectedUserCount',
      expect.objectContaining({ by: 1, where: { id: 8 } }),
    );
  });

  it('applies only the positive delta when a coalesced client event grows', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    occurrenceModel.findOne.mockResolvedValue({
      id: 91,
      eventId: 'stored-event',
      issueId: 12,
      eventCount: 2,
      occurredAt: new Date('2026-09-09T10:00:00.000Z'),
      userId: 42,
      update,
    });
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ reopened_count: 0, regressed: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    await expect(captureErrorEvent({
      source: 'client',
      kind: 'exception',
      level: 'error',
      message: 'Retry grew',
      clientEventId: 'same-client-event',
      occurrenceWeight: 5,
      occurredAt: new Date('2026-09-09T10:05:00.000Z'),
      userId: 42,
    })).resolves.toMatchObject({
      eventId: 'stored-event',
      issueId: '12',
      duplicate: true,
      regressed: false,
    });

    expect(update).toHaveBeenCalledWith({
      eventCount: 5,
      occurredAt: new Date('2026-09-09T10:05:00.000Z'),
    }, expect.objectContaining({ transaction: expect.anything() }));
    const issueUpdate = database.query.mock.calls[1];
    expect(String(issueUpdate[0])).toContain('occurrence_count = issue.occurrence_count + :weightDelta');
    expect(issueUpdate[1]).toEqual(expect.objectContaining({
      replacements: expect.objectContaining({ weightDelta: 3 }),
    }));
    expect(String(database.query.mock.calls[3][0])).toContain('first_seen_at = LEAST');
  });

  it('does not let an older arrival overwrite latest issue metadata', async () => {
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 17,
        occurrence_count: 2,
        reopened_count: 0,
        is_new: false,
        regressed: false,
      }]);

    await captureErrorEvent({
      source: 'server',
      kind: 'exception',
      level: 'error',
      message: 'Older delayed event',
      occurredAt: new Date('2026-09-09T12:00:00.000Z'),
      route: '/old-route',
    });

    const upsertSql = String(database.query.mock.calls[1][0]);
    expect(upsertSql).toContain('EXCLUDED.last_seen_at >= error_monitoring_issues.last_seen_at');
    expect(upsertSql).toMatch(/title = CASE\s+WHEN EXCLUDED\.last_seen_at >= error_monitoring_issues\.last_seen_at/);
    expect(upsertSql).toMatch(/culprit = CASE\s+WHEN EXCLUDED\.last_seen_at >= error_monitoring_issues\.last_seen_at/);
    expect(upsertSql).toContain('ELSE error_monitoring_issues.last_route END');
  });

  it('bounds culprit and fallback environment values to their database columns', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = `production-${'x'.repeat(100)}`;
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 21,
        occurrence_count: 1,
        reopened_count: 0,
        is_new: true,
        regressed: false,
      }]);

    try {
      await captureErrorEvent({
        source: 'client',
        kind: 'exception',
        level: 'error',
        message: 'Bounded metadata',
        stack: `Error: bounded\n at ${'VeryLongFunction'.repeat(60)} (worker.ts:1:1)`,
      });
      const replacements = database.query.mock.calls[1][1].replacements;
      expect(String(replacements.culprit).length).toBeLessThanOrEqual(500);
      expect(String(replacements.environment).length).toBeLessThanOrEqual(50);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  });

  it('preserves the original resolved boundary on repeated resolved saves', async () => {
    const originalResolvedAt = new Date('2026-09-09T12:00:00.000Z');
    const update = jest.fn().mockResolvedValue(undefined);
    const issue = {
      id: 19,
      status: 'resolved',
      resolvedAt: originalResolvedAt,
      severity: 'error',
      assignedToUserId: null,
      occurrenceCount: 1,
      affectedUserCount: 0,
      reopenedCount: 0,
      update,
    };
    issueModel.findByPk.mockResolvedValueOnce(issue).mockResolvedValueOnce(issue);

    await expect(updateErrorMonitoringIssue(19, { status: 'resolved' }, 7)).resolves.toBeTruthy();

    expect(update).not.toHaveBeenCalled();
    expect(issue.resolvedAt).toBe(originalResolvedAt);
    expect(issueModel.findByPk.mock.calls[0][1]).toEqual(expect.objectContaining({ lock: 'UPDATE' }));
  });

  it('redacts sensitive data from internal issue notes before persistence', async () => {
    issueModel.findByPk.mockResolvedValueOnce({ id: 4 });
    noteModel.create.mockImplementation(async (values: Record<string, unknown>) => ({ id: 88, ...values }));
    noteModel.findByPk.mockResolvedValueOnce({
      id: 88,
      body: 'investigating',
      createdAt: new Date(),
      updatedAt: new Date(),
      author: null,
    });

    await addErrorMonitoringNote(
      4,
      'token=secret-value contact pablo@example.com card 4111 1111 1111 1111',
      7,
    );

    const savedBody = String(noteModel.create.mock.calls[0][0].body);
    expect(savedBody).not.toContain('secret-value');
    expect(savedBody).not.toContain('pablo@example.com');
    expect(savedBody).not.toContain('4111 1111 1111 1111');
    expect(savedBody).toContain('[redacted]');
  });

  it('distinguishes retryable browser-report persistence failures from malformed reports', async () => {
    database.transaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(ingestBrowserReports({
      'csp-report': {
        'document-uri': 'https://omni-lodge.com/home',
        'violated-directive': 'script-src',
        'blocked-uri': 'https://blocked.example/script.js',
      },
    }, {})).resolves.toEqual({ accepted: 0, rejected: 1, retryableRejected: 1 });

    await expect(ingestBrowserReports(null, {})).resolves.toEqual({
      accepted: 0,
      rejected: 1,
      retryableRejected: 0,
    });
  });

  it('acknowledges restart-only client batches without creating monitoring records', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(ingestClientErrorBatch([{
        eventId: 'restart-noise-1',
        type: 'api_error',
        level: 'error',
        name: 'XMLHttpRequestError',
        message: 'XMLHttpRequest failed with status 502',
        occurredAt: new Date(API_PROCESS_STARTED_AT_MS).toISOString(),
        http: {
          method: 'GET',
          url: '/api/schedules/weeks',
          status: 502,
        },
      }], {})).resolves.toEqual({
        accepted: 1,
        rejected: 0,
        eventIds: [],
        errors: [],
      });

      expect(database.transaction).not.toHaveBeenCalled();
      expect(occurrenceModel.create).not.toHaveBeenCalled();
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  });

  it('acknowledges the trusted UI-server copy of an API restart failure', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(ingestClientErrorBatch([{
        eventId: 'ui-server-restart-noise-1',
        type: 'api_error',
        level: 'error',
        name: 'Error',
        message: 'connect ECONNREFUSED 127.0.0.1:3001',
        occurredAt: new Date(API_PROCESS_STARTED_AT_MS).toISOString(),
        http: {
          method: 'GET',
          url: '/api/schedules/weeks',
          status: 502,
        },
        context: { source: 'api-proxy', runtime: 'ui-server' },
      }], { trustedInternal: true })).resolves.toEqual({
        accepted: 1,
        rejected: 0,
        eventIds: [],
        errors: [],
      });

      expect(database.transaction).not.toHaveBeenCalled();
      expect(occurrenceModel.create).not.toHaveBeenCalled();
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  });

  it('suppresses deployment noise while persisting genuine errors from the same batch', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 32,
        occurrence_count: 1,
        reopened_count: 0,
        is_new: true,
        regressed: false,
      }]);

    try {
      const result = await ingestClientErrorBatch([{
        eventId: 'restart-noise-2',
        type: 'api_error',
        level: 'error',
        name: 'TypeError',
        message: 'Failed to fetch',
        occurredAt: new Date(API_PROCESS_STARTED_AT_MS).toISOString(),
        http: {
          method: 'GET',
          url: '/api/schedules/shift-instances',
        },
      }, {
        eventId: 'genuine-ui-error',
        type: 'react_error',
        level: 'error',
        name: 'TypeError',
        message: 'Cannot read properties of null',
        occurredAt: new Date(API_PROCESS_STARTED_AT_MS).toISOString(),
        route: '/assistant-manager-tasks',
      }], {});

      expect(result).toEqual({
        accepted: 2,
        rejected: 0,
        eventIds: [expect.any(String)],
        errors: [],
      });
      expect(database.transaction).toHaveBeenCalledTimes(1);
      expect(occurrenceModel.create).toHaveBeenCalledTimes(1);
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
    }
  });

  it('uses a native network report occurrence time when suppressing delayed restart noise', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    const previousPublicAppOrigin = process.env.PUBLIC_APP_ORIGIN;
    const now = jest.spyOn(Date, 'now');
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_ORIGIN = 'https://omni-lodge.com';
    now.mockReturnValue(API_PROCESS_STARTED_AT_MS + 60 * 60_000);

    try {
      await expect(ingestBrowserReports({
        type: 'network-error',
        age: 60 * 60_000,
        url: 'https://omni-lodge.com/api/schedules/weeks',
        body: { type: 'tcp.refused' },
      }, { userAgent: 'Browser', ip: '192.0.2.5' })).resolves.toEqual({
        accepted: 1,
        rejected: 0,
        retryableRejected: 0,
      });

      expect(database.transaction).not.toHaveBeenCalled();
      expect(occurrenceModel.create).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
      if (previousEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousEnvironment;
      if (previousPublicAppOrigin === undefined) delete process.env.PUBLIC_APP_ORIGIN;
      else process.env.PUBLIC_APP_ORIGIN = previousPublicAppOrigin;
    }
  });

  it('derives a stable id for a timed native browser-report retry', async () => {
    const generatedAt = Date.parse('2026-09-09T12:00:00.000Z');
    const now = jest.spyOn(Date, 'now');
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 31,
        occurrence_count: 1,
        reopened_count: 0,
        is_new: true,
        regressed: false,
      }]);
    now.mockReturnValueOnce(generatedAt);
    const reportBody = {
      effectiveDirective: 'script-src',
      blockedURL: 'https://cdn.example.test/script.js',
    };

    try {
      // A browser/server retry may send only the failed suffix of an earlier
      // batch. Position therefore cannot be part of the idempotency key.
      await expect(ingestBrowserReports([null, {
        type: 'csp-violation',
        age: 0,
        url: 'https://omni-lodge.com/home',
        body: reportBody,
      }], { userId: 42, userAgent: 'Browser', ip: '192.0.2.5' })).resolves.toMatchObject({
        accepted: 1,
        rejected: 1,
      });

      const created = occurrenceModel.create.mock.calls[0][0];
      expect(created.clientEventId).toMatch(/^browser-report:[0-9a-f]{64}$/);
      expect(created.userId).toBeNull();
      occurrenceModel.findOne.mockResolvedValueOnce({
        id: created.id ?? 1,
        eventId: created.eventId,
        issueId: created.issueId,
        clientEventId: created.clientEventId,
        eventCount: 1,
      });
      database.query.mockResolvedValueOnce(undefined);
      now.mockReturnValueOnce(generatedAt + 10_000);

      await expect(ingestBrowserReports({
        type: 'csp-violation',
        age: 10_000,
        url: 'https://omni-lodge.com/home',
        body: reportBody,
      }, { userId: 42, userAgent: 'Browser', ip: '192.0.2.5' })).resolves.toMatchObject({ accepted: 1 });

      expect(occurrenceModel.create).toHaveBeenCalledTimes(1);
      expect(occurrenceModel.findOne.mock.calls[1][0].where.clientEventId).toBe(created.clientEventId);
    } finally {
      now.mockRestore();
    }
  });

  it('groups arbitrary unmatched 404 paths without persisting response text', async () => {
    database.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{
        id: 33,
        occurrence_count: 1,
        reopened_count: 0,
        is_new: true,
        regressed: false,
      }]);
    const req = {
      method: 'GET',
      originalUrl: '/bot-probe-pablo@example.com?token=private',
      url: '/bot-probe-pablo@example.com?token=private',
      path: '/bot-probe-pablo@example.com',
      route: undefined,
      ip: '192.0.2.7',
      socket: { remoteAddress: '192.0.2.7' },
      get: jest.fn().mockReturnValue('Scanner'),
    } as never;

    captureHttpFailureSafe(req, {
      statusCode: 404,
      responseMessage: 'Guest Pablo secret response body',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const issueReplacements = database.query.mock.calls[1][1].replacements;
    expect(issueReplacements).toEqual(expect.objectContaining({
      title: 'HTTP 404 GET /__unmatched_route__',
      route: '/__unmatched_route__',
    }));
    expect(JSON.stringify(issueReplacements)).not.toContain('secret response body');
    expect(occurrenceModel.create.mock.calls[0][0]).toEqual(expect.objectContaining({
      httpUrlPath: '/__unmatched_route__',
      route: '/__unmatched_route__',
      context: { requestedPath: '/[redacted-email]' },
    }));
  });

  it('does not persist expected logged-out GET /api/session 401s', async () => {
    for (const [method, originalUrl, routePath] of [
      ['GET', '/api/session', '/session'],
      ['get', '/api/session/?fresh=true', '/session/'],
    ]) {
      const req = {
        method,
        originalUrl,
        url: originalUrl,
        headers: {},
        cookies: {},
        path: originalUrl,
        baseUrl: '/api',
        route: { path: routePath },
        ip: '192.0.2.7',
        socket: { remoteAddress: '192.0.2.7' },
        get: jest.fn().mockReturnValue('Browser'),
      } as never;

      captureHttpFailureSafe(req, { statusCode: 401 });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(database.transaction).not.toHaveBeenCalled();
    expect(occurrenceModel.create).not.toHaveBeenCalled();
  });

  it.each([
    ['POST', 401, '/api/session', '/session', {}, {}],
    ['GET', 403, '/api/session', '/session', {}, {}],
    ['GET', 401, '/api/session/profile-photo', '/session/profile-photo', {}, {}],
    ['GET', 401, '/api/session', '/session', { authorization: 'Bearer active-session' }, {}],
    ['GET', 401, '/api/session', '/session', {}, { token: 'active-session' }],
  ])(
    'persists near-miss session failures: %s %s %s',
    async (method, statusCode, originalUrl, routePath, headers, cookies) => {
      database.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{
          id: 34,
          occurrence_count: 1,
          reopened_count: 0,
          is_new: true,
          regressed: false,
        }]);
      const req = {
        method,
        originalUrl,
        url: originalUrl,
        headers,
        cookies,
        path: originalUrl,
        baseUrl: '/api',
        route: { path: routePath },
        ip: '192.0.2.7',
        socket: { remoteAddress: '192.0.2.7' },
        get: jest.fn().mockReturnValue('Browser'),
      } as never;

      captureHttpFailureSafe(req, { statusCode });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(database.transaction).toHaveBeenCalledTimes(1);
      expect(occurrenceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          httpMethod: method,
          httpStatus: statusCode,
        }),
        expect.any(Object),
      );
    },
  );

  it('sorts severity by an explicit fatal-to-info rank instead of alphabetically', async () => {
    await listErrorMonitoringIssues({ sort: 'severity', direction: 'desc' });

    const order = issueModel.findAndCountAll.mock.calls[0][0].order;
    expect(order[0][0]).toEqual(expect.objectContaining({
      val: expect.stringMatching(/fatal[\s\S]*error[\s\S]*warning[\s\S]*info/),
    }));
    expect(order[0][1]).toBe('DESC');
  });

  it('retention is cluster-locked and rebuilds affected-user projections', async () => {
    database.query
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ issue_id: 7 }, { issue_id: 8 }])
      .mockResolvedValueOnce(undefined);
    occurrenceModel.destroy.mockResolvedValueOnce(4);

    await expect(cleanupErrorMonitoringOccurrences(30)).resolves.toEqual({
      deletedOccurrences: 4,
      deletedAffectedUsers: 2,
      retentionDays: 30,
    });

    expect(String(database.query.mock.calls[0][0])).toContain('pg_try_advisory_xact_lock');
    expect(String(database.query.mock.calls[1][0])).toContain('INSERT INTO error_monitoring_affected_users');
    expect(String(database.query.mock.calls[1][0])).toContain('ON CONFLICT (issue_id, user_id) DO UPDATE');
    expect(String(database.query.mock.calls[2][0])).toContain('DELETE FROM error_monitoring_affected_users');
    expect(String(database.query.mock.calls[3][0])).toContain('affected_user_count');
    expect(String(database.query.mock.calls[3][0])).toContain('last_user_id');
  });

  it('skips cleanup when another process owns the advisory lock', async () => {
    database.query.mockResolvedValueOnce([{ acquired: false }]);

    await expect(cleanupErrorMonitoringOccurrences(30)).resolves.toEqual({
      deletedOccurrences: 0,
      deletedAffectedUsers: 0,
      retentionDays: 30,
      skipped: true,
      reason: 'cleanup_already_running',
    });
    expect(occurrenceModel.destroy).not.toHaveBeenCalled();
  });
});
