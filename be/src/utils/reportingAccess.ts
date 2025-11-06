import { PreviewQueryError } from "../errors/PreviewQueryError.js";
import { AuthenticatedRequest } from "../types/AuthenticatedRequest";

const ALLOWED_ROLES = new Set(["admin", "owner", "manager", "assistant-manager", "assistant_manager", "assistantmanager"]);

export const ensureReportingAccess = (req: AuthenticatedRequest): void => {
  const roleSlug = req.authContext?.roleSlug ?? null;
  if (roleSlug && ALLOWED_ROLES.has(roleSlug)) {
    return;
  }
  if (!roleSlug) {
    throw new PreviewQueryError("Authentication required.", 403);
  }
  throw new PreviewQueryError("You do not have access to reporting.", 403);
};

export const hasReportingAccess = (req: AuthenticatedRequest): boolean => {
  const roleSlug = req.authContext?.roleSlug ?? null;
  return !!roleSlug && ALLOWED_ROLES.has(roleSlug);
};
