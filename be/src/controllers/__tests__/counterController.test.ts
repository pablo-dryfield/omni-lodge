jest.mock('../../services/counterRegistryService.js', () => ({
  __esModule: true,
  default: {
    getCounterById: jest.fn(),
    updateCounterMetadata: jest.fn(),
    upsertMetrics: jest.fn(),
  },
}));
jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Counter.js', () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), getAttributes: jest.fn(() => ({})), sequelize: null },
}));
jest.mock('../../models/CounterProduct.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CounterUser.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/CounterChannelMetric.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReport.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReportPhoto.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/NightReportVenue.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/productScopeService.js', () => ({
  getAllowedProductTypeIds: jest.fn(),
  requireProductAccess: jest.fn(),
}));
jest.mock('../../services/nightReportStorageService.js', () => ({
  deleteNightReportPhoto: jest.fn(),
}));
jest.mock('../../services/ecwidService.js', () => ({
  createEcwidBatchRequest: jest.fn(),
}));
jest.mock('../../services/inventoryService.js', () => ({
  reconcileCounterInventory: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

import Booking from '../../models/Booking';
import Counter from '../../models/Counter';
import CounterRegistryService from '../../services/counterRegistryService';
import { finalizeCounterReservations } from '../counterController';

const mockBookingFindAll = Booking.findAll as jest.Mock;
const mockCounterFindByPk = Counter.findByPk as jest.Mock;
const mockGetCounterById = CounterRegistryService.getCounterById as jest.Mock;

describe('finalizeCounterReservations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists attended storefront add-ons instead of clamping them to zero', async () => {
    const booking = {
      id: 9918,
      platform: 'omnilodge',
      platformBookingId: '491630b4-2709-4cc0-8d81-f90a46cec0f9-39',
      status: 'confirmed',
      attendanceStatus: 'pending',
      partySizeTotal: 4,
      partySizeAdults: 4,
      partySizeChildren: 0,
      addonsSnapshot: {
        addons: [{ addonId: 1, name: 'Cocktails', quantity: 4 }],
        partyBreakdown: { men: 4, women: 0 },
      },
      attendedTotal: null,
      attendedAddonsSnapshot: null,
      attendedTshirtSizes: null,
      checkedInAt: null,
      checkedInBy: null,
      updatedBy: null,
      addonRefundActions: null,
      save: jest.fn().mockResolvedValue(undefined),
    };
    mockBookingFindAll.mockResolvedValue([booking]);
    mockCounterFindByPk.mockResolvedValue(null);
    mockGetCounterById.mockResolvedValue({ counter: { id: 920 } });

    const response = {
      status: jest.fn(),
      json: jest.fn(),
    };
    response.status.mockReturnValue(response);

    await finalizeCounterReservations(
      {
        query: { format: 'registry' },
        params: { id: '920' },
        body: {
          attendanceUpdates: [
            {
              bookingId: 9918,
              attendedTotal: 4,
              attendedExtras: { cocktails: 4, tshirts: 0, photos: 0 },
            },
          ],
        },
        authContext: { id: 191 },
      } as never,
      response as never,
    );

    expect(booking.save).toHaveBeenCalledTimes(1);
    expect(booking.attendedTotal).toBe(4);
    expect(booking.attendedAddonsSnapshot).toEqual({
      cocktails: 4,
      tshirts: 0,
      photos: 0,
    });
    expect(booking.attendanceStatus).toBe('checked_in_full');
    expect(response.status).toHaveBeenCalledWith(200);
  });
});
