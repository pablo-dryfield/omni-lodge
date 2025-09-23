export type PayBreakdown = {
  date: string;
  commission: number;
  customers: number;
  guidesCount: number;
};

export type Pay = {
  firstName: string;
  totalCommission: number;
  breakdown: PayBreakdown[];
};
