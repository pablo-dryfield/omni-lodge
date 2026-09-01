export const SOCIAL_MEDIA_CONTENT_STATUSES = [
  "idea",
  "planned",
  "in_production",
  "ready",
  "published",
  "archived",
] as const;

export type SocialMediaContentStatus = (typeof SOCIAL_MEDIA_CONTENT_STATUSES)[number];
