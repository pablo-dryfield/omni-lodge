jest.mock('../../models/StorefrontOrder.js', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('../../models/StorefrontOrderItem.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

import StorefrontOrder from '../../models/StorefrontOrder';
import StorefrontOrderItem from '../../models/StorefrontOrderItem';
import { findLockedStorefrontOrderWithItems } from '../storefrontOrderPersistenceService';

const mockOrderFindOne = StorefrontOrder.findOne as jest.Mock;
const mockItemFindAll = StorefrontOrderItem.findAll as jest.Mock;

describe('findLockedStorefrontOrderWithItems', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('locks the order without an eager-loading join and loads items separately', async () => {
    const order = { id: 6, items: undefined };
    const items = [{ id: 10 }, { id: 11 }];
    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
    mockOrderFindOne.mockResolvedValue(order);
    mockItemFindAll.mockResolvedValue(items);

    const result = await findLockedStorefrontOrderWithItems('order-public-id', transaction);

    expect(mockOrderFindOne).toHaveBeenCalledWith({
      where: { publicId: 'order-public-id' },
      transaction,
      lock: 'UPDATE',
    });
    expect(mockOrderFindOne.mock.calls[0][0]).not.toHaveProperty('include');
    expect(mockItemFindAll).toHaveBeenCalledWith({
      where: { orderId: 6 },
      order: [['id', 'ASC']],
      transaction,
    });
    expect(result?.items).toEqual(items);
  });

  it('does not query items when the order does not exist', async () => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' } } as never;
    mockOrderFindOne.mockResolvedValue(null);

    await expect(
      findLockedStorefrontOrderWithItems('missing-order', transaction),
    ).resolves.toBeNull();
    expect(mockItemFindAll).not.toHaveBeenCalled();
  });
});
