import type { FinanceAccount, FinanceCategory } from '../finance';

type FinanceAccountSummary = Pick<FinanceAccount, 'id' | 'name' | 'type' | 'currency'>;
type FinanceCategorySummary = Pick<FinanceCategory, 'id' | 'name' | 'kind' | 'parentId'>;

export type CompensationComponentAssignment = {
  id: number;
  componentId: number;
  targetScope: 'global' | 'shift_role' | 'user' | 'user_type' | 'staff_type';
  shiftRoleId: number | null;
  shiftRoleName?: string | null;
  userId: number | null;
  userName?: string | null;
  userTypeId: number | null;
  userTypeName?: string | null;
  staffType: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  baseAmount: number;
  unitAmount: number;
  unitLabel: string | null;
  currencyCode: string;
  taskList: Array<Record<string, unknown>>;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CompensationComponent = {
  id: number;
  name: string;
  slug: string;
  category: 'base' | 'commission' | 'incentive' | 'bonus' | 'review' | 'deduction' | 'adjustment';
  calculationMethod: 'flat' | 'per_unit' | 'tiered' | 'percentage' | 'task_score' | 'hybrid' | 'night_report';
  description?: string | null;
  config: Record<string, unknown>;
  currencyCode: string;
  defaultFinanceAccountId?: number | null;
  defaultFinanceAccount?: FinanceAccountSummary | null;
  defaultFinanceCategoryId?: number | null;
  defaultFinanceCategory?: FinanceCategorySummary | null;
  isActive: boolean;
  assignments: CompensationComponentAssignment[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CompensationComponentPayload = {
  name: string;
  slug?: string;
  category: CompensationComponent['category'];
  calculationMethod: CompensationComponent['calculationMethod'];
  description?: string | null;
  config?: Record<string, unknown>;
  currencyCode?: string;
  isActive?: boolean;
  defaultFinanceAccountId?: number | null;
  defaultFinanceCategoryId?: number | null;
};

export type CompensationComponentAssignmentPayload = {
  targetScope: CompensationComponentAssignment['targetScope'];
  shiftRoleId?: number | null;
  userId?: number | null;
  userTypeId?: number | null;
  staffType?: string | null;
  effectiveStart?: string | null;
  effectiveEnd?: string | null;
  baseAmount?: number;
  unitAmount?: number;
  unitLabel?: string | null;
  currencyCode?: string;
  taskList?: Array<Record<string, unknown>>;
  config?: Record<string, unknown>;
  isActive?: boolean;
};
