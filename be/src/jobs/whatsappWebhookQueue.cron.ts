import cron, { type ScheduledTask } from 'node-cron';
import { processQueuedWhatsAppWebhooks } from '../services/whatsappWebhookQueueService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;

const runQueue = (): void => {
  void processQueuedWhatsAppWebhooks().catch(() => {
    logger.error('[whatsapp] queued webhook processing failed');
  });
};

export const kickWhatsAppWebhookQueue = (): void => {
  setImmediate(runQueue);
};

export const startWhatsAppWebhookQueueJob = (): void => {
  if (task) return;
  runQueue();
  task = cron.schedule('* * * * *', runQueue, { timezone: 'UTC' });
};
