import type { QueryInterface } from 'sequelize';
import { up, down, verify } from '../202610210004-cleaning-assigned-self-review.js';

const setup = () => {
  const transaction = {};
  const query = jest.fn().mockResolvedValue([[], undefined]);
  const context = { sequelize: { query, transaction: jest.fn(async (fn) => fn(transaction)) } } as unknown as QueryInterface;
  return { transaction, query, context };
};

describe('assigned assistant-manager cleaning self-review migration', () => {
  it('preserves independent review by default and requires an explicit server authorization for self-review', async () => {
    const { context, query, transaction } = setup();
    await up({ context });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('self_review_authorized BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain('reviewed_by IS NULL OR reviewed_by <> uploaded_by OR self_review_authorized');
    expect(sql).toContain('NOT self_review_authorized OR (reviewed_by IS NOT NULL AND reviewed_by = uploaded_by');
    expect(sql).toContain("status IN ('approved', 'rejected')");
    expect(sql).not.toMatch(/DELETE FROM|UPDATE cleaning_photo_versions|UPDATE am_task_logs/u);
    expect(query.mock.calls[0][1]).toEqual({ transaction });
  });
  it('refuses rollback that would discard saved self-review audit history', async () => {
    const { context, query } = setup();
    await down({ context });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('ACCESS EXCLUSIVE');
    expect(sql).toContain('WHERE self_review_authorized');
    expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('DROP COLUMN'));
    expect(sql).toContain('CHECK (reviewed_by IS NULL OR reviewed_by <> uploaded_by)');
  });
  it('requires the authorization column and both validated constraints', async () => {
    const { context, query } = setup();
    const valid = { authorization_column: true, independent_review_guard: true, self_review_guard: true };
    query.mockResolvedValueOnce([[valid]]);
    await expect(verify({ context })).resolves.toMatchObject({ ok: true });
    for (const key of Object.keys(valid)) {
      query.mockResolvedValueOnce([[{ ...valid, [key]: false }]]);
      await expect(verify({ context })).resolves.toMatchObject({ ok: false });
    }
    query.mockResolvedValueOnce([[]]);
    await expect(verify({ context })).resolves.toMatchObject({ ok: false });
  });
});
