import HttpError from '../errors/HttpError.js';
import type { StorefrontAddonConfig } from '../types/storefront.js';

/** Validate at the settings boundary; preserve unrelated selection rules. */
export const validateAddonAvailability = (value: unknown): void => {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Add-on availability must be an object.');
  }
  const { enabled, daysOfWeek, unavailableMessage } = value as Record<string, unknown>;
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new HttpError(400, 'Add-on availability enabled must be true or false.');
  }
  if (daysOfWeek !== undefined && (!Array.isArray(daysOfWeek)
    || daysOfWeek.length === 0 || daysOfWeek.length > 7
    || daysOfWeek.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    || new Set(daysOfWeek).size !== daysOfWeek.length)) {
    throw new HttpError(400, 'Choose unique experience weekdays from Monday (1) to Sunday (7), or mark the add-on unavailable.');
  }
  if (unavailableMessage !== undefined && (typeof unavailableMessage !== 'string' || unavailableMessage.length > 500)) {
    throw new HttpError(400, 'Unavailable message must be text of at most 500 characters.');
  }
};

export const evaluateAddonAvailability = (
  config: StorefrontAddonConfig,
  experienceDate: string | null | undefined,
): { available: boolean; message: string | null; requiresExperienceDate: boolean } => {
  const rules = config.availability;
  const unavailableMessage = rules?.unavailableMessage?.trim() || 'This add-on is unavailable for the selected experience date.';
  if (rules?.enabled === false) {
    return { available: false, message: unavailableMessage, requiresExperienceDate: false };
  }
  if (rules?.daysOfWeek === undefined) {
    return { available: true, message: null, requiresExperienceDate: false };
  }
  // Parse the date itself, never the buyer's local time or the purchase timestamp.
  const date = typeof experienceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(experienceDate)
    ? new Date(`${experienceDate}T00:00:00.000Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== experienceDate) {
    return { available: false, message: 'Choose an experience date to check this add-on.', requiresExperienceDate: true };
  }
  const available = rules.daysOfWeek.includes(date.getUTCDay() || 7);
  return { available, message: available ? null : unavailableMessage, requiresExperienceDate: false };
};
