import dayjs from "dayjs";

export const BOOKINGS_SUMMARY_DASHBOARD_PAGE_ID = "bookings-summary" as const;

const SUMMARY_DATE_FIELDS = new Set(["experience_date", "source_received_at"]);
const SUMMARY_METRICS = new Set(["earnings", "revenue", "costs"]);
const SUMMARY_PRESETS = new Set([
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
]);

const DEFAULT_PRODUCT_TYPES = ["1", "2"];

type JsonObject = Record<string, unknown>;

export class DashboardPageConfigError extends Error {}

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const normalizeDate = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const parsed = dayjs(normalized);
  return parsed.isValid() && parsed.format("YYYY-MM-DD") === normalized ? normalized : null;
};

const normalizeProductTypes = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PRODUCT_TYPES];
  }
  const values = value.flatMap((entry) => {
    const normalized = String(entry ?? "").trim();
    if (!/^\d+$/.test(normalized)) {
      return [];
    }
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0 ? [String(parsed)] : [];
  });
  return Array.from(new Set(values)).sort((left, right) => Number(left) - Number(right));
};

export type NormalizedDashboardConfiguration = {
  config: JsonObject;
  filters: JsonObject;
};

/**
 * Normalizes native page dashboards while leaving legacy report-grid dashboard
 * configuration untouched. Native dashboards intentionally use a small,
 * whitelisted contract instead of accepting an arbitrary route or URL.
 */
export const normalizeDashboardConfiguration = (
  configValue: unknown,
  filtersValue: unknown,
): NormalizedDashboardConfiguration => {
  const config = asObject(configValue);
  const filters = asObject(filtersValue);

  if (config.kind !== "page") {
    return { config, filters };
  }

  if (config.pageId !== BOOKINGS_SUMMARY_DASHBOARD_PAGE_ID) {
    throw new DashboardPageConfigError("Unsupported dashboard page.");
  }
  if (config.schemaVersion !== undefined && Number(config.schemaVersion) !== 1) {
    throw new DashboardPageConfigError("Unsupported dashboard page configuration version.");
  }

  const summaryDateField =
    typeof filters.summaryDateField === "string" && SUMMARY_DATE_FIELDS.has(filters.summaryDateField)
      ? filters.summaryDateField
      : "experience_date";
  const summaryPreset =
    typeof filters.summaryPreset === "string" && SUMMARY_PRESETS.has(filters.summaryPreset)
      ? filters.summaryPreset
      : "today";
  const summaryMetric =
    typeof filters.summaryMetric === "string" && SUMMARY_METRICS.has(filters.summaryMetric)
      ? filters.summaryMetric
      : "revenue";

  let summaryStart = summaryPreset === "custom" ? normalizeDate(filters.summaryStart) : null;
  let summaryEnd = summaryPreset === "custom" ? normalizeDate(filters.summaryEnd) : null;
  if (summaryPreset === "custom") {
    // A single selected day is a valid range and is represented by equal bounds.
    summaryStart = summaryStart ?? summaryEnd;
    summaryEnd = summaryEnd ?? summaryStart;
    if (summaryStart && summaryEnd && summaryStart > summaryEnd) {
      [summaryStart, summaryEnd] = [summaryEnd, summaryStart];
    }
  }

  return {
    config: {
      schemaVersion: 1,
      kind: "page",
      pageId: BOOKINGS_SUMMARY_DASHBOARD_PAGE_ID,
    },
    filters: {
      summaryDateField,
      summaryProductTypes: normalizeProductTypes(filters.summaryProductTypes),
      summaryPreset,
      summaryMetric,
      summaryStart,
      summaryEnd,
    },
  };
};
