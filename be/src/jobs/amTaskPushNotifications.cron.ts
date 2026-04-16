import cron from 'node-cron';
import logger from '../utils/logger.js';
import { getConfigValue } from '../services/configService.js';
import { processAmTaskPushReminderTick } from '../services/amTaskPushReminderService.js';

const resolveScheduleTimezone = (): string =>
  (getConfigValue('SCHED_TZ') as string) ?? 'Europe/Warsaw';

let isRunning = false;

export const startAmTaskPushNotificationsJob = (): void => {
  const timezone = resolveScheduleTimezone();

  cron.schedule(
    '* * * * *',
    async () => {
      if (isRunning) {
        return;
      }

      isRunning = true;
      try {
        const sentCount = await processAmTaskPushReminderTick();
        if (sentCount > 0) {
          logger.info(`[am-task-push] Sent ${sentCount} background notification(s).`);
        }
      } catch (error) {
        logger.error(
          `[am-task-push] Failed to process reminder tick: ${
            (error as Error).message
          }`,
        );
      } finally {
        isRunning = false;
      }
    },
    { timezone },
  );

  logger.info('[am-task-push] Cron job registered');
};

