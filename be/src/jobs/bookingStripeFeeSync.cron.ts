import cron, { type ScheduledTask } from 'node-cron';
import { getConfigValue, refreshConfigCacheKeys } from '../services/configService.js';
import { runBookingStripeFeeBatch } from '../services/bookings/bookingStripeFeeSyncService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;
let running = false, cursor = 0, lastRunAt = 0;
const keys = ['BOOKING_STRIPE_FEE_SYNC_ENABLED', 'BOOKING_STRIPE_FEE_SYNC_BATCH_SIZE', 'BOOKING_STRIPE_FEE_SYNC_INTERVAL_MINUTES',
  'BOOKING_STRIPE_FEE_SYNC_TIMEOUT_MS', 'STRIPE_SECRET_KEY', 'STRIPE_TEST_SECRET_KEY', 'FOOD_TOUR_STRIPE_SECRET_KEY', 'FOOD_TOUR_STRIPE_TEST_SECRET_KEY'];

export async function reconcileBookingStripeFees(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await refreshConfigCacheKeys(keys);
    if (getConfigValue('BOOKING_STRIPE_FEE_SYNC_ENABLED') !== true) return;
    const interval = Math.max(1, Math.min(1440, Number(getConfigValue('BOOKING_STRIPE_FEE_SYNC_INTERVAL_MINUTES')) || 1));
    if (Date.now() - lastRunAt < interval * 60000) return;
    lastRunAt = Date.now();
    const report = await runBookingStripeFeeBatch({ afterId: cursor, dryRun: false,
      batchSize: Number(getConfigValue('BOOKING_STRIPE_FEE_SYNC_BATCH_SIZE')) || 100,
      timeoutMs: Number(getConfigValue('BOOKING_STRIPE_FEE_SYNC_TIMEOUT_MS')) || 12000 });
    cursor = report.nextCursor;
    if (report.scanned || report.remainingMissing) logger.info(`[booking-stripe-fees] ${JSON.stringify(report)}`);
  } finally { running = false; }
}

export function startBookingStripeFeeSyncJob(): void {
  if (task) return;
  // The cadence is a scheduler heartbeat; editable interval and controls refresh on every tick.
  task = cron.schedule('* * * * *', () => {
    void reconcileBookingStripeFees().catch(error => logger.error('[booking-stripe-fees] Reconciliation failed', error));
  }, { timezone: 'UTC' });
}
