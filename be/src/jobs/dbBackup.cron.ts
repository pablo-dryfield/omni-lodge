import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { executeBackupScript } from '../services/dbBackupService.js';

const DEFAULT_CRON_EXPRESSION = '0 6 * * *';
const cronExpression = process.env.DB_BACKUP_CRON ?? DEFAULT_CRON_EXPRESSION;
const timezone = process.env.DB_BACKUP_TZ ?? 'UTC';

let scheduledTask: ScheduledTask | null = null;

export const startDbBackupJob = (): void => {
  if (scheduledTask) {
    scheduledTask.stop();
  }

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
