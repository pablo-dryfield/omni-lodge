import type { QueryInterface } from 'sequelize';
import { down, up, verify } from '../202511030002-report-template-preview-order';

type ColumnState = {
  allowNull: boolean;
  defaultValue: unknown;
  type: string;
};

const validColumn = (): ColumnState => ({
  allowNull: false,
  defaultValue: "'[]'::jsonb",
  type: 'JSONB',
});

const createContext = (initial?: ColumnState) => {
  const transaction = { id: 'preview-order-transaction' };
  const columns: Record<string, ColumnState> = initial ? { preview_order: initial } : {};
  const describeTable = jest.fn(async () => ({ ...columns }));
  const addColumn = jest.fn(async () => {
    columns.preview_order = validColumn();
  });
  const bulkUpdate = jest.fn().mockResolvedValue(undefined);
  const changeColumn = jest.fn(async () => {
    columns.preview_order = validColumn();
  });
  const context = {
    sequelize: {
      transaction: jest.fn(async (callback: (value: unknown) => Promise<void>) => callback(transaction)),
    },
    describeTable,
    addColumn,
    bulkUpdate,
    changeColumn,
  } as unknown as QueryInterface;

  return { context, transaction, columns, addColumn, bulkUpdate, changeColumn };
};

describe('202511030002 report template preview order migration', () => {
  it('adds the model-owned column when it is absent', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.addColumn).toHaveBeenCalledWith(
      'report_templates',
      'preview_order',
      expect.objectContaining({ allowNull: false, defaultValue: [] }),
      { transaction: setup.transaction },
    );
    expect(setup.changeColumn).not.toHaveBeenCalled();
  });

  it('is a no-op for the existing production column', async () => {
    const setup = createContext(validColumn());

    await up({ context: setup.context });

    expect(setup.addColumn).not.toHaveBeenCalled();
    expect(setup.bulkUpdate).not.toHaveBeenCalled();
    expect(setup.changeColumn).not.toHaveBeenCalled();
  });

  it('backfills and normalizes an incomplete existing column', async () => {
    const setup = createContext({ allowNull: true, defaultValue: null, type: 'JSON' });

    await up({ context: setup.context });

    expect(setup.bulkUpdate).toHaveBeenCalledWith(
      'report_templates',
      expect.objectContaining({ preview_order: expect.anything() }),
      { preview_order: null },
      { transaction: setup.transaction },
    );
    expect(setup.changeColumn).toHaveBeenCalledWith(
      'report_templates',
      'preview_order',
      expect.objectContaining({ allowNull: false, defaultValue: [] }),
      { transaction: setup.transaction },
    );
  });

  it('reports invalid and valid physical definitions', async () => {
    const missing = createContext();
    await expect(verify({ context: missing.context })).resolves.toEqual({
      ok: false,
      details: { missing: true, nullable: false, invalidType: false, missingDefault: false },
    });

    const valid = createContext(validColumn());
    await expect(verify({ context: valid.context })).resolves.toEqual({
      ok: true,
      details: { missing: false, nullable: false, invalidType: false, missingDefault: false },
    });
  });

  it('has an intentionally non-destructive rollback', async () => {
    const setup = createContext(validColumn());

    await down();

    expect(setup.addColumn).not.toHaveBeenCalled();
    expect(setup.changeColumn).not.toHaveBeenCalled();
  });
});
