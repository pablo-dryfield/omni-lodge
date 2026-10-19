import {
  assertReviewSyncCanMarkMissingDeleted,
  shouldBlockZeroSeenReviewSyncDeletion,
} from '../reviewSyncSafety.js';

describe('review sync deletion safety', () => {
  it('blocks a full sync from deleting active archive rows when the source unexpectedly returns zero reviews', () => {
    const input = {
      platform: 'tripadvisor',
      partial: false,
      seenCount: 0,
      activeCount: 40,
    };

    expect(shouldBlockZeroSeenReviewSyncDeletion(input)).toBe(true);
    expect(() => assertReviewSyncCanMarkMissingDeleted(input))
      .toThrow('Refusing to complete tripadvisor review sync with zero seen reviews because 40 active archived reviews already exist.');
  });

  it('allows partial syncs to complete without destructive deletion', () => {
    expect(shouldBlockZeroSeenReviewSyncDeletion({
      platform: 'tripadvisor',
      partial: true,
      seenCount: 0,
      activeCount: 40,
    })).toBe(false);
  });

  it('allows a full sync with source reviews', () => {
    expect(shouldBlockZeroSeenReviewSyncDeletion({
      platform: 'tripadvisor',
      partial: false,
      seenCount: 20,
      activeCount: 40,
    })).toBe(false);
  });

  it('refuses deletion marking when TripAdvisor pagination stops before the reported total', () => {
    expect(() => assertReviewSyncCanMarkMissingDeleted({
      platform: 'tripadvisor', partial: false, seenCount: 2500, activeCount: 3038, sourceTotalCount: 3038,
    })).toThrow('fetched 2500 of 3038');
  });

  it('accepts a completed TripAdvisor archive and leaves partial syncs non-destructive', () => {
    for (const input of [
      { partial: false, seenCount: 3038 },
      { partial: true, seenCount: 20 },
    ]) {
      expect(() => assertReviewSyncCanMarkMissingDeleted({
        platform: 'tripadvisor', activeCount: 3038, sourceTotalCount: 3038, ...input,
      })).not.toThrow();
    }
  });
});
