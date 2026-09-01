import type { FinanceTransaction } from './Transaction';
import type { FinanceAccount } from './Account';
import type { FinanceCategory } from './Category';
import type { FinanceClient } from './Client';
import type { FinanceVendor } from './Vendor';

export type FinanceRecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type FinanceRecurringStatus = 'active' | 'paused' | 'completed';

export interface FinanceRecurringTemplate {
  kind: 'income' | 'expense';
  accountId: number;
  currency: string;
  amountMinor: number;
  categoryId: number;
  counterpartyType: 'vendor' | 'client';
  counterpartyId: number;
  status: 'planned';
  description: string | null;
  [key: string]: unknown;
}

export interface FinanceRecurringRule {
  id: number;
  kind: 'income' | 'expense';
  templateJson: FinanceRecurringTemplate | Record<string, unknown>;
  frequency: FinanceRecurringFrequency;
  interval: number;
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  nextRunDate: string | null;
  lastRunAt: string | null;
  status: FinanceRecurringStatus;
  completedAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
  consecutiveFailures?: number;
  createdBy: number;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface FinanceRecurringOccurrenceListResponse {
  data: FinanceTransaction[];
  meta: {
    count: number;
    limit: number;
    offset: number;
  };
}

export interface FinanceRecurringBootstrapResponse {
  rules: FinanceRecurringRule[];
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  vendors: FinanceVendor[];
  clients: FinanceClient[];
}

export interface FinanceRecurringExecutionFailure {
  ruleId: number;
  message: string;
}

export interface FinanceRecurringExecutionResult {
  processed: number;
  createdTransactions: number;
  skipped: number;
  failed: number;
  completed: number;
  deferred: number;
  failures: FinanceRecurringExecutionFailure[];
}
