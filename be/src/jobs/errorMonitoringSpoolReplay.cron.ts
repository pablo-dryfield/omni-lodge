import cron, { type ScheduledTask } from 'node-cron';

import { replaySpooledErrorEvents } from '../services/errorMonitoringService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;
let running = false;

export const runErrorMonitoringSpoolReplay = async (): Promise<number> => {
  if (running) return 0;
  running = true;
  try {
    const result = await replaySpooledErrorEvents();
    if (result.persisted > 0 || result.malformed > 0 || result.fileErrors > 0) {
      logger.info(
        `[error-monitoring] spool replay persisted=${result.persisted} retained=${result.retained} `
          + `malformed=${result.malformed} fileErrors=${result.fileErrors}`,
      );
    }
    return result.persisted;
  } finally {
    running = false;
  }
};

export const startErrorMonitoringSpoolReplayJob = (): void => {
  if (task) return;

  // Start as soon as the database/bootstrap path has completed, then continue
  // once per minute. The service itself also rejects overlapping replays.
  void runErrorMonitoringSpoolReplay().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[error-monitoring] startup spool replay failed: ${message.slice(0, 500)}`);
  });
  task = cron.schedule('* * * * *', () => {
    void runErrorMonitoringSpoolReplay().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[error-monitoring] spool replay failed: ${message.slice(0, 500)}`);
    });
  }, { timezone: 'UTC' });
};
