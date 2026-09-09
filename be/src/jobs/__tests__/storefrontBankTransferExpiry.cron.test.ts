import { runStorefrontBankTransferExpiry } from '../storefrontBankTransferExpiry.cron.js';
import { expireOverdueBankTransferOrders } from '../../services/storefrontBankTransferOrderService.js';

jest.mock('../../services/storefrontBankTransferOrderService.js', () => ({
  expireOverdueBankTransferOrders: jest.fn(),
}));
jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: { info: jest.fn(), error: jest.fn() },
}));

const expire = expireOverdueBankTransferOrders as jest.MockedFunction<
  typeof expireOverdueBankTransferOrders
>;

describe('storefront bank transfer expiry cron', () => {
  beforeEach(() => jest.clearAllMocks());

  it('drains full batches and stops after the final partial batch', async () => {
    expire
      .mockResolvedValueOnce({
        examined: 100,
        expired: 100,
        expiredPublicIds: [],
        failedPublicIds: [],
      })
      .mockResolvedValueOnce({
        examined: 2,
        expired: 2,
        expiredPublicIds: [],
        failedPublicIds: [],
      });

    await expect(runStorefrontBankTransferExpiry()).resolves.toBe(102);
    expect(expire).toHaveBeenCalledTimes(2);
    expect(expire).toHaveBeenNthCalledWith(1, { limit: 100 });
  });
});
