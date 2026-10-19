import { up, down, verify } from '../202610190001-volunteer-stay-assessments.js';
const setup = () => {
  const transaction = {};
  const context = { sequelize: { query: jest.fn().mockResolvedValue([[], undefined]),
    transaction: jest.fn(async (run: (value: unknown) => Promise<void>) => run(transaction)) } };
  return { context, transaction };
};
describe('volunteer stay assessment migration', () => {
  it('adds a rerunnable nullable JSONB column without rewriting prior feedback or stay agreements', async () => {
    const { context } = setup();
    await up({ context: context as never });
    const sql = context.sequelize.query.mock.calls.map(([query]) => query).join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS assessment JSONB');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS target_overrides JSONB');
    expect(sql).toContain("jsonb_typeof(assessment) = 'object'");
    expect(sql).not.toMatch(/UPDATE|DELETE/iu);
  });
  it('refuses to roll back when saved assessment evidence exists', async () => {
    const { context, transaction } = setup();
    await down({ context: context as never });
    expect(context.sequelize.query).toHaveBeenCalledWith(expect.stringContaining("RAISE EXCEPTION 'Cannot remove saved volunteer assessments'"), { transaction });
    expect(context.sequelize.query.mock.calls[0][0]).toContain('LOCK TABLE volunteer_stays IN ACCESS EXCLUSIVE MODE');
  });
  it('verifies both column and constraint', async () => {
    const { context } = setup();
    context.sequelize.query.mockResolvedValueOnce([[{ column_exists: true, check_exists: true, overrides_exist: true, overrides_check: true }], undefined]);
    await expect(verify({ context: context as never })).resolves.toMatchObject({ ok: true });
    context.sequelize.query.mockResolvedValueOnce([[{ column_exists: true, check_exists: false }], undefined]);
    await expect(verify({ context: context as never })).resolves.toMatchObject({ ok: false });
  });
});
