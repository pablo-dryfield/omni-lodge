import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202609070006-volunteer-attendance-shift-identity.js';

const setup = () => {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], undefined]);
  const context = { sequelize: { query, transaction: jest.fn(async (callback) => callback(transaction)) } } as unknown as QueryInterface;
  return { context, query, transaction };
};
describe('attendance physical-shift identity migration', () => {
  it('adds paired nullable snapshots without inventing historical identities from the current roster', async () => {
    const { context, query, transaction } = setup();
    await up({ context });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('ADD COLUMN evidence_shift_instance_id INTEGER');
    expect(sql).toContain('ADD COLUMN evidence_shift_type_id INTEGER');
    expect(sql).toContain('evidence_shift_instance_id IS NOT NULL AND evidence_shift_type_id IS NOT NULL');
    expect(sql).not.toContain('UPDATE volunteer_shift_attendance');
    expect(query.mock.calls[0][1]).toEqual({ transaction });
  });
  it('refuses to discard bound evidence when rolling back', async () => {
    const { context, query } = setup();
    await down({ context });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('ACCESS EXCLUSIVE');
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP COLUMN'));
  });
  it('verifies both columns and the identity constraint', async () => {
    const { context, query } = setup();
    query.mockResolvedValueOnce([[{ identity_check_exists: true, identity_columns_exist: true }]]);
    await expect(verify({ context })).resolves.toMatchObject({ ok: true });
    query.mockResolvedValueOnce([[{ identity_check_exists: true, identity_columns_exist: false }]]);
    await expect(verify({ context })).resolves.toMatchObject({ ok: false });
  });
});
