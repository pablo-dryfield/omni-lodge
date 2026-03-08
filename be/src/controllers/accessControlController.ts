import { Response } from "express";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";
import Page from "../models/Page.js";
import Module from "../models/Module.js";
import Action from "../models/Action.js";
import RolePagePermission from "../models/RolePagePermission.js";
import RoleModulePermission from "../models/RoleModulePermission.js";

const ACCESS_CONTROL_CACHE_TTL_MS = Number(process.env.ACCESS_CONTROL_CACHE_TTL_MS ?? 10 * 60_000);
type AccessControlPayload = {
  pages: string[];
  modules: Record<string, string[]>;
};
type AccessControlCacheEntry = {
  expiresAtMs: number;
  payload: AccessControlPayload;
};
const accessControlCacheByUserType = new Map<number, AccessControlCacheEntry>();
const accessControlInFlightByUserType = new Map<number, Promise<AccessControlPayload>>();

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

const OPEN_BAR_PRIVILEGED_USER_TYPE_SLUGS = new Set(["admin", "administrator", "owner", "manager", "assistant-manager"]);

const getCachedAccessControlPayload = (userTypeId: number): AccessControlPayload | null => {
  const entry = accessControlCacheByUserType.get(userTypeId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAtMs <= Date.now()) {
    accessControlCacheByUserType.delete(userTypeId);
    return null;
  }
  return entry.payload;
};

const setCachedAccessControlPayload = (userTypeId: number, payload: AccessControlPayload): void => {
  const ttlMs = Math.max(5_000, ACCESS_CONTROL_CACHE_TTL_MS);
  accessControlCacheByUserType.set(userTypeId, {
    expiresAtMs: Date.now() + ttlMs,
    payload,
  });
};

const loadAccessControlPayload = async (userTypeId: number): Promise<AccessControlPayload> => {
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

  return {
    pages: Array.from(allowedPageSlugs),
    modules: modulePermissionsBySlug,
  };
};

export const getCurrentUserAccess = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userTypeId = req.authContext?.userTypeId;
  const userTypeSlug = normalizeRole(req.authContext?.userTypeSlug ?? req.authContext?.roleSlug ?? null);
  const shiftRoleSlugs = Array.from(
    new Set((req.authContext?.shiftRoleSlugs ?? []).map((value) => normalizeRole(value)).filter((value): value is string => Boolean(value))),
  );

  const hasBartenderShiftRole = shiftRoleSlugs.includes("bartender");
  const hasManagerShiftRole = shiftRoleSlugs.includes("manager");
  const hasPrivilegedUserType = userTypeSlug != null && OPEN_BAR_PRIVILEGED_USER_TYPE_SLUGS.has(userTypeSlug);

  const canUseBartenderMode = hasBartenderShiftRole || hasManagerShiftRole || hasPrivilegedUserType || userTypeSlug === "bartender";
  const canUseManagerMode = hasManagerShiftRole || hasPrivilegedUserType;

  const openBarModeAccess = {
    canUseBartenderMode,
    canUseManagerMode,
    shiftRoleSlugs,
    userTypeSlug,
  };

  if (!userTypeId) {
    res.status(200).json({ pages: [], modules: {}, openBarModeAccess });
    return;
  }

  const cached = getCachedAccessControlPayload(userTypeId);
  if (cached) {
    res.status(200).json({
      pages: cached.pages,
      modules: cached.modules,
      openBarModeAccess,
    });
    return;
  }

  let pending = accessControlInFlightByUserType.get(userTypeId);
  if (!pending) {
    pending = loadAccessControlPayload(userTypeId)
      .then((payload) => {
        setCachedAccessControlPayload(userTypeId, payload);
        return payload;
      })
      .finally(() => {
        accessControlInFlightByUserType.delete(userTypeId);
      });
    accessControlInFlightByUserType.set(userTypeId, pending);
  }

  const payload = await pending;

  res.status(200).json({
    pages: payload.pages,
    modules: payload.modules,
    openBarModeAccess,
  });
};
