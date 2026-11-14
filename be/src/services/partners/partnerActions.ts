import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import { PartnerBooking, PartnerAmendment } from '../../models/Partner.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import StorefrontOrderResourceReservation from '../../models/StorefrontOrderResourceReservation.js';
import { refundPartnerPayments, verifiedPartnerPayments } from './partnerPaymentLedger.js';
import { money, minor } from './partnerPolicy.js';
import { releaseStorefrontOrderResourceReservations } from '../storefrontOrderResourceReservationService.js';
import { notifyLocalBookingAction } from '../localBookingActionEmailService.js';
import type { PartnerContext } from './partnerAccess.js';
import { partnerEvent } from './partnerEvents.js';
import { reconcilePartnerOrder } from './partnerStripeService.js';

export async function changePartnerBooking(context: PartnerContext, id: number, action: 'cancel' | 'amend', body: Record<string, unknown>) {
  if (action === 'amend') return (await import('./partnerAmendmentService.js')).amendPartnerBooking(context, id, body);
  if (!(context.admin || context.partner.agreement.allowCancellation)) throw new HttpError(403, 'The partner agreement does not permit this action.');
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
  if (!reason) throw new HttpError(400, 'A reason is required.');
  const before = await PartnerBooking.findOne({ where: { id, partnerId: context.partner.id } });
  if (!before?.orderId) throw new HttpError(404, 'Confirmed booking not found.');
  const result = await sequelize.transaction(async transaction => {
    // Match payment fulfillment: lock order before the partner allocation.
    const order = await StorefrontOrder.findByPk(before.orderId!, { transaction, lock: transaction.LOCK.UPDATE });
    const booking = (await PartnerBooking.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
    if (!order || booking.partnerId !== context.partner.id) throw new HttpError(404, 'Booking not found.');
    if (action === 'cancel' && booking.status === 'cancelled') return { booking, affected: [] as Booking[], previousStartAt: null as Date | null };
    if (await PartnerAmendment.count({ where: { bookingId: id, status: { [Op.in]: ['pending_payment', 'applying'] } }, transaction })) throw new HttpError(409, 'Complete or cancel the pending amendment first.');
    if (!['confirmed', 'refunded'].includes(booking.status)) throw new HttpError(409, 'Only confirmed or refunded bookings can be cancelled.');
    const affected = await Booking.findAll({ where: { platformOrderId: order.publicId }, transaction, lock: transaction.LOCK.UPDATE });
    if (affected.some(b => ['checked_in_full', 'checked_in_partial'].includes(b.attendanceStatus))) throw new HttpError(409, 'A checked-in booking must be managed by the operations team.');
    const starts = affected.map(b => b.experienceStartAt?.getTime()).filter((x): x is number => typeof x === 'number');
    const previousStartAt = affected[0]?.experienceStartAt || null;
    if (!context.admin && (!starts.length || Math.min(...starts) - Date.now() < booking.snapshot.cancellationHours * 3600000)) throw new HttpError(409, 'The partner change deadline has passed. Contact the operations team.');
    if (action === 'cancel') {
      if (booking.paymentMode === 'platform' && order.paymentStatus === 'paid') {
        const payments = await verifiedPartnerPayments(order, booking, transaction);
        const amount = money(payments.reduce((sum, row) => sum + (row.charge.amount - row.charge.amount_refunded) / 100, 0));
        if (amount > 0) await refundPartnerPayments(order, booking, amount, `cancel-${id}-${minor(amount)}`, reason, transaction);
      }
      await order.update({ status: 'cancelled' }, { transaction });
      await booking.update({ status: 'cancelled' }, { transaction });
      await Booking.update({ status: 'cancelled', statusChangedAt: new Date(), updatedBy: context.actorId ?? context.partner.createdBy }, { where: { id: { [Op.in]: affected.map(b => b.id) } }, transaction });
      await releaseStorefrontOrderResourceReservations(order.id, transaction);
      // These are commercial holds, not stock movements. A cancelled future tour must not retain them.
      await StorefrontOrderResourceReservation.update({ status: 'released', releasedAt: new Date(), expiresAt: new Date() }, { where: { orderId: order.id, resourceType: 'inventory' }, transaction });
    }
    await partnerEvent(context.partner.id, 'booking.cancelled', { reference: booking.externalReference, reason, customerNotification: body.notifyCustomer !== false }, context.actorId, id, transaction);
    for (const b of affected) await BookingEvent.create({ bookingId: b.id, eventType: 'cancelled', platform: 'omnilodge', statusAfter: 'cancelled', occurredAt: new Date(), eventPayload: { reason, partnerId: context.partner.id, actorId: context.actorId } } as never, { transaction });
    return { booking, affected, previousStartAt };
  });
  if (action === 'cancel' && before.paymentMode === 'platform') await reconcilePartnerOrder(before.orderId);
  const notifications = [];
  for (const item of result.affected) {
    await item.reload();
    notifications.push(await notifyLocalBookingAction(item, { operation: action, reason, actorId: context.actorId ?? context.partner.createdBy, previousStartAt: result.previousStartAt, emailFamily: 'STOREFRONT', sendCustomerEmail: body.notifyCustomer !== false, partnerFinancialSummary: before.paymentMode === 'platform' ? Number(before.total) - Number(before.refundedAmount) <= 0 ? 'Your booking is cancelled. There is no remaining payment to refund.' : 'The remaining payment has been submitted for refund to the original payment method. Bank processing times apply.' : 'The original collecting party handles any refund. Contact your booking partner for the refund receipt.' }));
  }
  return { status: result.booking.status, notifications, ...(action === 'cancel' && before.paymentMode === 'partner' ? { partnerRefundRequired: Number(before.total), message: 'The partner collected this payment and must arrange the customer refund. No bank transfer was initiated by OmniLodge.' } : {}) };
}
