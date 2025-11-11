export type PayBreakdown = {
  date: string;
  commission: number;
  customers: number;
  guidesCount: number;
};

export type PayComponentSummary = {
  componentId: number;
  name: string;
  category: string;
  calculationMethod: string;
  amount: number;
};

export type Pay = {
  userId?: number;
  firstName: string;
  totalCommission: number;
  totalPayout?: number;
  totalCustomers?: number;
  bucketTotals?: Record<string, number>;
  componentTotals?: PayComponentSummary[];
  breakdown: PayBreakdown[];
};
