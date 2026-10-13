import type { QueryInterface } from 'sequelize';

import { down, up } from '../202610130001-direct-booking-stripe-merchant.js';

const createContext = () => {
  const addColumn = jest.fn().mockResolvedValue(undefined);
  const removeColumn = jest.fn().mockResolvedValue(undefined);
  return {
    context: { addColumn, removeColumn } as unknown as QueryInterface,
    addColumn,
    removeColumn,
  };
};

describe('direct booking Stripe merchant migration', () => {
  it('adds a nullable merchant marker to bookings', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.addColumn).toHaveBeenCalledWith(
      'bookings',
      'stripe_merchant',
      expect.objectContaining({ allowNull: true }),
    );
  });

  it('removes the merchant marker on rollback', async () => {
    const setup = createContext();

    await down({ context: setup.context });

    expect(setup.removeColumn).toHaveBeenCalledWith('bookings', 'stripe_merchant');
  });
});
