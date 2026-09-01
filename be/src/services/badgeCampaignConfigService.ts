import { getConfigValue } from './configService.js';

export const BADGE_CAMPAIGN_BASE_URL_FALLBACK =
  'https://krawlthroughkrakow.com/store2/pub-crawl-28/#book';

const isSafeBadgeCampaignUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
};

export const resolveBadgeCampaignBaseUrl = (): string => {
  try {
    const configured = String(getConfigValue('BADGE_CAMPAIGN_BASE_URL') ?? '').trim();
    return isSafeBadgeCampaignUrl(configured)
      ? configured
      : BADGE_CAMPAIGN_BASE_URL_FALLBACK;
  } catch {
    return BADGE_CAMPAIGN_BASE_URL_FALLBACK;
  }
};

export const buildBadgeCampaignUrl = (sourceName: string): string => {
  const url = new URL(resolveBadgeCampaignBaseUrl());
  url.searchParams.set('utm_source', sourceName);
  url.searchParams.set('utm_medium', 'Badge');
  url.searchParams.set('utm_campaign', 'Staff');
  return url.toString();
};
