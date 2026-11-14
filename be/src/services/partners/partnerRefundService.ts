import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import { PartnerBooking, PartnerEvent, PartnerAmendment } from '../../models/Partner.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import HttpError from '../../errors/HttpError.js';
import { sendMessage } from '../bookings/gmailClient.js';
import { getConfigValue, refreshConfigCacheKeys } from '../configService.js';
import { minor, money } from './partnerPolicy.js';
import { partnerEvent } from './partnerEvents.js';
import { reconcilePartnerOrder } from './partnerStripeService.js';
import type { PartnerContext } from './partnerAccess.js';
import { projectPartnerRefund } from './partnerRefundProjection.js';
import { refundPartnerPayments } from './partnerPaymentLedger.js';

export async function recordExternalPartnerRefund(context: PartnerContext, id: number, body: Record<string, unknown>) {
  if (!context.admin) throw new HttpError(403, 'Operations must verify an external refund receipt.');
  const amount = Number(body.amount);
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!Number.isFinite(amount) || amount <= 0 || money(amount) !== amount || !reference || reference.length > 160 || !reason || reason.length > 1000) throw new HttpError(400, 'Provide the actual refunded amount, receipt reference and verification reason.');
  const existing = await PartnerBooking.findOne({ where: { id, partnerId: context.partner.id } });
  if (!existing?.orderId) throw new HttpError(404, 'Booking not found.');
  return sequelize.transaction(async transaction => {
    const order = await StorefrontOrder.findByPk(existing.orderId!, { transaction, lock: transaction.LOCK.UPDATE });
    const row = (await PartnerBooking.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
    if (!order || !['partner', 'arrival'].includes(row.paymentMode) || !row.paymentReceived) throw new HttpError(409, 'Only confirmed payments collected outside Stripe use this refund evidence action.');
    const previous = await PartnerEvent.findOne({ where: { partnerId: context.partner.id, bookingId: id, type: 'partner_refund.recorded', data: { reference } }, transaction });
    if (previous) {
      if (Number(previous.data.amount) !== amount) throw new HttpError(409, 'This refund reference was used for another amount.');
      return { recorded: true, replay: true, message: 'This verified external refund was already recorded.' };
    }
    const refundedAmount = money(Number(row.refundedAmount) + amount);
    if (refundedAmount > Number(row.total)) throw new HttpError(409, 'The refund exceeds the customer payment.');
    await projectPartnerRefund(order.publicId, Math.max(0, minor(refundedAmount) - minor(Number(row.amendmentRefundedAmount || 0))), transaction);
    await row.update({ refundedAmount, ...(refundedAmount === Number(row.total) && row.status !== 'cancelled' ? { status: 'refunded' } : {}) }, { transaction });
    await partnerEvent(context.partner.id, 'partner_refund.recorded', { amount, reference, reason }, context.actorId, id, transaction);
    return { recorded: true, replay: false, message: 'Verified external refund recorded. No funds were moved by OmniLodge.' };
  });
}

export async function refundPartnerBooking(context: PartnerContext, id: number, body: Record<string, unknown>) {
  if (!context.admin && !context.partner.agreement.allowRefunds) throw new HttpError(403, 'The partner agreement does not permit refunds.');
  const amount = Number(body.amount);
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
  if (!Number.isFinite(amount) || amount <= 0 || amount !== money(amount) || !/^[A-Za-z0-9_.:-]{1,160}$/.test(reference) || !reason) throw new HttpError(400, 'Provide an amount with at most two decimals, a unique operation reference and a reason.');
  const existing = await PartnerBooking.findOne({ where: { id, partnerId: context.partner.id } });
  if (!existing?.orderId) throw new HttpError(404, 'Booking not found.');
  if (existing.paymentMode !== 'platform') throw new HttpError(409, 'This payment was not collected through OmniLodge Stripe. The collecting party must issue the refund; a manager can record the verified external refund.');
  const result = await sequelize.transaction(async transaction => {
    const order = await StorefrontOrder.findByPk(existing.orderId!, { transaction, lock: transaction.LOCK.UPDATE });
    const booking = (await PartnerBooking.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
    if (!order || !['paid', 'refunded'].includes(order.paymentStatus)) throw new HttpError(409, 'A verified Stripe payment is required.');
    const previous = await PartnerEvent.findOne({ where: { partnerId: booking.partnerId, bookingId: id, type: 'refund.submitted', data: { reference } }, transaction });
    if (previous) {
      if (Number(previous.data.amount) !== amount) throw new HttpError(409, 'This refund reference was already used for another amount.');
      return { refundId: String(previous.data.refundId), status: String(previous.data.status), replay: true, order, amount };
    }
    if (await PartnerAmendment.count({ where: { bookingId: id, status: { [Op.in]: ['pending_payment', 'applying'] } }, transaction })) throw new HttpError(409, 'Complete or cancel the pending amendment before refunding.');
    const refunds = await refundPartnerPayments(order, booking, amount, reference, reason, transaction);
    const refund = { id: refunds.map(row => row.refundId).join(','), status: refunds.every(row => row.status === 'succeeded') ? 'succeeded' : 'pending' };
    await partnerEvent(booking.partnerId, 'refund.submitted', { reference, amount, reason, refundId: refund.id, status: refund.status, notifyCustomer: body.notifyCustomer !== false }, context.actorId, id, transaction);
    return { refundId: refund.id, status: refund.status, replay: false, order, amount };
  });
  let reconciliationPending = false;
  try { await reconcilePartnerOrder(existing.orderId); reconciliationPending = !!(await PartnerBooking.findByPk(id))?.reconciliationError; } catch { reconciliationPending = true; }
  let notification = result.replay ? 'previously_submitted' : 'skipped';
  if (!result.replay && body.notifyCustomer !== false) {
    try {
      await refreshConfigCacheKeys(['STOREFRONT_EMAIL_FROM_ADDRESS']);
      const text = `Hi ${result.order.customerFirstName},\n\nA refund of PLN ${amount.toFixed(2)} has been submitted for booking ${existing.externalReference}. It will be returned to the original payment method after Stripe and your bank process it.\n\nYour remaining booking details are unchanged.\n\nOmniLodge`;
      await sendMessage({ to: result.order.customerEmail, from: String(getConfigValue('STOREFRONT_EMAIL_FROM_ADDRESS') || ''), subject: 'Refund submitted for your experience booking', textBody: text, htmlBody: `<div style="background:#100c0f;color:#fff8f2;padding:28px;font-family:Arial,sans-serif"><h1 style="color:#ff168f">Your refund is processing</h1><p>PLN ${amount.toFixed(2)} will be returned to your original payment method after processing.</p><p>Your remaining booking details are unchanged.</p><p>OmniLodge</p></div>` });
      notification = 'sent';
    } catch { notification = 'failed'; }
    await partnerEvent(context.partner.id, 'refund.notification', { refundId: result.refundId, status: notification }, context.actorId, id);
  }
  return { refundId: result.refundId, status: result.status, amount, replay: result.replay, notification, reconciliationPending };
}
