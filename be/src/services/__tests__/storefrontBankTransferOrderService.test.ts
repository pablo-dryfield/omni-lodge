import Booking from '../../models/Booking.js';
import Product from '../../models/Product.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import User from '../../models/User.js';
import {
  listBankTransferOrders,
  serializeBankTransferOrder,
} from '../storefrontBankTransferOrderService.js';

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/StorefrontOrder.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../models/StorefrontOrderItem.js', () => ({
  __esModule: true,
  default: { bulkCreate: jest.fn() },
}));
jest.mock('../../models/User.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../controllers/storefrontCommerceController.js', () => ({ fulfillPaidOrder: jest.fn() }));
jest.mock('../storefrontCommerceService.js', () => ({
  STOREFRONT_CURRENCY: 'PLN',
  quoteStorefrontCart: jest.fn(),
}));
jest.mock('../storefrontSavedCartService.js', () => ({
  addCustomerToSavedCart: jest.fn(),
  normalizeSavedCartFromQuote: jest.fn(),
}));
jest.mock('../storefrontOrderResourceReservationService.js', () => ({
  lockStorefrontCartReservationResources: jest.fn(),
  releaseStorefrontOrderResourceReservations: jest.fn(),
  reserveStorefrontOrderResources: jest.fn(),
}));
jest.mock('../storefrontOrderPersistenceService.js', () => ({
  findLockedStorefrontOrderWithItems: jest.fn(),
}));
jest.mock('../storefrontOrderProjectionService.js', () => ({
  projectStorefrontOrderBookings: jest.fn(),
}));
jest.mock('../storefrontBankTransferCancellationPolicy.js', () => ({
  resolveBankTransferCancellation: jest.fn(),
}));
jest.mock('../storefrontBookingProjectionService.js', () => ({
  getStorefrontExperienceStartAt: jest.fn(),
}));
jest.mock('../storefrontBankTransferConfigService.js', () => ({
  getStorefrontBankTransferAccount: jest.fn(),
  getStorefrontBankTransferDueHours: jest.fn(),
}));
jest.mock('../storefrontOrderEmailService.js', () => ({
  deliverStorefrontBankTransferCancellationEmail: jest.fn(),
  deliverStorefrontBankTransferInstructionsEmail: jest.fn(),
  deliverStorefrontOrderEmails: jest.fn(),
  isStorefrontOrderConfirmationEmailComplete: jest.fn(() => false),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn() },
}));

const orderModel = StorefrontOrder as unknown as { findAll: jest.Mock };
const productModel = Product as unknown as { findAll: jest.Mock };
const bookingModel = Booking as unknown as { findAll: jest.Mock };
const userModel = User as unknown as { findAll: jest.Mock };

const buildOrder = (id: number, productId: number, metadata: Record<string, unknown> = {}) => ({
  id,
  publicId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  status: 'confirmed',
  paymentStatus: 'paid',
  paymentMethod: 'bank_transfer',
  paymentReference: `KTK-BT-${String(id).padStart(6, '0')}`,
  paymentDueAt: new Date('2026-09-10T12:00:00Z'),
  subtotal: 100,
  addonTotal: 0,
  discountTotal: 0,
  total: 100,
  currency: 'PLN',
  customerFirstName: 'Test',
  customerLastName: 'Guest',
  customerEmail: 'guest@example.com',
  customerPhone: null,
  customerCountryCode: null,
  createdByUserId: null,
  paymentReceivedByUserId: null,
  createdAt: new Date('2026-09-07T12:00:00Z'),
  paidAt: new Date('2026-09-07T12:05:00Z'),
  customerEmailSentAt: null,
  internalEmailSentAt: null,
  bankTransferEmailSentAt: null,
  bankTransferCancellationEmailSentAt: null,
  paymentNote: null,
  metadata,
  items: [{
    id,
    productId,
    productName: 'Pub Crawl',
    productSlug: 'pub-crawl-1',
    quantity: 1,
    experienceDate: '2026-09-10',
    experienceTime: '21:00',
    unitPrice: 100,
    baseTotal: 100,
    addonTotal: 0,
    total: 100,
    addons: [],
    options: {},
  }],
}) as unknown as StorefrontOrder;

describe('bank-transfer order listing and serialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bookingModel.findAll.mockResolvedValue([]);
    userModel.findAll.mockResolvedValue([]);
  });

  it('applies the paid-history limit after product scope filtering', async () => {
    productModel.findAll.mockResolvedValue([{ id: 10 }]);
    const inaccessiblePaid = Array.from({ length: 250 }, (_, index) => buildOrder(index + 1, 20));
    const accessiblePaid = buildOrder(251, 10);
    orderModel.findAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(inaccessiblePaid)
      .mockResolvedValueOnce([accessiblePaid]);

    const result = await listBankTransferOrders([1]);

    expect(result).toHaveLength(1);
    expect(result[0].publicId).toBe(accessiblePaid.publicId);
    expect(orderModel.findAll).toHaveBeenCalledTimes(3);
  });

  it('exposes the bank-statement reference recorded on payment', async () => {
    const serialized = await serializeBankTransferOrder(buildOrder(7, 10, {
      receivedPaymentReference: 'BANK-STATEMENT-42',
    }));

    expect(serialized.receivedPaymentReference).toBe('BANK-STATEMENT-42');
  });
});
