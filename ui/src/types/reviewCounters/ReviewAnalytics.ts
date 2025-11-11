export type ReviewAnalyticsTimelineBucket = {
  key: string;
  label: string;
  startDate: string;
  totalReviews: number;
  badReviews: number;
  noNameReviews: number;
};

export type ReviewAnalyticsPlatform = {
  platform: string;
  totalReviews: number;
  badReviews: number;
  noNameReviews: number;
  counters: number;
};

export type ReviewAnalyticsContributor = {
  userId: number | null;
  displayName: string;
  rawCount: number;
  roundedCount: number;
  counters: number;
};

export type ReviewAnalyticsPayload = {
  range: {
    startDate: string;
    endDate: string;
    groupBy: 'day' | 'week' | 'month';
    platform: string | null;
  };
  totals: {
    totalReviews: number;
    badReviews: number;
    noNameReviews: number;
    counters: number;
    platforms: number;
    contributors: number;
  };
  platforms: ReviewAnalyticsPlatform[];
  timeline: ReviewAnalyticsTimelineBucket[];
  topContributors: ReviewAnalyticsContributor[];
};
