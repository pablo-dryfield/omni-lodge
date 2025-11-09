import type { Response } from "express";
import UserHomePreference, { type HomeViewMode } from "../models/UserHomePreference.js";
import type { AuthenticatedRequest } from "../types/AuthenticatedRequest";

type PreferenceShape = {
  viewMode: HomeViewMode;
  savedDashboardIds: string[];
  activeDashboardId: string | null;
};

const sanitizeDashboardIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<string>();
  value.forEach((entry) => {
    if (typeof entry !== "string") {
      return;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return;
    }
    unique.add(trimmed);
  });
  return Array.from(unique).slice(0, 12);
};

const serializePreference = (preference?: UserHomePreference | null): PreferenceShape => {
  const savedDashboardIds =
    preference && Array.isArray(preference.savedDashboardIds) ? preference.savedDashboardIds : [];
  return {
    viewMode: preference?.viewMode ?? "navigation",
    savedDashboardIds,
    activeDashboardId: preference?.activeDashboardId ?? null,
  };
};

export const getHomePreference = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.authContext?.id;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const preference = await UserHomePreference.findOne({ where: { userId } });
    res.json({ preference: serializePreference(preference) });
  } catch (error) {
    console.error("Failed to load home preference", error);
    res.status(500).json({ message: "Failed to load home preference" });
  }
};

export const updateHomePreference = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.authContext?.id;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const payload = req.body ?? {};
    let preference = await UserHomePreference.findOne({ where: { userId } });
    if (!preference) {
      preference = await UserHomePreference.create({
        userId,
        viewMode: "navigation",
        savedDashboardIds: [],
        activeDashboardId: null,
      });
    }

    const next: PreferenceShape = {
      viewMode: preference.viewMode ?? "navigation",
      savedDashboardIds: Array.isArray(preference.savedDashboardIds) ? preference.savedDashboardIds : [],
      activeDashboardId: preference.activeDashboardId ?? null,
    };

    if (typeof payload.viewMode === "string") {
      const candidate = payload.viewMode.toLowerCase();
      if (candidate === "navigation" || candidate === "dashboard") {
        next.viewMode = candidate;
      }
    }

    if (payload.savedDashboardIds !== undefined) {
      next.savedDashboardIds = sanitizeDashboardIds(payload.savedDashboardIds);
    }

    if (payload.activeDashboardId !== undefined) {
      const candidate =
        typeof payload.activeDashboardId === "string" && payload.activeDashboardId.trim().length > 0
          ? payload.activeDashboardId.trim()
          : null;
      next.activeDashboardId = candidate;
    }

    if (next.activeDashboardId && !next.savedDashboardIds.includes(next.activeDashboardId)) {
      next.savedDashboardIds = [...next.savedDashboardIds, next.activeDashboardId];
    }

    if (next.viewMode === "dashboard" && next.savedDashboardIds.length === 0) {
      next.activeDashboardId = null;
    }

    if (next.activeDashboardId && !next.savedDashboardIds.includes(next.activeDashboardId)) {
      next.activeDashboardId = null;
    }

    if (!next.activeDashboardId && next.savedDashboardIds.length > 0) {
      [next.activeDashboardId] = next.savedDashboardIds;
    }

    preference.viewMode = next.viewMode;
    preference.savedDashboardIds = next.savedDashboardIds;
    preference.activeDashboardId = next.activeDashboardId;
    await preference.save();

    res.json({ preference: serializePreference(preference) });
  } catch (error) {
    console.error("Failed to update home preference", error);
    res.status(500).json({ message: "Failed to update home preference" });
  }
};
