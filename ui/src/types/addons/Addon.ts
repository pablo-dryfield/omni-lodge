export type Addon = {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number | null;
  taxRate: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
