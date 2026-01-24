import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { executeBackupScript } from '../services/dbBackupService.js';
import { getConfigValue } from '../services/configService.js';

const DEFAULT_CRON_EXPRESSION = '0 6 * * *';
const DEFAULT_TIMEZONE = 'UTC';

const resolveCronExpression = (): string =>
  (getConfigValue('DB_BACKUP_CRON') as string | null) ?? DEFAULT_CRON_EXPRESSION;

const resolveCronTimezone = (): string =>
  (getConfigValue('DB_BACKUP_TZ') as string | null) ?? DEFAULT_TIMEZONE;

let scheduledTask: ScheduledTask | null = null;

export const startDbBackupJob = (): void => {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  const cronExpression = resolveCronExpression();
  const timezone = resolveCronTimezone();

  scheduledTask = cron.schedule(
    cronExpression,
    async () => {
      logger.info('[db-backup] Daily backup job started');
      try {
        const result = await executeBackupScript();
        logger.info('[db-backup] Backup job completed', {
          command: result.command,
          exitCode: result.exitCode,
          args: result.args,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[db-backup] Backup job failed: ${message}`, error);
      }
    },
    { timezone },
  );

  logger.info(`[db-backup] Cron job registered (expression="${cronExpression}", timezone="${timezone}")`);
};
