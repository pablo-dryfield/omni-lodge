export type Addon = {
  id: number;
  name: string;
  basePrice: number | null;
  taxRate: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
