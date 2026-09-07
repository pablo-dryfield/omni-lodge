import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202609060005-volunteer-evidence-workflows.js';
const setup = () => {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], undefined]);
  const context = { sequelize: { query, transaction: jest.fn(async (fn) => fn(transaction)) } } as unknown as QueryInterface;
  return { transaction, query, context };
};
describe('volunteer evidence workflows migration', () => {
  it('keeps immutable photo versions and forbids self-review while retaining canceled shift history', async () => {
    const { context, query, transaction } = setup();
    await up({ context });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('UNIQUE (submission_id, slot_key, version)');
    expect(sql).toContain('reviewed_by <> uploaded_by');
    expect(sql).toContain('REFERENCES shift_assignments(id) ON DELETE SET NULL');
    expect(sql).toContain('REFERENCES am_task_logs(id) ON DELETE RESTRICT');
    expect(sql).toContain('24000000');
    expect(sql).not.toContain('UPDATE am_task_logs');
    expect(query.mock.calls[0][1]).toEqual({ transaction });
  });
  it('guards against dropping any saved evidence/review history', async () => {
    const { context, query } = setup();
    await down({ context });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('ACCESS EXCLUSIVE');
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });
  it('requires schema and constraints for successful verification', async () => {
    const { context, query } = setup();
    query.mockResolvedValueOnce([[{ submissions_exist: true, photos_exist: true, attendance_checks_exist: true, versions_unique: true }]]);
    await expect(verify({ context })).resolves.toMatchObject({ ok: true });
    query.mockResolvedValueOnce([[{ submissions_exist: true, photos_exist: false }]]);
    await expect(verify({ context })).resolves.toMatchObject({ ok: false });
  });
});
