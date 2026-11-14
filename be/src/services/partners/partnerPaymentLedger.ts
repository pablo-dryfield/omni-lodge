import type { Transaction } from 'sequelize';
import type Stripe from 'stripe';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import { PartnerBooking, PartnerPayment } from '../../models/Partner.js';
import HttpError from '../../errors/HttpError.js';
import { getStorefrontStripeClient } from '../../finance/services/stripeClient.js';
import { hashToken, minor } from './partnerPolicy.js';

/** Must be called while holding the order and booking locks. Original amounts never change. */
export async function verifiedPartnerPayments(order: StorefrontOrder, booking: PartnerBooking, transaction: Transaction) {
  if (order.stripePaymentIntentId) await PartnerPayment.findOrCreate({ where: { bookingId: booking.id, reference: 'initial' }, defaults: { amount: booking.total, commission: booking.commission, paymentIntentId: order.stripePaymentIntentId, transferId: booking.transferId, reversedAmount: booking.reversedAmount }, transaction });
  const rows = await PartnerPayment.findAll({ where: { bookingId: booking.id }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  const stripe = getStorefrontStripeClient();
  const result: Array<{ payment: PartnerPayment; charge: Stripe.Charge }> = [];
  for (const payment of rows) {
    if (!payment.paymentIntentId) continue;
    const intent = await stripe.paymentIntents.retrieve(payment.paymentIntentId, { expand: ['latest_charge'] });
    const matches = payment.reference === 'initial' ? intent.metadata.orderPublicId === order.publicId : intent.metadata.partnerPaymentReference === payment.reference && intent.metadata.partnerBookingId === String(booking.id);
    if (intent.status !== 'succeeded' || intent.amount_received !== minor(Number(payment.amount)) || intent.currency !== 'pln' || !matches) throw new HttpError(409, 'Stripe payment does not match this partner booking.');
    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : intent.latest_charge ? await stripe.charges.retrieve(intent.latest_charge) : null;
    if (!charge?.paid) throw new HttpError(409, 'Stripe has not confirmed the charge.');
    result.push({ payment, charge });
  }
  return result;
}

/** An operation can span several original payments. Every part is independently recoverable. */
export async function refundPartnerPayments(order: StorefrontOrder, booking: PartnerBooking, amount: number, reference: string, reason: string, transaction: Transaction) {
  const verified = (await verifiedPartnerPayments(order, booking, transaction)).reverse();
  const stripe = getStorefrontStripeClient();
  let remaining = minor(amount);
  const results: Array<{ refundId: string; status: string | null; amount: number }> = [];
  const parts: Array<{ payment: PartnerPayment; charge: Stripe.Charge; operation: string; recovered?: Stripe.Refund }> = [];
  for (const { payment, charge } of verified) {
    const operation = hashToken(`${booking.id}:${reference}:${payment.id}`);
    let recovered: Stripe.Refund | undefined;
    let after: string | undefined;
    do {
      const page = await stripe.refunds.list({ payment_intent: payment.paymentIntentId!, limit: 100, ...(after ? { starting_after: after } : {}) });
      recovered = page.data.find(refund => refund.metadata?.partnerOperation === operation);
      after = !recovered && page.has_more ? page.data[page.data.length - 1]?.id : undefined;
    } while (after);
    if (recovered) {
      if (recovered.metadata?.partnerRequestedMinor && Number(recovered.metadata.partnerRequestedMinor) !== minor(amount)) throw new HttpError(409, 'This refund reference was used for another amount.');
      if (['failed', 'canceled'].includes(recovered.status || '')) throw new HttpError(409, 'A previous refund failed. Review the original payment before using a new operation reference.');
    }
    parts.push({ payment, charge, operation, recovered });
  }
  const previouslySubmitted = parts.reduce((sum, part) => sum + (part.recovered?.amount || 0), 0);
  const refundable = parts.reduce((sum, part) => sum + Math.max(0, part.charge.amount - part.charge.amount_refunded), 0);
  if (remaining < previouslySubmitted || remaining > previouslySubmitted + refundable) throw new HttpError(409, 'The amount exceeds the remaining refundable payment or conflicts with a previous operation.');
  for (const { payment, charge, operation, recovered } of parts) {
    if (recovered) {
      remaining -= recovered.amount;
      results.push({ refundId: recovered.id, status: recovered.status, amount: recovered.amount / 100 });
      continue;
    }
    const part = Math.min(remaining, charge.amount - charge.amount_refunded);
    if (part <= 0) continue;
    const refund = await stripe.refunds.create({ payment_intent: payment.paymentIntentId!, amount: part, metadata: { partnerBookingId: String(booking.id), partnerOperation: operation, partnerRequestedMinor: String(minor(amount)), reason: reason.slice(0, 500) } }, { idempotencyKey: `partner-refund-${operation}` });
    if (['failed', 'canceled'].includes(refund.status || '')) throw new HttpError(409, 'Stripe did not accept the refund.');
    remaining -= part;
    results.push({ refundId: refund.id, status: refund.status, amount: part / 100 });
  }
  if (remaining !== 0) throw new HttpError(409, 'The amount exceeds the remaining refundable payment. Any submitted refund parts remain recorded by Stripe and can be recovered with the same reference.');
  return results;
}
