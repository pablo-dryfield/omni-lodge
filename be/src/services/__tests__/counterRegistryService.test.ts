jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/Counter.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CounterChannelMetric.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), bulkCreate: jest.fn() },
}));
jest.mock('../../models/CounterUser.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Channel.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/PaymentMethod.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Addon.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ChannelProductPrice.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/UserType.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftTypeProduct.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftInstance.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftAssignment.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/UserShiftRole.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReport.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../inventoryService.js', () => ({
  reconcileCounterInventory: jest.fn(),
}));

import sequelize from '../../config/database';
import Addon from '../../models/Addon';
import Booking from '../../models/Booking';
import Channel from '../../models/Channel';
import CounterChannelMetric from '../../models/CounterChannelMetric';
import CounterRegistryService from '../counterRegistryService';

const mockTransaction = sequelize.transaction as jest.Mock;
const mockAddonFindAll = Addon.findAll as jest.Mock;
const mockBookingFindAll = Booking.findAll as jest.Mock;
const mockChannelFindAll = Channel.findAll as jest.Mock;
const mockMetricFindAll = CounterChannelMetric.findAll as jest.Mock;
const mockMetricBulkCreate = CounterChannelMetric.bulkCreate as jest.Mock;

describe('CounterRegistryService.upsertMetrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation(async (callback: (transaction: object) => unknown) => callback({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rebuilds booked and attended add-on metrics from a storefront snapshot', async () => {
    const counter = {
      id: 920,
      date: '2026-08-20',
      productId: 28,
    };
    jest.spyOn(CounterRegistryService, 'loadCounterById').mockResolvedValue(counter as never);
    jest.spyOn(CounterRegistryService, 'buildContext').mockResolvedValue({
      counter,
      channels: [
        {
          id: 15,
          name: 'OmniLodge',
          sortOrder: 0,
          paymentMethodId: null,
          paymentMethodName: 'Card',
          cashPrice: null,
          cashPaymentEligible: false,
          walkInTicketPrices: [],
        },
      ],
      addons: [
        {
          addonId: 1,
          name: 'Cocktails',
          key: 'cocktails',
          maxPerAttendee: null,
          sortOrder: 0,
        },
      ],
      product: null,
    } as never);
    mockChannelFindAll.mockResolvedValue([
      {
        id: 15,
        name: 'OmniLodge',
        paymentMethodId: null,
        paymentMethod: { name: 'Card' },
      },
    ]);
    mockAddonFindAll.mockResolvedValue([{ id: 1, name: 'Cocktails' }]);
    mockBookingFindAll.mockResolvedValue([
      {
        id: 9918,
        platform: 'omnilodge',
        status: 'confirmed',
        guestEmail: 'guest@example.com',
        guestFirstName: 'Konstantin',
        guestLastName: 'Jäger',
        sourceReceivedAt: new Date('2026-08-20T18:00:00.000Z'),
        partySizeTotal: 4,
        partySizeAdults: 4,
        partySizeChildren: 0,
        addonsSnapshot: {
          addons: [{ addonId: 1, name: 'Cocktails', quantity: 4 }],
          partyBreakdown: { men: 4, women: 0 },
        },
        attendedTotal: 4,
        attendedAddonsSnapshot: { cocktails: 4, tshirts: 0, photos: 0 },
        addonRefundActions: null,
        attendanceStatus: 'checked_in_full',
      },
    ]);
    mockMetricFindAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockMetricBulkCreate.mockResolvedValue([]);

    await CounterRegistryService.upsertMetrics(920, [], 191);

    expect(mockMetricBulkCreate).toHaveBeenCalledTimes(1);
    expect(mockMetricBulkCreate.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          counterId: 920,
          channelId: 15,
          kind: 'addon',
          addonId: 1,
          tallyType: 'booked',
          period: 'before_cutoff',
          qty: 4,
        }),
        expect.objectContaining({
          counterId: 920,
          channelId: 15,
          kind: 'addon',
          addonId: 1,
          tallyType: 'attended',
          period: null,
          qty: 4,
        }),
      ]),
    );
  });
});
