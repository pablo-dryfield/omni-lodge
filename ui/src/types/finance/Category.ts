export type FinanceCategoryKind = 'income' | 'expense';

export interface FinanceCategory {
  id: number;
  kind: FinanceCategoryKind;
  name: string;
  parentId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

