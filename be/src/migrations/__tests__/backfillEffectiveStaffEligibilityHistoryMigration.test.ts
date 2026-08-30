import {
  down,
  up,
} from '../202608300005-backfill-effective-staff-eligibility-history.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn(async (statement: string) => {
    if (statement.includes('MIN(effective_start)')) {
      return [{ observation_date: '2026-08-30' }];
    }
    if (statement.includes('FROM user_type_membership_periods')) {
      return [{ user_id: 28, user_type_id: 8, effective_start: '2026-08-30' }];
    }
    if (statement.includes('FROM "userTypes"')) {
      return [{ id: 3 }, { id: 8 }];
    }
    if (statement.includes('FROM audit_logs AS audit')) {
      return [
        {
          user_id: 28,
          event_date: '2026-07-26',
          previous_user_type_id: '8',
          next_user_type_id: '3',
          actor_id: 1,
          audit_id: '4857',
        },
        {
          user_id: 28,
          event_date: '2026-08-24',
          previous_user_type_id: '3',
          next_user_type_id: '8',
          actor_id: 1,
          audit_id: '5659',
        },
        {
          user_id: 28,
          event_date: '2026-08-25',
          previous_user_type_id: '8',
          next_user_type_id: '3',
          actor_id: 1,
          audit_id: '5673',
        },
        {
          user_id: 28,
          event_date: '2026-08-30',
          previous_user_type_id: '3',
          next_user_type_id: '8',
          actor_id: 1,
          audit_id: '5691',
        },
      ];
    }
    if (statement.includes('FROM shift_assignments AS sa')) {
      return [
        { user_id: 28, shift_role_id: 1, evidence_date: '2026-08-08' },
        { user_id: 28, shift_role_id: 1, evidence_date: '2026-08-09' },
        { user_id: 28, shift_role_id: 1, evidence_date: '2026-08-11' },
        // Current/future assignments are not historical evidence.
        { user_id: 28, shift_role_id: 1, evidence_date: '2026-08-30' },
        { user_id: 28, shift_role_id: 1, evidence_date: '2026-09-02' },
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

describe('effective staff eligibility history evidence backfill migration', () => {
  it('preserves observed-current rows and adds only closed, dated evidence periods', async () => {
    const { context, bulkDelete, bulkInsert, query, transaction } = createContext();

    await up({ context });

    expect(bulkDelete).not.toHaveBeenCalled();
    const userTypeInsert = bulkInsert.mock.calls.find(
      ([table]) => table === 'user_type_membership_periods',
    );
    expect(userTypeInsert).toBeDefined();
    expect(userTypeInsert?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        user_id: 28,
        user_type_id: 3,
        effective_start: '2026-07-26',
        effective_end: '2026-08-23',
      }),
      expect.objectContaining({
        user_id: 28,
        user_type_id: 8,
        effective_start: '2026-08-24',
        effective_end: '2026-08-24',
      }),
      expect.objectContaining({
        user_id: 28,
        user_type_id: 3,
        effective_start: '2026-08-25',
        effective_end: '2026-08-29',
      }),
    ]));
    expect(userTypeInsert?.[1]).toHaveLength(3);
    (userTypeInsert?.[1] as Array<Record<string, unknown>>).forEach((row) => {
      expect(typeof row.metadata).toBe('string');
      expect(JSON.parse(String(row.metadata))).toEqual(expect.objectContaining({
        migration: '202608300005',
      }));
    });
    expect(userTypeInsert?.[2]).toEqual(expect.objectContaining({
      transaction,
    }));

    const roleInsert = bulkInsert.mock.calls.find(
      ([table]) => table === 'user_shift_role_membership_periods',
    );
    expect(roleInsert?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        user_id: 28,
        shift_role_id: 1,
        effective_start: '2026-08-08',
        effective_end: '2026-08-09',
      }),
      expect.objectContaining({
        user_id: 28,
        shift_role_id: 1,
        effective_start: '2026-08-11',
        effective_end: '2026-08-11',
      }),
    ]));
    expect(roleInsert?.[1]).toHaveLength(2);
    (roleInsert?.[1] as Array<Record<string, unknown>>).forEach((row) => {
      expect(typeof row.metadata).toBe('string');
      expect(JSON.parse(String(row.metadata))).toEqual(expect.objectContaining({
        confidence: 'work_evidence_dates_only',
      }));
    });
    expect(bulkInsert.mock.calls.some(([table]) => table === 'staff_profile_type_periods')).toBe(false);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain("audit.action = 'user.role_changed'");
    expect(sql).toContain("JOIN users AS u ON u.id::text = audit.entity_id");
    expect(sql).toContain("length(COALESCE(audit.meta_json #>> '{next,userTypeId}', '')) <= 10");
    expect(sql).toContain("role.slug = 'manager'");
    expect(sql).not.toContain("role.slug IN ('manager'");
    const roleQuery = query.mock.calls.find(([statement]) => (
      String(statement).includes('FROM shift_assignments AS sa')
    ));
    expect(roleQuery?.[1]).toEqual(expect.objectContaining({
      replacements: { observationDate: '2026-08-30' },
    }));
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back only rows owned by this migration', async () => {
    const { context, bulkDelete, transaction } = createContext();

    await down({ context });

    expect(bulkDelete).toHaveBeenNthCalledWith(
      1,
      'user_type_membership_periods',
      { source: 'migration_audit_transition_backfill_v1' },
      { transaction },
    );
    expect(bulkDelete).toHaveBeenNthCalledWith(
      2,
      'user_shift_role_membership_periods',
      { source: 'migration_role_work_evidence_backfill_v1' },
      { transaction },
    );
    expect(bulkDelete).toHaveBeenCalledTimes(2);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
