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
    expect(sql).not.toContain('approved_by IS NOT NULL');
    const feedbackDefinition = (context.createTable as jest.Mock).mock.calls[1][1];
    expect(feedbackDefinition.approved_by).toMatchObject({ onDelete: 'SET NULL' });
    expect(sql).toContain('rolePagePermissions');
    expect(sql).toContain('roleModulePermissions');
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

  it('verifies both table schemas and guide view access', async () => {
    const { context } = buildContext();
    (context.describeTable as jest.Mock)
      .mockResolvedValueOnce({
        shift_assignment_id: {}, status: {}, recorded_by: {}, recorded_at: {},
      })
      .mockResolvedValueOnce({
        volunteer_user_id: {}, period_start: {}, feedback: {}, approved: {}, approved_by: {}, approved_at: {},
      });
    (context.sequelize.query as jest.Mock).mockResolvedValueOnce([[
      { page_exists: true, module_exists: true, guide_view_exists: true },
    ], undefined]);

    await expect(migration.verify({ context })).resolves.toEqual({
      ok: true,
      details: {
        missingAttendanceColumns: [],
        missingFeedbackColumns: [],
        access: { page_exists: true, module_exists: true, guide_view_exists: true },
      },
    });
  });
});
