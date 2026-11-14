import cron from 'node-cron';
import { Op } from 'sequelize';
import { PartnerBooking, PartnerAmendment } from '../models/Partner.js';
import StorefrontOrder from '../models/StorefrontOrder.js';
import { getStorefrontStripeClient } from '../finance/services/stripeClient.js';
import { fulfillPaidOrder } from '../controllers/storefrontCommerceController.js';
import { deliverPartnerEvents } from '../services/partners/partnerWebhookService.js';
import { reconcilePartnerOrder } from '../services/partners/partnerStripeService.js';
import { releaseStorefrontOrderResourceReservations } from '../services/storefrontOrderResourceReservationService.js';
import { deliverStorefrontOrderEmails } from '../services/storefrontOrderEmailService.js';
import { completePartnerAmendment, notifyPartnerAmendment } from '../services/partners/partnerAmendmentService.js';
import { loadPartnerConfig } from '../services/partners/partnerConfig.js';
import sequelize from '../config/database.js';
import logger from '../utils/logger.js';

let running = false;
let started = false;
let cursor = 0;
let amendmentCursor = 0;
export async function reconcilePartners(): Promise<void> {
  if (running || process.env.DISABLE_BACKGROUND_JOBS === 'true') return;
  running = true;
  try {
    const config = await loadPartnerConfig(false);
    const rows = await PartnerBooking.findAll({ where: { orderId: { [Op.ne]: null }, id: { [Op.gt]: cursor } }, order: [['id', 'ASC']], limit: config.workerBatch });
    for (const row of rows) {
      cursor = row.id;
      try {
        const order = await StorefrontOrder.findByPk(row.orderId!);
        if (!order) continue;
        if (row.paymentMode === 'platform' && order.paymentStatus !== 'paid' && order.stripeCheckoutSessionId) {
          const session = await getStorefrontStripeClient().checkout.sessions.retrieve(order.stripeCheckoutSessionId);
          if (session.payment_status === 'paid') await fulfillPaidOrder(order.publicId, session);
          else if (session.status === 'expired') await sequelize.transaction(async transaction => {
            const locked = (await StorefrontOrder.findByPk(order.id, { transaction, lock: transaction.LOCK.UPDATE }))!;
            if (locked.paymentStatus === 'paid') return;
            await locked.update({ status: 'cancelled' }, { transaction });
            await row.update({ status: 'expired' }, { transaction });
            await releaseStorefrontOrderResourceReservations(locked.id, transaction);
          });
        }
        await reconcilePartnerOrder(order.id);
        if (row.status === 'confirmed') await deliverStorefrontOrderEmails(order.publicId);
      } catch { logger.warn(`[partners] Booking ${row.id} awaits reconciliation.`); }
    }
    if (rows.length < config.workerBatch) cursor = 0;
    const amendments = await PartnerAmendment.findAll({ where: { id: { [Op.gt]: amendmentCursor }, [Op.or]: [{ status: { [Op.in]: ['pending_payment', 'applying'] } }, { status: { [Op.in]: ['completed', 'failed'] }, notificationSentAt: null, notifyCustomer: true }] }, order: [['id', 'ASC']], limit: config.workerBatch });
    for (const amendment of amendments) {
      amendmentCursor = amendment.id;
      try { await completePartnerAmendment(amendment.id); await notifyPartnerAmendment(amendment.id); }
      catch { logger.warn(`[partners] Amendment ${amendment.id} awaits reconciliation.`); }
    }
    if (amendments.length < config.workerBatch) amendmentCursor = 0;
    await deliverPartnerEvents();
  } finally { running = false; }
}
export function startPartnerJob(): void {
  if (started) return;
  started = true;
  cron.schedule('* * * * *', () => { void reconcilePartners().catch(error => logger.error('[partners] Reconciliation worker failed', error)); }, { timezone: 'UTC' });
}
