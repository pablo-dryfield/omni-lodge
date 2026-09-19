import type { QueryInterface } from 'sequelize';

import { down, up } from '../202512030005-booking-ingestion.js';

describe('booking ingestion migration', () => {
  it('passes dropTable options for an ENUM-backed registered bookings model', async () => {
    const dropTable = jest.fn().mockResolvedValue(undefined);
    const context = {
      dropTable,
      createTable: jest.fn().mockResolvedValue(undefined),
      addIndex: jest.fn().mockResolvedValue(undefined),
    } as unknown as QueryInterface;

    await up({ context });

    expect(dropTable).toHaveBeenCalledTimes(1);
    expect(dropTable).toHaveBeenCalledWith('bookings', {});
  });

  it('passes options when rollback drops every registered table', async () => {
    const dropTable = jest.fn().mockResolvedValue(undefined);
    const context = {
      dropTable,
      createTable: jest.fn().mockResolvedValue(undefined),
      addIndex: jest.fn().mockResolvedValue(undefined),
      sequelize: { query: jest.fn().mockResolvedValue(undefined) },
    } as unknown as QueryInterface;

    await down({ context });

    expect(dropTable.mock.calls.slice(0, 4)).toEqual([
      ['booking_addons', {}],
      ['booking_events', {}],
      ['booking_emails', {}],
      ['bookings', {}],
    ]);
  });
});
