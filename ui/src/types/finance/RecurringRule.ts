export type FinanceRecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type FinanceRecurringStatus = 'active' | 'paused';

export interface FinanceRecurringRule {
  id: number;
  kind: 'income' | 'expense';
  templateJson: Record<string, unknown>;
  frequency: FinanceRecurringFrequency;
  interval: number;
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  nextRunDate: string | null;
  lastRunAt: string | null;
  status: FinanceRecurringStatus;
  createdBy: number;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string | null;
}

