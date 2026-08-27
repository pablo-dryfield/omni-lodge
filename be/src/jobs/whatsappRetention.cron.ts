import cron, { type ScheduledTask } from 'node-cron';
import { deleteExpiredWhatsAppMessages } from '../services/whatsappMessageService.js';
import { deleteExpiredWhatsAppWebhookJobs } from '../services/whatsappWebhookQueueService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;
let running = false;

export const runWhatsAppRetentionPurge = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  try {
    const [deletedMessages, deletedJobs] = await Promise.all([
      deleteExpiredWhatsAppMessages(),
      deleteExpiredWhatsAppWebhookJobs(),
    ]);
    const deleted = deletedMessages + deletedJobs;
    if (deleted > 0) {
      logger.info(`[whatsapp] retention purge removed rows=${deleted}`);
    }
    return deleted;
  } finally {
    running = false;
  }
};

export const startWhatsAppRetentionJob = (): void => {
  if (task) return;

  // Run once at startup, then hourly so retention does not depend on new messages.
  void runWhatsAppRetentionPurge().catch(() => {
    logger.error('[whatsapp] retention purge failed');
  });

  task = cron.schedule('17 * * * *', () => {
    void runWhatsAppRetentionPurge().catch(() => {
      logger.error('[whatsapp] retention purge failed');
    });
  }, { timezone: 'UTC' });
};
