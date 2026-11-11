import { Op, literal, type WhereOptions } from 'sequelize';
import type Stripe from 'stripe';
import sequelize from '../../config/database.js';
import Booking from '../../models/Booking.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import AuditLog from '../../models/AuditLog.js';
import HttpError from '../../errors/HttpError.js';
import { extractDirectStripeMode, extractDirectStripeTransactionId } from './bookingStripeReference.js';
import { normalizeDirectStripeMerchant } from '../../finance/services/stripeClient.js';
import { getBookingStripeFeeSnapshot, paymentReadError, type BookingStripeFeeSnapshot } from './bookingPaymentService.js';
import { allocateBookingStripeFee, normalizeStripeFeeForBooking } from './stripeProcessingFee.js';
export { allocateBookingStripeFee } from './stripeProcessingFee.js';

const missingFeeWhere = (): WhereOptions => ({
  platform: { [Op.in]: ['omnilodge', 'direct', 'ecwid'] },
  paymentStatus: { [Op.in]: ['paid', 'partial', 'deposit', 'refunded'] },
  [Op.or]: [{ processingFee: null }, { processingFeeCurrency: null }, { processingFeeCurrency: '' }],
  [Op.and]: [literal("lower(trim(coalesce(payment_method, ''))) NOT IN ('cash', 'bank_transfer', 'bank transfer', 'bank-transfer', 'banktransfer', 'paypal', 'free', 'free order', 'free_order')")],
});

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

const relatedWhere = (booking: Booking, snapshot: BookingStripeFeeSnapshot): WhereOptions => {
  if (booking.platform === 'omnilodge') {
    if (!booking.platformOrderId) throw new HttpError(409, 'The storefront order reference is missing.');
    return { platform: 'omnilodge', platformOrderId: booking.platformOrderId };
  }
  if (booking.platform === 'ecwid') {
    const orderId = String(booking.platformOrderId || booking.platformBookingId).trim().replace(/-\d+$/, '');
    if (!orderId) throw new HttpError(409, 'The Ecwid order reference is missing.');
    return { platform: 'ecwid', [Op.or]: [
      { platformOrderId: orderId }, { platformOrderId: { [Op.like]: `${escapeLike(orderId)}-%` } },
      { platformBookingId: orderId }, { platformBookingId: { [Op.like]: `${escapeLike(orderId)}-%` } },
    ] };
  }
  const references = [snapshot.paymentIntentId, snapshot.chargeId].filter((value): value is string => Boolean(value));
  return { platform: 'direct', stripeMerchant: snapshot.merchant, [Op.or]: references.flatMap(reference => [
    { platformOrderId: reference }, { platformBookingId: reference },
    { notes: { [Op.like]: `%${escapeLike(reference)}%` } }, { rawPayloadLocation: { [Op.like]: `%${escapeLike(reference)}%` } },
  ]) };
};

const directPeer = (booking: Booking, snapshot: BookingStripeFeeSnapshot): boolean => {
  if (booking.platform !== 'direct') return true;
  const reference = extractDirectStripeTransactionId(booking);
  return normalizeDirectStripeMerchant(booking.stripeMerchant) === snapshot.merchant
    && (!extractDirectStripeMode(booking) || extractDirectStripeMode(booking) === snapshot.mode)
    && reference != null && [snapshot.chargeId, snapshot.paymentIntentId].includes(reference);
};

export const synchronizeBookingStripeFee = async (
  booking: Booking,
  { dryRun = true, options }: { dryRun?: boolean; options: Stripe.RequestOptions },
): Promise<{ bookingIds: number[]; updated: number; wouldUpdate: number; ready: boolean }> => {
  const snapshot = await getBookingStripeFeeSnapshot(booking, options);
  if (!snapshot) return { bookingIds: [Number(booking.id)], updated: 0, wouldUpdate: 0, ready: false };
  const where = relatedWhere(booking, snapshot);
  return sequelize.transaction(async transaction => {
    // Fulfillment takes the order lock before booking locks; use the same order.
    if (booking.platform === 'omnilodge') {
      const order = await StorefrontOrder.findOne({ where: { publicId: booking.platformOrderId },
        attributes: ['id', 'stripePaymentIntentId', 'metadata'], transaction, lock: transaction.LOCK.UPDATE });
      const mode = order?.metadata?.stripeMode;
      if (!order || order.stripePaymentIntentId !== snapshot.paymentIntentId
        || ((mode === 'live' || mode === 'test') && mode !== snapshot.mode)) {
        throw new HttpError(409, 'The storefront payment reference changed.');
      }
    }
    const peers = (await Booking.findAll({ where, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE }))
      .filter(peer => directPeer(peer, snapshot));
    if (!peers.some(peer => Number(peer.id) === Number(booking.id))) throw new HttpError(409, 'The payment booking group changed.');
    const currencies = new Set(peers.map(peer => String(peer.currency ?? '').trim().toUpperCase()));
    if (currencies.size !== 1) throw new HttpError(409, 'The payment booking lines use inconsistent currencies.');
    if (booking.platform === 'omnilodge' && peers.some(peer => normalizeDirectStripeMerchant(peer.stripeMerchant) !== snapshot.merchant)) {
      throw new HttpError(409, 'The storefront booking lines use inconsistent Stripe merchants.');
    }
    const reporting = normalizeStripeFeeForBooking(snapshot, peers[0].currency);
    const allocations = allocateBookingStripeFee(reporting.feeMinor, reporting.currency, peers.map(peer => Number(peer.id)));
    let changed = 0;
    for (const peer of peers) {
      const fee = allocations.get(Number(peer.id))!;
      if (peer.processingFee != null && Number(peer.processingFee) === Number(fee) && peer.processingFeeCurrency === reporting.currency) continue;
      changed += 1;
      if (dryRun) continue;
      const previous = { amount: peer.processingFee, currency: peer.processingFeeCurrency };
      await peer.update({ processingFee: fee, processingFeeCurrency: reporting.currency }, { transaction });
      await AuditLog.create({ actorId: null, action: 'booking.stripe_fee_synced', entity: 'booking', entityId: String(peer.id),
        metaJson: { source: 'stripe_balance_transaction', previous, amount: fee, currency: reporting.currency,
          feeMinor: snapshot.feeMinor, settlementCurrency: snapshot.currency, chargeCurrency: snapshot.chargeCurrency,
          reportingFeeMinor: reporting.feeMinor, exchangeRateUsed: reporting.exchangeRateUsed,
          allocationBookingIds: peers.map(row => Number(row.id)),
          balanceTransactionId: snapshot.balanceTransactionId, chargeId: snapshot.chargeId,
          paymentIntentId: snapshot.paymentIntentId, merchant: snapshot.merchant, mode: snapshot.mode } }, { transaction });
    }
    return { bookingIds: peers.map(peer => Number(peer.id)), updated: dryRun ? 0 : changed, wouldUpdate: changed, ready: true };
  });
};

export type BookingStripeFeeBatchResult = {
  dryRun: boolean; afterId: number; nextCursor: number; cycleCompleted: boolean;
  scanned: number; updated: number; wouldUpdate: number; remainingMissing: number;
  unresolved: Array<{ bookingId: number; reason: string }>;
};

export async function runBookingStripeFeeBatch({
  afterId = 0, batchSize = 100, dryRun = true, timeoutMs = 12000,
}: { afterId?: number; batchSize?: number; dryRun?: boolean; timeoutMs?: number } = {}): Promise<BookingStripeFeeBatchResult> {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(batchSize) || 100)));
  if (!Number.isSafeInteger(afterId) || afterId < 0) throw new HttpError(400, 'Invalid fee reconciliation cursor.');
  const rows = await Booking.findAll({ where: { [Op.and]: [missingFeeWhere(), { id: { [Op.gt]: afterId } }] }, order: [['id', 'ASC']], limit });
  const result: BookingStripeFeeBatchResult = { dryRun, afterId, nextCursor: afterId, cycleCompleted: false,
    scanned: 0, updated: 0, wouldUpdate: 0, remainingMissing: 0, unresolved: [] };
  const seen = new Set<number>(), started = Date.now();
  for (const booking of rows) {
    // Keep a slow provider from monopolizing a one-minute scheduler tick.
    if (result.scanned && Date.now() - started > 45000) break;
    result.scanned += 1;
    result.nextCursor = Number(booking.id);
    if (seen.has(Number(booking.id))) continue;
    try {
      const synced = await synchronizeBookingStripeFee(booking, { dryRun,
        options: { timeout: Math.max(1000, Math.min(30000, timeoutMs)), maxNetworkRetries: 0 } });
      synced.bookingIds.forEach(bookingId => seen.add(bookingId));
      result.updated += synced.updated;
      result.wouldUpdate += synced.wouldUpdate;
      if (!synced.ready) result.unresolved.push({ bookingId: Number(booking.id), reason: 'Stripe settlement not available yet; retained for retry.' });
    } catch (error) {
      result.unresolved.push({ bookingId: Number(booking.id), reason: error instanceof HttpError ? error.message : paymentReadError(error) });
    }
  }
  result.cycleCompleted = result.scanned === rows.length && rows.length < limit;
  if (result.cycleCompleted) result.nextCursor = 0;
  result.remainingMissing = await Booking.count({ where: missingFeeWhere() });
  if (!dryRun && (rows.length || afterId)) {
    await AuditLog.create({ actorId: null, action: 'booking.stripe_fee_sync_batch', entity: 'booking_fee_backfill', entityId: 'all-history', metaJson: result });
  }
  return result;
}
