import dayjs, { type Dayjs } from "dayjs";
import { sortProductTypeQueryValues } from "./productTypeQuery";

export type BookingsSummaryDateField = "experience_date" | "source_received_at";
export type BookingsSummaryMetric = "earnings" | "revenue" | "costs";
export type BookingsSummaryPreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "last_7_days"
  | "last_14_days"
  | "last_2_weeks"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "all_time"
  | "custom";

export type BookingsSummaryFilters = {
  summaryDateField: BookingsSummaryDateField;
  summaryProductTypes: string[];
  summaryPreset: BookingsSummaryPreset;
  summaryMetric: BookingsSummaryMetric;
  summaryStart: string | null;
  summaryEnd: string | null;
};

export const DEFAULT_BOOKINGS_SUMMARY_FILTERS: BookingsSummaryFilters = {
  summaryDateField: "experience_date",
  summaryProductTypes: [],
  summaryPreset: "this_month",
  summaryMetric: "revenue",
  summaryStart: null,
  summaryEnd: null,
};

export const BOOKINGS_SUMMARY_PRESET_OPTIONS: Array<{
  value: BookingsSummaryPreset;
  label: string;
}> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_14_days", label: "Last 14 Days" },
  { value: "last_2_weeks", label: "Last 2 Weeks" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "all_time", label: "All Time" },
  { value: "custom", label: "Custom" },
];

export const parseBookingsSummaryDateField = (
  value?: string | null,
): BookingsSummaryDateField =>
  String(value ?? "").trim().toLowerCase() === "source_received_at"
    ? "source_received_at"
    : "experience_date";

const parseProductTypeValue = (value?: string | null): string | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : null;
};

export const parseBookingsSummaryProductTypes = (
  ...values: Array<string | null | undefined>
): string[] =>
  Array.from(
    new Set(
      values
        .flatMap((value) => String(value ?? "").split(","))
        .map((entry) => parseProductTypeValue(entry))
        .filter((entry): entry is string => entry !== null),
    ),
  );

export const parseBookingsSummaryPreset = (
  value?: string | null,
): BookingsSummaryPreset => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return BOOKINGS_SUMMARY_PRESET_OPTIONS.some((option) => option.value === normalized)
    ? (normalized as BookingsSummaryPreset)
    : "this_month";
};

export const parseBookingsSummaryMetric = (
  value?: string | null,
): BookingsSummaryMetric => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "earnings" || normalized === "costs"
    ? normalized
    : "revenue";
};

export const parseBookingsSummaryDate = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : null;
};

export const normalizeBookingsSummaryFilters = (
  value?: Partial<BookingsSummaryFilters> | null,
): BookingsSummaryFilters => ({
  summaryDateField: parseBookingsSummaryDateField(value?.summaryDateField),
  summaryProductTypes: parseBookingsSummaryProductTypes(
    ...(value?.summaryProductTypes ?? []),
  ),
  summaryPreset: parseBookingsSummaryPreset(value?.summaryPreset),
  summaryMetric: parseBookingsSummaryMetric(value?.summaryMetric),
  summaryStart: parseBookingsSummaryDate(value?.summaryStart),
  summaryEnd: parseBookingsSummaryDate(value?.summaryEnd),
});

export const parseBookingsSummarySearchParams = (
  params: URLSearchParams,
): { filters: BookingsSummaryFilters; hasExplicitProductTypes: boolean } => ({
  filters: {
    summaryDateField: parseBookingsSummaryDateField(params.get("summaryDateField")),
    summaryProductTypes: parseBookingsSummaryProductTypes(
      params.get("summaryProductTypes"),
      params.get("summaryProductType"),
    ),
    summaryPreset: parseBookingsSummaryPreset(params.get("summaryPreset")),
    summaryMetric: parseBookingsSummaryMetric(params.get("summaryMetric")),
    summaryStart: parseBookingsSummaryDate(params.get("summaryStart")),
    summaryEnd: parseBookingsSummaryDate(params.get("summaryEnd")),
  },
  hasExplicitProductTypes:
    params.has("summaryProductTypes") || params.has("summaryProductType"),
});

export const writeBookingsSummarySearchParams = (
  params: URLSearchParams,
  value: BookingsSummaryFilters,
): URLSearchParams => {
  const filters = normalizeBookingsSummaryFilters(value);
  const next = new URLSearchParams(params);
  const setOptional = (key: string, candidate: string | null) => {
    if (candidate) next.set(key, candidate);
    else next.delete(key);
  };

  setOptional(
    "summaryDateField",
    filters.summaryDateField === "experience_date" ? null : filters.summaryDateField,
  );
  next.delete("summaryProductType");
  setOptional(
    "summaryProductTypes",
    filters.summaryProductTypes.length > 0
      ? sortProductTypeQueryValues(filters.summaryProductTypes).join(",")
      : null,
  );
  setOptional(
    "summaryPreset",
    filters.summaryPreset === "this_month" ? null : filters.summaryPreset,
  );
  setOptional(
    "summaryMetric",
    filters.summaryMetric === "revenue" ? null : filters.summaryMetric,
  );
  setOptional(
    "summaryStart",
    filters.summaryPreset === "custom" ? filters.summaryStart : null,
  );
  setOptional(
    "summaryEnd",
    filters.summaryPreset === "custom" ? filters.summaryEnd : null,
  );
  return next;
};

export const serializeBookingsSummarySearchParams = (
  filters: BookingsSummaryFilters,
): string => writeBookingsSummarySearchParams(new URLSearchParams(), filters).toString();

export const resolveBookingsSummaryRange = (
  filters: Pick<BookingsSummaryFilters, "summaryPreset" | "summaryStart" | "summaryEnd">,
  now: Dayjs = dayjs(),
): { start: Dayjs; end: Dayjs } => {
  const today = now.startOf("day");
  const thisMonthStart = today.startOf("month");
  const thisMonthEnd = today.endOf("month");
  const thisWeekStart = today.startOf("week");
  const thisWeekEnd = today.endOf("week");

  switch (filters.summaryPreset) {
    case "today":
      return { start: today, end: today.endOf("day") };
    case "yesterday": {
      const yesterday = today.subtract(1, "day");
      return { start: yesterday, end: yesterday.endOf("day") };
    }
    case "this_week":
      return { start: thisWeekStart, end: thisWeekEnd };
    case "last_week": {
      const lastWeekStart = thisWeekStart.subtract(1, "week").startOf("week");
      return { start: lastWeekStart, end: lastWeekStart.endOf("week") };
    }
    case "last_7_days":
      return { start: today.subtract(6, "day"), end: today.endOf("day") };
    case "last_14_days":
      return { start: today.subtract(13, "day"), end: today.endOf("day") };
    case "last_2_weeks": {
      const end = thisWeekStart.subtract(1, "day").endOf("day");
      return { start: thisWeekStart.subtract(2, "week").startOf("day"), end };
    }
    case "last_month": {
      const start = today.subtract(1, "month").startOf("month");
      return { start, end: start.endOf("month") };
    }
    case "this_year": {
      const start = today.startOf("year");
      return { start, end: start.endOf("year") };
    }
    case "last_year": {
      const start = today.subtract(1, "year").startOf("year");
      return { start, end: start.endOf("year") };
    }
    case "all_time":
      return { start: dayjs("2000-01-01").startOf("day"), end: today.endOf("day") };
    case "custom": {
      const start = filters.summaryStart
        ? dayjs(filters.summaryStart, "YYYY-MM-DD", true).startOf("day")
        : null;
      const end = filters.summaryEnd
        ? dayjs(filters.summaryEnd, "YYYY-MM-DD", true).endOf("day")
        : null;
      if (start?.isValid() && end?.isValid() && !end.isBefore(start, "day")) {
        return { start, end };
      }
      return { start: thisMonthStart, end: thisMonthEnd };
    }
    case "this_month":
    default:
      return { start: thisMonthStart, end: thisMonthEnd };
  }
};
