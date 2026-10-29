jest.mock('../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../models/Booking.js', () => ({ __esModule: true, default: { findByPk: jest.fn() } }));
jest.mock('../../models/BookingEvent.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../services/localBookingActionPolicy.js', () => ({ assertLocalBookingActionAccess: jest.fn() }));
jest.mock('../../services/localBookingActionEmailService.js', () => ({ notifyLocalBookingAction: jest.fn() }));
import type { Response } from 'express';
import sequelize from '../../config/database.js';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import AuditLog from '../../models/AuditLog.js';
import HttpError from '../../errors/HttpError.js';
import { assertLocalBookingActionAccess } from '../../services/localBookingActionPolicy.js';
import { notifyLocalBookingAction } from '../../services/localBookingActionEmailService.js';
import { amendLocalBooking, cancelLocalBooking, previewLocalBookingAction } from '../localBookingActionController.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';

const tx = { LOCK: { UPDATE: 'UPDATE' } };
const initialVersion = '2027-01-01T00:00:00.000Z';
let booking: Booking;
let event: BookingEvent;
const response = () => ({ json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response);
const request = (body: Record<string, unknown> = {}) => ({ params: { bookingId: '42' }, authContext: { id: 7, userTypeId: 2 },
  body: { expectedUpdatedAt: initialVersion, reason: 'Customer requested this correction', ...body } } as unknown as AuthenticatedRequest);
beforeEach(() => {
  jest.clearAllMocks();
  booking = { id: 42, platform: 'viator', platformBookingId: 'TEST-42', productName: 'Test experience',
    status: 'confirmed', paymentStatus: 'paid', paymentMethod: 'stripe', priceNet: '200.00', refundedAmount: '10.00',
    partySizeTotal: 2, attendedTotal: 1, attendanceStatus: 'checked_in_partial',
    experienceDate: '2027-01-10', experienceStartAt: new Date('2027-01-10T20:00:00Z'),
    experienceEndAt: new Date('2027-01-10T23:00:00Z'), updatedAt: new Date(initialVersion),
    save: jest.fn(async () => { booking.updatedAt = new Date('2027-01-02T00:00:00Z'); return booking; }),
  } as unknown as Booking;
  event = { id: 101, eventPayload: { source: 'manifest-local-action', localOnly: true }, update: jest.fn() } as unknown as BookingEvent;
  jest.mocked(Booking.findByPk).mockResolvedValue(booking);
  jest.mocked(BookingEvent.create).mockResolvedValue(event);
  jest.mocked(sequelize.transaction).mockImplementation(async (callback: any) => callback(tx));
  jest.mocked(assertLocalBookingActionAccess).mockResolvedValue('STOREFRONT');
  jest.mocked(notifyLocalBookingAction).mockResolvedValue({ customer: { status: 'sent', messageId: 'c' }, internal: { status: 'sent', messageId: 'i' } });
});

it('previews current version only after checking management/product authority', async () => {
  const res = response(); await previewLocalBookingAction(request(), res);
  expect(assertLocalBookingActionAccess).toHaveBeenCalledWith(expect.anything(), booking);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ booking: expect.objectContaining({ id: 42, updatedAt: new Date(initialVersion) }), localOnly: true }));
  expect(booking.save).not.toHaveBeenCalled(); expect(notifyLocalBookingAction).not.toHaveBeenCalled();
});
it.each(['viator', 'getyourguide', 'rezdy', 'fareharbor', 'freetour', 'airbnb', 'xperiencepoland', 'civitatis', 'ecwid', 'new-email-channel'])(
  'cancels %s locally with audit and notifications, preserving money, attendance and guests', async platform => {
    booking.platform = platform;
    const res = response(); await cancelLocalBooking(request(), res);
    expect(booking.status).toBe('cancelled'); expect(booking.partySizeTotal).toBe(2);
    expect(booking.priceNet).toBe('200.00'); expect(booking.refundedAmount).toBe('10.00'); expect(booking.paymentStatus).toBe('paid');
    expect(booking.attendedTotal).toBe(1); expect(booking.attendanceStatus).toBe('checked_in_partial');
    expect(Booking.findByPk).toHaveBeenCalledWith(42, { transaction: tx, lock: 'UPDATE' });
    expect(BookingEvent.create).toHaveBeenCalledWith(expect.objectContaining({ platform, eventType: 'cancelled',
      eventPayload: expect.objectContaining({ source: 'manifest-local-action', localOnly: true, refundIssued: false, actorId: 7, reason: expect.any(String) }) }), { transaction: tx });
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'booking.local_cancel', actorId: 7 }), { transaction: tx });
    expect(notifyLocalBookingAction).toHaveBeenCalledWith(booking, expect.objectContaining({ operation: 'cancel', sendCustomerEmail: true }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ localOnly: true, refundIssued: false, notificationAuditSaved: true }));
  },
);
it('amends Warsaw date/time and preserves duration without changing financial/attendance fields', async () => {
  const res = response(); await amendLocalBooking(request({ pickupDate: '2027-06-10', pickupTime: '21:00' }), res);
  expect(booking.experienceDate).toBe('2027-06-10');
  expect(booking.experienceStartAt?.toISOString()).toBe('2027-06-10T19:00:00.000Z');
  expect(booking.experienceEndAt?.toISOString()).toBe('2027-06-10T22:00:00.000Z');
  expect(booking.status).toBe('amended'); expect(booking.refundedAmount).toBe('10.00');
  expect(booking.partySizeTotal).toBe(2); expect(booking.attendedTotal).toBe(1);
  expect(notifyLocalBookingAction).toHaveBeenCalledWith(booking, expect.objectContaining({ previousStartAt: new Date('2027-01-10T20:00:00Z'), operation: 'amend' }));
});
it.each([
  { pickupDate: '2027-02-30', pickupTime: '21:00' }, { pickupDate: '2027-01-10', pickupTime: '25:00' },
  { pickupDate: '2027-03-28', pickupTime: '02:30' }, { pickupDate: 42, pickupTime: '21:00' },
])('rejects invalid or nonexistent Warsaw schedule %j', async body => {
  const res = response(); await amendLocalBooking(request(body), res);
  expect(res.status).toHaveBeenCalledWith(400); expect(booking.save).not.toHaveBeenCalled();
});
it.each([{ reason: '' }, { reason: ' ' }, { reason: 'x'.repeat(2001) }, { reason: null },
  { expectedUpdatedAt: 'not-a-date' }, { sendCustomerEmail: 'yes' }, { refundedAmount: 0 }, { platform: 'direct' }])(
  'rejects unsupported body %j before mutation', async body => {
    const res = response(); await cancelLocalBooking(request(body), res);
    expect(res.status).toHaveBeenCalledWith(400); expect(booking.save).not.toHaveBeenCalled(); expect(notifyLocalBookingAction).not.toHaveBeenCalled();
  },
);
it('checks authorization before mutation or notification', async () => {
  jest.mocked(assertLocalBookingActionAccess).mockRejectedValue(new HttpError(403, 'Outside scope'));
  const res = response(); await cancelLocalBooking(request(), res);
  expect(res.status).toHaveBeenCalledWith(403); expect(booking.save).not.toHaveBeenCalled(); expect(notifyLocalBookingAction).not.toHaveBeenCalled();
});
it('rejects a stale version', async () => {
  booking.updatedAt = new Date('2027-01-03T00:00:00Z');
  const res = response(); await cancelLocalBooking(request(), res);
  expect(res.status).toHaveBeenCalledWith(409); expect(booking.save).not.toHaveBeenCalled();
});
it('does not notify twice on duplicate submission', async () => {
  await cancelLocalBooking(request(), response()); const res = response(); await cancelLocalBooking(request(), res);
  expect(res.status).toHaveBeenCalledWith(409); expect(notifyLocalBookingAction).toHaveBeenCalledTimes(1);
});
it('rejects already cancelled and unchanged schedule amendments', async () => {
  const res = response(); await amendLocalBooking(request({ pickupDate: '2027-01-10', pickupTime: '21:00' }), res);
  expect(res.status).toHaveBeenCalledWith(409); expect(booking.save).not.toHaveBeenCalled();
  booking.status = 'cancelled'; const second = response(); await cancelLocalBooking(request(), second);
  expect(second.status).toHaveBeenCalledWith(409);
});
it('never sends email before a successful transaction', async () => {
  jest.mocked(booking.save).mockRejectedValue(new Error('Database unavailable'));
  const res = response(); await cancelLocalBooking(request(), res);
  expect(res.status).toHaveBeenCalledWith(500); expect(notifyLocalBookingAction).not.toHaveBeenCalled();
});
it('reports notification failure as a saved booking, not a failed mutation to retry', async () => {
  jest.mocked(notifyLocalBookingAction).mockRejectedValue(new Error('Email unavailable'));
  const res = response(); await cancelLocalBooking(request(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ localOnly: true, notifications: {
    customer: expect.objectContaining({ status: 'failed' }), internal: expect.objectContaining({ status: 'failed' }),
  } }));
  expect(res.status).not.toHaveBeenCalledWith(500);
});
it('reports an audit delivery persistence failure without falsely claiming the committed booking failed', async () => {
  jest.mocked(event.update).mockRejectedValue(new Error('Audit update unavailable'));
  const res = response(); await cancelLocalBooking(request(), res);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ notificationAuditSaved: false }));
});
