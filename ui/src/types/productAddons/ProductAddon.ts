export type ProductAddon = {
  id: number;
  productId: number;
  productName: string | null;
  addonId: number;
  addonName: string | null;
  maxPerAttendee: number | null;
  priceOverride: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
