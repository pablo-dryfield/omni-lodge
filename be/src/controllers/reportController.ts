import { Request, Response } from "express";
import { Association, ModelAttributeColumnOptions, Op, QueryTypes, type ModelAttributeColumnReferencesOptions } from "sequelize";
import { Model, ModelCtor, Sequelize } from "sequelize-typescript";
import dayjs from "dayjs";
import Counter from "../models/Counter.js";
import CounterChannelMetric from "../models/CounterChannelMetric.js";
import CounterProduct from "../models/CounterProduct.js";
import CounterUser from "../models/CounterUser.js";
import User from "../models/User.js";
import ReportTemplate, { ReportTemplateFieldSelection, ReportTemplateOptions } from "../models/ReportTemplate.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import sequelize from "../config/database.js";

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
};

type ReportPreviewResponse = {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  sql: string;
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

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
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

  return {
    name: toStringOr(input.name, ""),
    category: toNullableString(input.category),
    description: toNullableString(input.description),
    schedule: toStringOr(input.schedule, "Manual"),
    models: toStringArray(input.models),
    fields: toFieldSelections(input.fields),
    joins: toUnknownArray(input.joins),
    visuals: toUnknownArray(input.visuals),
    metrics: toStringArray(input.metrics),
    filters: toUnknownArray(input.filters),
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

export const runReportPreview = async (
  req: Request,
  res: Response,
): Promise<void> => {
  let lastSql = "";
  try {
    const payload = req.body as ReportPreviewRequest;

    if (!payload || !Array.isArray(payload.models) || payload.models.length === 0) {
      res.status(400).json({ message: "At least one data model is required." });
      return;
    }

    const requestedFields =
      payload.fields?.filter((entry) => Array.isArray(entry.fieldIds) && entry.fieldIds.length > 0) ?? [];

    if (requestedFields.length === 0) {
      res.status(400).json({ message: "Select at least one field across your models." });
      return;
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
      res.status(400).json({ message: "Unable to determine any valid fields to query." });
      return;
    }

    const baseModelId = payload.models[0];
    const baseDescriptor = ensureModelDescriptor(baseModelId);
    const baseAlias = aliasMap.get(baseModelId)!;
    if (!baseDescriptor) {
      res.status(400).json({ message: `Model ${baseModelId} is not available.` });
      return;
    }

    const fromClause = buildFromClause(baseDescriptor, baseAlias);
    const { clauses: joinClauses, joinedModels, unresolvedJoins } = buildJoinClauses(
      payload.joins ?? [],
      aliasMap,
      baseModelId,
    );

    if (unresolvedJoins.length > 0) {
      res.status(400).json({
        message: "Some models could not be joined. Verify your join configuration.",
        details: unresolvedJoins,
      });
      return;
    }

    const unjoinedModels = payload.models.filter(
      (modelId) => modelId !== baseModelId && !joinedModels.has(modelId),
    );

    if (unjoinedModels.length > 0) {
      res.status(400).json({
        message: "Some selected models are not connected to the base model.",
        details: unjoinedModels,
      });
      return;
    }

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
    lastSql = sql;

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

    res.status(200).json(response);
  } catch (error) {
    console.error("Failed to run report preview", error, lastSql ? `SQL: ${lastSql}` : "");
    const payload =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? { message: "Failed to run report preview.", details: error.message }
        : { message: "Failed to run report preview." };
    res.status(500).json(payload);
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
