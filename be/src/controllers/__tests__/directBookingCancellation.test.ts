jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), sequelize: { transaction: jest.fn() } } }));
jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: { build: jest.fn() } }));
jest.mock('../../finance/services/stripeClient.js', () => ({
  getDirectStripeClient: jest.fn(), getStripeClient: jest.fn(),
  normalizeDirectStripeMerchant: (value: unknown) => value === 'food-tour' ? 'food-tour' : null,
}));
jest.mock('../../services/directBookingCancellationPolicy.js', () => ({
  ...jest.requireActual('../../services/directBookingCancellationPolicy.js'), assertDirectBookingCancellationAccess: jest.fn(),
}));
jest.mock('../../services/directBookingActionEmailService.js', () => ({
  sendDirectBookingActionEmail: jest.fn(), sendInternalDirectBookingActionEmail: jest.fn(),
}));
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import Booking from '../../models/Booking';
import BookingEvent from '../../models/BookingEvent';
import { getDirectStripeClient, getStripeClient } from '../../finance/services/stripeClient';
import { assertDirectBookingCancellationAccess } from '../../services/directBookingCancellationPolicy';
import { sendDirectBookingActionEmail, sendInternalDirectBookingActionEmail } from '../../services/directBookingActionEmailService';
import { cancelDirectBooking } from '../bookingController';
import HttpError from '../../errors/HttpError';

const stripe = { paymentIntents: { retrieve: jest.fn() }, charges: { retrieve: jest.fn() }, refunds: { create: jest.fn() } };
const transaction = {};
let booking: Booking;
let event: BookingEvent;
const req = () => ({ params: { bookingId: '10627' }, body: {}, authContext: { id: 215, userTypeId: 16, roleSlug: 'food-tour-owner' } } as unknown as AuthenticatedRequest);
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response);
beforeEach(() => {
  jest.clearAllMocks();
  booking = { id: 10627, platform: 'direct', platformBookingId: 'ftk_test', platformOrderId: 'pi_test',
    productId: 49, productName: 'Krakow: Late Night Bites Polish Street Food and Drinks Tour',
    paymentStatus: 'paid', paymentMethod: 'stripe', stripeMerchant: 'food-tour',
    status: 'confirmed', priceGross: '299.00', baseAmount: '299.00', refundedAmount: null, currency: 'PLN',
    notes: 'stripe mode: live', save: jest.fn() } as unknown as Booking;
  event = { save: jest.fn() } as unknown as BookingEvent;
  jest.mocked(Booking.findByPk).mockResolvedValue(booking);
  jest.mocked(BookingEvent.build).mockReturnValue(event);
  (Booking.sequelize!.transaction as jest.Mock).mockImplementation(callback => callback(transaction));
  jest.mocked(assertDirectBookingCancellationAccess).mockResolvedValue(undefined);
  jest.mocked(getDirectStripeClient).mockReturnValue(stripe as any);
  stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_test', amount_received: 29900, currency: 'pln', status: 'succeeded', latest_charge: { amount_refunded: 0 } });
  stripe.refunds.create.mockResolvedValue({ id: 're_test', amount: 29900 });
  jest.mocked(sendDirectBookingActionEmail).mockResolvedValue({ id: 'customer-mail' } as any);
  jest.mocked(sendInternalDirectBookingActionEmail).mockResolvedValue(null);
});
it.each(['Krakow: Late Night Bites Polish Street Food and Drinks Tour', 'Unrelated product'])(
  'cancels Direct %s using the saved merchant, refund idempotency, audit event and emails', async productName => {
    booking.productName = productName;
    const res = response(); await cancelDirectBooking(req(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(assertDirectBookingCancellationAccess).toHaveBeenCalledWith(expect.anything(), booking);
    expect(getDirectStripeClient).toHaveBeenCalledWith('food-tour', 'live');
    expect(getStripeClient).not.toHaveBeenCalled();
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_test', metadata: { bookingId: '10627', orderId: 'pi_test' } }), { idempotencyKey: 'booking-10627-cancel-0-29900' });
    expect(booking).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded', refundedAmount: '299.00', updatedBy: 215 });
    expect(event).toMatchObject({ bookingId: 10627, eventType: 'cancelled', eventPayload: expect.objectContaining({ action: 'cancel-direct-booking', actorId: 215, stripeMerchant: 'food-tour', stripeRefundId: 're_test', refundedAmount: 299 }) });
    expect(booking.save).toHaveBeenCalledWith({ transaction });
    expect(sendDirectBookingActionEmail).toHaveBeenCalledWith(booking, expect.objectContaining({ kind: 'cancellation', refundedAmount: 299 }));
  });
it('rejects a scoped authorization failure before reading Stripe, refunding, saving or emailing', async () => {
  jest.mocked(assertDirectBookingCancellationAccess).mockRejectedValue(new HttpError(403, 'Outside management/product scope'));
  const res = response(); await cancelDirectBooking(req(), res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(getDirectStripeClient).not.toHaveBeenCalled();
  expect(stripe.refunds.create).not.toHaveBeenCalled();
  expect(booking.save).not.toHaveBeenCalled();
  expect(sendDirectBookingActionEmail).not.toHaveBeenCalled();
});
it.each(['viator', 'rezdy', 'getyourguide', 'ecwid'])(
  'rejects a non-Direct/non-storefront platform %s before Stripe', async platform => {
    booking.platform = platform;
    const res = response(); await cancelDirectBooking(req(), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(getDirectStripeClient).not.toHaveBeenCalled();
  });
it.each([{ paymentMethod: 'bank_transfer' }, { paymentStatus: 'unpaid' }])('retains payment safeguards %j', async fields => {
  Object.assign(booking, fields);
  const res = response(); await cancelDirectBooking(req(), res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(getDirectStripeClient).not.toHaveBeenCalled();
  expect(booking.save).not.toHaveBeenCalled();
});
it('does not refund a booking which is already cancelled', async () => {
  booking.status = 'cancelled';
  const res = response(); await cancelDirectBooking(req(), res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
});
it('does not issue another refund when Stripe already reports a full refund', async () => {
  stripe.paymentIntents.retrieve.mockResolvedValue({ id: 'pi_test', amount_received: 29900, currency: 'pln', latest_charge: { amount_refunded: 29900 } });
  booking.refundedAmount = '299.00';
  const res = response(); await cancelDirectBooking(req(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(stripe.refunds.create).not.toHaveBeenCalled();
  expect(booking.refundedAmount).toBe('299.00');
});
