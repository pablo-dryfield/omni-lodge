import cron, { type ScheduledTask } from 'node-cron';
import { Op } from 'sequelize';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import { sendAndRecordStorefrontCartRecoveryEmail } from '../services/storefrontCartRecoveryEmailService.js';
import { getConfigValue, refreshConfigCacheKeys } from '../services/configService.js';
import { reconcileOngoingCart } from '../services/storefrontOngoingCartService.js';
import { purgeExpiredStorefrontJourneyDetails } from '../services/storefrontJourneyService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;
let lastJourneyCleanupAt = 0;
let reconciliationCursor = 0;
let running = false;

export const reconcileOngoingCartBatch = async (): Promise<void> => {
  await refreshConfigCacheKeys(['STOREFRONT_CART_RECONCILIATION_BATCH_SIZE']);
  const configured = Number(getConfigValue('STOREFRONT_CART_RECONCILIATION_BATCH_SIZE')) || 100;
  const limit = Math.max(1, Math.min(500, Math.floor(configured)));
  const rows = await StorefrontOngoingCart.findAll({
    where: { status: { [Op.in]: ['active', 'checkout_started', 'recovery_sent'] }, id: { [Op.gt]: reconciliationCursor } },
    order: [['id', 'ASC']], limit,
  });
  for (const row of rows) {
    try {
      await reconcileOngoingCart(row);
    } catch (error) {
      // One malformed legacy cart must not block all later carts. The next
      // cursor cycle retries it; each email still has its own paid-booking check.
      logger.error(`[storefront-abandoned-cart] Reconciliation failed for cart ${row.publicId}`, error);
    }
    reconciliationCursor = Number(row.id);
  }
  if (rows.length < limit) reconciliationCursor = 0;
};

const runJourneyRetentionIfDue = async (): Promise<void> => {
  const now = Date.now();
  if (now - lastJourneyCleanupAt < 24 * 60 * 60 * 1000) return;
  lastJourneyCleanupAt = now;
  const configured = Number(getConfigValue('STOREFRONT_JOURNEY_RETENTION_DAYS'));
  const removed = await purgeExpiredStorefrontJourneyDetails(configured || 90);
  if (removed) logger.info(`[storefront-journey] Removed ${removed} expired detailed events.`);
};

export const runStorefrontAbandonedCartRecovery = async (): Promise<number> => {
  await runJourneyRetentionIfDue();
  await reconcileOngoingCartBatch();
  if (getConfigValue('STOREFRONT_ABANDONED_CART_EMAIL_ENABLED') !== true) return 0;

  const rows = await StorefrontOngoingCart.findAll({
    where: {
      status: { [Op.in]: ['active', 'checkout_started'] },
      recoveryDueAt: { [Op.lte]: new Date() },
      recoverySentAt: null,
    },
    order: [['recoveryDueAt', 'ASC']],
    limit: 50,
  });
  let sent = 0;

  for (const ongoing of rows) {
    const [claimed] = await StorefrontOngoingCart.update(
      { status: 'sending_recovery' },
      {
        where: {
          id: ongoing.id,
          status: { [Op.in]: ['active', 'checkout_started'] },
          recoveryDueAt: { [Op.lte]: new Date() },
          recoverySentAt: null,
        },
      },
    );
    if (!claimed) continue;

    try {
      await sendAndRecordStorefrontCartRecoveryEmail(ongoing);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await StorefrontOngoingCart.update(
        {
          status: 'active',
          recoveryError: message.slice(0, 2000),
          recoveryDueAt: new Date(Date.now() + 15 * 60_000),
        },
        { where: { id: ongoing.id, status: 'sending_recovery' } },
      );
      logger.error(`[storefront-abandoned-cart] Recovery email failed for cart ${ongoing.publicId}: ${message}`);
    }
  }

  return sent;
};

export const startStorefrontAbandonedCartJob = (): void => {
  if (task) return;
  task = cron.schedule('*/5 * * * *', () => {
    if (running) return;
    running = true;
    void runStorefrontAbandonedCartRecovery().catch((error) => {
      logger.error('[storefront-abandoned-cart] Recovery job failed', error);
    }).finally(() => { running = false; });
  }, { timezone: 'Europe/Warsaw' });
};
