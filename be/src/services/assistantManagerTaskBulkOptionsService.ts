import HttpError from '../errors/HttpError.js';

export type AssistantManagerTaskBulkOptions = {
  requireShift?: boolean;
  requireSocialMediaPlan?: boolean;
  completionWindowMode?: 'day' | 'strict';
  priority?: 'high' | 'medium' | 'low';
  notifyAtStart?: boolean;
  scheduledWorkdayPlacement?: 'start' | 'middle' | 'end';
  requiredShiftTemplateIds?: number[];
};

export type AssistantManagerTaskBulkOptionsPayload = {
  templateIds: number[];
  options: AssistantManagerTaskBulkOptions;
};

const MAX_TEMPLATE_IDS = 500;
const BODY_KEYS = new Set(['templateIds', 'options']);
const OPTION_KEYS = new Set<keyof AssistantManagerTaskBulkOptions>([
  'requireShift',
  'requireSocialMediaPlan',
  'completionWindowMode',
  'priority',
  'notifyAtStart',
  'scheduledWorkdayPlacement',
  'requiredShiftTemplateIds',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const parsePositiveIntegerIds = (
  value: unknown,
  fieldName: string,
  { allowEmpty, maxLength }: { allowEmpty: boolean; maxLength?: number },
): number[] => {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} must be an array`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new HttpError(400, `${fieldName} must contain at least one id`);
  }
  if (maxLength != null && value.length > maxLength) {
    throw new HttpError(400, `${fieldName} cannot contain more than ${maxLength} ids`);
  }
  if (!value.every((item) => typeof item === 'number' && Number.isInteger(item) && item > 0)) {
    throw new HttpError(400, `${fieldName} must contain only positive integer ids`);
  }

  const ids = value as number[];
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, `${fieldName} cannot contain duplicate ids`);
  }
  return [...ids];
};

export const parseAssistantManagerTaskBulkOptionsPayload = (
  body: unknown,
): AssistantManagerTaskBulkOptionsPayload => {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'Request body must be an object');
  }

  const unknownBodyKey = Object.keys(body).find((key) => !BODY_KEYS.has(key));
  if (unknownBodyKey) {
    throw new HttpError(400, `Unknown request field: ${unknownBodyKey}`);
  }

  const templateIds = parsePositiveIntegerIds(body.templateIds, 'templateIds', {
    allowEmpty: false,
    maxLength: MAX_TEMPLATE_IDS,
  });

  if (!isPlainObject(body.options)) {
    throw new HttpError(400, 'options must be an object');
  }

  const optionKeys = Object.keys(body.options);
  if (optionKeys.length === 0) {
    throw new HttpError(400, 'At least one option is required');
  }
  const unknownOptionKey = optionKeys.find(
    (key) => !OPTION_KEYS.has(key as keyof AssistantManagerTaskBulkOptions),
  );
  if (unknownOptionKey) {
    throw new HttpError(400, `Unknown option: ${unknownOptionKey}`);
  }

  const options: AssistantManagerTaskBulkOptions = {};
  if (hasOwn(body.options, 'requireShift')) {
    if (typeof body.options.requireShift !== 'boolean') {
      throw new HttpError(400, 'options.requireShift must be a boolean');
    }
    options.requireShift = body.options.requireShift;
  }
  if (hasOwn(body.options, 'requireSocialMediaPlan')) {
    if (typeof body.options.requireSocialMediaPlan !== 'boolean') {
      throw new HttpError(400, 'options.requireSocialMediaPlan must be a boolean');
    }
    options.requireSocialMediaPlan = body.options.requireSocialMediaPlan;
  }
  if (hasOwn(body.options, 'completionWindowMode')) {
    if (body.options.completionWindowMode !== 'day' && body.options.completionWindowMode !== 'strict') {
      throw new HttpError(400, 'options.completionWindowMode must be day or strict');
    }
    options.completionWindowMode = body.options.completionWindowMode;
  }
  if (hasOwn(body.options, 'priority')) {
    if (
      body.options.priority !== 'high' &&
      body.options.priority !== 'medium' &&
      body.options.priority !== 'low'
    ) {
      throw new HttpError(400, 'options.priority must be high, medium, or low');
    }
    options.priority = body.options.priority;
  }
  if (hasOwn(body.options, 'notifyAtStart')) {
    if (typeof body.options.notifyAtStart !== 'boolean') {
      throw new HttpError(400, 'options.notifyAtStart must be a boolean');
    }
    options.notifyAtStart = body.options.notifyAtStart;
  }
  if (hasOwn(body.options, 'scheduledWorkdayPlacement')) {
    if (
      body.options.scheduledWorkdayPlacement !== 'start' &&
      body.options.scheduledWorkdayPlacement !== 'middle' &&
      body.options.scheduledWorkdayPlacement !== 'end'
    ) {
      throw new HttpError(400, 'options.scheduledWorkdayPlacement must be start, middle, or end');
    }
    options.scheduledWorkdayPlacement = body.options.scheduledWorkdayPlacement;
  }
  if (hasOwn(body.options, 'requiredShiftTemplateIds')) {
    options.requiredShiftTemplateIds = parsePositiveIntegerIds(
      body.options.requiredShiftTemplateIds,
      'options.requiredShiftTemplateIds',
      { allowEmpty: true },
    );
  }

  return { templateIds, options };
};

export const mergeAssistantManagerTaskBulkOptions = (
  currentScheduleConfig: Record<string, unknown> | null | undefined,
  options: AssistantManagerTaskBulkOptions,
): Record<string, unknown> => {
  const scheduleConfig = { ...(currentScheduleConfig ?? {}) };

  if (options.requireShift !== undefined) {
    scheduleConfig.requireShift = options.requireShift;
    delete scheduleConfig.requireScheduledShift;
    delete scheduleConfig.allowOffDays;
  }
  if (options.requireSocialMediaPlan !== undefined) {
    scheduleConfig.requireSocialMediaPlan = options.requireSocialMediaPlan;
  }
  if (options.completionWindowMode !== undefined) {
    scheduleConfig.completionWindowMode = options.completionWindowMode;
  }
  if (options.priority !== undefined) {
    scheduleConfig.priority = options.priority;
  }
  if (options.notifyAtStart !== undefined) {
    scheduleConfig.notifyAtStart = options.notifyAtStart;
  }
  if (options.scheduledWorkdayPlacement !== undefined) {
    scheduleConfig.scheduledWorkdayPlacement = options.scheduledWorkdayPlacement;
  }
  if (options.requiredShiftTemplateIds !== undefined) {
    if (options.requiredShiftTemplateIds.length > 0) {
      scheduleConfig.requiredShiftTemplateIds = [...options.requiredShiftTemplateIds];
    } else {
      delete scheduleConfig.requiredShiftTemplateIds;
    }
  }

  return scheduleConfig;
};
