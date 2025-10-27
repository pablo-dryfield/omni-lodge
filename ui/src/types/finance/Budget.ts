export interface FinanceBudget {
  id: number;
  period: string;
  categoryId: number;
  amountMinor: number;
  currency: string;
  createdAt: string;
  updatedAt: string | null;
}

