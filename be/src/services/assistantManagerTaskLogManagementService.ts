import HttpError from '../errors/HttpError.js';

export type ManagedAssistantManagerTaskLogPatch = {
  userId?: number;
  taskDate?: string;
  time?: string | null;
  durationHours?: number;
  priority?: 'high' | 'medium' | 'low';
  points?: number;
  tags?: string[];
  notes?: string | null;
  requireShift?: boolean;
};

export type AssistantManagerTaskLogManagerOverride = {
  originalGenerationSourceKey: string;
  updatedAt: string;
  updatedBy: number | null;
};

export const MANAGER_TASK_OVERRIDE_META_KEY = 'managerOverride';

const MANAGED_LOG_EDIT_KEYS = new Set<keyof ManagedAssistantManagerTaskLogPatch>([
  'userId',
  'taskDate',
  'time',
  'durationHours',
  'priority',
  'points',
  'tags',
  'notes',
  'requireShift',
]);
const SELF_SERVICE_META_KEYS = new Set([
  'comment',
  'evidence',
  'evidenceItems',
  'attachments',
  'meta',
]);
const SELF_SERVICE_NESTED_META_KEYS = new Set([
  'evidence',
  'evidenceItems',
  'attachments',
]);
const TASK_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TASK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const GENERATION_SOURCE_KEY_PATTERN = /^[1-9]\d*:[1-9]\d*:\d{4}-\d{2}-\d{2}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const isValidTaskDate = (value: string): boolean => {
  if (!TASK_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

export const parseManagedAssistantManagerTaskLogPatch = (
  body: unknown,
): ManagedAssistantManagerTaskLogPatch => {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'Request body must be an object');
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    throw new HttpError(400, 'At least one editable field is required');
  }
  const unknownKey = keys.find(
    (key) => !MANAGED_LOG_EDIT_KEYS.has(key as keyof ManagedAssistantManagerTaskLogPatch),
  );
  if (unknownKey) {
    throw new HttpError(400, `Unknown editable field: ${unknownKey}`);
  }

  const payload: ManagedAssistantManagerTaskLogPatch = {};
  if (hasOwn(body, 'userId')) {
    if (typeof body.userId !== 'number' || !Number.isInteger(body.userId) || body.userId <= 0) {
      throw new HttpError(400, 'userId must be a positive integer');
    }
    payload.userId = body.userId;
  }
  if (hasOwn(body, 'taskDate')) {
    if (typeof body.taskDate !== 'string' || !isValidTaskDate(body.taskDate)) {
      throw new HttpError(400, 'taskDate must be a valid YYYY-MM-DD date');
    }
    payload.taskDate = body.taskDate;
  }
  if (hasOwn(body, 'time')) {
    if (body.time !== null && (typeof body.time !== 'string' || !TASK_TIME_PATTERN.test(body.time))) {
      throw new HttpError(400, 'time must use HH:mm format or be null');
    }
    payload.time = body.time as string | null;
  }
  if (hasOwn(body, 'durationHours')) {
    if (
      typeof body.durationHours !== 'number' ||
      !Number.isFinite(body.durationHours) ||
      body.durationHours < 0.25
    ) {
      throw new HttpError(400, 'durationHours must be a number of at least 0.25');
    }
    payload.durationHours = body.durationHours;
  }
  if (hasOwn(body, 'priority')) {
    if (body.priority !== 'high' && body.priority !== 'medium' && body.priority !== 'low') {
      throw new HttpError(400, 'priority must be high, medium, or low');
    }
    payload.priority = body.priority;
  }
  if (hasOwn(body, 'points')) {
    if (typeof body.points !== 'number' || !Number.isFinite(body.points) || body.points < 0) {
      throw new HttpError(400, 'points must be a non-negative number');
    }
    payload.points = body.points;
  }
  if (hasOwn(body, 'tags')) {
    if (
      !Array.isArray(body.tags) ||
      !body.tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0)
    ) {
      throw new HttpError(400, 'tags must be an array of non-empty strings');
    }
    payload.tags = Array.from(new Set(body.tags.map((tag) => tag.trim())));
  }
  if (hasOwn(body, 'notes')) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      throw new HttpError(400, 'notes must be a string or null');
    }
    payload.notes = typeof body.notes === 'string' ? body.notes.trim() : null;
  }
  if (hasOwn(body, 'requireShift')) {
    if (typeof body.requireShift !== 'boolean') {
      throw new HttpError(400, 'requireShift must be a boolean');
    }
    payload.requireShift = body.requireShift;
  }

  return payload;
};

export const isSelfServiceAssistantManagerTaskLogMetaPayload = (body: unknown): boolean => {
  if (!isPlainObject(body)) {
    return false;
  }
  if (Object.keys(body).some((key) => !SELF_SERVICE_META_KEYS.has(key))) {
    return false;
  }
  if (!hasOwn(body, 'meta')) {
    return true;
  }
  if (!isPlainObject(body.meta)) {
    return false;
  }
  return Object.keys(body.meta).every((key) => SELF_SERVICE_NESTED_META_KEYS.has(key));
};

export const buildAssistantManagerTaskGenerationSourceKey = (
  templateId: number,
  userId: number,
  taskDate: string,
): string => `${templateId}:${userId}:${taskDate}`;

export const getManagerTaskOverrideSourceKey = (
  meta: Record<string, unknown> | null | undefined,
): string | null => {
  const marker = meta?.[MANAGER_TASK_OVERRIDE_META_KEY];
  if (!isPlainObject(marker)) {
    return null;
  }
  const sourceKey = marker.originalGenerationSourceKey;
  return typeof sourceKey === 'string' && GENERATION_SOURCE_KEY_PATTERN.test(sourceKey)
    ? sourceKey
    : null;
};

export const applyManagerTaskOverride = (
  meta: Record<string, unknown>,
  fallbackOriginalSourceKey: string,
  actorId: number | null,
  updatedAt = new Date().toISOString(),
): Record<string, unknown> => ({
  ...meta,
  [MANAGER_TASK_OVERRIDE_META_KEY]: {
    originalGenerationSourceKey:
      getManagerTaskOverrideSourceKey(meta) ?? fallbackOriginalSourceKey,
    updatedAt,
    updatedBy: actorId,
  } satisfies AssistantManagerTaskLogManagerOverride,
});
