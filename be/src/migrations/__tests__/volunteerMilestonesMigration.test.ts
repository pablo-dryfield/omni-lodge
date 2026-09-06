import type { QueryInterface } from 'sequelize';
import * as migration from '../202609060001-volunteer-milestones.js';

const buildContext = () => {
  const transaction = { commit: jest.fn(), rollback: jest.fn() };
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn().mockResolvedValue([[], undefined]),
    },
    createTable: jest.fn().mockResolvedValue(undefined),
    addIndex: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    describeTable: jest.fn(),
  } as unknown as QueryInterface;
  return { context, transaction };
};

describe('volunteer milestones migration', () => {
  it('creates attendance, feedback, constraints, indexes, and access rows atomically', async () => {
    const { context, transaction } = buildContext();
    await migration.up({ context });

    expect(context.createTable).toHaveBeenNthCalledWith(
      1,
      'volunteer_shift_attendance',
      expect.objectContaining({ shift_assignment_id: expect.any(Object), status: expect.any(Object) }),
      { transaction },
    );
    expect(context.createTable).toHaveBeenNthCalledWith(
      2,
      'volunteer_milestone_feedback',
      expect.objectContaining({ volunteer_user_id: expect.any(Object), period_start: expect.any(Object) }),
      { transaction },
    );
    expect(context.addIndex).toHaveBeenCalledWith(
      'volunteer_shift_attendance',
      ['shift_assignment_id'],
      expect.objectContaining({ unique: true, name: 'volunteer_shift_attendance_assignment_uq' }),
    );
    expect(context.addIndex).toHaveBeenCalledWith(
      'volunteer_milestone_feedback',
      ['volunteer_user_id', 'period_start'],
      expect.objectContaining({ unique: true, name: 'volunteer_milestone_feedback_user_period_uq' }),
    );
    const sql = (context.sequelize.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('volunteer_shift_attendance_status_ck');
    expect(sql).toContain('volunteer_milestone_feedback_approval_ck');
    expect(sql).toContain('pg_constraint');
    expect(sql).toContain('to_regclass(:qualifiedTableName)');
    expect(sql).not.toContain('$volunteer_milestones$');
    expect(sql).not.toContain('approved_by IS NOT NULL');
    const constraintLookupCalls = (context.sequelize.query as jest.Mock).mock.calls.filter(
      ([statement]) => typeof statement === 'string' && statement.includes('FROM pg_constraint'),
    );
    expect(constraintLookupCalls).toHaveLength(5);
    constraintLookupCalls.forEach(([, options]) => {
      expect(options.replacements.qualifiedTableName).toMatch(/^public\.volunteer_/u);
    });
    const constraintCreateCalls = (context.sequelize.query as jest.Mock).mock.calls.filter(
      ([statement]) => typeof statement === 'string' && statement.includes('ADD CONSTRAINT'),
    );
    expect(constraintCreateCalls).toHaveLength(5);
    const feedbackDefinition = (context.createTable as jest.Mock).mock.calls[1][1];
    expect(feedbackDefinition.approved_by).toMatchObject({ onDelete: 'SET NULL' });
    expect(sql).toContain('rolePagePermissions');
    expect(sql).toContain('roleModulePermissions');
    const accessSeedOptions = (context.sequelize.query as jest.Mock).mock.calls
      .map(([, options]) => options)
      .filter((options) => options?.replacements?.roleSlugs);
    expect(accessSeedOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        replacements: expect.objectContaining({
          roleSlugs: expect.arrayContaining(['guide', 'pub-crawl-guide']),
        }),
      }),
    ]));
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('skips existing check constraints on a recovery run', async () => {
    const { context, transaction } = buildContext();
    (context.sequelize.query as jest.Mock).mockImplementation((statement: unknown) => {
      if (typeof statement === 'string' && statement.includes('FROM pg_constraint')) {
        return Promise.resolve([[{ constraint_exists: true }], undefined]);
      }
      return Promise.resolve([[], undefined]);
    });

    await migration.up({ context });

    const sqlStatements = (context.sequelize.query as jest.Mock).mock.calls.map(([statement]) => String(statement));
    expect(sqlStatements.filter((statement) => statement.includes('FROM pg_constraint'))).toHaveLength(5);
    expect(sqlStatements.some((statement) => statement.includes('ADD CONSTRAINT'))).toBe(false);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('removes access rows and both tables on down', async () => {
    const { context, transaction } = buildContext();
    await migration.down({ context });

    expect(context.dropTable).toHaveBeenNthCalledWith(1, 'volunteer_milestone_feedback', { transaction });
    expect(context.dropTable).toHaveBeenNthCalledWith(2, 'volunteer_shift_attendance', { transaction });
    const sql = (context.sequelize.query as jest.Mock).mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('roleModulePermissions');
    expect(sql).toContain('DELETE FROM pages');
    expect(transaction.commit).toHaveBeenCalledTimes(1);
  });

  it('verifies both table schemas and legacy pub-crawl-guide view access', async () => {
    const { context } = buildContext();
    (context.describeTable as jest.Mock)
      .mockResolvedValueOnce({
        shift_assignment_id: {}, status: {}, recorded_by: {}, recorded_at: {},
      })
      .mockResolvedValueOnce({
        volunteer_user_id: {}, period_start: {}, feedback: {}, approved: {}, approved_by: {}, approved_at: {},
      });
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([[
      {
        page_exists: true,
        module_exists: true,
        volunteer_role_exists: true,
        all_volunteer_roles_have_view: true,
      },
    ], undefined]);

    await expect(migration.verify({ context })).resolves.toEqual({
      ok: true,
      details: {
        missingAttendanceColumns: [],
        missingFeedbackColumns: [],
        access: {
          page_exists: true,
          module_exists: true,
          volunteer_role_exists: true,
          all_volunteer_roles_have_view: true,
        },
      },
    });

    const [verifySql, verifyOptions] = (context.sequelize.query as jest.Mock).mock.calls[0];
    expect(verifySql).toContain('rolePagePermissions');
    expect(verifySql).toContain('all_volunteer_roles_have_view');
    expect(verifySql).not.toContain("ut.slug = 'guide'");
    expect(verifyOptions.replacements.volunteerRoleSlugs).toEqual(['guide', 'pub-crawl-guide']);
  });

  it('fails verification when a volunteer role lacks complete page and module access', async () => {
    const { context } = buildContext();
    (context.describeTable as jest.Mock)
      .mockResolvedValueOnce({
        shift_assignment_id: {}, status: {}, recorded_by: {}, recorded_at: {},
      })
      .mockResolvedValueOnce({
        volunteer_user_id: {}, period_start: {}, feedback: {}, approved: {}, approved_by: {}, approved_at: {},
      });
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([[
      {
        page_exists: true,
        module_exists: true,
        volunteer_role_exists: true,
        all_volunteer_roles_have_view: false,
      },
    ], undefined]);

    await expect(migration.verify({ context })).resolves.toMatchObject({
      ok: false,
      details: {
        access: {
          volunteer_role_exists: true,
          all_volunteer_roles_have_view: false,
        },
      },
    });
  });
});
