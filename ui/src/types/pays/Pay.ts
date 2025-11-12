export type PayBreakdown = {
  date: string;
  commission: number;
  customers: number;
  guidesCount: number;
  counterId?: number;
  productId?: number | null;
  productName?: string;
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
  productTotals?: Array<{
    productId: number | null;
    productName: string;
    counterIds: number[];
    totalCustomers: number;
    totalCommission: number;
    componentTotals: Array<{ componentId: number; amount: number }>;
  }>;
  counterIncentiveMarkers?: Record<string, string[]>;
  breakdown: PayBreakdown[];
};
