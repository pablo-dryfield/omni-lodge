import type { ComponentType } from "react";
import {
  IconArrowsExchange,
  IconBuildingBank,
  IconBuildingStore,
  IconChartBar,
  IconFileInvoice,
  IconFolders,
  IconLayoutDashboard,
  IconReceiptRefund,
  IconRepeat,
  IconReportMoney,
  IconSettings,
  IconSitemap,
  IconUserDollar,
  IconUsersGroup,
  IconWallet,
} from "@tabler/icons-react";

type FinanceNavIcon = ComponentType<{ size?: number | string; stroke?: number | string }>;

export type FinanceNavigationItem = {
  label: string;
  shortLabel?: string;
  path: string;
  description: string;
  icon: FinanceNavIcon;
};

export type FinanceNavigationGroup = {
  label: string;
  items: FinanceNavigationItem[];
};

export const financeNavigationGroups: FinanceNavigationGroup[] = [
  {
    label: "Overview",
    items: [
      {
        label: "Dashboard",
        shortLabel: "Overview",
        path: "/finance",
        description: "Financial health and recent activity",
        icon: IconLayoutDashboard,
      },
    ],
  },
  {
    label: "Daily operations",
    items: [
      {
        label: "Transactions",
        path: "/finance/transactions",
        description: "Income, expenses and transfers",
        icon: IconArrowsExchange,
      },
      {
        label: "Refunds",
        path: "/finance/refunds",
        description: "Stripe refund activity",
        icon: IconReceiptRefund,
      },
      {
        label: "Inventory",
        path: "/finance/inventory",
        description: "Purchases, stock and fulfillment",
        icon: IconBuildingStore,
      },
    ],
  },
  {
    label: "Planning",
    items: [
      {
        label: "Recurring rules",
        shortLabel: "Recurring",
        path: "/finance/recurring",
        description: "Automated planned transactions",
        icon: IconRepeat,
      },
      {
        label: "Budgets",
        path: "/finance/budgets",
        description: "Monthly category targets",
        icon: IconChartBar,
      },
      {
        label: "Volunteer funds",
        shortLabel: "Funds",
        path: "/finance/volunteer-funds",
        description: "Restricted volunteer allocations",
        icon: IconWallet,
      },
    ],
  },
  {
    label: "Directory",
    items: [
      {
        label: "Accounts",
        path: "/finance/accounts",
        description: "Cash and payment accounts",
        icon: IconBuildingBank,
      },
      {
        label: "Vendors",
        path: "/finance/vendors",
        description: "People and businesses you pay",
        icon: IconUserDollar,
      },
      {
        label: "Clients",
        path: "/finance/clients",
        description: "People and businesses that pay you",
        icon: IconUsersGroup,
      },
      {
        label: "Categories",
        path: "/finance/categories",
        description: "Income and expense taxonomy",
        icon: IconSitemap,
      },
    ],
  },
  {
    label: "Control & reporting",
    items: [
      {
        label: "Management requests",
        shortLabel: "Approvals",
        path: "/finance/management-requests",
        description: "Review and approve finance changes",
        icon: IconFileInvoice,
      },
      {
        label: "Files",
        path: "/finance/files",
        description: "Invoices and supporting documents",
        icon: IconFolders,
      },
      {
        label: "Reports",
        path: "/finance/reports",
        description: "Performance and balance analysis",
        icon: IconReportMoney,
      },
      {
        label: "Settings",
        path: "/finance/settings",
        description: "Finance defaults and automation",
        icon: IconSettings,
      },
    ],
  },
];

export const financeNavigationItems = financeNavigationGroups.flatMap((group) => group.items);

export const isFinanceNavigationItemActive = (pathname: string, path: string): boolean =>
  path === "/finance" ? pathname === path : pathname.startsWith(path);
