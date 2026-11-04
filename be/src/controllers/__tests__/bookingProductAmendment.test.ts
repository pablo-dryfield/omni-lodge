jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findByPk: jest.fn(), sequelize: { transaction: jest.fn() } } }));
jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: { build: jest.fn() } }));
jest.mock('../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../models/StorefrontOrderItem.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../services/localBookingActionPolicy.js', () => ({ assertBookingManagementAccess: jest.fn() }));
jest.mock('../../services/bookings/bookingAmendmentProductService.js', () => ({
  ...jest.requireActual('../../services/bookings/bookingAmendmentProductService.js'), resolveBookingAmendmentProduct: jest.fn(),
}));
jest.mock('../../services/ecwidService.js', () => ({ getEcwidOrder: jest.fn(), updateEcwidOrder: jest.fn() }));
jest.mock('../../services/storefrontOrderResourceReservationService.js', () => ({ refreshStorefrontOrderInventoryReservationExpiries: jest.fn() }));
jest.mock('../../services/directBookingActionEmailService.js', () => ({ sendDirectBookingActionEmail: jest.fn(), sendInternalDirectBookingActionEmail: jest.fn() }));
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import StorefrontOrderItem from '../../models/StorefrontOrderItem.js';
import type Product from '../../models/Product.js';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import { resolveBookingAmendmentProduct } from '../../services/bookings/bookingAmendmentProductService.js';
import { sendDirectBookingActionEmail, sendInternalDirectBookingActionEmail } from '../../services/directBookingActionEmailService.js';
import { getEcwidOrder, updateEcwidOrder } from '../../services/ecwidService.js';
import { amendDirectFoodTourBooking, amendEcwidBooking, amendXperiencePolandBooking } from '../bookingController.js';

const tx = { LOCK: { UPDATE: 'UPDATE' } };
let booking: Booking;
let event: BookingEvent;
const itemUpdate = jest.fn();
const req = (body = {}) => ({ params: { bookingId: '42' }, body: {
  productId: 20, pickupDate: '2027-01-10', pickupTime: '21:00', sendCustomerEmail: false, ...body,
}, authContext: { id: 7, userTypeId: 2 } } as unknown as AuthenticatedRequest);
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response);
beforeEach(() => {
  jest.clearAllMocks();
  booking = { id: 42, productId: 10, productName: 'Original tour', platform: 'direct', status: 'confirmed',
    platformBookingId: 'order-99', platformOrderId: 'order', experienceDate: '2027-01-10',
    experienceStartAt: new Date('2027-01-10T20:00:00Z'), priceNet: '200.00', priceGross: '200.00',
    refundedAmount: '10.00', partySizeTotal: 2, attendedTotal: 1, guestEmail: 'guest@example.test', save: jest.fn(),
  } as unknown as Booking;
  event = { save: jest.fn() } as unknown as BookingEvent;
  jest.mocked(Booking.findByPk).mockResolvedValue(booking);
  jest.mocked(BookingEvent.build).mockReturnValue(event);
  (Booking.sequelize!.transaction as jest.Mock).mockImplementation(callback => callback(tx));
  jest.mocked(sequelize.transaction).mockImplementation(async (callback: any) => callback(tx));
  jest.mocked(resolveBookingAmendmentProduct).mockResolvedValue({ id: 20, name: 'New tour', status: true } as Product);
  jest.mocked(StorefrontOrder.findOne).mockResolvedValue({ id: 1, status: 'paid', paymentMethod: 'stripe' } as StorefrontOrder);
  jest.mocked(StorefrontOrderItem.findOne).mockResolvedValue({ update: itemUpdate } as unknown as StorefrontOrderItem);
  jest.mocked(sendDirectBookingActionEmail).mockResolvedValue({ id: 'customer-mail' } as any);
  jest.mocked(sendInternalDirectBookingActionEmail).mockResolvedValue(null);
  jest.mocked(getEcwidOrder).mockResolvedValue({ items: [] } as any);
});
it.each(['direct', 'omnilodge'])('persists a product-only %s amendment with audit and no customer email', async platform => {
  booking.platform = platform;
  const res = response(); await amendDirectFoodTourBooking(req(), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(booking).toMatchObject({ productId: 20, productName: 'New tour', priceNet: '200.00',
    refundedAmount: '10.00', partySizeTotal: 2, attendedTotal: 1 });
  expect(event.eventPayload).toMatchObject({ before: { productId: 10, productName: 'Original tour' },
    after: { productId: 20, productName: 'New tour' }, sendCustomerEmail: false });
  expect(sendDirectBookingActionEmail).not.toHaveBeenCalled();
  expect(sendInternalDirectBookingActionEmail).toHaveBeenCalled();
  if (platform === 'omnilodge') expect(itemUpdate).toHaveBeenCalledWith({
    productId: 20, productName: 'New tour', productSlug: 'new-tour-20', experienceDate: '2027-01-10', experienceTime: '21:00',
  }, { transaction: tx });
});
it('sends the requested customer notification with the old and new products', async () => {
  await amendDirectFoodTourBooking(req({ sendCustomerEmail: true }), response());
  expect(sendDirectBookingActionEmail).toHaveBeenCalledWith(booking, expect.objectContaining({ previousProductName: 'Original tour', kind: 'amend' }));
});
it('rejects a product changed by another manager before the amendment obtains its write lock', async () => {
  jest.mocked(Booking.findByPk).mockResolvedValueOnce(booking).mockResolvedValueOnce({ ...booking, productId: 30 } as Booking);
  const res = response(); await amendDirectFoodTourBooking(req(), res);
  expect(res.status).toHaveBeenCalledWith(409); expect(booking.save).not.toHaveBeenCalled();
  expect(sendDirectBookingActionEmail).not.toHaveBeenCalled();
});
it.each([['ecwid', amendEcwidBooking], ['xperiencepoland', amendXperiencePolandBooking]] as const)(
  'saves a native %s product amendment with the financial values intact', async (platform, handler) => {
    booking.platform = platform;
    const res = response(); await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(booking.productId).toBe(20); expect(booking.productName).toBe('New tour'); expect(booking.priceNet).toBe('200.00');
    expect(event.eventPayload).toMatchObject({ before: { productId: 10, productName: 'Original tour' }, after: { productId: 20, productName: 'New tour' } });
    expect(updateEcwidOrder).not.toHaveBeenCalled();
  });
it('continues to synchronize an explicitly changed Ecwid schedule alongside a local product correction', async () => {
  booking.platform = 'ecwid';
  const res = response(); await amendEcwidBooking(req({ pickupTime: '22:00' }), res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(updateEcwidOrder).toHaveBeenCalledWith('order-99', expect.objectContaining({ pickupTime: expect.any(String) }));
  expect(booking.productId).toBe(20);
});
it.each([amendDirectFoodTourBooking, amendEcwidBooking, amendXperiencePolandBooking])('rejects a forbidden destination before mutation or provider updates', async handler => {
  booking.platform = handler === amendEcwidBooking ? 'ecwid' : handler === amendXperiencePolandBooking ? 'xperiencepoland' : 'direct';
  jest.mocked(resolveBookingAmendmentProduct).mockRejectedValue(new HttpError(403, 'Outside scope'));
  const res = response(); await handler(req(), res);
  expect(res.status).toHaveBeenCalledWith(403); expect(booking.save).not.toHaveBeenCalled();
  expect(updateEcwidOrder).not.toHaveBeenCalled(); expect(itemUpdate).not.toHaveBeenCalled();
  expect(sendDirectBookingActionEmail).not.toHaveBeenCalled();
});
