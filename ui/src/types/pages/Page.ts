export type Page = {
  id: number;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder: number;
  status: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: number | null;
  updatedBy?: number | null;
};
