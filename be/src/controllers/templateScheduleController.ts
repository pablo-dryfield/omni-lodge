import { Request, Response } from "express";
import ReportSchedule from "../models/ReportSchedule.js";
import ReportTemplate from "../models/ReportTemplate.js";
import { ensureReportingAccess } from "../utils/reportingAccess.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";

const sanitizeDeliveryTargets = (value: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      return entry as Record<string, unknown>;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
};

export const listTemplateSchedules = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { templateId } = req.params;
    if (!templateId) {
      res.status(400).json({ message: "Template id is required." });
      return;
    }

    const schedules = await ReportSchedule.findAll({
      where: { templateId },
      order: [["updatedAt", "DESC"]],
    });

    res.json({
      schedules: schedules.map((schedule) => ({
        id: schedule.id,
        templateId: schedule.templateId,
        cadence: schedule.cadence,
        timezone: schedule.timezone,
        deliveryTargets: schedule.deliveryTargets ?? [],
        lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
        status: schedule.status,
        meta: schedule.meta ?? {},
        createdAt: schedule.createdAt?.toISOString() ?? null,
        updatedAt: schedule.updatedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to list report schedules", error);
    res.status(500).json({ message: "Failed to load schedules" });
  }
};

export const createTemplateSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { templateId } = req.params;
    if (!templateId) {
      res.status(400).json({ message: "Template id is required." });
      return;
    }

    const template = await ReportTemplate.findByPk(templateId);
    if (!template) {
      res.status(404).json({ message: "Template not found." });
      return;
    }

    const { cadence, timezone, deliveryTargets, meta } = req.body ?? {};
    if (!cadence || typeof cadence !== "string") {
      res.status(400).json({ message: "Cadence is required." });
      return;
    }

    const schedule = await ReportSchedule.create({
      templateId: template.id,
      cadence: cadence.trim(),
      timezone: typeof timezone === "string" && timezone.trim().length > 0 ? timezone.trim() : "UTC",
      deliveryTargets: sanitizeDeliveryTargets(deliveryTargets),
      meta: meta && typeof meta === "object" ? meta : {},
    });

    res.status(201).json({
      schedule: {
        id: schedule.id,
        templateId: schedule.templateId,
        cadence: schedule.cadence,
        timezone: schedule.timezone,
        deliveryTargets: schedule.deliveryTargets ?? [],
        lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
        status: schedule.status,
        meta: schedule.meta ?? {},
        createdAt: schedule.createdAt?.toISOString() ?? null,
        updatedAt: schedule.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to create schedule", error);
    res.status(500).json({ message: "Failed to create schedule" });
  }
};

export const updateTemplateSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { templateId, scheduleId } = req.params;
    if (!templateId || !scheduleId) {
      res.status(400).json({ message: "Template id and schedule id are required." });
      return;
    }

    const schedule = await ReportSchedule.findOne({
      where: { id: scheduleId, templateId },
    });

    if (!schedule) {
      res.status(404).json({ message: "Schedule not found." });
      return;
    }

    const { cadence, timezone, deliveryTargets, status, meta, nextRunAt } = req.body ?? {};
    if (typeof cadence === "string" && cadence.trim().length > 0) {
      schedule.cadence = cadence.trim();
    }
    if (typeof timezone === "string" && timezone.trim().length > 0) {
      schedule.timezone = timezone.trim();
    }
    if (deliveryTargets !== undefined) {
      schedule.deliveryTargets = sanitizeDeliveryTargets(deliveryTargets);
    }
    if (typeof status === "string" && status.trim().length > 0) {
      schedule.status = status.trim();
    }
    if (meta && typeof meta === "object") {
      schedule.meta = meta;
    }
    if (nextRunAt !== undefined) {
      schedule.nextRunAt =
        typeof nextRunAt === "string" || nextRunAt instanceof Date ? new Date(nextRunAt) : null;
    }

    await schedule.save();

    res.json({
      schedule: {
        id: schedule.id,
        templateId: schedule.templateId,
        cadence: schedule.cadence,
        timezone: schedule.timezone,
        deliveryTargets: schedule.deliveryTargets ?? [],
        lastRunAt: schedule.lastRunAt?.toISOString() ?? null,
        nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
        status: schedule.status,
        meta: schedule.meta ?? {},
        createdAt: schedule.createdAt?.toISOString() ?? null,
        updatedAt: schedule.updatedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("Failed to update schedule", error);
    res.status(500).json({ message: "Failed to update schedule" });
  }
};

export const deleteTemplateSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    ensureReportingAccess(req as AuthenticatedRequest);
    const { templateId, scheduleId } = req.params;
    if (!templateId || !scheduleId) {
      res.status(400).json({ message: "Template id and schedule id are required." });
      return;
    }

    const schedule = await ReportSchedule.findOne({
      where: { id: scheduleId, templateId },
    });

    if (!schedule) {
      res.status(404).json({ message: "Schedule not found." });
      return;
    }

    await schedule.destroy();
    res.status(204).send();
  } catch (error) {
    console.error("Failed to delete schedule", error);
    res.status(500).json({ message: "Failed to delete schedule" });
  }
};
