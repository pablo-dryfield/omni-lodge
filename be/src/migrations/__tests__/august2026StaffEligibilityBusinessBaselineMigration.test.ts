import {
  down,
  up,
} from '../202608300006-august-2026-staff-eligibility-business-baseline.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn(async (statement: string) => {
    if (statement.includes('LOCK TABLE')) {
      return undefined;
    }
    if (
      statement.includes('FROM user_type_membership_periods')
      && statement.includes('DISTINCT ON (period.user_id)')
    ) {
      return [
        {
          period_id: '101',
          user_id: 1,
          user_type_id: 8,
          effective_start: '2026-08-30',
          user_created_date: '2026-07-01',
        },
        // An observation on the baseline start has no earlier days to fill.
        {
          period_id: '102',
          user_id: 2,
          user_type_id: 3,
          effective_start: '2026-08-01',
          user_created_date: '2026-07-01',
        },
        // Stronger history already covers this user's entire baseline window.
        {
          period_id: '103',
          user_id: 3,
          user_type_id: 8,
          effective_start: '2026-08-30',
          user_created_date: '2026-07-01',
        },
        // A user created during August must never receive pre-creation history.
        {
          period_id: '104',
          user_id: 4,
          user_type_id: 8,
          effective_start: '2026-08-30',
          user_created_date: '2026-08-20',
        },
      ];
    }
    if (statement.includes('FROM user_type_membership_periods')) {
      return [
        { user_id: 1, effective_start: '2026-07-26', effective_end: '2026-08-10' },
        { user_id: 1, effective_start: '2026-08-12', effective_end: '2026-08-20' },
        { user_id: 1, effective_start: '2026-08-25', effective_end: '2026-08-29' },
        { user_id: 1, effective_start: '2026-08-30', effective_end: null },
        { user_id: 2, effective_start: '2026-08-01', effective_end: null },
        { user_id: 3, effective_start: '2026-07-26', effective_end: '2026-08-29' },
        { user_id: 3, effective_start: '2026-08-30', effective_end: null },
        { user_id: 4, effective_start: '2026-08-30', effective_end: null },
      ];
    }
    if (
      statement.includes('FROM staff_profile_type_periods')
      && statement.includes('DISTINCT ON (period.user_id)')
    ) {
      return [
        {
          period_id: '201',
          user_id: 1,
          staff_type: 'volunteer',
          effective_start: '2026-08-30',
          profile_created_date: '2026-07-01',
        },
        {
          period_id: '202',
          user_id: 2,
          staff_type: 'long_term',
          effective_start: '2026-08-15',
          profile_created_date: '2026-08-10',
        },
      ];
    }
    if (statement.includes('FROM staff_profile_type_periods')) {
      return [
        { user_id: 1, effective_start: '2026-08-10', effective_end: '2026-08-12' },
        { user_id: 1, effective_start: '2026-08-30', effective_end: null },
        { user_id: 2, effective_start: '2026-08-15', effective_end: null },
      ];
    }
    return [];
  });
  const bulkInsert = jest.fn().mockResolvedValue(undefined);
  const bulkDelete = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
      bulkInsert,
      bulkDelete,
    } as never,
    bulkDelete,
    bulkInsert,
    query,
    transaction,
  };
};

describe('August 2026 staff eligibility business baseline migration', () => {
  it('fills only uncovered user/staff type islands and preserves stronger history', async () => {
    const { context, bulkInsert, query, transaction } = createContext();

    await up({ context });

    const userTypeInsert = bulkInsert.mock.calls.find(
      ([table]) => table === 'user_type_membership_periods',
    );
    expect(userTypeInsert?.[1]).toEqual([
      expect.objectContaining({
        user_id: 1,
        user_type_id: 8,
        effective_start: '2026-08-11',
        effective_end: '2026-08-11',
      }),
      expect.objectContaining({
        user_id: 1,
        user_type_id: 8,
        effective_start: '2026-08-21',
        effective_end: '2026-08-24',
      }),
      expect.objectContaining({
        user_id: 4,
        user_type_id: 8,
        effective_start: '2026-08-20',
        effective_end: '2026-08-29',
      }),
    ]);
    expect(userTypeInsert?.[1]).toHaveLength(3);

    const staffTypeInsert = bulkInsert.mock.calls.find(
      ([table]) => table === 'staff_profile_type_periods',
    );
    expect(staffTypeInsert?.[1]).toEqual([
      expect.objectContaining({
        user_id: 1,
        staff_type: 'volunteer',
        effective_start: '2026-08-01',
        effective_end: '2026-08-09',
      }),
      expect.objectContaining({
        user_id: 1,
        staff_type: 'volunteer',
        effective_start: '2026-08-13',
        effective_end: '2026-08-29',
      }),
      expect.objectContaining({
        user_id: 2,
        staff_type: 'long_term',
        effective_start: '2026-08-10',
        effective_end: '2026-08-14',
      }),
    ]);
    expect(staffTypeInsert?.[1]).toHaveLength(3);

    [...(userTypeInsert?.[1] ?? []), ...(staffTypeInsert?.[1] ?? [])]
      .forEach((row: Record<string, unknown>) => {
        expect(typeof row.metadata).toBe('string');
        expect(JSON.parse(String(row.metadata))).toEqual(expect.objectContaining({
          legacyExtrapolation: true,
          confidence: 'explicit_business_baseline_projection',
          businessBaseline: expect.objectContaining({
            approvedStart: '2026-08-01',
            creationDate: expect.stringMatching(/^2026-/),
            appliedStart: expect.stringMatching(/^2026-/),
            projectionSource: 'migration_current_state',
            strategy: 'fill_uncovered_gap_islands_only',
          }),
        }));
      });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('LOCK TABLE user_type_membership_periods');
    expect(sql).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(sql).toContain(`users."createdAt" AT TIME ZONE 'Europe/Warsaw'`);
    expect(sql).toContain(`profile."createdAt" AT TIME ZONE 'Europe/Warsaw'`);
    expect(sql).not.toContain('user_shift_role_membership_periods');
    expect(bulkInsert.mock.calls.some(([table]) => (
      table === 'user_shift_role_membership_periods'
    ))).toBe(false);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('deletes only migration-006 baseline rows on rollback', async () => {
    const { context, bulkDelete, transaction } = createContext();

    await down({ context });

    expect(bulkDelete).toHaveBeenNthCalledWith(
      1,
      'user_type_membership_periods',
      { source: 'migration_202608300006_user_type_business_baseline' },
      { transaction },
    );
    expect(bulkDelete).toHaveBeenNthCalledWith(
      2,
      'staff_profile_type_periods',
      { source: 'migration_202608300006_staff_type_business_baseline' },
      { transaction },
    );
    expect(bulkDelete).toHaveBeenCalledTimes(2);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back atomically if a baseline insert fails', async () => {
    const { context, bulkInsert, transaction } = createContext();
    bulkInsert
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('staff baseline insert failed'));

    await expect(up({ context })).rejects.toThrow('staff baseline insert failed');

    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });
});
