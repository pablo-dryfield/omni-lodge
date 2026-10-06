type ReviewSyncDeletionSafetyInput = {
  platform: string;
  partial: boolean;
  seenCount: number;
  activeCount: number;
};

export const shouldBlockZeroSeenReviewSyncDeletion = ({
  partial,
  seenCount,
  activeCount,
}: ReviewSyncDeletionSafetyInput): boolean =>
  !partial && seenCount === 0 && activeCount > 0;

export const assertReviewSyncCanMarkMissingDeleted = (input: ReviewSyncDeletionSafetyInput): void => {
  if (!shouldBlockZeroSeenReviewSyncDeletion(input)) {
    return;
  }

  throw new Error(
    `Refusing to complete ${input.platform} review sync with zero seen reviews because ${input.activeCount} active archived reviews already exist.`,
  );
};
