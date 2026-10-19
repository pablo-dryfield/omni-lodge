import { reviewPlatformLabel, reviewPlatformOptions, type ConfiguredReviewPlatform } from './reviewPlatformOptions';

const platforms: ConfiguredReviewPlatform[] = [
  { name: 'FreeTour', slug: 'freetour', isActive: true },
  { name: 'Civitatis', slug: 'civitatis', isActive: true },
  { name: 'GetYourGuide', slug: 'reviews-from-getyourguide', isActive: true },
  { name: 'Future platform', slug: 'future-platform', isActive: true },
  { name: 'Retired', slug: 'retired', isActive: false },
];

describe('configured review platform choices', () => {
  it('includes every active configured platform and Manual / Other, without a fixed source list', () => {
    expect(reviewPlatformOptions(platforms)).toEqual([
      { value: 'civitatis', label: 'Civitatis' },
      { value: 'freetour', label: 'FreeTour' },
      { value: 'future-platform', label: 'Future platform' },
      { value: 'getyourguide', label: 'GetYourGuide' },
      { value: 'manual', label: 'Manual / Other' },
    ]);
  });

  it('uses a configured source key and deduplicates choices for one imported source', () => {
    expect(reviewPlatformOptions([
      { name: 'Custom reviews', slug: 'custom-reviews', sourceKey: 'custom', isActive: true },
      { name: 'Other label', slug: 'other-label', sourceKey: 'custom', isActive: true },
    ])).toEqual([{ value: 'custom', label: 'Other label' }, { value: 'manual', label: 'Manual / Other' }]);
  });

  it('preserves inactive, deleted and historical slug values when editing, but not for new entries', () => {
    expect(reviewPlatformOptions(platforms, 'retired')).toContainEqual({ value: 'retired', label: 'Retired (inactive)' });
    expect(reviewPlatformOptions(platforms, 'deleted-source')).toContainEqual({ value: 'deleted-source', label: 'deleted-source' });
    expect(reviewPlatformOptions(platforms, 'reviews-from-getyourguide')).toContainEqual({ value: 'reviews-from-getyourguide', label: 'GetYourGuide' });
    expect(reviewPlatformOptions(platforms).some((option) => option.value === 'retired')).toBe(false);
  });

  it('labels both archive IDs and configured slugs without changing existing records', () => {
    expect(reviewPlatformLabel('getyourguide', platforms)).toBe('GetYourGuide');
    expect(reviewPlatformLabel('reviews-from-getyourguide', platforms)).toBe('GetYourGuide');
    expect(reviewPlatformLabel('freetour', platforms)).toBe('FreeTour');
    expect(reviewPlatformLabel('manual', platforms)).toBe('Manual');
  });

  it('does not invent configured choices when none are available', () => {
    expect(reviewPlatformOptions([])).toEqual([{ value: 'manual', label: 'Manual / Other' }]);
  });
});
