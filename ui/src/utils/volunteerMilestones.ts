import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import type { VolunteerMilestone } from "../api/volunteerMilestones";

dayjs.extend(utc);
dayjs.extend(timezone);

export const VOLUNTEER_PROGRESS_TIMEZONE = "Europe/Warsaw";

const MANAGEMENT_ROLES = new Set(["owner", "admin", "manager", "assistant-manager"]);

export const normalizeVolunteerProgressRole = (roleSlug: string | null | undefined): string => {
  const normalized = String(roleSlug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  const collapsed = normalized.replace(/-/g, "");

  if (collapsed === "administrator") {
    return "admin";
  }
  if (collapsed === "assistantmanager" || collapsed === "assistmanager") {
    return "assistant-manager";
  }
  if (collapsed === "mgr") {
    return "manager";
  }
  return normalized;
};

export const canManageVolunteerProgress = (roleSlug: string | null | undefined): boolean =>
  MANAGEMENT_ROLES.has(normalizeVolunteerProgressRole(roleSlug));

export const clampProgressPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
};

export const getCurrentMonth = (): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VOLUNTEER_PROGRESS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : dayjs().format("YYYY-MM");
};

export const formatVolunteerProgressTimestamp = (
  value: string,
  periodTimezone = VOLUNTEER_PROGRESS_TIMEZONE,
  pattern = "D MMM, HH:mm",
): string => {
  const normalizedValue = value.trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue);
  const parsed = dayjs(normalizedValue);
  if (!parsed.isValid()) {
    return value;
  }
  if (isDateOnly) {
    return parsed.format(pattern);
  }
  try {
    return parsed.tz(periodTimezone || VOLUNTEER_PROGRESS_TIMEZONE).format(pattern);
  } catch {
    return parsed.tz(VOLUNTEER_PROGRESS_TIMEZONE).format(pattern);
  }
};

export const moveVolunteerProgressMonth = (period: string, amount: number): string => {
  const parsed = dayjs(`${period}-01`);
  return (parsed.isValid() ? parsed : dayjs()).add(amount, "month").format("YYYY-MM");
};

export const formatVolunteerProgressMonth = (period: string): string => {
  const parsed = dayjs(`${period}-01`);
  return (parsed.isValid() ? parsed : dayjs()).format("MMMM YYYY");
};

const milestoneOrder = new Map<VolunteerMilestone["key"], number>([
  ["reviews", 0],
  ["attendance", 1],
  ["monthly_shifts", 2],
  ["cleaning", 3],
  ["management_feedback", 4],
]);

export const orderVolunteerMilestones = (milestones: VolunteerMilestone[]): VolunteerMilestone[] =>
  [...milestones].sort(
    (left, right) => (milestoneOrder.get(left.key) ?? 99) - (milestoneOrder.get(right.key) ?? 99),
  );

export const formatMilestoneAmount = (milestone: VolunteerMilestone): string => {
  const unit = milestone.unit.trim();
  if (unit === "%" || unit.toLowerCase() === "percent" || unit.toLowerCase() === "percentage") {
    return `${milestone.current}% (target ${milestone.target}%)`;
  }
  const pluralizedUnit = milestone.target === 1 ? unit.replace(/s$/, "") : unit;
  return `${milestone.current} of ${milestone.target}${pluralizedUnit ? ` ${pluralizedUnit}` : ""}`;
};
