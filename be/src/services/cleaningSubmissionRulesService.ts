import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import HttpError from '../errors/HttpError.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const CLEANING_PHOTO_APPROVAL_CONFIG_KEY = 'cleaningPhotoApprovalEnabled';
export const CLEANING_WORKFLOW_META_KEY = 'cleaningPhotoWorkflow';
export const CLEANING_TIMEZONE = 'Europe/Warsaw';
export const CLEANING_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const CLEANING_PHOTO_MAX_PIXELS = 24_000_000;
export type CleaningRequiredSlot = { key: string; label: string; ruleKey: string };
export type CleaningPhotoSlotSource = { slots: CleaningRequiredSlot[]; shiftTypeIds: number[]; sourceKey: string };

export const objectValue = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** The explicit opt-in avoids turning unrelated task evidence into cleaning requests. */
export const cleaningPhotoWorkflowEnabled = (scheduleConfig: unknown): boolean =>
  objectValue(scheduleConfig)[CLEANING_PHOTO_APPROVAL_CONFIG_KEY] === true;

export const readCleaningPhotoSources = (scheduleConfig: unknown): CleaningPhotoSlotSource[] => {
  const config = objectValue(scheduleConfig);
  if (!cleaningPhotoWorkflowEnabled(config)) return [];
  if (config.requireSocialMediaPlan === true || config.completeOnSocialMediaPublish === true || config.volunteerAttendance != null) {
    throw new HttpError(409, 'Automatic cleaning approval cannot be combined with Social Media or attendance completion rules.');
  }
  const rules = Array.isArray(config.evidenceRules) ? config.evidenceRules.map(objectValue) : [];
  const sources = Array.isArray(config.shiftEvidenceSources) ? config.shiftEvidenceSources.map(objectValue) : [];
  const used = new Set<string>();
  const parsed: CleaningPhotoSlotSource[] = [];
  for (const rule of rules) {
    if (rule.required !== true && Number(rule.minItems ?? 0) <= 0) continue;
    if (rule.type !== 'image' || !sources.some((source) => source.evidenceRuleKey === rule.key)) {
      throw new HttpError(409, 'Every required rule on an automatic cleaning task must be an image rule mapped to assigned shifts.');
    }
  }
  for (const source of sources) {
    const sourceKey = typeof source.key === 'string' ? source.key.trim() : '';
    const ruleKey = typeof source.evidenceRuleKey === 'string' ? source.evidenceRuleKey.trim() : '';
    const rule = rules.find((entry) => entry.key === ruleKey);
    if (rule && rule.required !== true && Number(rule.minItems ?? 0) <= 0) continue;
    const shiftTypeIds = Array.isArray(source.shiftTypeIds) ? source.shiftTypeIds : [];
    if (!sourceKey || !/^[a-zA-Z0-9_-]{1,100}$/u.test(sourceKey) || !ruleKey || !rule || rule.type !== 'image'
      || !shiftTypeIds.length || shiftTypeIds.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
      throw new HttpError(409, 'The cleaning task has invalid photo requirements. A manager must correct its template.');
    }
    const count = Math.max(rule.required === false ? 0 : 1, Number(rule.minItems ?? 1));
    if (!Number.isSafeInteger(count) || count < 1 || count > 12 || (rule.multiple === false && count > 1)) {
      throw new HttpError(409, 'Cleaning photo rules must require between 1 and 12 photos per assigned person.');
    }
    const slots = Array.from({ length: count }, (_, index) => {
      const key = `${sourceKey}-${index + 1}`;
      if (used.has(key)) throw new HttpError(409, 'Cleaning photo source keys must be unique.');
      used.add(key);
      const label = String(rule.label || source.label || 'Cleaning photo');
      return { key, ruleKey, label: count === 1 ? label : `${label} (${index + 1} of ${count})` };
    });
    parsed.push({ sourceKey, slots, shiftTypeIds: [...new Set(shiftTypeIds as number[])] });
  }
  if (!parsed.length || parsed.flatMap((source) => source.slots).length > 24) {
    throw new HttpError(409, 'Configure 1 to 24 required cleaning photo slots before enabling this workflow.');
  }
  return parsed;
};

export const shiftWindow = (shift: { date: string; timeStart: string | null; timeEnd: string | null }): { start: number; end: number } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(shift.date) || !shift.timeStart || !shift.timeEnd) return null;
  const start = dayjs.tz(`${shift.date}T${shift.timeStart}`, CLEANING_TIMEZONE);
  let end = dayjs.tz(`${shift.date}T${shift.timeEnd}`, CLEANING_TIMEZONE);
  if (!start.isValid() || !end.isValid()) return null;
  if (!end.isAfter(start)) end = dayjs.tz(`${dayjs(shift.date).add(1, 'day').format('YYYY-MM-DD')}T${shift.timeEnd}`, CLEANING_TIMEZONE);
  return { start: start.valueOf(), end: end.valueOf() };
};

export const shiftsOverlap = (
  first: Parameters<typeof shiftWindow>[0], second: Parameters<typeof shiftWindow>[0],
): boolean => {
  const left = shiftWindow(first);
  const right = shiftWindow(second);
  return Boolean(left && right && left.start < right.end && right.start < left.end);
};

export const assertCleaningRevision = (expected: unknown, actual: number): void => {
  const parsed = typeof expected === 'string' && /^\d+$/u.test(expected) ? Number(expected) : expected;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, 'expectedRevision must be a positive integer.');
  if (parsed !== actual) throw new HttpError(409, 'These cleaning photos changed. Refresh before continuing.');
};
