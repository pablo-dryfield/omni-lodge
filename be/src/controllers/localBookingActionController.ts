import type { Response } from 'express';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import sequelize from '../config/database.js';
import Booking from '../models/Booking.js';
import BookingEvent from '../models/BookingEvent.js';
import AuditLog from '../models/AuditLog.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { assertLocalBookingActionAccess } from '../services/localBookingActionPolicy.js';
import { notifyLocalBookingAction, type LocalBookingAction } from '../services/localBookingActionEmailService.js';
import logger from '../utils/logger.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);
const snapshot = (b: Booking) => ({ id: b.id, status: b.status, experienceDate: b.experienceDate,
  experienceStartAt: b.experienceStartAt, experienceEndAt: b.experienceEndAt, partySizeTotal: b.partySizeTotal,
  paymentStatus: b.paymentStatus, priceNet: b.priceNet, refundedAmount: b.refundedAmount });
const bookingId = (req: AuthenticatedRequest) => {
  const value = String(req.params.bookingId ?? '');
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new HttpError(400, 'Invalid booking ID.');
  return Number(value);
};
const respondError = (error: unknown, res: Response) => {
  if (!(error instanceof HttpError)) logger.error('[local-booking-actions] Operation failed.', error);
  res.status(error instanceof HttpError ? error.status : 500).json({ message: error instanceof HttpError ? error.message : 'Unable to change the booking.' });
};

export const previewLocalBookingAction = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const booking = await Booking.findByPk(bookingId(req));
    if (!booking) throw new HttpError(404, 'Booking not found.');
    await assertLocalBookingActionAccess(req, booking);
    res.json({ booking: { ...snapshot(booking), platform: booking.platform, platformBookingId: booking.platformBookingId,
      productName: booking.productName, updatedAt: booking.updatedAt }, hasCustomerEmail: Boolean(booking.guestEmail?.trim()),
      localOnly: true });
  } catch (error) { respondError(error, res); }
};

const applyLocalAction = async (req: AuthenticatedRequest, res: Response, operation: LocalBookingAction) => {
  try {
    const id = bookingId(req);
    const body = req.body as Record<string, unknown>;
    const allowed = ['reason', 'expectedUpdatedAt', 'sendCustomerEmail', ...(operation === 'amend' ? ['pickupDate', 'pickupTime'] : [])];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
      throw new HttpError(400, 'Unsupported local booking action fields.');
    }
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000) throw new HttpError(400, 'Enter a reason (up to 2000 characters).');
    const reason = body.reason.trim();
    if (typeof body.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) throw new HttpError(400, 'Refresh the booking before changing it.');
    if (body.sendCustomerEmail !== undefined && typeof body.sendCustomerEmail !== 'boolean') throw new HttpError(400, 'Invalid customer notification option.');
    let start: Date | null = null;
    if (operation === 'amend') {
      if (typeof body.pickupDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.pickupDate)
        || !dayjs(body.pickupDate, 'YYYY-MM-DD', true).isValid() || typeof body.pickupTime !== 'string'
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.pickupTime)) throw new HttpError(400, 'Enter a valid pickup date and time (HH:mm).');
      const local = `${body.pickupDate} ${body.pickupTime}`;
      const parsed = dayjs.tz(local, 'YYYY-MM-DD HH:mm', 'Europe/Warsaw');
      if (parsed.format('YYYY-MM-DD HH:mm') !== local) throw new HttpError(400, 'This local time does not exist because of daylight saving time.');
      start = parsed.toDate();
    }
    const result = await sequelize.transaction(async transaction => {
      const booking = await Booking.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!booking) throw new HttpError(404, 'Booking not found.');
      const emailFamily = await assertLocalBookingActionAccess(req, booking, transaction);
      if (new Date(booking.updatedAt).getTime() !== Date.parse(body.expectedUpdatedAt as string)) throw new HttpError(409, 'The booking changed. Refresh and review it before trying again.');
      if (booking.status === 'cancelled') throw new HttpError(409, 'This booking is already cancelled.');
      const before = snapshot(booking);
      const previousStartAt = booking.experienceStartAt ?? null;
      const now = new Date();
      if (operation === 'amend') {
        if (previousStartAt && previousStartAt.getTime() === start!.getTime()) throw new HttpError(409, 'Change the date or time before saving.');
        const duration = previousStartAt && booking.experienceEndAt ? booking.experienceEndAt.getTime() - previousStartAt.getTime() : null;
        booking.experienceDate = body.pickupDate as string;
        booking.experienceStartAt = start;
        if (duration != null && duration >= 0) booking.experienceEndAt = new Date(start!.getTime() + duration);
        booking.status = 'amended';
      } else {
        booking.status = 'cancelled';
        booking.cancelledAt = now;
      }
      booking.statusChangedAt = now;
      booking.updatedBy = req.authContext!.id;
      await booking.save({ transaction });
      const after = snapshot(booking);
      const event = await BookingEvent.create({ bookingId: id, emailId: null, emailMessageId: null,
        eventType: operation === 'amend' ? 'amended' : 'cancelled', platform: booking.platform, statusAfter: booking.status,
        occurredAt: now, ingestedAt: now, processedAt: now,
        eventPayload: { source: 'manifest-local-action', operation, localOnly: true, refundIssued: false,
          actorId: req.authContext!.id, reason, before, after, notificationStatus: 'pending' },
      } as unknown as BookingEvent, { transaction });
      await AuditLog.create({ actorId: req.authContext!.id, action: `booking.local_${operation}`, entity: 'booking', entityId: String(id),
        metaJson: { eventId: event.id, reason, localOnly: true, before, after }, createdAt: now }, { transaction });
      return { booking, event, emailFamily, previousStartAt };
    });
    let notifications: Awaited<ReturnType<typeof notifyLocalBookingAction>>;
    try {
      notifications = await notifyLocalBookingAction(result.booking, { operation, reason,
        actorId: req.authContext!.id, previousStartAt: result.previousStartAt, emailFamily: result.emailFamily,
        sendCustomerEmail: body.sendCustomerEmail !== false });
    } catch (error) {
      logger.error(`[local-booking-actions] Notifications failed after booking ${id} was saved.`, error);
      notifications = { customer: { status: 'failed', reason: 'Booking saved, but email delivery failed.' },
        internal: { status: 'failed', reason: 'Booking saved, but email delivery failed.' } };
    }
    let notificationAuditSaved = true;
    try {
      await result.event.update({ eventPayload: { ...result.event.eventPayload, notificationStatus: 'finished', notifications } });
      await AuditLog.create({ actorId: req.authContext!.id, action: 'booking.local_action_notifications', entity: 'booking', entityId: String(id),
        metaJson: { eventId: result.event.id, notifications } });
    } catch (error) {
      notificationAuditSaved = false;
      logger.error(`[local-booking-actions] Notification audit failed after booking ${id} was saved.`, error);
    }
    res.json({ message: `Booking ${operation === 'amend' ? 'amended' : 'cancelled'} in OmniLodge only.`,
      booking: snapshot(result.booking), localOnly: true, refundIssued: false, notifications, notificationAuditSaved });
  } catch (error) { respondError(error, res); }
};
export const amendLocalBooking = (req: AuthenticatedRequest, res: Response) => applyLocalAction(req, res, 'amend');
export const cancelLocalBooking = (req: AuthenticatedRequest, res: Response) => applyLocalAction(req, res, 'cancel');
