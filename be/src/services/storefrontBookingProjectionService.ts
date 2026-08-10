import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const STOREFRONT_TIMEZONE = 'Europe/Warsaw';

type PartyBreakdown = {
  men: number;
  women: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonNegativeInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};

export const getStorefrontPartyBreakdown = (
  options: unknown,
  quantity: number,
): PartyBreakdown | null => {
  const participants = asRecord(asRecord(options)?.participants);
  if (!participants) return null;

  const rawMen = nonNegativeInteger(participants.men);
  const rawWomen = nonNegativeInteger(participants.women);
  if (rawMen === null && rawWomen === null) return null;

  const total = Math.max(0, Math.round(Number(quantity) || 0));
  let men = rawMen ?? Math.max(total - (rawWomen ?? 0), 0);
  let women = rawWomen ?? Math.max(total - men, 0);
  const combined = men + women;

  if (combined !== total) {
    if (combined <= 0) return null;
    const scale = total / combined;
    men = Math.max(0, Math.round(men * scale));
    women = Math.max(0, total - men);
  }

  return { men, women };
};

export const buildStorefrontAddonsSnapshot = (
  addons: Array<Record<string, unknown>>,
  options: unknown,
  quantity: number,
): Record<string, unknown> => {
  const snapshot: Record<string, unknown> = { addons };
  const partyBreakdown = getStorefrontPartyBreakdown(options, quantity);
  if (partyBreakdown) snapshot.partyBreakdown = partyBreakdown;
  return snapshot;
};

export const mergeStorefrontAddonsSnapshot = (
  current: unknown,
  addons: Array<Record<string, unknown>>,
  options: unknown,
  quantity: number,
): Record<string, unknown> => {
  const currentRecord = asRecord(current);
  const snapshot: Record<string, unknown> = currentRecord
    ? { ...currentRecord }
    : { addons: Array.isArray(current) ? current : addons };
  if (!Array.isArray(snapshot.addons)) snapshot.addons = addons;
  if (!asRecord(snapshot.partyBreakdown)) {
    const partyBreakdown = getStorefrontPartyBreakdown(options, quantity);
    if (partyBreakdown) snapshot.partyBreakdown = partyBreakdown;
  }
  return snapshot;
};

export const getStorefrontExperienceStartAt = (
  experienceDate: string | null,
  experienceTime: string | null,
): Date | null => {
  const date = String(experienceDate ?? '').trim();
  const time = String(experienceTime ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return null;
  }
  const parsed = dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', STOREFRONT_TIMEZONE);
  return parsed.isValid() ? parsed.toDate() : null;
};
