import crypto from "crypto";
import { Request, Response } from "express";
import { Association, ModelAttributeColumnOptions, Op, QueryTypes, type ModelAttributeColumnReferencesOptions } from "sequelize";
import { Model, ModelCtor, Sequelize } from "sequelize-typescript";
import dayjs from "dayjs";
import Counter from "../models/Counter.js";
import CounterChannelMetric from "../models/CounterChannelMetric.js";
import CounterProduct from "../models/CounterProduct.js";
import CounterUser from "../models/CounterUser.js";
import User from "../models/User.js";
import StaffProfile from "../models/StaffProfile.js";
import UserShiftRole from "../models/UserShiftRole.js";
import ReviewCounter from "../models/ReviewCounter.js";
import ReviewCounterEntry from "../models/ReviewCounterEntry.js";
import ReportTemplate, {
  ReportTemplateFieldSelection,
  ReportTemplateOptions,
  ReportTemplateDerivedField,
  ReportTemplateMetricSpotlight,
  PreviewOrderRule,
} from "../models/ReportTemplate.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import type { DerivedFieldExpressionAst } from "../types/DerivedFieldExpressionAst.js";
import sequelize from "../config/database.js";
import {
  computeQueryHash,
  getCachedQueryResult,
  storeQueryCacheEntry,
  enqueueQueryJob,
  getAsyncJobStatus,
  type QueryExecutionResult,
} from "../services/reporting/reportQueryService.js";
import { PreviewQueryError } from "../errors/PreviewQueryError.js";
import { ensureReportingAccess } from "../utils/reportingAccess.js";
import { normalizeDerivedFieldExpressionAst } from "../utils/derivedFieldExpression.js";
import CompensationComponent, {
  type CompensationCalculationMethod,
  type CompensationComponentCategory,
} from "../models/CompensationComponent.js";
import CompensationComponentAssignment from "../models/CompensationComponentAssignment.js";
import AssistantManagerTaskLog, { type AssistantManagerTaskStatus } from "../models/AssistantManagerTaskLog.js";
import { fetchLeaderNightReportStats, type NightReportStatsMap } from "../services/nightReportMetricsService.js";
import Product from "../models/Product.js";

type CommissionBreakdownEntry = {
  date: string;
  commission: number;
  customers: number;
  guidesCount: number;
  counterId: number;
  productId: number | null;
  productName: string;
};

type ReviewTotals = {
  totalEligibleReviews: number;
};

type PlatformGuestTotals = {
  totalGuests: number;
  totalBooked: number;
  totalAttended: number;
};

type PlatformGuestTierBreakdown = {
  tierIndex: number;
  rate: number;
  units: number;
  amount: number;
  cumulativeGuests: number;
};

type LockedComponentRequirement = {
  type: "review_target";
  minReviews: number;
  actualReviews: number;
};

type LockedComponentEntry = {
  componentId: number;
  name: string;
  category: CompensationComponentCategory;
  calculationMethod: CompensationCalculationMethod;
  amount: number;
  requirement: LockedComponentRequirement;
};

type ProductComponentTotal = {
  componentId: number;
  amount: number;
};

type ProductPayoutSummary = {
  productId: number | null;
  productName: string;
  counterIds: number[];
  totalCustomers: number;
  totalCommission: number;
  componentTotals: ProductComponentTotal[];
};

type CommissionSummary = {
  userId: number;
  firstName: string;
  totalCommission: number;
  totalCustomers: number;
  breakdown: CommissionBreakdownEntry[];
  componentTotals: Array<{
    componentId: number;
    name: string;
    category: CompensationComponentCategory;
    calculationMethod: CompensationCalculationMethod;
    amount: number;
  }>;
  bucketTotals: Record<string, number>;
  totalPayout: number;
  productTotals: ProductPayoutSummary[];
  counterIncentiveMarkers: Record<string, string[]>;
  counterIncentiveTotals: Record<string, number>;
  reviewTotals: ReviewTotals;
  platformGuestTotals: PlatformGuestTotals;
  platformGuestBreakdowns: Record<number, PlatformGuestTierBreakdown[]>;
  lockedComponents: LockedComponentEntry[];
};

type GuideDailyBreakdown = {
  userId: number;
  firstName: string;
  commission: number;
  customers: number;
};

type DailyAggregate = {
  dateKey: string;
  counterId: number;
  productId: number | null;
  productName: string;
  totalCustomers: number;
  guides: Map<number, GuideDailyBreakdown>;
};

type CounterMeta = {
  dateKey: string;
  isNewSystem: boolean;
  productId: number | null;
  productName: string;
};

type ProductBucket = {
  productId: number | null;
  productName: string;
  counterIds: Set<number>;
  totalCustomers: number;
  totalCommission: number;
  componentTotals: Map<number, number>;
};

type ProductBucketLookup = Map<number, Map<string, ProductBucket>>;

const FULL_ACCESS_ROLE_SLUGS = new Set([
  "admin",
  "owner",
  "manager",
  "assistant-manager",
  "assistant_manager",
  "assistantmanager",
]);

const COMMISSION_RATE_PER_ATTENDEE = 6;
const NEW_COUNTER_SYSTEM_START = dayjs("2025-10-01");
const REVIEW_MINIMUM_THRESHOLD = 15;

type DialectQuoter = {
  quoteTable: (value: string | { tableName: string; schema?: string }) => string;
  quoteIdentifier: (value: string) => string;
};

const getDialectQuoter = (): DialectQuoter => {
  const queryInterface = sequelize.getQueryInterface() as unknown as {
    quoteTable?: DialectQuoter["quoteTable"];
    quoteIdentifier?: DialectQuoter["quoteIdentifier"];
    queryGenerator?: DialectQuoter;
  };

  if (
    queryInterface &&
    typeof queryInterface.quoteTable === "function" &&
    typeof queryInterface.quoteIdentifier === "function"
  ) {
    return {
      quoteTable: queryInterface.quoteTable.bind(queryInterface),
      quoteIdentifier: queryInterface.quoteIdentifier.bind(queryInterface),
    };
  }

  const generator = queryInterface?.queryGenerator;
  if (
    generator &&
    typeof generator.quoteTable === "function" &&
    typeof generator.quoteIdentifier === "function"
  ) {
    return {
      quoteTable: generator.quoteTable.bind(generator),
      quoteIdentifier: generator.quoteIdentifier.bind(generator),
    };
  }

  return {
    quoteTable: (value) => {
      if (typeof value === "string") {
        return `"${value.replace(/"/g, '""')}"`;
      }
      const table = `"${value.tableName.replace(/"/g, '""')}"`;
      const schema = value.schema ? `"${value.schema.replace(/"/g, '""')}"` : null;
      return schema ? `${schema}.${table}` : table;
    },
    quoteIdentifier: (value) => `"${value.replace(/"/g, '""')}"`,
  };
};

type ReportModelFieldDescriptor = {
  fieldName: string;
  columnName: string;
  type: string;
  allowNull: boolean;
  primaryKey: boolean;
  defaultValue: string | number | boolean | null;
  unique: boolean;
  references?: {
    model: string | null;
    key?: string | null;
  };
};

type ReportModelAssociationDescriptor = {
  name: string | null;
  targetModel: string;
  associationType: string;
  foreignKey?: string;
  sourceKey?: string;
  through?: string | null;
  as?: string;
};

type ReportModelDescriptor = {
  id: string;
  name: string;
  tableName: string;
  schema?: string;
  description: string;
  connection: string;
  recordCount: string;
  lastSynced: string;
  primaryKeys: string[];
  primaryKey: string | null;
  fields: ReportModelFieldDescriptor[];
  associations: ReportModelAssociationDescriptor[];
};

type DerivedFieldQueryPayload = {
  id: string;
  alias?: string;
  expressionAst: DerivedFieldExpressionAst;
  referencedModels?: string[];
  joinDependencies?: Array<[string, string]>;
  modelGraphSignature?: string | null;
  compiledSqlHash?: string | null;
};

type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "is_null"
  | "is_not_null"
  | "is_true"
  | "is_false";

type PreviewFilterClausePayload = {
  leftModelId: string;
  leftFieldId: string;
  operator: FilterOperator;
  rightType: "value" | "field";
  rightModelId?: string;
  rightFieldId?: string;
  value?: string | number | boolean | null;
  valueKind?: "string" | "number" | "date" | "boolean";
};

type PreviewOrderClausePayload = {
  source: "model" | "derived";
  modelId?: string | null;
  fieldId: string;
  direction?: "asc" | "desc";
};

const DERIVED_FIELD_SENTINEL = "__derived__";

const formatDerivedFieldLabel = (field: DerivedFieldQueryPayload, index: number): string => {
  if (field.alias && field.alias.trim().length > 0) {
    return field.alias.trim();
  }
  if (field.id && field.id.trim().length > 0) {
    return field.id.trim();
  }
  return `derived_${index + 1}`;
};

type DerivedFieldValidationIssue = {
  fieldId: string;
  reason: "graph_mismatch" | "missing_model" | "unjoined_model";
  models?: string[];
};

const raiseDerivedFieldStaleError = (issues: DerivedFieldValidationIssue[]): never => {
  throw new PreviewQueryError("Resolve derived field issues before running this query.", 400, {
    code: "DERIVED_FIELD_STALE",
    issues,
  });
};

const toDerivedFieldIssueFieldId = (field: DerivedFieldQueryPayload, index: number): string => {
  if (typeof field.id === "string" && field.id.trim().length > 0) {
    return field.id.trim();
  }
  return formatDerivedFieldLabel(field, index);
};

const validateDerivedFieldGraph = (
  derivedFields: DerivedFieldQueryPayload[],
  models: string[],
  joins: ReportPreviewRequest["joins"] | QueryConfig["joins"] | undefined,
  aliasMap: Map<string, string>,
) => {
  if (!derivedFields || derivedFields.length === 0) {
    return;
  }
  const currentGraphSignature = computeModelGraphSignature(models, joins ?? []);
  const issues: DerivedFieldValidationIssue[] = [];
  derivedFields.forEach((field, index) => {
    const fieldId = toDerivedFieldIssueFieldId(field, index);
    if (
      field.modelGraphSignature &&
      currentGraphSignature &&
      field.modelGraphSignature !== currentGraphSignature
    ) {
      issues.push({
        fieldId,
        reason: "graph_mismatch",
      });
    }
    const referencedModels = Array.isArray(field.referencedModels) ? field.referencedModels : [];
    const missingModels = referencedModels.filter((modelId) => !aliasMap.has(modelId));
    if (missingModels.length > 0) {
      issues.push({
        fieldId,
        reason: "missing_model",
        models: missingModels,
      });
    }
  });
  if (issues.length > 0) {
    raiseDerivedFieldStaleError(issues);
  }
};

const validateDerivedFieldJoinCoverage = (
  derivedFields: DerivedFieldQueryPayload[],
  joinedModels: Set<string>,
) => {
  if (!derivedFields || derivedFields.length === 0) {
    return;
  }
  const issues: DerivedFieldValidationIssue[] = [];
  derivedFields.forEach((field, index) => {
    const referencedModels = Array.isArray(field.referencedModels) ? field.referencedModels : [];
    const unmetModels = referencedModels.filter((modelId) => !joinedModels.has(modelId));
    if (unmetModels.length > 0) {
      issues.push({
        fieldId: toDerivedFieldIssueFieldId(field, index),
        reason: "unjoined_model",
        models: unmetModels,
      });
    }
  });
  if (issues.length > 0) {
    raiseDerivedFieldStaleError(issues);
  }
};

type ReportPreviewRequest = {
  models: string[];
  fields: Array<{ modelId: string; fieldIds: string[] }>;
  joins?: Array<{
    id: string;
    leftModel: string;
    leftField: string;
    rightModel: string;
    rightField: string;
    joinType?: "inner" | "left" | "right" | "full";
    description?: string;
  }>;
  filters?: Array<string | PreviewFilterClausePayload>;
  orderBy?: PreviewOrderClausePayload[];
  limit?: number;
  derivedFields?: DerivedFieldQueryPayload[];
};

type ReportPreviewResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sql: string;
};

export type QueryConfigFieldRef = {
  modelId: string;
  fieldId: string;
};

export type QueryConfigSelect = QueryConfigFieldRef & {
  alias?: string;
};

export type QueryConfigMetric = QueryConfigFieldRef & {
  alias?: string;
  aggregation: "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
};

export type QueryConfigDimension = QueryConfigFieldRef & {
  alias?: string;
  bucket?: "hour" | "day" | "week" | "month" | "quarter" | "year";
};

export type QueryConfigFilterValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number | boolean | null>
  | { from?: string | number; to?: string | number };

export type QueryConfigFilter = QueryConfigFieldRef & {
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "between";
  value: QueryConfigFilterValue;
};

export type QueryConfigOrderBy = {
  alias: string;
  direction?: "asc" | "desc";
};

export type QueryConfigOptions = {
  allowAsync?: boolean;
  cacheTtlSeconds?: number;
  forceAsync?: boolean;
  templateId?: string | null;
};

export type QueryConfig = {
  models: string[];
  select?: QueryConfigSelect[];
  metrics?: QueryConfigMetric[];
  dimensions?: QueryConfigDimension[];
  filters?: QueryConfigFilter[];
  orderBy?: QueryConfigOrderBy[];
  derivedFields?: DerivedFieldQueryPayload[];
  joins?: ReportPreviewRequest["joins"];
  limit?: number;
  options?: QueryConfigOptions;
};

type TemplateOptionsInput = {
  autoDistribution?: unknown;
  notifyTeam?: unknown;
  columnOrder?: unknown;
  columnAliases?: unknown;
  previewOrder?: unknown;
  autoRunOnOpen?: unknown;
};

type TemplatePayloadInput = {
  name?: unknown;
  category?: unknown;
  description?: unknown;
  schedule?: unknown;
  models?: unknown;
  fields?: unknown;
  joins?: unknown;
  visuals?: unknown;
  metrics?: unknown;
  filters?: unknown;
  options?: TemplateOptionsInput | null;
  columnOrder?: unknown;
  columnAliases?: unknown;
  previewOrder?: unknown;
  queryConfig?: unknown;
  derivedFields?: unknown;
  metricsSpotlight?: unknown;
};

type SerializedReportTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  schedule: string;
  models: string[];
  fields: ReportTemplateFieldSelection[];
  joins: unknown[];
  visuals: unknown[];
  metrics: string[];
  filters: unknown[];
  options: ReportTemplateOptions;
  queryConfig: unknown | null;
  derivedFields: ReportTemplateDerivedField[];
  metricsSpotlight: ReportTemplateMetricSpotlight[];
  columnOrder: string[];
  columnAliases: Record<string, string>;
  previewOrder: PreviewOrderRule[];
  autoRunOnOpen: boolean;
  owner: {
    id: number | null;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_TEMPLATE_OPTIONS: ReportTemplateOptions = {
  autoDistribution: true,
  notifyTeam: true,
  columnOrder: [],
  columnAliases: {},
  previewOrder: [],
  autoRunOnOpen: false,
};

const modelDescriptorCache = new Map<string, ReportModelDescriptor>();

const toStringOr = (value: unknown, fallback: string): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }
  return fallback;
};

const toNullableString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const toTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry): entry is string => entry.length > 0)
    : [];

const toFieldSelections = (value: unknown): ReportTemplateFieldSelection[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const modelId = typeof candidate.modelId === "string" ? candidate.modelId : null;
      const rawFieldIds = candidate.fieldIds;
      const fieldIds = Array.isArray(rawFieldIds)
        ? rawFieldIds.filter((fieldId): fieldId is string => typeof fieldId === "string")
        : [];

      if (!modelId) {
        return null;
      }

      return { modelId, fieldIds };
    })
    .filter((value): value is ReportTemplateFieldSelection => Boolean(value));
};

const toUnknownArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toColumnOrder = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const ordered: string[] = [];
  value.forEach((entry) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0 && !seen.has(trimmed)) {
        seen.add(trimmed);
        ordered.push(trimmed);
      }
    }
  });
  return ordered;
};

const toColumnAliasMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const aliases: Record<string, string> = {};
  entries.forEach(([key, rawValue]) => {
    if (typeof key === "string" && typeof rawValue === "string") {
      const trimmedKey = key.trim();
      const trimmedValue = rawValue.trim();
      if (trimmedKey.length > 0 && trimmedValue.length > 0) {
        aliases[trimmedKey] = trimmedValue;
      }
    }
  });
  return aliases;
};

const toPreviewOrderRules = (value: unknown): PreviewOrderRule[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const rules: PreviewOrderRule[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.trim().length > 0
        ? record.id.trim()
        : `order-${index}`;
    const direction = record.direction === "desc" ? "desc" : "asc";
    const source = record.source === "derived" ? "derived" : "model";
    const fieldId = typeof record.fieldId === "string" ? record.fieldId.trim() : "";
    if (!fieldId) {
      return;
    }
    const modelId =
      source === "derived"
        ? null
        : typeof record.modelId === "string" && record.modelId.trim().length > 0
        ? record.modelId.trim()
        : null;
    rules.push({
      id,
      source,
      modelId,
      fieldId,
      direction,
    });
  });
  return rules;
};

const toReferencedFieldMap = (value: unknown): Record<string, string[]> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const references: Record<string, string[]> = {};
  entries.forEach(([modelId, fields]) => {
    if (typeof modelId !== "string" || !Array.isArray(fields)) {
      return;
    }
    const trimmedModel = modelId.trim();
    if (!trimmedModel) {
      return;
    }
    const uniqueFields = Array.from(
      new Set(
        fields
          .map((field) => (typeof field === "string" ? field.trim() : ""))
          .filter((field) => field.length > 0),
      ),
    );
    if (uniqueFields.length > 0) {
      references[trimmedModel] = uniqueFields;
    }
  });
  return references;
};

const toJoinDependencyPairs = (value: unknown): Array<[string, string]> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const dependencies: Array<[string, string]> = [];
  value.forEach((entry) => {
    let left: string | null = null;
    let right: string | null = null;
    if (Array.isArray(entry) && entry.length === 2) {
      left = typeof entry[0] === "string" ? entry[0].trim() : null;
      right = typeof entry[1] === "string" ? entry[1].trim() : null;
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      left = typeof record.left === "string" ? record.left.trim() : null;
      right = typeof record.right === "string" ? record.right.trim() : null;
    }
    if (!left || !right || left === right) {
      return;
    }
    const ordered: [string, string] = left < right ? [left, right] : [right, left];
    const signature = `${ordered[0]}|${ordered[1]}`;
    if (!seen.has(signature)) {
      seen.add(signature);
      dependencies.push(ordered);
    }
  });
  dependencies.sort(([aLeft, aRight], [bLeft, bRight]) => {
    if (aLeft === bLeft) {
      return aRight.localeCompare(bRight);
    }
    return aLeft.localeCompare(bLeft);
  });
  return dependencies;
};

type JoinSignatureDescriptor = {
  leftModel: string;
  leftField: string;
  rightModel: string;
  rightField: string;
  joinType: string;
  id?: string;
};

const normalizeModelsForSignature = (models: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  models.forEach((modelId) => {
    const trimmed = toTrimmedString(modelId);
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  normalized.sort();
  return normalized;
};

const normalizeJoinsForSignature = (joins: unknown[]): JoinSignatureDescriptor[] => {
  if (!Array.isArray(joins)) {
    return [];
  }
  const allowedJoinTypes = new Set(["inner", "left", "right", "full"]);
  const normalized: JoinSignatureDescriptor[] = [];
  joins.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const leftModel = toTrimmedString(candidate.leftModel);
    const rightModel = toTrimmedString(candidate.rightModel);
    const leftField = toTrimmedString(candidate.leftField);
    const rightField = toTrimmedString(candidate.rightField);
    if (!leftModel || !rightModel || !leftField || !rightField) {
      return;
    }
    const joinTypeRaw = toTrimmedString(candidate.joinType).toLowerCase();
    const joinType = allowedJoinTypes.has(joinTypeRaw) ? joinTypeRaw : "left";
    const descriptor: JoinSignatureDescriptor = {
      leftModel,
      leftField,
      rightModel,
      rightField,
      joinType,
    };
    const id = toTrimmedString(candidate.id);
    if (id) {
      descriptor.id = id;
    }
    normalized.push(descriptor);
  });
  normalized.sort((a, b) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    return left.localeCompare(right);
  });
  return normalized;
};

const computeModelGraphSignature = (models: string[], joins: unknown[]): string | null => {
  const normalizedModels = normalizeModelsForSignature(models);
  if (normalizedModels.length === 0) {
    return null;
  }
  const normalizedJoins = normalizeJoinsForSignature(joins);
  const canonical = JSON.stringify({
    models: normalizedModels,
    joins: normalizedJoins,
  });
  return crypto.createHash("sha1").update(canonical).digest("hex");
};

const toDerivedFieldArray = (value: unknown): ReportTemplateDerivedField[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index): ReportTemplateDerivedField | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const expression = typeof candidate.expression === "string" ? candidate.expression.trim() : "";
      if (!name || !expression) {
        return null;
      }
      const astResult = normalizeDerivedFieldExpressionAst(candidate.expressionAst);
      const expressionAst = astResult?.ast ?? null;
      const referencedModels = astResult?.referencedModels ?? [];
      const referencedFields =
        astResult?.referencedFields ?? toReferencedFieldMap(candidate.referencedFields);
      const joinDependencies =
        astResult?.joinDependencies ?? toJoinDependencyPairs(candidate.joinDependencies);
      const compiledSqlHash = astResult?.compiledSqlHash ?? toTrimmedString(candidate.compiledSqlHash);
      const id =
        typeof candidate.id === "string" && candidate.id.trim().length > 0
          ? candidate.id.trim()
          : `derived-${index}`;
      const kind =
        candidate.kind === "aggregate" || candidate.kind === "row"
          ? (candidate.kind as "aggregate" | "row")
          : "row";
      const metadata =
        candidate.metadata && typeof candidate.metadata === "object" && !Array.isArray(candidate.metadata)
          ? (candidate.metadata as Record<string, unknown>)
          : {};
      const modelGraphSignature =
        typeof candidate.modelGraphSignature === "string" && candidate.modelGraphSignature.trim().length > 0
          ? candidate.modelGraphSignature.trim()
          : null;
      const status =
        candidate.status === "stale" ? "stale" : candidate.status === "active" ? "active" : undefined;
      return {
        id,
        name,
        expression,
        kind,
        scope: "template",
        metadata,
        expressionAst,
        referencedModels,
        referencedFields,
        joinDependencies,
        modelGraphSignature,
        compiledSqlHash: compiledSqlHash || null,
        ...(status ? { status } : {}),
      };
    })
    .filter((entry): entry is ReportTemplateDerivedField => Boolean(entry));
};

const toMetricsSpotlightArray = (value: unknown): ReportTemplateMetricSpotlight[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const allowedComparisons = new Set(["previous", "wow", "mom", "yoy"]);
  const allowedFormats = new Set(["number", "currency", "percentage"]);
  return value
    .map((entry): ReportTemplateMetricSpotlight | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const candidate = entry as Record<string, unknown>;
      const metric = typeof candidate.metric === "string" ? candidate.metric.trim() : "";
      if (!metric) {
        return null;
      }
      const label =
        typeof candidate.label === "string" && candidate.label.trim().length > 0
          ? candidate.label.trim()
          : metric;
      const targetValue = candidate.target;
      let target: number | undefined;
      if (typeof targetValue === "number" && Number.isFinite(targetValue)) {
        target = targetValue;
      } else if (typeof targetValue === "string" && targetValue.trim().length > 0) {
        const parsed = Number(targetValue);
        if (Number.isFinite(parsed)) {
          target = parsed;
        }
      }
      const comparisonRaw =
        typeof candidate.comparison === "string" ? candidate.comparison.trim().toLowerCase() : undefined;
      const comparison =
        comparisonRaw && allowedComparisons.has(comparisonRaw)
          ? (comparisonRaw as "previous" | "wow" | "mom" | "yoy")
          : undefined;
      const formatRaw =
        typeof candidate.format === "string" ? candidate.format.trim().toLowerCase() : undefined;
      const format =
        formatRaw && allowedFormats.has(formatRaw)
          ? (formatRaw as "number" | "currency" | "percentage")
          : undefined;
      return {
        metric,
        label,
        target,
        comparison,
        format,
      };
    })
    .filter((entry): entry is ReportTemplateMetricSpotlight => Boolean(entry));
};

const normalizeTemplatePayload = (input: TemplatePayloadInput) => {
  const optionsCandidate =
    input.options && typeof input.options === "object" && !Array.isArray(input.options)
      ? (input.options as TemplateOptionsInput)
      : undefined;
  const columnOrder = toColumnOrder(
    input.columnOrder !== undefined ? input.columnOrder : optionsCandidate?.columnOrder,
  );
  const columnAliases = toColumnAliasMap(
    input.columnAliases !== undefined ? input.columnAliases : optionsCandidate?.columnAliases,
  );
  const previewOrderInput =
    input.previewOrder !== undefined ? input.previewOrder : optionsCandidate?.previewOrder;
  const previewOrder = toPreviewOrderRules(previewOrderInput);
  const autoRunOnOpen =
    typeof optionsCandidate?.autoRunOnOpen === "boolean"
      ? optionsCandidate.autoRunOnOpen
      : DEFAULT_TEMPLATE_OPTIONS.autoRunOnOpen;

  const options: ReportTemplateOptions = {
    autoDistribution:
      typeof optionsCandidate?.autoDistribution === "boolean"
        ? optionsCandidate.autoDistribution
        : DEFAULT_TEMPLATE_OPTIONS.autoDistribution,
    notifyTeam:
      typeof optionsCandidate?.notifyTeam === "boolean"
        ? optionsCandidate.notifyTeam
        : DEFAULT_TEMPLATE_OPTIONS.notifyTeam,
    columnOrder,
    columnAliases,
    previewOrder,
    autoRunOnOpen,
  };

  const models = toStringArray(input.models);
  const joins = toUnknownArray(input.joins);
  const derivedFieldsRaw = toDerivedFieldArray(input.derivedFields);
  const modelGraphSignature = computeModelGraphSignature(models, joins);
  const derivedFields =
    derivedFieldsRaw.length === 0
      ? derivedFieldsRaw
      : derivedFieldsRaw.map((field) => ({
          ...field,
          modelGraphSignature: modelGraphSignature ?? field.modelGraphSignature ?? null,
        }));

  return {
    name: toStringOr(input.name, ""),
    category: toNullableString(input.category),
    description: toNullableString(input.description),
    schedule: toStringOr(input.schedule, "Manual"),
    models,
    fields: toFieldSelections(input.fields),
    joins,
    visuals: toUnknownArray(input.visuals),
    metrics: toStringArray(input.metrics),
    filters: toUnknownArray(input.filters),
    queryConfig: input.queryConfig && typeof input.queryConfig === "object" ? input.queryConfig : null,
    derivedFields,
    metricsSpotlight: toMetricsSpotlightArray(input.metricsSpotlight),
    previewOrder,
    options,
  };
};

const serializeReportTemplate = (
  template: ReportTemplate & { owner?: User | null },
): SerializedReportTemplate => {
  const owner = template.owner ?? null;
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Shared";
  const rawOptions = template.options ?? DEFAULT_TEMPLATE_OPTIONS;
  const templatePreviewOrder =
    Array.isArray(template.previewOrder) && template.previewOrder.length > 0
      ? toPreviewOrderRules(template.previewOrder)
      : [];
  const mergedOptions: ReportTemplateOptions = {
    autoDistribution:
      typeof rawOptions.autoDistribution === "boolean"
        ? rawOptions.autoDistribution
        : DEFAULT_TEMPLATE_OPTIONS.autoDistribution,
    notifyTeam:
      typeof rawOptions.notifyTeam === "boolean"
        ? rawOptions.notifyTeam
        : DEFAULT_TEMPLATE_OPTIONS.notifyTeam,
    columnOrder: toColumnOrder(
      Array.isArray(rawOptions.columnOrder) ? rawOptions.columnOrder : DEFAULT_TEMPLATE_OPTIONS.columnOrder,
    ),
    columnAliases: toColumnAliasMap(
      rawOptions.columnAliases !== undefined ? rawOptions.columnAliases : DEFAULT_TEMPLATE_OPTIONS.columnAliases,
    ),
    previewOrder:
      templatePreviewOrder.length > 0
        ? templatePreviewOrder
        : Array.isArray(rawOptions.previewOrder) && rawOptions.previewOrder.length > 0
        ? toPreviewOrderRules(rawOptions.previewOrder)
        : [],
    autoRunOnOpen:
      typeof rawOptions.autoRunOnOpen === "boolean"
        ? rawOptions.autoRunOnOpen
        : DEFAULT_TEMPLATE_OPTIONS.autoRunOnOpen,
  };

  const serializedPreviewOrder =
    templatePreviewOrder.length > 0 ? templatePreviewOrder : mergedOptions.previewOrder;

  return {
    id: template.id,
    name: template.name,
    category: template.category ?? "Custom",
    description: template.description ?? "",
    schedule: template.schedule ?? "Manual",
    models: Array.isArray(template.models) ? template.models : [],
    fields: Array.isArray(template.fields) ? template.fields : [],
    joins: Array.isArray(template.joins) ? template.joins : [],
    visuals: Array.isArray(template.visuals) ? template.visuals : [],
    metrics: Array.isArray(template.metrics) ? template.metrics : [],
    filters: Array.isArray(template.filters) ? template.filters : [],
    options: mergedOptions,
    queryConfig: template.queryConfig ?? null,
    derivedFields: Array.isArray(template.derivedFields)
      ? template.derivedFields.map((field, index) => {
          const metadata =
            field.metadata && typeof field.metadata === "object" && !Array.isArray(field.metadata)
              ? field.metadata
              : undefined;
          return {
            ...field,
            id: field.id ?? `derived-${index}`,
            expressionAst: field.expressionAst ?? null,
            referencedModels: Array.isArray(field.referencedModels) ? field.referencedModels : [],
            referencedFields: toReferencedFieldMap(field.referencedFields),
            joinDependencies: toJoinDependencyPairs(field.joinDependencies),
            modelGraphSignature:
              typeof field.modelGraphSignature === "string" && field.modelGraphSignature.length > 0
                ? field.modelGraphSignature
                : null,
            compiledSqlHash:
              typeof field.compiledSqlHash === "string" && field.compiledSqlHash.length > 0
                ? field.compiledSqlHash
                : null,
            status: field.status === "stale" ? "stale" : undefined,
            ...(metadata ? { metadata } : {}),
          };
        })
      : [],
    metricsSpotlight: Array.isArray(template.metricsSpotlight) ? template.metricsSpotlight : [],
    columnOrder: [...mergedOptions.columnOrder],
    columnAliases: { ...mergedOptions.columnAliases },
    previewOrder: serializedPreviewOrder,
    autoRunOnOpen: mergedOptions.autoRunOnOpen,
    owner: {
      id: template.userId ?? null,
      name: ownerName.length > 0 ? ownerName : "Shared",
    },
    createdAt: template.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: template.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
};

export const getCommissionByDateRange = async (req: Request, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, scope } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json([{ message: "Start date and end date are required" }]);
      return;
    }

    const start = dayjs(startDate as string).startOf("day");
    const end = dayjs(endDate as string).endOf("day");

    const counters = await Counter.findAll({
      attributes: ["id", "date", "productId"],
      where: {
        date: {
          [Op.between]: [start.toDate(), end.toDate()],
        },
      },
      order: [["date", "ASC"]],
    });

    if (counters.length === 0) {
      res.status(404).json([{ message: "No data found for the specified date range" }]);
      return;
    }

    const counterMetaById = new Map<number, CounterMeta>();
    const legacyCounterIds: number[] = [];
    const newSystemCounterIds: number[] = [];
    const productIdsToResolve = new Set<number>();

    counters.forEach((counter) => {
      const rawDate = counter.getDataValue("date");
      if (!rawDate) {
        return;
      }

      const counterDate = dayjs(rawDate);
      const dateKey = counterDate.format("YYYY-MM-DD");
      const isNewSystem = !counterDate.isBefore(NEW_COUNTER_SYSTEM_START, "day");
      const productId = isNewSystem ? counter.getDataValue("productId") ?? null : null;
      if (isNewSystem && productId !== null) {
        productIdsToResolve.add(productId);
      }

      counterMetaById.set(counter.id, {
        dateKey,
        isNewSystem,
        productId,
        productName: "",
      });

      if (isNewSystem) {
        newSystemCounterIds.push(counter.id);
      } else {
        legacyCounterIds.push(counter.id);
      }
    });

    const legacyTotalsByCounter = new Map<number, number>();
    if (legacyCounterIds.length > 0) {
      const legacyRows = await CounterProduct.findAll({
        attributes: [
          "counterId",
          [Sequelize.fn("SUM", Sequelize.col("quantity")), "totalQuantity"],
        ],
        where: {
          counterId: {
            [Op.in]: legacyCounterIds,
          },
        },
        group: ["counterId"],
      });

      legacyRows.forEach((row) => {
        const counterId = row.getDataValue("counterId");
        const totalQuantity = Number(row.get("totalQuantity") ?? 0);
        legacyTotalsByCounter.set(counterId, totalQuantity);
      });
    }

    const newSystemTotalsByCounter = new Map<number, number>();
    if (newSystemCounterIds.length > 0) {
      const metricRows = await CounterChannelMetric.findAll({
        attributes: [
          "counterId",
          [Sequelize.fn("SUM", Sequelize.col("qty")), "attendedQty"],
        ],
        where: {
          counterId: {
            [Op.in]: newSystemCounterIds,
          },
          kind: "people",
          tallyType: "attended",
        },
        group: ["counterId"],
      });

      metricRows.forEach((row) => {
        const counterId = row.getDataValue("counterId");
        const attendedQty = Number(row.get("attendedQty") ?? 0);
        newSystemTotalsByCounter.set(counterId, attendedQty);
      });
    }

    const productNameById = new Map<number, string>();
    if (productIdsToResolve.size > 0) {
      const products = await Product.findAll({
        where: {
          id: {
            [Op.in]: Array.from(productIdsToResolve),
          },
        },
        attributes: ["id", "name"],
      });
      products.forEach((product) => {
        productNameById.set(product.id, product.name ?? `Product ${product.id}`);
      });
    }

    counterMetaById.forEach((meta) => {
      if (meta.productId !== null) {
        meta.productName = productNameById.get(meta.productId) ?? `Product ${meta.productId}`;
      } else if (meta.isNewSystem) {
        meta.productName = "Unassigned Product";
      } else {
        meta.productName = "Legacy Counter";
      }
    });

    const counterIds = counters.map((counter) => counter.id);
    const staffRecords = await CounterUser.findAll({
      attributes: ["counterId", "userId", "role"],
      include: [
        {
          model: User,
          as: "counterUser",
          attributes: ["firstName"],
        },
      ],
      where: {
        counterId: {
          [Op.in]: counterIds,
        },
      },
    });

    if (staffRecords.length === 0) {
      res.status(404).json([{ message: "No staff members found for the specified date range" }]);
      return;
    }

    const commissionDataByUser = new Map<number, CommissionSummary>();
    const productBucketsByUser: ProductBucketLookup = new Map();
    const staffByCounter = new Map<number, CounterUser[]>();

    staffRecords.forEach((staff) => {
      const counterId = staff.counterId;
      if (!staffByCounter.has(counterId)) {
        staffByCounter.set(counterId, []);
      }
      staffByCounter.get(counterId)!.push(staff);

      const userId = staff.userId;
      const firstName = staff.counterUser?.firstName ?? `User ${userId}`;

      if (!commissionDataByUser.has(userId)) {
        commissionDataByUser.set(userId, createEmptySummary(userId, firstName));
      }
    });

    const platformGuestTotals = await computePlatformGuestTotals(counterIds);
    commissionDataByUser.forEach((summary) => {
      summary.platformGuestTotals = platformGuestTotals;
    });

    const dailyAggregates = new Map<number, DailyAggregate>();

    const getOrCreateDailyAggregate = (counterId: number, meta: CounterMeta): DailyAggregate => {
      let aggregate = dailyAggregates.get(counterId);
      if (!aggregate) {
        aggregate = {
          dateKey: meta.dateKey,
          counterId,
          productId: meta.productId,
          productName: meta.productName,
          totalCustomers: 0,
          guides: new Map<number, GuideDailyBreakdown>(),
        };
        dailyAggregates.set(counterId, aggregate);
      }
      return aggregate;
    };

    counters.forEach((counter) => {
      const meta = counterMetaById.get(counter.id);
      if (!meta) {
        return;
      }

      const customers = meta.isNewSystem
        ? newSystemTotalsByCounter.get(counter.id) ?? 0
        : legacyTotalsByCounter.get(counter.id) ?? 0;

      const aggregate = getOrCreateDailyAggregate(counter.id, meta);
      aggregate.totalCustomers += customers;

      const staffForCounter = staffByCounter.get(counter.id) ?? [];
      if (staffForCounter.length === 0 || customers === 0) {
        return;
      }

      const totalCommissionForCounter = customers * COMMISSION_RATE_PER_ATTENDEE;
      const commissionPerStaff = totalCommissionForCounter / staffForCounter.length;

      staffForCounter.forEach((staff) => {
        const userId = staff.userId;
    const commissionSummary = commissionDataByUser.get(userId);
    if (!commissionSummary) {
      return;
    }

        commissionSummary.totalCommission += commissionPerStaff;
        commissionSummary.totalCustomers += customers;

        const productBucket = getOrCreateProductBucket(
          productBucketsByUser,
          userId,
          meta.productId,
          meta.productName,
        );
        productBucket.counterIds.add(counter.id);
        productBucket.totalCustomers += customers;
        productBucket.totalCommission += commissionPerStaff;

        const guideBreakdown = aggregate.guides.get(userId) ?? {
          userId,
          firstName: commissionSummary.firstName,
          commission: 0,
          customers: 0,
        };

        guideBreakdown.commission += commissionPerStaff;
        guideBreakdown.customers += customers;

        aggregate.guides.set(userId, guideBreakdown);
      });
    });

    aggregateDailyBreakdownByUser(dailyAggregates, commissionDataByUser);

    const reviewStatsByUser = await fetchReviewStats(start, end);
    if (reviewStatsByUser.size > 0) {
      await ensureSummariesForUserIds(reviewStatsByUser.keys(), commissionDataByUser);
      reviewStatsByUser.forEach((stats, userId) => {
        const summary = commissionDataByUser.get(userId);
        if (summary) {
          summary.reviewTotals = stats;
          summary.platformGuestTotals = platformGuestTotals;
        }
      });
    }

    const activeComponents = await CompensationComponent.findAll({
      where: { isActive: true },
      include: [
        {
          model: CompensationComponentAssignment,
          as: "assignments",
          where: { isActive: true },
          required: false,
        },
      ],
      order: [
        ["category", "ASC"],
        ["name", "ASC"],
      ],
    });

    const typedComponents = activeComponents as Array<
      CompensationComponent & { assignments?: CompensationComponentAssignment[] }
    >;

    const assignmentTargets = await resolveAssignmentTargets(commissionDataByUser, typedComponents);
    commissionDataByUser.forEach((summary) => {
      summary.platformGuestTotals = platformGuestTotals;
    });
    const requiresTaskScores = typedComponents.some(
      (component) =>
        component.calculationMethod === "task_score" &&
        (component.assignments?.some((assignment) => assignment.isActive) ?? false),
    );
    const taskScoreLookup: TaskScoreLookup = requiresTaskScores
      ? await buildTaskScoreLookup(start, end)
      : new Map();
    const requiresNightReportMetrics = typedComponents.some(
      (component) =>
        component.calculationMethod === "night_report" &&
        (component.assignments?.some((assignment) => assignment.isActive) ?? false),
    );
    const nightReportStats: NightReportStatsMap = requiresNightReportMetrics
      ? await fetchLeaderNightReportStats(start, end)
      : new Map();

    applyCompensationComponents(
      commissionDataByUser,
      typedComponents,
      start,
      end,
      assignmentTargets,
      taskScoreLookup,
      nightReportStats,
      productBucketsByUser,
    );

    const allSummaries = Array.from(commissionDataByUser.values()).map((entry) => {
      const productBuckets = productBucketsByUser.get(entry.userId);
      const productTotals = productBuckets
        ? Array.from(productBuckets.values()).map((bucket) => ({
            productId: bucket.productId,
            productName: bucket.productName,
            counterIds: Array.from(bucket.counterIds.values()),
            totalCustomers: bucket.totalCustomers,
            totalCommission: Number(bucket.totalCommission.toFixed(2)),
            componentTotals: Array.from(bucket.componentTotals.entries()).map(([componentId, amount]) => ({
              componentId,
              amount: Number(amount.toFixed(2)),
            })),
          }))
        : [];

      return {
        ...entry,
        totalCommission: Number(entry.totalCommission.toFixed(2)),
        totalCustomers: entry.totalCustomers,
        breakdown: entry.breakdown.map((item) => ({
          ...item,
          commission: Number(item.commission.toFixed(2)),
        })),
        componentTotals: entry.componentTotals.map((component) => ({
          ...component,
          amount: Number(component.amount.toFixed(2)),
        })),
        bucketTotals: Object.fromEntries(
          Object.entries(entry.bucketTotals).map(([key, value]) => [key, Number(value.toFixed(2))]),
        ),
        totalPayout: Number(entry.totalPayout.toFixed(2)),
        productTotals,
        reviewTotals: entry.reviewTotals,
        platformGuestTotals: entry.platformGuestTotals,
        platformGuestBreakdowns: Object.fromEntries(
          Object.entries(entry.platformGuestBreakdowns ?? {}).map(([componentId, tiers]) => [
            componentId,
            tiers.map((tier) => ({
              ...tier,
              amount: Number(tier.amount.toFixed(2)),
            })),
          ]),
        ),
        lockedComponents: entry.lockedComponents.map((locked) => ({
          ...locked,
          amount: Number(locked.amount.toFixed(2)),
        })),
      };
    });

    const authRequest = req as AuthenticatedRequest;
    const requesterId = authRequest.authContext?.id ?? null;
    const requesterRoleSlug = authRequest.authContext?.roleSlug ?? null;

    const requesterHasFullAccess = requesterRoleSlug ? FULL_ACCESS_ROLE_SLUGS.has(requesterRoleSlug) : false;
    const forceSelfScope = scope === "self";
    const shouldLimitToSelf = forceSelfScope || !requesterHasFullAccess;

    const data = shouldLimitToSelf && requesterId !== null
      ? allSummaries.filter((entry) => entry.userId === requesterId)
      : allSummaries;

    res.status(200).json([{ data, columns: [] }]);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json([{ message: "Internal server error" }]);
  }
};

export const listReportModels = (_req: Request, res: Response): void => {
  try {
    modelDescriptorCache.clear();
    const models = Object.values(sequelize.models) as Array<ModelCtor<Model>>;
    const payload = models
      .map(describeModel)
      .sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({ models: payload });
  } catch (error) {
    console.error("Failed to enumerate report models", error);
    res.status(500).json({ message: "Unable to enumerate data models" });
  }
};

const normalizeSelectQueryConfig = (config: QueryConfig): ReportPreviewRequest => {
  if (!config || !Array.isArray(config.models)) {
    throw new PreviewQueryError("Invalid query payload.");
  }

  const selectEntries = Array.isArray(config.select) ? config.select : [];
  if (selectEntries.length === 0) {
    throw new PreviewQueryError("Select at least one field for your query.");
  }

  const groupedFields = new Map<string, Set<string>>();
  selectEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const { modelId, fieldId } = entry;
    if (typeof modelId !== "string" || typeof fieldId !== "string") {
      return;
    }
    if (!groupedFields.has(modelId)) {
      groupedFields.set(modelId, new Set<string>());
    }
    groupedFields.get(modelId)!.add(fieldId);
  });

  if (groupedFields.size === 0) {
    throw new PreviewQueryError("Unable to determine any valid fields to query.");
  }

  const dedupedModels = new Set(
    config.models
      .filter((modelId): modelId is string => typeof modelId === "string" && modelId.trim().length > 0)
      .map((modelId) => modelId.trim()),
  );

  groupedFields.forEach((_fields, modelId) => {
    if (typeof modelId === "string" && modelId.trim().length > 0) {
      dedupedModels.add(modelId.trim());
    }
  });

  if (dedupedModels.size === 0) {
    throw new PreviewQueryError("At least one data model is required.");
  }

  const fields = Array.from(groupedFields.entries()).map(([modelId, fieldSet]) => ({
    modelId,
    fieldIds: Array.from(fieldSet),
  }));

  const joins = Array.isArray(config.joins) ? config.joins : [];

  return {
    models: Array.from(dedupedModels),
    fields,
    joins,
    filters: [],
    limit: config.limit,
    derivedFields:
      Array.isArray(config.derivedFields) && config.derivedFields.length > 0
        ? config.derivedFields
        : undefined,
  };
};

const executePreviewQuery = async (
  payload: ReportPreviewRequest,
): Promise<{ result: ReportPreviewResponse; sql: string; meta: Record<string, unknown> }> => {
  if (!payload || !Array.isArray(payload.models) || payload.models.length === 0) {
    throw new PreviewQueryError("At least one data model is required.");
  }

  const requestedFields =
    payload.fields?.filter((entry) => Array.isArray(entry.fieldIds) && entry.fieldIds.length > 0) ?? [];

  if (requestedFields.length === 0) {
    throw new PreviewQueryError("Select at least one field across your models.");
  }

  const aliasMap = new Map<string, string>();
  payload.models.forEach((modelId, index) => {
    aliasMap.set(modelId, `m${index}`);
  });

  const selectClauses: string[] = [];
  const usedFields = new Set<string>();

  requestedFields.forEach((entry) => {
    const descriptor = ensureModelDescriptor(entry.modelId);
    const alias = aliasMap.get(entry.modelId);
    if (!descriptor || !alias) {
      return;
    }

    entry.fieldIds.forEach((fieldId) => {
      const field = descriptor.fields.find((candidate) => candidate.fieldName === fieldId);
      if (!field) {
        return;
      }
      const selectAlias = `${descriptor.id}__${field.fieldName}`;
      if (usedFields.has(selectAlias)) {
        return;
      }
      usedFields.add(selectAlias);
      selectClauses.push(
        `${alias}.${quoteIdentifier(field.columnName)} AS ${quoteIdentifier(selectAlias)}`,
      );
    });
  });

  if (selectClauses.length === 0) {
    throw new PreviewQueryError("Unable to determine any valid fields to query.");
  }

  const derivedFieldPayloads = Array.isArray(payload.derivedFields) ? payload.derivedFields : [];
  validateDerivedFieldGraph(derivedFieldPayloads, payload.models, payload.joins ?? [], aliasMap);
  const derivedFieldLookup = new Map<string, DerivedFieldQueryPayload>(
    derivedFieldPayloads.map((field) => [field.id, field]),
  );
  derivedFieldPayloads.forEach((field, index) => {
    try {
      const { clause, alias } = buildDerivedFieldSelectClause(field, aliasMap, index);
      selectClauses.push(clause);
      usedFields.add(alias);
    } catch (error) {
      if (error instanceof PreviewQueryError) {
        throw error;
      }
      throw new PreviewQueryError(
        `Derived field ${field.id || `#${index + 1}`} could not be processed.`,
      );
    }
  });

  const baseModelId = payload.models[0];
  const baseDescriptor = ensureModelDescriptor(baseModelId);
  const baseAlias = aliasMap.get(baseModelId)!;
  if (!baseDescriptor) {
    throw new PreviewQueryError(`Model ${baseModelId} is not available.`);
  }

  const fromClause = buildFromClause(baseDescriptor, baseAlias);
  const { clauses: joinClauses, joinedModels, unresolvedJoins } = buildJoinClauses(
    payload.joins ?? [],
    aliasMap,
    baseModelId,
  );

  if (unresolvedJoins.length > 0) {
    throw new PreviewQueryError("Some models could not be joined. Verify your join configuration.", 400, unresolvedJoins);
  }

  const unjoinedModels = payload.models.filter(
    (modelId) => modelId !== baseModelId && !joinedModels.has(modelId),
  );

  if (unjoinedModels.length > 0) {
    throw new PreviewQueryError("Some selected models are not connected to the base model.", 400, unjoinedModels);
  }

  validateDerivedFieldJoinCoverage(derivedFieldPayloads, joinedModels);

  const whereClauses = buildWhereClauses(payload.filters ?? [], aliasMap, derivedFieldLookup);
  const orderByClauses = buildOrderByClauses(payload.orderBy ?? [], aliasMap, derivedFieldLookup);

  const limitValue = Math.min(Math.max(Number(payload.limit ?? 200) || 200, 1), 1000);

  const sqlParts = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${fromClause}`,
    ...joinClauses,
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
    orderByClauses.length > 0 ? `ORDER BY ${orderByClauses.join(", ")}` : "",
    `LIMIT :limit`,
  ].filter(Boolean);

  const sql = sqlParts.join(" ");

  const rows = await sequelize.query<Record<string, unknown>>(sql, {
    replacements: { limit: limitValue },
    type: QueryTypes.SELECT,
  });

  const columns = rows.length > 0 ? Object.keys(rows[0]) : Array.from(usedFields);

  const response: ReportPreviewResponse = {
    rows,
    columns,
    sql,
  };

  return {
    result: response,
    sql,
    meta: {
      type: "preview",
      models: payload.models,
      selectedColumns: Array.from(usedFields),
    },
  };
};

const executeAggregatedQuery = async (
  config: QueryConfig,
): Promise<{ result: ReportPreviewResponse; sql: string; meta: Record<string, unknown> }> => {
  if (!config || !Array.isArray(config.models) || config.models.length === 0) {
    throw new PreviewQueryError("At least one data model is required.");
  }

  const metrics = (config.metrics ?? []).filter(
    (metric): metric is QueryConfigMetric =>
      metric !== null &&
      typeof metric === "object" &&
      typeof metric.modelId === "string" &&
      metric.modelId.trim().length > 0 &&
      typeof metric.fieldId === "string" &&
      metric.fieldId.trim().length > 0 &&
      typeof metric.aggregation === "string",
  );

  const dimensions = (config.dimensions ?? []).filter(
    (dimension): dimension is QueryConfigDimension =>
      dimension !== null &&
      typeof dimension === "object" &&
      typeof dimension.modelId === "string" &&
      dimension.modelId.trim().length > 0 &&
      typeof dimension.fieldId === "string" &&
      dimension.fieldId.trim().length > 0,
  );

  if (metrics.length === 0) {
    throw new PreviewQueryError("Configure at least one metric for aggregated queries.");
  }

  const aliasMap = new Map<string, string>();
  config.models.forEach((modelId, index) => {
    aliasMap.set(modelId, `m${index}`);
  });

  const derivedFieldPayloads = Array.isArray(config.derivedFields) ? config.derivedFields : [];
  validateDerivedFieldGraph(derivedFieldPayloads, config.models, config.joins ?? [], aliasMap);
  const derivedFieldLookup = new Map<string, DerivedFieldQueryPayload>(
    derivedFieldPayloads.map((field) => [field.id, field]),
  );

  const allowedBuckets = new Set(["hour", "day", "week", "month", "quarter", "year"]);

  const dimensionSelectClauses: string[] = [];
  const groupByClauses: string[] = [];
  const resolvedDimensions: string[] = [];

  dimensions.forEach((dimension) => {
    const modelId = dimension.modelId.trim();
    const descriptor = ensureModelDescriptor(modelId);
    const modelAlias = aliasMap.get(modelId);
    if (!descriptor || !modelAlias) {
      throw new PreviewQueryError(`Model ${modelId} is not available.`);
    }
    const field = descriptor.fields.find((candidate) => candidate.fieldName === dimension.fieldId);
    if (!field) {
      throw new PreviewQueryError(
        `Field ${dimension.fieldId} is not available on model ${modelId}.`,
      );
    }
    const baseExpression = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
    let columnExpression = baseExpression;
    if (dimension.bucket) {
      const bucketKey = dimension.bucket.toLowerCase();
      if (!allowedBuckets.has(bucketKey)) {
        throw new PreviewQueryError(`Unsupported time bucket: ${dimension.bucket}`);
      }
      columnExpression = `date_trunc('${bucketKey}', ${baseExpression})`;
    }
    const alias =
      dimension.alias && dimension.alias.trim().length > 0
        ? dimension.alias.trim()
        : dimension.bucket
        ? `${descriptor.id}__${field.fieldName}_${dimension.bucket}`
        : `${descriptor.id}__${field.fieldName}`;
    dimensionSelectClauses.push(`${columnExpression} AS ${quoteIdentifier(alias)}`);
    groupByClauses.push(columnExpression);
    resolvedDimensions.push(alias);
  });

  const metricSelectClauses: string[] = [];
  const resolvedMetrics: string[] = [];

  const aggregationMap: Record<QueryConfigMetric["aggregation"], string> = {
    sum: "SUM",
    avg: "AVG",
    min: "MIN",
    max: "MAX",
    count: "COUNT",
    count_distinct: "COUNT",
  };

  metrics.forEach((metric, index) => {
    const modelId = metric.modelId.trim();
    const aggregationKey = metric.aggregation;
    const sqlAggregation = aggregationMap[aggregationKey];
    if (!sqlAggregation) {
      throw new PreviewQueryError(`Unsupported aggregation: ${aggregationKey}`);
    }

    if (modelId === DERIVED_FIELD_SENTINEL) {
      const derivedFieldId = metric.fieldId?.trim() ?? "";
      const derivedField = derivedFieldLookup.get(derivedFieldId);
      if (!derivedField || !derivedField.expressionAst) {
        throw new PreviewQueryError(
          `Derived field ${derivedFieldId || metric.alias || `#${index + 1}`} is not available for analytics.`,
        );
      }
      const expressionSql = renderDerivedFieldExpressionSql(derivedField.expressionAst, aliasMap);
      const aliasValue =
        metric.alias && metric.alias.trim().length > 0
          ? metric.alias.trim()
          : `${derivedField.id}_${aggregationKey}_${index}`;
      const aggregationExpression =
        aggregationKey === "count_distinct"
          ? `${sqlAggregation}(DISTINCT (${expressionSql}))`
          : `${sqlAggregation}(${expressionSql})`;
      metricSelectClauses.push(`${aggregationExpression} AS ${quoteIdentifier(aliasValue)}`);
      resolvedMetrics.push(aliasValue);
      return;
    }

    const descriptor = ensureModelDescriptor(modelId);
    const modelAlias = aliasMap.get(modelId);
    if (!descriptor || !modelAlias) {
      throw new PreviewQueryError(`Model ${modelId} is not available.`);
    }
    const field = descriptor.fields.find((candidate) => candidate.fieldName === metric.fieldId);
    if (!field) {
      throw new PreviewQueryError(
        `Field ${metric.fieldId} is not available on model ${modelId}.`,
      );
    }
    const baseExpression = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
    const alias =
      metric.alias && metric.alias.trim().length > 0
        ? metric.alias.trim()
        : `${descriptor.id}__${field.fieldName}_${aggregationKey}_${index}`;
    const aggregationExpression =
      aggregationKey === "count_distinct"
        ? `${sqlAggregation}(DISTINCT ${baseExpression})`
        : `${sqlAggregation}(${baseExpression})`;
    metricSelectClauses.push(`${aggregationExpression} AS ${quoteIdentifier(alias)}`);
    resolvedMetrics.push(alias);
  });

  const selectClauses = [...dimensionSelectClauses, ...metricSelectClauses];

  const baseModelId = config.models[0];
  const baseDescriptor = ensureModelDescriptor(baseModelId);
  const baseAlias = aliasMap.get(baseModelId)!;
  if (!baseDescriptor) {
    throw new PreviewQueryError(`Model ${baseModelId} is not available.`);
  }

  const fromClause = buildFromClause(baseDescriptor, baseAlias);
  const { clauses: joinClauses, joinedModels, unresolvedJoins } = buildJoinClauses(
    config.joins ?? [],
    aliasMap,
    baseModelId,
  );

  if (unresolvedJoins.length > 0) {
    throw new PreviewQueryError("Some models could not be joined. Verify your join configuration.", 400, unresolvedJoins);
  }

  const unjoinedModels = config.models.filter(
    (modelId) => modelId !== baseModelId && !joinedModels.has(modelId),
  );
  if (unjoinedModels.length > 0) {
    throw new PreviewQueryError("Some selected models are not connected to the base model.", 400, unjoinedModels);
  }

  validateDerivedFieldJoinCoverage(derivedFieldPayloads, joinedModels);

  const filterFragments: string[] = [];
  const replacements: Record<string, unknown> = {};

  (config.filters ?? []).forEach((filter, index) => {
    if (
      !filter ||
      typeof filter.modelId !== "string" ||
      typeof filter.fieldId !== "string" ||
      typeof filter.operator !== "string"
    ) {
      return;
    }
    const descriptor = ensureModelDescriptor(filter.modelId);
    const modelAlias = aliasMap.get(filter.modelId);
    if (!descriptor || !modelAlias) {
      throw new PreviewQueryError(`Model ${filter.modelId} is not available for filters.`);
    }
    const field = descriptor.fields.find((candidate) => candidate.fieldName === filter.fieldId);
    if (!field) {
      throw new PreviewQueryError(
        `Field ${filter.fieldId} is not available on model ${filter.modelId}.`,
      );
    }

    const column = `${modelAlias}.${quoteIdentifier(field.columnName)}`;
    const paramKey = `filter_${index}`;
    let fragment: string | null = null;
    const value = filter.value;

    switch (filter.operator) {
      case "eq":
        fragment = `${column} = :${paramKey}`;
        break;
      case "neq":
        fragment = `${column} <> :${paramKey}`;
        break;
      case "gt":
        fragment = `${column} > :${paramKey}`;
        break;
      case "gte":
        fragment = `${column} >= :${paramKey}`;
        break;
      case "lt":
        fragment = `${column} < :${paramKey}`;
        break;
      case "lte":
        fragment = `${column} <= :${paramKey}`;
        break;
      case "in": {
        if (!Array.isArray(value) || value.length === 0) {
          throw new PreviewQueryError("Filter 'in' requires a non-empty array value.");
        }
        const listKey = `${paramKey}_list`;
        fragment = `${column} IN (:${listKey})`;
        replacements[listKey] = value;
        break;
      }
      case "not_in": {
        if (!Array.isArray(value) || value.length === 0) {
          throw new PreviewQueryError("Filter 'not_in' requires a non-empty array value.");
        }
        const listKey = `${paramKey}_list`;
        fragment = `${column} NOT IN (:${listKey})`;
        replacements[listKey] = value;
        break;
      }
      case "between": {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new PreviewQueryError("Filter 'between' requires an object value with from/to.");
        }
        const from = (value as { from?: string | number }).from;
        const to = (value as { to?: string | number }).to;
        if (from === undefined || to === undefined) {
          throw new PreviewQueryError("Filter 'between' requires both from and to values.");
        }
        const fromKey = `${paramKey}_from`;
        const toKey = `${paramKey}_to`;
        fragment = `${column} BETWEEN :${fromKey} AND :${toKey}`;
        replacements[fromKey] = from;
        replacements[toKey] = to;
        break;
      }
      default:
        throw new PreviewQueryError(`Unsupported filter operator: ${filter.operator}`);
    }

    if (
      filter.operator === "eq" ||
      filter.operator === "neq" ||
      filter.operator === "gt" ||
      filter.operator === "gte" ||
      filter.operator === "lt" ||
      filter.operator === "lte"
    ) {
      replacements[paramKey] = value;
    }

    if (fragment) {
      filterFragments.push(fragment);
    }
  });

  const limitValue = Math.min(Math.max(Number(config.limit ?? 500) || 500, 1), 10000);
  replacements.limit = limitValue;

  const sqlParts = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${fromClause}`,
    ...joinClauses,
    filterFragments.length > 0 ? `WHERE ${filterFragments.join(" AND ")}` : "",
    resolvedDimensions.length > 0 ? `GROUP BY ${groupByClauses.join(", ")}` : "",
  ];

  const orderByParts: string[] = [];
  (config.orderBy ?? []).forEach((clause) => {
    if (!clause || typeof clause.alias !== "string") {
      return;
    }
    const direction = clause.direction && clause.direction.toLowerCase() === "desc" ? "DESC" : "ASC";
    const alias = clause.alias.trim();
    if (resolvedMetrics.includes(alias) || resolvedDimensions.includes(alias)) {
      orderByParts.push(`${quoteIdentifier(alias)} ${direction}`);
    }
  });

  if (orderByParts.length > 0) {
    sqlParts.push(`ORDER BY ${orderByParts.join(", ")}`);
  }

  sqlParts.push("LIMIT :limit");

  const sql = sqlParts.filter(Boolean).join(" ");

  const rows = await sequelize.query<Record<string, unknown>>(sql, {
    replacements,
    type: QueryTypes.SELECT,
  });

  const columns = [...resolvedDimensions, ...resolvedMetrics];

  return {
    result: {
      rows,
      columns,
      sql,
    },
    sql,
    meta: {
      type: "aggregated",
      models: config.models,
      metrics: resolvedMetrics,
      dimensions: resolvedDimensions,
      filters: config.filters ?? [],
      limit: config.limit ?? null,
    },
  };
};

export const runReportPreview = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  let lastSql = "";
  try {
    ensureReportingAccess(req);
    const payload = req.body as ReportPreviewRequest;
    const { result, sql, meta } = await executePreviewQuery(payload);
    lastSql = sql;
    res.status(200).json({
      ...result,
      meta: {
        ...meta,
        executedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof PreviewQueryError) {
      res
        .status(error.status)
        .json(error.details ? { message: error.message, details: error.details } : { message: error.message });
      return;
    }
    console.error("Failed to run report preview", error, lastSql ? `SQL: ${lastSql}` : "");
    const payload =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? { message: "Failed to run report preview.", details: error.message }
        : { message: "Failed to run report preview." };
    res.status(500).json(payload);
  }
};

export const executeReportQuery = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let lastSql = "";
  try {
    ensureReportingAccess(req);
    const config = req.body as QueryConfig;
    const templateId = config.options?.templateId ?? null;
    const cacheTtlSeconds = config.options?.cacheTtlSeconds ?? undefined;
    const hash = computeQueryHash(config);

    const cached = await getCachedQueryResult(hash);
    if (cached) {
      res.status(200).json({
        rows: cached.rows,
        columns: cached.columns,
        sql: cached.sql,
        meta: {
          ...cached.meta,
          hash,
        },
      });
      return;
    }

    const executeQuery = async (): Promise<QueryExecutionResult> => {
      if ((config.metrics?.length ?? 0) > 0 || (config.dimensions?.length ?? 0) > 0) {
        const aggregated = await executeAggregatedQuery(config);
        lastSql = aggregated.sql;
        return {
          rows: aggregated.result.rows,
          columns: aggregated.result.columns,
          sql: aggregated.sql,
          meta: {
            ...aggregated.meta,
            models: config.models,
            metrics: (config.metrics ?? []).map(
              (metric) => metric.alias ?? `${metric.modelId}.${metric.fieldId}`,
            ),
            dimensions: (config.dimensions ?? []).map(
              (dimension) => dimension.alias ?? `${dimension.modelId}.${dimension.fieldId}`,
            ),
            limit: config.limit ?? null,
          },
        };
      }
      const previewPayload = normalizeSelectQueryConfig(config);
      const preview = await executePreviewQuery(previewPayload);
      lastSql = preview.sql;
      return {
        rows: preview.result.rows,
        columns: preview.result.columns,
        sql: preview.sql,
        meta: {
          ...preview.meta,
          models: config.models,
          metrics: [],
          dimensions: preview.meta.selectedColumns ?? [],
          limit: config.limit ?? null,
        },
      };
    };

    const shouldAllowAsync = Boolean(config.options?.allowAsync);
    const forceAsync = Boolean(config.options?.forceAsync);
    const metricsCount = config.metrics?.length ?? 0;
    const plannedLimit = config.limit ?? 0;
    const shouldProcessAsync =
      shouldAllowAsync &&
      (forceAsync || metricsCount > 2 || plannedLimit > 5000 || (config.dimensions?.length ?? 0) > 3);

    if (shouldProcessAsync) {
      const job = await enqueueQueryJob(hash, templateId, executeQuery, cacheTtlSeconds);
      res.status(202).json({
        jobId: job.id,
        hash,
        status: job.status,
        queuedAt: job.createdAt?.toISOString() ?? new Date().toISOString(),
      });
      return;
    }

    const execution = await executeQuery();
    await storeQueryCacheEntry(hash, templateId, execution, cacheTtlSeconds);

    res.status(200).json({
      rows: execution.rows,
      columns: execution.columns,
      sql: execution.sql,
      meta: {
        ...execution.meta,
        hash,
        cached: false,
        executedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof PreviewQueryError) {
      res
        .status(error.status)
        .json(error.details ? { message: error.message, details: error.details } : { message: error.message });
      return;
    }
    console.error("Failed to execute report query", error, lastSql ? `SQL: ${lastSql}` : "");
    const payload =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? { message: "Failed to execute report query.", details: error.message }
        : { message: "Failed to execute report query." };
    res.status(500).json(payload);
  }
};

export const getReportQueryJobStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      res.status(400).json({ message: "Job id is required." });
      return;
    }
    const job = await getAsyncJobStatus(jobId);
    if (!job) {
      res.status(404).json({ message: "Job not found." });
      return;
    }

    if (job.status === "completed" && job.result) {
      const result = job.result as QueryExecutionResult;
      res.status(200).json({
        rows: result.rows,
        columns: result.columns,
        sql: result.sql,
        meta: {
          ...(result.meta ?? {}),
          hash: job.hash ?? undefined,
          cached: false,
          executedAt: job.finishedAt?.toISOString() ?? new Date().toISOString(),
        },
      });
      return;
    }

    res.status(200).json({
      jobId: job.id,
      status: job.status,
      hash: job.hash,
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      error: job.error ?? null,
    });
  } catch (error) {
    console.error("Failed to fetch query job status", error);
    res.status(500).json({ message: "Failed to fetch query job status." });
  }
};

export const listReportTemplates = async (_req: Request, res: Response): Promise<void> => {
  try {
    const templates = await ReportTemplate.findAll({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      order: [["updatedAt", "DESC"]],
    });

    res.json({
      templates: templates.map((template) => serializeReportTemplate(template)),
    });
  } catch (error) {
    console.error("Failed to list report templates", error);
    res.status(500).json({ error: "Failed to load report templates" });
  }
};

export const createReportTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    const payload = normalizeTemplatePayload((req.body ?? {}) as TemplatePayloadInput);

    if (!payload.name) {
      res.status(400).json({ error: "Template name is required" });
      return;
    }

    const template = await ReportTemplate.create({
      userId: actorId,
      name: payload.name,
      category: payload.category,
      description: payload.description,
      schedule: payload.schedule,
      models: payload.models,
      fields: payload.fields,
      joins: payload.joins,
      visuals: payload.visuals,
      metrics: payload.metrics,
      filters: payload.filters,
      queryConfig: payload.queryConfig,
      derivedFields: payload.derivedFields,
      metricsSpotlight: payload.metricsSpotlight,
      previewOrder: payload.previewOrder,
      options: payload.options,
    });

    const reloaded = await template.reload({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    res.status(201).json({
      template: serializeReportTemplate(reloaded),
    });
  } catch (error) {
    console.error("Failed to create report template", error);
    res.status(500).json({ error: "Failed to create report template" });
  }
};

export const updateReportTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Template id is required" });
      return;
    }

    const template = await ReportTemplate.findByPk(id, {
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const actorId = req.authContext?.id ?? null;
    const roleSlug = req.authContext?.roleSlug ?? null;
    const hasFullAccess = roleSlug ? FULL_ACCESS_ROLE_SLUGS.has(roleSlug) : false;
    const isOwner = actorId !== null && template.userId === actorId;

    if (!hasFullAccess && !isOwner) {
      res.status(403).json({ error: "You do not have permission to modify this template" });
      return;
    }

    const payload = normalizeTemplatePayload((req.body ?? {}) as TemplatePayloadInput);

    if (!payload.name) {
      res.status(400).json({ error: "Template name is required" });
      return;
    }

    template.name = payload.name;
    template.category = payload.category;
    template.description = payload.description;
    template.schedule = payload.schedule;
    template.models = payload.models;
    template.fields = payload.fields;
    template.joins = payload.joins;
    template.visuals = payload.visuals;
    template.metrics = payload.metrics;
    template.filters = payload.filters;
    template.queryConfig = payload.queryConfig;
    template.derivedFields = payload.derivedFields;
    template.metricsSpotlight = payload.metricsSpotlight;
    template.previewOrder = payload.previewOrder;
    template.options = payload.options;

    await template.save();
    await template.reload({
      include: [
        {
          model: User,
          as: "owner",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    res.json({
      template: serializeReportTemplate(template),
    });
  } catch (error) {
    console.error("Failed to update report template", error);
    res.status(500).json({ error: "Failed to update report template" });
  }
};

export const deleteReportTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Template id is required" });
      return;
    }

    const template = await ReportTemplate.findByPk(id);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    const actorId = req.authContext?.id ?? null;
    const roleSlug = req.authContext?.roleSlug ?? null;
    const hasFullAccess = roleSlug ? FULL_ACCESS_ROLE_SLUGS.has(roleSlug) : false;
    const isOwner = actorId !== null && template.userId === actorId;

    if (!hasFullAccess && !isOwner) {
      res.status(403).json({ error: "You do not have permission to delete this template" });
      return;
    }

    await template.destroy();
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete report template", error);
    res.status(500).json({ error: "Failed to delete report template" });
  }
};

function aggregateDailyBreakdownByUser(
  dailyAggregates: Map<number, DailyAggregate>,
  commissionDataByUser: Map<number, CommissionSummary>,
) {
  dailyAggregates.forEach((aggregate) => {
    const guidesCount = aggregate.guides.size;

    aggregate.guides.forEach((guide) => {
      const summary = commissionDataByUser.get(guide.userId);
      if (!summary) {
        return;
      }

      summary.breakdown.push({
        date: aggregate.dateKey,
        commission: guide.commission,
        customers: guide.customers,
        guidesCount,
        counterId: aggregate.counterId,
        productId: aggregate.productId,
        productName: aggregate.productName,
      });
    });
  });
}

const getOrCreateProductBucket = (
  lookup: ProductBucketLookup,
  userId: number,
  productId: number | null,
  productName: string,
): ProductBucket => {
  let userBuckets = lookup.get(userId);
  if (!userBuckets) {
    userBuckets = new Map<string, ProductBucket>();
    lookup.set(userId, userBuckets);
  }
  const key = productId === null ? "__null__" : `${productId}`;
  let bucket = userBuckets.get(key);
  if (!bucket) {
    bucket = {
      productId,
      productName,
      counterIds: new Set<number>(),
      totalCustomers: 0,
      totalCommission: 0,
      componentTotals: new Map<number, number>(),
    };
    userBuckets.set(key, bucket);
  } else if (productName && productName !== bucket.productName) {
    bucket.productName = productName;
  }
  return bucket;
};

const allocateComponentToProduct = (
  lookup: ProductBucketLookup,
  userId: number,
  productId: number | null,
  productName: string,
  componentId: number,
  amount: number,
) => {
  if (!amount) {
    return;
  }
  const bucket = getOrCreateProductBucket(lookup, userId, productId, productName);
  const current = bucket.componentTotals.get(componentId) ?? 0;
  bucket.componentTotals.set(componentId, current + amount);
};

const createEmptySummary = (userId: number, firstName: string): CommissionSummary => ({
  userId,
  firstName,
  totalCommission: 0,
  totalCustomers: 0,
  breakdown: [],
  componentTotals: [],
  bucketTotals: { commission: 0 },
  totalPayout: 0,
  productTotals: [],
  counterIncentiveMarkers: {},
  counterIncentiveTotals: {},
  reviewTotals: { totalEligibleReviews: 0 },
  platformGuestTotals: { totalGuests: 0, totalBooked: 0, totalAttended: 0 },
  platformGuestBreakdowns: {},
  lockedComponents: [],
});

const recordCounterIncentiveMarker = (
  summary: CommissionSummary,
  counterId: number | null | undefined,
  componentName: string,
) => {
  if (!counterId || counterId <= 0) {
    return;
  }
  const key = String(counterId);
  const letter = componentName?.trim().charAt(0)?.toUpperCase() ?? "I";
  const existing = summary.counterIncentiveMarkers[key] ?? [];
  if (!existing.includes(letter)) {
    summary.counterIncentiveMarkers[key] = [...existing, letter];
  }
};

const recordCounterIncentiveTotal = (
  summary: CommissionSummary,
  counterId: number | null | undefined,
  amount: number,
) => {
  if (!counterId || counterId <= 0 || !amount) {
    return;
  }
  const key = String(counterId);
  summary.counterIncentiveTotals[key] = (summary.counterIncentiveTotals[key] ?? 0) + amount;
};

const recordLockedComponent = (
  summary: CommissionSummary,
  component: CompensationComponent,
  amount: number,
  requirement: LockedComponentRequirement,
) => {
  if (!amount) {
    return;
  }
  summary.lockedComponents.push({
    componentId: component.id,
    name: component.name,
    category: component.category,
    calculationMethod: component.calculationMethod,
    amount,
    requirement,
  });
};

const ensureSummariesForUserIds = async (
  userIds: Iterable<number>,
  summaries: Map<number, CommissionSummary>,
): Promise<void> => {
  const missingIds = Array.from(new Set(Array.from(userIds).filter((userId) => !summaries.has(userId))));
  if (missingIds.length === 0) {
    return;
  }

  const users = await User.findAll({
    where: { id: { [Op.in]: missingIds }, status: true },
    attributes: ["id", "firstName"],
  });

  users.forEach((user) => {
    if (!summaries.has(user.id)) {
      summaries.set(user.id, createEmptySummary(user.id, user.firstName ?? `User ${user.id}`));
    }
  });
};

const fetchReviewStats = async (
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
): Promise<Map<number, ReviewTotals>> => {
  const startIso = rangeStart.format("YYYY-MM-DD");
  const endIso = rangeEnd.format("YYYY-MM-DD");

  const counters = await ReviewCounter.findAll({
    attributes: ["id", "periodStart", "periodEnd"],
    where: {
      [Op.or]: [
        {
          periodStart: {
            [Op.between]: [startIso, endIso],
          },
        },
        {
          periodEnd: {
            [Op.between]: [startIso, endIso],
          },
        },
        {
          [Op.and]: [
            { periodStart: { [Op.lte]: startIso } },
            {
              [Op.or]: [
                { periodEnd: { [Op.gte]: endIso } },
                { periodEnd: null },
              ],
            },
          ],
        },
      ],
    },
  });

  if (counters.length === 0) {
    return new Map();
  }

  const counterIds = counters.map((counter) => counter.id);

  const entries = await ReviewCounterEntry.findAll({
    attributes: ["counterId", "userId", "roundedCount", "underMinimumApproved"],
    where: {
      counterId: { [Op.in]: counterIds },
      category: "staff",
      userId: { [Op.ne]: null },
    },
  });

  const stats = new Map<number, ReviewTotals>();
  entries.forEach((entry) => {
    const userId = entry.getDataValue("userId");
    if (!userId) {
      return;
    }
    const roundedCountRaw = entry.get("roundedCount");
    const roundedCount = Number(roundedCountRaw ?? 0);
    if (!Number.isFinite(roundedCount) || roundedCount <= 0) {
      return;
    }
    const approved = Boolean(entry.getDataValue("underMinimumApproved"));
    if (roundedCount < REVIEW_MINIMUM_THRESHOLD && !approved) {
      return;
    }
    const current = stats.get(userId) ?? { totalEligibleReviews: 0 };
    current.totalEligibleReviews += roundedCount;
    stats.set(userId, current);
  });

  return stats;
};

const computePlatformGuestTotals = async (counterIds: number[]): Promise<PlatformGuestTotals> => {
  if (!counterIds || counterIds.length === 0) {
    return { totalGuests: 0, totalBooked: 0, totalAttended: 0 };
  }

  const rows = await CounterChannelMetric.findAll({
    attributes: ["tallyType", [Sequelize.fn("SUM", Sequelize.col("qty")), "totalQty"]],
    where: {
      counterId: { [Op.in]: counterIds },
      kind: "people",
      tallyType: { [Op.in]: ["booked", "attended"] },
    },
    group: ["tallyType"],
  });

  let totalBooked = 0;
  let totalAttended = 0;
  rows.forEach((row) => {
    const tallyType = row.getDataValue("tallyType") as string;
    const qty = Number(row.get("totalQty") ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      return;
    }
    if (tallyType === "booked") {
      totalBooked += qty;
    } else if (tallyType === "attended") {
      totalAttended += qty;
    }
  });

  const noShows = Math.max(totalBooked - totalAttended, 0);
  const totalGuests = totalAttended + noShows;
  return {
    totalGuests,
    totalBooked,
    totalAttended,
  };
};

function describeModel(model: ModelCtor<Model>): ReportModelDescriptor {
  const attributes = model.getAttributes();
  const fields = Object.entries(attributes).map(([fieldName, attribute]) =>
    describeField(fieldName, attribute),
  );

  const primaryKeys = fields
    .filter((field) => field.primaryKey)
    .map((field) => field.fieldName);

  const tableNameRaw = model.getTableName();
  const tableName =
    typeof tableNameRaw === "string" ? tableNameRaw : tableNameRaw.tableName ?? model.name;
  const schema =
    typeof tableNameRaw === "string" ? undefined : tableNameRaw.schema ?? undefined;

  const associations = Object.values(model.associations ?? {}).map((association) =>
    describeAssociation(association),
  );

  const descriptor: ReportModelDescriptor = {
    id: model.name,
    name: model.name,
    tableName,
    schema,
    description: buildModelDescription(model.name, schema, tableName),
    connection: "OmniLodge core database",
    recordCount: "N/A",
    lastSynced: new Date().toISOString(),
    primaryKeys,
    primaryKey: primaryKeys[0] ?? null,
    fields,
    associations,
  };

  modelDescriptorCache.set(descriptor.id, descriptor);

  return descriptor;
}

const isAssignmentEffectiveForRange = (
  assignment: CompensationComponentAssignment,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const effectiveStart = assignment.effectiveStart ? dayjs(assignment.effectiveStart) : null;
  const effectiveEnd = assignment.effectiveEnd ? dayjs(assignment.effectiveEnd) : null;
  if (effectiveStart && effectiveStart.isAfter(rangeEnd, "day")) {
    return false;
  }
  if (effectiveEnd && effectiveEnd.isBefore(rangeStart, "day")) {
    return false;
  }
  return true;
};

type AssignmentTargetMap = Map<number, number[]>;

type TaskLogStatusBucket = {
  total: number;
  completed: number;
  waived: number;
  missed: number;
  pending: number;
};

type TaskLogSummary = {
  overall: TaskLogStatusBucket;
  byTemplate: Map<number, TaskLogStatusBucket>;
};

type TaskScoreLookup = Map<number, TaskLogSummary>;

const assignmentAppliesToUser = (
  assignment: CompensationComponentAssignment,
  userId: number,
  targetsByAssignment: AssignmentTargetMap,
): boolean => {
  if (assignment.targetScope === "global") {
    return true;
  }
  const targetUserIds = targetsByAssignment.get(assignment.id);
  if (targetUserIds && targetUserIds.includes(userId)) {
    return true;
  }
  if (assignment.targetScope === "user" && assignment.userId) {
    return assignment.userId === userId;
  }
  return false;
};

const computeAssignmentAmount = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
  summary: CommissionSummary,
  taskScoreLookup: TaskScoreLookup,
  nightReportStats: NightReportStatsMap,
  nightReportBestCache: Map<string, NightReportBestCacheEntry>,
  productBucketsByUser: ProductBucketLookup,
) => {
  const reviewRequirement = resolveReviewTargetRequirement(component, assignment);
  const totalEligibleReviews = summary.reviewTotals?.totalEligibleReviews ?? 0;
  const applyReviewRequirement = (amount: number): number => {
    if (!amount) {
      return 0;
    }
    if (reviewRequirement && totalEligibleReviews < reviewRequirement.minReviews) {
      recordLockedComponent(summary, component, amount, {
        type: "review_target",
        minReviews: reviewRequirement.minReviews,
        actualReviews: totalEligibleReviews,
      });
      return 0;
    }
    return amount;
  };

  if (component.calculationMethod === "task_score") {
    return applyReviewRequirement(
      computeTaskScorePayout(component, assignment, summary, taskScoreLookup),
    );
  }
  if (component.calculationMethod === "night_report") {
    return applyReviewRequirement(
      computeNightReportIncentive(
        component,
        assignment,
        summary,
        nightReportStats,
        nightReportBestCache,
        productBucketsByUser,
      ),
    );
  }

  const reviewSettings = resolveReviewPayoutSettings(component, assignment);
  if (reviewSettings) {
    return applyReviewRequirement(computeReviewPayoutAmount(summary, reviewSettings));
  }

  const platformGuestSettings = resolvePlatformGuestSettings(component, assignment);
  if (platformGuestSettings) {
    return applyReviewRequirement(
      computePlatformGuestPayout(summary, platformGuestSettings, component.id),
    );
  }

  const baseAmount = Number(assignment.baseAmount ?? 0);
  const unitAmount = Number(assignment.unitAmount ?? 0);
  let total = baseAmount;

  if (!Number.isNaN(unitAmount) && unitAmount !== 0) {
    if (component.calculationMethod === "per_unit") {
      total += unitAmount * summary.totalCustomers;
    } else if (component.calculationMethod === "percentage") {
      total += (unitAmount / 100) * summary.totalCommission;
    }
  }

  return applyReviewRequirement(total);
};

const applyCompensationComponents = (
  summaries: Map<number, CommissionSummary>,
  components: Array<CompensationComponent & { assignments?: CompensationComponentAssignment[] }>,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  assignmentTargets: AssignmentTargetMap,
  taskScoreLookup: TaskScoreLookup,
  nightReportStats: NightReportStatsMap,
  productBucketsByUser: ProductBucketLookup,
) => {
  const nightReportBestCache = new Map<string, NightReportBestCacheEntry>();
  summaries.forEach((summary) => {
    summary.componentTotals = [];
    summary.bucketTotals = { commission: summary.totalCommission };
    summary.totalPayout = summary.totalCommission;
    summary.lockedComponents = [];
  });

  components.forEach((component) => {
    const assignments = component.assignments ?? [];
    if (assignments.length === 0) {
      return;
    }

    summaries.forEach((summary) => {
      const amount = assignments.reduce((acc, assignment) => {
        if (
          !assignment.isActive ||
          !isAssignmentEffectiveForRange(assignment, rangeStart, rangeEnd) ||
          !assignmentAppliesToUser(assignment, summary.userId, assignmentTargets)
        ) {
          return acc;
        }
        return (
          acc +
          computeAssignmentAmount(
            component,
            assignment,
            summary,
            taskScoreLookup,
            nightReportStats,
            nightReportBestCache,
            productBucketsByUser,
          )
        );
      }, 0);

      if (amount !== 0) {
        summary.componentTotals.push({
          componentId: component.id,
          name: component.name,
          category: component.category,
          calculationMethod: component.calculationMethod,
          amount,
        });
        summary.bucketTotals[component.category] = (summary.bucketTotals[component.category] ?? 0) + amount;
        summary.totalPayout += amount;
      }
    });
  });
};

type TaskScoreSettings = {
  templateIds?: number[];
  minimumMultiplier: number;
  maximumMultiplier: number;
  treatWaivedAsComplete: boolean;
  treatPendingAsComplete: boolean;
};

const createStatusBucket = (): TaskLogStatusBucket => ({
  total: 0,
  completed: 0,
  waived: 0,
  missed: 0,
  pending: 0,
});

const incrementStatusBucket = (bucket: TaskLogStatusBucket, status: AssistantManagerTaskStatus) => {
  bucket.total += 1;
  if (status === "completed") {
    bucket.completed += 1;
  } else if (status === "waived") {
    bucket.waived += 1;
  } else if (status === "missed") {
    bucket.missed += 1;
  } else {
    bucket.pending += 1;
  }
};

const selectTaskBucket = (
  summary: TaskLogSummary | undefined,
  templateIds?: number[],
): TaskLogStatusBucket | null => {
  if (!summary) {
    return null;
  }
  if (!templateIds || templateIds.length === 0) {
    return summary.overall;
  }
  const aggregate = createStatusBucket();
  templateIds.forEach((templateId) => {
    const bucket = summary.byTemplate.get(templateId);
    if (bucket) {
      aggregate.total += bucket.total;
      aggregate.completed += bucket.completed;
      aggregate.waived += bucket.waived;
      aggregate.missed += bucket.missed;
      aggregate.pending += bucket.pending;
    }
  });
  if (aggregate.total === 0) {
    return summary.overall;
  }
  return aggregate;
};

const readNumeric = (value: unknown): number | undefined => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
};

const readNumericArray = (value: unknown): number[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const appendParsed = (input: unknown, target: number[]) => {
    if (typeof input === "object" && input !== null && "id" in input) {
      appendParsed((input as { id: unknown }).id, target);
      return;
    }

    const parsed = readNumeric(input);
    if (parsed === undefined) {
      return;
    }
    const normalized = Math.trunc(parsed);
    if (Number.isFinite(normalized)) {
      target.push(normalized);
    }
  };

  const collected: number[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry) => appendParsed(entry, collected));
  } else if (typeof value === "string") {
    value
      .split(/[,;\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .forEach((token) => appendParsed(token, collected));
  } else {
    appendParsed(value, collected);
  }

  const deduped = Array.from(
    new Set(collected.filter((id) => Number.isInteger(id) && id >= 0)),
  );
  return deduped.length > 0 ? deduped : undefined;
};

const readBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return undefined;
};

const normalizeTaskScoreSettings = (config: unknown): Partial<TaskScoreSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.taskScore === "object"
      ? (record.taskScore as Record<string, unknown>)
      : typeof record.task_score === "object"
      ? (record.task_score as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const templateIdsRaw = (candidate.templateIds ?? candidate.template_ids) as unknown;
  const templateIds = Array.isArray(templateIdsRaw)
    ? Array.from(
        new Set(
          templateIdsRaw
            .map((entry) => Number(entry))
            .filter((entry) => Number.isInteger(entry) && entry > 0),
        ),
      )
    : undefined;

  const minimumMultiplier =
    readNumeric(
      candidate.minimumMultiplier ??
        candidate.minimum_multiplier ??
        candidate.minimumCompletionRate ??
        candidate.minimum_completion_rate,
    ) ?? undefined;

  const maximumMultiplier =
    readNumeric(
      candidate.maximumMultiplier ??
        candidate.maximum_multiplier ??
        candidate.maximumCompletionRate ??
        candidate.maximum_completion_rate,
    ) ?? undefined;

  const treatWaivedAsComplete =
    readBoolean(
      candidate.treatWaivedAsComplete ??
        candidate.waivedCountsAsComplete ??
        candidate.includeWaived,
    ) ?? undefined;

  const treatPendingAsComplete =
    readBoolean(
      candidate.treatPendingAsComplete ??
        candidate.pendingCountsAsComplete ??
        candidate.includePending,
    ) ?? undefined;

  const settings: Partial<TaskScoreSettings> = {};
  if (templateIds && templateIds.length > 0) {
    settings.templateIds = templateIds;
  }
  if (minimumMultiplier !== undefined) {
    settings.minimumMultiplier = Number(minimumMultiplier);
  }
  if (maximumMultiplier !== undefined) {
    settings.maximumMultiplier = Number(maximumMultiplier);
  }
  if (treatWaivedAsComplete !== undefined) {
    settings.treatWaivedAsComplete = treatWaivedAsComplete;
  }
  if (treatPendingAsComplete !== undefined) {
    settings.treatPendingAsComplete = treatPendingAsComplete;
  }
  return settings;
};

const resolveTaskScoreSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): TaskScoreSettings => {
  const componentSettings = normalizeTaskScoreSettings(component.config);
  const assignmentSettings = normalizeTaskScoreSettings(assignment.config);

  const merged: TaskScoreSettings = {
    templateIds: assignmentSettings.templateIds ?? componentSettings.templateIds,
    minimumMultiplier:
      assignmentSettings.minimumMultiplier ??
      componentSettings.minimumMultiplier ??
      0,
    maximumMultiplier:
      assignmentSettings.maximumMultiplier ??
      componentSettings.maximumMultiplier ??
      1,
    treatWaivedAsComplete:
      assignmentSettings.treatWaivedAsComplete ??
      componentSettings.treatWaivedAsComplete ??
      true,
    treatPendingAsComplete:
      assignmentSettings.treatPendingAsComplete ??
      componentSettings.treatPendingAsComplete ??
      false,
  };

  if (!merged.templateIds || merged.templateIds.length === 0) {
    merged.templateIds = undefined;
  }

  if (!Number.isFinite(merged.minimumMultiplier) || merged.minimumMultiplier < 0) {
    merged.minimumMultiplier = 0;
  }
  if (!Number.isFinite(merged.maximumMultiplier)) {
    merged.maximumMultiplier = 1;
  }
  if (merged.maximumMultiplier < merged.minimumMultiplier) {
    merged.maximumMultiplier = merged.minimumMultiplier;
  }

  return merged;
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const computeTaskScorePayout = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
  summary: CommissionSummary,
  taskScoreLookup: TaskScoreLookup,
) => {
  const baseAmount = Number(assignment.baseAmount ?? 0);
  if (baseAmount === 0) {
    return 0;
  }

  const userSummary = taskScoreLookup.get(summary.userId);
  if (!userSummary) {
    return baseAmount;
  }

  const settings = resolveTaskScoreSettings(component, assignment);
  const bucket = selectTaskBucket(userSummary, settings.templateIds);
  if (!bucket || bucket.total === 0) {
    return baseAmount;
  }

  const completedCount =
    bucket.completed +
    (settings.treatWaivedAsComplete ? bucket.waived : 0) +
    (settings.treatPendingAsComplete ? bucket.pending : 0);

  const completionRatio = bucket.total > 0 ? completedCount / bucket.total : 1;
  const multiplier = clampValue(
    completionRatio,
    settings.minimumMultiplier,
    settings.maximumMultiplier,
  );

  let total = baseAmount * multiplier;
  const unitAmount = Number(assignment.unitAmount ?? 0);
  if (!Number.isNaN(unitAmount) && unitAmount !== 0) {
    total += unitAmount * completedCount;
  }

  return total;
};

const buildTaskScoreLookup = async (
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
): Promise<TaskScoreLookup> => {
  const logs = await AssistantManagerTaskLog.findAll({
    attributes: ["userId", "templateId", "status"],
    where: {
      taskDate: {
        [Op.between]: [rangeStart.format("YYYY-MM-DD"), rangeEnd.format("YYYY-MM-DD")],
      },
    },
  });

  const summaryByUser = new Map<number, TaskLogSummary>();

  logs.forEach((log) => {
    const userId = log.getDataValue("userId");
    if (!userId) {
      return;
    }
    const templateId = log.getDataValue("templateId");
    const status = log.getDataValue("status") as AssistantManagerTaskStatus;

    let userSummary = summaryByUser.get(userId);
    if (!userSummary) {
      userSummary = {
        overall: createStatusBucket(),
        byTemplate: new Map<number, TaskLogStatusBucket>(),
      };
      summaryByUser.set(userId, userSummary);
    }

    incrementStatusBucket(userSummary.overall, status);
    if (templateId) {
      let templateSummary = userSummary.byTemplate.get(templateId);
      if (!templateSummary) {
        templateSummary = createStatusBucket();
        userSummary.byTemplate.set(templateId, templateSummary);
      }
      incrementStatusBucket(templateSummary, status);
    }
  });

  return summaryByUser;
};

type NightReportIncentiveSettings = {
  minAttendance: number;
  minReports: number;
  retentionThreshold: number;
  payoutPerQualifiedReport: number;
  retentionBonusPerDay: number;
  bestOfRangeBonus: number;
  perCustomerRate: number;
  perCustomerSource: 'total' | 'open_bar';
  dynamicMinAttendanceMultiplier: number;
  allowedProductIds: number[] | null;
};

type NightReportBestCacheEntry = {
  topUserIds: Set<number>;
  topHits: number;
};

type ReviewPayoutSettings = {
  minReviews: number;
  maxReviews: number | null;
  rate: number;
};

type PlatformGuestTier = {
  size: number | null;
  rate: number;
};

type PlatformGuestSettings = {
  minimumGuests: number;
  tiers: PlatformGuestTier[];
};

const buildProductFilterSet = (productIds: number[] | null): Set<number> | null => {
  if (!productIds || productIds.length === 0) {
    return null;
  }
  return new Set(productIds);
};

const reportMatchesProductFilter = (
  report: { productId: number | null },
  filter: Set<number> | null,
): boolean => {
  if (!filter) {
    return true;
  }
  if (report.productId === null || report.productId === undefined) {
    return false;
  }
  return filter.has(report.productId);
};

const normalizeNightReportConfig = (config: unknown): Partial<NightReportIncentiveSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.nightReport === "object"
      ? (record.nightReport as Record<string, unknown>)
      : typeof record.night_report === "object"
      ? (record.night_report as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const settings: Partial<NightReportIncentiveSettings> = {};

  const minAttendance =
    readNumeric(candidate.minAttendance ?? candidate.min_attendance ?? candidate.minimumAttendance) ??
    undefined;
  if (minAttendance !== undefined) {
    settings.minAttendance = minAttendance;
  }

  const minReports =
    readNumeric(candidate.minReports ?? candidate.min_reports ?? candidate.minimumReports) ?? undefined;
  if (minReports !== undefined) {
    settings.minReports = minReports;
  }

  const retentionThreshold =
    readNumeric(
      candidate.retentionThreshold ??
        candidate.retention_threshold ??
        candidate.retentionTarget ??
        candidate.retention_target,
    ) ?? undefined;
  if (retentionThreshold !== undefined) {
    settings.retentionThreshold = retentionThreshold;
  }

  const payoutPerQualifiedReport =
    readNumeric(
      candidate.payoutPerQualifiedReport ??
        candidate.payout_per_qualified_report ??
        candidate.payoutPerReport ??
        candidate.payout_per_report,
    ) ?? undefined;
  if (payoutPerQualifiedReport !== undefined) {
    settings.payoutPerQualifiedReport = payoutPerQualifiedReport;
  }

  const retentionBonusPerDay =
    readNumeric(
      candidate.retentionBonusPerDay ??
        candidate.retention_bonus_per_day ??
        candidate.retentionBonus ??
        candidate.retention_bonus,
    ) ?? undefined;
  if (retentionBonusPerDay !== undefined) {
    settings.retentionBonusPerDay = retentionBonusPerDay;
  }

  const bestOfRangeBonus =
    readNumeric(
      candidate.bestOfRangeBonus ??
        candidate.best_of_range_bonus ??
        candidate.bestStaffBonus ??
        candidate.best_staff_bonus,
    ) ?? undefined;
  if (bestOfRangeBonus !== undefined) {
    settings.bestOfRangeBonus = bestOfRangeBonus;
  }

  const perCustomerRate =
    readNumeric(
      candidate.perCustomerRate ??
        candidate.per_customer_rate ??
        candidate.perAttendeeRate ??
        candidate.per_attendee_rate,
    ) ?? undefined;
  if (perCustomerRate !== undefined) {
    settings.perCustomerRate = perCustomerRate;
  }

  const perCustomerSourceRaw =
    candidate.perCustomerSource ??
    candidate.per_customer_source ??
    candidate.attendanceSource ??
    candidate.attendance_source;
  if (typeof perCustomerSourceRaw === 'string') {
    const normalized = perCustomerSourceRaw.trim().toLowerCase();
    settings.perCustomerSource = normalized === 'open_bar' || normalized === 'openbar' ? 'open_bar' : 'total';
  }

  const dynamicMultiplier =
    readNumeric(
      candidate.dynamicMinAttendanceMultiplier ??
        candidate.dynamic_min_attendance_multiplier ??
        candidate.attendanceMultiplier ??
        candidate.attendance_multiplier,
    ) ?? undefined;
  if (dynamicMultiplier !== undefined) {
    settings.dynamicMinAttendanceMultiplier = dynamicMultiplier;
  }

  const allowedProducts =
    readNumericArray(
      candidate.allowedProductIds ??
        candidate.allowed_product_ids ??
        candidate.productIds ??
        candidate.product_ids ??
        candidate.products ??
        candidate.productFilter ??
        candidate.product_filter,
    ) ?? undefined;
  if (allowedProducts !== undefined) {
    settings.allowedProductIds = allowedProducts;
  }

  return settings;
};

const normalizeReviewPayoutConfig = (config: unknown): Partial<ReviewPayoutSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.reviewPayout === "object"
      ? (record.reviewPayout as Record<string, unknown>)
      : typeof record.review_payout === "object"
      ? (record.review_payout as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const settings: Partial<ReviewPayoutSettings> = {};
  const minReviews =
    readNumeric(
      candidate.minReviews ??
        candidate.min_reviews ??
        candidate.minimumReviews ??
        candidate.minimum_reviews,
    ) ?? undefined;
  if (minReviews !== undefined) {
    settings.minReviews = Math.max(1, Math.floor(minReviews));
  }

  const maxReviews =
    readNumeric(
      candidate.maxReviews ??
        candidate.max_reviews ??
        candidate.maximumReviews ??
        candidate.maximum_reviews,
    ) ?? undefined;
  if (maxReviews !== undefined) {
    settings.maxReviews = Math.max(1, Math.floor(maxReviews));
  }

  const rate =
    readNumeric(candidate.rate ?? candidate.amount ?? candidate.unitAmount ?? candidate.unit_amount) ??
    undefined;
  if (rate !== undefined) {
    settings.rate = rate;
  }

  return settings;
};

type ReviewTargetRequirement = {
  minReviews: number;
};

const normalizeReviewRequirementConfig = (config: unknown): Partial<ReviewTargetRequirement> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.requiresReviewTarget === "object"
      ? (record.requiresReviewTarget as Record<string, unknown>)
      : typeof record.requires_review_target === "object"
      ? (record.requires_review_target as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const minReviews =
    readNumeric(
      candidate.minReviews ??
        candidate.min_reviews ??
        candidate.minimumReviews ??
        candidate.minimum_reviews,
    ) ?? undefined;
  if (minReviews === undefined) {
    return {};
  }
  return { minReviews: Math.max(1, Math.floor(minReviews)) };
};

const normalizePlatformGuestConfig = (config: unknown): Partial<PlatformGuestSettings> => {
  if (!config || typeof config !== "object") {
    return {};
  }
  const record = config as Record<string, unknown>;
  const candidate =
    typeof record.platformGuests === "object"
      ? (record.platformGuests as Record<string, unknown>)
      : typeof record.platform_guests === "object"
      ? (record.platform_guests as Record<string, unknown>)
      : record;
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const tiersRaw = Array.isArray(candidate.tiers) ? candidate.tiers : [];
  const tiers: PlatformGuestTier[] = [];
  tiersRaw.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const bucket = entry as Record<string, unknown>;
    const sizeRaw = readNumeric(bucket.size ?? bucket.block ?? bucket.units ?? bucket.limit);
    const rateRaw = readNumeric(bucket.rate ?? bucket.amount ?? bucket.unitAmount ?? bucket.unit_amount);
    if (!Number.isFinite(rateRaw) || rateRaw === undefined || rateRaw === null) {
      return;
    }
    const normalizedSize =
      sizeRaw !== undefined && sizeRaw !== null
        ? Math.max(1, Math.floor(sizeRaw))
        : null;
    tiers.push({
      size: normalizedSize,
      rate: rateRaw,
    });
  });

  const minimumGuests =
    readNumeric(candidate.minimumGuests ?? candidate.minimum_guests) ??
    (tiers.length > 0 && tiers[0].size ? tiers[0].size : 0) ??
    0;

  return {
    minimumGuests: Math.max(0, Math.floor(minimumGuests)),
    tiers,
  };
};

const resolveNightReportSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): NightReportIncentiveSettings => {
  const componentSettings = normalizeNightReportConfig(component.config ?? {});
  const assignmentSettings = normalizeNightReportConfig(assignment.config ?? {});
  const merged: NightReportIncentiveSettings = {
    minAttendance: assignmentSettings.minAttendance ?? componentSettings.minAttendance ?? 0,
    minReports: assignmentSettings.minReports ?? componentSettings.minReports ?? 0,
    retentionThreshold:
      assignmentSettings.retentionThreshold ?? componentSettings.retentionThreshold ?? 0,
    payoutPerQualifiedReport:
      assignmentSettings.payoutPerQualifiedReport ??
      componentSettings.payoutPerQualifiedReport ??
      Number(assignment.baseAmount ?? 0),
    retentionBonusPerDay:
      assignmentSettings.retentionBonusPerDay ??
      componentSettings.retentionBonusPerDay ??
      Number(assignment.unitAmount ?? 0),
    bestOfRangeBonus:
      assignmentSettings.bestOfRangeBonus ?? componentSettings.bestOfRangeBonus ?? 0,
    perCustomerRate:
      assignmentSettings.perCustomerRate ?? componentSettings.perCustomerRate ?? 0,
    perCustomerSource:
      assignmentSettings.perCustomerSource ?? componentSettings.perCustomerSource ?? 'total',
    dynamicMinAttendanceMultiplier:
      assignmentSettings.dynamicMinAttendanceMultiplier ??
      componentSettings.dynamicMinAttendanceMultiplier ??
      4,
    allowedProductIds:
      assignmentSettings.allowedProductIds ??
      componentSettings.allowedProductIds ??
      null,
  };

  if (!Number.isFinite(merged.minAttendance) || merged.minAttendance < 0) {
    merged.minAttendance = 0;
  }
  if (!Number.isFinite(merged.minReports) || merged.minReports < 0) {
    merged.minReports = 0;
  }
  if (!Number.isFinite(merged.retentionThreshold)) {
    merged.retentionThreshold = 0;
  } else if (merged.retentionThreshold > 1) {
    merged.retentionThreshold = 1;
  } else if (merged.retentionThreshold < 0) {
    merged.retentionThreshold = 0;
  }
  if (!Number.isFinite(merged.payoutPerQualifiedReport)) {
    merged.payoutPerQualifiedReport = 0;
  }
  if (!Number.isFinite(merged.retentionBonusPerDay)) {
    merged.retentionBonusPerDay = 0;
  }
  if (!Number.isFinite(merged.bestOfRangeBonus)) {
    merged.bestOfRangeBonus = 0;
  }
  if (!Number.isFinite(merged.perCustomerRate) || merged.perCustomerRate < 0) {
    merged.perCustomerRate = 0;
  }
  if (merged.perCustomerSource !== 'open_bar') {
    merged.perCustomerSource = 'total';
  }
  if (!Number.isFinite(merged.dynamicMinAttendanceMultiplier) || merged.dynamicMinAttendanceMultiplier <= 0) {
    merged.dynamicMinAttendanceMultiplier = 4;
  }
  if (merged.allowedProductIds && merged.allowedProductIds.length > 0) {
    const sanitized = Array.from(
      new Set(
        merged.allowedProductIds.filter((id) => Number.isInteger(id) && id >= 0),
      ),
    ).sort((a, b) => a - b);
    merged.allowedProductIds = sanitized.length > 0 ? sanitized : null;
  } else {
    merged.allowedProductIds = null;
  }

  return merged;
};

const resolveReviewPayoutSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): ReviewPayoutSettings | null => {
  const componentSettings = normalizeReviewPayoutConfig(component.config ?? {});
  const assignmentSettings = normalizeReviewPayoutConfig(assignment.config ?? {});

  const minReviewsCandidate =
    assignmentSettings.minReviews ?? componentSettings.minReviews ?? 1;
  const maxReviewsCandidate =
    assignmentSettings.maxReviews ?? componentSettings.maxReviews ?? null;
  const rateCandidate =
    assignmentSettings.rate ??
    componentSettings.rate ??
    Number(assignment.unitAmount ?? 0);

  if (!Number.isFinite(rateCandidate) || rateCandidate === 0) {
    return null;
  }

  const minReviews = Math.max(1, Math.floor(minReviewsCandidate));
  let maxReviews: number | null = null;
  if (maxReviewsCandidate !== null && maxReviewsCandidate !== undefined) {
    const normalizedMax = Math.max(minReviews, Math.floor(maxReviewsCandidate));
    maxReviews = normalizedMax;
  }

  return {
    minReviews,
    maxReviews,
    rate: rateCandidate,
  };
};

const resolveReviewTargetRequirement = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): ReviewTargetRequirement | null => {
  const componentRequirement = normalizeReviewRequirementConfig(component.config ?? {});
  const assignmentRequirement = normalizeReviewRequirementConfig(assignment.config ?? {});

  const minReviews =
    assignmentRequirement.minReviews ?? componentRequirement.minReviews ?? null;

  if (minReviews === null || minReviews <= 0) {
    return null;
  }

  return { minReviews };
};

const computeReviewPayoutAmount = (
  summary: CommissionSummary,
  settings: ReviewPayoutSettings,
): number => {
  const eligibleReviews = summary.reviewTotals?.totalEligibleReviews ?? 0;
  if (eligibleReviews < settings.minReviews) {
    return 0;
  }

  const upperBound = settings.maxReviews ?? eligibleReviews;
  const cappedUpper = Math.min(eligibleReviews, upperBound);
  if (cappedUpper < settings.minReviews) {
    return 0;
  }

  const units = cappedUpper - settings.minReviews + 1;
  if (units <= 0) {
    return 0;
  }

  return units * settings.rate;
};

const resolvePlatformGuestSettings = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
): PlatformGuestSettings | null => {
  const componentSettings = normalizePlatformGuestConfig(component.config ?? {});
  const assignmentSettings = normalizePlatformGuestConfig(assignment.config ?? {});

  const tiers = (assignmentSettings.tiers ?? componentSettings.tiers ?? []).filter(
    (tier): tier is PlatformGuestTier =>
      !!tier && Number.isFinite(tier.rate) && tier.rate !== 0 && (tier.size === null || tier.size > 0),
  );

  if (tiers.length === 0) {
    return null;
  }

  const minimumGuests =
    assignmentSettings.minimumGuests ??
    componentSettings.minimumGuests ??
    (tiers[0].size ?? 0);

  return {
    minimumGuests: Math.max(0, Math.floor(minimumGuests)),
    tiers,
  };
};

const computePlatformGuestPayout = (
  summary: CommissionSummary,
  settings: PlatformGuestSettings,
  componentId: number,
): number => {
  const totalGuests = summary.platformGuestTotals?.totalGuests ?? 0;
  if (totalGuests < settings.minimumGuests || totalGuests <= 0) {
    delete summary.platformGuestBreakdowns[componentId];
    return 0;
  }

  let remaining = totalGuests;
  let total = 0;
  let processed = 0;
  const breakdownEntries: PlatformGuestTierBreakdown[] = [];
  for (const tier of settings.tiers) {
    const tierSize = tier.size ?? remaining;
    if (tierSize <= 0) {
      continue;
    }
    const units = Math.min(remaining, tierSize);
    if (units <= 0) {
      break;
    }
    total += units * tier.rate;
    processed += units;
    breakdownEntries.push({
      tierIndex: breakdownEntries.length,
      rate: tier.rate,
      units,
      amount: units * tier.rate,
      cumulativeGuests: processed,
    });
    remaining -= units;
    if (remaining <= 0) {
      break;
    }
  }

  if (breakdownEntries.length > 0) {
    summary.platformGuestBreakdowns[componentId] = breakdownEntries;
  } else {
    delete summary.platformGuestBreakdowns[componentId];
  }

  return total;
};

const computeNightReportIncentive = (
  component: CompensationComponent,
  assignment: CompensationComponentAssignment,
  summary: CommissionSummary,
  nightReportStats: NightReportStatsMap,
  nightReportBestCache: Map<string, NightReportBestCacheEntry>,
  productBucketsByUser: ProductBucketLookup,
) => {
  const leaderStats = nightReportStats.get(summary.userId);
  if (!leaderStats) {
    return 0;
  }

  const settings = resolveNightReportSettings(component, assignment);
  const productFilter = buildProductFilterSet(settings.allowedProductIds);
  const qualifiedReports = leaderStats.reports.filter((report) => {
    if (!reportMatchesProductFilter(report, productFilter)) {
      return false;
    }
    const baseCount = report.postOpenBarPeople ?? 0;
    const hasDynamic = settings.dynamicMinAttendanceMultiplier > 0;
    const dynamicTarget =
      hasDynamic && baseCount > 0 ? baseCount * settings.dynamicMinAttendanceMultiplier : null;
    if (hasDynamic && baseCount <= 0 && (!settings.minAttendance || settings.minAttendance <= 0)) {
      return false;
    }
    const target =
      dynamicTarget !== null && dynamicTarget > 0 ? dynamicTarget : settings.minAttendance;
    return target > 0 ? report.totalPeople >= target : report.totalPeople > 0;
  });

  if (qualifiedReports.length < settings.minReports) {
    return 0;
  }

  const productAmountMap = new Map<
    string,
    { productId: number | null; productName: string; amount: number }
  >();

  const creditReportAmount = (report: typeof qualifiedReports[number] | null, amount: number) => {
    if (!report || !amount) {
      return;
    }
    const productId = report.productId ?? null;
    const productName =
      report.productName ?? (productId !== null ? `Product ${productId}` : "Unassigned Product");
    const key = productId === null ? "__null__" : `${productId}`;
    if (!productAmountMap.has(key)) {
      productAmountMap.set(key, { productId, productName, amount: 0 });
    }
    const entry = productAmountMap.get(key)!;
    entry.amount += amount;
    recordCounterIncentiveMarker(summary, report.counterId, component.name ?? component.id.toString());
    recordCounterIncentiveTotal(summary, report.counterId, amount);
  };

  if (settings.payoutPerQualifiedReport !== 0) {
    qualifiedReports.forEach((report) => {
      creditReportAmount(report, settings.payoutPerQualifiedReport);
    });
  }

  if (settings.retentionBonusPerDay !== 0) {
    qualifiedReports.forEach((report) => {
      if (report.retentionRatio >= settings.retentionThreshold) {
        creditReportAmount(report, settings.retentionBonusPerDay);
      }
    });
  }

  if (settings.perCustomerRate > 0) {
    qualifiedReports.forEach((report) => {
      const attendance =
        settings.perCustomerSource === "open_bar"
          ? report.openBarPeople ?? 0
          : report.totalPeople ?? 0;
      if (attendance > 0) {
        creditReportAmount(report, attendance * settings.perCustomerRate);
      }
    });
  }

  if (settings.bestOfRangeBonus > 0) {
    const bestEntry = getNightReportBestEntry(nightReportBestCache, settings, nightReportStats);
    if (bestEntry.topHits > 0 && bestEntry.topUserIds.has(summary.userId)) {
      let bestReport: (typeof qualifiedReports)[number] | null = null;
      qualifiedReports.forEach((candidate) => {
        if (!bestReport || candidate.retentionRatio > bestReport.retentionRatio) {
          bestReport = candidate;
        }
      });
      creditReportAmount(bestReport, settings.bestOfRangeBonus);
    }
  }

  let total = 0;
  productAmountMap.forEach((entry) => {
    total += entry.amount;
    allocateComponentToProduct(
      productBucketsByUser,
      summary.userId,
      entry.productId,
      entry.productName,
      component.id,
      entry.amount,
    );
  });

  return total;
};

const getNightReportBestEntry = (
  cache: Map<string, NightReportBestCacheEntry>,
  settings: NightReportIncentiveSettings,
  nightReportStats: NightReportStatsMap,
): NightReportBestCacheEntry => {
  const productFilter = buildProductFilterSet(settings.allowedProductIds);
  const productKey =
    settings.allowedProductIds && settings.allowedProductIds.length > 0
      ? settings.allowedProductIds.join(",")
      : "*";
  const cacheKey = [
    settings.minAttendance,
    settings.minReports,
    settings.retentionThreshold,
    settings.dynamicMinAttendanceMultiplier,
    productKey,
  ].join("|");
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let topHits = 0;
  const topUserIds = new Set<number>();

  nightReportStats.forEach((summary, userId) => {
    const qualifiedReports = summary.reports.filter((report) => {
      if (!reportMatchesProductFilter(report, productFilter)) {
        return false;
      }
      const baseCount = report.postOpenBarPeople ?? 0;
      const hasDynamic = settings.dynamicMinAttendanceMultiplier > 0;
      const dynamicTarget =
        hasDynamic && baseCount > 0 ? baseCount * settings.dynamicMinAttendanceMultiplier : null;
      if (hasDynamic && baseCount <= 0 && (!settings.minAttendance || settings.minAttendance <= 0)) {
        return false;
      }
      const target =
        dynamicTarget !== null && dynamicTarget > 0 ? dynamicTarget : settings.minAttendance;
      return target > 0 ? report.totalPeople >= target : report.totalPeople > 0;
    });
    if (qualifiedReports.length < settings.minReports) {
      return;
    }
    const retentionHits = qualifiedReports.filter(
      (report) => report.retentionRatio >= settings.retentionThreshold,
    ).length;
    if (retentionHits > topHits) {
      topHits = retentionHits;
      topUserIds.clear();
      topUserIds.add(userId);
    } else if (retentionHits === topHits && retentionHits > 0) {
      topUserIds.add(userId);
    }
  });

  const entry: NightReportBestCacheEntry = { topHits, topUserIds };
  cache.set(cacheKey, entry);
  return entry;
};

const resolveAssignmentTargets = async (
  summaries: Map<number, CommissionSummary>,
  components: Array<CompensationComponent & { assignments?: CompensationComponentAssignment[] }>,
): Promise<AssignmentTargetMap> => {
  const targets = new Map<number, number[]>();
  const staffTypeCache = new Map<string, number[]>();
  const shiftRoleCache = new Map<number, number[]>();
  const userTypeCache = new Map<number, number[]>();
  const missingUserIds = new Set<number>();

  for (const component of components) {
    for (const assignment of component.assignments ?? []) {
      let userIds: number[] = [];
      if (assignment.targetScope === "user" && assignment.userId) {
        userIds = [assignment.userId];
      } else if (assignment.targetScope === "staff_type" && assignment.staffType) {
        userIds = await fetchStaffTypeUserIds(assignment.staffType, staffTypeCache);
      } else if (assignment.targetScope === "shift_role" && assignment.shiftRoleId) {
        userIds = await fetchShiftRoleUserIds(assignment.shiftRoleId, shiftRoleCache);
      } else if (assignment.targetScope === "user_type" && assignment.userTypeId) {
        userIds = await fetchUserTypeUserIds(assignment.userTypeId, userTypeCache);
      }

      if (userIds.length > 0) {
        targets.set(assignment.id, userIds);
      }

      userIds.forEach((userId) => {
        if (!summaries.has(userId)) {
          missingUserIds.add(userId);
        }
      });
    }
  }

  if (missingUserIds.size > 0) {
    const users = await User.findAll({
      where: {
        id: { [Op.in]: Array.from(missingUserIds) },
        status: true,
      },
      attributes: ["id", "firstName"],
    });

    users.forEach((user) => {
      if (!summaries.has(user.id)) {
        summaries.set(user.id, createEmptySummary(user.id, user.firstName ?? `User ${user.id}`));
      }
    });
  }

  return targets;
};

const fetchStaffTypeUserIds = async (
  staffType: string,
  cache: Map<string, number[]>,
): Promise<number[]> => {
  if (!staffType) {
    return [];
  }
  if (cache.has(staffType)) {
    return cache.get(staffType) ?? [];
  }
  const profiles = await StaffProfile.findAll({
    where: { staffType, active: true },
    attributes: ["userId"],
  });
  const userIds = profiles.map((profile) => profile.userId);
  cache.set(staffType, userIds);
  return userIds;
};

const fetchShiftRoleUserIds = async (
  shiftRoleId: number,
  cache: Map<number, number[]>,
): Promise<number[]> => {
  if (!shiftRoleId) {
    return [];
  }
  if (cache.has(shiftRoleId)) {
    return cache.get(shiftRoleId) ?? [];
  }
  const rows = await UserShiftRole.findAll({
    where: { shiftRoleId },
    attributes: ["userId"],
  });
  const userIds = rows.map((row) => row.userId);
  cache.set(shiftRoleId, userIds);
  return userIds;
};

const fetchUserTypeUserIds = async (
  userTypeId: number,
  cache: Map<number, number[]>,
): Promise<number[]> => {
  if (!userTypeId) {
    return [];
  }
  if (cache.has(userTypeId)) {
    return cache.get(userTypeId) ?? [];
  }
  const users = await User.findAll({
    where: { userTypeId, status: true },
    attributes: ["id"],
  });
  const userIds = users.map((user) => user.id);
  cache.set(userTypeId, userIds);
  return userIds;
};

function describeField(
  fieldName: string,
  attribute: ModelAttributeColumnOptions<Model>,
): ReportModelFieldDescriptor {
  const columnName = (attribute.field as string | undefined) ?? fieldName;
  const type = describeAttributeType(attribute);
  const allowNull =
    attribute.allowNull !== undefined ? attribute.allowNull : !attribute.primaryKey;
  const primaryKey = Boolean(attribute.primaryKey);
  const unique = Boolean(
    typeof attribute.unique === "boolean"
      ? attribute.unique
      : attribute.unique && typeof attribute.unique === "object",
  );
  const defaultValue = serializeDefaultValue(attribute.defaultValue);

  let referenceModel: string | null = null;
  let referenceKey: string | null = null;
  const references = attribute.references;
  if (references) {
    if (typeof references === "string") {
      referenceModel = references;
    } else {
      const referenceOptions = references as ModelAttributeColumnReferencesOptions;
      const modelReference = referenceOptions.model;
      if (typeof modelReference === "string") {
        referenceModel = modelReference;
      } else if (modelReference && typeof modelReference === "object") {
        referenceModel =
          (modelReference as { tableName?: string; name?: string }).tableName ??
          (modelReference as { name?: string }).name ??
          null;
      }
      if (typeof referenceOptions.key === "string") {
        referenceKey = referenceOptions.key;
      }
    }
  }

  return {
    fieldName,
    columnName,
    type,
    allowNull,
    primaryKey,
    defaultValue,
    unique,
    references: referenceModel
      ? {
          model: referenceModel,
          key: referenceKey,
        }
      : undefined,
  };
}

function describeAssociation(association: Association): ReportModelAssociationDescriptor {
  const target =
    (association.target && "name" in association.target
      ? (association.target as { name?: string }).name
      : undefined) ?? "";

  const foreignKeyRaw = (association as unknown as { foreignKey?: string | { fieldName?: string } })
    .foreignKey;
  const foreignKey =
    typeof foreignKeyRaw === "string"
      ? foreignKeyRaw
      : foreignKeyRaw && typeof foreignKeyRaw === "object"
      ? foreignKeyRaw.fieldName
      : undefined;

  const through =
    (association as unknown as { throughModel?: { name?: string } }).throughModel?.name ??
    (association as unknown as { through?: { model?: { name?: string } } }).through?.model?.name ??
    null;

  return {
    name: (association as { as?: string }).as ?? null,
    targetModel: target,
    associationType: association.associationType,
    foreignKey,
    sourceKey: (association as { sourceKey?: string }).sourceKey,
    through,
    as: (association as { as?: string }).as,
  };
}

function describeAttributeType(attribute: ModelAttributeColumnOptions<Model>): string {
  const rawType = (attribute.type ?? {}) as {
    key?: string;
    toSql?: () => string;
    constructor?: { name?: string };
    options?: { values?: unknown[] };
  };

  if (typeof rawType.toSql === "function") {
    try {
      return rawType.toSql();
    } catch {
      // ignore toSql errors and fall through to other formats
    }
  }

  if (rawType.key) {
    return rawType.key;
  }

  if (rawType.constructor?.name) {
    return rawType.constructor.name;
  }

  return "UNKNOWN";
}

function serializeDefaultValue(
  defaultValue: ModelAttributeColumnOptions<Model>["defaultValue"],
): string | number | boolean | null {
  if (defaultValue === undefined || defaultValue === null) {
    return null;
  }

  if (typeof defaultValue === "function") {
    return "[function]";
  }

  if (defaultValue instanceof Date) {
    return defaultValue.toISOString();
  }

  if (typeof defaultValue === "string" || typeof defaultValue === "number" || typeof defaultValue === "boolean") {
    return defaultValue;
  }

  return String(defaultValue);
}

function buildModelDescription(modelName: string, schema: string | undefined, tableName: string): string {
  if (schema) {
    return `${modelName} model mapped to ${schema}.${tableName}`;
  }
  return `${modelName} model mapped to ${tableName}`;
}

function findField(
  descriptor: ReportModelDescriptor,
  identifier: string,
): ReportModelFieldDescriptor | undefined {
  return descriptor.fields.find(
    (field) => field.fieldName === identifier || field.columnName === identifier,
  );
}

function ensureModelDescriptor(modelId: string): ReportModelDescriptor | null {
  const cached = modelDescriptorCache.get(modelId);
  if (cached) {
    return cached;
  }

  const sequelizeModel = sequelize.models[modelId];
  if (!sequelizeModel) {
    return null;
  }

  return describeModel(sequelizeModel as ModelCtor<Model>);
}

const escapeLiteral = (value: string): string => value.replace(/'/g, "''");

const resolveColumnExpression = (
  modelId: string,
  fieldId: string,
  aliasMap: Map<string, string>,
): string => {
  const descriptor = ensureModelDescriptor(modelId);
  const modelAlias = aliasMap.get(modelId);
  if (!descriptor || !modelAlias) {
    throw new PreviewQueryError(`Model ${modelId} is not available for derived fields.`);
  }
  const field =
    descriptor.fields.find((candidate) => candidate.fieldName === fieldId) ??
    descriptor.fields.find((candidate) => candidate.columnName === fieldId);
  if (!field) {
    throw new PreviewQueryError(`Field ${fieldId} is not available on model ${modelId}.`);
  }
  return `${modelAlias}.${quoteIdentifier(field.columnName)}`;
};

const renderDerivedFieldExpressionSql = (
  node: DerivedFieldExpressionAst,
  aliasMap: Map<string, string>,
): string => {
  switch (node.type) {
    case "column":
      return resolveColumnExpression(node.modelId, node.fieldId, aliasMap);
    case "literal":
      if (node.valueType === "number") {
        return Number(node.value).toString();
      }
      if (node.valueType === "boolean") {
        return node.value ? "TRUE" : "FALSE";
      }
      return `'${escapeLiteral(String(node.value))}'`;
    case "binary": {
      const left = renderDerivedFieldExpressionSql(node.left, aliasMap);
      const right = renderDerivedFieldExpressionSql(node.right, aliasMap);
      return `(${left} ${node.operator} ${right})`;
    }
    case "unary": {
      const argument = renderDerivedFieldExpressionSql(node.argument, aliasMap);
      return `${node.operator}(${argument})`;
    }
    case "function": {
      const args = node.args.map((arg) => renderDerivedFieldExpressionSql(arg, aliasMap)).join(", ");
      return `${node.name}(${args})`;
    }
    default:
      throw new PreviewQueryError("Unsupported derived field expression node.");
  }
};

const buildDerivedFieldSelectClause = (
  field: DerivedFieldQueryPayload,
  aliasMap: Map<string, string>,
  index: number,
): { clause: string; alias: string } => {
  if (!field.expressionAst) {
    throw new PreviewQueryError("Derived field expression is missing.");
  }
  const expressionSql = renderDerivedFieldExpressionSql(field.expressionAst, aliasMap);
  const alias =
    (typeof field.alias === "string" && field.alias.trim().length > 0
      ? field.alias.trim()
      : field.id.trim().length > 0
      ? field.id.trim()
      : `derived_${index}`) ?? `derived_${index}`;
  return {
    clause: `${expressionSql} AS ${quoteIdentifier(alias)}`,
    alias,
  };
};

function buildFromClause(descriptor: ReportModelDescriptor, alias: string): string {
  return `${quoteTable(descriptor)} ${alias}`;
}

function buildJoinClauses(
  joins: ReportPreviewRequest["joins"],
  aliasMap: Map<string, string>,
  baseModelId: string,
): { clauses: string[]; joinedModels: Set<string>; unresolvedJoins: string[] } {
  if (!joins || joins.length === 0) {
    return { clauses: [], joinedModels: new Set<string>([baseModelId]), unresolvedJoins: [] };
  }

  const clauses: string[] = [];
  const remaining = [...joins];
  const joined = new Set<string>([baseModelId]);
  const unresolved: string[] = [];

  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const join = remaining[index];

      let leftModelId = join.leftModel;
      let rightModelId = join.rightModel;
      let leftFieldId = join.leftField;
      let rightFieldId = join.rightField;

      const leftJoined = joined.has(leftModelId);
      const rightJoined = joined.has(rightModelId);

      if (!leftJoined && rightJoined) {
        // Swap orientation so that the already joined model appears on the left side.
        [leftModelId, rightModelId] = [rightModelId, leftModelId];
        [leftFieldId, rightFieldId] = [rightFieldId, leftFieldId];
      } else if (!leftJoined && !rightJoined) {
        continue;
      }

      const leftAlias = aliasMap.get(leftModelId);
      const rightAlias = aliasMap.get(rightModelId);
      const leftDescriptor = ensureModelDescriptor(leftModelId);
      const rightDescriptor = ensureModelDescriptor(rightModelId);

      if (!leftAlias || !rightAlias || !leftDescriptor || !rightDescriptor) {
        remaining.splice(index, 1);
        progress = true;
        continue;
      }

    const leftField = findField(leftDescriptor, leftFieldId);
      const rightField = findField(rightDescriptor, rightFieldId);
      if (!leftField || !rightField) {
        const knownLeft = leftFieldId.split("__").pop() ?? leftFieldId;
        const knownRight = rightFieldId.split("__").pop() ?? rightFieldId;
        const leftFallback = findField(leftDescriptor, knownLeft);
        const rightFallback = findField(rightDescriptor, knownRight);

        if (!leftFallback || !rightFallback) {
          remaining.splice(index, 1);
          progress = true;
          unresolved.push(
            `${leftModelId}.${leftFieldId} -> ${rightModelId}.${rightFieldId} (missing field metadata)`,
          );
          continue;
        }

        leftFieldId = leftFallback.fieldName;
        rightFieldId = rightFallback.fieldName;
      }

      const resolvedLeftField = leftField ?? findField(leftDescriptor, leftFieldId)!;
      const resolvedRightField = rightField ?? findField(rightDescriptor, rightFieldId)!;

      if (!resolvedLeftField || !resolvedRightField) {
        remaining.splice(index, 1);
        progress = true;
        unresolved.push(
          `${leftModelId}.${leftFieldId} -> ${rightModelId}.${rightFieldId} (missing field metadata)`,
        );
        continue;
      }

      const joinType = (join.joinType ?? "left").toUpperCase();
      const normalizedJoin =
        joinType === "INNER" || joinType === "RIGHT" || joinType === "FULL" ? joinType : "LEFT";

      const rightTable = buildFromClause(rightDescriptor, rightAlias);

      clauses.push(
        `${normalizedJoin} JOIN ${rightTable} ON ${leftAlias}.${quoteIdentifier(resolvedLeftField.columnName ?? resolvedLeftField.fieldName)} = ${rightAlias}.${quoteIdentifier(resolvedRightField.columnName ?? resolvedRightField.fieldName)}`,
      );

      joined.add(rightModelId);
      remaining.splice(index, 1);
      progress = true;
    }
  }

  if (remaining.length > 0) {
    remaining.forEach((join) => {
      unresolved.push(`${join.leftModel}.${join.leftField} -> ${join.rightModel}.${join.rightField}`);
    });
  }

  return { clauses, joinedModels: joined, unresolvedJoins: unresolved };
}

function buildWhereClauses(
  filters: Array<string | PreviewFilterClausePayload>,
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string[] {
  if (!filters || filters.length === 0) {
    return [];
  }
  const clauses: string[] = [];
  filters.forEach((filter) => {
    if (typeof filter === "string") {
      const trimmed = filter.trim();
      if (trimmed.length > 0 && !trimmed.includes(";") && !trimmed.includes("--")) {
        clauses.push(trimmed);
      }
      return;
    }
    clauses.push(renderPreviewFilterClause(filter, aliasMap, derivedFieldLookup));
  });
  return clauses;
}

function renderPreviewFilterClause(
  clause: PreviewFilterClausePayload,
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string {
  const operator = clause.operator;
  const leftExpression =
    clause.leftModelId === DERIVED_FIELD_SENTINEL
      ? renderDerivedFieldFilterExpression(clause.leftFieldId, aliasMap, derivedFieldLookup)
      : resolveColumnExpression(clause.leftModelId, clause.leftFieldId, aliasMap);

  const requiresValue = !["is_null", "is_not_null", "is_true", "is_false"].includes(operator);
  const allowFieldComparison = ["eq", "neq", "gt", "gte", "lt", "lte"].includes(operator);

  if (!requiresValue) {
    switch (operator) {
      case "is_null":
        return `${leftExpression} IS NULL`;
      case "is_not_null":
        return `${leftExpression} IS NOT NULL`;
      case "is_true":
        return `${leftExpression} IS TRUE`;
      case "is_false":
        return `${leftExpression} IS FALSE`;
      default:
        return `${leftExpression} IS NULL`;
    }
  }

  if (clause.rightType === "field") {
    if (!allowFieldComparison) {
      throw new PreviewQueryError("This operator does not support comparing against another field.");
    }
    if (!clause.rightModelId || !clause.rightFieldId) {
      throw new PreviewQueryError("Select a comparison field for this filter.");
    }
    const rightExpression =
      clause.rightModelId === DERIVED_FIELD_SENTINEL
        ? renderDerivedFieldFilterExpression(clause.rightFieldId, aliasMap, derivedFieldLookup)
        : resolveColumnExpression(clause.rightModelId, clause.rightFieldId, aliasMap);
    const operatorSqlMap: Partial<Record<FilterOperator, string>> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };
    const sqlOperator = operatorSqlMap[operator];
    if (!sqlOperator) {
      throw new PreviewQueryError("The selected operator requires a literal value.");
    }
    return `${leftExpression} ${sqlOperator} ${rightExpression}`;
  }

  switch (operator) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      const literal = buildFilterLiteral(
        clause.valueKind ?? "string",
        clause.value,
        `Filter ${clause.leftFieldId}`,
      );
      if (operator === "eq") {
        return `${leftExpression} = ${literal}`;
      }
      if (operator === "neq") {
        return `${leftExpression} <> ${literal}`;
      }
      if (operator === "gt") {
        return `${leftExpression} > ${literal}`;
      }
      if (operator === "gte") {
        return `${leftExpression} >= ${literal}`;
      }
      if (operator === "lt") {
        return `${leftExpression} < ${literal}`;
      }
      return `${leftExpression} <= ${literal}`;
    case "contains": {
      const value = typeof clause.value === "string" ? clause.value.trim() : "";
      if (!value) {
        throw new PreviewQueryError("Provide a value for contains filters.");
      }
      const literalValue = `'${`%${escapeLiteral(value)}%`}'`;
      return `${leftExpression} ILIKE ${literalValue}`;
    }
    case "starts_with": {
      const value = typeof clause.value === "string" ? clause.value.trim() : "";
      if (!value) {
        throw new PreviewQueryError("Provide a value for starts with filters.");
      }
      const literalValue = `'${`${escapeLiteral(value)}%`}'`;
      return `${leftExpression} ILIKE ${literalValue}`;
    }
    case "ends_with": {
      const value = typeof clause.value === "string" ? clause.value.trim() : "";
      if (!value) {
        throw new PreviewQueryError("Provide a value for ends with filters.");
      }
      const literalValue = `'${`%${escapeLiteral(value)}`}'`;
      return `${leftExpression} ILIKE ${literalValue}`;
    }
    default:
      throw new PreviewQueryError("Unsupported filter operator.");
  }
}

function renderDerivedFieldFilterExpression(
  fieldId: string,
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string {
  const derivedField = derivedFieldLookup.get(fieldId);
  if (!derivedField || !derivedField.expressionAst) {
    throw new PreviewQueryError(`Derived field ${fieldId} is not available for this template.`);
  }
  return renderDerivedFieldExpressionSql(derivedField.expressionAst, aliasMap);
}

function buildFilterLiteral(
  kind: PreviewFilterClausePayload["valueKind"],
  value: string | number | boolean | null | undefined,
  label: string,
): string {
  if (kind === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      throw new PreviewQueryError(`Enter a valid number for ${label}.`);
    }
    return String(numeric);
  }
  if (kind === "boolean") {
    const normalized =
      typeof value === "boolean" ? (value ? "true" : "false") : String(value ?? "").toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      throw new PreviewQueryError(`Select true or false for ${label}.`);
    }
    return normalized === "true" ? "TRUE" : "FALSE";
  }
  if (typeof value !== "string") {
    throw new PreviewQueryError(`Provide a value for ${label}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PreviewQueryError(`Provide a value for ${label}.`);
  }
  if (kind === "string" && trimmed.length > 0) {
    return `'${escapeLiteral(trimmed)}'`;
  }
  if (kind === "date") {
    return `'${escapeLiteral(trimmed)}'`;
  }
  return `'${escapeLiteral(trimmed)}'`;
}

function buildOrderByClauses(
  orderBy: PreviewOrderClausePayload[],
  aliasMap: Map<string, string>,
  derivedFieldLookup: Map<string, DerivedFieldQueryPayload>,
): string[] {
  if (!orderBy || orderBy.length === 0) {
    return [];
  }
  return orderBy.map((clause) => {
    const direction = clause.direction?.toUpperCase() === "DESC" ? "DESC" : "ASC";
    if (clause.source === "derived") {
      const expression = renderDerivedFieldFilterExpression(clause.fieldId, aliasMap, derivedFieldLookup);
      return `${expression} ${direction}`;
    }
    if (!clause.modelId) {
      throw new PreviewQueryError("Order by clause is missing a model reference.");
    }
    const expression = resolveColumnExpression(clause.modelId, clause.fieldId, aliasMap);
    return `${expression} ${direction}`;
  });
}

function quoteTable(descriptor: ReportModelDescriptor): string {
  const quoter = getDialectQuoter();
  if (descriptor.schema) {
    return quoter.quoteTable({
      tableName: descriptor.tableName,
      schema: descriptor.schema,
    });
  }
  return quoter.quoteTable(descriptor.tableName);
}

function quoteIdentifier(value: string): string {
  const quoter = getDialectQuoter();
  return quoter.quoteIdentifier(value);
}
