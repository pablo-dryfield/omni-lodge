export type StorefrontAddonSelectionMode = "boolean" | "quantity" | "options";

export type StorefrontAddonOption = {
  value: string;
  label: string;
  price?: number;
};

export type StorefrontAddonConfig = {
  selectionMode?: StorefrontAddonSelectionMode;
  allowedQuantities?: number[];
  quantityPrices?: Record<string, number>;
  options?: StorefrontAddonOption[];
};

export type ProductAddon = {
  id: number;
  productId: number;
  productName: string | null;
  addonId: number;
  addonName: string | null;
  maxPerAttendee: number | null;
  priceOverride: number | null;
  sortOrder: number;
  storefrontConfig: StorefrontAddonConfig;
  createdAt: string;
  updatedAt: string;
};
