export type FinanceAccountType = 'cash' | 'bank' | 'stripe' | 'revolut' | 'other';

export interface FinanceAccount {
  id: number;
  name: string;
  type: FinanceAccountType;
  currency: string;
  accountHolderName: string | null;
  accountNumber: string | null;
  swiftCode: string | null;
  bankName: string | null;
  bankTransferInstructions: string | null;
  openingBalanceMinor: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}
