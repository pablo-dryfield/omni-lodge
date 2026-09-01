export const DEFAULT_BADGE_CAMPAIGN_BASE_URL =
  "https://krawlthroughkrakow.com/store2/pub-crawl-28/#book";

const resolveBadgeCampaignBaseUrl = (value: string | null | undefined): URL => {
  try {
    const url = new URL(value?.trim() || DEFAULT_BADGE_CAMPAIGN_BASE_URL);
    if (url.protocol !== "https:") {
      throw new Error("Unsupported badge campaign URL protocol");
    }
    return url;
  } catch {
    return new URL(DEFAULT_BADGE_CAMPAIGN_BASE_URL);
  }
};

export const buildBadgeCampaignUrl = (
  baseUrl: string | null | undefined,
  sourceName: string,
): string => {
  const url = resolveBadgeCampaignBaseUrl(baseUrl);
  url.searchParams.set("utm_source", sourceName);
  url.searchParams.set("utm_medium", "Badge");
  url.searchParams.set("utm_campaign", "Staff");
  return url.toString();
};
