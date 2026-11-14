import { earnedRuleCommission } from './partnerCommission.js';
import { reconcileRuleCommission } from './partnerRuleReconciliation.js';
import type Stripe from 'stripe';
import { Op } from 'sequelize';
import sequelize from '../../config/database.js';
import { PartnerBooking, PartnerProfile, PartnerAmendment } from '../../models/Partner.js';
import Booking from '../../models/Booking.js';
import StorefrontOrder from '../../models/StorefrontOrder.js';
import { projectPartnerRefund } from './partnerRefundProjection.js';
import { getStorefrontStripeClient, isStorefrontStripeTestMode } from '../../finance/services/stripeClient.js';
import { loadPartnerConfig } from './partnerConfig.js';
import { commissionAfterRefund, minor, money } from './partnerPolicy.js';
import { partnerEvent } from './partnerEvents.js';
import HttpError from '../../errors/HttpError.js';
import { verifiedPartnerPayments } from './partnerPaymentLedger.js';

const mode = () => isStorefrontStripeTestMode() ? 'test' : 'live';

export async function partnerConnectStatus(partner: PartnerProfile) {
  const config = await loadPartnerConfig(false);
  const accountId = partner.connectAccounts?.[mode()];
  if (!accountId) return { enabled: config.connectEnabled, mode: mode(), connected: false, ready: false };
  const account = await getStorefrontStripeClient().accounts.retrieve(accountId);
  return { enabled: config.connectEnabled, mode: mode(), connected: true, accountId, ready: account.capabilities?.transfers === 'active' && account.payouts_enabled === true, detailsSubmitted: account.details_submitted, requirements: account.requirements?.currently_due || [] };
}

export async function onboardPartnerConnect(partnerId: number, actorId: number | null) {
  const config = await loadPartnerConfig();
  if (!config.connectEnabled) throw new HttpError(409, 'Enable Stripe Connect partner splits in Control Panel after activating Connect on the platform account.');
  const stripe = getStorefrontStripeClient();
  return sequelize.transaction(async transaction => {
    const partner = (await PartnerProfile.findByPk(partnerId, { transaction, lock: transaction.LOCK.UPDATE }))!;
    let accountId = partner.connectAccounts?.[mode()];
    if (!accountId) {
      const account = await stripe.accounts.create({ type: 'express', capabilities: { transfers: { requested: true } }, metadata: { omniPartnerId: String(partner.id) } }, { idempotencyKey: `partner-account-${mode()}-${partner.id}` });
      accountId = account.id;
      await partner.update({ connectAccounts: { ...partner.connectAccounts, [mode()]: account.id } }, { transaction });
      await partnerEvent(partner.id, 'connect.created', { accountId, mode: mode() }, actorId, null, transaction);
    }
    const url = new URL('/partners', config.baseUrl).toString();
    const link = await stripe.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: url, refresh_url: url });
    return { url: link.url, expiresAt: link.expires_at, mode: mode() };
  });
}

/** Provider read + idempotent transfer/reversal. Never derives a successful payment from browser input. */
export async function reconcilePartnerOrder(orderId: number): Promise<void> {
  const config = await loadPartnerConfig(false);
  try {
    await sequelize.transaction(async transaction => {
      const order = await StorefrontOrder.findByPk(orderId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!order || order.orderSource !== 'partner') return;
      const booking = await PartnerBooking.findOne({ where: { orderId }, transaction, lock: transaction.LOCK.UPDATE });
      if (booking?.paymentMode === 'arrival') {
        if (!booking.paymentReceived && booking.status === 'confirmed') {
          const operational = await Booking.findAll({ where: { platformOrderId: order.publicId }, attributes: ['paymentStatus'], transaction, lock: transaction.LOCK.UPDATE });
          if (operational.length && operational.every(value => value.paymentStatus === 'paid')) {
            await order.update({ paymentStatus: 'paid', paidAt: new Date() }, { transaction });
            await booking.update({ paymentReceived: true }, { transaction });
            await partnerEvent(booking.partnerId, 'booking.payment_received', { reference: booking.externalReference, paymentMethod: 'arrival' }, null, booking.id, transaction);
          }
        }
        return;
      }
      if (!booking || booking.paymentMode !== 'platform' || !['paid', 'refunded'].includes(order.paymentStatus)) return;
      if (await PartnerAmendment.count({ where: { bookingId: booking.id, status: { [Op.in]: ['pending_payment', 'applying'] } }, transaction })) return;
      const stripe = getStorefrontStripeClient();
      const payments = await verifiedPartnerPayments(order, booking, transaction);
      let total = 0, commission = 0, refunded = 0, reversedAmount = 0;
      let transferId: string | null = null;
      let disputed = false;
      for (const { charge } of payments) {
        if (!charge.disputed) continue;
        const disputes = await stripe.disputes.list({ charge: charge.id, limit: 100 });
        disputed ||= disputes.data.some(dispute => dispute.status !== 'won' && dispute.status !== 'warning_closed');
      }
      if (booking.commissionCalculation) {
        await reconcileRuleCommission(stripe, booking, order, payments, disputed, transaction, { connectEnabled: config.connectEnabled, mode: mode() });
        return;
      }
      let commissionEarned = 0;
      let restoredCommissionMinor = 0;
      let reconciliationError: string | null = null;
      for (const { payment, charge } of payments) {
        total = money(total + Number(payment.amount));
        commission = money(commission + Number(payment.commission));
        refunded = money(refunded + charge.amount_refunded / 100);
        const earned = disputed || order.status === 'cancelled' ? 0 : commissionAfterRefund(Number(payment.amount), Number(payment.commission), charge.amount_refunded / 100);
        commissionEarned = money(commissionEarned + earned);
        let allocation: Stripe.Transfer | null = null;
        try {
        allocation = payment.transferId ? await stripe.transfers.retrieve(payment.transferId) : null;
        if (!allocation && booking.snapshot.connectSplit && config.connectEnabled && earned > 0) {
          const partner = (await PartnerProfile.findByPk(booking.partnerId, { transaction }))!;
          const accountId = partner.connectAccounts?.[mode()];
          if (!accountId) throw new HttpError(409, 'Partner Stripe onboarding is incomplete.');
          const account = await stripe.accounts.retrieve(accountId);
          if (account.capabilities?.transfers !== 'active' || !account.payouts_enabled) throw new HttpError(409, 'Partner Stripe account cannot receive payouts yet.');
          const group = payment.reference === 'initial' ? `partner_${booking.id}` : `partner_charge_${payment.paymentIntentId}`;
          const previous = await stripe.transfers.list({ transfer_group: group, limit: 10 });
          if (previous.data.length > 1) throw new HttpError(409, 'Multiple Stripe allocations require operations review.');
          allocation = previous.data[0] || null;
          if (allocation && (allocation.amount !== minor(Number(payment.commission)) || allocation.destination !== accountId || allocation.source_transaction !== charge.id)) throw new HttpError(409, 'The existing Stripe allocation does not match this agreement.');
          if (!allocation) allocation = await stripe.transfers.create({ amount: minor(Number(payment.commission)), currency: 'pln', destination: accountId, source_transaction: charge.id, transfer_group: group, metadata: { partnerBookingId: String(booking.id), partnerPaymentId: String(payment.id) } }, { idempotencyKey: `partner-transfer-${mode()}-${booking.id}-${payment.paymentIntentId}` });
          await partnerEvent(booking.partnerId, 'commission.transferred', { transferId: allocation.id, amount: Number(payment.commission), paymentId: payment.id }, null, booking.id, transaction);
        }
        if (allocation) {
          const target = Math.max(0, allocation.amount - minor(earned));
          if (allocation.amount_reversed < target) {
            await stripe.transfers.createReversal(allocation.id, { amount: target - allocation.amount_reversed, metadata: { partnerBookingId: String(booking.id), cumulativeTarget: String(target) } }, { idempotencyKey: `partner-reversal-${payment.paymentIntentId}-${target}` });
            await partnerEvent(booking.partnerId, 'commission.reversed', { amount: (target - allocation.amount_reversed) / 100, paymentId: payment.id }, null, booking.id, transaction);
          }
          const reversed = Math.max(allocation.amount_reversed, target);
          restoredCommissionMinor += Math.max(0, allocation.amount_reversed - target);
          await payment.update({ transferId: allocation.id, reversedAmount: reversed }, { transaction });
          reversedAmount += reversed;
          transferId ||= allocation.id;
        }
        } catch (error) {
          reconciliationError = error instanceof HttpError ? error.message.slice(0, 250) : 'Stripe allocation failed. Customer payment/refund records are updated; retry partner commission reconciliation.';
          reversedAmount += allocation?.amount_reversed ?? Number(payment.reversedAmount || 0);
          transferId ||= allocation?.id || payment.transferId;
        }
      }
      if (!reconciliationError && restoredCommissionMinor > minor(Number(booking.settledAmount))) reconciliationError = 'A dispute/refund adjustment restored commission after a transfer reversal. Operations must record the completed catch-up settlement.';
      const refundProjection = await projectPartnerRefund(order.publicId, Math.max(0, minor(refunded) - minor(Number(booking.amendmentRefundedAmount || 0))), transaction);
      if (refundProjection) await partnerEvent(booking.partnerId, 'refund.reconciled', refundProjection, null, booking.id, transaction);
      const nextStatus = disputed ? 'disputed' : order.status === 'cancelled' ? 'cancelled' : refunded >= total && total > 0 ? 'refunded' : 'confirmed';
      if (booking.status !== nextStatus || Number(booking.refundedAmount) !== refunded) await partnerEvent(booking.partnerId, `booking.${nextStatus}`, { reference: booking.externalReference, refundedAmount: refunded, commission: commissionAfterRefund(total, commission, refunded) }, null, booking.id, transaction);
      const changes = { total, commission, commissionEarned, refundedAmount: refunded, paymentReceived: true, status: nextStatus, transferId, reversedAmount, reconciliationError };
      await booking.update(changes, { transaction });
    });
  } catch (error) {
    await PartnerBooking.update({ reconciliationError: error instanceof HttpError ? error.message.slice(0, 250) : 'Stripe reconciliation failed. Retry from the portal or inspect server monitoring.' }, { where: { orderId } });
    throw error;
  }
}

export function partnerStatement(row: PartnerBooking) {
  const earned = row.commissionCalculation
    ? earnedRuleCommission(row.commissionCalculation, Number(row.total) - Number(row.refundedAmount), ['disputed', 'cancelled'].includes(row.status))
    : row.status === 'disputed' ? 0 : row.paymentMode === 'platform' && row.commissionEarned != null ? Number(row.commissionEarned) : commissionAfterRefund(Number(row.total), Number(row.commission), Number(row.refundedAmount));
  const earnedConfirmed = row.paymentReceived && ['confirmed', 'refunded', 'disputed'].includes(row.status);
  const net = money(Number(row.total) - Number(row.refundedAmount) - (earnedConfirmed ? earned : 0));
  const paidToPartner = row.commissionCalculation ? (row.paymentMode === 'partner' ? 0 : money(Number(row.commissionTransferred || 0) + Number(row.settledAmount)))
    : row.transferId ? money(Number(row.commission) - row.reversedAmount / 100 + Number(row.settledAmount)) : row.paymentMode !== 'partner' ? Number(row.settledAmount) : 0;
  const commissionPayable = ['platform', 'arrival'].includes(row.paymentMode);
  const netPartnerSettlement = money(Number(row.settledAmount) - Number(row.partnerCreditPaid || 0));
  const partnerCredit = row.paymentMode === 'partner' ? money(Math.max(0, netPartnerSettlement - net)) : 0;
  return { id: row.id, reference: row.externalReference, status: row.status, paymentMode: row.paymentMode, currency: 'PLN', customerTotal: Number(row.total), refunded: Number(row.refundedAmount), commission: earnedConfirmed ? earned : 0, transferred: paidToPartner, partnerOwes: row.paymentMode === 'partner' && row.paymentReceived ? money(Math.max(0, net - netPartnerSettlement)) : 0, partnerCredit, commissionOutstanding: commissionPayable && earnedConfirmed ? money(Math.max(0, earned - paidToPartner)) : 0, commissionOverpaid: commissionPayable ? money(Math.max(0, paidToPartner - (earnedConfirmed ? earned : 0))) : 0, manualSettlementAllowed: row.paymentMode === 'partner' ? true : row.transferId ? !!row.reconciliationError?.includes('restored commission') : (!row.snapshot.connectSplit || row.paymentMode === 'arrival'), manualReturnAllowed: row.paymentMode === 'partner' ? partnerCredit > 0 : Number(row.settledAmount) > 0, reconciliationError: row.reconciliationError };
}
