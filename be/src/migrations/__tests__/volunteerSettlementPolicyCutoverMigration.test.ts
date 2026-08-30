import { up as seedVolunteerPolicy } from '../202608290002-compensation-settlement-volunteer-funds.js';
import {
  down as revertVolunteerPolicyCutover,
  up as applyVolunteerPolicyCutover,
} from '../202608300001-volunteer-settlement-policy-cutover.js';

const createContext = () => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockResolvedValue(undefined);
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query,
    },
  };
  return { context: context as never, query, transaction };
};

describe('Volunteer settlement policy cutover migrations', () => {
  it('seeds fresh databases with the August 1 cutover', async () => {
    const { context, query, transaction } = createContext();

    await seedVolunteerPolicy({ context });

    const seedSql = query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(seedSql).toContain("'volunteer', 'default', NULL, 'volunteer_fund', DATE '2026-08-01'");
    expect(seedSql).toContain("'volunteer', 'component_category', 'review', 'staff_vendor', DATE '2026-08-01'");
    expect(seedSql).not.toContain("'volunteer_fund', DATE '2026-09-01'");
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('moves only untouched September seed rows while preserving their ids', async () => {
    const { context, query, transaction } = createContext();

    await applyVolunteerPolicyCutover({ context });

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain("SET effective_start = DATE '2026-08-01'");
    expect(sql).toContain("rule.effective_start = DATE '2026-09-01'");
    expect(sql).toContain('rule.created_by IS NULL');
    expect(sql).toContain('rule.updated_by IS NULL');
    expect(sql).toContain('AND NOT EXISTS (');
    expect(sql).toContain('other.id <> rule.id');
    expect(sql).toContain("other.effective_start = DATE '2026-08-01'");
    expect(sql).not.toMatch(/\bDELETE\b|\bINSERT\b/iu);
    expect(sql).not.toContain('staff_payout_ledgers');
    expect(sql).not.toContain('settlement_snapshot');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('reverts only the same untouched seed rows', async () => {
    const { context, query, transaction } = createContext();

    await revertVolunteerPolicyCutover({ context });

    const sql = String(query.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain("SET effective_start = DATE '2026-09-01'");
    expect(sql).toContain("rule.effective_start = DATE '2026-08-01'");
    expect(sql).toContain('rule.created_by IS NULL');
    expect(sql).toContain('rule.updated_by IS NULL');
    expect(sql).toContain('AND NOT EXISTS (');
    expect(sql).toContain("other.effective_start = DATE '2026-09-01'");
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });
});
