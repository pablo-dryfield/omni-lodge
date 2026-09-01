import type { Response } from 'express';

jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/BookingEmail.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/EmailTemplate.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Channel.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ChannelCommission.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Guest.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductAlias.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/ProductAddon.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontOrder.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontOrderItem.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/RequiredAction.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/storefrontBookingActivityService.js', () => ({
  getBookingStorefrontActivity: jest.fn(),
}));
jest.mock('../../finance/services/stripeClient.js', () => ({
  getStripeClient: jest.fn(),
  getStripeTestClient: jest.fn(),
}));
jest.mock('../../services/bookings/bookingIngestionService.js', () => ({
  ingestAllBookingEmails: jest.fn(),
  ingestLatestBookingEmails: jest.fn(),
  processBookingEmail: jest.fn(),
}));
jest.mock('../../services/bookings/gmailClient.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn() },
));
jest.mock('../../services/emailTemplates/emailTemplateRenderer.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn() },
));
jest.mock('../../services/bookings/ecwidUtmSyncService.js', () => ({
  syncEcwidBookingUtmByBookingId: jest.fn(),
}));
jest.mock('../../services/ecwidService.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn() },
));
jest.mock('../../services/bookings/customerEmailActionRules.js', () => ({
  customerEmailActionTargetsUser: jest.fn(),
}));
jest.mock('../../services/directBookingActionEmailService.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn() },
));
jest.mock('../../services/storefrontOrderEmailService.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn() },
));
jest.mock('../../services/storefrontCartRecoveryEmailService.js', () => ({
  buildStorefrontCartRecoveryEmail: jest.fn(),
}));
jest.mock('../directBookingIntegrationController.js', () => new Proxy(
  { __esModule: true },
  { get: (target, key) => key === '__esModule' ? target.__esModule : jest.fn() },
));
jest.mock('../../services/counterRegistryService.js', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('../../services/bookings/customerEmailThreadService.js', () => ({
  recordCustomerEmailThreadParticipant: jest.fn(),
}));
jest.mock('../../services/bookings/customerEmailActionService.js', () => ({
  resolveCustomerEmailActionsForReply: jest.fn(),
}));
jest.mock('../../services/inventoryService.js', () => ({
  getTshirtVariantAvailability: jest.fn(),
}));
jest.mock('../../services/configService.js', () => ({
  getConfigValue: jest.fn(),
}));
jest.mock('../../utils/ecwidAdapter.js', () => ({
  groupOrdersForManifest: jest.fn(),
  transformEcwidOrders: jest.fn(),
}));
jest.mock('../../models/BookingAddon.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Addon.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Counter.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/CounterChannelMetric.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../services/productScopeService.js', () => ({
  getAllowedProductTypeIds: jest.fn(),
}));
jest.mock('../../middleware/authorizationMiddleware.js', () => ({
  hasModuleActionPermission: jest.fn(),
}));
jest.mock('../../finance/middleware/financeAccessMiddleware.js', () => ({
  FINANCE_ALLOWED_ROLES: ['admin', 'manager', 'assistant-manager', 'owner'],
}));
jest.mock('../../finance/services/bookingSummaryExpenseService.js', () => ({
  getBookingSummaryCostInsights: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import Booking from '../../models/Booking.js';
import Addon from '../../models/Addon.js';
import Counter from '../../models/Counter.js';
import { getAllowedProductTypeIds } from '../../services/productScopeService.js';
import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware.js';
import { getBookingSummaryCostInsights } from '../../finance/services/bookingSummaryExpenseService.js';
import logger from '../../utils/logger.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import { listBookings } from '../bookingController.js';

const bookingFindAll = Booking.findAll as jest.Mock;
const addonFindAll = Addon.findAll as jest.Mock;
const counterFindAll = Counter.findAll as jest.Mock;
const allowedProductTypes = getAllowedProductTypeIds as jest.Mock;
const hasPermission = hasModuleActionPermission as jest.Mock;
const getCostInsights = getBookingSummaryCostInsights as jest.Mock;

const makeRequest = (
  query: Record<string, string>,
  roleSlug: string | null = 'owner',
): AuthenticatedRequest => ({
  query,
  authContext: {
    id: 7,
    userTypeId: 2,
    roleSlug,
  },
} as unknown as AuthenticatedRequest);

const makeResponse = (): Response => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  (res.status as jest.Mock).mockReturnValue(res);
  return res;
};

describe('listBookings costInsights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bookingFindAll.mockResolvedValue([]);
    addonFindAll.mockResolvedValue([]);
    counterFindAll.mockResolvedValue([]);
    allowedProductTypes.mockResolvedValue(null);
    hasPermission.mockResolvedValue(true);
    getCostInsights.mockResolvedValue({
      otherExpenses: {
        baseCurrency: 'PLN',
        baseAmountMinor: 12345,
        transactionCount: 3,
        dateBasis: 'finance_transaction_date',
        productTypeScoped: false,
      },
    });
  });

  it('loads the exact selected range only when explicitly requested and authorized', async () => {
    const req = makeRequest({
      pickupFrom: '2026-08-03',
      pickupTo: '2026-08-17',
      includeCostInsights: 'true',
    });
    const res = makeResponse();

    await listBookings(req, res);

    expect(hasPermission).toHaveBeenCalledWith(req, 'finance-transactions', 'view');
    expect(getCostInsights).toHaveBeenCalledWith('2026-08-03', '2026-08-17');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      costInsights: expect.objectContaining({
        otherExpenses: expect.objectContaining({ baseAmountMinor: 12345 }),
      }),
    }));
  });

  it.each([
    ['not requested', {}, 'owner'],
    ['outside Finance role boundary', { includeCostInsights: 'true' }, 'guide'],
  ])('returns null without a Finance query when %s', async (_label, extraQuery, roleSlug) => {
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      ...extraQuery,
    }, roleSlug);
    const res = makeResponse();

    await listBookings(req, res);

    expect(getCostInsights).not.toHaveBeenCalled();
    if (roleSlug === 'guide') {
      expect(hasPermission).not.toHaveBeenCalled();
    }
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ costInsights: null }));
  });

  it('returns null without querying when Finance transaction view permission is absent', async () => {
    hasPermission.mockResolvedValue(false);
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeCostInsights: 'true',
    });
    const res = makeResponse();

    await listBookings(req, res);

    expect(getCostInsights).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ costInsights: null }));
  });

  it('logs an aggregate failure and still returns the bookings response', async () => {
    getCostInsights.mockRejectedValue(new Error('finance unavailable'));
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeCostInsights: 'true',
    });
    const res = makeResponse();

    await listBookings(req, res);

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to load Booking Summary Other Expenses',
      expect.any(Error),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ costInsights: null }));
  });

  it('preserves ordersOnly response and never enters the cost-insight flow', async () => {
    const req = makeRequest({
      pickupFrom: '2026-08-01',
      pickupTo: '2026-08-31',
      includeCostInsights: 'true',
      ordersOnly: 'true',
    });
    const res = makeResponse();

    await listBookings(req, res);

    expect(hasPermission).not.toHaveBeenCalled();
    expect(getCostInsights).not.toHaveBeenCalled();
    expect(addonFindAll).not.toHaveBeenCalled();
    expect(counterFindAll).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      total: 0,
      count: 0,
      products: [],
      orders: [],
    });
  });
});
