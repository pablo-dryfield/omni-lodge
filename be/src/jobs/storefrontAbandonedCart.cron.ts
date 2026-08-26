import cron, { type ScheduledTask } from 'node-cron';
import { Op } from 'sequelize';
import StorefrontOngoingCart from '../models/StorefrontOngoingCart.js';
import { sendAndRecordStorefrontCartRecoveryEmail } from '../services/storefrontCartRecoveryEmailService.js';
import { getConfigValue } from '../services/configService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;

export const runStorefrontAbandonedCartRecovery = async (): Promise<number> => {
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
    void runStorefrontAbandonedCartRecovery().catch((error) => {
      logger.error('[storefront-abandoned-cart] Recovery job failed', error);
    });
  }, { timezone: 'Europe/Warsaw' });
};
