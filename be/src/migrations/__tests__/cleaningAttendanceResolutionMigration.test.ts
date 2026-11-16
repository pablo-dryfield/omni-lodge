import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202611160001-cleaning-attendance-resolution.js';
const setup = () => {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], undefined]);
  const context = { sequelize: { query, transaction: jest.fn(async (fn) => fn(transaction)) } } as unknown as QueryInterface;
  return { transaction, query, context };
};
it('adds reasoned resolutions and repairs historical attendance in one transaction', async () => {
  const { context, query, transaction } = setup(); await up({ context });
  expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.every((call) => call[1].transaction === transaction)).toBe(true);
  expect(query.mock.calls[0][0]).toContain('cleaning_attendance_resolution_ck');
  expect(query.mock.calls[1][0]).toContain('ON CONFLICT (shift_assignment_id) DO NOTHING');
});
it('refuses rollback while attendance or absence history exists', async () => {
  const { context, query } = setup(); await down({ context });
  expect(query.mock.calls[0][0]).toContain('ACCESS EXCLUSIVE');
  expect(query.mock.calls[0][0]).toContain('RAISE EXCEPTION');
});
it('requires all new schema checks', async () => {
  const { context, query } = setup();
  query.mockResolvedValueOnce([[{ resolution_exists: true, resolution_check: true, cleaning_proof: true }]]);
  await expect(verify({ context })).resolves.toMatchObject({ ok: true });
  query.mockResolvedValueOnce([[{ resolution_exists: true, resolution_check: false, cleaning_proof: true }]]);
  await expect(verify({ context })).resolves.toMatchObject({ ok: false });
});
