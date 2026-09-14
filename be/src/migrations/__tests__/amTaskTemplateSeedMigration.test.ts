import type { QueryInterface } from 'sequelize';

import { up } from '../202603030001-am-task-template-seed.js';

const createContext = (intendedAssigneeExists: boolean) => {
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const query = jest.fn().mockImplementation(async (statement: unknown) => {
    const sql = String(statement);
    if (sql.includes('FROM am_task_templates')) return [{ id: 101 }];
    if (sql.includes('FROM users')) return intendedAssigneeExists ? [{ id: 35 }] : [];
    if (sql.includes('FROM am_task_assignments')) return [];
    return undefined;
  });
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query,
    },
  } as unknown as QueryInterface;

  return { context, query, transaction };
};

const isDirectAssignmentInsert = (statement: string): boolean => (
  statement.includes('INSERT INTO am_task_assignments')
  && statement.includes("(:templateId, 'user'")
);

describe('assistant manager task template seed migration', () => {
  it('skips a direct assignment when the intended historical assignee does not match', async () => {
    const setup = createContext(false);

    await up({ context: setup.context });

    const sql = setup.query.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => (
      statement.includes('FROM users')
      && statement.includes('user_record.id = :userId')
      && statement.includes("= 'assistant_manager'")
      && statement.includes('user_record.status IS TRUE')
    )))
      .toBe(true);
    expect(sql.some(isDirectAssignmentInsert)).toBe(false);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });

  it('preserves the direct assignment when the historical user and role match', async () => {
    const setup = createContext(true);

    await up({ context: setup.context });

    const directInsert = setup.query.mock.calls.find(([statement]) => (
      isDirectAssignmentInsert(String(statement))
    ));
    expect(directInsert?.[1]).toEqual(expect.objectContaining({
      replacements: { templateId: 101, userId: 35 },
    }));
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
  });
});
