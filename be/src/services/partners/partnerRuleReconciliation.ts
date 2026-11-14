import type Stripe from 'stripe';
import type { Transaction } from 'sequelize';
import { PartnerProfile, type PartnerBooking, type PartnerPayment } from '../../models/Partner.js';
import type StorefrontOrder from '../../models/StorefrontOrder.js';
import HttpError from '../../errors/HttpError.js';
import { earnedRuleCommission } from './partnerCommission.js';
import { reconcileRuleTransfers } from './partnerRuleTransfers.js';
import { partnerEvent } from './partnerEvents.js';
import { projectPartnerRefund } from './partnerRefundProjection.js';
import { minor } from './partnerPolicy.js';

export async function reconcileRuleCommission(stripe: Stripe, booking: PartnerBooking, order: StorefrontOrder,
  payments: Array<{ payment: PartnerPayment; charge: Stripe.Charge }>, disputed: boolean, transaction: Transaction,
  config: { connectEnabled: boolean; mode: string }) {
  const totalMinor = payments.reduce((sum, part) => sum + minor(Number(part.payment.amount)), 0);
  const refundedMinor = payments.reduce((sum, part) => sum + part.charge.amount_refunded, 0);
  const earned = earnedRuleCommission(booking.commissionCalculation!, (totalMinor - refundedMinor) / 100, disputed || order.status === 'cancelled');
  const destination = async () => {
    const partner = (await PartnerProfile.findByPk(booking.partnerId, { transaction }))!;
    const account = partner.connectAccounts?.[config.mode as 'live' | 'test'];
    if (!account) throw new HttpError(409, 'Partner Stripe onboarding is incomplete.');
    const details = await stripe.accounts.retrieve(account);
    if (details.capabilities?.transfers !== 'active' || !details.payouts_enabled) throw new HttpError(409, 'Partner Stripe account cannot receive payouts yet.');
    return account;
  };
  const options = { canCreate: booking.snapshot.connectSplit && config.connectEnabled, mode: config.mode, destination };
  let allocation: Awaited<ReturnType<typeof reconcileRuleTransfers>> | null = null;
  let reconciliationError: string | null = null;
  try {
    allocation = !booking.snapshot.connectSplit && !booking.transferId && !Number(booking.commissionTransferred || 0)
      ? { transferredMinor: 0, reversedMinor: 0, transferId: null, transfers: [] }
      : await reconcileRuleTransfers(stripe, booking.id, payments, minor(earned), options);
    if (booking.snapshot.connectSplit && allocation.transferredMinor < minor(earned)) {
      reconciliationError = 'Automatic commission is outstanding. Enable partner splits and retry reconciliation.';
    }
  } catch (error) {
    reconciliationError = error instanceof HttpError ? error.message.slice(0, 250)
      : 'Stripe commission adjustment failed. Customer payment/refund records are updated; retry commission reconciliation.';
    // Preserve confirmed customer refunds even if a partner has withdrawn funds
    // and a transfer reversal is unavailable. Report observed money, not intent.
    try { allocation = await reconcileRuleTransfers(stripe, booking.id, payments, 0, { ...options, canCreate: false, readOnly: true }); }
    catch { /* Last verified transfer balance remains visible with the error. */ }
  }
  const projection = await projectPartnerRefund(order.publicId,
    Math.max(0, refundedMinor - minor(Number(booking.amendmentRefundedAmount || 0))), transaction);
  if (projection) await partnerEvent(booking.partnerId, 'refund.reconciled', projection, null, booking.id, transaction);
  const status = disputed ? 'disputed' : order.status === 'cancelled' ? 'cancelled'
    : refundedMinor >= totalMinor && totalMinor > 0 ? 'refunded' : 'confirmed';
  if (Number(booking.commissionEarned) !== earned || (allocation && minor(Number(booking.commissionTransferred || 0)) !== allocation.transferredMinor)) {
    await partnerEvent(booking.partnerId, 'commission.reconciled', { commission: earned,
      calculation: booking.commissionCalculation, ...(allocation ? { transfers: allocation.transfers, transferred: allocation.transferredMinor / 100 } : {}),
      reconciliationError }, null, booking.id, transaction);
  }
  if (booking.status !== status || minor(Number(booking.refundedAmount)) !== refundedMinor) {
    await partnerEvent(booking.partnerId, `booking.${status}`, { reference: booking.externalReference, refundedAmount: refundedMinor / 100, commission: earned }, null, booking.id, transaction);
  }
  await booking.update({ total: totalMinor / 100, commission: booking.commissionCalculation!.commission,
    commissionEarned: earned, refundedAmount: refundedMinor / 100, paymentReceived: true, status, reconciliationError,
    ...(allocation ? { commissionTransferred: allocation.transferredMinor / 100, reversedAmount: allocation.reversedMinor, transferId: allocation.transferId } : {}) }, { transaction });
}
