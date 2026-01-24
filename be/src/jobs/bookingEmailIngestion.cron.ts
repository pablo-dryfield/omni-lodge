import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { ingestLatestBookingEmails } from '../services/bookings/bookingIngestionService.js';
import { getConfigValue } from '../services/configService.js';

let scheduledTask: ScheduledTask | null = null;

export const startBookingEmailIngestionJob = (): void => {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  const cronExpression = (getConfigValue('BOOKING_EMAIL_POLL_CRON') as string) ?? '*/5 * * * *';
  const cronTimezone = (getConfigValue('BOOKING_EMAIL_POLL_TZ') as string) ?? 'UTC';

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      logger.debug('[booking-email] Cron tick triggered ingestion');
      await ingestLatestBookingEmails();
    },
    { timezone: cronTimezone },
  );

  logger.info(`[booking-email] Gmail ingestion cron scheduled (${cronExpression} ${cronTimezone})`);
};
