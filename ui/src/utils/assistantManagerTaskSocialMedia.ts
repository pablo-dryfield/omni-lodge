export type AmTaskSocialMediaContentOption = {
  id: number;
  title: string;
  status: 'idea' | 'planned' | 'in_production' | 'ready' | 'published' | 'archived';
  platforms: string[];
  scheduledAt: string | null;
  thumbnailUrl: string | null;
  isTaskReady: boolean;
};

type RawAmTaskSocialMediaContentOption = Omit<
  AmTaskSocialMediaContentOption,
  'platforms'
> & {
  platforms?: unknown;
  targetPlatforms?: unknown;
};

const SOCIAL_MEDIA_CONTENT_STATUSES = new Set<AmTaskSocialMediaContentOption['status']>([
  'idea',
  'planned',
  'in_production',
  'ready',
  'published',
  'archived',
]);

export const adaptAmTaskSocialMediaContentOption = (
  value: unknown,
): AmTaskSocialMediaContentOption | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Partial<RawAmTaskSocialMediaContentOption>;
  if (
    typeof source.id !== 'number' ||
    !Number.isInteger(source.id) ||
    source.id <= 0 ||
    typeof source.title !== 'string' ||
    !source.title.trim() ||
    typeof source.status !== 'string' ||
    !SOCIAL_MEDIA_CONTENT_STATUSES.has(source.status as AmTaskSocialMediaContentOption['status'])
  ) {
    return null;
  }
  const rawPlatforms = Array.isArray(source.targetPlatforms)
    ? source.targetPlatforms
    : Array.isArray(source.platforms)
      ? source.platforms
      : [];
  return {
    id: source.id,
    title: source.title.trim(),
    status: source.status as AmTaskSocialMediaContentOption['status'],
    platforms: Array.from(
      new Set(
        rawPlatforms
          .map((platform) => (typeof platform === 'string' ? platform.trim() : ''))
          .filter(Boolean),
      ),
    ),
    scheduledAt:
      typeof source.scheduledAt === 'string' && source.scheduledAt.trim()
        ? source.scheduledAt.trim()
        : null,
    thumbnailUrl:
      typeof source.thumbnailUrl === 'string' && source.thumbnailUrl.trim()
        ? source.thumbnailUrl.trim()
        : null,
    isTaskReady: source.isTaskReady === true,
  };
};
