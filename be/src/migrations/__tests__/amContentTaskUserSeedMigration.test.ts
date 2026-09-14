import type { QueryInterface } from 'sequelize';

import { up } from '../202603040005-am-content-task-user-seed.js';

const createContext = (intendedAssigneeExists: boolean) => {
  const transaction = {};
  const query = jest.fn().mockImplementation(async (statement: unknown) => {
    const sql = String(statement);
    if (sql.includes('FROM am_task_templates')) return [{ id: 101 }];
    if (sql.includes('FROM users')) return intendedAssigneeExists ? [{ id: 35 }] : [];
    if (sql.includes('FROM am_task_assignments')) return [];
    return undefined;
  });
  const context = {
    sequelize: {
      transaction: jest.fn(async (callback: (value: object) => Promise<void>) => callback(transaction)),
      query,
    },
  } as unknown as QueryInterface;

  return { context, query };
};

describe('assistant manager content task user seed migration', () => {
  it('keeps the schedule update but skips reassignment when the intended assignee does not match', async () => {
    const setup = createContext(false);

    await up({ context: setup.context });

    const sql = setup.query.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.includes('UPDATE am_task_templates'))).toBe(true);
    expect(sql.some((statement) => (
      statement.includes('FROM users')
      && statement.includes("= 'assistant_manager'")
      && statement.includes('user_record.status IS TRUE')
    ))).toBe(true);
    expect(sql.some((statement) => statement.includes('DELETE FROM am_task_assignments'))).toBe(false);
    expect(sql.some((statement) => statement.includes('INSERT INTO am_task_assignments'))).toBe(false);
  });

  it('preserves the historical reassignment when user 35 is the active Assistant Manager', async () => {
    const setup = createContext(true);

    await up({ context: setup.context });

    const sql = setup.query.mock.calls.map(([statement]) => String(statement));
    expect(sql.some((statement) => statement.includes('DELETE FROM am_task_assignments'))).toBe(true);
    expect(sql.some((statement) => (
      statement.includes('INSERT INTO am_task_assignments')
      && statement.includes("(:templateId, 'user'")
    ))).toBe(true);
  });
});
