import StorefrontOngoingCart from '../../models/StorefrontOngoingCart';
import { getConfigValue, refreshConfigCacheKeys } from '../../services/configService';
import { reconcileOngoingCart } from '../../services/storefrontOngoingCartService';
import { runStorefrontAbandonedCartRecovery } from '../storefrontAbandonedCart.cron';

jest.mock('node-cron', () => ({ __esModule: true, default: { schedule: jest.fn() } }));
jest.mock('../../models/StorefrontOngoingCart.js', () => ({ __esModule: true, default: { findAll: jest.fn(), update: jest.fn() } }));
jest.mock('../../services/configService.js', () => ({ getConfigValue: jest.fn(), refreshConfigCacheKeys: jest.fn() }));
jest.mock('../../services/storefrontOngoingCartService.js', () => ({ reconcileOngoingCart: jest.fn() }));
jest.mock('../../services/storefrontCartRecoveryEmailService.js', () => ({ sendAndRecordStorefrontCartRecoveryEmail: jest.fn() }));
jest.mock('../../services/storefrontJourneyService.js', () => ({ purgeExpiredStorefrontJourneyDetails: jest.fn() }));
jest.mock('../../utils/logger.js', () => ({ __esModule: true, default: { info: jest.fn(), error: jest.fn() } }));

beforeEach(() => {
  jest.resetAllMocks();
  (getConfigValue as jest.Mock).mockImplementation(key => key === 'STOREFRONT_CART_RECONCILIATION_BATCH_SIZE' ? 100 : false);
  (StorefrontOngoingCart.findAll as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
});

it('reconciles old carts even when automatic recovery emails are disabled', async () => {
  expect(await runStorefrontAbandonedCartRecovery()).toBe(0);
  expect(reconcileOngoingCart).toHaveBeenCalledTimes(2);
  expect(refreshConfigCacheKeys).toHaveBeenCalledWith(['STOREFRONT_CART_RECONCILIATION_BATCH_SIZE']);
  expect(StorefrontOngoingCart.update).not.toHaveBeenCalled();
});

it('continues past one failed legacy cart and retries it in a later cycle', async () => {
  (reconcileOngoingCart as jest.Mock).mockRejectedValueOnce(new Error('Invalid old cart')).mockResolvedValue(undefined);
  await runStorefrontAbandonedCartRecovery();
  expect(reconcileOngoingCart).toHaveBeenCalledTimes(2);
  await runStorefrontAbandonedCartRecovery();
  expect(reconcileOngoingCart).toHaveBeenNthCalledWith(3, { id: 1 });
});
