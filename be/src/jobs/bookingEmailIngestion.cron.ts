import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { ingestLatestBookingEmails } from '../services/bookings/bookingIngestionService.js';

const CRON_EXPRESSION = process.env.BOOKING_EMAIL_POLL_CRON ?? '*/5 * * * *';
const CRON_TZ = process.env.BOOKING_EMAIL_POLL_TZ ?? 'UTC';

let scheduledTask: ScheduledTask | null = null;

export const startBookingEmailIngestionJob = (): void => {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(
    CRON_EXPRESSION,
    async () => {
      logger.debug('[booking-email] Cron tick triggered ingestion');
      await ingestLatestBookingEmails();
    },
    { timezone: CRON_TZ },
  );

  logger.info(`[booking-email] Gmail ingestion cron scheduled (${CRON_EXPRESSION} ${CRON_TZ})`);
};
