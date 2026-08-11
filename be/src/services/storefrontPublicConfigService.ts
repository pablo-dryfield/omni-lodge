import type { StorefrontCancellationPolicy } from '../types/storefront.js';
import { getConfigValue } from './configService.js';

export const DEFAULT_STOREFRONT_CANCELLATION_POLICY: StorefrontCancellationPolicy = {
  title: 'Cancellation policy',
  summary: 'Cancel at least 24 hours before the experience start time for a full refund or credit.',
  items: [
    {
      title: '24 hours or more before the start time',
      description: 'You can receive a full refund or credit.',
    },
    {
      title: 'If we cancel',
      description:
        'You will receive a full refund or credit if the operator cancels because of weather or another unforeseen circumstance.',
    },
    {
      title: 'Within 24 hours or for a no-show',
      description:
        'Cancellation requests will be rejected and no-shows will be charged the full price.',
    },
  ],
};

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export const normalizeStorefrontCancellationPolicy = (
  value: unknown,
): StorefrontCancellationPolicy => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_STOREFRONT_CANCELLATION_POLICY;
  }
  const record = value as Record<string, unknown>;
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
    title: text(record.title, DEFAULT_STOREFRONT_CANCELLATION_POLICY.title),
    summary: text(record.summary, DEFAULT_STOREFRONT_CANCELLATION_POLICY.summary),
    items: items.length > 0 ? items : DEFAULT_STOREFRONT_CANCELLATION_POLICY.items,
  };
};

export const getStorefrontCancellationPolicy = (): StorefrontCancellationPolicy =>
  normalizeStorefrontCancellationPolicy(getConfigValue('STOREFRONT_CANCELLATION_POLICY'));
