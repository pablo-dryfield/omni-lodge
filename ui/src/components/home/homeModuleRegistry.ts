import type { SvgIconComponent } from "@mui/icons-material";
import AccountBalanceRoundedIcon from "@mui/icons-material/AccountBalanceRounded";
import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import AssignmentRoundedIcon from "@mui/icons-material/AssignmentRounded";
import AssignmentTurnedInRoundedIcon from "@mui/icons-material/AssignmentTurnedInRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import EventAvailableRoundedIcon from "@mui/icons-material/EventAvailableRounded";
import HandshakeRoundedIcon from "@mui/icons-material/HandshakeRounded";
import LocalBarRoundedIcon from "@mui/icons-material/LocalBarRounded";
import PaymentsRoundedIcon from "@mui/icons-material/PaymentsRounded";
import PeopleRoundedIcon from "@mui/icons-material/PeopleRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import StoreRoundedIcon from "@mui/icons-material/StoreRounded";
import TaskAltRoundedIcon from "@mui/icons-material/TaskAltRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import type { NavigationPage } from "../../types/general/NavigationState";

export type HomeModuleGroup = "operations" | "team" | "growth" | "insights" | "administration";
export type HomeModuleTone = "blue" | "cyan" | "emerald" | "amber" | "violet" | "rose" | "slate";
export type HomeModuleDescriptionAudience = "management" | "staff";

export type HomeModulePresentation = {
  description: string;
  staffDescription: string;
  group: HomeModuleGroup;
  tone: HomeModuleTone;
  icon: SvgIconComponent;
};

export const HOME_MODULE_GROUPS: Array<{
  id: HomeModuleGroup;
  label: string;
  description: string;
}> = [
  { id: "operations", label: "Operations", description: "Bookings, venues, and daily service tools" },
  { id: "team", label: "People & team", description: "Scheduling, performance, and staff workflows" },
  { id: "growth", label: "Growth", description: "Marketing, partnerships, and customer reputation" },
  { id: "insights", label: "Finance & insights", description: "Money, reporting, and business intelligence" },
  { id: "administration", label: "Administration", description: "Platform configuration and access" },
];

export const HOME_MODULE_PRESENTATIONS: Record<string, HomeModulePresentation> = {
  [PAGE_SLUGS.bookings]: {
    description: "Manage reservations, guests, dates, and booking details.",
    staffDescription: "Find reservations, guest details, dates, and booking information.",
    group: "operations",
    tone: "blue",
    icon: EventAvailableRoundedIcon,
  },
  [PAGE_SLUGS.counters]: {
    description: "Run check-in counters and coordinate guest arrivals.",
    staffDescription: "Open counters, check in guests, and follow arrival details.",
    group: "operations",
    tone: "violet",
    icon: PeopleRoundedIcon,
  },
  [PAGE_SLUGS.venueNumbers]: {
    description: "Review venue activity, sales, and settlement figures.",
    staffDescription: "View the venue activity and figures available to you.",
    group: "operations",
    tone: "amber",
    icon: StoreRoundedIcon,
  },
  [PAGE_SLUGS.channelNumbers]: {
    description: "Compare bookings and revenue across sales channels.",
    staffDescription: "See booking and revenue results from available sales channels.",
    group: "operations",
    tone: "cyan",
    icon: BarChartRoundedIcon,
  },
  [PAGE_SLUGS.openBarControl]: {
    description: "Monitor and control open-bar operations.",
    staffDescription: "Use the open-bar tools for your assigned operation.",
    group: "operations",
    tone: "rose",
    icon: LocalBarRoundedIcon,
  },
  [PAGE_SLUGS.requests]: {
    description: "Review staff requests, decisions, and pending actions.",
    staffDescription: "Create and follow your requests, approvals, and required actions.",
    group: "team",
    tone: "amber",
    icon: AssignmentRoundedIcon,
  },
  [PAGE_SLUGS.performance]: {
    description: "Understand team performance and operational progress.",
    staffDescription: "View your available performance and progress information.",
    group: "team",
    tone: "emerald",
    icon: TrendingUpRoundedIcon,
  },
  [PAGE_SLUGS.reviews]: {
    description: "Manage review credits, status, and platform history.",
    staffDescription: "View review credits, assigned reviews, and review history.",
    group: "team",
    tone: "amber",
    icon: StarRoundedIcon,
  },
  [PAGE_SLUGS.pays]: {
    description: "Calculate, process, and confirm staff compensation.",
    staffDescription: "Review your compensation, payment status, and receipts.",
    group: "team",
    tone: "emerald",
    icon: PaymentsRoundedIcon,
  },
  [PAGE_SLUGS.scheduling]: {
    description: "Plan availability, shifts, takeovers, and swaps.",
    staffDescription: "Check your schedule, availability, shift requests, swaps, and takeovers.",
    group: "team",
    tone: "blue",
    icon: CalendarMonthRoundedIcon,
  },
  [PAGE_SLUGS.assistantManagerTasks]: {
    description: "Assign, complete, and verify operational tasks.",
    staffDescription: "View, complete, and submit evidence for your assigned tasks.",
    group: "team",
    tone: "violet",
    icon: TaskAltRoundedIcon,
  },
  [PAGE_SLUGS.marketing]: {
    description: "Monitor campaigns and coordinate marketing activity.",
    staffDescription: "View campaigns and complete the marketing work available to you.",
    group: "growth",
    tone: "rose",
    icon: CampaignRoundedIcon,
  },
  [PAGE_SLUGS.socialMedia]: {
    description: "Plan, produce, and publish social content from one visual board.",
    staffDescription: "Plan and follow the social content assigned to your team.",
    group: "growth",
    tone: "violet",
    icon: CampaignRoundedIcon,
  },
  [PAGE_SLUGS.searchConsole]: {
    description: "Analyze search visibility, queries, and opportunities.",
    staffDescription: "View the search visibility and query insights available to you.",
    group: "growth",
    tone: "blue",
    icon: SearchRoundedIcon,
  },
  [PAGE_SLUGS.affiliates]: {
    description: "Track affiliate bookings, partners, and payouts.",
    staffDescription: "View your affiliate bookings, earnings, and payout status.",
    group: "growth",
    tone: "cyan",
    icon: HandshakeRoundedIcon,
  },
  [PAGE_SLUGS.finance]: {
    description: "Record transactions, plan budgets, and control cash flow.",
    staffDescription: "Record and review the finance activity available to you.",
    group: "insights",
    tone: "emerald",
    icon: AccountBalanceRoundedIcon,
  },
  [PAGE_SLUGS.reports]: {
    description: "Build reports, dashboards, and decision-ready analysis.",
    staffDescription: "Open the reports and dashboards shared with you.",
    group: "insights",
    tone: "blue",
    icon: AssessmentRoundedIcon,
  },
  [PAGE_SLUGS.cerebro]: {
    description: "Explore operational intelligence and connected workflows.",
    staffDescription: "Find guidance, complete quizzes, and follow company policies.",
    group: "insights",
    tone: "violet",
    icon: PsychologyRoundedIcon,
  },
  [PAGE_SLUGS.settings]: {
    description: "Configure users, permissions, products, and integrations.",
    staffDescription: "Update the settings and profile options available to your account.",
    group: "administration",
    tone: "slate",
    icon: SettingsRoundedIcon,
  },
};

const FALLBACK_PRESENTATION: HomeModulePresentation = {
  description: "Open this workspace module.",
  staffDescription: "Open this workspace module.",
  group: "operations",
  tone: "slate",
  icon: AssignmentTurnedInRoundedIcon,
};

const MANAGEMENT_ROLE_SLUGS = new Set(["owner", "admin", "administrator", "manager"]);

const normalizeRole = (value: string | null | undefined): string =>
  String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");

export const isHomeManagementRole = (
  roleSlug: string | null | undefined,
): boolean => MANAGEMENT_ROLE_SLUGS.has(normalizeRole(roleSlug));

export const getHomeModulePresentation = (
  page: NavigationPage,
  audience: HomeModuleDescriptionAudience,
): HomeModulePresentation => {
  const presentation = HOME_MODULE_PRESENTATIONS[page.slug] ?? FALLBACK_PRESENTATION;
  if (audience === "management") {
    return presentation;
  }
  return { ...presentation, description: presentation.staffDescription };
};
