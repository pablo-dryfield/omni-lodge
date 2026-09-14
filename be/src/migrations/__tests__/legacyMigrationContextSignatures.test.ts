import type { QueryInterface } from 'sequelize';

import * as staffPayoutCollectionLogs from '../202511270100-staff-payout-collection-logs.js';
import * as staffPayoutLedgers from '../202511270200-staff-payout-ledgers.js';
import * as venueCompensationLedgers from '../202511270210-venue-compensation-ledgers.js';
import * as compensationComponentDefaultFinance from '../202511270230-compensation-component-default-finance.js';
import * as staffPayoutLedgersDedupe from '../202511300900-staff-payout-ledgers-dedupe.js';
import * as venueCompensationLedgersDedupe from '../202511300905-venue-compensation-ledgers-dedupe.js';

type Migration = {
  up: (params: { context: QueryInterface }) => Promise<void>;
  down: (params: { context: QueryInterface }) => Promise<void>;
};

const migrations: Array<[string, Migration]> = [
  ['staff payout collection logs', staffPayoutCollectionLogs],
  ['staff payout ledgers', staffPayoutLedgers],
  ['venue compensation ledgers', venueCompensationLedgers],
  ['compensation component default finance', compensationComponentDefaultFinance],
  ['staff payout ledgers dedupe', staffPayoutLedgersDedupe],
  ['venue compensation ledgers dedupe', venueCompensationLedgersDedupe],
];

const createContext = (): QueryInterface => {
  const transaction = {};
  return {
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    addColumn: jest.fn().mockResolvedValue(undefined),
    removeColumn: jest.fn().mockResolvedValue(undefined),
    addIndex: jest.fn().mockResolvedValue(undefined),
    removeIndex: jest.fn().mockResolvedValue(undefined),
    sequelize: {
      query: jest.fn().mockResolvedValue(undefined),
      transaction: jest.fn(async (callback: (value: object) => Promise<void>) => callback(transaction)),
    },
  } as unknown as QueryInterface;
};

describe.each(migrations)('%s migration', (_name, migration) => {
  it('accepts the Umzug context contract for up and down', async () => {
    const context = createContext();

    await expect(migration.up({ context })).resolves.toBeUndefined();
    await expect(migration.down({ context })).resolves.toBeUndefined();
  });
});

describe('legacy ENUM-backed rollback calls', () => {
  it.each([
    ['staff payout collection logs', staffPayoutCollectionLogs],
    ['venue compensation ledgers', venueCompensationLedgers],
  ])('%s supplies a dropTable options object', async (_name, migration) => {
    const context = createContext();

    await migration.down({ context });

    expect(context.dropTable).toHaveBeenCalledWith(expect.any(String), {});
  });
});
