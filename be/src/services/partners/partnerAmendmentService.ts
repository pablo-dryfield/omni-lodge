import { calculatePartnerCommission } from './partnerCommission.js';
import { Op, type Transaction } from 'sequelize';
import sequelize from '../../config/database.js';
import { PartnerAmendment, PartnerBooking, PartnerPayment, PartnerProfile } from '../../models/Partner.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import StorefrontOrderItem from '../../models/StorefrontOrderItem.js';
import StorefrontOrderResourceReservation from '../../models/StorefrontOrderResourceReservation.js';
import Booking from '../../models/Booking.js';
import BookingAddon from '../../models/BookingAddon.js';
import BookingEvent from '../../models/BookingEvent.js';
import HttpError from '../../errors/HttpError.js';
import { getStorefrontStripeClient } from '../../finance/services/stripeClient.js';
import { parsePartnerSelection, quotePartnerBooking, type PartnerSelection } from './partnerBookingService.js';
import type { StorefrontQuote } from '../storefrontCommerceService.js';
import { consumeStorefrontOrderResourceReservations, lockStorefrontCartReservationResources, reserveStorefrontOrderResources } from '../storefrontOrderResourceReservationService.js';
import { projectStorefrontOrderBookings } from '../storefrontOrderProjectionService.js';
import { buildStorefrontAddonsSnapshot } from '../storefrontBookingProjectionService.js';
import { sendMessage } from '../bookings/gmailClient.js';
import { getConfigValue, refreshConfigCacheKeys } from '../configService.js';
import BookingEmail from '../../models/BookingEmail.js';
import { refundPartnerPayments, verifiedPartnerPayments } from './partnerPaymentLedger.js';
import { reconcilePartnerOrder, partnerStatement } from './partnerStripeService.js';
import { projectPartnerRefund } from './partnerRefundProjection.js';
import { loadPartnerConfig } from './partnerConfig.js';
import { partnerEvent } from './partnerEvents.js';
import { assertIdempotentReplay, money, minor, requestHash } from './partnerPolicy.js';
import type { PartnerContext } from './partnerAccess.js';

const pendingStatuses = ['pending_payment', 'applying'];
async function orderItems(orderId: number, transaction: Transaction) {
  return StorefrontOrderItem.findAll({ where: { orderId }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
}
const stateHash = (order: StorefrontOrder, items: StorefrontOrderItem[]) => requestHash({ total: Number(order.total), items: items.map(item => ({ id: String(item.id), productId: item.productId, quantity: item.quantity, date: item.experienceDate, time: item.experienceTime, addons: item.addons, options: item.options })) });
async function checkAttendance(order: StorefrontOrder, transaction: Transaction) {
  const bookings = await Booking.findAll({ where: { platformOrderId: order.publicId, status: { [Op.ne]: 'cancelled' } }, transaction, lock: transaction.LOCK.UPDATE });
  if (bookings.some(row => row.attendanceStatus === 'checked_in_full' || row.attendanceStatus === 'checked_in_partial')) throw new HttpError(409, 'A checked-in booking must be managed by operations.');
  return bookings;
}
function safeAmendment(row: PartnerAmendment) { return { id: row.id, reference: row.reference, status: row.status, difference: Number(row.difference), checkoutUrl: row.checkoutUrl, failureReason: row.failureReason }; }

export async function quotePartnerAmendment(context: PartnerContext, id: number, body: Record<string, unknown>) {
  await loadPartnerConfig();
  if (!context.admin && !context.partner.agreement.allowAmendment) throw new HttpError(403, 'The agreement does not permit amendments.');
  const booking = await PartnerBooking.findOne({ where: { id, partnerId: context.partner.id } });
  if (!booking?.orderId) throw new HttpError(404, 'Booking not found.');
  const order = (await StorefrontOrder.findByPk(booking.orderId))!;
  const selection = parsePartnerSelection({ ...booking.selection, offeringCode: undefined, items: body.items, ...(body.discountCode !== undefined ? { discountCode: body.discountCode } : {}) });
  const quote = await quotePartnerBooking(context.partner, selection, undefined, { inventoryReservationOrderId: order.id }, booking.snapshot);
  return { ...quote, difference: money(quote.total - Number(order.total)) };
}

/** New payment is never charged off-session. The customer confirms the difference in hosted Checkout. */
export async function amendPartnerBooking(context: PartnerContext, id: number, body: Record<string, unknown>) {
  await loadPartnerConfig();
  if (!context.admin && !context.partner.agreement.allowAmendment) throw new HttpError(403, 'The agreement does not permit amendments.');
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(reference) || !reason || reason.length > 1000) throw new HttpError(400, 'A unique amendment reference and reason are required.');
  const existing = await PartnerBooking.findOne({ where: { id, partnerId: context.partner.id } });
  if (!existing?.orderId) throw new HttpError(404, 'Booking not found.');
  const inputHash = requestHash({ items: body.items, discountCode: body.discountCode, paymentReference: body.paymentReference, reason, notifyCustomer: body.notifyCustomer !== false });
  const amendment = await sequelize.transaction(async transaction => {
    const order = (await StorefrontOrder.findByPk(existing.orderId!, { transaction, lock: transaction.LOCK.UPDATE }))!;
    const booking = (await PartnerBooking.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
    const previous = await PartnerAmendment.findOne({ where: { bookingId: id, reference }, transaction });
    if (previous) { assertIdempotentReplay(previous.requestHash, inputHash); return previous; }
    if (booking.status !== 'confirmed') throw new HttpError(409, 'Only confirmed bookings can be amended.');
    if (await PartnerAmendment.count({ where: { bookingId: id, status: { [Op.in]: pendingStatuses } }, transaction })) throw new HttpError(409, 'Complete or cancel the pending amendment first.');
    const affected = await checkAttendance(order, transaction);
    const starts = affected.map(row => row.experienceStartAt?.getTime()).filter((value): value is number => typeof value === 'number');
    if (!context.admin && (!starts.length || Math.min(...starts) - Date.now() < booking.snapshot.cancellationHours * 3600000)) throw new HttpError(409, 'The partner change deadline has passed.');
    const selection = parsePartnerSelection({ ...booking.selection, offeringCode: undefined, items: body.items, ...(body.discountCode !== undefined ? { discountCode: body.discountCode } : {}) });
    await lockStorefrontCartReservationResources(selection, transaction);
    const quote = await quotePartnerBooking(context.partner, selection, transaction, { inventoryReservationOrderId: order.id }, booking.snapshot);
    let difference = money(quote.total - Number(order.total));
    if (booking.paymentMode === 'platform' && booking.paymentReceived) {
      const payments = await verifiedPartnerPayments(order, booking, transaction);
      if (difference < 0) difference = -Math.min(-difference, money(payments.reduce((sum, part) => sum + (part.charge.amount - part.charge.amount_refunded) / 100, 0)));
    }
    if (booking.paymentMode !== 'platform' && booking.paymentReceived && difference !== 0) {
      if (!context.admin || typeof body.paymentReference !== 'string' || !body.paymentReference.trim()) throw new HttpError(409, `The collecting party must ${difference > 0 ? 'collect' : 'refund'} PLN ${Math.abs(difference).toFixed(2)}. Operations must provide the verified external receipt before applying this change.`);
    }
    const items = await orderItems(order.id, transaction);
    const row = await PartnerAmendment.create({ bookingId: id, reference, requestHash: inputHash, previousHash: stateHash(order, items), selection, quote, difference, reason, actorId: context.actorId, notifyCustomer: body.notifyCustomer !== false, status: booking.paymentMode === 'platform' && difference > 0 ? 'pending_payment' : 'applying' }, { transaction });
    await partnerEvent(booking.partnerId, 'amendment.created', { amendmentId: row.id, reference, previousItems: booking.selection.items, items: selection.items, difference, ...(body.paymentReference ? { externalReceipt: body.paymentReference } : {}) }, context.actorId, id, transaction);
    return row;
  });
  if (amendment.status === 'pending_payment' && !amendment.checkoutUrl) await createAmendmentCheckout(amendment.id);
  if (amendment.status === 'applying') await completePartnerAmendment(amendment.id);
  await amendment.reload();
  try { await notifyPartnerAmendment(amendment.id); } catch { /* The background worker retries notifications. */ }
  return safeAmendment(amendment);
}

async function createAmendmentCheckout(id: number) {
  const config = await loadPartnerConfig();
  await sequelize.transaction(async transaction => {
    const row = (await PartnerAmendment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
    if (row.checkoutUrl || row.status !== 'pending_payment') return;
    const booking = (await PartnerBooking.findByPk(row.bookingId, { transaction }))!;
    const order = (await StorefrontOrder.findByPk(booking.orderId!, { transaction }))!;
    const partner = (await PartnerProfile.findByPk(booking.partnerId, { transaction }))!;
    const returnUrl = `${config.baseUrl}/api/partner-sales/${partner.publicCode}`;
    const reference = `amendment-${row.id}`;
    const metadata = { partnerAmendmentId: String(row.id), partnerPaymentReference: reference, partnerBookingId: String(booking.id) };
    const session = await getStorefrontStripeClient().checkout.sessions.create({ mode: 'payment', customer_email: order.customerEmail, line_items: [{ price_data: { currency: 'pln', unit_amount: minor(Number(row.difference)), product_data: { name: 'Experience booking amendment - additional payment' } }, quantity: 1 }], metadata, payment_intent_data: { metadata }, success_url: `${returnUrl}?payment=returned`, cancel_url: `${returnUrl}?payment=cancelled`, expires_at: Math.floor(Date.now() / 1000) + config.holdMinutes * 60 }, { idempotencyKey: `partner-amendment-${id}` });
    if (!session.url) throw new HttpError(502, 'Stripe did not return a payment link.');
    await row.update({ checkoutSessionId: session.id, checkoutUrl: session.url }, { transaction });
  });
}

async function applySelection(order: StorefrontOrder, booking: PartnerBooking, row: PartnerAmendment, transaction: Transaction) {
  const items = await orderItems(order.id, transaction);
  if (stateHash(order, items) !== row.previousHash) throw new HttpError(409, 'This booking changed after the amendment was prepared.');
  const affected = await checkAttendance(order, transaction);
  const selection = row.selection as unknown as PartnerSelection;
  await lockStorefrontCartReservationResources(selection, transaction);
  // Stored quote is the price the customer accepted. Validate current availability and product rules again.
  const partner = (await PartnerProfile.findByPk(booking.partnerId, { transaction }))!;
  await quotePartnerBooking(partner, selection, transaction, { inventoryReservationOrderId: order.id }, booking.snapshot);
  const quote = row.quote as unknown as StorefrontQuote;
  const previousCommission = booking.commissionCalculation;
  const nextCommission = previousCommission ? calculatePartnerCommission(booking.snapshot, quote) : null;
  const previousStartAt = affected[0]?.experienceStartAt || null;
  // Replace inventory commitments atomically; promotion redemption remains the original single sale.
  await StorefrontOrderResourceReservation.destroy({ where: { orderId: order.id, resourceType: 'inventory' }, transaction });
  const updated: StorefrontOrderItem[] = [];
  for (let index = 0; index < quote.items.length; index++) {
    const values = quote.items[index];
    if (items[index]) { await items[index].update(values as never, { transaction }); updated.push(items[index]); }
    else updated.push(await StorefrontOrderItem.create({ ...values, orderId: order.id } as never, { transaction }));
  }
  const removed = items.slice(quote.items.length);
  for (const item of removed) {
    const old = affected.find(value => value.platformBookingId === `${order.publicId}-${item.id}`);
    if (old) await BookingEvent.create({ bookingId: old.id, eventType: 'cancelled', platform: 'omnilodge', occurredAt: new Date(), eventPayload: { amendmentId: row.id, reason: 'Experience removed by amendment', previousPriceNet: old.priceNet, previousAddons: old.addonsSnapshot } } as never, { transaction });
    await Booking.update({ status: 'cancelled', statusChangedAt: new Date(), priceGross: '0.00', priceNet: '0.00', baseAmount: '0.00', refundedAmount: '0.00' }, { where: { platformBookingId: `${order.publicId}-${item.id}` }, transaction });
    await item.destroy({ transaction });
  }
  await order.update({ subtotal: quote.subtotal, addonTotal: quote.addonTotal, discountTotal: quote.discountTotal, total: quote.total, discountCode: quote.discountCode }, { transaction });
  order.items = updated;
  await reserveStorefrontOrderResources({ orderId: order.id, orderItems: updated, quote: { ...quote, discounts: [] }, paymentDueAt: null, transaction });
  if (booking.paymentReceived) await consumeStorefrontOrderResourceReservations({ orderId: order.id, promotionIds: [], now: new Date(), transaction });
  // Deliberate amendment replaces extras completely; paid-webhook repair keeps its separate preservation behavior.
  for (let index = 0; index < updated.length; index++) {
    const operational = affected.find(value => value.platformBookingId === `${order.publicId}-${updated[index].id}`);
    if (operational) {
      await BookingAddon.destroy({ where: { bookingId: operational.id }, transaction });
      await operational.update({ addonsSnapshot: buildStorefrontAddonsSnapshot(updated[index].addons, updated[index].options, updated[index].quantity), refundedAmount: '0.00' }, { transaction });
    }
  }
  await projectStorefrontOrderBookings(order, { bookingStatus: 'confirmed', paymentStatus: booking.paymentReceived ? 'paid' : 'unpaid', paymentMethod: order.paymentMethod, actorId: row.actorId ?? partner.createdBy }, transaction);
  if (booking.paymentMode === 'platform' && Number(row.difference) < 0) {
    await refundPartnerPayments(order, booking, -Number(row.difference), `amendment-${row.id}`, row.reason, transaction);
    await booking.update({ amendmentRefundedAmount: money(Number(booking.amendmentRefundedAmount || 0) - Number(row.difference)) }, { transaction });
  }
  if (booking.paymentMode !== 'platform') {
    if (!booking.paymentReceived) await booking.update({ total: quote.total, commission: nextCommission?.commission ?? money(quote.total * booking.snapshot.commissionPercent / 100) }, { transaction });
    else if (Number(row.difference) >= 0) await booking.update({ total: money(Number(booking.total) + Number(row.difference)), commission: nextCommission?.commission ?? money(Number(booking.commission) + Number(row.difference) * booking.snapshot.commissionPercent / 100) }, { transaction });
    else await booking.update({ refundedAmount: money(Number(booking.refundedAmount) - Number(row.difference)), amendmentRefundedAmount: money(Number(booking.amendmentRefundedAmount || 0) - Number(row.difference)) }, { transaction });
    await projectPartnerRefund(order.publicId, Math.max(0, minor(Number(booking.refundedAmount)) - minor(Number(booking.amendmentRefundedAmount || 0))), transaction);
    if (nextCommission) await booking.update({ commissionCalculation: nextCommission, commission: nextCommission.commission }, { transaction });
    const debts = await PartnerBooking.findAll({ where: { partnerId: partner.id, paymentMode: 'partner', paymentReceived: true }, transaction });
    if (money(debts.reduce((sum, value) => sum + partnerStatement(value).partnerOwes, 0)) > partner.agreement.creditLimit) throw new HttpError(409, 'The partner credit limit would be exceeded.');
  }
  await booking.update({ selection: row.selection, ...(nextCommission ? { commissionCalculation: nextCommission, commission: nextCommission.commission } : {}) }, { transaction });
  await row.update({ status: 'completed', failureReason: null }, { transaction });
  await partnerEvent(booking.partnerId, 'booking.amended', { amendmentId: row.id, reference: row.reference, items: selection.items, difference: Number(row.difference), total: quote.total, reason: row.reason, ...(nextCommission ? { previousCommission, commission: nextCommission } : {}) }, row.actorId, booking.id, transaction);
  for (const value of affected) await BookingEvent.create({ bookingId: value.id, eventType: 'amended', platform: 'omnilodge', occurredAt: new Date(), eventPayload: { amendmentId: row.id, reason: row.reason, difference: Number(row.difference) } } as never, { transaction });
  return { affected, previousStartAt, actorId: row.actorId ?? partner.createdBy };
}

export async function completePartnerAmendment(id: number) {
  const row = await PartnerAmendment.findByPk(id);
  if (!row || !pendingStatuses.includes(row.status)) return;
  const booking = (await PartnerBooking.findByPk(row.bookingId))!;
  if (row.status === 'pending_payment') {
    if (!row.checkoutSessionId) { await createAmendmentCheckout(id); return; }
    const session = await getStorefrontStripeClient().checkout.sessions.retrieve(row.checkoutSessionId, { expand: ['payment_intent'] });
    if (session.payment_status !== 'paid') {
      if (session.status === 'expired') await row.update({ status: 'expired', failureReason: 'The payment link expired. The original booking is unchanged.' });
      else if (session.status === 'complete' && typeof session.payment_intent === 'object' && session.payment_intent && ['requires_payment_method', 'canceled'].includes(session.payment_intent.status)) await row.update({ status: 'failed', failureReason: 'The extra payment failed. The original booking is unchanged and no change has been applied.' });
      return;
    }
    const intent = typeof session.payment_intent === 'object' ? session.payment_intent : null;
    if (!intent || intent.status !== 'succeeded' || intent.amount_received !== minor(Number(row.difference)) || intent.currency !== 'pln' || intent.metadata.partnerAmendmentId !== String(id) || intent.metadata.partnerBookingId !== String(booking.id)) throw new HttpError(409, 'The amendment payment could not be verified.');
    // Capture evidence before fulfillment. If inventory changed, this payment can be automatically returned.
    await sequelize.transaction(async transaction => {
      await StorefrontOrder.findByPk(booking.orderId!, { transaction, lock: transaction.LOCK.UPDATE });
      const locked = (await PartnerBooking.findByPk(booking.id, { transaction, lock: transaction.LOCK.UPDATE }))!;
      const order = (await StorefrontOrder.findByPk(booking.orderId!, { transaction }))!;
      if (order.stripePaymentIntentId) await verifiedPartnerPayments(order, locked, transaction);
      await PartnerPayment.findOrCreate({ where: { bookingId: booking.id, reference: `amendment-${id}` }, defaults: { amount: row.difference, commission: booking.commissionCalculation ? 0 : money(Number(row.difference) * booking.snapshot.commissionPercent / 100), paymentIntentId: intent.id }, transaction });
    });
  }
  try {
    await sequelize.transaction(async transaction => {
      const order = (await StorefrontOrder.findByPk(booking.orderId!, { transaction, lock: transaction.LOCK.UPDATE }))!;
      const locked = (await PartnerBooking.findByPk(booking.id, { transaction, lock: transaction.LOCK.UPDATE }))!;
      const amendment = (await PartnerAmendment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
      if (!pendingStatuses.includes(amendment.status)) return null;
      return applySelection(order, locked, amendment, transaction);
    });
    if (booking.paymentMode === 'platform') await reconcilePartnerOrder(booking.orderId!);
    try { await notifyPartnerAmendment(id); } catch { /* Notification delivery is retried independently. */ }
  } catch (error) {
    const current = (await PartnerAmendment.findByPk(id))!;
    if (current.status === 'completed') throw error; // Never refund a successfully applied change because an email/payout retry failed.
    if (row.status === 'pending_payment') await sequelize.transaction(async transaction => {
      const order = (await StorefrontOrder.findByPk(booking.orderId!, { transaction, lock: transaction.LOCK.UPDATE }))!;
      const locked = (await PartnerBooking.findByPk(booking.id, { transaction, lock: transaction.LOCK.UPDATE }))!;
      const amendment = (await PartnerAmendment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }))!;
      if (!pendingStatuses.includes(amendment.status)) return;
      await refundPartnerPayments(order, locked, Number(row.difference), `amendment-unavailable-${id}`, 'Amended selection could not be fulfilled', transaction);
      await locked.update({ amendmentRefundedAmount: money(Number(locked.amendmentRefundedAmount || 0) + Number(row.difference)) }, { transaction });
      await amendment.update({ status: 'failed', failureReason: 'The change could not be fulfilled. The extra payment was submitted for refund; the original booking remains.' }, { transaction });
      await partnerEvent(booking.partnerId, 'amendment.refunded', { amendmentId: id, amount: Number(row.difference) }, null, booking.id, transaction);
    });
    else await row.update({ failureReason: error instanceof HttpError ? error.message.slice(0, 256) : 'Amendment requires reconciliation. Retry the same reference.' });
    if (booking.paymentMode === 'platform') await reconcilePartnerOrder(booking.orderId!);
    throw error;
  }
}

export async function cancelPartnerAmendment(context: PartnerContext, bookingId: number, amendmentId: number) {
  const booking = await PartnerBooking.findOne({ where: { id: bookingId, partnerId: context.partner.id } });
  const row = await PartnerAmendment.findOne({ where: { id: amendmentId, bookingId } });
  if (!booking || !row || row.status !== 'pending_payment') throw new HttpError(409, 'No pending payment amendment was found.');
  if (row.checkoutSessionId) {
    const stripe = getStorefrontStripeClient();
    const session = await stripe.checkout.sessions.retrieve(row.checkoutSessionId);
    if (session.payment_status === 'paid') { await completePartnerAmendment(row.id); throw new HttpError(409, 'The amendment was paid and has been processed.'); }
    if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
  }
  await row.update({ status: 'expired', failureReason: 'Amendment cancelled. The original booking is unchanged.' });
  await partnerEvent(booking.partnerId, 'amendment.cancelled', { amendmentId }, context.actorId, booking.id);
  return { cancelled: true };
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export async function notifyPartnerAmendment(id: number) {
  await refreshConfigCacheKeys(['STOREFRONT_EMAIL_FROM_ADDRESS']);
  await sequelize.transaction(async transaction => {
    const row = await PartnerAmendment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row?.notifyCustomer || !['pending_payment', 'completed', 'failed'].includes(row.status)) return;
    const pending = row.status === 'pending_payment';
    if ((pending && (row.paymentEmailSentAt || !row.checkoutUrl)) || (!pending && row.notificationSentAt)) return;
    const booking = (await PartnerBooking.findByPk(row.bookingId, { transaction }))!;
    const order = (await StorefrontOrder.findByPk(booking.orderId!, { transaction }))!;
    const quote = row.quote as unknown as StorefrontQuote;
    const subject = pending ? 'Complete the payment for your booking change' : row.status === 'failed' ? 'Your booking change could not be completed' : 'Your experience booking has been updated';
    const payment = !booking.paymentReceived && !pending ? `Your amount due is now PLN ${Number(order.total).toFixed(2)}. No payment or refund was processed.` : pending ? `An additional payment of PLN ${Number(row.difference).toFixed(2)} is needed. Your existing booking remains until payment and availability are verified.` : row.status === 'failed' ? row.failureReason || 'The original booking remains unchanged.' : Number(row.difference) < 0 ? `A refund of PLN ${Math.abs(Number(row.difference)).toFixed(2)} has been submitted. Processing times depend on the collecting provider and your bank.` : Number(row.difference) > 0 ? `Additional payment of PLN ${Number(row.difference).toFixed(2)} was confirmed.` : 'No additional payment was needed.';
    const experiences = quote.items.map(item => `${item.productName}: ${item.experienceDate} at ${item.experienceTime}, ${item.quantity} guests`).join('\n');
    const text = `Hi ${order.customerFirstName},\n\n${payment}\n\n${row.status === 'failed' ? '' : experiences}\n\n${pending ? `Secure payment: ${row.checkoutUrl}\n\n` : ''}Booking reference: ${booking.externalReference}\n\nOmniLodge`;
    const html = `<div style="background:#100c0f;color:#fff8f2;max-width:640px;margin:auto;padding:28px;font-family:Arial,sans-serif"><h1 style="color:#ff168f">${escapeHtml(subject)}</h1><p>${escapeHtml(payment)}</p>${row.status === 'failed' ? '' : quote.items.map(item => `<p><strong>${escapeHtml(item.productName)}</strong><br>${escapeHtml(item.experienceDate)} at ${escapeHtml(item.experienceTime)}<br>${item.quantity} guests</p>`).join('')}${pending ? `<p><a style="display:inline-block;padding:16px;background:#ff168f;color:white;text-decoration:none" href="${escapeHtml(row.checkoutUrl)}">Complete additional payment</a></p>` : ''}<p>Booking reference: ${escapeHtml(booking.externalReference)}</p></div>`;
    const result = await sendMessage({ to: order.customerEmail, from: String(getConfigValue('STOREFRONT_EMAIL_FROM_ADDRESS') || ''), subject, textBody: text, htmlBody: html });
    await row.update(pending ? { paymentEmailSentAt: new Date() } : { notificationSentAt: new Date() }, { transaction });
    await partnerEvent(booking.partnerId, 'amendment.notification', { amendmentId: id, status: 'sent', stage: row.status, messageId: result.id }, row.actorId, booking.id, transaction);
    const operational = await Booking.findOne({ where: { platformOrderId: order.publicId }, transaction });
    if (result.id && operational) await BookingEmail.findOrCreate({ where: { messageId: result.id }, defaults: { messageId: result.id, threadId: result.threadId, bookingId: operational.id, fromAddress: result.from, toAddresses: order.customerEmail, subject, snippet: text.slice(0, 250), labelIds: ['SENT'], receivedAt: new Date(), ingestionStatus: 'sent', rawPayload: JSON.stringify({ id: result.id, threadId: result.threadId, payload: { mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } } }) } as never, transaction });
  });
}
