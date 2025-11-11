export type ReviewPlatform = {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  isActive: boolean;
  weight?: number | string;
  sourceKey?: string | null;
  platformUrl?: string | null;
  aliases?: string[];
  createdAt?: string;
  updatedAt?: string;
};
