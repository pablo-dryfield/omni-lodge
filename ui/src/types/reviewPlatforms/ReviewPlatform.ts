export type ReviewPlatform = {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};
