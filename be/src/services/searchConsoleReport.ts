import type { searchconsole_v1 } from 'googleapis';
import HttpError from '../errors/HttpError.js';

export type PerformanceOptions = {
  siteUrl: string;
  startDate?: unknown;
  endDate?: unknown;
  dimensions?: unknown;
  rowLimit?: unknown;
  startRow?: unknown;
  type?: unknown;
  country?: unknown;
  device?: unknown;
  query?: unknown;
  queryMatch?: unknown;
  page?: unknown;
  pageMatch?: unknown;
};
const invalid = (message: string): never => { throw new HttpError(400, message); };
const date = (value: unknown, fallback: string): string => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('Invalid report date.');
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid('Invalid report date.');
  return value;
};
const text = (value: unknown, max: number): string => {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/.test(value)) return invalid('Invalid report filter.');
  return value.trim();
};
const integer = (value: unknown, fallback: number, max: number): number => {
  if (value === undefined) return fallback;
  const number = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(number) || number < 0 || number > max) return invalid('Invalid report pagination.');
  return number;
};

export const buildPerformanceRequest = (params: PerformanceOptions, pageSize: number, now = new Date()) => {
  const siteUrl = text(params.siteUrl, 2048);
  if (!siteUrl) return invalid('siteUrl is required.');
  const day = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10);
  const startDate = date(params.startDate, day(30));
  const endDate = date(params.endDate, day(2));
  if (startDate > endDate) return invalid('Start date must not follow end date.');
  const allowed = new Set(['query', 'page', 'country', 'device', 'date', 'searchAppearance']);
  const dimensions = params.dimensions === undefined ? ['query'] : params.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length === 0 || dimensions.some(value => typeof value !== 'string' || !allowed.has(value)) || new Set(dimensions).size !== dimensions.length) return invalid('Invalid report dimensions.');
  const type = text(params.type, 20) || 'web';
  if (!['web', 'image', 'video', 'news', 'discover', 'googleNews'].includes(type)) return invalid('Invalid search type.');
  const rowLimit = Math.min(integer(params.rowLimit, pageSize, 24999), pageSize);
  if (rowLimit === 0) return invalid('Row limit must be positive.');
  const startRow = integer(params.startRow, 0, 1000000);
  const filters: searchconsole_v1.Schema$ApiDimensionFilter[] = [];
  const country = text(params.country, 3).toLowerCase();
  if (country && !/^[a-z]{3}$/.test(country)) return invalid('Country must be an ISO 3166-1 alpha-3 code.');
  if (country) filters.push({dimension: 'country', operator: 'equals', expression: country});
  const device = text(params.device, 10).toUpperCase();
  if (device && !['DESKTOP', 'MOBILE', 'TABLET'].includes(device)) return invalid('Invalid device.');
  if (device) filters.push({dimension: 'device', operator: 'equals', expression: device});
  for (const dimension of ['query', 'page'] as const) {
    const expression = text(params[dimension], 4096);
    const operator = text(params[dimension === 'query' ? 'queryMatch' : 'pageMatch'], 20) || 'equals';
    if (!['equals', 'contains', 'notEquals', 'notContains'].includes(operator)) return invalid('Invalid filter match.');
    if (expression) filters.push({dimension, operator, expression});
  }
  const common: searchconsole_v1.Schema$SearchAnalyticsQueryRequest = {
    startDate, endDate, type, dataState: 'final',
    ...(filters.length ? {dimensionFilterGroups: [{groupType: 'and', filters}]} : {}),
  };
  // Page grouping counts search appearances differently from property totals.
  // Keep summary filters identical, but never derive totals from detail rows.
  const summaryAggregation = filters.some(filter => filter.dimension === 'page') || ['discover', 'googleNews'].includes(type) ? 'auto' : 'byProperty';
  return {siteUrl, startDate, endDate, dimensions: dimensions as string[], rowLimit, startRow, type,
    detail: {...common, dimensions, aggregationType: 'auto', rowLimit: rowLimit + 1, startRow},
    summary: {...common, aggregationType: summaryAggregation, rowLimit: 1}, filters};
};
