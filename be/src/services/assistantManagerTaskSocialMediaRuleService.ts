import HttpError from '../errors/HttpError.js';

export const SOCIAL_MEDIA_PLAN_CONFIG_KEY = 'requireSocialMediaPlan';
export const SOCIAL_MEDIA_AUTO_COMPLETE_ON_PUBLISH_CONFIG_KEY =
  'completeOnSocialMediaPublish';
export const SOCIAL_MEDIA_CONTENT_ID_META_KEY = 'socialMediaContentId';
export const SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY = 'socialMediaContentSnapshot';

export type SocialMediaContentStatus =
  | 'idea'
  | 'planned'
  | 'in_production'
  | 'ready'
  | 'published'
  | 'archived';

export type AssistantManagerTaskSocialMediaContentRecord = {
  id: number;
  title: string;
  status: SocialMediaContentStatus;
  targetPlatforms?: unknown;
  scheduledAt?: Date | string | null;
  thumbnailUrl?: string | null;
};

export type AssistantManagerTaskSocialMediaContentSnapshot = {
  id: number;
  title: string;
  status: SocialMediaContentStatus;
  platforms: string[];
  scheduledAt: string | null;
  thumbnailUrl: string | null;
};

const TASK_READY_SOCIAL_MEDIA_STATUSES = new Set<SocialMediaContentStatus>([
  'planned',
  'in_production',
  'ready',
  'published',
]);

const normalizePlatforms = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean),
    ),
  );
};

const normalizeScheduledAt = (value: Date | string | null | undefined): string | null => {
  if (value == null || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};

export const parseSocialMediaContentId = (
  value: unknown,
  fieldName = SOCIAL_MEDIA_CONTENT_ID_META_KEY,
): number | null => {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive integer or null`);
  }
  return value;
};

export const getStoredSocialMediaContentId = (
  meta: Record<string, unknown> | null | undefined,
): number | null => {
  const value = meta?.[SOCIAL_MEDIA_CONTENT_ID_META_KEY];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
};

export const resolveRequireSocialMediaPlan = (
  meta: Record<string, unknown> | null | undefined,
  scheduleConfig: Record<string, unknown> | null | undefined,
): boolean => {
  const snapshottedValue = meta?.[SOCIAL_MEDIA_PLAN_CONFIG_KEY];
  if (typeof snapshottedValue === 'boolean') {
    return snapshottedValue;
  }
  return scheduleConfig?.[SOCIAL_MEDIA_PLAN_CONFIG_KEY] === true;
};

export const normalizeCompleteOnSocialMediaPublish = (value: unknown): boolean =>
  value === true;

export const resolveCompleteOnSocialMediaPublish = (
  meta: Record<string, unknown> | null | undefined,
  scheduleConfig: Record<string, unknown> | null | undefined,
): boolean => {
  const snapshottedValue = meta?.[SOCIAL_MEDIA_AUTO_COMPLETE_ON_PUBLISH_CONFIG_KEY];
  if (typeof snapshottedValue === 'boolean') {
    return snapshottedValue;
  }
  return normalizeCompleteOnSocialMediaPublish(
    scheduleConfig?.[SOCIAL_MEDIA_AUTO_COMPLETE_ON_PUBLISH_CONFIG_KEY],
  );
};

const hasRequiredEvidenceRule = (value: unknown): boolean => {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return true;
    }
    const rule = entry as Record<string, unknown>;
    const minItems = Number(rule.minItems ?? (rule.required === false ? 0 : 1));
    return rule.required !== false || (Number.isFinite(minItems) && minItems > 0);
  });
};

/**
 * Keeps publish-driven completion safe: the publication itself is the only
 * completion proof, so it cannot bypass a strict time window or required
 * evidence configured on the task.
 */
export const normalizeAndValidateSocialMediaPublishAutomationConfig = (
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  const scheduleConfig = { ...(value ?? {}) };
  if (scheduleConfig[SOCIAL_MEDIA_AUTO_COMPLETE_ON_PUBLISH_CONFIG_KEY] !== true) {
    return scheduleConfig;
  }

  const completionWindowMode =
    typeof scheduleConfig.completionWindowMode === 'string'
      ? scheduleConfig.completionWindowMode.trim().toLowerCase()
      : 'day';
  if (completionWindowMode !== 'day') {
    throw new HttpError(
      400,
      'Automatic Social Media publish completion requires the End of day completion window',
    );
  }
  if (hasRequiredEvidenceRule(scheduleConfig.evidenceRules)) {
    throw new HttpError(
      400,
      'Automatic Social Media publish completion cannot be used with required evidence rules',
    );
  }
  if (
    Array.isArray(scheduleConfig.shiftEvidenceSources) &&
    scheduleConfig.shiftEvidenceSources.length > 0
  ) {
    throw new HttpError(
      400,
      'Automatic Social Media publish completion cannot be used with shift-based evidence',
    );
  }

  // A publish-completed log must always be linked to the Social Media item
  // whose publication will complete it.
  scheduleConfig[SOCIAL_MEDIA_PLAN_CONFIG_KEY] = true;
  return scheduleConfig;
};

export const assertManualSocialMediaPublishTaskCompletionAllowed = (
  meta: Record<string, unknown> | null | undefined,
  scheduleConfig: Record<string, unknown> | null | undefined,
): void => {
  if (resolveCompleteOnSocialMediaPublish(meta, scheduleConfig)) {
    throw new HttpError(
      400,
      'This task completes automatically when its linked Social Media content is published',
    );
  }
};

export const isSocialMediaContentTaskReady = (status: unknown): boolean =>
  typeof status === 'string' &&
  TASK_READY_SOCIAL_MEDIA_STATUSES.has(status as SocialMediaContentStatus);

export const buildAssistantManagerTaskSocialMediaSnapshot = (
  content: AssistantManagerTaskSocialMediaContentRecord,
): AssistantManagerTaskSocialMediaContentSnapshot => ({
  id: content.id,
  title: content.title.trim(),
  status: content.status,
  platforms: normalizePlatforms(content.targetPlatforms),
  scheduledAt: normalizeScheduledAt(content.scheduledAt),
  thumbnailUrl:
    typeof content.thumbnailUrl === 'string' && content.thumbnailUrl.trim()
      ? content.thumbnailUrl.trim()
      : null,
});

export const getStoredSocialMediaSnapshot = (
  meta: Record<string, unknown> | null | undefined,
): AssistantManagerTaskSocialMediaContentSnapshot | null => {
  const value = meta?.[SOCIAL_MEDIA_CONTENT_SNAPSHOT_META_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const id = getStoredSocialMediaContentId({
    [SOCIAL_MEDIA_CONTENT_ID_META_KEY]: source.id,
  });
  const title = typeof source.title === 'string' ? source.title.trim() : '';
  const status = typeof source.status === 'string' ? source.status : '';
  if (!id || !title || ![
    'idea',
    'planned',
    'in_production',
    'ready',
    'published',
    'archived',
  ].includes(status)) {
    return null;
  }

  return {
    id,
    title,
    status: status as SocialMediaContentStatus,
    platforms: normalizePlatforms(source.platforms),
    scheduledAt:
      typeof source.scheduledAt === 'string' && source.scheduledAt.trim()
        ? source.scheduledAt.trim()
        : null,
    thumbnailUrl:
      typeof source.thumbnailUrl === 'string' && source.thumbnailUrl.trim()
        ? source.thumbnailUrl.trim()
        : null,
  };
};

export const requireTaskReadySocialMediaContent = async (
  options: {
    required: boolean;
    linkedContentId: number | null;
    loadContent: (
      id: number,
    ) => Promise<AssistantManagerTaskSocialMediaContentRecord | null>;
  },
): Promise<AssistantManagerTaskSocialMediaContentSnapshot | null> => {
  if (!options.required) {
    return null;
  }
  if (!options.linkedContentId) {
    throw new HttpError(
      400,
      'Link a Social Media plan before completing this task',
    );
  }

  const content = await options.loadContent(options.linkedContentId);
  if (!content) {
    throw new HttpError(
      400,
      'The linked Social Media plan no longer exists. Choose another plan before completing this task',
    );
  }
  if (!isSocialMediaContentTaskReady(content.status)) {
    throw new HttpError(
      400,
      content.status === 'idea'
        ? 'Develop the linked Social Media idea into a planned post before completing this task'
        : 'The linked Social Media plan is archived. Choose an active plan before completing this task',
    );
  }

  return buildAssistantManagerTaskSocialMediaSnapshot(content);
};
