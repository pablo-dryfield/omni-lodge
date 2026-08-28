import type { StorefrontCancellationPolicy } from '../types/storefront.js';
import { getConfigValue } from './configService.js';
import {
  isStorefrontStripeConfigured,
  isStorefrontStripeTestMode,
} from '../finance/services/stripeClient.js';

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const normalizeStorefrontCancellationPolicy = (
  value: unknown,
): StorefrontCancellationPolicy | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title = text(record.title);
  const summary = text(record.summary);
  if (!title || !summary) return null;

  const items = Array.isArray(record.items)
    ? record.items.flatMap((rawItem) => {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return [];
        const item = rawItem as Record<string, unknown>;
        const title = text(item.title);
        const description = text(item.description);
        return title && description ? [{ title, description }] : [];
      })
    : [];

  return {
    title,
    summary,
    items,
  };
};

export const getStorefrontCancellationPolicy = (): StorefrontCancellationPolicy | null =>
  normalizeStorefrontCancellationPolicy(getConfigValue('STOREFRONT_CANCELLATION_POLICY'));

export const getStorefrontPublicConfig = () => ({
  currency: 'PLN',
  stripeConfigured: isStorefrontStripeConfigured(),
  stripeMode: isStorefrontStripeTestMode() ? 'test' : 'live',
  checkoutEnabled: isStorefrontStripeConfigured(),
  cancellationPolicy: getStorefrontCancellationPolicy(),
  journeyReplay: {
    enabled: getConfigValue('STOREFRONT_CLARITY_REPLAY_ENABLED') === true,
    projectId: text(getConfigValue('STOREFRONT_CLARITY_PROJECT_ID')),
    samplePercent: Math.min(
      100,
      Math.max(0, Number(getConfigValue('STOREFRONT_CLARITY_SAMPLE_PERCENT')) || 0),
    ),
    requireAnalyticsConsent:
      getConfigValue('STOREFRONT_CLARITY_REQUIRE_ANALYTICS_CONSENT') !== false,
  },
});
