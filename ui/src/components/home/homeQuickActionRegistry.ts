import type { SvgIconComponent } from "@mui/icons-material";
import AddCardRoundedIcon from "@mui/icons-material/AddCardRounded";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

export type QuickActionPermission = {
  pageSlug?: string;
  moduleSlug?: string;
  moduleAction?: "view" | "create" | "update" | "delete";
};

export type QuickActionTone = "blue" | "emerald" | "amber" | "violet" | "rose";

export type HomeQuickAction = {
  id: string;
  label: string;
  description: string;
  group: string;
  to: string;
  state?: Record<string, unknown>;
  icon: SvgIconComponent;
  tone?: QuickActionTone;
  permission?: QuickActionPermission;
};

/**
 * Add new Home shortcuts here. Keeping the registry separate from the Home page
 * makes actions from any module discoverable and permission-aware by default.
 */
export const HOME_QUICK_ACTIONS: HomeQuickAction[] = [
  {
    id: "finance-record-transaction",
    label: "Record transaction",
    description: "Add income, an expense, a refund, or a transfer.",
    group: "Finance",
    to: "/finance/transactions",
    state: { create: true },
    icon: AddCardRoundedIcon,
    tone: "emerald",
    permission: {
      pageSlug: PAGE_SLUGS.finance,
      moduleSlug: PAGE_SLUGS.financeTransactions,
      moduleAction: "create",
    },
  },
];

export const isHomeQuickActionVisibilityMap = (
  value: unknown,
): value is Readonly<Record<string, boolean>> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([actionId, visible]) => actionId.trim().length > 0 && typeof visible === "boolean",
  );
};

export const filterVisibleHomeQuickActions = (
  actions: HomeQuickAction[],
  allowedPageSlugs: ReadonlySet<string>,
  modulePermissions: ReadonlyMap<string, ReadonlySet<string>>,
  quickActionVisibility: Readonly<Record<string, boolean>> = {},
): HomeQuickAction[] =>
  actions.filter((action) => {
    const permission = action.permission;
    if (permission) {
      if (permission.pageSlug && !allowedPageSlugs.has(permission.pageSlug)) {
        return false;
      }
      if (
        permission.moduleSlug
        && permission.moduleAction
        && !(modulePermissions.get(permission.moduleSlug)?.has(permission.moduleAction) ?? false)
      ) {
        return false;
      }
    }
    return quickActionVisibility[action.id] !== false;
  });
