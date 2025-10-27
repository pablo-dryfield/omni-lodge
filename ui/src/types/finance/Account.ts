export type FinanceAccountType = 'cash' | 'bank' | 'stripe' | 'revolut' | 'other';

export interface FinanceAccount {
  id: number;
  name: string;
  type: FinanceAccountType;
  currency: string;
  openingBalanceMinor: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

