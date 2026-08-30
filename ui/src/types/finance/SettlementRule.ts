export type SettlementRuleTargetScope = "global" | "staff_type" | "user";

export type SettlementRuleMatchKind =
  | "default"
  | "component"
  | "component_category"
  | "system_source";

export type SettlementDestination = "staff_vendor" | "volunteer_fund" | "excluded";

export type SettlementSpecialSource = "promotion_sales" | "reimbursement";

export interface FinanceSettlementRule {
  id: number;
  targetScope: SettlementRuleTargetScope;
  staffType: string | null;
  userId: number | null;
  userName?: string | null;
  matchKind: SettlementRuleMatchKind;
  matchKey: string | null;
  componentId: number | null;
  componentName?: string | null;
  destination: SettlementDestination;
  fundId: number | null;
  fundName?: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  isActive: boolean;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type FinanceSettlementRulePayload = {
  targetScope: SettlementRuleTargetScope;
  staffType?: string | null;
  userId?: number | null;
  matchKind: SettlementRuleMatchKind;
  matchKey?: string | null;
  componentId?: number | null;
  destination: SettlementDestination;
  fundId?: number | null;
  effectiveStart?: string | null;
  effectiveEnd?: string | null;
  isActive?: boolean;
};

export type FinanceSettlementRuleBulkPayload = {
  ruleIds: number[];
  changes: Pick<FinanceSettlementRulePayload, "destination" | "fundId"> &
    Partial<Pick<FinanceSettlementRulePayload, "effectiveStart" | "effectiveEnd" | "isActive">>;
};

export type FinanceSettlementRuleListResponse = {
  rules: FinanceSettlementRule[];
};
