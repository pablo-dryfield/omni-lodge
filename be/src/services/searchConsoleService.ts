import { google, searchconsole_v1 } from 'googleapis';
import SeoActionLog from '../models/SeoActionLog.js';
import { getConfigValue, refreshConfigCacheKeys } from './configService.js';
import { buildPerformanceRequest, type PerformanceOptions, type SearchConsoleDateCoverage } from './searchConsoleReport.js';

type SearchConsoleCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type SearchConsoleSite = {
  siteUrl: string;
  permissionLevel: string;
};

export type SearchConsolePerformanceRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchConsolePerformanceResult = {
  rows: SearchConsolePerformanceRow[];
  startDate: string;
  endDate: string;
  dimensions: string[];
  summary: Omit<SearchConsolePerformanceRow, 'keys'> | null;
  summaryAggregation: string;
  detailAggregation: string;
  searchType: string;
  timeZone: 'America/Los_Angeles';
  dateCoverage: SearchConsoleDateCoverage;
  coverage: { startRow: number; rowLimit: number; returnedRows: number; hasMore: boolean; nextStartRow: number | null; limitedByProvider: true };
};

export type SearchConsoleUrlInspectionResult = {
  inspectionUrl: string;
  siteUrl: string;
  verdict: string | null;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  sitemap: string[];
  referringUrls: string[];
};

export type SeoActionLogDto = {
  id: number;
  siteUrl: string;
  actionType: string;
  title: string;
  details: string | null;
  targetQuery: string | null;
  targetPage: string | null;
  createdBy: number | null;
  createdAt: string;
};

const readConfigString = (key: string): string | null => {
  const value = getConfigValue(key);
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveCredentials = (): SearchConsoleCredentials => {
  const clientId = readConfigString('GOOGLE_CLIENT_ID');
  const clientSecret = readConfigString('GOOGLE_CLIENT_SECRET');
  const refreshToken = readConfigString('GOOGLE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google API credentials for Search Console integration');
  }
  return { clientId, clientSecret, refreshToken };
};

const getSearchConsoleClient = (): searchconsole_v1.Searchconsole => {
  const { clientId, clientSecret, refreshToken } = resolveCredentials();
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.searchconsole({ version: 'v1', auth });
};

export const listSearchConsoleSites = async (): Promise<SearchConsoleSite[]> => {
  const searchConsole = getSearchConsoleClient();
  const response = await searchConsole.sites.list();
  return (response.data.siteEntry ?? [])
    .filter((site): site is searchconsole_v1.Schema$WmxSite => Boolean(site.siteUrl))
    .map((site) => ({
      siteUrl: site.siteUrl ?? '',
      permissionLevel: site.permissionLevel ?? 'unknown',
    }))
    .sort((left, right) => left.siteUrl.localeCompare(right.siteUrl));
};

export const getSearchConsolePerformance = async (params: PerformanceOptions): Promise<SearchConsolePerformanceResult> => {
  await refreshConfigCacheKeys(['SEARCH_CONSOLE_PAGE_SIZE']);
  const configured = Number(getConfigValue('SEARCH_CONSOLE_PAGE_SIZE'));
  const pageSize = Number.isInteger(configured) && configured >= 100 && configured <= 24999 ? configured : 1000;
  const request = buildPerformanceRequest(params, pageSize);
  const searchConsole = getSearchConsoleClient();
  const response = await searchConsole.searchanalytics.query({siteUrl: request.siteUrl, requestBody: request.detail});
  const summaryResponse = await searchConsole.searchanalytics.query({siteUrl: request.siteUrl, requestBody: request.summary});
  const mapRow = (row: searchconsole_v1.Schema$ApiDataRow): SearchConsolePerformanceRow => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  });
  const detailRows = response.data.rows ?? [];
  const rows = detailRows.slice(0, request.rowLimit).map(mapRow);
  const summaryRow = summaryResponse.data.rows?.[0];
  const summary = summaryRow ? mapRow(summaryRow) : null;
  const hasMore = detailRows.length > request.rowLimit;
  return {
    rows,
    startDate: request.startDate, endDate: request.endDate, dimensions: request.dimensions,
    summary: summary ? {clicks: summary.clicks, impressions: summary.impressions, ctr: summary.ctr, position: summary.position} : null,
    summaryAggregation: summaryResponse.data.responseAggregationType ?? 'unknown',
    detailAggregation: response.data.responseAggregationType ?? 'unknown',
    searchType: request.type, timeZone: 'America/Los_Angeles',
    dateCoverage: request.dateCoverage,
    coverage: {startRow: request.startRow, rowLimit: request.rowLimit, returnedRows: rows.length, hasMore,
      nextStartRow: hasMore ? request.startRow + rows.length : null, limitedByProvider: true},
  };
};

export const inspectSearchConsoleUrl = async (params: {
  siteUrl: string;
  inspectionUrl: string;
}): Promise<SearchConsoleUrlInspectionResult> => {
  const siteUrl = params.siteUrl.trim();
  const inspectionUrl = params.inspectionUrl.trim();
  if (!siteUrl || !inspectionUrl) {
    throw new Error('siteUrl and inspectionUrl are required');
  }

  const searchConsole = getSearchConsoleClient();
  const response = await searchConsole.urlInspection.index.inspect({
    requestBody: {
      siteUrl,
      inspectionUrl,
    },
  });

  const indexStatus = response.data.inspectionResult?.indexStatusResult;
  return {
    inspectionUrl,
    siteUrl,
    verdict: indexStatus?.verdict ?? null,
    coverageState: indexStatus?.coverageState ?? null,
    robotsTxtState: indexStatus?.robotsTxtState ?? null,
    indexingState: indexStatus?.indexingState ?? null,
    lastCrawlTime: indexStatus?.lastCrawlTime ?? null,
    googleCanonical: indexStatus?.googleCanonical ?? null,
    userCanonical: indexStatus?.userCanonical ?? null,
    sitemap: indexStatus?.sitemap ?? [],
    referringUrls: indexStatus?.referringUrls ?? [],
  };
};

const serializeSeoAction = (entry: SeoActionLog): SeoActionLogDto => ({
  id: entry.id,
  siteUrl: entry.siteUrl,
  actionType: entry.actionType,
  title: entry.title,
  details: entry.details,
  targetQuery: entry.targetQuery,
  targetPage: entry.targetPage,
  createdBy: entry.createdBy,
  createdAt: entry.createdAt.toISOString(),
});

const normalizeText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
};

export const listSeoActionLogs = async (params: { siteUrl: string; limit?: unknown }): Promise<SeoActionLogDto[]> => {
  const siteUrl = params.siteUrl.trim();
  if (!siteUrl) {
    return [];
  }
  const parsedLimit = typeof params.limit === 'string' || typeof params.limit === 'number' ? Number(params.limit) : 25;
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 100) : 25;
  const rows = await SeoActionLog.findAll({
    where: { siteUrl },
    order: [['created_at', 'DESC']],
    limit,
  });
  return rows.map(serializeSeoAction);
};

export const createSeoActionLog = async (params: {
  siteUrl: unknown;
  actionType: unknown;
  title: unknown;
  details?: unknown;
  targetQuery?: unknown;
  targetPage?: unknown;
  actorId: number | null;
}): Promise<SeoActionLogDto> => {
  const siteUrl = normalizeText(params.siteUrl, 512);
  const actionType = normalizeText(params.actionType, 64) ?? 'other';
  const title = normalizeText(params.title, 512);
  if (!siteUrl || !title) {
    throw new Error('siteUrl and title are required');
  }
  const entry = await SeoActionLog.create({
    siteUrl,
    actionType,
    title,
    details: normalizeText(params.details, 4000),
    targetQuery: normalizeText(params.targetQuery, 1000),
    targetPage: normalizeText(params.targetPage, 2000),
    createdBy: params.actorId,
  });
  return serializeSeoAction(entry);
};
