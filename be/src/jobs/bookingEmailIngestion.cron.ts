import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { ingestLatestBookingEmails } from '../services/bookings/bookingIngestionService.js';
import { ingestCustomerEmailActions } from '../services/bookings/customerEmailActionService.js';
import { getConfigValue } from '../services/configService.js';
import { getGmailApiCooldownUntil } from '../services/bookings/gmailClient.js';

let scheduledTask: ScheduledTask | null = null;
let customerEmailScheduledTask: ScheduledTask | null = null;
let gmailPollingOwner: 'booking-email' | 'customer-email-action' | null = null;

const shouldSkipGmailPolling = (owner: 'booking-email' | 'customer-email-action'): boolean => {
  const cooldownUntil = getGmailApiCooldownUntil();
  if (cooldownUntil) {
    logger.debug(`[${owner}] Skipping Gmail polling during cooldown until ${cooldownUntil.toISOString()}`);
    return true;
  }
  if (gmailPollingOwner) {
    logger.debug(`[${owner}] Skipping Gmail polling while ${gmailPollingOwner} is running`);
    return true;
  }
  gmailPollingOwner = owner;
  return false;
};

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
      if (shouldSkipGmailPolling('booking-email')) return;
      logger.debug('[booking-email] Cron tick triggered ingestion');
      try {
        await ingestLatestBookingEmails();
      } finally {
        gmailPollingOwner = null;
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
      if (shouldSkipGmailPolling('customer-email-action')) return;
      try {
        await ingestCustomerEmailActions();
      } finally {
        gmailPollingOwner = null;
      }
    },
    { timezone: cronTimezone },
  );
  logger.info(
    `[customer-email-action] Gmail polling cron scheduled (${customerEmailCronExpression} ${cronTimezone})`,
  );
};
