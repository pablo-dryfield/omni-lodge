import { createHash } from 'node:crypto';
import { Op, type Transaction } from 'sequelize';
import type Stripe from 'stripe';
import Booking from '../models/Booking.js';
import BookingAddon from '../models/BookingAddon.js';
import BookingEvent from '../models/BookingEvent.js';
import HttpError from '../errors/HttpError.js';
import { normalizeBookingExtrasSnapshot } from '../utils/bookingExtras.js';
import type { OrderExtras } from '../types/booking.js';

const EXTRA_KEYS = ['cocktails', 'tshirts', 'photos'] as const;
type ExtraKey = typeof EXTRA_KEYS[number];
export type CounterAddonRefundOperation = 'verify' | 'refund' | 'rectify';
type Allocation = { refundId: string; amount: number };
export type CounterRefundLine = {
  addon: BookingAddon;
  key: ExtraKey;
  name: string;
  quantity: number;
  unitAmount: number;
  currency: string;
};
export type CounterRefundPayment = {
  stripeClient: Stripe;
  transactionId: string;
  transactionType: 'payment_intent' | 'charge';
  currency: string;
  paidAmount: number;
  bookingAmount: number;
  lines: CounterRefundLine[];
  onApplied?: (transaction: Transaction) => Promise<void>;
};
type SelectedLine = CounterRefundLine & { removeQuantity: number };
type RefundEvidence = { id: string; amount: number; status: string | null; created: number };
export type CounterAddonRefundVerification = {
  status: 'clear' | 'verified' | 'pending' | 'insufficient' | 'full_refund' | 'manual_review';
  selectionKey: string;
  amount: number;
  currency: string;
  bookingAmount: number;
  refundedAmount: number;
  availableRefundAmount: number;
  message: string;
  refunds: RefundEvidence[];
  addons: Array<{ id: number; platformAddonName: string; quantity: number; refundQty: number; unitPrice: string; currency: string }>;
};

const money = (amount: number): string => (amount / 100).toFixed(2);
const minor = (value: unknown): number => Math.max(0, Math.round((Number(value) || 0) * 100));
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const parseCounterRefundExtras = (value: unknown): OrderExtras => {
  const input = object(value);
  if (Object.keys(input).some((key) => !EXTRA_KEYS.includes(key as ExtraKey))) {
    throw new HttpError(400, 'Only add-on quantities can be verified or rectified.');
  }
  const extras: OrderExtras = { cocktails: 0, tshirts: 0, photos: 0 };
  for (const key of EXTRA_KEYS) {
    const quantity = Number(input[key] ?? 0);
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new HttpError(400, 'Add-on quantities must be non-negative whole numbers.');
    extras[key] = quantity;
  }
  if (!EXTRA_KEYS.some((key) => extras[key] > 0)) throw new HttpError(400, 'Select at least one add-on.');
  return extras;
};

const selectLines = (payment: CounterRefundPayment, extras: OrderExtras): SelectedLine[] => {
  const remaining = { ...extras };
  const selected: SelectedLine[] = [];
  for (const line of [...payment.lines].sort((a, b) => Number(a.addon.id) - Number(b.addon.id))) {
    const removeQuantity = Math.min(remaining[line.key], line.quantity);
    if (removeQuantity <= 0) continue;
    if (line.currency.toLowerCase() !== payment.currency.toLowerCase()) {
      throw new HttpError(409, 'Add-on and Stripe payment currencies differ. A manager must review this booking.');
    }
    if (!Number.isSafeInteger(line.unitAmount) || line.unitAmount <= 0) {
      throw new HttpError(409, 'The paid add-on price could not be verified. A manager must review this booking.');
    }
    selected.push({ ...line, removeQuantity });
    remaining[line.key] -= removeQuantity;
  }
  if (EXTRA_KEYS.some((key) => remaining[key] > 0)) {
    throw new HttpError(409, 'These add-on quantities are no longer available. Refresh the booking and verify again.');
  }
  return selected;
};

const listRefunds = async (payment: CounterRefundPayment): Promise<Stripe.Refund[]> => {
  const refunds = new Map<string, Stripe.Refund>();
  let cursor: string | undefined;
  // Read every page; an incomplete list must never be treated as "not refunded".
  for (let page = 0; page < 100; page += 1) {
    const result = await payment.stripeClient.refunds.list({
      ...(payment.transactionType === 'payment_intent' ? { payment_intent: payment.transactionId } : { charge: payment.transactionId }),
      limit: 100,
      ...(cursor ? { starting_after: cursor } : {}),
    });
    for (const refund of result.data) {
      if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0) throw new HttpError(502, 'Stripe returned an invalid refund amount. Verification stopped.');
      const reference = payment.transactionType === 'payment_intent' ? refund.payment_intent : refund.charge;
      if (typeof reference === 'string' && reference !== payment.transactionId) throw new HttpError(502, 'Stripe refund evidence belongs to another payment. Verification stopped.');
      refunds.set(refund.id, refund);
    }
    if (!result.has_more) return [...refunds.values()];
    const next = result.data[result.data.length - 1]?.id;
    if (!next || next === cursor) break;
    cursor = next;
  }
  throw new HttpError(502, 'Stripe refund history could not be read completely. No refund or rectification was performed.');
};

export const inspectCounterAddonRefunds = ({
  bookingId, payment, selected, refunds, events, sharedPayment,
}: {
  bookingId: number;
  payment: CounterRefundPayment;
  selected: SelectedLine[];
  refunds: Stripe.Refund[];
  events: Array<{ bookingId?: number; eventPayload: Record<string, unknown> | null }>;
  sharedPayment: boolean;
}): { verification: CounterAddonRefundVerification; allocations: Allocation[]; attributedRefunded: number } => {
  const amount = selected.reduce((total, line) => total + line.unitAmount * line.removeQuantity, 0);
  const selectionKey = createHash('sha256').update(JSON.stringify({
    bookingId, transactionId: payment.transactionId, currency: payment.currency.toLowerCase(),
    lines: selected.map((line) => [Number(line.addon.id), line.quantity, line.removeQuantity, line.unitAmount]),
  })).digest('hex');
  const consumed = new Map<string, number>();
  const previouslyApplied = new Set<string>();
  const recordedOwners = new Map<string, Set<string>>();
  for (const event of events) {
    const payload = object(event.eventPayload);
    if (typeof payload.stripeRefundId === 'string' && event.bookingId != null) {
      const owners = recordedOwners.get(payload.stripeRefundId) ?? new Set<string>();
      owners.add(String(event.bookingId));
      recordedOwners.set(payload.stripeRefundId, owners);
    }
    if (Array.isArray(payload.stripeRefundAllocations)) {
      for (const value of payload.stripeRefundAllocations) {
        const allocation = object(value);
        const id = String(allocation.refundId ?? '');
        const used = Number(allocation.amount);
        if (id && Number.isSafeInteger(used) && used > 0) consumed.set(id, (consumed.get(id) ?? 0) + used);
      }
    } else if (typeof payload.stripeRefundId === 'string' && payload.action !== 'counter-addon-refund-submitted') {
      const people = object(payload.people);
      const peopleQuantity = Number(payload.peopleQuantity ?? people.refundedQty ?? 0);
      const addons = Array.isArray(payload.addons) ? payload.addons.map(object) : [];
      const addonAmount = addons.reduce((total, addon) => total + minor(addon.amount ?? addon.refundAmount), 0);
      const hasAddonQuantities = addons.some((addon) => Number(addon.refundedQty ?? addon.refundQty) > 0) ||
        Object.values(object(payload.addonQuantities)).some((quantity) => Number(quantity) > 0);
      if (peopleQuantity > 0 || Number(people.amount) > 0 || (hasAddonQuantities && addonAmount <= 0)) {
        // People refunds cannot fund add-on rectification; unknown itemised amounts fail closed.
        previouslyApplied.add(payload.stripeRefundId);
      } else if (addonAmount > 0) {
        consumed.set(payload.stripeRefundId, (consumed.get(payload.stripeRefundId) ?? 0) + addonAmount);
      }
      // Amount-only manual refunds have not removed any add-ons. They remain eligible,
      // while money reconciliation below preserves the already-recorded refund total.
    }
  }
  const active = refunds.filter((refund) => refund.status !== 'failed' && refund.status !== 'canceled');
  if (active.some((refund) => refund.currency.toLowerCase() !== payment.currency.toLowerCase())) {
    throw new HttpError(502, 'Stripe returned inconsistent refund currencies. Verification stopped.');
  }
  const ownerOf = (refund: Stripe.Refund): string | null => {
    if (refund.metadata?.bookingId) return refund.metadata.bookingId;
    const recorded = recordedOwners.get(refund.id);
    return recorded?.size === 1 ? [...recorded][0] : null;
  };
  const relevant = active.filter((refund) => !ownerOf(refund) || ownerOf(refund) === String(bookingId));
  const ambiguous = sharedPayment && relevant.some((refund) => !ownerOf(refund) && !previouslyApplied.has(refund.id));
  const succeeded = relevant.filter((refund) => refund.status === 'succeeded');
  const attributedRefunded = succeeded.reduce((total, refund) => total + refund.amount, 0);
  const unapplied = relevant.filter((refund) => !previouslyApplied.has(refund.id));
  const available = succeeded.filter((refund) => !previouslyApplied.has(refund.id)).map((refund) => ({
    refundId: refund.id, amount: Math.max(0, refund.amount - (consumed.get(refund.id) ?? 0)),
  })).filter((allocation) => allocation.amount > 0);
  const availableAmount = available.reduce((total, allocation) => total + allocation.amount, 0);
  const pending = unapplied.some((refund) => refund.status !== 'succeeded');
  const fullRefund = amount >= payment.bookingAmount || attributedRefunded >= payment.bookingAmount ||
    active.reduce((total, refund) => total + refund.amount, 0) >= payment.paidAmount;
  let status: CounterAddonRefundVerification['status'] = 'clear';
  let message = 'Stripe confirms there is no unapplied refund for these add-ons.';
  if (ambiguous) {
    status = 'manual_review';
    message = 'This payment covers multiple bookings and has an unassigned Stripe refund. A manager must identify the correct booking before another refund.';
  } else if (fullRefund) {
    status = 'full_refund';
    message = 'The refund reaches the full booking amount. Use the booking cancellation/reconciliation process; add-on-only rectification is not available.';
  } else if (availableAmount >= amount) {
    status = 'verified';
    message = 'Stripe confirms a previous successful partial refund covers these add-ons. Rectify the booking without sending another refund.';
  } else if (pending) {
    status = 'pending';
    message = 'A refund was previously submitted to Stripe and is still pending or requires action. Do not refund again. Verify again once Stripe confirms success.';
  } else if (availableAmount > 0) {
    status = 'insufficient';
    message = 'Stripe shows a previous partial refund, but it does not cover the selected add-ons. A manager must review the difference before another refund.';
  }
  let required = amount;
  const allocations = available.map((allocation) => {
    const allocated = Math.min(required, allocation.amount);
    required -= allocated;
    return { refundId: allocation.refundId, amount: allocated };
  }).filter((allocation) => allocation.amount > 0);
  return {
    verification: {
      status, selectionKey, amount, currency: payment.currency.toUpperCase(), bookingAmount: payment.bookingAmount,
      refundedAmount: attributedRefunded, availableRefundAmount: availableAmount, message,
      refunds: relevant.map((refund) => ({ id: refund.id, amount: refund.amount, status: refund.status, created: refund.created })),
      addons: selected.map((line) => ({ id: Number(line.addon.id), platformAddonName: line.name, quantity: line.quantity,
        refundQty: line.removeQuantity, unitPrice: money(line.unitAmount), currency: line.currency.toUpperCase() })),
    },
    allocations,
    attributedRefunded,
  };
};

export const runCounterAddonRefund = async ({
  bookingId, actorId, operation, extras, expectedExtras, selectionKey, resolvePayment,
}: {
  bookingId: number;
  actorId: number;
  operation: CounterAddonRefundOperation;
  extras: OrderExtras;
  expectedExtras: unknown;
  selectionKey?: string;
  resolvePayment: (booking: Booking, transaction: Transaction) => Promise<CounterRefundPayment>;
}): Promise<{ booking: Booking; verification: CounterAddonRefundVerification; applied: boolean }> => {
  const sequelize = Booking.sequelize;
  if (!sequelize) throw new HttpError(503, 'Database client is not initialized.');
  return sequelize.transaction(async (transaction) => {
    const initial = await Booking.findByPk(bookingId, { transaction });
    if (!initial) throw new HttpError(404, 'Booking not found.');
    if (!['ecwid', 'omnilodge'].includes(initial.platform)) throw new HttpError(400, 'Stripe add-on verification is available for Ecwid and OmniLodge card bookings only.');
    // Serialize all counter refunds/rectifications for the same order, across tabs and bookings.
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtextextended(:identity, 0))', {
      replacements: { identity: `counter-addon-refund:${initial.platform}:${initial.platformOrderId || initial.platformBookingId}` }, transaction,
    });
    const booking = await Booking.findByPk(bookingId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!booking || booking.status === 'cancelled') throw new HttpError(409, 'This booking is no longer active.');
    const currentExtras = normalizeBookingExtrasSnapshot(booking.addonsSnapshot);
    const expected = object(expectedExtras);
    for (const key of EXTRA_KEYS) {
      if (extras[key] <= 0) continue;
      if (!Object.prototype.hasOwnProperty.call(expected, key) || !Number.isSafeInteger(expected[key]) || expected[key] !== currentExtras[key]) {
        throw new HttpError(409, 'The booking add-ons changed or were already rectified. Refresh the reservation before verifying or refunding again.');
      }
    }
    const payment = await resolvePayment(booking, transaction);
    if (payment.bookingAmount <= 0 || payment.paidAmount <= 0) throw new HttpError(409, 'The original paid booking amount could not be verified.');
    for (const key of EXTRA_KEYS) {
      if (extras[key] > 0 && payment.lines.filter((line) => line.key === key).reduce((total, line) => total + line.quantity, 0) !== currentExtras[key]) {
        throw new HttpError(409, 'The stored add-on quantities do not match the booking. A manager must reconcile the booking before refunding.');
      }
    }
    const selected = selectLines(payment, extras);
    const related = booking.platformOrderId ? await Booking.findAll({
      where: { platform: booking.platform, platformOrderId: booking.platformOrderId }, attributes: ['id'], transaction,
    }) : [booking];
    const events = await BookingEvent.findAll({ where: { bookingId: { [Op.in]: related.map((row) => row.id) } }, transaction });
    let refunds = await listRefunds(payment);
    let inspection = inspectCounterAddonRefunds({ bookingId, payment, selected, refunds, events, sharedPayment: related.length > 1 });
    if (operation === 'verify') return { booking, verification: inspection.verification, applied: false };
    if (!selectionKey || selectionKey !== inspection.verification.selectionKey) {
      throw new HttpError(409, 'The booking changed. Verify the current add-on quantities again.');
    }
    if (operation === 'refund') {
      if (inspection.verification.status !== 'clear') {
        throw new HttpError(409, inspection.verification.message, { verification: inspection.verification });
      }
      const failedIds = refunds.filter((refund) => refund.status === 'failed' || refund.status === 'canceled').map((refund) => refund.id).sort().join(',');
      const attemptKey = createHash('sha256').update(`${selectionKey}:${failedIds}`).digest('hex');
      const refund = await payment.stripeClient.refunds.create({
        ...(payment.transactionType === 'payment_intent' ? { payment_intent: payment.transactionId } : { charge: payment.transactionId }),
        amount: inspection.verification.amount,
        reason: 'requested_by_customer',
        metadata: { bookingId: String(booking.id), source: 'counter-addons', selectionKey },
      }, { idempotencyKey: `counter-addons-${booking.id}-${attemptKey}` });
      refunds = [...refunds.filter((row) => row.id !== refund.id), refund];
      inspection = inspectCounterAddonRefunds({ bookingId, payment, selected, refunds, events, sharedPayment: related.length > 1 });
      if (refund.status !== 'succeeded') {
        if (refund.status === 'failed' || refund.status === 'canceled') throw new HttpError(409, 'Stripe did not complete the refund. The booking has not been changed.');
        await writeEvent(booking, actorId, { action: 'counter-addon-refund-submitted', stripeRefundId: refund.id,
          stripeTransactionId: payment.transactionId, selectionKey, stripeStatus: refund.status }, transaction);
        return { booking, verification: inspection.verification, applied: false };
      }
    }
    if (inspection.verification.status !== 'verified') {
      throw new HttpError(409, inspection.verification.message, { verification: inspection.verification });
    }

    const snapshot = { ...object(booking.addonsSnapshot) };
    const nextExtras = normalizeBookingExtrasSnapshot(snapshot);
    for (const line of selected) {
      line.addon.quantity = line.quantity - line.removeQuantity;
      line.addon.totalPrice = money(line.addon.quantity * line.unitAmount);
      await line.addon.save({ transaction });
      nextExtras[line.key] = Math.max(0, nextExtras[line.key] - line.removeQuantity);
    }
    snapshot.extras = nextExtras;
    booking.addonsSnapshot = snapshot;
    const remainingActions = { ...extras };
    if (Array.isArray(booking.addonRefundActions)) {
      booking.addonRefundActions = booking.addonRefundActions.flatMap((value) => {
        const action = object(value);
        const key = action.addonKey as ExtraKey;
        if (!EXTRA_KEYS.includes(key) || action.status === 'completed' || !remainingActions[key]) return [action];
        const quantity = Math.max(0, Math.round(Number(action.quantity) || 0));
        const completed = Math.min(quantity, remainingActions[key]);
        remainingActions[key] -= completed;
        const record = { ...action, quantity: completed, status: 'completed', completedSource: 'stripe_verified',
          completedBy: actorId, completedAt: new Date().toISOString(), stripeRefundIds: inspection.allocations.map((entry) => entry.refundId) };
        return completed < quantity ? [record, { ...action, id: `${String(action.id)}-remaining`, quantity: quantity - completed }] : [record];
      });
    }
    // Synchronize money already sent by Stripe; never add the same refund twice locally.
    const refunded = Math.max(minor(booking.refundedAmount), inspection.attributedRefunded);
    booking.refundedAmount = money(refunded);
    booking.refundedCurrency = payment.currency.toUpperCase();
    booking.baseAmount = money(Math.max(payment.bookingAmount - refunded, 0));
    if (booking.addonsAmount !== null) booking.addonsAmount = money(Math.max(minor(booking.addonsAmount) - inspection.verification.amount, 0));
    booking.paymentStatus = 'partial';
    booking.updatedBy = actorId;
    // Attendance and party size deliberately stay unchanged. Cocktail guests become normal guests.
    await booking.save({ transaction });
    await payment.onApplied?.(transaction);
    await writeEvent(booking, actorId, {
      action: operation === 'refund' ? 'counter-addon-refund-applied' : 'counter-addon-refund-rectified',
      selectionKey, stripeTransactionId: payment.transactionId, stripeTransactionType: payment.transactionType,
      currency: payment.currency.toUpperCase(), amount: inspection.verification.amount,
      stripeRefundAllocations: inspection.allocations,
      addons: selected.map((line) => ({ bookingAddonId: Number(line.addon.id), key: line.key, refundedQty: line.removeQuantity, remainingQty: line.addon.quantity })),
    }, transaction);
    return { booking, verification: inspection.verification, applied: true };
  });
};

const writeEvent = async (booking: Booking, actorId: number, payload: Record<string, unknown>, transaction: Transaction): Promise<void> => {
  const event = BookingEvent.build();
  event.bookingId = booking.id;
  event.emailId = null;
  event.emailMessageId = null;
  event.eventType = 'note';
  event.platform = booking.platform;
  event.statusAfter = booking.status;
  event.eventPayload = { source: 'counter', actorId, ...payload };
  event.occurredAt = new Date();
  event.ingestedAt = event.occurredAt;
  event.processedAt = event.occurredAt;
  await event.save({ transaction });
};
