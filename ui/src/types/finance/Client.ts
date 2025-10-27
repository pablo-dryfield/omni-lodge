export interface FinanceClient {
  id: number;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  defaultCategoryId: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

