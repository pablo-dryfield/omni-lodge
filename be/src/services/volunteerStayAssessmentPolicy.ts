export type AssessmentScope = { startDate: string; endDate: string };
export type StayReview = AssessmentScope & {
  vote: 'up' | 'down'; feedback: string; actorId: number; updatedAt: string;
};
export type StayWaiver = AssessmentScope & {
  reason: string; actorId: number; updatedAt: string;
};
export type StayAssessment = {
  reviews?: Record<string, StayReview>;
  reviewerWaivers?: Record<string, StayWaiver>;
  cleaningWaiver?: StayWaiver | null;
  fallback?: StayReview | null;
};

export const inAssessmentScope = <T extends AssessmentScope>(value: T | null | undefined, scope: AssessmentScope): value is T =>
  Boolean(value && value.startDate === scope.startDate && value.endDate === scope.endDate);

/** One vote per person; waived reviewers do not become positive votes. */
export const evaluateStayAssessment = (reviewerIds: number[], saved: StayAssessment | null | undefined, scope: AssessmentScope) => {
  const reviewers = [...new Set(reviewerIds)].map((userId) => {
    const waiver = saved?.reviewerWaivers?.[String(userId)];
    const review = saved?.reviews?.[String(userId)];
    return {
      userId,
      waiver: inAssessmentScope(waiver, scope) ? waiver : null,
      review: inAssessmentScope(review, scope) && review.actorId === userId ? review : null,
    };
  });
  const required = reviewers.filter((row) => !row.waiver);
  const pendingCount = required.filter((row) => !row.review).length;
  const upCount = required.filter((row) => row.review?.vote === 'up').length;
  const downCount = required.filter((row) => row.review?.vote === 'down').length;
  const fallback = required.length === 0 && inAssessmentScope(saved?.fallback, scope) ? saved!.fallback! : null;
  const earned = required.length > 0
    ? pendingCount === 0 && upCount + downCount > 0 && upCount >= downCount
    : fallback?.vote === 'up';
  return { reviewers, pendingCount, upCount, downCount, waivedCount: reviewers.length - required.length,
    fallback, earned: Boolean(earned), needsFallback: required.length === 0 && !fallback };
};
