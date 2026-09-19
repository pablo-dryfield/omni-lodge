import type { QueryInterface } from 'sequelize';
import {
  CAMEL_TIMESTAMP_TABLES,
  down,
  up,
  verify,
} from '../202512040021-legacy-timestamp-column-bridge';

type ColumnState = {
  allowNull: boolean;
  defaultValue: unknown;
  type: string;
};
type SchemaState = Record<string, Record<string, ColumnState>>;

const timestampColumn = (
  allowNull = false,
  defaultValue: unknown = null,
): ColumnState => ({
  allowNull,
  defaultValue,
  type: 'TIMESTAMP WITH TIME ZONE',
});

const canonicalSchema = (): SchemaState => Object.fromEntries(
  CAMEL_TIMESTAMP_TABLES.map((table) => [table, {
    createdAt: timestampColumn(),
    updatedAt: timestampColumn(),
  }]),
);

const historicalSchema = (): SchemaState => Object.fromEntries(
  CAMEL_TIMESTAMP_TABLES.map((table) => [table, {
    created_at: timestampColumn(false, 'now()'),
    updated_at: timestampColumn(true),
  }]),
);

const createContext = (state: SchemaState) => {
  const transaction = { id: 'timestamp-bridge-transaction' };
  const describeTable = jest.fn(async (table: string) => ({ ...state[table] }));
  const renameColumn = jest.fn(async (table: string, oldName: string, newName: string) => {
    state[table][newName] = state[table][oldName];
    delete state[table][oldName];
  });
  const addColumn = jest.fn(async (table: string, columnName: string) => {
    state[table][columnName] = timestampColumn(true);
  });
  const bulkUpdate = jest.fn().mockResolvedValue(undefined);
  const changeColumn = jest.fn(async (table: string, columnName: string) => {
    state[table][columnName] = timestampColumn();
  });
  const context = {
    sequelize: {
      transaction: jest.fn(async (callback: (value: unknown) => Promise<void>) => callback(transaction)),
    },
    describeTable,
    renameColumn,
    addColumn,
    bulkUpdate,
    changeColumn,
  } as unknown as QueryInterface;

  return {
    context,
    transaction,
    describeTable,
    renameColumn,
    addColumn,
    bulkUpdate,
    changeColumn,
    state,
  };
};

describe('202512040021 legacy timestamp column bridge migration', () => {
  it('renames every historical timestamp and normalizes the model-owned columns', async () => {
    const setup = createContext(historicalSchema());

    await up({ context: setup.context });

    expect(setup.renameColumn).toHaveBeenCalledTimes(CAMEL_TIMESTAMP_TABLES.length * 2);
    expect(setup.changeColumn).toHaveBeenCalledTimes(CAMEL_TIMESTAMP_TABLES.length * 2);
    expect(setup.bulkUpdate).toHaveBeenCalledTimes(CAMEL_TIMESTAMP_TABLES.length);
    expect(setup.addColumn).not.toHaveBeenCalled();
    expect(setup.renameColumn).toHaveBeenCalledWith(
      'booking_events',
      'created_at',
      'createdAt',
      { transaction: setup.transaction },
    );

    for (const table of CAMEL_TIMESTAMP_TABLES) {
      expect(setup.state[table]).toMatchObject({
        createdAt: timestampColumn(),
        updatedAt: timestampColumn(),
      });
      expect(setup.state[table]).not.toHaveProperty('created_at');
      expect(setup.state[table]).not.toHaveProperty('updated_at');
    }
  });

  it('does not issue DDL when the production schema is already canonical', async () => {
    const setup = createContext(canonicalSchema());

    await up({ context: setup.context });

    expect(setup.renameColumn).not.toHaveBeenCalled();
    expect(setup.addColumn).not.toHaveBeenCalled();
    expect(setup.bulkUpdate).not.toHaveBeenCalled();
    expect(setup.changeColumn).not.toHaveBeenCalled();
  });

  it('retains legacy columns when both spellings exist and repairs nullable canonical values', async () => {
    const schema = canonicalSchema();
    schema.availabilities.createdAt = timestampColumn(true, 'now()');
    schema.availabilities.updatedAt = timestampColumn(true, 'now()');
    schema.availabilities.created_at = timestampColumn();
    schema.availabilities.updated_at = timestampColumn();
    const setup = createContext(schema);

    await up({ context: setup.context });

    expect(setup.renameColumn).not.toHaveBeenCalled();
    expect(setup.bulkUpdate).toHaveBeenCalledTimes(2);
    expect(setup.changeColumn).toHaveBeenCalledTimes(2);
    expect(setup.state.availabilities).toHaveProperty('created_at');
    expect(setup.state.availabilities).toHaveProperty('updated_at');
  });

  it('recovers a table missing both timestamp spellings without nullable results', async () => {
    const schema = canonicalSchema();
    schema.booking_addons = {};
    const setup = createContext(schema);

    await up({ context: setup.context });

    expect(setup.addColumn).toHaveBeenCalledTimes(2);
    expect(setup.bulkUpdate).toHaveBeenCalledTimes(2);
    expect(setup.changeColumn).toHaveBeenCalledTimes(2);
    expect(setup.state.booking_addons).toEqual({
      createdAt: timestampColumn(),
      updatedAt: timestampColumn(),
    });
  });

  it('verifies the complete physical timestamp contract', async () => {
    const valid = createContext(canonicalSchema());
    await expect(verify({ context: valid.context })).resolves.toEqual({
      ok: true,
      details: {
        missingColumns: [],
        nullableColumns: [],
        columnsWithDefaults: [],
        invalidTypes: [],
      },
    });

    const schema = canonicalSchema();
    delete schema.availabilities.createdAt;
    schema.booking_addons.updatedAt = timestampColumn(true);
    schema.booking_emails.createdAt = timestampColumn(false, 'now()');
    schema.booking_events.updatedAt = {
      ...timestampColumn(),
      type: 'TIMESTAMP WITHOUT TIME ZONE',
    };
    const invalid = createContext(schema);
    await expect(verify({ context: invalid.context })).resolves.toEqual({
      ok: false,
      details: {
        missingColumns: ['availabilities.createdAt'],
        nullableColumns: ['booking_addons.updatedAt'],
        columnsWithDefaults: ['booking_emails.createdAt'],
        invalidTypes: ['booking_events.updatedAt'],
      },
    });
  });

  it('has an intentionally non-destructive rollback', async () => {
    const setup = createContext(canonicalSchema());

    await down();

    expect(setup.renameColumn).not.toHaveBeenCalled();
    expect(setup.addColumn).not.toHaveBeenCalled();
    expect(setup.changeColumn).not.toHaveBeenCalled();
  });
});
