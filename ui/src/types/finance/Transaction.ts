import { FinanceAccount } from './Account';
import { FinanceCategory } from './Category';
import { FinanceClient } from './Client';
import { FinanceVendor } from './Vendor';
import { FinanceFile } from './File';

export type FinanceTransactionKind = 'income' | 'expense' | 'transfer' | 'refund';
export type FinanceTransactionStatus = 'planned' | 'approved' | 'paid' | 'reimbursed' | 'void';
export type FinanceTransactionCounterpartyType = 'vendor' | 'client' | 'none';

export interface FinanceTransaction {
  id: number;
  kind: FinanceTransactionKind;
  date: string;
  accountId: number;
  currency: string;
  amountMinor: number;
  fxRate: string;
  baseAmountMinor: number;
  categoryId: number | null;
  counterpartyType: FinanceTransactionCounterpartyType;
  counterpartyId: number | null;
  paymentMethod: string | null;
  status: FinanceTransactionStatus;
  description: string | null;
  tags: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  invoiceFileId: number | null;
  createdBy: number;
  approvedBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  account?: FinanceAccount;
  category?: FinanceCategory | null;
  vendor?: FinanceVendor | null;
  client?: FinanceClient | null;
  invoiceFile?: FinanceFile | null;
}

export interface FinanceTransactionListResponse {
  data: FinanceTransaction[];
  meta: {
    count: number;
    limit: number;
    offset: number;
  };
}

