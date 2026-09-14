import type { QueryInterface } from 'sequelize';

import { down, up } from '../202602210001-booking-platform-dynamic-text.js';

const createContext = () => {
  const query = jest.fn().mockResolvedValue(undefined);
  return {
    context: { sequelize: { query } } as unknown as QueryInterface,
    query,
  };
};

const statements = (query: jest.Mock): string[] => query.mock.calls.map(([sql]) => String(sql));

describe('booking platform dynamic text migration', () => {
  it('detaches and restores the bookings default around the enum-to-text conversion', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    const sql = statements(setup.query);
    const dropDefaultIndex = sql.findIndex((value) => value.includes('DROP DEFAULT'));
    const convertIndex = sql.findIndex((value) => value.includes('TYPE VARCHAR(64)'));
    const restoreDefaultIndex = sql.findIndex((value) => value.includes("SET DEFAULT 'unknown'"));
    const dropTypeIndex = sql.findIndex((value) => value.includes('DROP TYPE IF EXISTS "enum_bookings_platform"'));

    expect(dropDefaultIndex).toBeGreaterThanOrEqual(0);
    expect(convertIndex).toBeGreaterThan(dropDefaultIndex);
    expect(restoreDefaultIndex).toBeGreaterThan(convertIndex);
    expect(dropTypeIndex).toBeGreaterThan(restoreDefaultIndex);
  });

  it('handles the text default when restoring the enum on rollback', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    const sql = statements(setup.query);
    const createTypeIndex = sql.findIndex((value) => value.includes('CREATE TYPE "enum_bookings_platform"'));
    const dropDefaultIndex = sql.findIndex((value) => value.includes('DROP DEFAULT'));
    const convertIndex = sql.findIndex((value) => (
      value.includes('ALTER TABLE "bookings"')
      && value.includes('ALTER COLUMN "platform" TYPE "enum_bookings_platform"')
    ));
    const restoreDefaultIndex = sql.findIndex((value) => value.includes(
      "SET DEFAULT 'unknown'::\"enum_bookings_platform\"",
    ));

    expect(dropDefaultIndex).toBeGreaterThan(createTypeIndex);
    expect(convertIndex).toBeGreaterThan(dropDefaultIndex);
    expect(restoreDefaultIndex).toBeGreaterThan(convertIndex);
  });
});
