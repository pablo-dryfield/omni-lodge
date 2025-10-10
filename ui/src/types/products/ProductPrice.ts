export type ProductPrice = {
  id: number;
  productId: number;
  price: number;
  validFrom: string;
  validTo: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  productName?: string | null;
  createdByName?: string | null;
  updatedByName?: string | null;
};
