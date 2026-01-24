
import cron from 'node-cron';
import logger from '../utils/logger.js';
import {
  generateWeek,
  sendAvailabilityReminder,
  autoLockCollectingWeek,
} from '../services/scheduleService.js';
import { getConfigValue } from '../services/configService.js';

const resolveScheduleTimezone = (): string => (getConfigValue('SCHED_TZ') as string) ?? 'Europe/Warsaw';
const resolveNumber = (key: string, fallback: number): number => {
  const value = Number(getConfigValue(key) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

const buildCronExpression = (dayKey: string, hourKey: string, fallbackDay: number, fallbackHour: number): string => {
  const day = resolveNumber(dayKey, fallbackDay);
  const hour = resolveNumber(hourKey, fallbackHour);
  return `0 ${hour} * * ${day}`;
};

export function startScheduleJobs(): void {
  const timezone = resolveScheduleTimezone();
  const reminder1Cron = buildCronExpression('SCHED_REMINDER1_DAY', 'SCHED_REMINDER1_HOUR', 6, 18);
  const reminder2Cron = buildCronExpression('SCHED_REMINDER2_DAY', 'SCHED_REMINDER2_HOUR', 0, 12);
  const lockCron = buildCronExpression('SCHED_LOCK_DAY', 'SCHED_LOCK_HOUR', 0, 18);

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
    { timezone },
  );

  cron.schedule(
    reminder1Cron,
    async () => {
      try {
        await sendAvailabilityReminder('availability_reminder_first');
        logger.info('[scheduling] Sent availability reminder 1');
      } catch (error) {
        logger.error(`[scheduling] Failed to send Saturday reminder: ${(error as Error).message}`);
      }
    },
    { timezone },
  );

  cron.schedule(
    reminder2Cron,
    async () => {
      try {
        await sendAvailabilityReminder('availability_reminder_final');
        logger.info('[scheduling] Sent availability reminder 2');
      } catch (error) {
        logger.error(`[scheduling] Failed to send Sunday reminder: ${(error as Error).message}`);
      }
    },
    { timezone },
  );

  cron.schedule(
    lockCron,
    async () => {
      try {
        await autoLockCollectingWeek();
        logger.info('[scheduling] Auto-locked collecting week');
      } catch (error) {
        logger.error(`[scheduling] Failed to auto-lock week: ${(error as Error).message}`);
      }
    },
    { timezone },
  );

  logger.info('[scheduling] Cron jobs registered');
}
