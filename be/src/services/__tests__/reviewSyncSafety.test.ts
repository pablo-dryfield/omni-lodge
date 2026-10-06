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
});
