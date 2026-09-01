import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import {
  Op,
  col,
  fn,
  literal,
  where as sequelizeWhere,
  type Transaction as SequelizeTransaction,
} from 'sequelize';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceClient from '../models/FinanceClient.js';
import FinanceRecurringRule, {
  FinanceRecurringFrequency,
  FinanceRecurringStatus,
} from '../models/FinanceRecurringRule.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import FinanceVendor from '../models/FinanceVendor.js';
import VolunteerFund from '../models/VolunteerFund.js';
import {
  createFinanceTransaction,
  FinanceTransactionInput,
  updateFinanceTransaction,
} from './transactionService.js';
import { recordFinanceAuditLog } from './auditLogService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const FREQUENCIES = new Set<FinanceRecurringFrequency>([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
]);
const STATUSES = new Set<FinanceRecurringStatus>(['active', 'paused', 'completed']);
const RULE_FIELDS = new Set([
  'kind',
  'templateJson',
  'frequency',
  'interval',
  'byMonthDay',
  'startDate',
  'endDate',
  'timezone',
  'status',
]);
const TEMPLATE_FIELDS = new Set([
  'kind',
  'accountId',
  'currency',
  'amountMinor',
  'fxRate',
  'categoryId',
  'counterpartyType',
  'counterpartyId',
  'paymentMethod',
  'status',
  'description',
  'tags',
  'meta',
]);
const MAX_TEMPLATE_JSON_BYTES = 64 * 1024;
const DEFAULT_MAX_CATCH_UP_PER_RULE = 100;
const MAX_CATCH_UP_LIMIT = 1_000;
const DEFAULT_RULE_BATCH_SIZE = 250;
const MAX_RULE_BATCH_SIZE = 1_000;
const DEFAULT_OCCURRENCE_LIMIT = 25;
const MAX_OCCURRENCE_LIMIT = 100;

type JsonRecord = Record<string, unknown>;

export type FinanceRecurringTemplate = {
  kind: 'income' | 'expense';
  accountId: number;
  currency: string;
  amountMinor: number;
  fxRate?: number | string | null;
  categoryId: number;
  counterpartyType: 'vendor' | 'client';
  counterpartyId: number;
  paymentMethod?: string | null;
  status: 'planned';
  description?: string | null;
  tags?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
};

export type FinanceRecurringRulePayload = {
  kind: 'income' | 'expense';
  templateJson: FinanceRecurringTemplate;
  frequency: FinanceRecurringFrequency;
  interval: number;
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  status: FinanceRecurringStatus;
};

export type RecurringRuleExecutionFailure = {
  ruleId: number;
  message: string;
};

export type RecurringRuleExecutionResult = {
  processed: number;
  createdTransactions: number;
  skipped: number;
  failed: number;
  completed: number;
  deferred: number;
  failures: RecurringRuleExecutionFailure[];
};

export type RecurringRuleOccurrenceList = {
  data: FinanceTransaction[];
  meta: {
    count: number;
    limit: number;
    offset: number;
  };
};

export type RecurringOccurrenceMutationResult = {
  transaction: FinanceTransaction;
  changed: boolean;
};

export type ExecuteRecurringRulesOptions = {
  now?: Date;
  maxCatchUpPerRule?: number;
  ruleBatchSize?: number;
};

export type RecurringRuleWriteOptions = {
  transaction?: SequelizeTransaction;
  now?: Date;
};

type RecurringSchedule = Pick<
  FinanceRecurringRulePayload,
  'frequency' | 'interval' | 'byMonthDay' | 'startDate' | 'endDate' | 'timezone'
>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireJsonRecord(value: unknown, label: string): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new HttpError(400, `${label} must be an object`);
  }
  return value;
}

function rejectUnknownFields(value: JsonRecord, allowed: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new HttpError(400, `${label} contains unsupported fields: ${unknown.join(', ')}`);
  }
}

function inputField(input: JsonRecord, key: string, fallback: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback;
}

function parsePositiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new HttpError(400, `${label} must be a positive whole number no greater than ${maximum}`);
  }
  return parsed;
}

function parseNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parsePositiveInteger(value, label);
}

function normalizeDateOnly(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} must use YYYY-MM-DD format`);
  }
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new HttpError(400, `${label} must use YYYY-MM-DD format`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== date
  ) {
    throw new HttpError(400, `${label} must be a valid calendar date`);
  }
  return value;
}

function normalizeNullableDateOnly(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeDateOnly(value, label);
}

function normalizeTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 64) {
    throw new HttpError(400, 'timezone must be a valid IANA timezone');
  }
  const normalized = value.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
  } catch {
    throw new HttpError(400, 'timezone must be a valid IANA timezone');
  }
  return normalized;
}

function normalizeOptionalText(
  value: unknown,
  label: string,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${label} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, `${label} must not exceed ${maxLength} characters`);
  }
  return normalized || null;
}

function normalizeOptionalJsonRecord(
  value: unknown,
  label: string,
): Record<string, unknown> | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalized = { ...requireJsonRecord(value, label) };
  let serialized: string;
  try {
    serialized = JSON.stringify(normalized);
  } catch {
    throw new HttpError(400, `${label} must contain valid JSON values`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_TEMPLATE_JSON_BYTES) {
    throw new HttpError(400, `${label} is too large`);
  }
  return normalized;
}

export function normalizeRecurringTemplate(
  value: unknown,
  expectedKind: 'income' | 'expense',
  options: { rejectUnknown?: boolean } = {},
): FinanceRecurringTemplate {
  const input = requireJsonRecord(value, 'templateJson');
  if (options.rejectUnknown !== false) {
    rejectUnknownFields(input, TEMPLATE_FIELDS, 'templateJson');
  }

  const kind = input.kind;
  if (kind !== 'income' && kind !== 'expense') {
    throw new HttpError(400, 'templateJson.kind must be income or expense');
  }
  if (kind !== expectedKind) {
    throw new HttpError(400, 'templateJson.kind must match the recurring rule kind');
  }

  const accountId = parsePositiveInteger(input.accountId, 'templateJson.accountId');
  const categoryId = parsePositiveInteger(input.categoryId, 'templateJson.categoryId');
  const counterpartyId = parsePositiveInteger(input.counterpartyId, 'templateJson.counterpartyId');
  const amountMinor = parsePositiveInteger(input.amountMinor, 'templateJson.amountMinor');
  const currency = typeof input.currency === 'string' ? input.currency.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new HttpError(400, 'templateJson.currency must be a three-letter currency code');
  }

  const expectedCounterpartyType = kind === 'expense' ? 'vendor' : 'client';
  if (input.counterpartyType !== undefined && input.counterpartyType !== expectedCounterpartyType) {
    throw new HttpError(
      400,
      `templateJson.counterpartyType must be ${expectedCounterpartyType} for ${kind} rules`,
    );
  }
  const counterpartyType: 'vendor' | 'client' = expectedCounterpartyType;
  if (input.status !== undefined && input.status !== 'planned') {
    throw new HttpError(400, 'Recurring rules can only create planned transactions');
  }

  let fxRate: number | string | null | undefined;
  if (input.fxRate !== undefined && input.fxRate !== null && input.fxRate !== '') {
    const parsedRate = Number(input.fxRate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      throw new HttpError(400, 'templateJson.fxRate must be greater than zero');
    }
    fxRate = input.fxRate as number | string;
  } else if (input.fxRate === null) {
    fxRate = null;
  }

  const description = normalizeOptionalText(input.description, 'templateJson.description', 5_000);
  const paymentMethod = normalizeOptionalText(input.paymentMethod, 'templateJson.paymentMethod', 60);
  const tags = normalizeOptionalJsonRecord(input.tags, 'templateJson.tags');
  const rawMeta = normalizeOptionalJsonRecord(input.meta, 'templateJson.meta');
  const meta = rawMeta ? { ...rawMeta } : rawMeta;
  if (meta) {
    delete meta.recurring_rule_id;
    delete meta.recurring_scheduled_for;
    delete meta.recurring_duplicate;
  }

  return {
    kind,
    accountId,
    currency,
    amountMinor,
    ...(fxRate !== undefined ? { fxRate } : {}),
    categoryId,
    counterpartyType,
    counterpartyId,
    ...(paymentMethod !== undefined ? { paymentMethod } : {}),
    status: 'planned',
    ...(description !== undefined ? { description } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(meta !== undefined ? { meta } : {}),
  };
}

function normalizeFrequency(value: unknown): FinanceRecurringFrequency {
  if (typeof value !== 'string' || !FREQUENCIES.has(value as FinanceRecurringFrequency)) {
    throw new HttpError(400, 'frequency must be daily, weekly, monthly, quarterly, or yearly');
  }
  return value as FinanceRecurringFrequency;
}

function normalizeStatus(value: unknown, defaultValue: FinanceRecurringStatus): FinanceRecurringStatus {
  const normalized = value === undefined ? defaultValue : value;
  if (typeof normalized !== 'string' || !STATUSES.has(normalized as FinanceRecurringStatus)) {
    throw new HttpError(400, 'status must be active, paused, or completed');
  }
  return normalized as FinanceRecurringStatus;
}

function normalizeRulePayloadFromRecord(
  input: JsonRecord,
  options: { rejectUnknown: boolean; existing?: FinanceRecurringRulePayload },
): FinanceRecurringRulePayload {
  if (options.rejectUnknown) {
    rejectUnknownFields(input, RULE_FIELDS, 'Recurring rule');
  }
  const existing = options.existing;
  const kindValue = inputField(input, 'kind', existing?.kind);
  if (kindValue !== 'income' && kindValue !== 'expense') {
    throw new HttpError(400, 'kind must be income or expense');
  }
  const frequency = normalizeFrequency(inputField(input, 'frequency', existing?.frequency));
  const interval = parsePositiveInteger(inputField(input, 'interval', existing?.interval ?? 1), 'interval', 365);
  const rawByMonthDay = inputField(input, 'byMonthDay', existing?.byMonthDay ?? null);
  const byMonthDay = frequency === 'daily' || frequency === 'weekly'
    ? null
    : parseNullablePositiveInteger(rawByMonthDay, 'byMonthDay');
  if (byMonthDay !== null && byMonthDay > 31) {
    throw new HttpError(400, 'byMonthDay must be between 1 and 31');
  }
  const startDate = normalizeDateOnly(inputField(input, 'startDate', existing?.startDate), 'startDate');
  const endDate = normalizeNullableDateOnly(inputField(input, 'endDate', existing?.endDate ?? null), 'endDate');
  if (endDate && endDate < startDate) {
    throw new HttpError(400, 'endDate must be on or after startDate');
  }
  const timezoneValue = normalizeTimezone(inputField(input, 'timezone', existing?.timezone));
  const status = normalizeStatus(inputField(input, 'status', existing?.status ?? 'active'), existing?.status ?? 'active');
  const templateSource = inputField(input, 'templateJson', existing?.templateJson);
  const templateJson = normalizeRecurringTemplate(
    templateSource,
    kindValue,
    { rejectUnknown: input.templateJson !== undefined },
  );

  return {
    kind: kindValue,
    templateJson,
    frequency,
    interval,
    byMonthDay,
    startDate,
    endDate,
    timezone: timezoneValue,
    status,
  };
}

export function normalizeRecurringRuleCreatePayload(value: unknown): FinanceRecurringRulePayload {
  return normalizeRulePayloadFromRecord(requireJsonRecord(value, 'Recurring rule'), {
    rejectUnknown: true,
  });
}

export function normalizeRecurringRuleUpdatePayload(
  value: unknown,
  existing: FinanceRecurringRulePayload,
): FinanceRecurringRulePayload {
  const input = requireJsonRecord(value, 'Recurring rule');
  rejectUnknownFields(input, RULE_FIELDS, 'Recurring rule');
  if (Object.keys(input).length === 0) {
    throw new HttpError(400, 'At least one recurring rule field is required');
  }
  return normalizeRulePayloadFromRecord(input, { rejectUnknown: false, existing });
}

function dateParts(value: string): { year: number; month: number; day: number } {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid internal recurring date: ${value}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(value: string, amount: number): string {
  const { year, month, day } = dateParts(value);
  const result = new Date(Date.UTC(year, month - 1, day + amount));
  return formatDateParts(result.getUTCFullYear(), result.getUTCMonth() + 1, result.getUTCDate());
}

function addMonthsAnchored(value: string, amount: number, anchorDay: number): string {
  const { year, month } = dateParts(value);
  const monthIndex = year * 12 + month - 1 + amount;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const targetMonth = targetMonthIndex + 1;
  return formatDateParts(
    targetYear,
    targetMonth,
    Math.min(anchorDay, daysInMonth(targetYear, targetMonth)),
  );
}

function scheduleOrigin(schedule: RecurringSchedule): string {
  if (schedule.frequency === 'daily' || schedule.frequency === 'weekly' || !schedule.byMonthDay) {
    return schedule.startDate;
  }
  const { year, month } = dateParts(schedule.startDate);
  const candidate = formatDateParts(
    year,
    month,
    Math.min(schedule.byMonthDay, daysInMonth(year, month)),
  );
  if (candidate >= schedule.startDate) {
    return candidate;
  }
  if (schedule.frequency === 'monthly') {
    return addMonthsAnchored(candidate, schedule.interval, schedule.byMonthDay);
  }
  if (schedule.frequency === 'quarterly') {
    return addMonthsAnchored(candidate, 3 * schedule.interval, schedule.byMonthDay);
  }
  return addMonthsAnchored(candidate, 12 * schedule.interval, schedule.byMonthDay);
}

export function computeNextRecurringDate(schedule: RecurringSchedule, previousDate: string): string {
  const anchorDay = schedule.byMonthDay ?? dateParts(schedule.startDate).day;
  switch (schedule.frequency) {
    case 'daily':
      return addDays(previousDate, schedule.interval);
    case 'weekly':
      return addDays(previousDate, schedule.interval * 7);
    case 'monthly':
      return addMonthsAnchored(previousDate, schedule.interval, anchorDay);
    case 'quarterly':
      return addMonthsAnchored(previousDate, 3 * schedule.interval, anchorDay);
    case 'yearly':
      return addMonthsAnchored(previousDate, 12 * schedule.interval, anchorDay);
    default:
      throw new Error(`Unsupported recurring frequency: ${String(schedule.frequency)}`);
  }
}

function daysBetween(from: string, to: string): number {
  const start = dateParts(from);
  const end = dateParts(to);
  return Math.floor(
    (Date.UTC(end.year, end.month - 1, end.day) - Date.UTC(start.year, start.month - 1, start.day))
      / 86_400_000,
  );
}

export function computeFirstRecurringDateOnOrAfter(
  schedule: RecurringSchedule,
  targetDate: string,
): string {
  const origin = scheduleOrigin(schedule);
  if (origin >= targetDate) {
    return origin;
  }

  let candidate = origin;
  if (schedule.frequency === 'daily' || schedule.frequency === 'weekly') {
    const stepDays = schedule.interval * (schedule.frequency === 'weekly' ? 7 : 1);
    const steps = Math.max(0, Math.floor(daysBetween(origin, targetDate) / stepDays));
    candidate = addDays(origin, steps * stepDays);
  } else {
    const originParts = dateParts(origin);
    const targetParts = dateParts(targetDate);
    const monthDifference = (targetParts.year - originParts.year) * 12 + targetParts.month - originParts.month;
    const stepMonths = schedule.interval
      * (schedule.frequency === 'quarterly' ? 3 : schedule.frequency === 'yearly' ? 12 : 1);
    const steps = Math.max(0, Math.floor(monthDifference / stepMonths));
    candidate = addMonthsAnchored(
      origin,
      steps * stepMonths,
      schedule.byMonthDay ?? dateParts(schedule.startDate).day,
    );
  }

  if (candidate < targetDate) {
    candidate = computeNextRecurringDate(schedule, candidate);
  }
  return candidate;
}

export function recurringDateToInstant(date: string, timezoneValue: string): Date {
  const parsed = dayjs.tz(`${date} 00:00:00`, timezoneValue);
  if (!parsed.isValid()) {
    throw new Error(`Unable to resolve recurring date ${date} in ${timezoneValue}`);
  }
  return parsed.toDate();
}

function instantToRecurringDate(value: Date | string, timezoneValue: string): string {
  if (typeof value === 'string' && DATE_ONLY_PATTERN.test(value)) {
    return value;
  }
  const parsed = dayjs(value).tz(timezoneValue);
  if (!parsed.isValid()) {
    throw new Error('Recurring rule has an invalid next run date');
  }
  return parsed.format('YYYY-MM-DD');
}

function scheduleFromRule(rule: FinanceRecurringRule): RecurringSchedule {
  return {
    frequency: rule.frequency,
    interval: rule.interval,
    byMonthDay: rule.byMonthDay,
    startDate: rule.startDate,
    endDate: rule.endDate,
    timezone: rule.timezone,
  };
}

function recurringPayloadFromRule(rule: FinanceRecurringRule): FinanceRecurringRulePayload {
  return normalizeRulePayloadFromRecord({
    kind: rule.kind,
    templateJson: rule.templateJson,
    frequency: rule.frequency,
    interval: rule.interval,
    byMonthDay: rule.byMonthDay,
    startDate: rule.startDate,
    endDate: rule.endDate,
    timezone: rule.timezone,
    status: rule.status,
  }, { rejectUnknown: false });
}

function schedulesDiffer(
  before: FinanceRecurringRulePayload,
  after: FinanceRecurringRulePayload,
): boolean {
  return before.frequency !== after.frequency
    || before.interval !== after.interval
    || before.byMonthDay !== after.byMonthDay
    || before.startDate !== after.startDate
    || before.timezone !== after.timezone;
}

function nextRunForNewRule(payload: FinanceRecurringRulePayload): Date | null {
  if (payload.status === 'completed') {
    return null;
  }
  const firstDate = scheduleOrigin(payload);
  if (payload.endDate && firstDate > payload.endDate) {
    return null;
  }
  return recurringDateToInstant(firstDate, payload.timezone);
}

export async function validateRecurringTemplateReferences(
  template: FinanceRecurringTemplate,
  transaction?: SequelizeTransaction,
): Promise<void> {
  const [account, category, counterparty, linkedFund] = await Promise.all([
    FinanceAccount.findByPk(template.accountId, { transaction }),
    FinanceCategory.findByPk(template.categoryId, { transaction }),
    template.kind === 'expense'
      ? FinanceVendor.findByPk(template.counterpartyId, { transaction })
      : FinanceClient.findByPk(template.counterpartyId, { transaction }),
    VolunteerFund.findOne({
      attributes: ['id', 'name'],
      where: { linkedAccountId: template.accountId, isActive: true },
      transaction,
    }),
  ]);

  if (!account || !account.isActive) {
    throw new HttpError(400, 'The recurring rule account does not exist or is inactive');
  }
  if (account.currency.trim().toUpperCase() !== template.currency) {
    throw new HttpError(
      400,
      `The recurring rule currency must match the selected account (${account.currency.toUpperCase()})`,
    );
  }
  if (linkedFund) {
    throw new HttpError(
      400,
      'Accounts linked to an active Volunteer Fund cannot be used by ordinary recurring rules',
    );
  }
  if (!category || !category.isActive || category.kind !== template.kind) {
    throw new HttpError(
      400,
      `The recurring rule category must be an active ${template.kind} category`,
    );
  }
  if (!counterparty || !counterparty.isActive) {
    throw new HttpError(
      400,
      `The recurring rule ${template.kind === 'expense' ? 'vendor' : 'client'} does not exist or is inactive`,
    );
  }
}

export async function createFinanceRecurringRule(
  input: unknown,
  actorId: number,
  options: RecurringRuleWriteOptions = {},
): Promise<FinanceRecurringRule> {
  const payload = normalizeRecurringRuleCreatePayload(input);
  const createWithinTransaction = async (transaction: SequelizeTransaction) => {
    await validateRecurringTemplateReferences(payload.templateJson, transaction);
    const nextRunDate = nextRunForNewRule(payload);
    const effectiveStatus: FinanceRecurringStatus = payload.status !== 'completed'
      && nextRunDate === null
      ? 'completed'
      : payload.status;
    const rule = await FinanceRecurringRule.create({
      ...payload,
      status: effectiveStatus,
      nextRunDate,
      completedAt: effectiveStatus === 'completed' ? options.now ?? new Date() : null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      createdBy: actorId,
      updatedBy: null,
    }, { transaction });
    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: rule.id,
      action: 'create',
      performedBy: actorId,
      changes: rule.toJSON() as Record<string, unknown>,
      metadata: { nextRunDate: rule.nextRunDate?.toISOString() ?? null },
      transaction,
    });
    return rule;
  };
  return options.transaction
    ? createWithinTransaction(options.transaction)
    : sequelize.transaction(createWithinTransaction);
}

export async function updateFinanceRecurringRule(
  id: number,
  input: unknown,
  actorId: number,
  options: RecurringRuleWriteOptions = {},
): Promise<FinanceRecurringRule> {
  const now = options.now ?? new Date();
  const updateWithinTransaction = async (transaction: SequelizeTransaction) => {
    const rule = await FinanceRecurringRule.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!rule) {
      throw new HttpError(404, 'Recurring rule not found');
    }
    const before = recurringPayloadFromRule(rule);
    const rawInput = requireJsonRecord(input, 'Recurring rule');
    const payload = normalizeRecurringRuleUpdatePayload(input, before);
    const changedFields = Object.keys(rawInput);
    const isLifecycleStopOnly = changedFields.length === 1
      && changedFields[0] === 'status'
      && (payload.status === 'paused' || payload.status === 'completed');
    if (!isLifecycleStopOnly) {
      await validateRecurringTemplateReferences(payload.templateJson, transaction);
    }

    const scheduleChanged = schedulesDiffer(before, payload);
    const explicitlyReactivated = before.status === 'completed' && payload.status !== 'completed';
    let nextRunDate = rule.nextRunDate;
    let status = payload.status;
    if (status === 'completed') {
      nextRunDate = null;
    } else if (scheduleChanged || explicitlyReactivated || !nextRunDate) {
      const today = dayjs(now).tz(payload.timezone).format('YYYY-MM-DD');
      const nextDate = computeFirstRecurringDateOnOrAfter(payload, today);
      if (payload.endDate && nextDate > payload.endDate) {
        status = 'completed';
        nextRunDate = null;
      } else {
        nextRunDate = recurringDateToInstant(nextDate, payload.timezone);
      }
    } else if (payload.endDate) {
      const currentNextDate = instantToRecurringDate(nextRunDate, payload.timezone);
      if (currentNextDate > payload.endDate) {
        status = 'completed';
        nextRunDate = null;
      }
    }

    await rule.update({
      ...payload,
      status,
      nextRunDate,
      completedAt: status === 'completed' ? rule.completedAt ?? now : null,
      ...(!isLifecycleStopOnly
        ? { lastError: null, lastErrorAt: null, consecutiveFailures: 0 }
        : {}),
      updatedBy: actorId,
    }, { transaction });

    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: rule.id,
      action: 'update',
      performedBy: actorId,
      changes: {
        before,
        after: recurringPayloadFromRule(rule),
      },
      metadata: {
        scheduleChanged,
        nextRunDate: rule.nextRunDate?.toISOString() ?? null,
      },
      transaction,
    });
    return rule;
  };
  return options.transaction
    ? updateWithinTransaction(options.transaction)
    : sequelize.transaction(updateWithinTransaction);
}

function occurrenceWhere(ruleId: number): ReturnType<typeof sequelizeWhere> {
  return sequelizeWhere(
    fn('jsonb_extract_path_text', col('meta'), 'recurring_rule_id'),
    String(ruleId),
  );
}

async function findExistingOccurrence(
  ruleId: number,
  runDate: string,
  transaction: SequelizeTransaction,
): Promise<FinanceTransaction | null> {
  return FinanceTransaction.findOne({
    where: {
      [Op.and]: [
        occurrenceWhere(ruleId),
        sequelizeWhere(
          fn('jsonb_extract_path_text', col('meta'), 'recurring_scheduled_for'),
          runDate,
        ),
      ],
    },
    transaction,
  });
}

type ProcessRuleResult = {
  createdTransactions: number;
  skipped: number;
  completed: boolean;
  deferred: boolean;
};

async function processRecurringRule(
  ruleId: number,
  actorId: number,
  now: Date,
  maxCatchUpPerRule: number,
): Promise<ProcessRuleResult> {
  return sequelize.transaction(async (transaction) => {
    const rule = await FinanceRecurringRule.findByPk(ruleId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!rule || rule.status !== 'active') {
      return { createdTransactions: 0, skipped: 1, completed: false, deferred: false };
    }

    const payload = recurringPayloadFromRule(rule);
    await validateRecurringTemplateReferences(payload.templateJson, transaction);
    const schedule = scheduleFromRule(rule);
    let nextDate = rule.nextRunDate
      ? instantToRecurringDate(rule.nextRunDate, rule.timezone)
      : scheduleOrigin(schedule);
    const nowInstant = dayjs(now);
    let createdTransactions = 0;
    let skipped = 0;
    let attempts = 0;
    let completed = false;
    const runDates: string[] = [];

    while (attempts < maxCatchUpPerRule) {
      if (rule.endDate && nextDate > rule.endDate) {
        completed = true;
        break;
      }
      const dueInstant = dayjs(recurringDateToInstant(nextDate, rule.timezone));
      if (dueInstant.isAfter(nowInstant)) {
        break;
      }

      attempts += 1;
      const existing = await findExistingOccurrence(rule.id, nextDate, transaction);
      if (existing) {
        skipped += 1;
      } else {
        const template = payload.templateJson;
        const meta = {
          ...(template.meta ?? {}),
          recurring_rule_id: rule.id,
          recurring_scheduled_for: nextDate,
        };
        const transactionInput: FinanceTransactionInput = {
          ...template,
          date: nextDate,
          status: 'planned',
          meta,
        };
        await createFinanceTransaction(transactionInput, actorId, { transaction });
        createdTransactions += 1;
        runDates.push(nextDate);
        await recordFinanceAuditLog({
          entity: 'finance_recurring_rule',
          entityId: rule.id,
          action: 'occurrence_create',
          performedBy: actorId,
          metadata: { scheduledFor: nextDate },
          transaction,
        });
      }
      nextDate = computeNextRecurringDate(schedule, nextDate);
    }

    if (!completed && rule.endDate && nextDate > rule.endDate) {
      completed = true;
    }
    const nextRunDate = completed ? null : recurringDateToInstant(nextDate, rule.timezone);
    const deferred = !completed && !dayjs(nextRunDate).isAfter(nowInstant);
    await rule.update({
      status: completed ? 'completed' : 'active',
      nextRunDate,
      lastRunAt: now,
      completedAt: completed ? now : null,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
    }, { transaction });

    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: rule.id,
      action: completed ? 'complete' : 'execute',
      performedBy: actorId,
      metadata: {
        attemptedOccurrences: attempts,
        createdTransactions,
        skippedOccurrences: skipped,
        scheduledDates: runDates,
        deferred,
        nextRunDate: nextRunDate?.toISOString() ?? null,
      },
      transaction,
    });

    return { createdTransactions, skipped, completed, deferred };
  });
}

function safeExecutionLimit(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}

async function recordRuleFailure(ruleId: number, actorId: number, now: Date, error: unknown): Promise<void> {
  const message = errorMessage(error);
  try {
    await FinanceRecurringRule.update({
      lastError: message,
      lastErrorAt: now,
      consecutiveFailures: literal('COALESCE(consecutive_failures, 0) + 1'),
    }, { where: { id: ruleId } });
    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: ruleId,
      action: 'execute_failed',
      performedBy: actorId,
      metadata: { message },
    });
  } catch {
    // The original rule failure is more useful to callers than a secondary
    // health-recording failure. The job logger still receives the original.
  }
}

export async function executeRecurringRules(
  userId: number,
  options: ExecuteRecurringRulesOptions = {},
): Promise<RecurringRuleExecutionResult> {
  const now = options.now ?? new Date();
  const maxCatchUpPerRule = safeExecutionLimit(
    options.maxCatchUpPerRule,
    DEFAULT_MAX_CATCH_UP_PER_RULE,
    MAX_CATCH_UP_LIMIT,
  );
  const ruleBatchSize = safeExecutionLimit(
    options.ruleBatchSize,
    DEFAULT_RULE_BATCH_SIZE,
    MAX_RULE_BATCH_SIZE,
  );
  const rules = await FinanceRecurringRule.findAll({
    attributes: ['id'],
    where: {
      status: 'active',
      [Op.or]: [
        { nextRunDate: { [Op.lte]: now } },
        { nextRunDate: null },
        { endDate: { [Op.lt]: dayjs(now).utc().format('YYYY-MM-DD') } },
      ],
    },
    order: [['nextRunDate', 'ASC'], ['id', 'ASC']],
    limit: ruleBatchSize,
  });

  const result: RecurringRuleExecutionResult = {
    processed: 0,
    createdTransactions: 0,
    skipped: 0,
    failed: 0,
    completed: 0,
    deferred: 0,
    failures: [],
  };

  for (const candidate of rules) {
    result.processed += 1;
    try {
      const ruleResult = await processRecurringRule(candidate.id, userId, now, maxCatchUpPerRule);
      result.createdTransactions += ruleResult.createdTransactions;
      result.skipped += ruleResult.skipped;
      result.completed += ruleResult.completed ? 1 : 0;
      result.deferred += ruleResult.deferred ? 1 : 0;
    } catch (error) {
      result.failed += 1;
      const failure = { ruleId: candidate.id, message: errorMessage(error) };
      result.failures.push(failure);
      await recordRuleFailure(candidate.id, userId, now, error);
    }
  }

  return result;
}

function normalizeOccurrencePagination(limitValue: unknown, offsetValue: unknown): {
  limit: number;
  offset: number;
} {
  const rawLimit = Number(limitValue);
  const rawOffset = Number(offsetValue);
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_OCCURRENCE_LIMIT)
    : DEFAULT_OCCURRENCE_LIMIT;
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  return { limit, offset };
}

export async function listFinanceRecurringRuleOccurrences(
  ruleId: number,
  options: { limit?: unknown; offset?: unknown } = {},
): Promise<RecurringRuleOccurrenceList> {
  const rule = await FinanceRecurringRule.findByPk(ruleId, { attributes: ['id'] });
  if (!rule) {
    throw new HttpError(404, 'Recurring rule not found');
  }
  const { limit, offset } = normalizeOccurrencePagination(options.limit, options.offset);
  const { count, rows } = await FinanceTransaction.findAndCountAll({
    where: { [Op.and]: [occurrenceWhere(ruleId)] },
    include: [
      { model: FinanceAccount, as: 'account', required: false },
      { model: FinanceCategory, as: 'category', required: false },
      { model: FinanceVendor, as: 'vendor', required: false },
      { model: FinanceClient, as: 'client', required: false },
    ],
    order: [
      literal(
        `jsonb_extract_path_text("FinanceTransaction"."meta", 'recurring_scheduled_for') DESC NULLS LAST`,
      ),
      ['id', 'DESC'],
    ],
    limit,
    offset,
    distinct: true,
  });
  const total = Number(count);
  return {
    data: rows,
    meta: {
      count: total,
      limit,
      offset,
    },
  };
}

async function findLockedOccurrence(
  ruleId: number,
  transactionId: number,
  transaction: SequelizeTransaction,
): Promise<FinanceTransaction> {
  const rule = await FinanceRecurringRule.findByPk(ruleId, {
    attributes: ['id'],
    transaction,
  });
  if (!rule) {
    throw new HttpError(404, 'Recurring rule not found');
  }
  const occurrence = await FinanceTransaction.findOne({
    where: {
      id: transactionId,
      [Op.and]: [occurrenceWhere(ruleId)],
    },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!occurrence) {
    throw new HttpError(404, 'Recurring occurrence not found');
  }
  return occurrence;
}

export async function postFinanceRecurringRuleOccurrence(
  ruleId: number,
  transactionId: number,
  actorId: number,
): Promise<RecurringOccurrenceMutationResult> {
  return sequelize.transaction(async (transaction) => {
    const occurrence = await findLockedOccurrence(ruleId, transactionId, transaction);
    if (occurrence.status === 'paid') {
      return { transaction: occurrence, changed: false };
    }
    if (occurrence.status !== 'planned' && occurrence.status !== 'approved') {
      throw new HttpError(409, `Only unposted recurring occurrences can be posted; current status is ${occurrence.status}`);
    }
    const previousStatus = occurrence.status;
    const updated = await updateFinanceTransaction(
      occurrence.id,
      { status: 'paid' },
      actorId,
      { transaction },
    );
    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: ruleId,
      action: 'occurrence_post',
      performedBy: actorId,
      metadata: { transactionId: occurrence.id, previousStatus },
      transaction,
    });
    return { transaction: updated, changed: true };
  });
}

export async function voidFinanceRecurringRuleOccurrence(
  ruleId: number,
  transactionId: number,
  actorId: number,
): Promise<RecurringOccurrenceMutationResult> {
  return sequelize.transaction(async (transaction) => {
    const occurrence = await findLockedOccurrence(ruleId, transactionId, transaction);
    if (occurrence.status === 'void') {
      return { transaction: occurrence, changed: false };
    }
    if (occurrence.status !== 'planned' && occurrence.status !== 'approved') {
      throw new HttpError(409, `Only unposted recurring occurrences can be voided; current status is ${occurrence.status}`);
    }
    const previousStatus = occurrence.status;
    const updated = await updateFinanceTransaction(
      occurrence.id,
      { status: 'void' },
      actorId,
      { transaction },
    );
    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: ruleId,
      action: 'occurrence_void',
      performedBy: actorId,
      metadata: { transactionId: occurrence.id, previousStatus },
      transaction,
    });
    return { transaction: updated, changed: true };
  });
}
