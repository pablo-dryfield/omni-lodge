import cron from 'node-cron';
import { Op } from 'sequelize';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import logger from '../utils/logger.js';
import { getConfigValue } from '../services/configService.js';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';

dayjs.extend(utc);
dayjs.extend(timezone);

type MidnightHandlerContext = {
  timezone: string;
  today: string;
};

type MidnightHandler = {
  name: string;
  run: (context: MidnightHandlerContext) => Promise<void>;
};

const resolveScheduleTimezone = (): string =>
  (getConfigValue('SCHED_TZ') as string) ?? 'Europe/Warsaw';

const closeExpiredAssistantManagerTasks: MidnightHandler = {
  name: 'assistant-manager-tasks',
  run: async ({ today }) => {
    const [updatedCount] = await AssistantManagerTaskLog.update(
      {
        status: 'missed',
        completedAt: null,
        updatedBy: null,
      },
      {
        where: {
          status: 'pending',
          taskDate: { [Op.lt]: today },
        },
      },
    );

    logger.info(
      `[daily-midnight][assistant-manager-tasks] Closed ${updatedCount} expired pending task(s) before ${today}.`,
    );
  },
};

const midnightHandlers: MidnightHandler[] = [
  closeExpiredAssistantManagerTasks,
];

let isRunning = false;

export const startDailyMidnightClosureJob = (): void => {
  const timezoneName = resolveScheduleTimezone();

  cron.schedule(
    '0 0 * * *',
    async () => {
      if (isRunning) {
        return;
      }

      isRunning = true;
      const todayInTimezone = dayjs().tz(timezoneName).format('YYYY-MM-DD');

      try {
        for (const handler of midnightHandlers) {
          try {
            await handler.run({
              timezone: timezoneName,
              today: todayInTimezone,
            });
          } catch (error) {
            logger.error(
              `[daily-midnight][${handler.name}] Failed: ${(error as Error).message}`,
            );
          }
        }
      } finally {
        isRunning = false;
      }
    },
    { timezone: timezoneName },
  );

  logger.info(
    `[daily-midnight] Cron job registered (expression="0 0 * * *", timezone="${timezoneName}", handlers=${midnightHandlers.length})`,
  );
};

