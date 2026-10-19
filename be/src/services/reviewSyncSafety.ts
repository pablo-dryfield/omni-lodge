type ReviewSyncDeletionSafetyInput = {
  platform: string;
  partial: boolean;
  seenCount: number;
  activeCount: number;
  sourceTotalCount?: number | null;
};

export const shouldBlockZeroSeenReviewSyncDeletion = ({
  partial,
  seenCount,
  activeCount,
}: ReviewSyncDeletionSafetyInput): boolean =>
  !partial && seenCount === 0 && activeCount > 0;

export const assertReviewSyncCanMarkMissingDeleted = (input: ReviewSyncDeletionSafetyInput): void => {
  if (!input.partial && input.platform === 'tripadvisor'
    && input.sourceTotalCount != null && Number.isFinite(input.sourceTotalCount)
    && input.seenCount < input.sourceTotalCount) {
    throw new Error(
      `Refusing to complete tripadvisor review sync: fetched ${input.seenCount} of ${input.sourceTotalCount} source reviews. No missing reviews were marked deleted.`,
    );
  }
  if (!shouldBlockZeroSeenReviewSyncDeletion(input)) {
    return;
  }

  throw new Error(
    `Refusing to complete ${input.platform} review sync with zero seen reviews because ${input.activeCount} active archived reviews already exist.`,
  );
};
