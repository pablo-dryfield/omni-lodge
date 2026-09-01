const FINANCE_ROLE_SLUGS = new Set(["admin", "assistant-manager", "manager", "owner"]);

const normalizeRoleSlug = (value: string | null | undefined): string => {
  const withHyphens = String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  const collapsed = withHyphens.replace(/-/g, "");
  if (collapsed === "administrator") return "admin";
  if (collapsed === "assistantmanager" || collapsed === "assistmanager") return "assistant-manager";
  if (collapsed === "mgr" || collapsed === "manager") return "manager";
  return withHyphens;
};

export const canLoadHomePlannedExpenses = ({
  accessLoaded,
  financePageAllowed,
  canViewTransactions,
  roleSlug,
}: {
  accessLoaded: boolean;
  financePageAllowed: boolean;
  canViewTransactions: boolean;
  roleSlug: string | null | undefined;
}): boolean => accessLoaded
  && financePageAllowed
  && canViewTransactions
  && FINANCE_ROLE_SLUGS.has(normalizeRoleSlug(roleSlug));
