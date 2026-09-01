import type {
  BookingsSummaryDashboardDateField,
  BookingsSummaryDashboardFilters,
  BookingsSummaryDashboardMetric,
  BookingsSummaryDashboardPageConfig,
  BookingsSummaryDashboardPreset,
} from "../api/reports";

export const BOOKINGS_SUMMARY_DASHBOARD_PAGE_CONFIG: BookingsSummaryDashboardPageConfig = {
  schemaVersion: 1,
  kind: "page",
  pageId: "bookings-summary",
};

export const BOOKINGS_SUMMARY_DASHBOARD_DATE_FIELDS: readonly BookingsSummaryDashboardDateField[] = [
  "experience_date",
  "source_received_at",
];

export const BOOKINGS_SUMMARY_DASHBOARD_PRESETS: readonly BookingsSummaryDashboardPreset[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "last_7_days",
  "last_14_days",
  "last_2_weeks",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "all_time",
  "custom",
];

export const BOOKINGS_SUMMARY_DASHBOARD_METRICS: readonly BookingsSummaryDashboardMetric[] = [
  "earnings",
  "revenue",
  "costs",
];

export const DEFAULT_BOOKINGS_SUMMARY_DASHBOARD_FILTERS: BookingsSummaryDashboardFilters = {
  summaryDateField: "experience_date",
  summaryProductTypes: ["1", "2"],
  summaryPreset: "today",
  summaryMetric: "revenue",
  summaryStart: null,
  summaryEnd: null,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === "string" && options.includes(value as T);

const normalizeProductTypes = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_BOOKINGS_SUMMARY_DASHBOARD_FILTERS.summaryProductTypes];
  }

  const unique = new Set<string>();
  value.forEach((entry) => {
    const normalized = String(entry ?? "").trim();
    if (!/^\d+$/.test(normalized)) {
      return;
    }
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return;
    }
    unique.add(String(parsed));
  });
  return Array.from(unique).sort((left, right) => Number(left) - Number(right));
};

const normalizeIsoDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
};

export const isBookingsSummaryDashboardPageConfig = (
  value: unknown,
): value is BookingsSummaryDashboardPageConfig => {
  if (!isRecord(value)) {
    return false;
  }
  return value.schemaVersion === 1
    && value.kind === "page"
    && value.pageId === "bookings-summary";
};

export const normalizeBookingsSummaryDashboardFilters = (
  value: unknown,
): BookingsSummaryDashboardFilters => {
  const source = isRecord(value) ? value : {};
  const summaryDateField = isOneOf(
    source.summaryDateField,
    BOOKINGS_SUMMARY_DASHBOARD_DATE_FIELDS,
  )
    ? source.summaryDateField
    : DEFAULT_BOOKINGS_SUMMARY_DASHBOARD_FILTERS.summaryDateField;
  const summaryPreset = isOneOf(source.summaryPreset, BOOKINGS_SUMMARY_DASHBOARD_PRESETS)
    ? source.summaryPreset
    : DEFAULT_BOOKINGS_SUMMARY_DASHBOARD_FILTERS.summaryPreset;
  const summaryMetric = isOneOf(source.summaryMetric, BOOKINGS_SUMMARY_DASHBOARD_METRICS)
    ? source.summaryMetric
    : DEFAULT_BOOKINGS_SUMMARY_DASHBOARD_FILTERS.summaryMetric;
  let summaryStart = summaryPreset === "custom" ? normalizeIsoDate(source.summaryStart) : null;
  let summaryEnd = summaryPreset === "custom" ? normalizeIsoDate(source.summaryEnd) : null;
  if (summaryStart && summaryEnd && summaryStart > summaryEnd) {
    [summaryStart, summaryEnd] = [summaryEnd, summaryStart];
  }

  return {
    summaryDateField,
    summaryProductTypes: normalizeProductTypes(source.summaryProductTypes),
    summaryPreset,
    summaryMetric,
    summaryStart,
    summaryEnd,
  };
};

export const createDefaultBookingsSummaryDashboardFilters = (): BookingsSummaryDashboardFilters => ({
  ...DEFAULT_BOOKINGS_SUMMARY_DASHBOARD_FILTERS,
  summaryProductTypes: [...DEFAULT_BOOKINGS_SUMMARY_DASHBOARD_FILTERS.summaryProductTypes],
});
