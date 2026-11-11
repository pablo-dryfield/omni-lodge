jest.mock('node-cron', () => ({ __esModule: true, default: { schedule: jest.fn(() => ({})) } }));
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn(), refreshConfigCacheKeys: jest.fn() }));
jest.mock('../../services/bookings/bookingStripeFeeSyncService.js', () => ({ runBookingStripeFeeBatch: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn() } }));

let job: typeof import('../bookingStripeFeeSync.cron');
let config: jest.Mock, batch: jest.Mock;
const settings: Record<string, unknown> = {};

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers().setSystemTime(new Date('2026-11-11T12:00:00Z'));
  job = require('../bookingStripeFeeSync.cron');
  config = jest.requireMock('../../services/configService.js').getConfigValue;
  batch = jest.requireMock('../../services/bookings/bookingStripeFeeSyncService.js').runBookingStripeFeeBatch;
  Object.assign(settings, { BOOKING_STRIPE_FEE_SYNC_ENABLED: true, BOOKING_STRIPE_FEE_SYNC_BATCH_SIZE: 50,
    BOOKING_STRIPE_FEE_SYNC_INTERVAL_MINUTES: 1, BOOKING_STRIPE_FEE_SYNC_TIMEOUT_MS: 4000 });
  config.mockImplementation(key => settings[key]);
  batch.mockResolvedValue({ nextCursor: 100, scanned: 50, remainingMissing: 2 });
});
afterEach(() => jest.useRealTimers());

it('refreshes its controls and honors pause without starting a backfill', async () => {
  settings.BOOKING_STRIPE_FEE_SYNC_ENABLED = false;
  await job.reconcileBookingStripeFees();
  expect(batch).not.toHaveBeenCalled();
  expect(jest.requireMock('../../services/configService.js').refreshConfigCacheKeys).toHaveBeenCalledWith(expect.arrayContaining(['BOOKING_STRIPE_FEE_SYNC_ENABLED', 'FOOD_TOUR_STRIPE_SECRET_KEY']));
});

it('advances the historical cursor, honors interval changes live and does not overlap', async () => {
  let finish: (value: unknown) => void = () => {};
  batch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = job.reconcileBookingStripeFees();
  await Promise.resolve();
  await job.reconcileBookingStripeFees();
  expect(batch).toHaveBeenCalledTimes(1);
  finish({ nextCursor: 100, scanned: 50, remainingMissing: 2 }); await first;
  await job.reconcileBookingStripeFees(); expect(batch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60000); await job.reconcileBookingStripeFees();
  expect(batch).toHaveBeenLastCalledWith({ afterId: 100, dryRun: false, batchSize: 50, timeoutMs: 4000 });
  settings.BOOKING_STRIPE_FEE_SYNC_INTERVAL_MINUTES = 5;
  jest.advanceTimersByTime(60000); await job.reconcileBookingStripeFees(); expect(batch).toHaveBeenCalledTimes(2);
});

it('recovers its running guard after failure and retries the same cursor', async () => {
  batch.mockRejectedValueOnce(new Error('Temporary failure'));
  await expect(job.reconcileBookingStripeFees()).rejects.toThrow('Temporary failure');
  jest.advanceTimersByTime(60000); await job.reconcileBookingStripeFees();
  expect(batch).toHaveBeenLastCalledWith(expect.objectContaining({ afterId: 0 }));
});

it('registers only one scheduler heartbeat without running work on import', () => {
  expect(batch).not.toHaveBeenCalled();
  job.startBookingStripeFeeSyncJob(); job.startBookingStripeFeeSyncJob();
  expect(jest.requireMock('node-cron').default.schedule).toHaveBeenCalledTimes(1);
});
