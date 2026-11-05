jest.mock('../../services/staffPaidTicketService.js', () => ({ saveStaffPaidTickets: jest.fn().mockResolvedValue(false) }));
import { saveStaffFreeChanges } from '../../services/staffFreeEntryService';
jest.mock('../../services/walkInPaymentService.js', () => ({ validateCounterWalkInNotes: jest.fn(async (notes: unknown) => notes) }));
jest.mock('../../services/staffFreeEntryService.js', () => ({ reconcileStaffFreeAllowances: jest.fn(), saveStaffFreeChanges: jest.fn() }));
jest.mock('../../models/StaffFreeEntry.js', () => ({ __esModule: true, default: { count: jest.fn().mockResolvedValue(0) } }));
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
import { commitCounterRegistry, finalizeCounterReservations } from '../counterController';
import { validateCounterWalkInNotes } from '../../services/walkInPaymentService';

const mockBookingFindAll = Booking.findAll as jest.Mock;
const mockCounterFindByPk = Counter.findByPk as jest.Mock;
const mockGetCounterById = CounterRegistryService.getCounterById as jest.Mock;
const mockUpsertMetrics = CounterRegistryService.upsertMetrics as jest.Mock;

it('rejects invalid Walk-Ins payment details before changing metrics', async () => {
  mockUpsertMetrics.mockClear();
  (validateCounterWalkInNotes as jest.Mock).mockRejectedValueOnce(new Error('Invalid payment method'));
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await commitCounterRegistry({ params: { id: '920' }, query: { format: 'registry' }, authContext: { id: 1 }, body: { notes: 'invalid', metrics: [] } } as never, response as never);
  expect(mockUpsertMetrics).not.toHaveBeenCalled();
  expect(response.json).toHaveBeenCalled();
});

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
    expect(mockUpsertMetrics).toHaveBeenCalledWith(920, [], 191);
    expect(response.status).toHaveBeenCalledWith(200);
  });
});


describe.each([commitCounterRegistry, finalizeCounterReservations])('counter save with Staff Free drafts', save => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCounterById.mockResolvedValue({ counter: { id: 920 } });
  });
  const request = (roleSlug = 'manager') => ({ params: { id: '920' }, query: { format: 'registry' }, authContext: { id: 99, roleSlug }, body: {
    metrics: [], notes: 'Current Walk-In prices', status: 'final', staffFreeChanges: { additions: [{ userId: 7 }], removals: [] },
  } });
  const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
  it('persists current prices first, staff second, and final status last', async () => {
    const calls: string[] = [];
    (CounterRegistryService.updateCounterMetadata as jest.Mock).mockImplementation(async (_id, value) => { calls.push(value.status ? 'final' : 'notes'); return { counter: { id: 920 } }; });
    (saveStaffFreeChanges as jest.Mock).mockImplementation(async () => { calls.push('staff'); });
    await save(request() as never, response() as never);
    expect(calls).toEqual(['notes', 'staff', 'final']);
    expect(saveStaffFreeChanges).toHaveBeenCalledWith(920, { additions: [{ userId: 7, overrideReason: undefined }], removals: [] }, 99);
  });
  it('rejects unauthorized staff changes before modifying counter data', async () => {
    const res = response();
    await save(request('guide') as never, res as never);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockUpsertMetrics).not.toHaveBeenCalled();
    expect(CounterRegistryService.updateCounterMetadata).not.toHaveBeenCalled();
    expect(saveStaffFreeChanges).not.toHaveBeenCalled();
  });
  it('does not finalize when staff validation fails', async () => {
    (saveStaffFreeChanges as jest.Mock).mockRejectedValueOnce(new Error('Allowance exhausted'));
    const res = response();
    await save(request() as never, res as never);
    expect(CounterRegistryService.updateCounterMetadata).not.toHaveBeenCalledWith(920, expect.objectContaining({ status: 'final' }), 99);
    expect(res.status).not.toHaveBeenCalledWith(200);
  });
});
