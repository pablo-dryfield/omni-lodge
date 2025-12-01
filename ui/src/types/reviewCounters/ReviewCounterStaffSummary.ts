export type ReviewCounterPlatformSummary = {
  counterId: number;
  platform: string;
  rawCount: number;
  roundedCount: number;
  needsMinimum: boolean;
  underMinimumApproved: boolean;
};

export type ReviewCounterMonthlyApprovalStatus = {
  approved: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
};

export type ReviewCounterStaffRow = {
  userId: number;
  displayName: string;
  totalReviews: number;
  totalRoundedReviews: number;
  needsMinimum: boolean;
  pendingPlatformApprovals: boolean;
  allPlatformsApproved: boolean;
  eligibleForIncentive: boolean;
  canApprovePayment: boolean;
  canApproveIncentive: boolean;
  paymentApproval: ReviewCounterMonthlyApprovalStatus;
  incentiveApproval: ReviewCounterMonthlyApprovalStatus;
  platforms: ReviewCounterPlatformSummary[];
};

export type ReviewCounterStaffSummary = {
  periodStart: string;
  periodEnd: string;
  minimumReviews: number;
  staff: ReviewCounterStaffRow[];
};
