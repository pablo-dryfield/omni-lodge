jest.mock('../../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../../models/Partner.js', () => ({ PartnerBooking: { findOne: jest.fn(), findByPk: jest.fn() }, PartnerEvent: { findOne: jest.fn() }, PartnerPayment: { findOrCreate: jest.fn(), findAll: jest.fn() }, PartnerAmendment: { count: jest.fn() } }));
jest.mock('../../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('../../../models/BookingEvent.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../../finance/services/stripeClient.js', () => ({ getStorefrontStripeClient: jest.fn() }));
jest.mock('../../configService.js', () => ({}));
jest.mock('../../bookings/gmailClient.js', () => ({ sendMessage: jest.fn() }));
jest.mock('../partnerEvents.js', () => ({ partnerEvent: jest.fn() }));
jest.mock('../partnerStripeService.js', () => ({ reconcilePartnerOrder: jest.fn() }));
import sequelize from '../../../config/database';
import { PartnerBooking, PartnerEvent, PartnerPayment, PartnerAmendment } from '../../../models/Partner';
import StorefrontOrder from '../../../models/StorefrontOrder';
import Booking from '../../../models/Booking';
import { getStorefrontStripeClient } from '../../../finance/services/stripeClient';
import { refundPartnerBooking } from '../partnerRefundService';
import { hashToken } from '../partnerPolicy';

let stripe: any;
let booking: any;
const context = { admin: true, actorId: 1, partner: { id: 9, agreement: {} } } as any;
beforeEach(() => {
  jest.resetAllMocks();
  booking = { id: 4, partnerId: 9, orderId: 55, paymentMode: 'platform', externalReference: 'booking-4', total: 100 };
  (sequelize.transaction as jest.Mock).mockImplementation(fn => fn({ LOCK: { UPDATE: 'update' } }));
  (PartnerBooking.findOne as jest.Mock).mockResolvedValue(booking);
  (PartnerBooking.findByPk as jest.Mock).mockResolvedValue(booking);
  (PartnerEvent.findOne as jest.Mock).mockResolvedValue(null);
  (PartnerAmendment.count as jest.Mock).mockResolvedValue(0);
  (PartnerPayment.findAll as jest.Mock).mockResolvedValue([{ id: 4, reference: 'initial', amount: 100, commission: 20, paymentIntentId: 'pi_55' }]);
  (StorefrontOrder.findByPk as jest.Mock).mockResolvedValue({ id: 55, publicId: 'order-55', stripePaymentIntentId: 'pi_55', paymentStatus: 'paid' });
  (Booking.findAll as jest.Mock).mockResolvedValue([]);
  stripe = { paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_55', status: 'succeeded', amount_received: 10000, currency: 'pln', metadata: { orderPublicId: 'order-55' }, latest_charge: { paid: true, amount: 10000, amount_refunded: 2000 } }) }, refunds: { list: jest.fn().mockResolvedValue({ data: [], has_more: false }), create: jest.fn().mockResolvedValue({ id: 're_test', amount: 3000, status: 'succeeded' }) } };
  (getStorefrontStripeClient as jest.Mock).mockReturnValue(stripe);
});
const body = { amount: 30, reason: 'Customer adjustment', reference: 'refund-1', notifyCustomer: false };
it('requires an explicit refund permission for external partner users', async () => {
  await expect(refundPartnerBooking({ ...context, admin: false }, 4, body)).rejects.toThrow(/does not permit/);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it('rejects an amount above Stripe remaining refundable balance', async () => {
  await expect(refundPartnerBooking(context, 4, { ...body, amount: 81 })).rejects.toThrow(/remaining/);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it('cannot refund another collector payment through the platform Stripe account', async () => {
  booking.paymentMode = 'partner';
  await expect(refundPartnerBooking(context, 4, body)).rejects.toThrow(/collecting party/);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it('verifies the merchant payment and uses a stable provider operation identity', async () => {
  const result = await refundPartnerBooking(context, 4, body);
  expect(result.refundId).toBe('re_test');
  expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 3000, payment_intent: 'pi_55' }), { idempotencyKey: `partner-refund-${hashToken('4:refund-1:4')}` });
});
it('recovers an existing provider refund after a database rollback without refunding twice', async () => {
  stripe.refunds.list.mockResolvedValue({ data: [{ id: 're_existing', amount: 3000, status: 'succeeded', metadata: { partnerOperation: hashToken('4:refund-1:4') } }], has_more: false });
  const result = await refundPartnerBooking(context, 4, body);
  expect(result.refundId).toBe('re_existing');
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it('returns the previous result for an exact replay but rejects an amount change', async () => {
  (PartnerEvent.findOne as jest.Mock).mockResolvedValue({ data: { refundId: 're_existing', amount: 30, status: 'succeeded' } });
  expect((await refundPartnerBooking(context, 4, body)).replay).toBe(true);
  await expect(refundPartnerBooking(context, 4, { ...body, amount: 40 })).rejects.toThrow(/another amount/);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
