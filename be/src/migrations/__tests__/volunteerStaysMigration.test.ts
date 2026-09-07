import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202609060004-volunteer-stays.js';

const setup = () => {
  const transaction = { commit: jest.fn(), rollback: jest.fn() };
  const query = jest.fn().mockResolvedValue([[], undefined]);
  const context = { sequelize: { query, transaction: jest.fn().mockResolvedValue(transaction) } } as unknown as QueryInterface;
  return { transaction, query, context };
};

describe('volunteer stays migration', () => {
  it('creates guarded agreement and audit tables without backfilling mutable user dates', async () => {
    const { context, query, transaction } = setup();
    await up({ context });
    const statements = query.mock.calls.map(([sql]) => sql).join('\n');
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS volunteer_stays');
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS volunteer_stay_revisions');
    expect(statements).toContain('end_date > start_date');
    expect(statements).toContain('UNIQUE (stay_id, revision)');
    expect(statements).toContain("ut.slug = 'social-media'");
    expect(statements).toContain("a.key = 'view'");
    expect(statements).not.toContain('INSERT INTO volunteer_stays');
    expect(statements).not.toContain('volunteer_milestone_feedback');
    query.mock.calls.forEach(([, options]) => expect(options.transaction).toBe(transaction));
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back schema and permissions together on failure', async () => {
    const { context, query, transaction } = setup();
    query.mockRejectedValueOnce(new Error('schema error'));
    await expect(up({ context })).rejects.toThrow('schema error');
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('protects saved agreements from destructive rollback', async () => {
    const { context, query, transaction } = setup();
    await down({ context });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('ACCESS EXCLUSIVE');
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP TABLE'));
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    query.mockRejectedValueOnce(new Error('Cannot roll back'));
    await expect(down({ context })).rejects.toThrow('Cannot roll back');
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
  });

  it('requires tables and integrity constraints to verify successfully', async () => {
    const { context, query } = setup();
    const details = { stays_exist: true, revisions_exist: true, checks_exist: true, revision_unique: true };
    query.mockResolvedValueOnce([[details], undefined]);
    await expect(verify({ context })).resolves.toEqual({ ok: true, details });
    query.mockResolvedValueOnce([[{ ...details, checks_exist: false }], undefined]);
    await expect(verify({ context })).resolves.toMatchObject({ ok: false });
  });
});
