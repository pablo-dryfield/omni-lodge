import sequelize from '../../config/database';
import StorefrontOrder from '../../models/StorefrontOrder';
import StorefrontOrderItem from '../../models/StorefrontOrderItem';
import { getStorefrontStripeClient } from '../../finance/services/stripeClient';
import { quoteStorefrontCart } from '../../services/storefrontCommerceService';
import { getUsableOngoingCart, assertOngoingCartVersion } from '../../services/storefrontOngoingCartService';
import { checkoutSelectionFingerprint } from '../../services/storefrontCheckoutProtectionService';
import { createCheckout } from '../storefrontCommerceController';

jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), create: jest.fn() } }));
jest.mock('../../models/StorefrontOrderItem.js', () => ({ __esModule: true, default: { destroy: jest.fn(), bulkCreate: jest.fn() } }));
jest.mock('../../models/StorefrontOngoingCart.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../models/StorefrontSavedCart.js', () => ({ __esModule: true, default: {} }));
jest.mock('../../finance/services/stripeClient.js', () => ({
  getStorefrontStripeClient: jest.fn(), getStorefrontStripePublishableKey: () => 'pk_test_fixture',
  isStorefrontStripeConfigured: () => true,
}));
jest.mock('../../services/storefrontCommerceService.js', () => ({ quoteStorefrontCart: jest.fn() }));
jest.mock('../../services/storefrontOngoingCartService.js', () => ({
  getUsableOngoingCart: jest.fn(), assertOngoingCartVersion: jest.fn(),
  recordOngoingCartEvent: jest.fn(), recordOngoingCartEventByIdentity: jest.fn(),
  markOngoingCartConverted: jest.fn(), resetOngoingCartCheckoutActivity: jest.fn(),
}));
jest.mock('../../services/storefrontJourneyService.js', () => ({ ingestClientJourneyEvents: async () => ({ acceptedEventIds: [] }) }));
jest.mock('../../services/storefrontOrderEmailService.js', () => ({ deliverStorefrontOrderEmails: jest.fn() }));
jest.mock('../../services/storefrontOrderPersistenceService.js', () => ({ findLockedStorefrontOrderWithItems: jest.fn() }));
jest.mock('../../services/storefrontOrderProjectionService.js', () => ({ projectStorefrontOrderBookings: jest.fn() }));
jest.mock('../../services/storefrontOrderResourceReservationService.js', () => ({ consumeStorefrontOrderResourceReservations: jest.fn(), incrementStorefrontPromotionRedemptions: jest.fn() }));
jest.mock('../../services/bookings/tshirtSizeEmailAutomationService.js', () => ({ maybeSendTshirtSizeSelectionEmail: jest.fn() }));
jest.mock('../../services/storefrontPublicConfigService.js', () => ({ getStorefrontPublicConfig: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));

const model = StorefrontOrder as unknown as { findByPk: jest.Mock; create: jest.Mock };
const items = StorefrontOrderItem as unknown as { destroy: jest.Mock; bulkCreate: jest.Mock };
const retrieve = jest.fn(), cancel = jest.fn(), create = jest.fn();
const customer = { firstName: 'Booking', lastName: 'Test', email: 'booking@example.invalid', phone: '+48500100200', countryCode: 'PL' };
const quote = { currency: 'PLN', subtotal: 120, addonTotal: 44, discountTotal: 0, total: 164,
  discountCode: null, discountCodes: [], promotionId: null, discounts: [],
  items: [{ productId: 28, productName: 'Pub Crawl', productSlug: 'pub-crawl-28', quantity: 1,
    experienceDate: '2030-12-14', experienceTime: '21:00', unitPrice: 120, baseTotal: 120,
    addonTotal: 44, total: 164, addons: [{ addonId: 2, quantity: 1, value: 'XL', unitPrice: 44, total: 44 }], options: {} }],
};
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
let original: { id: number; publicId: string; status: string; paymentStatus: string; stripePaymentIntentId: string; metadata: Record<string, unknown>; total: number; update: jest.Mock };
let replacement: { id: number; publicId: string; update: jest.Mock };
const request = { body: { customer, cart: { items: [] }, ongoingCartPublicId: 'cart-current', cartVersionProtocol: 1, cartVersion: 'a'.repeat(64) } };
const run = async () => {
  const next = jest.fn(), json = jest.fn(), status = jest.fn().mockReturnValue({ json });
  await createCheckout(request as never, { status, json } as never, next);
  return { next, json, status };
};
beforeEach(() => {
  jest.resetAllMocks();
  original = { id: 9, publicId: 'order-original', status: 'pending_payment', paymentStatus: 'unpaid',
    stripePaymentIntentId: 'pi_original', metadata: { checkoutSelectionFingerprint: 'older-selection' }, total: 120, update: jest.fn() };
  replacement = { id: 10, publicId: 'order-replacement', update: jest.fn() };
  model.findByPk.mockResolvedValue(original);
  model.create.mockResolvedValue(replacement);
  (sequelize.transaction as jest.Mock).mockImplementation(callback => callback(transaction));
  (quoteStorefrontCart as jest.Mock).mockResolvedValue(quote);
  (getUsableOngoingCart as jest.Mock).mockResolvedValue({ id: 22, publicId: 'cart-current', orderId: 9 });
  (getStorefrontStripeClient as jest.Mock).mockReturnValue({ paymentIntents: { retrieve, cancel, create } });
  retrieve.mockResolvedValue({ id: 'pi_original', status: 'requires_payment_method', amount: 12000, currency: 'pln' });
  cancel.mockResolvedValue({ id: 'pi_original', status: 'canceled' });
  create.mockResolvedValue({ id: 'pi_replacement', client_secret: 'test-only' });
});

it('cancels before replacing a selection, retaining the old order items and total for audit', async () => {
  const { next, json } = await run();
  expect(next).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledWith('pi_original', { cancellation_reason: 'abandoned' });
  expect(cancel.mock.invocationCallOrder[0]).toBeLessThan((sequelize.transaction as jest.Mock).mock.invocationCallOrder[0]);
  expect(original.update).toHaveBeenCalledWith({ status: 'cancelled', metadata: expect.objectContaining({ replacedByCheckoutSelection: expect.any(String) }) }, { transaction });
  expect(original.total).toBe(120);
  expect(items.destroy).not.toHaveBeenCalled();
  expect(items.bulkCreate).toHaveBeenCalledWith([expect.objectContaining({ orderId: 10, total: 164 })], { transaction });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ amount: 16400 }), {
    idempotencyKey: `storefront-checkout-order-replacement-${checkoutSelectionFingerprint(quote, customer)}`,
  });
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ publicId: 'order-replacement' }));
});

it('does not alter an order if confirmation wins the cancellation race', async () => {
  cancel.mockRejectedValue(new Error('Payment already submitted'));
  const { next } = await run();
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  expect(sequelize.transaction).not.toHaveBeenCalled();
  expect(original.update).not.toHaveBeenCalled();
  expect(items.destroy).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it('rechecks payment under the order lock when a webhook finished while checkout waited', async () => {
  model.findByPk.mockResolvedValueOnce(original).mockResolvedValueOnce({ ...original, paymentStatus: 'paid', status: 'confirmed' });
  const { next } = await run();
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  expect(original.update).not.toHaveBeenCalled();
  expect(items.bulkCreate).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

it('rejects an outdated device before it can cancel the current payment form', async () => {
  (assertOngoingCartVersion as jest.Mock).mockImplementation(() => { throw Object.assign(new Error('This cart changed on another device.'), { status: 409 }); });
  const { next } = await run();
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  expect(retrieve).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(sequelize.transaction).not.toHaveBeenCalled();
});

it('blocks a processing payment without creating or updating an order', async () => {
  retrieve.mockResolvedValue({ id: 'pi_original', status: 'processing' });
  const { next } = await run();
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));
  expect(sequelize.transaction).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it('reuses an identical unpaid intent instead of creating a duplicate payment attempt', async () => {
  original.metadata.checkoutSelectionFingerprint = checkoutSelectionFingerprint(quote, customer);
  retrieve.mockResolvedValue({ id: 'pi_original', status: 'requires_payment_method', amount: 16400, currency: 'pln', client_secret: 'test-only' });
  const { next, json } = await run();
  expect(next).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(model.create).not.toHaveBeenCalled();
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ publicId: 'order-original', paymentIntentId: 'pi_original' }));
});
