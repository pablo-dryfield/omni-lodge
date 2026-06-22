import axiosInstance from "../utils/axiosInstance";

export type AffiliateUserSummary = {
  id: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  userTypeId: number | null;
  userTypeSlug: string | null;
  userTypeName: string | null;
};

export type AffiliateAssignmentRule = {
  id: string;
  userId: number;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  notes: string | null;
};

export type AffiliateBooking = {
  id: number;
  platformBookingId: string;
  platform: string;
  productName: string | null;
  guestName: string;
  experienceDate: string | null;
  sourceReceivedAt: string | null;
  baseAmount: number;
  currency: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  affiliateUserId: number | null;
  affiliateUserName: string | null;
  affiliateRuleId: string | null;
};

export type AffiliateDailySeriesPoint = {
  date: string;
  bookingCount: number;
  revenue: number;
};

export type AffiliateBreakdownRow = {
  label: string;
  bookingCount: number;
  revenue: number;
};

export type AffiliateTagRow = {
  value: string;
  bookingCount: number;
  revenue: number;
};

export type AffiliateOverviewResponse = {
  startDate: string;
  endDate: string;
  selectedAffiliateUserId: number | null;
  currentUser: {
    id: number;
    roleSlug: string | null;
    canManageAssignments: boolean;
  };
  affiliateUsers: AffiliateUserSummary[];
  assignments: {
    rules: AffiliateAssignmentRule[];
  };
  summary: {
    bookingCount: number;
    revenueTotal: number;
    matchedAffiliateCount: number;
    unassignedBookingCount: number;
    affiliateCount: number;
  };
  dailySeries: AffiliateDailySeriesPoint[];
  affiliateBreakdown: Array<{
    userId: number;
    userName: string;
    bookingCount: number;
    revenue: number;
  }>;
  sourceBreakdown: AffiliateBreakdownRow[];
  mediumBreakdown: AffiliateBreakdownRow[];
  campaignBreakdown: AffiliateBreakdownRow[];
  discoveredTags: {
    utmSource: AffiliateTagRow[];
    utmMedium: AffiliateTagRow[];
    utmCampaign: AffiliateTagRow[];
  };
  unassignedTags: {
    utmSource: AffiliateTagRow[];
    utmMedium: AffiliateTagRow[];
    utmCampaign: AffiliateTagRow[];
  };
  utmCatalog: {
    utmSource: string[];
    utmMedium: string[];
    utmCampaign: string[];
  };
  bookings: AffiliateBooking[];
};

export const fetchAffiliateOverview = async (
  startDate: string,
  endDate: string,
  affiliateUserId?: number | null,
): Promise<AffiliateOverviewResponse> => {
  const response = await axiosInstance.get<AffiliateOverviewResponse>("/affiliates/overview", {
    params: {
      startDate,
      endDate,
      ...(affiliateUserId ? { affiliateUserId } : {}),
    },
  });
  return response.data;
};

export const saveAffiliateAssignments = async (rules: AffiliateAssignmentRule[]): Promise<AffiliateOverviewResponse["assignments"]> => {
  const response = await axiosInstance.put<{ rules: AffiliateAssignmentRule[] }>("/affiliates/assignments", {
    rules,
  });
  return response.data;
};
