
import cron from 'node-cron';
import logger from '../utils/logger.js';
import {
  generateWeek,
  sendAvailabilityReminder,
  autoLockCollectingWeek,
} from '../services/scheduleService.js';

const SCHED_TZ = process.env.SCHED_TZ || 'Europe/Warsaw';

export function startScheduleJobs(): void {
  cron.schedule(
    '0 0 * * 1',
    async () => {
      try {
        await generateWeek({ week: null, actorId: null, autoSpawn: true });
        logger.info('[scheduling] Generated upcoming week');
      } catch (error) {
        logger.error(`[scheduling] Failed to generate week: ${(error as Error).message}`);
      }
    },
    { timezone: SCHED_TZ },
  );

  cron.schedule(
    '0 18 * * 6',
    async () => {
      try {
        await sendAvailabilityReminder('availability_reminder_first');
        logger.info('[scheduling] Sent Saturday availability reminder');
      } catch (error) {
        logger.error(`[scheduling] Failed to send Saturday reminder: ${(error as Error).message}`);
      }
    },
    { timezone: SCHED_TZ },
  );

  cron.schedule(
    '0 12 * * 0',
    async () => {
      try {
        await sendAvailabilityReminder('availability_reminder_final');
        logger.info('[scheduling] Sent Sunday final reminder');
      } catch (error) {
        logger.error(`[scheduling] Failed to send Sunday reminder: ${(error as Error).message}`);
      }
    },
    { timezone: SCHED_TZ },
  );

  cron.schedule(
    '0 18 * * 0',
    async () => {
      try {
        await autoLockCollectingWeek();
        logger.info('[scheduling] Auto-locked collecting week');
      } catch (error) {
        logger.error(`[scheduling] Failed to auto-lock week: ${(error as Error).message}`);
      }
    },
    { timezone: SCHED_TZ },
  );

  logger.info('[scheduling] Cron jobs registered');
}
