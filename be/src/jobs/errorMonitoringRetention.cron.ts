import cron, { type ScheduledTask } from 'node-cron';

import { cleanupErrorMonitoringOccurrences } from '../services/errorMonitoringService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;
let running = false;

export const runErrorMonitoringRetention = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  try {
    const result = await cleanupErrorMonitoringOccurrences();
    if (result.deletedOccurrences > 0) {
      logger.info(
        `[error-monitoring] retention removed occurrences=${result.deletedOccurrences} days=${result.retentionDays}`,
      );
    }
    return result.deletedOccurrences;
  } finally {
    running = false;
  }
};

export const startErrorMonitoringRetentionJob = (): void => {
  if (task) return;
  task = cron.schedule('42 3 * * *', () => {
    void runErrorMonitoringRetention().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[error-monitoring] retention failed: ${message.slice(0, 500)}`);
    });
  }, { timezone: 'UTC' });
};
