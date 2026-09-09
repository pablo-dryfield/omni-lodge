import cron, { type ScheduledTask } from 'node-cron';

import { expireOverdueBankTransferOrders } from '../services/storefrontBankTransferOrderService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;
let running = false;

export const runStorefrontBankTransferExpiry = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  try {
    let expired = 0;
    // Drain bounded batches without allowing one process tick to loop forever.
    for (let batch = 0; batch < 10; batch += 1) {
      const result = await expireOverdueBankTransferOrders({ limit: 100 });
      expired += result.expired;
      if (result.examined < 100 || result.expired === 0) break;
    }
    if (expired > 0) {
      logger.info(`[storefront-bank-transfer] Expired ${expired} unpaid reservation${expired === 1 ? '' : 's'}.`);
    }
    return expired;
  } finally {
    running = false;
  }
};

export const startStorefrontBankTransferExpiryJob = (): void => {
  if (task) return;
  void runStorefrontBankTransferExpiry().catch((error) => {
    logger.error('[storefront-bank-transfer] Startup expiry sweep failed', error);
  });
  task = cron.schedule('*/5 * * * *', () => {
    void runStorefrontBankTransferExpiry().catch((error) => {
      logger.error('[storefront-bank-transfer] Expiry sweep failed', error);
    });
  }, { timezone: 'Europe/Warsaw' });
};
