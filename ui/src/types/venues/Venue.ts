export type Venue = {
  id: number;
  name: string;
  sortOrder: number;
  allowsOpenBar: boolean;
  isActive: boolean;
  financeVendorId: number | null;
  financeClientId: number | null;
  createdAt: string;
  updatedAt: string | null;
};
