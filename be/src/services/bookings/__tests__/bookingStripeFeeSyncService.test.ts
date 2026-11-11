jest.mock('../../../config/database.js', () => ({ __esModule: true, default: { transaction: jest.fn() } }));
jest.mock('../../../models/Booking.js', () => ({ __esModule: true, default: { findAll: jest.fn(), count: jest.fn() } }));
jest.mock('../../../models/StorefrontOrder.js', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('../../../models/AuditLog.js', () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock('../../../finance/services/stripeClient.js', () => ({ normalizeDirectStripeMerchant: (v: unknown) => v ?? null }));
jest.mock('../bookingPaymentService.js', () => ({ getBookingStripeFeeSnapshot: jest.fn(), paymentReadError: () => 'Stripe lookup unavailable.' }));

import { Op } from 'sequelize';
import sequelize from '../../../config/database';
import Booking from '../../../models/Booking';
import StorefrontOrder from '../../../models/StorefrontOrder';
import AuditLog from '../../../models/AuditLog';
import { getBookingStripeFeeSnapshot } from '../bookingPaymentService';
import { allocateBookingStripeFee, runBookingStripeFeeBatch, synchronizeBookingStripeFee } from '../bookingStripeFeeSyncService';

const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const snapshot = { feeMinor: 401, currency: 'PLN', chargeCurrency: 'PLN', exchangeRate: null,
  balanceTransactionId: 'txn_One', chargeId: 'ch_One', paymentIntentId: 'pi_One', mode: 'live', merchant: null };
const row = (extra = {}) => {
  const booking = { id: 1, platform: 'omnilodge', platformOrderId: 'order-1', currency: 'PLN', processingFee: null as string | null,
    processingFeeCurrency: null as string | null, notes: 'Stripe payment: pi_One; Stripe mode: live', stripeMerchant: null,
    update: jest.fn(), ...extra };
  booking.update.mockImplementation(async values => Object.assign(booking, values));
  return booking;
};
const find = Booking.findAll as jest.Mock;
const fee = getBookingStripeFeeSnapshot as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (sequelize.transaction as jest.Mock).mockImplementation(callback => callback(transaction));
  (Booking.count as jest.Mock).mockResolvedValue(0);
  (StorefrontOrder.findOne as jest.Mock).mockResolvedValue({ id: 1, stripePaymentIntentId: 'pi_One', metadata: { stripeMode: 'live' } });
  fee.mockResolvedValue(snapshot);
});

it('conserves native minor units, including zero and deterministic remainder allocation', () => {
  expect([...allocateBookingStripeFee(401, 'PLN', [3, 1, 2])]).toEqual([[1, '1.34'], [2, '1.34'], [3, '1.33']]);
  expect([...allocateBookingStripeFee(0, 'PLN', [1])]).toEqual([[1, '0.00']]);
  expect([...allocateBookingStripeFee(5, 'JPY', [1, 2])]).toEqual([[1, '3.00'], [2, '2.00']]);
  expect(() => allocateBookingStripeFee(-1, 'PLN', [1])).toThrow();
  expect(() => allocateBookingStripeFee(1, 'PLN', [])).toThrow();
});

it('defaults to a read-only dry run and never writes fee or audit state', async () => {
  const booking = row(); find.mockResolvedValue([booking]);
  expect(await synchronizeBookingStripeFee(booking as never, { options: {} })).toMatchObject({ updated: 0, wouldUpdate: 1, ready: true });
  expect(booking.update).not.toHaveBeenCalled(); expect(AuditLog.create).not.toHaveBeenCalled();
});

it('locks order then bookings, allocates one fee across all order lines and audits exact source', async () => {
  const a = row(), b = row({ id: 2 }); find.mockResolvedValue([a, b]);
  expect(await synchronizeBookingStripeFee(a as never, { dryRun: false, options: {} })).toMatchObject({ updated: 2, bookingIds: [1, 2] });
  expect(a.processingFee).toBe('2.01'); expect(b.processingFee).toBe('2.00');
  expect(a.processingFeeCurrency).toBe('PLN');
  expect((StorefrontOrder.findOne as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(find.mock.invocationCallOrder[0]);
  expect(find.mock.calls[0][0]).toMatchObject({ lock: 'UPDATE', transaction });
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'booking.stripe_fee_synced', metaJson: expect.objectContaining({ feeMinor: 401, balanceTransactionId: 'txn_One', allocationBookingIds: [1, 2] }) }), { transaction });
  expect(await synchronizeBookingStripeFee(a as never, { dryRun: false, options: {} })).toMatchObject({ updated: 0 });
  expect(AuditLog.create).toHaveBeenCalledTimes(2);
});

it('retains an existing value when Stripe settlement is still asynchronous', async () => {
  const booking = row({ processingFee: '4.00' }); fee.mockResolvedValue(null);
  expect(await synchronizeBookingStripeFee(booking as never, { dryRun: false, options: {} })).toMatchObject({ ready: false, updated: 0 });
  expect(booking.processingFee).toBe('4.00'); expect(sequelize.transaction).not.toHaveBeenCalled();
});

it('normalizes a foreign settlement once into the booking currency and retains original Stripe evidence', async () => {
  const a = row({ currency: 'EUR' }), b = row({ id: 2, currency: 'EUR' }); find.mockResolvedValue([a, b]);
  fee.mockResolvedValue({ ...snapshot, feeMinor: 1000, currency: 'PLN', chargeCurrency: 'EUR', exchangeRate: 4.3 });
  await synchronizeBookingStripeFee(a as never, { dryRun: false, options: {} });
  expect(a).toMatchObject({ processingFee: '1.17', processingFeeCurrency: 'EUR' });
  expect(b).toMatchObject({ processingFee: '1.16', processingFeeCurrency: 'EUR' });
  expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ metaJson: expect.objectContaining({
    feeMinor: 1000, settlementCurrency: 'PLN', reportingFeeMinor: 233, exchangeRateUsed: 4.3,
  }) }), { transaction });
});

it('never guesses an exchange rate or mixes currencies within a payment group', async () => {
  const a = row({ currency: 'EUR' }); find.mockResolvedValue([a]);
  await expect(synchronizeBookingStripeFee(a as never, { dryRun: false, options: {} })).rejects.toThrow('exchange rate');
  expect(a.update).not.toHaveBeenCalled();
  find.mockResolvedValue([a, row({ id: 2 })]);
  await expect(synchronizeBookingStripeFee(a as never, { dryRun: false, options: {} })).rejects.toThrow('inconsistent currencies');
});

it('does not mix direct payment references, merchants, or explicit test/live modes', async () => {
  const a = row({ platform: 'direct' });
  const b = row({ id: 2, platform: 'direct', notes: 'pi_One; Stripe mode: live' });
  const foreign = row({ id: 3, platform: 'direct', notes: 'pi_One; Stripe mode: test' });
  const otherMerchant = row({ id: 4, platform: 'direct', stripeMerchant: 'food-tour' });
  const substring = row({ id: 5, platform: 'direct', notes: 'pi_OneOther' });
  find.mockResolvedValue([a, b, foreign, otherMerchant, substring]);
  const result = await synchronizeBookingStripeFee(a as never, { dryRun: false, options: {} });
  expect(result.bookingIds).toEqual([1, 2]);
  for (const wrong of [foreign, otherMerchant, substring]) expect(wrong.update).not.toHaveBeenCalled();
  expect(StorefrontOrder.findOne).not.toHaveBeenCalled();
});

it('bounds Ecwid peers to the same platform/order aliases', async () => {
  const booking = row({ platform: 'ecwid', platformOrderId: 'ABC-7' }); find.mockResolvedValue([booking]);
  await synchronizeBookingStripeFee(booking as never, { dryRun: false, options: {} });
  expect(find.mock.calls[0][0].where.platform).toBe('ecwid');
  expect(find.mock.calls[0][0].where[Op.or]).toContainEqual({ platformOrderId: 'ABC' });
});

it('fails closed when the booking no longer belongs to the resolved group', async () => {
  find.mockResolvedValue([row({ id: 2 })]);
  await expect(synchronizeBookingStripeFee(row() as never, { dryRun: false, options: {} })).rejects.toThrow('group changed');
  expect(AuditLog.create).not.toHaveBeenCalled();
});

it('does not save a stale lookup after the persisted storefront payment changes', async () => {
  (StorefrontOrder.findOne as jest.Mock).mockResolvedValue({ id: 1, stripePaymentIntentId: 'pi_Other' });
  await expect(synchronizeBookingStripeFee(row() as never, { dryRun: false, options: {} })).rejects.toThrow('reference changed');
  expect(find).not.toHaveBeenCalled();
  expect(AuditLog.create).not.toHaveBeenCalled();
});

it('scans the full historical range with no date cutoff, deduplicates order lines and reports coverage', async () => {
  const a = row(), b = row({ id: 2 });
  find.mockResolvedValueOnce([a, b]).mockResolvedValueOnce([a, b]);
  const result = await runBookingStripeFeeBatch({ dryRun: false, batchSize: 100 });
  expect(result).toMatchObject({ scanned: 2, updated: 2, remainingMissing: 0, cycleCompleted: true, nextCursor: 0 });
  expect(fee).toHaveBeenCalledTimes(1);
  const candidate = find.mock.calls[0][0].where[Op.and][0];
  expect(candidate.platform[Op.in]).toEqual(['omnilodge', 'direct', 'ecwid']);
  expect(candidate.paymentStatus[Op.in]).toContain('refunded');
  expect(candidate.experienceDate).toBeUndefined();
  expect(candidate[Op.and][0].val).toContain("'free order'");
  expect(candidate[Op.and][0].val).toContain("'bank-transfer'");
  expect(candidate[Op.and][0].val).toContain('trim(');
  expect(AuditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'booking.stripe_fee_sync_batch', metaJson: expect.objectContaining({ remainingMissing: 0 }) }));
});

it('advances beyond failed rows, retains real missing fees for retry and exposes no provider secrets', async () => {
  find.mockResolvedValue([row()]); fee.mockRejectedValue(new Error('PRIVATE-STRIPE-KEY'));
  (Booking.count as jest.Mock).mockResolvedValue(1);
  const result = await runBookingStripeFeeBatch({ dryRun: false, batchSize: 1 });
  expect(result).toMatchObject({ updated: 0, nextCursor: 1, remainingMissing: 1, cycleCompleted: false });
  expect(result.unresolved).toEqual([{ bookingId: 1, reason: 'Stripe lookup unavailable.' }]);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});

it('does not create progress records on a no-work idle heartbeat or a dry run', async () => {
  find.mockResolvedValue([]);
  await runBookingStripeFeeBatch({ dryRun: false });
  await runBookingStripeFeeBatch();
  expect(AuditLog.create).not.toHaveBeenCalled();
});
