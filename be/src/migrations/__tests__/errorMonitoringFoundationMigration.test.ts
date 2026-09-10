import type { QueryInterface } from 'sequelize';

import { down, up, verify } from '../202609090001-error-monitoring-foundation.js';

const TABLE_COLUMNS: Record<string, string[]> = {
  error_monitoring_issues: [
    'fingerprint',
    'status',
    'severity',
    'occurrence_count',
    'affected_user_count',
    'last_regressed_at',
  ],
  error_monitoring_occurrences: ['event_id', 'issue_id', 'event_count', 'message', 'occurred_at', 'context_json'],
  error_monitoring_notes: ['issue_id', 'author_user_id', 'body'],
  error_monitoring_affected_users: ['issue_id', 'user_id', 'first_seen_at', 'last_seen_at'],
};

const INDEXES = [
  'error_monitoring_issues_fingerprint_key',
  'error_monitoring_issues_status_last_seen_idx',
  'error_monitoring_issues_severity_last_seen_idx',
  'error_monitoring_issues_source_kind_idx',
  'error_monitoring_issues_assignee_status_idx',
  'error_monitoring_occurrences_event_id_key',
  'error_monitoring_occurrences_issue_occurred_idx',
  'error_monitoring_occurrences_occurred_idx',
  'error_monitoring_occurrences_user_occurred_idx',
  'error_monitoring_occurrences_client_event_key',
  'error_monitoring_occurrences_request_id_idx',
  'error_monitoring_notes_issue_created_idx',
  'error_monitoring_affected_users_user_issue_idx',
];
const CONSTRAINTS = [
  ['error_monitoring_issues', 'error_monitoring_issues_source_ck'],
  ['error_monitoring_issues', 'error_monitoring_issues_severity_ck'],
  ['error_monitoring_issues', 'error_monitoring_issues_status_ck'],
  ['error_monitoring_issues', 'error_monitoring_issues_counts_ck'],
  ['error_monitoring_occurrences', 'error_monitoring_occurrences_source_ck'],
  ['error_monitoring_occurrences', 'error_monitoring_occurrences_level_ck'],
  ['error_monitoring_occurrences', 'error_monitoring_occurrences_http_status_ck'],
  ['error_monitoring_occurrences', 'error_monitoring_occurrences_duration_ck'],
  ['error_monitoring_occurrences', 'error_monitoring_occurrences_event_count_ck'],
  ['error_monitoring_notes', 'error_monitoring_notes_body_ck'],
] as const;

const setup = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn().mockResolvedValue([[], undefined]),
    },
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    addIndex: jest.fn().mockResolvedValue(undefined),
    describeTable: jest.fn(async (table: string) => Object.fromEntries(
      (TABLE_COLUMNS[table] ?? []).map((column) => [column, {}]),
    )),
  } as unknown as QueryInterface;
  return { context, transaction };
};

describe('error monitoring foundation migration', () => {
  it('creates grouped issues, occurrences, notes, affected users, and query indexes atomically', async () => {
    const { context, transaction } = setup();

    await up({ context });

    expect(context.createTable).toHaveBeenCalledTimes(4);
    const constraintSql = (context.sequelize.query as jest.Mock).mock.calls
      .slice(0, 3)
      .map(([sql]) => String(sql))
      .join('\n');
    expect(constraintSql).toContain('IF NOT EXISTS');
    expect(constraintSql).toContain('error_monitoring_issues_status_ck');
    expect(constraintSql).toContain('error_monitoring_occurrences_event_count_ck');
    expect(constraintSql).toContain('error_monitoring_notes_body_ck');
    const indexSql = (context.sequelize.query as jest.Mock).mock.calls
      .slice(3)
      .map(([sql]) => String(sql))
      .join('\n');
    expect(indexSql.match(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)).toHaveLength(INDEXES.length);
    expect(indexSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS error_monitoring_occurrences_client_event_key');
    expect(indexSql).toContain('WHERE client_event_id IS NOT NULL');
    expect((context.sequelize.query as jest.Mock).mock.calls.every(([, options]) => (
      options?.transaction === transaction
    ))).toBe(true);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back all schema work if creation fails', async () => {
    const { context, transaction } = setup();
    (context.createTable as jest.Mock).mockRejectedValueOnce(new Error('create failed'));

    await expect(up({ context })).rejects.toThrow('create failed');

    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('drops dependent tables before issue groups', async () => {
    const { context } = setup();

    await down({ context });

    expect((context.dropTable as jest.Mock).mock.calls.map(([table]) => table)).toEqual([
      'error_monitoring_affected_users',
      'error_monitoring_notes',
      'error_monitoring_occurrences',
      'error_monitoring_issues',
    ]);
  });

  it('verifies required columns and indexes', async () => {
    const { context } = setup();
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([
      INDEXES.map((indexname) => ({ indexname })),
      undefined,
    ]).mockResolvedValueOnce([
      CONSTRAINTS.map(([table_name, constraint_name]) => ({ table_name, constraint_name })),
      undefined,
    ]);

    await expect(verify({ context })).resolves.toEqual({
      ok: true,
      details: { missing: {}, missingIndexes: [], missingConstraints: [] },
    });

    (context.describeTable as jest.Mock).mockImplementation(async (table: string) => {
      const columns = table === 'error_monitoring_issues'
        ? TABLE_COLUMNS[table].filter((column) => column !== 'status')
        : TABLE_COLUMNS[table];
      return Object.fromEntries(columns.map((column) => [column, {}]));
    });
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([
      INDEXES
        .filter((indexname) => indexname !== 'error_monitoring_issues_status_last_seen_idx')
        .map((indexname) => ({ indexname })),
      undefined,
    ]).mockResolvedValueOnce([
      CONSTRAINTS
        .filter(([, constraintName]) => constraintName !== 'error_monitoring_issues_status_ck')
        .map(([table_name, constraint_name]) => ({ table_name, constraint_name })),
      undefined,
    ]);

    await expect(verify({ context })).resolves.toEqual({
      ok: false,
      details: {
        missing: { error_monitoring_issues: ['status'] },
        missingIndexes: ['error_monitoring_issues_status_last_seen_idx'],
        missingConstraints: ['error_monitoring_issues_status_ck'],
      },
    });
  });
});
