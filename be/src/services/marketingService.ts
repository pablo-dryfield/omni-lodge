import axios from 'axios';
import dayjs from 'dayjs';
import { google } from 'googleapis';
import { Op } from 'sequelize';
import Booking from '../models/Booking.js';
import Product from '../models/Product.js';
import { getConfigValue } from './configService.js';

type MarketingSource = 'Google Ads' | 'Meta Ads';

type BookingRow = {
  id: number;
  platformBookingId: string;
  platform: string;
  productName: string | null;
  guestName: string;
  experienceDate: string | null;
  experienceStartAt: Date | null;
  sourceReceivedAt: Date | null;
  baseAmount: number;
  currency: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  marketingSource: MarketingSource | null;
};

type BreakdownRow = {
  label: string;
  bookingCount: number;
  revenue: number;
  cost: number | null;
};

type MarketingMetricRow = {
  date: string;
  marketingSource: MarketingSource;
  medium: string | null;
  campaign: string | null;
  bookingCount: number;
  revenue: number;
};

type DailySeriesPoint = {
  date: string;
  bookingCount: number;
  revenue: number;
  cost: number | null;
  roas: number | null;
};

type TabData = {
  bookingCount: number;
  revenueTotal: number;
  revenueCurrency: string | null;
  sourceBreakdown: BreakdownRow[];
  mediumBreakdown: BreakdownRow[];
  campaignBreakdown: BreakdownRow[];
  dailySeries: DailySeriesPoint[];
  bookings: BookingRow[];
};

type GoogleCostRow = {
  campaign: string;
  medium: string;
  cost: number;
};

type GoogleCampaignCostRow = {
  campaign: string;
  cost: number;
};

type GoogleAdsPerformanceRow = {
  campaign: string;
  medium: string | null;
  date: string;
  cost: number;
  bookingCount: number;
  revenue: number;
};

type GoogleCostResult = {
  currency: string | null;
  rows: GoogleCostRow[];
  campaignRows: GoogleCampaignCostRow[];
  performanceRows: GoogleAdsPerformanceRow[];
  mediumPerformanceRows: GoogleAdsPerformanceRow[];
  dailyRows: Array<{ date: string; cost: number }>;
  error: string | null;
};

type GoogleAdsStreamResult = {
  campaign?: { name?: string | null } | null;
  adGroup?: { name?: string | null } | null;
  segments?: { date?: string | null } | null;
  metrics?: {
    costMicros?: string | number | null;
    conversions?: string | number | null;
    conversionsValue?: string | number | null;
  } | null;
};

type GoogleAdsStreamChunk = {
  results?: GoogleAdsStreamResult[] | null;
};

type MarketingOverview = {
  startDate: string;
  endDate: string;
  overall: TabData & {
    googleAdsCost: number;
    googleCostCurrency: string | null;
  };
  googleAds: TabData & {
    googleAdsCost: number;
    costCurrency: string | null;
    costError: string | null;
    googleCostRows: GoogleCostRow[];
  };
  metaAds: TabData;
};

const GOOGLE_ADS_SOURCE_LABEL = 'Google Ads';
const META_ADS_SOURCE_LABEL = 'Meta Ads';
const GOOGLE_ADS_API_VERSION = 'v22';
const GOOGLE_ADS_BOOKING_DATA_CUTOFF_DATE = '2026-02-28';
const GOOGLE_ADS_NON_REVENUE_CAMPAIGN_PREFIXES = ['smart campaign'];
const GOOGLE_ADS_MEDIUM_LEFTOVER_IGNORE_THRESHOLD = 0.01;

const parseAmount = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildGuestName = (firstName: string | null, lastName: string | null): string => {
  const parts = [normalizeText(firstName), normalizeText(lastName)].filter(Boolean);
  return parts.join(' ');
};

const normalizeMarketingSource = (value: string | null): MarketingSource | null => {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return null;
  }
  if (normalized === 'google ads') {
    return GOOGLE_ADS_SOURCE_LABEL;
  }
  if (normalized === 'meta ads') {
    return META_ADS_SOURCE_LABEL;
  }
  return null;
};

const shouldIgnoreGoogleAdsConversionValue = (campaign: string | null): boolean => {
  const normalized = campaign?.trim().toLowerCase() ?? '';
  if (!normalized) {
    return false;
  }
  return GOOGLE_ADS_NON_REVENUE_CAMPAIGN_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const buildPairKey = (campaign: string | null, medium: string | null): string | null => {
  const normalizedCampaign = normalizeText(campaign);
  const normalizedMedium = normalizeText(medium);
  if (!normalizedCampaign || !normalizedMedium) {
    return null;
  }
  return `${normalizedCampaign}\u0000${normalizedMedium}`;
};

const formatBreakdownLabel = (value: string | null): string => value ?? '(missing)';

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const roundMetricCount = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const aggregateCostByLabel = (
  rows: GoogleCostRow[],
  selector: (row: GoogleCostRow) => string | null,
): Map<string, number> => {
  const map = new Map<string, number>();

  rows.forEach((row) => {
    const label = formatBreakdownLabel(selector(row));
    map.set(label, roundMoney((map.get(label) ?? 0) + row.cost));
  });

  return map;
};

const aggregateCampaignCostByLabel = (
  rows: GoogleCampaignCostRow[],
  selector: (row: GoogleCampaignCostRow) => string | null,
): Map<string, number> => {
  const map = new Map<string, number>();

  rows.forEach((row) => {
    const label = formatBreakdownLabel(selector(row));
    map.set(label, roundMoney((map.get(label) ?? 0) + row.cost));
  });

  return map;
};

const buildDateList = (startDate: string, endDate: string): string[] => {
  const dates: string[] = [];
  let cursor = dayjs(startDate);
  const last = dayjs(endDate);

  while (cursor.isBefore(last, 'day') || cursor.isSame(last, 'day')) {
    dates.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }

  return dates;
};

const buildDailySeries = (
  metricRows: MarketingMetricRow[],
  startDate: string,
  endDate: string,
  costByDate?: Map<string, number>,
): DailySeriesPoint[] => {
  const revenueByDate = new Map<string, { bookingCount: number; revenue: number }>();

  metricRows.forEach((metricRow) => {
    const date = normalizeText(metricRow.date);
    if (!date) {
      return;
    }
    const entry = revenueByDate.get(date) ?? { bookingCount: 0, revenue: 0 };
    entry.bookingCount += metricRow.bookingCount;
    entry.revenue += metricRow.revenue;
    revenueByDate.set(date, entry);
  });

  return buildDateList(startDate, endDate).map((date) => {
    const revenueEntry = revenueByDate.get(date) ?? { bookingCount: 0, revenue: 0 };
    const rawCost = costByDate?.get(date);
    const cost = typeof rawCost === 'number' ? roundMoney(rawCost) : null;
    const revenue = roundMoney(revenueEntry.revenue);

    return {
      date,
      bookingCount: roundMetricCount(revenueEntry.bookingCount),
      revenue,
      cost,
      roas: typeof cost === 'number' && cost > 0 ? roundMoney(revenue / cost) : null,
    };
  });
};

const buildBreakdown = (
  metricRows: MarketingMetricRow[],
  selector: (metricRow: MarketingMetricRow) => string | null,
  costByLabel?: Map<string, number>,
): BreakdownRow[] => {
  const map = new Map<string, { bookingCount: number; revenue: number; cost: number | null }>();

  metricRows.forEach((metricRow) => {
    const label = formatBreakdownLabel(selector(metricRow));
    const entry = map.get(label) ?? { bookingCount: 0, revenue: 0, cost: null };
    entry.bookingCount += metricRow.bookingCount;
    entry.revenue += metricRow.revenue;
    map.set(label, entry);
  });

  costByLabel?.forEach((cost, label) => {
    const entry = map.get(label) ?? { bookingCount: 0, revenue: 0, cost: null };
    entry.cost = roundMoney(cost);
    map.set(label, entry);
  });

  return Array.from(map.entries())
    .map(([label, entry]) => ({
      label,
      bookingCount: roundMetricCount(entry.bookingCount),
      revenue: roundMoney(entry.revenue),
      cost: entry.cost,
    }))
    .sort((left, right) => {
      const leftPrimary = left.cost ?? left.revenue;
      const rightPrimary = right.cost ?? right.revenue;
      if (rightPrimary !== leftPrimary) {
        return rightPrimary - leftPrimary;
      }
      if (right.revenue !== left.revenue) {
        return right.revenue - left.revenue;
      }
      return left.label.localeCompare(right.label);
    });
};

const detectRevenueCurrency = (bookings: BookingRow[]): string | null => {
  const currencies = Array.from(
    new Set(bookings.map((booking) => normalizeText(booking.currency)).filter((value): value is string => Boolean(value))),
  );
  return currencies.length === 1 ? currencies[0] : null;
};

const buildMetricRowsFromBookings = (bookings: BookingRow[], options: { excludeHistoricalGoogleAds?: boolean } = {}): MarketingMetricRow[] =>
  bookings
    .map((booking) => {
      const date = normalizeText(booking.experienceDate);
      if (!date || !booking.marketingSource) {
        return null;
      }
      if (
        options.excludeHistoricalGoogleAds &&
        booking.marketingSource === GOOGLE_ADS_SOURCE_LABEL &&
        dayjs(date).isBefore(dayjs(GOOGLE_ADS_BOOKING_DATA_CUTOFF_DATE), 'day')
      ) {
        return null;
      }
      return {
        date,
        marketingSource: booking.marketingSource,
        medium: booking.utmMedium,
        campaign: booking.utmCampaign,
        bookingCount: 1,
        revenue: booking.baseAmount,
      };
    })
    .filter((row): row is MarketingMetricRow => Boolean(row));

const buildHistoricalGoogleMetricRows = (performanceRows: GoogleAdsPerformanceRow[]): MarketingMetricRow[] =>
  performanceRows
    .filter((row) => dayjs(row.date).isBefore(dayjs(GOOGLE_ADS_BOOKING_DATA_CUTOFF_DATE), 'day'))
    .map((row) => ({
      date: row.date,
      marketingSource: GOOGLE_ADS_SOURCE_LABEL,
      medium: row.medium,
      campaign: row.campaign,
      bookingCount: row.bookingCount,
      revenue: row.revenue,
    }));

const buildHistoricalGoogleMediumMetricRows = (
  mediumPerformanceRows: GoogleAdsPerformanceRow[],
  campaignPerformanceRows: GoogleAdsPerformanceRow[],
): MarketingMetricRow[] => {
  const historicalMediumRows = buildHistoricalGoogleMetricRows(mediumPerformanceRows);
  const adGroupTotalsByCampaignDate = new Map<string, { bookingCount: number; revenue: number }>();

  mediumPerformanceRows
    .filter((row) => dayjs(row.date).isBefore(dayjs(GOOGLE_ADS_BOOKING_DATA_CUTOFF_DATE), 'day'))
    .forEach((row) => {
      const key = `${row.campaign}\u0000${row.date}`;
      const current = adGroupTotalsByCampaignDate.get(key) ?? { bookingCount: 0, revenue: 0 };
      current.bookingCount += row.bookingCount;
      current.revenue += row.revenue;
      adGroupTotalsByCampaignDate.set(key, current);
    });

  campaignPerformanceRows
    .filter((row) => dayjs(row.date).isBefore(dayjs(GOOGLE_ADS_BOOKING_DATA_CUTOFF_DATE), 'day'))
    .forEach((row) => {
      const key = `${row.campaign}\u0000${row.date}`;
      const adGroupTotals = adGroupTotalsByCampaignDate.get(key) ?? { bookingCount: 0, revenue: 0 };
      const missingBookingCount = roundMetricCount(row.bookingCount - adGroupTotals.bookingCount);
      const missingRevenue = roundMoney(row.revenue - adGroupTotals.revenue);
      if (Math.abs(missingBookingCount) < 0.005 && Math.abs(missingRevenue) < 0.005) {
        return;
      }
      historicalMediumRows.push({
        date: row.date,
        marketingSource: GOOGLE_ADS_SOURCE_LABEL,
        medium: null,
        campaign: row.campaign,
        bookingCount: missingBookingCount,
        revenue: missingRevenue,
      });
    });

  return historicalMediumRows;
};

const buildMediumCostByLabel = (
  adGroupRows: GoogleCostRow[],
  campaignRows: GoogleCampaignCostRow[],
): Map<string, number> => {
  const byMedium = aggregateCostByLabel(adGroupRows, (row) => row.medium);
  const adGroupCostByCampaign = new Map<string, number>();
  const campaignCostByCampaign = new Map<string, number>();

  adGroupRows.forEach((row) => {
    adGroupCostByCampaign.set(row.campaign, roundMoney((adGroupCostByCampaign.get(row.campaign) ?? 0) + row.cost));
  });

  campaignRows.forEach((row) => {
    campaignCostByCampaign.set(row.campaign, roundMoney((campaignCostByCampaign.get(row.campaign) ?? 0) + row.cost));
  });

  campaignCostByCampaign.forEach((campaignCost, campaign) => {
    const adGroupCost = adGroupCostByCampaign.get(campaign) ?? 0;
    const missingCost = roundMoney(campaignCost - adGroupCost);
    if (Math.abs(missingCost) <= GOOGLE_ADS_MEDIUM_LEFTOVER_IGNORE_THRESHOLD) {
      return;
    }
    byMedium.set(formatBreakdownLabel(null), roundMoney((byMedium.get(formatBreakdownLabel(null)) ?? 0) + missingCost));
  });

  return byMedium;
};

const buildTabData = (
  bookings: BookingRow[],
  totalMetricRows: MarketingMetricRow[],
  startDate: string,
  endDate: string,
  options: {
    sourceCostByLabel?: Map<string, number>;
    mediumCostByLabel?: Map<string, number>;
    campaignCostByLabel?: Map<string, number>;
    dailyCostByDate?: Map<string, number>;
    revenueCurrencyFallback?: string | null;
    mediumMetricRows?: MarketingMetricRow[];
  } = {},
): TabData => {
  const mediumMetricRows = options.mediumMetricRows ?? totalMetricRows;
  const bookingCount = roundMetricCount(totalMetricRows.reduce((sum, metricRow) => sum + metricRow.bookingCount, 0));
  const revenueTotal = roundMoney(totalMetricRows.reduce((sum, metricRow) => sum + metricRow.revenue, 0));

  return {
    bookingCount,
    revenueTotal,
    revenueCurrency: detectRevenueCurrency(bookings) ?? options.revenueCurrencyFallback ?? null,
    sourceBreakdown: buildBreakdown(totalMetricRows, (metricRow) => metricRow.marketingSource, options.sourceCostByLabel),
    mediumBreakdown: buildBreakdown(mediumMetricRows, (metricRow) => metricRow.medium, options.mediumCostByLabel),
    campaignBreakdown: buildBreakdown(totalMetricRows, (metricRow) => metricRow.campaign, options.campaignCostByLabel),
    dailySeries: buildDailySeries(totalMetricRows, startDate, endDate, options.dailyCostByDate),
    bookings,
  };
};

const buildOauthClient = () => {
  const clientId = normalizeText(getConfigValue('GOOGLE_CLIENT_ID') as string | null);
  const clientSecret = normalizeText(getConfigValue('GOOGLE_CLIENT_SECRET') as string | null);
  const refreshToken = normalizeText(getConfigValue('GOOGLE_REFRESH_TOKEN') as string | null);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth credentials are not configured');
  }

  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
};

const resolveGoogleAdsSettings = (): {
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
} => {
  const developerToken = normalizeText(getConfigValue('GOOGLE_ADS_DEVELOPER_TOKEN') as string | null);
  const customerIdRaw = normalizeText(getConfigValue('GOOGLE_ADS_CUSTOMER_ID') as string | null);
  const loginCustomerIdRaw = normalizeText(getConfigValue('GOOGLE_ADS_LOGIN_CUSTOMER_ID') as string | null);

  if (!developerToken || !customerIdRaw) {
    throw new Error('Google Ads settings are not configured');
  }

  const customerId = customerIdRaw.replace(/\D+/g, '');
  const normalizedLoginCustomerId = loginCustomerIdRaw ? loginCustomerIdRaw.replace(/\D+/g, '') : null;
  if (!customerId) {
    throw new Error('Google Ads customer ID is invalid');
  }

  return {
    developerToken,
    customerId,
    loginCustomerId:
      normalizedLoginCustomerId && normalizedLoginCustomerId !== customerId ? normalizedLoginCustomerId : null,
  };
};

const extractGoogleAdsErrorMessage = (error: unknown): string => {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : 'Unable to load Google Ads costs';
  }

  const requestId = normalizeText(error.response?.headers?.['request-id']);
  const details = Array.isArray(error.response?.data?.error?.details) ? error.response?.data?.error?.details : [];
  const nestedMessages = details.flatMap((detail: unknown) => {
    if (!detail || typeof detail !== 'object') {
      return [];
    }
    const errors = Array.isArray((detail as { errors?: unknown }).errors)
      ? ((detail as { errors?: unknown[] }).errors ?? [])
      : [];
    return errors
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        return normalizeText((entry as { message?: unknown }).message);
      })
      .filter((value): value is string => Boolean(value));
  });

  const baseMessage =
    nestedMessages.length > 0
      ? nestedMessages.join(' | ')
      : normalizeText(error.response?.data?.error?.message) ?? error.message;

  return requestId ? `${baseMessage} (request-id: ${requestId})` : baseMessage;
};

const fetchGoogleAdsCurrency = async (
  accessToken: string,
  settings: { developerToken: string; customerId: string; loginCustomerId: string | null },
): Promise<string | null> => {
  const response = await axios.post(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${settings.customerId}/googleAds:search`,
    {
      query: 'SELECT customer.currency_code FROM customer LIMIT 1',
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': settings.developerToken,
        ...(settings.loginCustomerId ? { 'login-customer-id': settings.loginCustomerId } : {}),
      },
      timeout: 15000,
    },
  );

  const currency = response.data?.results?.[0]?.customer?.currencyCode;
  return normalizeText(currency);
};

const fetchGoogleAdsCosts = async (startDate: string, endDate: string): Promise<GoogleCostResult> => {
  try {
    const oauthClient = buildOauthClient();
    const settings = resolveGoogleAdsSettings();
    const accessTokenResponse = await oauthClient.getAccessToken();
    const accessToken = normalizeText(
      typeof accessTokenResponse === 'string' ? accessTokenResponse : accessTokenResponse?.token ?? null,
    );
    if (!accessToken) {
      throw new Error('Unable to obtain Google Ads access token');
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': settings.developerToken,
      ...(settings.loginCustomerId ? { 'login-customer-id': settings.loginCustomerId } : {}),
    };

    const [currency, campaignResponse, adGroupResponse] = await Promise.all([
      fetchGoogleAdsCurrency(accessToken, settings),
      axios.post(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${settings.customerId}/googleAds:searchStream`,
        {
          query: [
            'SELECT campaign.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date',
            'FROM campaign',
            `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
          ].join(' '),
        },
        { headers, timeout: 20000 },
      ),
      axios.post(
        `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${settings.customerId}/googleAds:searchStream`,
        {
          query: [
            'SELECT campaign.name, ad_group.name, metrics.cost_micros, metrics.conversions, metrics.conversions_value, segments.date',
            'FROM ad_group',
            `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`,
          ].join(' '),
        },
        { headers, timeout: 20000 },
      ),
    ]);

    const campaignChunks: GoogleAdsStreamChunk[] = Array.isArray(campaignResponse.data) ? campaignResponse.data : [];
    const adGroupChunks: GoogleAdsStreamChunk[] = Array.isArray(adGroupResponse.data) ? adGroupResponse.data : [];
    const campaignRowsMap = new Map<string, GoogleCampaignCostRow>();
    const dailyMap = new Map<string, number>();
    const campaignPerformanceMap = new Map<string, GoogleAdsPerformanceRow>();
    const adGroupRowsMap = new Map<string, GoogleCostRow>();
    const adGroupPerformanceMap = new Map<string, GoogleAdsPerformanceRow>();

    campaignChunks.forEach((chunk) => {
      const results: GoogleAdsStreamResult[] = Array.isArray(chunk?.results) ? chunk.results : [];
      results.forEach((result) => {
        const campaign = normalizeText(result?.campaign?.name);
        const date = normalizeText(result?.segments?.date);
        const micros = Number(result?.metrics?.costMicros ?? 0);
        const conversions = Number(result?.metrics?.conversions ?? 0);
        const rawConversionValue = Number(result?.metrics?.conversionsValue ?? 0);
        const conversionValue = shouldIgnoreGoogleAdsConversionValue(campaign) ? 0 : rawConversionValue;
        if (!campaign || !date || !Number.isFinite(micros) || !Number.isFinite(conversions) || !Number.isFinite(conversionValue)) {
          return;
        }
        const current = campaignRowsMap.get(campaign) ?? { campaign, cost: 0 };
        current.cost += micros / 1_000_000;
        campaignRowsMap.set(campaign, current);
        dailyMap.set(date, roundMoney((dailyMap.get(date) ?? 0) + micros / 1_000_000));

        const performanceKey = `${campaign}\u0000${date}`;
        const performanceEntry = campaignPerformanceMap.get(performanceKey) ?? {
          campaign,
          medium: null,
          date,
          cost: 0,
          bookingCount: 0,
          revenue: 0,
        };
        performanceEntry.cost += micros / 1_000_000;
        performanceEntry.bookingCount += conversions;
        performanceEntry.revenue += conversionValue;
        campaignPerformanceMap.set(performanceKey, performanceEntry);
      });
    });

    adGroupChunks.forEach((chunk) => {
      const results: GoogleAdsStreamResult[] = Array.isArray(chunk?.results) ? chunk.results : [];
      results.forEach((result) => {
        const campaign = normalizeText(result?.campaign?.name);
        const medium = normalizeText(result?.adGroup?.name);
        const date = normalizeText(result?.segments?.date);
        const micros = Number(result?.metrics?.costMicros ?? 0);
        const conversions = Number(result?.metrics?.conversions ?? 0);
        const rawConversionValue = Number(result?.metrics?.conversionsValue ?? 0);
        const conversionValue = shouldIgnoreGoogleAdsConversionValue(campaign) ? 0 : rawConversionValue;
        if (!campaign || !medium || !date || !Number.isFinite(micros) || !Number.isFinite(conversions) || !Number.isFinite(conversionValue)) {
          return;
        }
        const key = buildPairKey(campaign, medium);
        if (!key) {
          return;
        }
        const current = adGroupRowsMap.get(key) ?? { campaign, medium, cost: 0 };
        current.cost += micros / 1_000_000;
        adGroupRowsMap.set(key, current);

        const performanceKey = `${key}\u0000${date}`;
        const performanceEntry = adGroupPerformanceMap.get(performanceKey) ?? {
          campaign,
          medium,
          date,
          cost: 0,
          bookingCount: 0,
          revenue: 0,
        };
        performanceEntry.cost += micros / 1_000_000;
        performanceEntry.bookingCount += conversions;
        performanceEntry.revenue += conversionValue;
        adGroupPerformanceMap.set(performanceKey, performanceEntry);
      });
    });

    return {
      currency,
      rows: Array.from(adGroupRowsMap.values())
        .map((row) => ({ ...row, cost: roundMoney(row.cost) }))
        .sort((left, right) => right.cost - left.cost || left.campaign.localeCompare(right.campaign)),
      campaignRows: Array.from(campaignRowsMap.values())
        .map((row) => ({ ...row, cost: roundMoney(row.cost) }))
        .sort((left, right) => right.cost - left.cost || left.campaign.localeCompare(right.campaign)),
      performanceRows: Array.from(campaignPerformanceMap.values())
        .map((row) => ({
          ...row,
          cost: roundMoney(row.cost),
          bookingCount: roundMetricCount(row.bookingCount),
          revenue: roundMoney(row.revenue),
        }))
        .sort((left, right) => left.date.localeCompare(right.date) || right.cost - left.cost),
      mediumPerformanceRows: Array.from(adGroupPerformanceMap.values())
        .map((row) => ({
          ...row,
          cost: roundMoney(row.cost),
          bookingCount: roundMetricCount(row.bookingCount),
          revenue: roundMoney(row.revenue),
        }))
        .sort((left, right) => left.date.localeCompare(right.date) || right.cost - left.cost),
      dailyRows: Array.from(dailyMap.entries())
        .map(([date, cost]) => ({ date, cost: roundMoney(cost) }))
        .sort((left, right) => left.date.localeCompare(right.date)),
      error: null,
    };
  } catch (error) {
    const message = extractGoogleAdsErrorMessage(error);
    return { currency: null, rows: [], campaignRows: [], performanceRows: [], mediumPerformanceRows: [], dailyRows: [], error: message };
  }
};

const fetchMarketingBookings = async (startDate: string, endDate: string): Promise<BookingRow[]> => {
  const rows = await Booking.findAll({
    where: {
      experienceDate: {
        [Op.between]: [startDate, endDate],
      },
    },
    attributes: [
      'id',
      'platformBookingId',
      'platform',
      'productName',
      'guestFirstName',
      'guestLastName',
      'experienceDate',
      'experienceStartAt',
      'sourceReceivedAt',
      'baseAmount',
      'currency',
      'utmSource',
      'utmMedium',
      'utmCampaign',
    ],
    include: [{ model: Product, as: 'product', attributes: ['name'] }],
    order: [
      ['experienceStartAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return rows
    .map((row) => ({
      id: row.id,
      platformBookingId: row.platformBookingId,
      platform: row.platform,
      productName: normalizeText(row.product?.name) ?? normalizeText(row.productName) ?? null,
      guestName: buildGuestName(row.guestFirstName ?? null, row.guestLastName ?? null),
      experienceDate: row.experienceDate ?? null,
      experienceStartAt: row.experienceStartAt ?? null,
      sourceReceivedAt: row.sourceReceivedAt ?? null,
      baseAmount: parseAmount(row.baseAmount),
      currency: row.currency ?? null,
      utmSource: normalizeText(row.utmSource),
      utmMedium: normalizeText(row.utmMedium),
      utmCampaign: normalizeText(row.utmCampaign),
      marketingSource: normalizeMarketingSource(normalizeText(row.utmSource)),
    }))
    .filter((row) => row.marketingSource !== null)
    .map((row) => ({
      ...row,
      guestName: row.guestName || '-',
    }));
};

export const getMarketingOverview = async (startDate: string, endDate: string): Promise<MarketingOverview> => {
  const normalizedStartDate = dayjs(startDate).format('YYYY-MM-DD');
  const normalizedEndDate = dayjs(endDate).format('YYYY-MM-DD');
  const bookings = await fetchMarketingBookings(normalizedStartDate, normalizedEndDate);

  const googleBookings = bookings.filter((booking) => booking.marketingSource === GOOGLE_ADS_SOURCE_LABEL);
  const metaBookings = bookings.filter((booking) => booking.marketingSource === META_ADS_SOURCE_LABEL);
  const googleCostResult = await fetchGoogleAdsCosts(normalizedStartDate, normalizedEndDate);
  const googleHistoricalMetricRows = buildHistoricalGoogleMetricRows(googleCostResult.performanceRows);
  const googleHistoricalMediumMetricRows = buildHistoricalGoogleMediumMetricRows(
    googleCostResult.mediumPerformanceRows,
    googleCostResult.performanceRows,
  );
  const overallMetricRows = [
    ...buildMetricRowsFromBookings(bookings, { excludeHistoricalGoogleAds: true }),
    ...googleHistoricalMetricRows,
  ];
  const overallMediumMetricRows = [
    ...buildMetricRowsFromBookings(bookings, { excludeHistoricalGoogleAds: true }),
    ...googleHistoricalMediumMetricRows,
  ];
  const googleMetricRows = [
    ...buildMetricRowsFromBookings(googleBookings, { excludeHistoricalGoogleAds: true }),
    ...googleHistoricalMetricRows,
  ];
  const googleMediumMetricRows = [
    ...buildMetricRowsFromBookings(googleBookings, { excludeHistoricalGoogleAds: true }),
    ...googleHistoricalMediumMetricRows,
  ];
  const metaMetricRows = buildMetricRowsFromBookings(metaBookings);
  const totalGoogleCost = roundMoney(googleCostResult.campaignRows.reduce((sum, row) => sum + row.cost, 0));
  const dailyCostByDate = new Map<string, number>(googleCostResult.dailyRows.map((row) => [row.date, row.cost]));
  const sourceCostByLabel = new Map<string, number>([[GOOGLE_ADS_SOURCE_LABEL, totalGoogleCost]]);
  const mediumCostByLabel = buildMediumCostByLabel(googleCostResult.rows, googleCostResult.campaignRows);
  const campaignCostByLabel = aggregateCampaignCostByLabel(googleCostResult.campaignRows, (row) => row.campaign);

  const googleAds = buildTabData(googleBookings, googleMetricRows, normalizedStartDate, normalizedEndDate, {
    sourceCostByLabel,
    mediumCostByLabel,
    campaignCostByLabel,
    dailyCostByDate,
    revenueCurrencyFallback: googleCostResult.currency,
    mediumMetricRows: googleMediumMetricRows,
  });
  const metaAds = buildTabData(metaBookings, metaMetricRows, normalizedStartDate, normalizedEndDate);
  const overall = buildTabData(bookings, overallMetricRows, normalizedStartDate, normalizedEndDate, {
    sourceCostByLabel,
    mediumCostByLabel,
    campaignCostByLabel,
    dailyCostByDate,
    revenueCurrencyFallback: googleCostResult.currency,
    mediumMetricRows: overallMediumMetricRows,
  });

  return {
    startDate: normalizedStartDate,
    endDate: normalizedEndDate,
    overall: {
      ...overall,
      googleAdsCost: totalGoogleCost,
      googleCostCurrency: googleCostResult.currency,
    },
    googleAds: {
      ...googleAds,
      googleAdsCost: totalGoogleCost,
      costCurrency: googleCostResult.currency,
      costError: googleCostResult.error,
      googleCostRows: googleCostResult.rows,
    },
    metaAds,
  };
};
