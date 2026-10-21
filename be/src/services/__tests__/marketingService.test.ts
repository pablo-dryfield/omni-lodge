jest.mock('../../models/Booking.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock('../../models/Product.js', () => ({ __esModule: true, default: {} }));
jest.mock('../configService.js', () => ({
  getConfigValue: jest.fn(() => null),
  refreshConfigCacheKeys: jest.fn(async () => undefined),
}));
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn(), isAxiosError: jest.fn(() => false) },
}));
jest.mock('googleapis', () => ({
  google: { auth: { OAuth2: jest.fn() } },
}));

import Booking from '../../models/Booking';
import axios from 'axios';
import { google } from 'googleapis';
import { getConfigValue, refreshConfigCacheKeys } from '../configService';
import { getMarketingOverview } from '../marketingService';

const bookingFindAll = Booking.findAll as jest.Mock;

describe('getMarketingOverview booking revenue recognition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bookingFindAll.mockResolvedValue([
      {
        id: 1,
        platformBookingId: 'BT-PENDING',
        platform: 'omnilodge',
        productName: 'Pub Crawl',
        product: null,
        guestFirstName: 'Pending',
        guestLastName: 'Guest',
        experienceDate: '2026-09-10',
        experienceStartAt: new Date('2026-09-10T19:00:00.000Z'),
        sourceReceivedAt: new Date('2026-09-07T10:00:00.000Z'),
        baseAmount: '100.00',
        currency: 'PLN',
        paymentStatus: 'unpaid',
        utmSource: 'Meta Ads',
        utmMedium: 'social',
        utmCampaign: 'September',
      },
      {
        id: 2,
        platformBookingId: 'LEGACY-UNKNOWN',
        platform: 'omnilodge',
        productName: 'Pub Crawl',
        product: null,
        guestFirstName: 'Legacy',
        guestLastName: 'Guest',
        experienceDate: '2026-09-10',
        experienceStartAt: new Date('2026-09-10T19:00:00.000Z'),
        sourceReceivedAt: new Date('2026-09-07T11:00:00.000Z'),
        baseAmount: '50.00',
        currency: 'PLN',
        paymentStatus: 'unknown',
        utmSource: 'Meta Ads',
        utmMedium: 'social',
        utmCampaign: 'September',
      },
    ]);
  });

  it('retains booking counts but zeros only explicit unpaid revenue', async () => {
    const overview = await getMarketingOverview('2026-09-07', '2026-09-07');

    expect(overview.overall.bookingCount).toBe(2);
    expect(overview.overall.revenueTotal).toBe(50);
    expect(overview.metaAds.bookingCount).toBe(2);
    expect(overview.metaAds.revenueTotal).toBe(50);
    expect(overview.metaAds.bookings).toEqual([
      expect.objectContaining({ platformBookingId: 'BT-PENDING', baseAmount: 0 }),
      expect.objectContaining({ platformBookingId: 'LEGACY-UNKNOWN', baseAmount: 50 }),
    ]);
    expect(bookingFindAll.mock.calls[0][0].attributes).toContain('paymentStatus');
  });
});

describe('Google Ads runtime API version and cost availability', () => {
  let apiVersion: string | null;
  let testNumber = 0;
  let date: string;
  const accessToken = jest.fn();
  const httpPost = axios.post as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    apiVersion = 'v26';
    date = `2026-10-${String(++testNumber).padStart(2, '0')}`;
    (getConfigValue as jest.Mock).mockImplementation((key: string) => {
      const values: Record<string, string | null> = {
        GOOGLE_ADS_API_VERSION: apiVersion,
        GOOGLE_CLIENT_ID: 'test-client',
        GOOGLE_CLIENT_SECRET: 'test-secret',
        GOOGLE_REFRESH_TOKEN: 'test-refresh',
        GOOGLE_ADS_DEVELOPER_TOKEN: 'test-developer-token',
        GOOGLE_ADS_CUSTOMER_ID: '123-456-7890',
        GOOGLE_ADS_LOGIN_CUSTOMER_ID: '999-888-7777',
      };
      return values[key] ?? null;
    });
    accessToken.mockResolvedValue({ token: 'test-access-token' });
    (google.auth.OAuth2 as unknown as jest.Mock).mockImplementation(() => ({
      setCredentials: jest.fn(),
      getAccessToken: accessToken,
    }));
    bookingFindAll.mockResolvedValue([{
      id: 3,
      platformBookingId: 'TEST-GOOGLE',
      platform: 'omnilodge',
      productName: 'Pub Crawl',
      product: null,
      guestFirstName: 'Test',
      guestLastName: 'Guest',
      sourceReceivedAt: new Date(`${date}T10:00:00Z`),
      baseAmount: '100.00',
      currency: 'PLN',
      paymentStatus: 'paid',
      utmSource: 'Google Ads',
      utmMedium: 'CPC',
      utmCampaign: 'Pub Crawl',
    }]);
    httpPost.mockImplementation(async (url: string, body: { query: string }) => {
      if (url.endsWith('googleAds:search')) {
        return { data: { results: [{ customer: { currencyCode: 'PLN' } }] } };
      }
      return { data: [{ results: [{
        campaign: { name: 'Pub Crawl' },
        ...(body.query.includes('FROM ad_group') ? { adGroup: { name: 'CPC' } } : {}),
        segments: { date },
        metrics: { costMicros: '12500000', clicks: '5', conversions: '1', conversionsValue: '100' },
      }] }] };
    });
  });

  it('uses v26 by default for currency, campaign and ad-group reports without double-counting spend', async () => {
    apiVersion = null;
    const overview = await getMarketingOverview(date, date);

    expect(refreshConfigCacheKeys).toHaveBeenCalledWith(['GOOGLE_ADS_API_VERSION']);
    expect(httpPost).toHaveBeenCalledTimes(3);
    httpPost.mock.calls.forEach(([url, , options]) => {
      expect(url).toMatch(/^https:\/\/googleads.googleapis.com\/v26\/customers\/1234567890\/googleAds:/);
      expect(options.headers['login-customer-id']).toBe('9998887777');
    });
    expect(overview.overall).toMatchObject({
      googleAdsCost: 12.5, googleCostCurrency: 'PLN', clickTotal: 5, revenueTotal: 100, costError: null,
    });
    expect(overview.googleAds).toMatchObject({ googleAdsCost: 12.5, costCurrency: 'PLN', costError: null });
  });

  it('reuses same-version reports but refreshes immediately after a Control Panel version change', async () => {
    const initial = await getMarketingOverview(date, date);
    expect(await getMarketingOverview(date, date)).toBe(initial);
    expect(httpPost).toHaveBeenCalledTimes(3);

    apiVersion = 'v25';
    await getMarketingOverview(date, date);
    expect(httpPost).toHaveBeenCalledTimes(6);
    expect(httpPost.mock.calls.slice(3).every(([url]) => url.includes('/v25/'))).toBe(true);
    expect(refreshConfigCacheKeys).toHaveBeenCalledTimes(3);

    apiVersion = 'v26';
    await getMarketingOverview(date, date);
    expect(httpPost).toHaveBeenCalledTimes(9);
  });

  it('pins every request in an in-flight report to its captured version', async () => {
    let releaseToken!: (value: { token: string }) => void;
    let notifyTokenStarted!: () => void;
    const tokenStarted = new Promise<void>((resolve) => { notifyTokenStarted = resolve; });
    accessToken.mockImplementationOnce(() => new Promise((resolve) => {
      releaseToken = resolve;
      notifyTokenStarted();
    }));
    const first = getMarketingOverview(date, date);
    // The first report is waiting for OAuth when the next request observes the saved change.
    await tokenStarted;
    apiVersion = 'v25';
    await getMarketingOverview(date, date);
    expect(httpPost.mock.calls.every(([url]) => url.includes('/v25/'))).toBe(true);

    releaseToken({ token: 'test-access-token' });
    await first;
    expect(httpPost.mock.calls.slice(3).every(([url]) => url.includes('/v26/'))).toBe(true);
    await getMarketingOverview(date, date);
    expect(httpPost).toHaveBeenCalledTimes(6);
  });

  it('returns unavailable costs and clicks, not zero, on Google Ads errors while retaining booking revenue', async () => {
    httpPost.mockRejectedValue(new Error('Version v22 is deprecated. Requests to this version will be blocked.'));
    const overview = await getMarketingOverview(date, date);

    for (const tab of [overview.overall, overview.googleAds]) {
      expect(tab).toMatchObject({ googleAdsCost: null, clickTotal: null, revenueTotal: 100 });
      expect(tab.costError).toContain('Version v22 is deprecated');
      expect(tab.sourceBreakdown[0]).toMatchObject({ revenue: 100, cost: null, clicks: null });
      expect(tab.dailySeries[0]).toMatchObject({ revenue: 100, cost: null, clicks: null, roas: null });
    }
    expect(overview.googleAds.googleCostRows).toEqual([]);
  });

  it('keeps a genuine zero distinct from failed cost retrieval', async () => {
    httpPost.mockResolvedValue({ data: [] });
    const overview = await getMarketingOverview(date, date);
    expect(overview.overall).toMatchObject({ googleAdsCost: 0, clickTotal: 0, costError: null });
    expect(overview.googleAds).toMatchObject({ googleAdsCost: 0, clickTotal: 0, costError: null });
  });

  it('rejects malformed runtime values before making any Google request', async () => {
    apiVersion = 'v26/customers/other';
    const overview = await getMarketingOverview(date, date);
    expect(overview.googleAds.costError).toContain('GOOGLE_ADS_API_VERSION');
    expect(overview.googleAds.googleAdsCost).toBeNull();
    expect(httpPost).not.toHaveBeenCalled();
    expect(accessToken).not.toHaveBeenCalled();
  });
});
