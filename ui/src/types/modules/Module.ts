export type Module = {
  id: number;
  pageId: number;
  slug: string;
  name: string;
  description?: string | null;
  componentRef?: string | null;
  sortOrder: number;
  status: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: number | null;
  updatedBy?: number | null;
};
