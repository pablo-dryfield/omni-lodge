import {
  down,
  up,
} from '../202608300004-effective-dated-staff-eligibility-history.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  return {
    context: {
      sequelize: {
        transaction: jest.fn().mockResolvedValue(transaction),
        query,
      },
    } as never,
    query,
    transaction,
  };
};

describe('effective-dated staff eligibility history migration', () => {
  it('creates non-overlapping histories and only backfills observed current state', async () => {
    const { context, query, transaction } = createContext();

    await up({ context });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(sql).toContain('CREATE TABLE user_type_membership_periods');
    expect(sql).toContain('CREATE TABLE user_shift_role_membership_periods');
    expect(sql).toContain('CREATE TABLE staff_profile_type_periods');
    expect(sql).toContain('EXCLUDE USING gist');
    expect(sql).toContain('user_type_membership_period_open_uidx');
    expect(sql).toContain('user_shift_role_membership_period_open_uidx');
    expect(sql).toContain('staff_profile_type_period_open_uidx');
    expect(sql).toContain('staff_profile_type_period_value_ck');
    expect(sql.match(/user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/g)).toHaveLength(3);
    expect(sql).not.toContain('user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE');
    expect(sql).toContain("staff_type IN ('volunteer', 'long_term', 'assistant_manager', 'manager', 'guide')");
    expect(sql).toContain("effective_end >= effective_start");
    expect(sql).toContain("daterange(effective_start, COALESCE(effective_end, 'infinity'::date), '[]') WITH &&");
    expect(sql).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw'");
    expect(sql).toContain('JOIN "userTypes" AS observed_user_type');
    expect(sql).toContain('JOIN users AS role_user');
    expect(sql).toContain('JOIN shift_roles AS observed_shift_role');
    expect(sql).toContain('JOIN users AS profile_user');
    expect(sql).toContain('"confidence":"current_only"');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('drops only the three history tables on rollback', async () => {
    const { context, query, transaction } = createContext();

    await down({ context });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS staff_profile_type_periods');
    expect(sql).toContain('DROP TABLE IF EXISTS user_shift_role_membership_periods');
    expect(sql).toContain('DROP TABLE IF EXISTS user_type_membership_periods');
    expect(sql).not.toContain('DROP EXTENSION');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
