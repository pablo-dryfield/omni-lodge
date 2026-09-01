jest.mock('../configService.js', () => ({
  getConfigValue: jest.fn(),
}));

import { getConfigValue } from '../configService';
import {
  BADGE_CAMPAIGN_BASE_URL_FALLBACK,
  buildBadgeCampaignUrl,
  resolveBadgeCampaignBaseUrl,
} from '../badgeCampaignConfigService';

const mockedGetConfigValue = getConfigValue as jest.MockedFunction<typeof getConfigValue>;

describe('badge campaign configuration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the configured public HTTPS destination', () => {
    mockedGetConfigValue.mockReturnValue('https://store.example.com/pub-crawl#booking');

    expect(resolveBadgeCampaignBaseUrl()).toBe(
      'https://store.example.com/pub-crawl#booking',
    );
  });

  it.each([
    null,
    '',
    '/relative-store',
    'http://store.example.com/pub-crawl',
    'https://user:password@store.example.com/pub-crawl',
    'not a URL',
  ])('falls back safely when the configured value is %p', (configured) => {
    mockedGetConfigValue.mockReturnValue(configured);

    expect(resolveBadgeCampaignBaseUrl()).toBe(BADGE_CAMPAIGN_BASE_URL_FALLBACK);
  });

  it('falls back safely if configuration lookup fails', () => {
    mockedGetConfigValue.mockImplementation(() => {
      throw new Error('configuration unavailable');
    });

    expect(resolveBadgeCampaignBaseUrl()).toBe(BADGE_CAMPAIGN_BASE_URL_FALLBACK);
  });

  it('adds campaign parameters before the configured fragment', () => {
    mockedGetConfigValue.mockReturnValue(
      'https://krawlthroughkrakow.com/store2/pub-crawl-28/#book',
    );

    const campaignUrl = buildBadgeCampaignUrl('Aimee_28');
    const parsed = new URL(campaignUrl);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://krawlthroughkrakow.com/store2/pub-crawl-28/',
    );
    expect(parsed.searchParams.get('utm_source')).toBe('Aimee_28');
    expect(parsed.searchParams.get('utm_medium')).toBe('Badge');
    expect(parsed.searchParams.get('utm_campaign')).toBe('Staff');
    expect(parsed.hash).toBe('#book');
    expect(campaignUrl.indexOf('?')).toBeLessThan(campaignUrl.indexOf('#book'));
  });
});
