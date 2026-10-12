import type { Transaction } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import Product from '../../models/Product.js';
import { getConfigValue } from '../configService.js';
import type { BookingFieldPatch } from './types.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const CONFIG_KEY = 'BOOKING_AUTOMATIC_REASSIGNMENT_RULES';
const DEFAULT_TIMEZONE = 'Europe/Warsaw';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

type RawReassignmentRule = Record<string, unknown>;

export type AutomaticBookingReassignmentRule = {
  id: string;
  enabled: boolean;
  platform: string | null;
  sourceProductId: number | null;
  sourceProductName: string | null;
  sourceDate: string | null;
  sourceTime: string | null;
  targetProductId: number | null;
  targetProductName: string | null;
  targetDate: string | null;
  targetTime: string | null;
};

export type BookingReassignmentInput = {
  platform?: string | null;
  productId?: number | null;
  productName?: string | null;
  experienceDate?: string | null;
  experienceStartAt?: Date | string | null;
};

export type BookingReassignmentResult = {
  patch: BookingFieldPatch;
  matchedRule: AutomaticBookingReassignmentRule | null;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeLookup = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const normalizeNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeDate = (value: unknown): string | null => {
  const text = normalizeText(value);
  if (!text || !DATE_PATTERN.test(text)) {
    return null;
  }
  return dayjs(text).isValid() ? text : null;
};

const normalizeTime = (value: unknown): string | null => {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const normalized = text.length === 4 && /^\d:\d{2}$/.test(text) ? `0${text}` : text;
  return TIME_PATTERN.test(normalized) ? normalized : null;
};

const normalizeBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const readRulesConfig = (): RawReassignmentRule[] => {
  const configured = getConfigValue(CONFIG_KEY);
  if (Array.isArray(configured)) {
    return configured.filter((entry): entry is RawReassignmentRule => Boolean(entry && typeof entry === 'object'));
  }
  if (configured && typeof configured === 'object' && Array.isArray((configured as { rules?: unknown }).rules)) {
    return ((configured as { rules: unknown[] }).rules ?? []).filter(
      (entry): entry is RawReassignmentRule => Boolean(entry && typeof entry === 'object'),
    );
  }
  return [];
};

export const normalizeAutomaticBookingReassignmentRules = (
  rawRules: RawReassignmentRule[] = readRulesConfig(),
): AutomaticBookingReassignmentRule[] =>
  rawRules
    .map((rule, index) => {
      const sourceProductId =
        normalizeNumber(rule.sourceProductId) ??
        normalizeNumber(rule.fromProductId) ??
        normalizeNumber(rule.productId);
      const targetProductId =
        normalizeNumber(rule.targetProductId) ??
        normalizeNumber(rule.toProductId) ??
        normalizeNumber(rule.reassignProductId);
      const sourceDate =
        normalizeDate(rule.sourceDate) ??
        normalizeDate(rule.fromDate) ??
        normalizeDate(rule.date);
      const targetDate =
        normalizeDate(rule.targetDate) ??
        normalizeDate(rule.toDate) ??
        normalizeDate(rule.reassignDate);
      const sourceTime =
        normalizeTime(rule.sourceTime) ??
        normalizeTime(rule.fromTime) ??
        normalizeTime(rule.time);
      const targetTime =
        normalizeTime(rule.targetTime) ??
        normalizeTime(rule.toTime) ??
        normalizeTime(rule.reassignTime);

      return {
        id: normalizeText(rule.id) ?? `rule-${index + 1}`,
        enabled: normalizeBoolean(rule.enabled, true),
        platform: normalizeText(rule.platform),
        sourceProductId,
        sourceProductName:
          normalizeText(rule.sourceProductName) ??
          normalizeText(rule.fromProductName) ??
          normalizeText(rule.productName),
        sourceDate,
        sourceTime,
        targetProductId,
        targetProductName:
          normalizeText(rule.targetProductName) ??
          normalizeText(rule.toProductName) ??
          normalizeText(rule.reassignProductName),
        targetDate,
        targetTime,
      };
    })
    .filter((rule) => {
      if (!rule.enabled) {
        return false;
      }
      return Boolean(rule.targetProductId || rule.targetProductName || rule.targetDate || rule.targetTime);
    });

const extractExperienceTime = (
  experienceStartAt: Date | string | null | undefined,
  timezoneName: string,
): string | null => {
  if (!experienceStartAt) {
    return null;
  }
  const parsed = dayjs(experienceStartAt).tz(timezoneName);
  return parsed.isValid() ? parsed.format('HH:mm') : null;
};

const ruleMatches = (
  rule: AutomaticBookingReassignmentRule,
  input: BookingReassignmentInput,
  timezoneName: string,
): boolean => {
  if (rule.platform && normalizeLookup(rule.platform) !== normalizeLookup(input.platform)) {
    return false;
  }
  if (rule.sourceProductId != null && Number(input.productId ?? 0) !== rule.sourceProductId) {
    return false;
  }
  if (
    rule.sourceProductName &&
    normalizeLookup(rule.sourceProductName) !== normalizeLookup(input.productName)
  ) {
    return false;
  }
  if (rule.sourceDate && String(input.experienceDate ?? '').trim() !== rule.sourceDate) {
    return false;
  }
  if (rule.sourceTime) {
    const sourceTime = extractExperienceTime(input.experienceStartAt, timezoneName);
    if (sourceTime !== rule.sourceTime) {
      return false;
    }
  }
  return true;
};

const resolveTargetProduct = async (
  rule: AutomaticBookingReassignmentRule,
  transaction?: Transaction | null,
): Promise<{ productId: number | null; productName: string | null }> => {
  if (rule.targetProductId != null) {
    const product = await Product.findByPk(rule.targetProductId, { transaction: transaction ?? undefined });
    return {
      productId: rule.targetProductId,
      productName: product?.name ?? rule.targetProductName,
    };
  }

  if (!rule.targetProductName) {
    return { productId: null, productName: null };
  }

  const products = await Product.findAll({
    attributes: ['id', 'name'],
    transaction: transaction ?? undefined,
  });
  const targetLookup = normalizeLookup(rule.targetProductName);
  const product = products.find((entry) => normalizeLookup(entry.name) === targetLookup) ?? null;
  return {
    productId: product?.id ?? null,
    productName: product?.name ?? rule.targetProductName,
  };
};

const buildTargetStartAt = (
  date: string | null | undefined,
  time: string | null | undefined,
  timezoneName: string,
): Date | null => {
  if (!date || !time) {
    return null;
  }
  const parsed = dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', timezoneName);
  return parsed.isValid() ? parsed.toDate() : null;
};

export const applyAutomaticBookingReassignmentRules = async (
  input: BookingReassignmentInput,
  patch: BookingFieldPatch,
  options: { transaction?: Transaction | null; timezoneName?: string } = {},
): Promise<BookingReassignmentResult> => {
  const timezoneName =
    options.timezoneName ??
    (getConfigValue('BOOKING_PARSER_TIMEZONE') as string | null) ??
    DEFAULT_TIMEZONE;
  const rules = normalizeAutomaticBookingReassignmentRules();
  const source: BookingReassignmentInput = {
    ...input,
    productId: patch.productId ?? input.productId ?? null,
    productName: patch.productName ?? input.productName ?? null,
    experienceDate: patch.experienceDate ?? input.experienceDate ?? null,
    experienceStartAt: patch.experienceStartAt ?? input.experienceStartAt ?? null,
  };
  const matchedRule = rules.find((rule) => ruleMatches(rule, source, timezoneName)) ?? null;
  if (!matchedRule) {
    return { patch, matchedRule: null };
  }

  const nextPatch: BookingFieldPatch = { ...patch };
  const targetProduct = await resolveTargetProduct(matchedRule, options.transaction ?? null);
  if (targetProduct.productId != null) {
    nextPatch.productId = targetProduct.productId;
  }
  if (targetProduct.productName) {
    nextPatch.productName = targetProduct.productName;
  }

  const targetDate = matchedRule.targetDate ?? (typeof source.experienceDate === 'string' ? source.experienceDate : null);
  const targetTime =
    matchedRule.targetTime ??
    extractExperienceTime(source.experienceStartAt, timezoneName);
  if (matchedRule.targetDate) {
    nextPatch.experienceDate = matchedRule.targetDate;
  }
  if (matchedRule.targetDate || matchedRule.targetTime) {
    const targetStartAt = buildTargetStartAt(targetDate, targetTime, timezoneName);
    if (targetStartAt) {
      nextPatch.experienceStartAt = targetStartAt;
    }
  }

  return { patch: nextPatch, matchedRule };
};
