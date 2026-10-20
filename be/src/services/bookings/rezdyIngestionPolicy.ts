import { Op, type Transaction } from 'sequelize';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import sequelize from '../../config/database.js';
import { canonicalizeProductLabel } from '../../utils/productName.js';
import type { ParsedBookingEvent, BookingFieldPatch } from './types.js';
import type { RezdySource } from './parsers/rezdyBookingParser.js';
import type { BookingPaymentStatus } from '../../constants/bookings.js';

export const getRezdySource = (event: ParsedBookingEvent): RezdySource | null => {
  const source = event.rawPayload?.rezdy as RezdySource | undefined;
  return source && /^R[A-Z0-9]{6,20}$/.test(source.orderId) ? source : null;
};

export const isRezdyLinkedViatorBooking = (booking: Booking, event: ParsedBookingEvent): boolean =>
  !getRezdySource(event) && event.platform === 'viator' && /^R[A-Z0-9]{6,20}$/.test(booking.platformOrderId ?? '');

export const prepareRezdyLinkedViatorEvent = (booking: Booking, event: ParsedBookingEvent): boolean => {
  if (!isRezdyLinkedViatorBooking(booking, event)) return false;
  // A second provider's confirmation is not a new sale or permission to erase refunds.
  if (event.eventType === 'created') return true;
  const financialKeys = ['baseAmount', 'priceGross', 'priceNet', 'commissionAmount', 'commissionRate',
    'refundedAmount', 'refundedCurrency', 'currency', 'discountAmount'] as const;
  const fields = event.bookingFields ?? {};
  const hasMoney = financialKeys.some((key) => fields[key] !== undefined)
    || event.rawPayload?.viatorTravellerAddition || event.rawPayload?.viatorTravellerRemoval;
  if (hasMoney && event.status !== 'cancelled') {
    throw new Error('Rezdy-linked Viator financial amendment requires the Rezdy order snapshot; supplier-net and customer-gross amounts must not be mixed.');
  }
  if (hasMoney) {
    event.bookingFields = { ...fields };
    for (const key of financialKeys) delete event.bookingFields[key];
    event.notes = `${event.notes ?? ''} | Viator cancellation recorded; financial amounts await the Rezdy refund confirmation.`;
    event.rawPayload = { ...event.rawPayload, rezdyFinancialsPreserved: true };
  }
  event.paymentStatus = undefined;
  return false;
};

const productKey = (name: string | null | undefined): string =>
  (canonicalizeProductLabel(name ?? '') ?? name ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const escapedName = (name: string): string => name.replace(/[\\%_]/g, '\\$&');

/** No guessed identity merges: name/date similarity requires operator review, not a new sale. */
const rejectPossibleResellerDuplicate = async (event: ParsedBookingEvent, transaction: Transaction): Promise<void> => {
  const source = getRezdySource(event);
  if (event.platform !== 'viator' && source?.agent !== 'viator') return;
  const fields = event.bookingFields ?? {};
  if (!fields.guestFirstName || !fields.guestLastName || !fields.experienceStartAt || !fields.productName) return;
  const candidates = await Booking.findAll({
    where: {
      platform: source ? 'viator' : 'rezdy',
      guestFirstName: { [Op.iLike]: escapedName(fields.guestFirstName) },
      guestLastName: { [Op.iLike]: escapedName(fields.guestLastName) },
      experienceStartAt: fields.experienceStartAt,
    },
    limit: 20,
    transaction,
  });
  for (const candidate of candidates) {
    if (productKey(candidate.productName) !== productKey(fields.productName)) continue;
    if (!source) {
      const agentEvent: BookingEvent | null = await BookingEvent.findOne({
        where: { bookingId: candidate.id, 'eventPayload.rezdy.agent': 'viator' },
        transaction,
      });
      if (!agentEvent) continue;
    }
    throw new Error(`Possible Rezdy/Viator duplicate of booking ${candidate.id}. Confirm the external reference before importing; no booking was changed.`);
  }
};

/** platform_order_id retains the Rezdy order even when an explicit BR reference links to Viator. */
export const resolveRezdyBookingIdentity = async (
  event: ParsedBookingEvent, transaction: Transaction,
): Promise<Booking | null> => {
  const source = getRezdySource(event);
  if (!source && event.platform !== 'viator') return null;
  if (source?.validationError) throw new Error(`Rezdy: ${source.validationError}`);
  // Serialize cross-provider collision detection, including a simultaneous direct Viator email.
  await sequelize.query("SELECT pg_advisory_xact_lock(hashtext('booking-ingestion:rezdy-viator'))", { transaction });
  let existing: Booking | null = null;
  if (source) {
    const orders = await Booking.findAll({
      where: {
        platform: { [Op.in]: ['rezdy', 'viator'] },
        [Op.or]: [{ platformOrderId: source.orderId }, { platform: 'rezdy', platformBookingId: source.orderId }],
      }, limit: 2, transaction,
    });
    if (orders.length > 1) throw new Error('Rezdy order is linked to multiple bookings; manual review required');
    existing = orders[0] ?? null;
    if (source.viatorReference) {
      const viator = await Booking.findOne({
        where: { platform: 'viator', platformBookingId: source.viatorReference }, transaction,
      });
      if (existing && viator && existing.id !== viator.id) throw new Error('Rezdy and Viator references point to different bookings; manual review required');
      existing = existing ?? viator;
      if (!existing) {
        event.platform = 'viator';
        event.platformBookingId = source.viatorReference;
      }
    }
    if (existing) {
      if (existing.platformOrderId && /^R[A-Z0-9]{6,20}$/.test(existing.platformOrderId)
        && existing.platformOrderId !== source.orderId) throw new Error('Viator booking already has a different Rezdy order; manual review required');
      event.platform = existing.platform;
      event.platformBookingId = existing.platformBookingId;
      if (existing.channelId) event.bookingFields = { ...event.bookingFields, channelId: existing.channelId };
    } else {
      if (event.eventType !== 'created') throw new Error('Original Rezdy booking not found. Import the original order before its amendment, cancellation or refund.');
      await rejectPossibleResellerDuplicate(event, transaction);
    }
  } else {
    existing = await Booking.findOne({ where: { platform: 'viator', platformBookingId: event.platformBookingId }, transaction });
    if (!existing) {
      // An explicit BR reference can be learned after the original online R order was created.
      const links = await BookingEvent.findAll({
        where: { 'eventPayload.rezdy.viatorReference': event.platformBookingId },
        attributes: ['bookingId'], transaction,
      });
      const bookingIds = [...new Set(links.map((link) => String(link.bookingId)))];
      if (bookingIds.length > 1) throw new Error('Viator reference is linked to multiple Rezdy bookings; manual review required');
      if (bookingIds[0]) {
        existing = await Booking.findByPk(bookingIds[0], { transaction });
        if (existing?.channelId) event.bookingFields = { ...event.bookingFields, channelId: existing.channelId };
      }
      if (!existing) await rejectPossibleResellerDuplicate(event, transaction);
    }
  }
  return existing;
};

type FinancialBooking = Pick<Booking, 'priceGross' | 'priceNet' | 'commissionAmount' | 'refundedAmount' | 'currency'>;
const numeric = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
};
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateRezdyFinancials = (
  booking: FinancialBooking, source: RezdySource, currency: string | null | undefined,
  refundAlreadyApplied = false,
): { patch: BookingFieldPatch; paymentStatus?: BookingPaymentStatus; fullyRefunded: boolean; reportedCommissionMismatch?: boolean } => {
  const patch: BookingFieldPatch = {};
  const effectiveCurrency = currency ?? booking.currency;
  if (currency && booking.currency && currency !== booking.currency) throw new Error('Rezdy order currency changed; manual review required');
  if (source.refundCurrency && effectiveCurrency && source.refundCurrency !== effectiveCurrency) throw new Error('Rezdy refund currency mismatch; manual review required');
  const existingRefund = numeric(booking.refundedAmount) ?? 0;
  const refund = money(Math.max(existingRefund, source.refundTotal
    ?? (source.refundAmount !== undefined ? existingRefund + (refundAlreadyApplied ? 0 : source.refundAmount) : existingRefund)));
  const gross = source.grossTotal ?? numeric(booking.priceGross);
  const commission = source.commission ?? (source.netTotal !== undefined && gross !== undefined
    ? money(gross - source.netTotal) : numeric(booking.commissionAmount) ?? 0);
  const hasFinancialChange = source.grossTotal !== undefined || source.commission !== undefined
    || source.netTotal !== undefined || source.refundTotal !== undefined || source.refundAmount !== undefined;
  if (commission < 0 || (source.netTotal !== undefined && gross !== undefined && source.netTotal > gross + 0.01)) {
    throw new Error('Rezdy supplier net exceeds order total; manual review required');
  }
  const existingNet = numeric(booking.priceNet);
  const existingGross = numeric(booking.priceGross);
  const hasPriceSnapshot = source.grossTotal !== undefined || source.commission !== undefined || source.netTotal !== undefined;
  const hadReportedNet = existingNet !== undefined && existingGross !== undefined
    && Math.abs(existingGross - (numeric(booking.commissionAmount) ?? 0) - existingNet) > 0.01;
  if (hadReportedNet && hasPriceSnapshot && source.netTotal === undefined) {
    throw new Error('Rezdy snapshot omits the explicit supplier net needed for this order; manual review required');
  }
  const net = source.netTotal ?? (!hasPriceSnapshot && existingNet !== undefined ? existingNet : gross === undefined ? undefined : money(Math.max(gross - commission, 0)));
  const reportedCommissionMismatch = source.netTotal !== undefined && gross !== undefined
    && Math.abs(source.netTotal + commission - gross) > 0.01;
  if (gross !== undefined && commission > gross + 0.01) throw new Error('Rezdy commission exceeds order total; manual review required');
  if (gross !== undefined && refund > gross + 0.01) throw new Error('Rezdy refunded amount exceeds order total; manual review required');
  if (hasFinancialChange && gross === undefined) throw new Error('Rezdy order total is required to reconcile payment/refund amounts');
  if (hasFinancialChange && gross !== undefined) {
    patch.priceGross = money(gross);
    patch.commissionAmount = money(commission);
    patch.priceNet = money(net!);
    patch.baseAmount = money(Math.max(net! - refund, 0));
  }
  if (source.refundTotal !== undefined || source.refundAmount !== undefined) {
    patch.refundedAmount = refund;
    patch.refundedCurrency = effectiveCurrency;
  }
  const fullyRefunded = gross !== undefined && gross > 0 && refund >= gross - 0.01;
  let paymentStatus: BookingPaymentStatus | undefined;
  if (refund > 0) paymentStatus = fullyRefunded ? 'refunded' : 'partial';
  else if (source.totalPaid !== undefined && gross !== undefined) {
    paymentStatus = source.totalPaid >= gross - 0.01 ? 'paid' : source.totalPaid > 0 ? 'partial' : 'unpaid';
  }
  return { patch, paymentStatus, fullyRefunded, ...(reportedCommissionMismatch ? { reportedCommissionMismatch: true } : {}) };
};

export const applyRezdyFinancials = async (
  booking: Booking, event: ParsedBookingEvent, transaction: Transaction, options: { refundOnly?: boolean } = {},
): Promise<void> => {
  const source = getRezdySource(event);
  if (!source) return;
  let refundAlreadyApplied = false;
  if (source.refundReference && source.refundAmount !== undefined && source.refundTotal === undefined) {
    const prior: BookingEvent | null = await BookingEvent.findOne({
      where: { bookingId: booking.id, 'eventPayload.rezdy.refundReference': source.refundReference },
      transaction,
    });
    if (prior) {
      const previous = (prior.eventPayload as { rezdy?: RezdySource } | null)?.rezdy;
      if (previous?.refundAmount !== source.refundAmount || previous?.refundCurrency !== source.refundCurrency) {
        throw new Error('Rezdy refund reference was reused with different amounts; manual review required');
      }
      refundAlreadyApplied = true;
    }
  }
  const financialSource = options.refundOnly ? { ...source, grossTotal: undefined, netTotal: undefined, commission: undefined, totalPaid: undefined } : source;
  const result = calculateRezdyFinancials(booking, financialSource, options.refundOnly ? booking.currency : event.bookingFields?.currency, refundAlreadyApplied);
  if (result.patch.priceNet !== undefined) source.financialBasis = financialSource.netTotal !== undefined
    ? 'reported_supplier_net' : financialSource.grossTotal === undefined && financialSource.commission === undefined
      ? 'existing_supplier_net' : 'gross_less_commission';
  if (result.reportedCommissionMismatch) {
    source.reportedCommissionMismatch = true;
    event.notes = `${event.notes ?? ''} | Reported Rezdy supplier net is used for revenue; the separately reported commission does not reconcile to customer gross.`;
  }
  event.bookingFields = { ...event.bookingFields, ...result.patch };
  event.paymentStatus = result.paymentStatus;
  if (result.fullyRefunded) {
    event.status = 'cancelled';
    event.eventType = 'cancelled';
  }
};
