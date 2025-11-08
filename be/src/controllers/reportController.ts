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
import ReportTemplate, {
  ReportTemplateFieldSelection,
  ReportTemplateOptions,
  ReportTemplateDerivedField,
  ReportTemplateMetricSpotlight,
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

type CommissionSummary = {
  userId: number;
  firstName: string;
  totalCommission: number;
  breakdown: Array<{
    date: string;
    commission: number;
    customers: number;
    guidesCount: number;
  }>;
};

type GuideDailyBreakdown = {
  userId: number;
  firstName: string;
  commission: number;
  customers: number;
};

type DailyAggregate = {
  totalCustomers: number;
  guides: Map<number, GuideDailyBreakdown>;
};

const FULL_ACCESS_ROLE_SLUGS = new Set([
  "admin",
  "owner",
  "manager",
  "assistant-manager",
  "assistant_manager",
  "assistantmanager",
]);

const COMMISSION_RATE_PER_ATTENDEE = 6;
const NEW_COUNTER_SYSTEM_START = dayjs("2025-10-08");

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
  filters?: string[];
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
    options,
  };
};

const serializeReportTemplate = (
  template: ReportTemplate & { owner?: User | null },
): SerializedReportTemplate => {
  const owner = template.owner ?? null;
  const ownerName = owner ? `${owner.firstName} ${owner.lastName}`.trim() : "Shared";
  const rawOptions = template.options ?? DEFAULT_TEMPLATE_OPTIONS;
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
  };

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
      ? template.derivedFields.map((field, index) => ({
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
        }))
      : [],
    metricsSpotlight: Array.isArray(template.metricsSpotlight) ? template.metricsSpotlight : [],
    columnOrder: [...mergedOptions.columnOrder],
    columnAliases: { ...mergedOptions.columnAliases },
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
      attributes: ["id", "date"],
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

    const counterMetaById = new Map<number, { dateKey: string; isNewSystem: boolean }>();
    const legacyCounterIds: number[] = [];
    const newSystemCounterIds: number[] = [];

    counters.forEach((counter) => {
      const rawDate = counter.getDataValue("date");
      if (!rawDate) {
        return;
      }

      const counterDate = dayjs(rawDate);
      const dateKey = counterDate.format("YYYY-MM-DD");
      const isNewSystem = !counterDate.isBefore(NEW_COUNTER_SYSTEM_START, "day");

      counterMetaById.set(counter.id, { dateKey, isNewSystem });

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
        commissionDataByUser.set(userId, {
          userId,
          firstName,
          totalCommission: 0,
          breakdown: [],
        });
      }
    });

    const dailyAggregates = new Map<string, DailyAggregate>();

    const getOrCreateDailyAggregate = (dateKey: string): DailyAggregate => {
      let aggregate = dailyAggregates.get(dateKey);
      if (!aggregate) {
        aggregate = {
          totalCustomers: 0,
          guides: new Map<number, GuideDailyBreakdown>(),
        };
        dailyAggregates.set(dateKey, aggregate);
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

      const aggregate = getOrCreateDailyAggregate(meta.dateKey);
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

    const allSummaries = Array.from(commissionDataByUser.values()).map((entry) => ({
      ...entry,
      totalCommission: Number(entry.totalCommission.toFixed(2)),
      breakdown: entry.breakdown.map((item) => ({
        ...item,
        commission: Number(item.commission.toFixed(2)),
      })),
    }));

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

  const whereClauses = buildWhereClauses(payload.filters ?? []);

  const limitValue = Math.min(Math.max(Number(payload.limit ?? 200) || 200, 1), 1000);

  const sqlParts = [
    `SELECT ${selectClauses.join(", ")}`,
    `FROM ${fromClause}`,
    ...joinClauses,
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
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
    const aggregationKey = metric.aggregation;
    const sqlAggregation = aggregationMap[aggregationKey];
    if (!sqlAggregation) {
      throw new PreviewQueryError(`Unsupported aggregation: ${aggregationKey}`);
    }
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
  dailyAggregates: Map<string, DailyAggregate>,
  commissionDataByUser: Map<number, CommissionSummary>,
) {
  dailyAggregates.forEach((aggregate, dateKey) => {
    const guidesCount = aggregate.guides.size;

    aggregate.guides.forEach((guide) => {
      const summary = commissionDataByUser.get(guide.userId);
      if (!summary) {
        return;
      }

      summary.breakdown.push({
        date: dateKey,
        commission: guide.commission,
        customers: guide.customers,
        guidesCount,
      });
    });
  });
}

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

function buildWhereClauses(filters: string[]): string[] {
  return filters
    .map((filter) => (typeof filter === "string" ? filter.trim() : ""))
    .filter((filter) => filter.length > 0 && !filter.includes(";") && !filter.includes("--"));
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
