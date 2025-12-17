import { Response } from "express";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import Page from "../models/Page.js";
import Module from "../models/Module.js";
import Action from "../models/Action.js";
import RolePagePermission from "../models/RolePagePermission.js";
import RoleModulePermission from "../models/RoleModulePermission.js";

const normalizeRole = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  const withHyphens = trimmed.replace(/[\s_]+/g, "-");
  const collapsed = withHyphens.replace(/-/g, "");

  if (collapsed === "administrator") {
    return "admin";
  }
  if (collapsed === "assistantmanager" || collapsed === "assistmanager") {
    return "assistant-manager";
  }
  if (collapsed === "mgr" || collapsed === "manager") {
    return "manager";
  }
  return withHyphens;
};

export const getCurrentUserAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userTypeId = req.authContext?.userTypeId;

  if (!userTypeId) {
    res.status(200).json({ pages: [], modules: {} });
    return;
  }

  const [pages, modules, actions, pagePermissions, modulePermissions] = await Promise.all([
    Page.findAll(),
    Module.findAll(),
    Action.findAll(),
    RolePagePermission.findAll({ where: { userTypeId } }),
    RoleModulePermission.findAll({ where: { userTypeId } }),
  ]);

  const pageSlugById = new Map<number, string>();
  pages.forEach((page) => {
    if (typeof page.id === "number" && typeof page.slug === "string") {
      pageSlugById.set(page.id, page.slug);
    }
  });

  const allowedPageSlugs = new Set<string>();
  pagePermissions.forEach((permission) => {
    if (!permission.status || !permission.canView) {
      return;
    }
    const slug = pageSlugById.get(permission.pageId ?? -1);
    if (slug) {
      allowedPageSlugs.add(slug);
    }
  });

  const moduleSlugById = new Map<number, string>();
  modules.forEach((moduleRecord) => {
    if (typeof moduleRecord.id === "number" && typeof moduleRecord.slug === "string") {
      moduleSlugById.set(moduleRecord.id, moduleRecord.slug);
    }
  });

  const actionKeyById = new Map<number, string>();
  actions.forEach((action) => {
    if (typeof action.id === "number" && typeof action.key === "string") {
      actionKeyById.set(action.id, action.key);
    }
  });

  const modulePermissionsBySlug: Record<string, string[]> = {};
  modulePermissions.forEach((permission) => {
    if (!permission.status || !permission.allowed) {
      return;
    }

    const moduleSlug = moduleSlugById.get(permission.moduleId ?? -1);
    const actionKey = actionKeyById.get(permission.actionId ?? -1);

    if (!moduleSlug || !actionKey) {
      return;
    }

    if (!modulePermissionsBySlug[moduleSlug]) {
      modulePermissionsBySlug[moduleSlug] = [];
    }

    if (!modulePermissionsBySlug[moduleSlug].includes(actionKey)) {
      modulePermissionsBySlug[moduleSlug].push(actionKey);
    }
  });

  res.status(200).json({
    pages: Array.from(allowedPageSlugs),
    modules: modulePermissionsBySlug,
  });
};
