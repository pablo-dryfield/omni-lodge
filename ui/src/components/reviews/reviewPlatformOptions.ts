import type { ReviewPlatform } from '../../types/reviewPlatforms/ReviewPlatform';

export type ConfiguredReviewPlatform = Pick<ReviewPlatform, 'slug' | 'name' | 'isActive' | 'sourceKey' | 'aliases'>;

const ARCHIVE_LABELS: Record<string, string> = {
  google: 'Google', tripadvisor: 'TripAdvisor', airbnb: 'Airbnb', getyourguide: 'GetYourGuide', manual: 'Manual',
};
const normalized = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

// Imported archives already use these source IDs, even when the configured slug differs.
export const reviewPlatformValue = (platform: ConfiguredReviewPlatform): string => {
  if (platform.sourceKey?.trim()) return platform.sourceKey.trim().toLowerCase();
  const archiveKey = [platform.slug, platform.name, ...(platform.aliases ?? [])]
    .map(normalized).find((key) => key !== 'manual' && Boolean(ARCHIVE_LABELS[key]));
  return archiveKey ?? platform.slug.trim().toLowerCase();
};

const findPlatform = (value: string, platforms: ConfiguredReviewPlatform[]) => platforms.find((platform) =>
  [reviewPlatformValue(platform), platform.slug, platform.name, ...(platform.aliases ?? [])]
    .some((key) => normalized(key) === normalized(value)),
);

export const reviewPlatformLabel = (value: string, platforms: ConfiguredReviewPlatform[]): string =>
  value === 'manual' ? 'Manual' : findPlatform(value, platforms)?.name ?? ARCHIVE_LABELS[value] ?? value;

export const reviewPlatformOptions = (platforms: ConfiguredReviewPlatform[], currentValue?: string) => {
  const options = new Map<string, { value: string; label: string }>();
  platforms.filter((platform) => platform.isActive !== false).forEach((platform) => {
    const value = reviewPlatformValue(platform);
    if (value && value !== 'manual') options.set(value, { value, label: platform.name || platform.slug });
  });
  const result = [...options.values()].sort((a, b) => a.label.localeCompare(b.label));
  result.push({ value: 'manual', label: 'Manual / Other' });
  // Editing a historical entry must not silently relabel inactive/deleted/legacy platforms.
  if (currentValue && !result.some((option) => option.value === currentValue)) {
    const platform = findPlatform(currentValue, platforms);
    result.push({ value: currentValue, label: `${reviewPlatformLabel(currentValue, platforms)}${platform?.isActive === false ? ' (inactive)' : ''}` });
  }
  return result;
};
