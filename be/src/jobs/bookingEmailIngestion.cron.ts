import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { ingestLatestBookingEmails } from '../services/bookings/bookingIngestionService.js';
import { ingestCustomerEmailActions } from '../services/bookings/customerEmailActionService.js';
import { getConfigValue } from '../services/configService.js';

let scheduledTask: ScheduledTask | null = null;
let customerEmailScheduledTask: ScheduledTask | null = null;
let bookingIngestionRunning = false;
let customerEmailIngestionRunning = false;

export const startBookingEmailIngestionJob = (): void => {
  if (scheduledTask) {
    scheduledTask.stop();
  }
  if (customerEmailScheduledTask) {
    customerEmailScheduledTask.stop();
  }

  const cronExpression = (getConfigValue('BOOKING_EMAIL_POLL_CRON') as string) ?? '*/5 * * * *';
  const cronTimezone = (getConfigValue('BOOKING_EMAIL_POLL_TZ') as string) ?? 'UTC';

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      if (bookingIngestionRunning) {
        logger.warn('[booking-email] Skipping overlapping Gmail ingestion tick');
        return;
      }
      bookingIngestionRunning = true;
      logger.debug('[booking-email] Cron tick triggered ingestion');
      try {
        await ingestLatestBookingEmails();
      } finally {
        bookingIngestionRunning = false;
      }
    },
    { timezone: cronTimezone },
  );

  logger.info(`[booking-email] Gmail ingestion cron scheduled (${cronExpression} ${cronTimezone})`);

  const customerEmailCronExpression =
    (getConfigValue('CUSTOMER_EMAIL_ACTION_POLL_CRON') as string) ?? '* * * * *';
  customerEmailScheduledTask = cron.schedule(
    customerEmailCronExpression,
    async () => {
      if (customerEmailIngestionRunning) {
        logger.warn('[customer-email-action] Skipping overlapping Gmail polling tick');
        return;
      }
      customerEmailIngestionRunning = true;
      try {
        await ingestCustomerEmailActions();
      } finally {
        customerEmailIngestionRunning = false;
      }
    },
    { timezone: cronTimezone },
  );
  logger.info(
    `[customer-email-action] Gmail polling cron scheduled (${customerEmailCronExpression} ${cronTimezone})`,
  );
};
