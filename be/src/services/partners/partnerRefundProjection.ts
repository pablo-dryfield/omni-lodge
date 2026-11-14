import type { Transaction } from 'sequelize';
import Booking from '../../models/Booking.js';
import BookingEvent from '../../models/BookingEvent.js';
import { minor } from './partnerPolicy.js';
import { allocateRefundMinor } from './partnerRefundAllocation.js';

/** Project the authoritative cumulative refund; repeated provider events are harmless. */
export async function projectPartnerRefund(orderPublicId: string, refundedMinor: number, transaction: Transaction) {
  const rows = await Booking.findAll({ where: { platformOrderId: orderPublicId }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
  if (!rows.length) return null; // Fulfillment may not have projected the paid order yet.
  const lifetimeRefundedMinor = refundedMinor;
  // A lower-priced amendment can leave historic refunds above the current
  // selection's price. Keep the full receipts on PartnerBooking/Stripe while
  // limiting the operational projection to the current experience value.
  refundedMinor = Math.min(refundedMinor, rows.reduce((sum, row) => sum + minor(Number(row.priceNet ?? row.priceGross ?? 0)), 0));
  const current = rows.map(row => minor(Number(row.refundedAmount || 0)));
  const previous = current.reduce((sum, value) => sum + value, 0);
  if (previous === refundedMinor) return null;
  const growing = refundedMinor > previous;
  const capacities = rows.map((row, index) => growing ? Math.max(0, minor(Number(row.priceNet ?? row.priceGross)) - current[index]) : current[index]);
  const allocation = allocateRefundMinor(Math.abs(refundedMinor - previous), capacities);
  for (const [index, row] of rows.entries()) {
    if (!allocation[index]) continue;
    const amount = current[index] + allocation[index] * (growing ? 1 : -1);
    const net = minor(Number(row.priceNet ?? row.priceGross ?? row.baseAmount ?? 0));
    await row.update({ refundedAmount: (amount / 100).toFixed(2), refundedCurrency: 'PLN', baseAmount: (Math.max(0, net - amount) / 100).toFixed(2), paymentStatus: amount >= minor(Number(row.priceNet ?? row.priceGross)) ? 'refunded' : amount > 0 ? 'partial' : 'paid' }, { transaction });
    await BookingEvent.create({ bookingId: row.id, eventType: 'note', platform: 'omnilodge', occurredAt: new Date(), eventPayload: { action: 'partner_refund_reconciled', previousRefunded: current[index] / 100, refunded: amount / 100 } } as never, { transaction });
  }
  return { previousAllocated: previous / 100, refunded: refundedMinor / 100, ...(lifetimeRefundedMinor !== refundedMinor ? { lifetimeRefunded: lifetimeRefundedMinor / 100 } : {}) };
}
