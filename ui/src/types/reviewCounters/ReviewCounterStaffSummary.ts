export type ReviewCounterPlatformSummary = {
  counterId: number;
  platform: string;
  rawCount: number;
  roundedCount: number;
};

export type ReviewCounterMonthlyApprovalStatus = {
  approved: boolean;
  approvedAt: string | null;
  approvedByName: string | null;
};

export type ReviewCompensationComponent = {
  componentId: number;
  name: string;
  scope: string;
};

export type ReviewCounterStaffRow = {
  userId: number;
  displayName: string;
  totalReviews: number;
  totalRoundedReviews: number;
  needsMinimum: boolean;
  eligibleForIncentive: boolean;
  canApproveIncentive: boolean;
  paymentApproval: ReviewCounterMonthlyApprovalStatus;
  incentiveApproval: ReviewCounterMonthlyApprovalStatus;
  platforms: ReviewCounterPlatformSummary[];
  reviewComponents: ReviewCompensationComponent[];
};

export type ReviewCounterStaffSummary = {
  periodStart: string;
  periodEnd: string;
  minimumReviews: number;
  staff: ReviewCounterStaffRow[];
};
