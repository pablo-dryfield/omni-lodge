export type ReviewCounterEntry = {
  id: number;
  counterId: number;
  userId: number | null;
  displayName: string;
  category: 'staff' | 'bad' | 'no_name' | 'other';
  rawCount: number;
  roundedCount: number;
  notes: string | null;
  meta: Record<string, unknown>;
  userName: string | null;
};

export type ReviewCounter = {
  id: number;
  platform: string;
  periodStart: string;
  periodEnd: string | null;
  totalReviews: number;
  firstReviewAuthor?: string | null;
  secondReviewAuthor?: string | null;
  beforeLastReviewAuthor?: string | null;
  lastReviewAuthor?: string | null;
  badReviewCount: number;
  noNameReviewCount: number;
  notes?: string | null;
  meta: Record<string, unknown>;
  entries: ReviewCounterEntry[];
  createdByName?: string | null;
  updatedByName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type ReviewCounterPayload = {
  platform: string;
  periodStart: string;
  periodEnd?: string | null;
  totalReviews?: number;
  firstReviewAuthor?: string | null;
  secondReviewAuthor?: string | null;
  beforeLastReviewAuthor?: string | null;
  lastReviewAuthor?: string | null;
  badReviewCount?: number;
  noNameReviewCount?: number;
  notes?: string | null;
};

export type ReviewCounterEntryPayload = {
  userId?: number | null;
  displayName: string;
  category?: ReviewCounterEntry['category'];
  rawCount: number;
  notes?: string | null;
};
