import {
  down,
  up,
  verify,
} from '../202609070007-auto-create-volunteer-stays.js';

const setup = () => {
  const transaction = { id: 'auto-volunteer-stay-backfill' };
  const context = {
    sequelize: {
      transaction: jest.fn(async (operation: (value: unknown) => Promise<void>) => operation(transaction)),
      query: jest.fn().mockResolvedValue([[], undefined]),
    },
  };
  return { context, transaction };
};

describe('automatic volunteer stay backfill migration', () => {
  it('creates only eligible current or future stays with defaults, revision history and audit', async () => {
    const { context, transaction } = setup();

    await up({ context: context as never });

    expect(context.sequelize.query).toHaveBeenCalledTimes(1);
    const [statement, options] = context.sequelize.query.mock.calls[0];
    const sql = String(statement);
    expect(options).toEqual({ transaction });
    expect(sql).toContain('INSERT INTO volunteer_stays');
    expect(sql).toContain('INSERT INTO volunteer_stay_revisions');
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(sql).toContain("'volunteer_stay.auto_created'");
    expect(sql).toContain("'migration_active_volunteer_backfill'");
    expect(sql).toContain('u.status IS TRUE');
    expect(sql).not.toContain('u.approved IS TRUE');
    expect(sql).toContain('profile.active IS TRUE');
    expect(sql).toContain("profile.staff_type = 'volunteer'");
    expect(sql).toContain("u.departure_date::date > (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date");
    expect(sql).toContain("IN ('social_media', 'socialmedia')");
    expect(sql).toContain("IN ('guide', 'pub_crawl_guide', 'pubcrawl_guide')");
    expect(sql).toContain('jsonb_array_length(shift_type_ids->\'guiding\') > 0');
    expect(sql).toContain('jsonb_array_length(shift_type_ids->\'promotion\') > 0');
    expect(sql).toContain('jsonb_array_length(shift_type_ids->\'socialMedia\') > 0');
    expect(sql).toContain("'{\"reviews\":15,\"guidingShifts\":12,\"promotionShifts\":12,\"socialMediaShifts\":16,\"cleaningTasks\":5,\"attendancePercent\":90}'::jsonb");
  });

  it('preserves every overlapping manual or automatic stay and remains rerunnable', async () => {
    const { context } = setup();

    await up({ context: context as never });

    const sql = String(context.sequelize.query.mock.calls[0][0]);
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain('existing.user_id = candidate.user_id');
    expect(sql).toContain('existing.start_date < candidate.end_date');
    expect(sql).toContain('existing.end_date > candidate.start_date');
    expect(sql).not.toMatch(/UPDATE\s+volunteer_stays/iu);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+volunteer_stays/iu);
  });

  it('propagates a write failure so the managed transaction rolls back', async () => {
    const { context } = setup();
    context.sequelize.query.mockRejectedValueOnce(new Error('backfill failed'));

    await expect(up({ context: context as never })).rejects.toThrow('backfill failed');
  });

  it('verifies that no eligible stays or initial revisions remain missing', async () => {
    const { context } = setup();
    context.sequelize.query.mockResolvedValueOnce([[
      { missing_eligible_stays: 0, auto_created_stays: 9, missing_initial_revisions: 0 },
    ], undefined]);

    await expect(verify({ context: context as never })).resolves.toEqual({
      ok: true,
      details: { missing_eligible_stays: 0, auto_created_stays: 9, missing_initial_revisions: 0 },
    });
    const sql = String(context.sequelize.query.mock.calls[0][0]);
    expect(sql).toContain('missing_eligible_stays');
    expect(sql).toContain('missing_initial_revisions');

    context.sequelize.query.mockReset().mockResolvedValueOnce([[
      { missing_eligible_stays: 1, auto_created_stays: 8, missing_initial_revisions: 0 },
    ], undefined]);
    await expect(verify({ context: context as never })).resolves.toMatchObject({ ok: false });

    context.sequelize.query.mockReset().mockResolvedValueOnce([[
      { missing_eligible_stays: 0, auto_created_stays: 9, missing_initial_revisions: 1 },
    ], undefined]);
    await expect(verify({ context: context as never })).resolves.toMatchObject({ ok: false });
  });

  it('keeps the append-only backfill intact on rollback', async () => {
    const { context } = setup();

    await down();

    expect(context.sequelize.query).not.toHaveBeenCalled();
    expect(context.sequelize.transaction).not.toHaveBeenCalled();
  });
});
