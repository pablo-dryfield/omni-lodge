import Booking from '../../models/Booking.js';
import FinanceAccount from '../../finance/models/FinanceAccount.js';
import Product from '../../models/Product.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import User from '../../models/User.js';
import {
  listBankTransferOrders,
  previewBankTransferOrder,
  serializeBankTransferOrder,
} from '../storefrontBankTransferOrderService.js';
import { quoteStorefrontCart } from '../storefrontCommerceService.js';
import { normalizeSavedCartFromQuote } from '../storefrontSavedCartService.js';

jest.mock('../../config/database.js', () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
}));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/models/FinanceAccount.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn(), findByPk: jest.fn() },
}));
jest.mock('../../models/Currency.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
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
  normalizeStorefrontCurrencyCode: jest.fn((value: unknown) =>
    String(value ?? 'PLN').trim().toUpperCase() || 'PLN'),
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
  getStorefrontOrderConfirmationNotificationPreferences: jest.fn((order: { metadata?: Record<string, unknown> | null }) => {
    const source = order.metadata?.confirmationNotifications as
      | { customerConfirmation?: boolean; internalConfirmation?: boolean }
      | undefined;
    return {
      customerConfirmation: source?.customerConfirmation !== false,
      internalConfirmation: source?.internalConfirmation !== false,
    };
  }),
  isStorefrontOrderConfirmationEmailComplete: jest.fn(() => false),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn() },
}));

const orderModel = StorefrontOrder as unknown as { findAll: jest.Mock };
const financeAccountModel = FinanceAccount as unknown as { findByPk: jest.Mock };
const productModel = Product as unknown as { findAll: jest.Mock };
const bookingModel = Booking as unknown as { findAll: jest.Mock };
const userModel = User as unknown as { findAll: jest.Mock };
const quoteStorefrontCartMock = quoteStorefrontCart as jest.Mock;
const normalizeSavedCartFromQuoteMock = normalizeSavedCartFromQuote as jest.Mock;

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

  it('serializes saved confirmation notification preferences', async () => {
    const serialized = await serializeBankTransferOrder(buildOrder(8, 10, {
      confirmationNotifications: {
        customerConfirmation: false,
        internalConfirmation: true,
      },
    }));

    expect(serialized.notificationPreferences).toEqual({
      customerConfirmation: false,
      internalConfirmation: true,
    });
  });

  it('previews manual bank-transfer carts with the explicit past-date override', async () => {
    const cart = {
      items: [{ productId: 10, quantity: 1, experienceDate: '2026-09-12' }],
    };
    const quote = {
      currency: 'PLN',
      subtotal: 100,
      addonTotal: 0,
      discountTotal: 0,
      total: 100,
      discountCode: null,
      discountCodes: [],
      promotionId: null,
      discounts: [],
      items: [{ productId: 10 }],
    };
    quoteStorefrontCartMock.mockResolvedValue(quote);
    normalizeSavedCartFromQuoteMock.mockReturnValue({ items: quote.items });
    financeAccountModel.findByPk.mockResolvedValue({
      id: 4,
      name: 'ING EUR',
      type: 'bank',
      currency: 'PLN',
      accountHolderName: 'David Powe-Bowman',
      accountNumber: 'PL19105014451000009773406781',
      swiftCode: 'INGBPLPW',
      bankName: 'ING Bank Śląski S.A.',
      bankTransferInstructions: null,
      isActive: true,
    });

    const result = await previewBankTransferOrder({
      allowedProductTypeIds: null,
      cart,
      bankTransferAccountId: 4,
      allowPastExperienceDates: true,
    });

    expect(quoteStorefrontCartMock).toHaveBeenCalledWith(cart, undefined, {
      allowMissingCustomerDetails: true,
      allowPastExperienceDates: true,
      currencyCode: 'PLN',
    });
    expect(result).toEqual({
      quote,
      cart: { items: quote.items },
      bankTransferAccount: {
        financeAccountId: 4,
        accountName: 'ING EUR',
        accountType: 'bank',
        currency: 'PLN',
        accountHolderName: 'David Powe-Bowman',
        accountNumber: 'PL19105014451000009773406781',
        swiftCode: 'INGBPLPW',
        bankName: 'ING Bank Śląski S.A.',
        instructions: null,
      },
    });
  });

  it('passes a manual pre-discount amount into bank-transfer previews', async () => {
    const cart = {
      items: [{ productId: 10, quantity: 1, experienceDate: '2026-09-12' }],
    };
    const quote = {
      currency: 'EUR',
      subtotal: 28,
      addonTotal: 0,
      calculatedAmountBeforeDiscount: 27.83,
      amountBeforeDiscountOverride: 28,
      discountTotal: 0,
      total: 28,
      discountCode: null,
      discountCodes: [],
      promotionId: null,
      discounts: [],
      items: [{ productId: 10 }],
    };
    quoteStorefrontCartMock.mockResolvedValue(quote);
    normalizeSavedCartFromQuoteMock.mockReturnValue({ items: quote.items });
    financeAccountModel.findByPk.mockResolvedValue({
      id: 5,
      name: 'ING EUR',
      type: 'bank',
      currency: 'EUR',
      accountHolderName: 'David Powe-Bowman',
      accountNumber: 'PL19105014451000009773406781',
      swiftCode: 'INGBPLPW',
      bankName: 'ING Bank Śląski S.A.',
      bankTransferInstructions: null,
      isActive: true,
    });

    await previewBankTransferOrder({
      allowedProductTypeIds: null,
      cart,
      currencyCode: 'EUR',
      bankTransferAccountId: 5,
      amountBeforeDiscountOverride: '28',
    });

    expect(quoteStorefrontCartMock).toHaveBeenCalledWith(cart, undefined, {
      allowMissingCustomerDetails: true,
      allowPastExperienceDates: false,
      currencyCode: 'EUR',
      amountBeforeDiscountOverride: 28,
    });
  });
});
