jest.mock('../../models/CounterChannelMetric.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Counter.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/CounterProduct.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Channel.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/PaymentMethod.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Addon.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ProductAddon.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ProductType.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/ChannelCashCollectionLog.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../finance/models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: {},
}));

import Addon from '../../models/Addon';
import Channel from '../../models/Channel';
import Counter from '../../models/Counter';
import CounterChannelMetric from '../../models/CounterChannelMetric';
import CounterProduct from '../../models/CounterProduct';
import Product from '../../models/Product';
import ProductAddon from '../../models/ProductAddon';
import ProductType from '../../models/ProductType';
import { getChannelNumbersTrendBundle } from '../channelNumbersService';

const channelFindAll = Channel.findAll as jest.Mock;
const addonFindAll = Addon.findAll as jest.Mock;
const productAddonFindAll = ProductAddon.findAll as jest.Mock;
const productFindAll = Product.findAll as jest.Mock;
const productTypeFindAll = ProductType.findAll as jest.Mock;
const counterFindAll = Counter.findAll as jest.Mock;
const metricFindAll = CounterChannelMetric.findAll as jest.Mock;
const counterProductFindAll = CounterProduct.findAll as jest.Mock;

describe('getChannelNumbersTrendBundle', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    channelFindAll.mockResolvedValue([{ id: 10, name: 'Viator' }]);
    addonFindAll.mockResolvedValue([{ id: 7, name: 'Cocktails', isActive: true }]);
    productAddonFindAll.mockResolvedValue([
      {
        addonId: 7,
        productId: 22,
        maxPerAttendee: null,
        sortOrder: 0,
        product: {
          id: 22,
          name: 'Pub Crawl',
          productTypeId: 2,
          ProductType: { id: 2, name: 'Main Product' },
        },
      },
    ]);
    productFindAll.mockResolvedValue([
      {
        id: 22,
        name: 'Pub Crawl',
        productTypeId: 2,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        status: true,
      },
      {
        id: 101,
        name: 'Viator',
        productTypeId: 2,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        status: false,
      },
    ]);
    productTypeFindAll.mockResolvedValue([{ id: 2, name: 'Main Product' }]);
    counterFindAll.mockResolvedValue([
      { id: 1, date: '2025-08-16', productId: null },
      { id: 2, date: '2026-08-16', productId: 22 },
    ]);
    metricFindAll.mockResolvedValue([
      {
        counterId: 2,
        channelId: 10,
        kind: 'people',
        addonId: null,
        tallyType: 'booked',
        period: 'before_cutoff',
        qty: 5,
      },
      {
        counterId: 2,
        channelId: 10,
        kind: 'people',
        addonId: null,
        tallyType: 'attended',
        period: null,
        qty: 3,
      },
      {
        counterId: 2,
        channelId: 10,
        kind: 'addon',
        addonId: 7,
        tallyType: 'booked',
        period: 'before_cutoff',
        qty: 4,
      },
      {
        counterId: 2,
        channelId: 10,
        kind: 'addon',
        addonId: 7,
        tallyType: 'attended',
        period: null,
        qty: 1,
      },
    ]);
    counterProductFindAll.mockResolvedValue([
      { counterId: 1, productId: 101, quantity: 4, total: 0 },
    ]);
  });

  it('loads both years once and returns attended and clamped non-show values per bucket', async () => {
    const result = await getChannelNumbersTrendBundle({ referenceDate: '2026-08-31' });

    expect(result.currentYear).toBe(2026);
    expect(result.previousYear).toBe(2025);
    expect(result.current.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          counterId: 2,
          productId: 22,
          addonKey: null,
          attended: 3,
          nonShow: 2,
        }),
        expect.objectContaining({
          counterId: 2,
          productId: 22,
          addonKey: 'cocktails',
          attended: 1,
          nonShow: 3,
        }),
      ]),
    );
    expect(result.previous.entries).toEqual([
      expect.objectContaining({
        counterId: 1,
        productId: 22,
        channelName: 'Viator',
        attended: 4,
        nonShow: 0,
      }),
    ]);
    expect(result.previousYearMetadata.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 22, name: 'Pub Crawl', addonKeys: ['cocktails'] }),
      ]),
    );

    expect(channelFindAll).toHaveBeenCalledTimes(1);
    expect(addonFindAll).toHaveBeenCalledTimes(1);
    expect(productAddonFindAll).toHaveBeenCalledTimes(1);
    expect(productFindAll).toHaveBeenCalledTimes(1);
    expect(productTypeFindAll).toHaveBeenCalledTimes(1);
    expect(counterFindAll).toHaveBeenCalledTimes(1);
    expect(metricFindAll).toHaveBeenCalledTimes(1);
    expect(counterProductFindAll).toHaveBeenCalledTimes(1);
  });
});
