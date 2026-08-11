import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { ingestLatestBookingEmails } from '../services/bookings/bookingIngestionService.js';
import { getConfigValue } from '../services/configService.js';
import { getGmailApiCooldownUntil } from '../services/bookings/gmailClient.js';

let scheduledTask: ScheduledTask | null = null;
let bookingEmailPolling = false;

const shouldSkipGmailPolling = (): boolean => {
  const cooldownUntil = getGmailApiCooldownUntil();
  if (cooldownUntil) {
    logger.debug(`[booking-email] Skipping Gmail polling during cooldown until ${cooldownUntil.toISOString()}`);
    return true;
  }
  if (bookingEmailPolling) {
    logger.debug('[booking-email] Skipping overlapping Gmail ingestion run');
    return true;
  }
  bookingEmailPolling = true;
  return false;
};

export const startBookingEmailIngestionJob = (): void => {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  const cronExpression = (getConfigValue('BOOKING_EMAIL_POLL_CRON') as string) ?? '*/5 * * * *';
  const cronTimezone = (getConfigValue('BOOKING_EMAIL_POLL_TZ') as string) ?? 'UTC';

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      if (shouldSkipGmailPolling()) return;
      logger.debug('[booking-email] Cron tick triggered ingestion');
      try {
        await ingestLatestBookingEmails();
      } finally {
        bookingEmailPolling = false;
      }
    },
    { timezone: cronTimezone },
  );

  logger.info(`[booking-email] Gmail ingestion cron scheduled (${cronExpression} ${cronTimezone})`);
  logger.info('[customer-email-action] Automatic Gmail polling is disabled');
};
