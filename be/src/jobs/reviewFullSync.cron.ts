import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger.js';
import { getConfigValue } from '../services/configService.js';
import { runAllFullReviewSyncs } from '../services/reviewFullSyncService.js';

let scheduledTask: ScheduledTask | null = null;
let running = false;
export const startReviewFullSyncJob = (): void => {
  scheduledTask?.stop();
  const timezone = (getConfigValue('SCHED_TZ') as string | null) ?? 'Europe/Warsaw';
  scheduledTask = cron.schedule('0 7 * * *', async () => {
    if (running) { logger.warn('[review-sync] Skipping daily full sync because the previous run is still active'); return; }
    running = true; logger.info('[review-sync] Daily full sync started');
    try { logger.info('[review-sync] Daily full sync completed', { results: await runAllFullReviewSyncs() }); }
    catch (error) { logger.error('[review-sync] Daily full sync failed', error); }
    finally { running = false; }
  }, { timezone });
  logger.info(`[review-sync] Cron job registered (expression="0 7 * * *", timezone="${timezone}")`);
};
