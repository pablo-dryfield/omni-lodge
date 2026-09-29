export type PubCrawlGuidingReviewTargetCandidate = {
  staffType: string | null | undefined;
  livesInAccom: boolean | null | undefined;
  userTypeSlug: string | null | undefined;
  userTypeName: string | null | undefined;
  reviewPaymentOverride: boolean | null | undefined;
  totalEligibleReviews: number | null | undefined;
  minReviews: number;
};

const normalizeBusinessLabel = (value: string | null | undefined): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const isLongTermStaffProfile = (staffType: string | null | undefined): boolean => {
  const normalized = String(staffType ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return normalized === 'long_term';
};

export const isPubCrawlGuideUserType = (params: {
  userTypeSlug: string | null | undefined;
  userTypeName: string | null | undefined;
}): boolean => {
  const slug = normalizeBusinessLabel(params.userTypeSlug);
  const name = normalizeBusinessLabel(params.userTypeName);
  return slug === 'pubcrawlguide'
    || slug === 'pubcrawlguides'
    || name === 'pubcrawlguide'
    || name === 'pubcrawlguides';
};

export const isPubCrawlGuidingComponentName = (
  value: string | null | undefined,
): boolean => normalizeBusinessLabel(value) === 'pubcrawlguiding';

export const shouldRoutePubCrawlGuidingToVolunteerBudget = (
  candidate: PubCrawlGuidingReviewTargetCandidate,
): boolean => {
  if (!isLongTermStaffProfile(candidate.staffType)) {
    return false;
  }
  if (candidate.livesInAccom !== true) {
    return false;
  }
  if (!isPubCrawlGuideUserType(candidate)) {
    return false;
  }
  if (candidate.reviewPaymentOverride === true) {
    return false;
  }

  const minReviews = Math.max(1, Math.floor(candidate.minReviews));
  const totalEligibleReviews = Math.max(0, Number(candidate.totalEligibleReviews ?? 0));
  return totalEligibleReviews < minReviews;
};
