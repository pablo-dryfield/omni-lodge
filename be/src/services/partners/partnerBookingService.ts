import { calculatePartnerCommission } from './partnerCommission.js';
import { type Transaction } from 'sequelize';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import { PartnerBooking, PartnerOffering, PartnerProfile, PartnerAmendment } from '../../models/Partner.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import StorefrontOrderItem from '../../models/StorefrontOrderItem.js';
import Booking from '../../models/Booking.js';
import { getStorefrontStripeClient } from '../../finance/services/stripeClient.js';
import { quoteStorefrontCart, type StorefrontCartInput, type StorefrontQuoteOptions } from '../storefrontCommerceService.js';
import { lockStorefrontCartReservationResources, reserveStorefrontOrderResources, consumeStorefrontOrderResourceReservations } from '../storefrontOrderResourceReservationService.js';
import { projectStorefrontOrderBookings } from '../storefrontOrderProjectionService.js';
import { assertIdempotentReplay, assertProducts, hashToken, minor, money, opaqueToken, requestHash } from './partnerPolicy.js';
import { loadPartnerConfig } from './partnerConfig.js';
import { partnerEvent } from './partnerEvents.js';
import { partnerStatement } from './partnerStripeService.js';
import { deliverStorefrontOrderEmails } from '../storefrontOrderEmailService.js';
import logger from '../../utils/logger.js';
import type { PartnerContext } from './partnerAccess.js';

export type PartnerSelection = {
  reference: string;
  customer: { firstName: string; lastName: string; email: string; phone?: string };
  items: StorefrontCartInput['items'];
  discountCode?: string;
  offeringCode?: string;
  paymentMode: 'platform' | 'partner' | 'arrival';
  paymentReference?: string;
  requestApproval?: boolean;
};

export function parsePartnerSelection(value: unknown): PartnerSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Booking details are required.');
  const x = value as PartnerSelection;
  if (typeof x.reference !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(x.reference)) throw new HttpError(400, 'Provide a unique reference using letters, numbers, dots, colons or hyphens.');
  const c = x.customer;
  if (!c || typeof c.firstName !== 'string' || !c.firstName.trim() || c.firstName.length > 100 || typeof c.lastName !== 'string' || !c.lastName.trim() || c.lastName.length > 100 || typeof c.email !== 'string' || c.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email) || (c.phone != null && (typeof c.phone !== 'string' || c.phone.length > 40))) throw new HttpError(400, 'Valid customer name, email and optional phone are required.');
  if (!['platform', 'partner', 'arrival'].includes(x.paymentMode)) throw new HttpError(400, 'Invalid payment arrangement.');
  if (!Array.isArray(x.items) || !x.items.length || x.items.length > 20) throw new HttpError(400, 'Select between 1 and 20 experiences.');
  if (x.paymentMode === 'partner' && (typeof x.paymentReference !== 'string' || !x.paymentReference.trim() || x.paymentReference.length > 160)) throw new HttpError(400, 'Enter the partner receipt or payment reference.');
  return {
    reference: x.reference, customer: { firstName: c.firstName.trim(), lastName: c.lastName.trim(), email: c.email.trim().toLowerCase(), ...(c.phone ? { phone: c.phone.trim() } : {}) },
    items: x.items, paymentMode: x.paymentMode, ...(x.discountCode ? { discountCode: String(x.discountCode).slice(0, 100) } : {}), ...(x.offeringCode ? { offeringCode: String(x.offeringCode).slice(0, 64) } : {}), ...(x.paymentReference ? { paymentReference: x.paymentReference } : {}), requestApproval: x.requestApproval === true,
  };
}

async function expandedSelection(partner: PartnerProfile, input: PartnerSelection, transaction?: Transaction): Promise<PartnerSelection> {
  if (!input.offeringCode) return input;
  const offering = await PartnerOffering.findOne({ where: { partnerId: partner.id, code: input.offeringCode, active: true }, transaction });
  if (!offering) throw new HttpError(400, 'Package or referral voucher is unavailable.');
  // Packages constrain products/quantities; dates and distinct departure times remain customer-selected.
  if (offering.kind === 'package' && (offering.items.length !== input.items.length || offering.items.some((item, i) => item.productId !== Number(input.items[i].productId) || (item.experienceTime && item.experienceTime !== input.items[i].experienceTime)))) throw new HttpError(400, 'Select every package experience in the configured order and at its allowed time.');
  return input;
}

export async function quotePartnerBooking(partner: PartnerProfile, input: PartnerSelection, transaction?: Transaction, options: StorefrontQuoteOptions = {}, commissionAgreement = partner.agreement) {
  const selection = await expandedSelection(partner, input, transaction);
  assertProducts(partner.agreement, selection.items);
  const quote = await quoteStorefrontCart({ items: selection.items.map(item => ({ ...item, options: { fullName: `${selection.customer.firstName} ${selection.customer.lastName}`, email: selection.customer.email, phone: selection.customer.phone || '', ...item.options } })), discountCode: selection.discountCode }, transaction, { ...options, preserveExperienceLines: true, currencyCode: 'PLN' });
  return { ...quote, partnerCommission: calculatePartnerCommission(commissionAgreement, quote) };
}

const safeBooking = (booking: PartnerBooking) => ({ id: booking.id, reference: booking.externalReference, status: booking.status, paymentMode: booking.paymentMode, paymentReceived: booking.paymentReceived, total: Number(booking.total), commission: Number(booking.commission), commissionCalculation: booking.commissionCalculation, commissionEarned: partnerStatement(booking).commission, refundedAmount: Number(booking.refundedAmount), checkoutUrl: booking.status === 'pending_payment' ? booking.checkoutUrl : null, reconciliationError: booking.reconciliationError });
export { safeBooking };

async function checkoutForBooking(bookingId: number): Promise<PartnerBooking> {
  const config = await loadPartnerConfig();
  return sequelize.transaction(async transaction => {
    const booking = (await PartnerBooking.findByPk(bookingId, { transaction, lock: transaction.LOCK.UPDATE }))!;
    if (!booking.orderId || booking.paymentMode !== 'platform' || booking.status === 'cancelled') return booking;
    const order = await StorefrontOrder.findByPk(booking.orderId, { transaction });
    if (!order || order.paymentStatus === 'paid' || Number(order.total) === 0) return booking;
    if (booking.checkoutUrl) return booking;
    const partner = (await PartnerProfile.findByPk(booking.partnerId, { transaction }))!;
    const base = new URL(config.baseUrl);
    if (base.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && base.hostname === 'localhost')) throw new HttpError(503, 'Partner public URL must be configured as HTTPS.');
    const returnUrl = `${base.origin}/api/partner-sales/${encodeURIComponent(partner.publicCode)}`;
    const stripe = getStorefrontStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', customer_email: order.customerEmail,
      line_items: [{ price_data: { currency: 'pln', unit_amount: minor(Number(order.total)), product_data: { name: `Experience booking — ${partner.name}` } }, quantity: 1 }],
      metadata: { orderPublicId: order.publicId, partnerBookingId: String(booking.id) },
      payment_intent_data: { metadata: { orderPublicId: order.publicId, partnerBookingId: String(booking.id) }, transfer_group: `partner_${booking.id}` },
      success_url: `${returnUrl}?payment=returned`, cancel_url: `${returnUrl}?payment=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + config.holdMinutes * 60,
    }, { idempotencyKey: `partner-checkout-${booking.id}` });
    if (!session.url) throw new HttpError(502, 'Stripe did not return a payment link.');
    await order.update({ stripeCheckoutSessionId: session.id }, { transaction });
    await booking.update({ checkoutUrl: session.url }, { transaction });
    return booking;
  });
}

export async function createPartnerBooking(context: PartnerContext, rawInput: unknown, source: string, publicCustomer = false): Promise<ReturnType<typeof safeBooking>> {
  const config = await loadPartnerConfig();
  const selection = parsePartnerSelection(rawInput);
  if (source !== 'group' && selection.reference.startsWith('approved:')) throw new HttpError(400, 'The approved: reference prefix is reserved for management-approved requests.');
  if (publicCustomer && (selection.paymentMode !== 'platform' || selection.requestApproval)) throw new HttpError(403, 'Public checkout requires payment through OmniLodge.');
  const fingerprint = requestHash(selection);
  const result = await sequelize.transaction(async transaction => {
    const partner = await PartnerProfile.findByPk(context.partner.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!partner || partner.status !== 'active') throw new HttpError(403, 'Partner is unavailable.');
    if (!partner.agreement.paymentModes.includes(selection.paymentMode)) throw new HttpError(403, 'This payment arrangement is not enabled for the partner.');
    const existing = await PartnerBooking.findOne({ where: { partnerId: partner.id, externalReference: selection.reference }, transaction });
    if (existing) { assertIdempotentReplay(existing.requestHash, fingerprint); return existing; }
    await lockStorefrontCartReservationResources(selection, transaction);
    const quote = await quotePartnerBooking(partner, selection, transaction);
    const calculation = calculatePartnerCommission(partner.agreement, quote);
    const commission = calculation.commission;
    if (selection.paymentMode === 'partner' && !selection.requestApproval) {
      const debts = await PartnerBooking.findAll({ where: { partnerId: partner.id, paymentMode: 'partner', paymentReceived: true }, transaction });
      const owed = debts.reduce((sum, b) => sum + partnerStatement(b).partnerOwes, 0);
      if (money(owed + quote.total - commission) > partner.agreement.creditLimit) throw new HttpError(409, 'Partner credit limit would be exceeded. Use an OmniLodge payment link or settle outstanding bookings.');
    }
    const booking = await PartnerBooking.create({ partnerId: partner.id, externalReference: selection.reference, requestHash: fingerprint, status: selection.requestApproval ? 'requested' : 'pending_payment', source, selection, paymentMode: selection.paymentMode, snapshot: partner.agreement, total: quote.total, commission, commissionCalculation: calculation, commissionTransferred: 0, createdBy: context.actorId }, { transaction });
    if (selection.requestApproval) {
      await partnerEvent(partner.id, 'booking.requested', { reference: selection.reference, total: quote.total }, context.actorId, booking.id, transaction);
      return booking;
    }
    const now = new Date();
    const paid = selection.paymentMode === 'partner' || quote.total === 0;
    const confirmed = selection.paymentMode !== 'platform' || quote.total === 0;
    const actorId = context.actorId ?? partner.createdBy;
    const order = await StorefrontOrder.create({
      orderSource: 'partner', status: confirmed ? 'confirmed' : 'pending_payment', paymentStatus: paid ? 'paid' : 'unpaid', paymentMethod: selection.paymentMode === 'platform' ? quote.total === 0 ? 'free' : 'stripe' : selection.paymentMode === 'partner' ? 'partner_collected' : 'cash',
      currency: quote.currency, subtotal: quote.subtotal, addonTotal: quote.addonTotal, discountTotal: quote.discountTotal, total: quote.total,
      customerFirstName: selection.customer.firstName, customerLastName: selection.customer.lastName, customerEmail: selection.customer.email, customerPhone: selection.customer.phone || null,
      discountCode: quote.discountCode, createdByUserId: actorId, paidAt: paid ? now : null,
      metadata: { partnerId: partner.id, partnerBookingId: booking.id, partnerChannelId: partner.channelId, partnerPaymentReference: selection.paymentReference || null, promotionIds: quote.discounts.map(d => d.promotionId), discounts: quote.discounts },
      attribution: { utm_source: `partner-${partner.id}`, utm_medium: source },
    } as never, { transaction });
    const items = await StorefrontOrderItem.bulkCreate(quote.items.map(item => ({ ...item, orderId: order.id })) as never[], { transaction });
    order.items = items;
    await reserveStorefrontOrderResources({ orderId: order.id, orderItems: items, quote, paymentDueAt: confirmed ? null : new Date(Date.now() + config.holdMinutes * 60000), transaction });
    if (paid) await consumeStorefrontOrderResourceReservations({ orderId: order.id, promotionIds: quote.discounts.map(d => d.promotionId), now, transaction });
    await booking.update({ orderId: order.id, status: confirmed ? 'confirmed' : 'pending_payment', paymentReceived: paid, accessHash: hashToken(opaqueToken()) }, { transaction });
    if (confirmed) await projectStorefrontOrderBookings(order, { bookingStatus: 'confirmed', paymentStatus: paid ? 'paid' : 'unpaid', paymentMethod: order.paymentMethod, actorId }, transaction);
    await partnerEvent(partner.id, confirmed ? 'booking.confirmed' : 'booking.created', { reference: selection.reference, total: quote.total, paymentMode: selection.paymentMode }, context.actorId, booking.id, transaction);
    return booking;
  });
  if (result.orderId && result.paymentMode === 'platform' && Number(result.total) > 0) return safeBooking(await checkoutForBooking(result.id));
  if (result.orderId && result.status === 'confirmed') {
    const order = await StorefrontOrder.findByPk(result.orderId);
    if (order) { try { await deliverStorefrontOrderEmails(order.publicId); } catch { logger.warn(`[partners] Confirmation email awaits retry for booking ${result.id}.`); } }
  }
  return safeBooking(result);
}

export async function approvePartnerRequest(context: PartnerContext, bookingId: number, approve: boolean, reason: string) {
  if (!context.admin) throw new HttpError(403, 'Company-wide management must approve group requests.');
  if (!reason.trim()) throw new HttpError(400, 'An approval or rejection reason is required.');
  return sequelize.transaction(async transaction => {
    const request = await PartnerBooking.findOne({ where: { id: bookingId, partnerId: context.partner.id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!request || !['requested', 'approved', 'rejected'].includes(request.status)) throw new HttpError(404, 'Group request not found.');
    const confirmed = await PartnerBooking.findOne({ where: { partnerId: context.partner.id, externalReference: `approved:${request.id}` }, transaction });
    if (confirmed) {
      if (!approve) throw new HttpError(409, 'This request already created a booking. Cancel that booking instead.');
      if (request.status !== 'approved') await request.update({ status: 'approved' }, { transaction });
      return safeBooking(confirmed);
    }
    if (request.status === 'rejected') {
      if (approve) throw new HttpError(409, 'This request was already rejected. Submit a new request.');
      return safeBooking(request);
    }
    if (!approve) {
      await request.update({ status: 'rejected' }, { transaction });
      await partnerEvent(context.partner.id, 'booking.rejected', { reason }, context.actorId, request.id, transaction);
      return safeBooking(request);
    }
    const input = request.selection as unknown as PartnerSelection;
    const result = await createPartnerBooking(context, { ...input, reference: `approved:${request.id}`, requestApproval: false }, 'group');
    await request.update({ status: 'approved' }, { transaction });
    await partnerEvent(context.partner.id, 'booking.approved', { reason, confirmedBookingId: result.id }, context.actorId, request.id, transaction);
    return result;
  });
}

export async function partnerBookingDetails(partnerId: number, id: number) {
  const row = await PartnerBooking.findOne({ where: { partnerId, id } });
  if (!row) throw new HttpError(404, 'Booking not found.');
  const bookings = row.orderId ? await Booking.findAll({ where: { platformOrderId: (await StorefrontOrder.findByPk(row.orderId))?.publicId }, attributes: ['id', 'platformBookingId', 'status', 'paymentStatus', 'productName', 'experienceDate', 'experienceStartAt', 'partySizeTotal'] }) : [];
  const amendments = await PartnerAmendment.findAll({ where: { bookingId: row.id }, attributes: ['id', 'reference', 'status', 'difference', 'checkoutUrl', 'failureReason', 'createdAt'], order: [['id', 'DESC']], limit: 30 });
  return { ...safeBooking(row), amendments, currentTotal: row.orderId ? Number((await StorefrontOrder.findByPk(row.orderId))?.total || 0) : Number(row.total), discountCode: row.selection.discountCode || null, source: row.source, customer: row.selection.customer, items: row.selection.items, bookings, createdAt: row.createdAt, settledAmount: Number(row.settledAmount) };
}
