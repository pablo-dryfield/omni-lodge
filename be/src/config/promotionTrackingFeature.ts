export const PROMOTION_TRACKING_DISABLED_CODE = 'PROMOTION_TRACKING_DISABLED';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on', 'enabled']);

export const isPromotionTrackingServerEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  const raw = env.FEATURE_PROMOTION_TRACKING_SERVER
    ?? env.PROMOTION_TRACKING_SERVER_ENABLED
    ?? '';
  return ENABLED_VALUES.has(raw.trim().toLowerCase());
};
