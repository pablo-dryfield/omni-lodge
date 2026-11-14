import { getConfigValue, refreshConfigCacheKeys } from '../configService.js';
import HttpError from '../../errors/HttpError.js';

import { partnerConfigDefinitions } from '../../config/partnerConfig.js';

export const loadPartnerConfig = async (requireEnabled = true) => {
  await refreshConfigCacheKeys(partnerConfigDefinitions.map(x => x.key));
  if (requireEnabled && getConfigValue('PARTNERS_ENABLED') !== true) throw new HttpError(503, 'Partner bookings are temporarily unavailable.');
  const baseUrl = String(getConfigValue('PARTNERS_PUBLIC_BASE_URL')).replace(/\/$/, '');
  if (requireEnabled) try {
    const url = new URL(baseUrl);
    if (url.origin !== baseUrl || (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && url.hostname === 'localhost'))) throw new Error();
  } catch { throw new HttpError(503, 'Configure a valid public HTTPS origin for Partners in Control Panel.'); }
  return {
    enabled: getConfigValue('PARTNERS_ENABLED') === true,
    baseUrl,
    apiRpm: Number(getConfigValue('PARTNERS_API_REQUESTS_PER_MINUTE')),
    publicRpm: Number(getConfigValue('PARTNERS_PUBLIC_REQUESTS_PER_MINUTE')),
    connectEnabled: getConfigValue('PARTNERS_CONNECT_ENABLED') === true,
    tokenDays: Number(getConfigValue('PARTNERS_API_TOKEN_DAYS')),
    bulkMax: Number(getConfigValue('PARTNERS_BULK_MAX_ROWS')),
    holdMinutes: Number(getConfigValue('PARTNERS_HOLD_MINUTES')),
    webhookAttempts: Number(getConfigValue('PARTNERS_WEBHOOK_MAX_ATTEMPTS')),
    workerBatch: Number(getConfigValue('PARTNERS_WORKER_BATCH_SIZE')),
  };
};
