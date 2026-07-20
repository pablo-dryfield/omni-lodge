import { google, searchconsole_v1 } from 'googleapis';
import SeoActionLog from '../models/SeoActionLog.js';
import { getConfigValue } from './configService.js';

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

const normalizeDate = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return fallback;
  }
  return value;
};

const normalizeDimensions = (value: unknown): string[] => {
  const allowed = new Set(['query', 'page', 'country', 'device', 'date', 'searchAppearance']);
  if (!Array.isArray(value)) {
    return ['query'];
  }
  const dimensions = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => allowed.has(entry));
  return dimensions.length > 0 ? Array.from(new Set(dimensions)) : ['query'];
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

export const getSearchConsolePerformance = async (params: {
  siteUrl: string;
  startDate?: unknown;
  endDate?: unknown;
  dimensions?: unknown;
  rowLimit?: unknown;
}): Promise<SearchConsolePerformanceResult> => {
  const siteUrl = params.siteUrl.trim();
  if (!siteUrl) {
    throw new Error('siteUrl is required');
  }

  const now = new Date();
  const defaultEndDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2))
    .toISOString()
    .slice(0, 10);
  const defaultStartDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30))
    .toISOString()
    .slice(0, 10);
  const startDate = normalizeDate(params.startDate, defaultStartDate);
  const endDate = normalizeDate(params.endDate, defaultEndDate);
  const dimensions = normalizeDimensions(params.dimensions);
  const parsedLimit =
    typeof params.rowLimit === 'number' || typeof params.rowLimit === 'string'
      ? Number(params.rowLimit)
      : 100;
  const rowLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(Math.floor(parsedLimit), 1), 25000) : 100;

  const searchConsole = getSearchConsoleClient();
  const response = await searchConsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
    },
  });

  const rows = (response.data.rows ?? []).map((row) => ({
    keys: row.keys ?? [],
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  }));

  return {
    rows,
    startDate,
    endDate,
    dimensions,
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
