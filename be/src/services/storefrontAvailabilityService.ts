import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import type { StorefrontAvailabilityConfig, StorefrontProductConfig } from '../types/storefront.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const STOREFRONT_AVAILABILITY_TIMEZONE = 'Europe/Warsaw';
export const DEFAULT_STOREFRONT_CUTOFF_MINUTES = 0;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

type RedirectableRule = {
  redirectProductId?: number | null;
  redirectProductSlug?: string | null;
  redirectUrl?: string | null;
};

export type StorefrontAvailabilityEvaluation = {
  available: boolean;
  reason: 'available' | 'blocked_date' | 'cutoff';
  message: string | null;
  cutoffMinutes: number;
  redirectProductId: number | null;
  redirectProductSlug: string | null;
  redirectUrl: string | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown, maxLength = 255): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const dateKey = (value: unknown): string | null => {
  const normalized = text(value, 10);
  if (!DATE_PATTERN.test(normalized)) return null;
  const parsed = dayjs(normalized);
  return parsed.isValid() && parsed.format('YYYY-MM-DD') === normalized ? normalized : null;
};

const timeKey = (value: unknown): string | null => {
  const normalized = text(value, 5);
  return TIME_PATTERN.test(normalized) ? normalized : null;
};

const minuteValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(10080, Math.max(0, Math.trunc(parsed)));
};

const productIdValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeRedirectable = <T extends Record<string, unknown>>(
  record: Record<string, unknown>,
  base: T,
): T & RedirectableRule => {
  const redirectProductId = productIdValue(record.redirectProductId);
  const redirectProductSlug = text(record.redirectProductSlug, 160);
  const redirectUrl = text(record.redirectUrl, 500);
  return {
    ...base,
    ...(redirectProductId ? { redirectProductId } : {}),
    ...(redirectProductSlug ? { redirectProductSlug } : {}),
    ...(redirectUrl ? { redirectUrl } : {}),
  };
};

export const normalizeStorefrontAvailability = (
  value: unknown,
): StorefrontAvailabilityConfig | null => {
  const record = asRecord(value);
  if (!record) return null;

  const cutoffMinutes = minuteValue(record.cutoffMinutes);
  const blockedDates = Array.isArray(record.blockedDates)
    ? record.blockedDates.flatMap((item) => {
        const itemRecord = asRecord(item);
        const date = dateKey(itemRecord?.date);
        if (!itemRecord || !date) return [];
        const reason = text(itemRecord.reason, 300);
        return normalizeRedirectable(itemRecord, {
          date,
          ...(reason ? { reason } : {}),
        });
      })
    : [];

  const dateOverrides = Array.isArray(record.dateOverrides)
    ? record.dateOverrides.flatMap((item) => {
        const itemRecord = asRecord(item);
        const date = dateKey(itemRecord?.date);
        if (!itemRecord || !date) return [];
        const rawMode = text(itemRecord.mode, 20).toLowerCase();
        const reason = text(itemRecord.reason, 300);
        const overrideCutoffMinutes = minuteValue(itemRecord.cutoffMinutes);
        const blocked =
          itemRecord.blocked === true
          || itemRecord.isBlocked === true
          || rawMode === 'blocked'
          || rawMode === 'closed';
        const mode: 'blocked' | 'available' = blocked ? 'blocked' : 'available';
        return normalizeRedirectable(itemRecord, {
          date,
          enabled: itemRecord.enabled !== false,
          mode,
          ...(overrideCutoffMinutes !== null ? { cutoffMinutes: overrideCutoffMinutes } : {}),
          ...(reason ? { reason } : {}),
        });
      })
    : [];

  if (cutoffMinutes === null && blockedDates.length === 0 && dateOverrides.length === 0) {
    return null;
  }

  return {
    ...(cutoffMinutes !== null ? { cutoffMinutes } : {}),
    ...(blockedDates.length > 0 ? { blockedDates } : {}),
    ...(dateOverrides.length > 0 ? { dateOverrides } : {}),
  };
};

const ruleRedirect = (rule: RedirectableRule | null | undefined) => ({
  redirectProductId: rule?.redirectProductId ?? null,
  redirectProductSlug: rule?.redirectProductSlug ?? null,
  redirectUrl: rule?.redirectUrl ?? null,
});

export const evaluateStorefrontAvailability = (
  config: StorefrontProductConfig,
  input: {
    experienceDate?: string | null;
    experienceTime?: string | null;
    now?: Date;
  },
): StorefrontAvailabilityEvaluation => {
  const availability = normalizeStorefrontAvailability(config.availability);
  const cutoffMinutes = availability?.cutoffMinutes ?? DEFAULT_STOREFRONT_CUTOFF_MINUTES;
  const availableResult: StorefrontAvailabilityEvaluation = {
    available: true,
    reason: 'available',
    message: null,
    cutoffMinutes,
    redirectProductId: null,
    redirectProductSlug: null,
    redirectUrl: null,
  };

  const selectedDate = dateKey(input.experienceDate);
  if (!selectedDate) return availableResult;

  const override = (availability?.dateOverrides ?? []).find(
    (rule) => rule.enabled !== false && rule.date === selectedDate,
  );
  const blockedRule = (availability?.blockedDates ?? []).find((rule) => rule.date === selectedDate);

  if (override?.mode === 'blocked') {
    return {
      available: false,
      reason: 'blocked_date',
      message: override.reason || 'This date is unavailable for this experience.',
      cutoffMinutes: override.cutoffMinutes ?? cutoffMinutes,
      ...ruleRedirect(override),
    };
  }

  if (!override && blockedRule) {
    return {
      available: false,
      reason: 'blocked_date',
      message: blockedRule.reason || 'This date is unavailable for this experience.',
      cutoffMinutes,
      ...ruleRedirect(blockedRule),
    };
  }

  const effectiveCutoffMinutes = override?.cutoffMinutes ?? cutoffMinutes;
  const selectedTime = timeKey(input.experienceTime ?? config.defaultStartTime);
  if (selectedTime && effectiveCutoffMinutes > 0) {
    const startAt = dayjs.tz(
      `${selectedDate} ${selectedTime}`,
      'YYYY-MM-DD HH:mm',
      STOREFRONT_AVAILABILITY_TIMEZONE,
    );
    const now = dayjs(input.now ?? new Date()).tz(STOREFRONT_AVAILABILITY_TIMEZONE);
    const cutoffAt = startAt.subtract(effectiveCutoffMinutes, 'minute');
    if (startAt.isValid() && (now.isSame(cutoffAt) || now.isAfter(cutoffAt))) {
      return {
        available: false,
        reason: 'cutoff',
        message: `Bookings for this time close ${effectiveCutoffMinutes} minutes before the start.`,
        cutoffMinutes: effectiveCutoffMinutes,
        ...ruleRedirect(override),
      };
    }
  }

  return {
    ...availableResult,
    cutoffMinutes: effectiveCutoffMinutes,
  };
};

export const collectAvailabilityRedirectProductIds = (
  config: StorefrontProductConfig | null | undefined,
): number[] => {
  const availability = normalizeStorefrontAvailability(config?.availability);
  if (!availability) return [];
  return Array.from(new Set([
    ...(availability.blockedDates ?? []).map((rule) => rule.redirectProductId ?? 0),
    ...(availability.dateOverrides ?? []).map((rule) => rule.redirectProductId ?? 0),
  ].filter((id) => Number.isInteger(id) && id > 0)));
};

export const withAvailabilityRedirectSlugs = (
  config: StorefrontProductConfig,
  slugByProductId: ReadonlyMap<number, string>,
): StorefrontProductConfig => {
  const availability = normalizeStorefrontAvailability(config.availability);
  if (!availability) return config;

  const attachSlug = <T extends RedirectableRule>(rule: T): T => {
    if (!rule.redirectProductId || rule.redirectProductSlug) return rule;
    const slug = slugByProductId.get(rule.redirectProductId);
    return slug ? { ...rule, redirectProductSlug: slug } : rule;
  };

  return {
    ...config,
    availability: {
      ...availability,
      blockedDates: (availability.blockedDates ?? []).map(attachSlug),
      dateOverrides: (availability.dateOverrides ?? []).map(attachSlug),
    },
  };
};
