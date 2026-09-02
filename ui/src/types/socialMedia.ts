export const SOCIAL_MEDIA_CONTENT_STATUSES = [
  "idea",
  "planned",
  "in_production",
  "ready",
  "published",
  "archived",
] as const;

export type SocialMediaContentStatus = (typeof SOCIAL_MEDIA_CONTENT_STATUSES)[number];

export const SOCIAL_MEDIA_ASSET_KINDS = [
  "final_video",
  "raw_material",
  "project_file",
] as const;

export type SocialMediaAssetKind = (typeof SOCIAL_MEDIA_ASSET_KINDS)[number];

export type SocialMediaContentAsset = {
  id: number;
  contentId: number;
  kind: SocialMediaAssetKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  webViewUrl: string | null;
  uploadedBy: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SocialMediaTaskCompletion = {
  taskLogId: number;
  userId: number;
  taskDate: string;
  status: string;
};
