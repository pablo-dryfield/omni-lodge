import { Request, Response } from "express";
import { Op } from "sequelize";
import ReportDashboard from "../models/ReportDashboard.js";
import ReportDashboardCard from "../models/ReportDashboardCard.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import { ensureReportingAccess } from "../utils/reportingAccess.js";
import {
  executePreviewQuery,
  type PreviewFilterClausePayload,
  type ReportPreviewRequest,
} from "./reportController.js";
import { PreviewQueryError } from "../errors/PreviewQueryError.js";

const sanitizeLayout = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const sanitizeConfig = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const PREVIEW_CARD_MODE = "preview_table";
const FILTER_OPERATORS = new Set<PreviewFilterClausePayload["operator"]>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
  "is_true",
  "is_false",
]);

type PreviewTableCardConfig = {
  mode: typeof PREVIEW_CARD_MODE;
  previewRequest: ReportPreviewRequest;
  columnOrder: string[];
  columnAliases: Record<string, string>;
};

const sanitizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];

const sanitizeStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key, val]) => typeof key === "string" && typeof val === "string",
  ) as Array<[string, string]>;
  return entries.reduce<Record<string, string>>((acc, [key, val]) => {
    const normalizedKey = key.trim();
    const normalizedValue = val.trim();
    if (normalizedKey.length > 0 && normalizedValue.length > 0) {
      acc[normalizedKey] = normalizedValue;
    }
    return acc;
  }, {});
};

const sanitizePreviewRequest = (value: unknown): ReportPreviewRequest | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const models = sanitizeStringArray(payload.models);
  if (models.length === 0) {
    return null;
  }
  const fieldsInput = Array.isArray(payload.fields) ? payload.fields : [];
  const fields = fieldsInput
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const modelId = typeof record.modelId === "string" ? record.modelId.trim() : "";
      const fieldIds = sanitizeStringArray(record.fieldIds);
      if (!modelId || fieldIds.length === 0) {
        return null;
      }
      return { modelId, fieldIds };
    })
    .filter((entry): entry is { modelId: string; fieldIds: string[] } => Boolean(entry));
  if (fields.length === 0) {
    return null;
  }

  const clone = JSON.parse(JSON.stringify(value)) as ReportPreviewRequest;
  clone.models = models;
  clone.fields = fields;
  return clone;
};

const parsePreviewTableConfig = (
  value: Record<string, unknown> | null | undefined,
): PreviewTableCardConfig | null => {
  const mode = value ? (value as { mode?: unknown }).mode : undefined;
  if (!value || mode !== PREVIEW_CARD_MODE) {
    return null;
  }
  const previewRequest = sanitizePreviewRequest((value as { previewRequest?: unknown }).previewRequest);
  if (!previewRequest) {
    return null;
  }
  return {
    mode: PREVIEW_CARD_MODE,
    previewRequest,
    columnOrder: sanitizeStringArray((value as { columnOrder?: unknown }).columnOrder),
    columnAliases: sanitizeStringRecord((value as { columnAliases?: unknown }).columnAliases),
  };
};

const normalizeViewConfig = (value: unknown): Record<string, unknown> => {
  const sanitized = sanitizeConfig(value);
  const mode = (sanitized as { mode?: unknown }).mode;
  if (mode === PREVIEW_CARD_MODE) {
    const previewConfig = parsePreviewTableConfig(sanitized);
    if (!previewConfig) {
      throw new Error("Invalid preview table configuration.");
    }
    return previewConfig;
  }
  return sanitized;
};

export const listDashboards = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const { search } = req.query;
    const where: Record<string, unknown> = {};
    if (typeof search === "string" && search.trim().length > 0) {
      where.name = { [Op.iLike]: `%${search.trim()}%` };
    }
    const dashboards = await ReportDashboard.findAll({
      where,
      include: [{ model: ReportDashboardCard, as: "cards" }],
      order: [["updatedAt", "DESC"]],
    });

    res.json({
      dashboards: dashboards.map((dashboard) => ({
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        ownerId: dashboard.ownerId,
        config: dashboard.config,
        filters: dashboard.filters,
        shareToken: dashboard.shareToken,
        shareExpiresAt: dashboard.shareExpiresAt?.toISOString() ?? null,
        cards:
          dashboard.cards?.map((card) => ({
            id: card.id,
            templateId: card.templateId,
            title: card.title,
            viewConfig: card.viewConfig,
            layout: card.layout,
            createdAt: card.createdAt?.toISOString() ?? null,
            updatedAt: card.updatedAt?.toISOString() ?? null,
          })) ?? [],
        createdAt: dashboard.createdAt?.toISOString() ?? null,
        updatedAt: dashboard.updatedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to list dashboards", error);
    res.status(500).json({ message: "Failed to load dashboards" });
  }
};

export const createDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const { name, description, config, filters } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ message: "Dashboard name is required." });
      return;
    }

    const dashboard = await ReportDashboard.create({
      ownerId: req.authContext?.id ?? null,
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : null,
      config: sanitizeConfig(config),
      filters: sanitizeConfig(filters),
    });

    res.status(201).json({
      dashboard: {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        ownerId: dashboard.ownerId,
        config: dashboard.config,
        filters: dashboard.filters,
        shareToken: dashboard.shareToken,
        shareExpiresAt: dashboard.shareExpiresAt?.toISOString() ?? null,
        cards: [],
        createdAt: dashboard.createdAt?.toISOString() ?? null,
        updatedAt: dashboard.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to create dashboard", error);
    res.status(500).json({ message: "Failed to create dashboard" });
  }
};

export const updateDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ message: "Dashboard id is required." });
      return;
    }

    const dashboard = await ReportDashboard.findByPk(id);
    if (!dashboard) {
      res.status(404).json({ message: "Dashboard not found." });
      return;
    }

    const { name, description, config, filters, shareToken, shareExpiresAt } = req.body ?? {};
    if (typeof name === "string" && name.trim().length > 0) {
      dashboard.name = name.trim();
    }
    if (description !== undefined) {
      dashboard.description =
        typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
    }
    if (config !== undefined) {
      dashboard.config = sanitizeConfig(config);
    }
    if (filters !== undefined) {
      dashboard.filters = sanitizeConfig(filters);
    }
    if (shareToken !== undefined) {
      dashboard.shareToken =
        typeof shareToken === "string" && shareToken.trim().length > 0 ? shareToken.trim() : null;
    }
    if (shareExpiresAt !== undefined) {
      dashboard.shareExpiresAt =
        typeof shareExpiresAt === "string" || shareExpiresAt instanceof Date
          ? new Date(shareExpiresAt)
          : null;
    }

    await dashboard.save();

    res.json({
      dashboard: {
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        ownerId: dashboard.ownerId,
        config: dashboard.config,
        filters: dashboard.filters,
        shareToken: dashboard.shareToken,
        shareExpiresAt: dashboard.shareExpiresAt?.toISOString() ?? null,
        createdAt: dashboard.createdAt?.toISOString() ?? null,
        updatedAt: dashboard.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to update dashboard", error);
    res.status(500).json({ message: "Failed to update dashboard" });
  }
};

export const exportDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ message: "Dashboard id is required." });
      return;
    }

    const dashboard = await ReportDashboard.findByPk(id, {
      include: [{ model: ReportDashboardCard, as: "cards" }],
    });

    if (!dashboard) {
      res.status(404).json({ message: "Dashboard not found." });
      return;
    }

    const exportPayload = {
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      ownerId: dashboard.ownerId,
      config: dashboard.config,
      filters: dashboard.filters,
      shareToken: dashboard.shareToken,
      shareExpiresAt: dashboard.shareExpiresAt?.toISOString() ?? null,
      cards:
        dashboard.cards?.map((card) => ({
          id: card.id,
          dashboardId: card.dashboardId,
          templateId: card.templateId,
          title: card.title,
          viewConfig: card.viewConfig,
          layout: card.layout,
          createdAt: card.createdAt?.toISOString() ?? null,
          updatedAt: card.updatedAt?.toISOString() ?? null,
        })) ?? [],
      createdAt: dashboard.createdAt?.toISOString() ?? null,
      updatedAt: dashboard.updatedAt?.toISOString() ?? null,
    };

    res.json({
      export: {
        format: "application/json",
        generatedAt: new Date().toISOString(),
        dashboard: exportPayload,
      },
    });
  } catch (error) {
    console.error("Failed to export dashboard", error);
    res.status(500).json({ message: "Failed to export dashboard" });
  }
};

export const deleteDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ message: "Dashboard id is required." });
      return;
    }

    const dashboard = await ReportDashboard.findByPk(id);
    if (!dashboard) {
      res.status(404).json({ message: "Dashboard not found." });
      return;
    }

    await dashboard.destroy();
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete dashboard", error);
    res.status(500).json({ message: "Failed to delete dashboard" });
  }
};

export const upsertDashboardCard = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { id, cardId } = req.params;
    if (!id) {
      res.status(400).json({ message: "Dashboard id is required." });
      return;
    }

    const dashboard = await ReportDashboard.findByPk(id);
    if (!dashboard) {
      res.status(404).json({ message: "Dashboard not found." });
      return;
    }

    const { templateId, title, viewConfig, layout } = req.body ?? {};
    if (!templateId || typeof templateId !== "string") {
      res.status(400).json({ message: "templateId is required." });
      return;
    }
    if (!title || typeof title !== "string") {
      res.status(400).json({ message: "title is required." });
      return;
    }

    let card: ReportDashboardCard | null = null;
    if (cardId) {
      card = await ReportDashboardCard.findByPk(cardId);
      if (!card) {
        res.status(404).json({ message: "Dashboard card not found." });
        return;
      }
    }

    let normalizedViewConfig: Record<string, unknown>;
    try {
      normalizedViewConfig = normalizeViewConfig(viewConfig);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid view configuration supplied for dashboard card.";
      res.status(400).json({ message });
      return;
    }

    if (!card) {
      card = await ReportDashboardCard.create({
        dashboardId: dashboard.id,
        templateId: templateId.trim(),
        title: title.trim(),
        viewConfig: normalizedViewConfig,
        layout: sanitizeLayout(layout),
      });
    } else {
      card.templateId = templateId.trim();
      card.title = title.trim();
      card.viewConfig = normalizedViewConfig;
      card.layout = sanitizeLayout(layout);
      await card.save();
    }

    res.status(cardId ? 200 : 201).json({
      card: {
        id: card.id,
        dashboardId: card.dashboardId,
        templateId: card.templateId,
        title: card.title,
        viewConfig: card.viewConfig,
        layout: card.layout,
        createdAt: card.createdAt?.toISOString() ?? null,
        updatedAt: card.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to upsert dashboard card", error);
    res.status(500).json({ message: "Failed to save dashboard card" });
  }
};

export const deleteDashboardCard = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { id, cardId } = req.params;
    if (!id || !cardId) {
      res.status(400).json({ message: "Dashboard id and card id are required." });
      return;
    }

    const card = await ReportDashboardCard.findOne({
      where: { id: cardId, dashboardId: id },
    });
    if (!card) {
      res.status(404).json({ message: "Dashboard card not found." });
      return;
    }

    await card.destroy();
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete dashboard card", error);
    res.status(500).json({ message: "Failed to delete dashboard card" });
  }
};

export const runDashboardPreviewCard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req);
    const { id, cardId } = req.params;
    if (!cardId) {
      res.status(400).json({ message: "Card id is required." });
      return;
    }

    const normalizedDashboardId =
      typeof id === "string" && id.trim().length > 0 && id !== "undefined" ? id.trim() : null;

    const card = normalizedDashboardId
      ? await ReportDashboardCard.findOne({
          where: { id: cardId, dashboardId: normalizedDashboardId },
        })
      : await ReportDashboardCard.findByPk(cardId);
    if (!card) {
      res.status(404).json({ message: "Dashboard card not found." });
      return;
    }

    const previewConfig = parsePreviewTableConfig(
      card.viewConfig && typeof card.viewConfig === "object" && !Array.isArray(card.viewConfig)
        ? (card.viewConfig as Record<string, unknown>)
        : null,
    );
    if (!previewConfig) {
      res.status(400).json({ message: "This dashboard card does not store preview table data." });
      return;
    }

    const { result } = await executePreviewQuery(previewConfig.previewRequest);
    res.json({
      cardId: card.id,
      dashboardId: card.dashboardId,
      templateId: card.templateId,
      columns: result.columns,
      rows: result.rows,
      columnOrder: previewConfig.columnOrder,
      columnAliases: previewConfig.columnAliases,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof PreviewQueryError) {
      res.status(error.status).json(
        error.details ? { message: error.message, details: error.details } : { message: error.message },
      );
      return;
    }
    console.error("Failed to run dashboard preview card", error);
    res.status(500).json({ message: "Failed to run preview for this dashboard card." });
  }
};
