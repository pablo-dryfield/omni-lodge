import type { QueryInterface } from 'sequelize';

import { down, up } from '../202511220005-compensation-components.js';

describe('compensation components migration', () => {
  it('targets the historical camel-case userTypes table', async () => {
    const createTable = jest.fn().mockResolvedValue(undefined);
    const context = {
      createTable,
      addIndex: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryInterface;

    await up({ context });

    const assignmentColumns = createTable.mock.calls.find(
      ([tableName]) => tableName === 'compensation_component_assignments',
    )?.[1] as Record<string, { references?: { model?: string; key?: string } }> | undefined;

    expect(assignmentColumns?.user_type_id?.references).toEqual({
      model: 'userTypes',
      key: 'id',
    });
  });

  it('passes options when rollback drops registered ENUM-backed tables', async () => {
    const dropTable = jest.fn().mockResolvedValue(undefined);
    const context = { dropTable } as unknown as QueryInterface;

    await down({ context });

    expect(dropTable.mock.calls).toEqual([
      ['compensation_component_assignments', {}],
      ['compensation_components', {}],
    ]);
  });
});
