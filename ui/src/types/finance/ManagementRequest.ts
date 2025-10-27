export type FinanceManagementRequestStatus = 'open' | 'approved' | 'returned' | 'rejected';
export type FinanceManagementRequestPriority = 'low' | 'normal' | 'high';

export interface FinanceManagementRequest {
  id: number;
  type: string;
  targetEntity: string;
  targetId: number | null;
  payload: Record<string, unknown>;
  requestedBy: number;
  status: FinanceManagementRequestStatus;
  managerId: number | null;
  decisionNote: string | null;
  priority: FinanceManagementRequestPriority;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

