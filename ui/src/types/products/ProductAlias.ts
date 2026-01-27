export type ProductAlias = {
  id: number;
  productId: number | null;
  label: string;
  normalizedLabel: string;
  matchType: 'exact' | 'contains' | 'regex';
  priority: number;
  active: boolean;
  hitCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  source: string | null;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  productName?: string | null;
};
