import { Request, Response } from "express";
import { Op } from "sequelize";
import ReportDashboard from "../models/ReportDashboard.js";
import ReportDashboardCard from "../models/ReportDashboardCard.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import { ensureReportingAccess } from "../utils/reportingAccess.js";

const sanitizeLayout = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const sanitizeConfig = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

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

    if (!card) {
      card = await ReportDashboardCard.create({
        dashboardId: dashboard.id,
        templateId: templateId.trim(),
        title: title.trim(),
        viewConfig: sanitizeConfig(viewConfig),
        layout: sanitizeLayout(layout),
      });
    } else {
      card.templateId = templateId.trim();
      card.title = title.trim();
      card.viewConfig = sanitizeConfig(viewConfig);
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
