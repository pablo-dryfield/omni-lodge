const normalizePm2RoleSlug = (roleSlug: string | null | undefined): string => {
  const normalized = String(roleSlug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  const collapsed = normalized.replace(/-/g, "");

  return collapsed === "administrator" ? "admin" : normalized;
};

/**
 * Mirrors the backend PM2 router's `requireRoles(["admin"])` check.
 * Keep this deliberately narrower than general Settings-page access: PM2
 * exposes host process names, logs, and restart controls.
 */
export const canAccessPm2Controls = (
  roleSlug: string | null | undefined,
): boolean => normalizePm2RoleSlug(roleSlug) === "admin";

export const canQueryPm2Processes = (
  nodeEnvironment: string | null | undefined,
  roleSlug: string | null | undefined,
): boolean =>
  String(nodeEnvironment ?? "").trim().toLowerCase() === "production" &&
  canAccessPm2Controls(roleSlug);
