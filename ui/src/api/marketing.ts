import axiosInstance from "../utils/axiosInstance";

export type MarketingSource = "Google Ads" | "Meta Ads";

export type MarketingBooking = {
  id: number;
  platformBookingId: string;
  platform: string;
  productName: string | null;
  guestName: string;
  experienceDate: string | null;
  experienceStartAt: string | null;
  sourceReceivedAt: string | null;
  baseAmount: number;
  currency: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  marketingSource: MarketingSource | null;
};

export type MarketingBreakdownRow = {
  label: string;
  bookingCount: number;
  revenue: number;
  cost: number | null;
};

export type MarketingDailySeriesPoint = {
  date: string;
  bookingCount: number;
  revenue: number;
  cost: number | null;
  roas: number | null;
};

export type MarketingTabData = {
  bookingCount: number;
  revenueTotal: number;
  revenueCurrency: string | null;
  sourceBreakdown: MarketingBreakdownRow[];
  mediumBreakdown: MarketingBreakdownRow[];
  campaignBreakdown: MarketingBreakdownRow[];
  dailySeries: MarketingDailySeriesPoint[];
  bookings: MarketingBooking[];
};

export type GoogleCostRow = {
  campaign: string;
  medium: string;
  cost: number;
};

export type MarketingOverviewResponse = {
  startDate: string;
  endDate: string;
  overall: MarketingTabData & {
    googleAdsCost: number;
    googleCostCurrency: string | null;
  };
  googleAds: MarketingTabData & {
    googleAdsCost: number;
    costCurrency: string | null;
    costError: string | null;
    googleCostRows: GoogleCostRow[];
  };
  metaAds: MarketingTabData;
};

export const fetchMarketingOverview = async (startDate: string, endDate: string): Promise<MarketingOverviewResponse> => {
  const response = await axiosInstance.get<MarketingOverviewResponse>("/marketing/overview", {
    params: { startDate, endDate },
  });
  return response.data;
};
