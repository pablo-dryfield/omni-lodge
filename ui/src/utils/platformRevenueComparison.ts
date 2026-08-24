import type { UnifiedOrder } from "../store/bookingPlatformsTypes";
import {
  resolveBookingsSummaryDate,
  type BookingsSummaryDateField,
} from "./bookingsSummaryDate";

export type PlatformComparisonWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PlatformComparisonWeekStartsOn = 0 | 1;
export type PlatformComparisonColumnMode = "week" | "day";
export type PlatformRevenueComparisonDirection = "higher" | "lower" | "equal";

export const ALL_PLATFORM_COMPARISON_WEEKDAYS: PlatformComparisonWeekday[] = [
  0, 1, 2, 3, 4, 5, 6,
];

export type PlatformRevenueComparisonInput = Pick<
  UnifiedOrder,
  "date" | "sourceReceivedAt" | "status"
> & {
  platformLabel: string;
  currency: string;
  netRevenue: number;
  processingFee: number;
  people: number;
};

export type PlatformRevenueComparisonPeriod = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
};

export type PlatformRevenueComparisonCell = {
  revenue: number;
  bookings: number;
  people: number;
};

export type PlatformRevenueComparisonRow = {
  platform: string;
  cells: Record<string, PlatformRevenueComparisonCell>;
  total: PlatformRevenueComparisonCell;
};

export type PlatformRevenueComparisonPivot = {
  periods: PlatformRevenueComparisonPeriod[];
  rows: PlatformRevenueComparisonRow[];
  columnTotals: Record<string, PlatformRevenueComparisonCell>;
  grandTotal: PlatformRevenueComparisonCell;
};

type BuildPeriodsOptions = {
  startDate: string;
  endDate: string;
  columnMode: PlatformComparisonColumnMode;
  weekStartsOn: PlatformComparisonWeekStartsOn;
  weekdays: readonly PlatformComparisonWeekday[];
};

type BuildPivotOptions = BuildPeriodsOptions & {
  dateField: BookingsSummaryDateField;
  currency: string;
  platforms: readonly string[];
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parseDateOnly = (value: string): Date | null => {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || formatDateOnly(parsed) !== value) {
    return null;
  }
  return parsed;
};

const formatDateOnly = (value: Date): string => {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (value: Date, days: number): Date => {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const compareDates = (left: Date, right: Date): number => left.getTime() - right.getTime();

const formatPeriodLabel = (start: Date, end: Date): string => {
  if (compareDates(start, end) === 0) {
    return `${WEEKDAY_LABELS[start.getUTCDay()]}, ${MONTH_LABELS[start.getUTCMonth()]} ${start.getUTCDate()}, ${start.getUTCFullYear()}`;
  }

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) {
    return `${MONTH_LABELS[start.getUTCMonth()]} ${start.getUTCDate()}–${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }
  if (sameYear) {
    return `${MONTH_LABELS[start.getUTCMonth()]} ${start.getUTCDate()}–${MONTH_LABELS[end.getUTCMonth()]} ${end.getUTCDate()}, ${start.getUTCFullYear()}`;
  }
  return `${MONTH_LABELS[start.getUTCMonth()]} ${start.getUTCDate()}, ${start.getUTCFullYear()}–${MONTH_LABELS[end.getUTCMonth()]} ${end.getUTCDate()}, ${end.getUTCFullYear()}`;
};

const normalizeWeekdays = (
  weekdays: readonly PlatformComparisonWeekday[],
): Set<PlatformComparisonWeekday> =>
  new Set(
    weekdays.filter(
      (weekday): weekday is PlatformComparisonWeekday =>
        Number.isInteger(weekday) && weekday >= 0 && weekday <= 6,
    ),
  );

const periodContainsSelectedDay = (
  start: Date,
  end: Date,
  weekdays: ReadonlySet<PlatformComparisonWeekday>,
): boolean => {
  let cursor = start;
  while (compareDates(cursor, end) <= 0) {
    if (weekdays.has(cursor.getUTCDay() as PlatformComparisonWeekday)) {
      return true;
    }
    cursor = addDays(cursor, 1);
  }
  return false;
};

export const buildPlatformRevenueComparisonPeriods = ({
  startDate,
  endDate,
  columnMode,
  weekStartsOn,
  weekdays,
}: BuildPeriodsOptions): PlatformRevenueComparisonPeriod[] => {
  const rangeStart = parseDateOnly(startDate);
  const rangeEnd = parseDateOnly(endDate);
  const selectedWeekdays = normalizeWeekdays(weekdays);
  if (!rangeStart || !rangeEnd || compareDates(rangeStart, rangeEnd) > 0 || selectedWeekdays.size === 0) {
    return [];
  }

  if (columnMode === "day") {
    const periods: PlatformRevenueComparisonPeriod[] = [];
    let cursor = rangeStart;
    while (compareDates(cursor, rangeEnd) <= 0) {
      if (selectedWeekdays.has(cursor.getUTCDay() as PlatformComparisonWeekday)) {
        const date = formatDateOnly(cursor);
        periods.push({
          id: `day:${date}`,
          label: formatPeriodLabel(cursor, cursor),
          startDate: date,
          endDate: date,
        });
      }
      cursor = addDays(cursor, 1);
    }
    return periods;
  }

  const rangeStartWeekday = rangeStart.getUTCDay();
  const daysFromWeekStart = (rangeStartWeekday - weekStartsOn + 7) % 7;
  let weekCursor = addDays(rangeStart, -daysFromWeekStart);
  const periods: PlatformRevenueComparisonPeriod[] = [];

  while (compareDates(weekCursor, rangeEnd) <= 0) {
    const fullWeekEnd = addDays(weekCursor, 6);
    const periodStart = compareDates(weekCursor, rangeStart) < 0 ? rangeStart : weekCursor;
    const periodEnd = compareDates(fullWeekEnd, rangeEnd) > 0 ? rangeEnd : fullWeekEnd;
    if (periodContainsSelectedDay(periodStart, periodEnd, selectedWeekdays)) {
      const start = formatDateOnly(periodStart);
      const end = formatDateOnly(periodEnd);
      periods.push({
        id: `week:${start}:${end}`,
        label: formatPeriodLabel(periodStart, periodEnd),
        startDate: start,
        endDate: end,
      });
    }
    weekCursor = addDays(weekCursor, 7);
  }

  return periods;
};

const createEmptyCell = (): PlatformRevenueComparisonCell => ({
  revenue: 0,
  bookings: 0,
  people: 0,
});

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export const comparePlatformRevenueValues = (
  currentValue: number,
  previousValue: number,
): PlatformRevenueComparisonDirection => {
  const current = roundMoney(Number(currentValue) || 0);
  const previous = roundMoney(Number(previousValue) || 0);
  if (current > previous) {
    return "higher";
  }
  if (current < previous) {
    return "lower";
  }
  return "equal";
};

const addCell = (
  target: PlatformRevenueComparisonCell,
  source: PlatformRevenueComparisonCell,
): PlatformRevenueComparisonCell => ({
  revenue: roundMoney(target.revenue + source.revenue),
  bookings: target.bookings + source.bookings,
  people: target.people + source.people,
});

const normalizeCurrency = (value: string): string => String(value ?? "PLN").trim().toUpperCase() || "PLN";

const normalizePlatform = (value: string): string => String(value ?? "").trim() || "Unknown";

const createDateToPeriodMap = (
  periods: readonly PlatformRevenueComparisonPeriod[],
  weekdays: ReadonlySet<PlatformComparisonWeekday>,
): Map<string, string> => {
  const result = new Map<string, string>();
  periods.forEach((period) => {
    const start = parseDateOnly(period.startDate);
    const end = parseDateOnly(period.endDate);
    if (!start || !end) {
      return;
    }
    let cursor = start;
    while (compareDates(cursor, end) <= 0) {
      if (weekdays.has(cursor.getUTCDay() as PlatformComparisonWeekday)) {
        result.set(formatDateOnly(cursor), period.id);
      }
      cursor = addDays(cursor, 1);
    }
  });
  return result;
};

export const getPlatformComparisonCurrencies = (
  rows: readonly PlatformRevenueComparisonInput[],
): string[] => {
  const currencies = new Set<string>();
  rows.forEach((row) => {
    if (row.status !== "cancelled") {
      currencies.add(normalizeCurrency(row.currency));
    }
  });
  return Array.from(currencies).sort((left, right) => left.localeCompare(right));
};

export const getPlatformComparisonPlatforms = (
  rows: readonly PlatformRevenueComparisonInput[],
  currency: string,
): string[] => {
  const normalizedCurrency = normalizeCurrency(currency);
  const platforms = new Set<string>();
  rows.forEach((row) => {
    if (row.status !== "cancelled" && normalizeCurrency(row.currency) === normalizedCurrency) {
      platforms.add(normalizePlatform(row.platformLabel));
    }
  });
  return Array.from(platforms).sort((left, right) => left.localeCompare(right));
};

export const buildPlatformRevenueComparisonPivot = (
  rows: readonly PlatformRevenueComparisonInput[],
  options: BuildPivotOptions,
): PlatformRevenueComparisonPivot => {
  const periods = buildPlatformRevenueComparisonPeriods(options);
  const selectedWeekdays = normalizeWeekdays(options.weekdays);
  const dateToPeriod = createDateToPeriodMap(periods, selectedWeekdays);
  const selectedPlatforms = Array.from(
    new Set(options.platforms.map(normalizePlatform)),
  );
  const selectedPlatformSet = new Set(selectedPlatforms);
  const currency = normalizeCurrency(options.currency);
  const rawCells = new Map<string, Map<string, PlatformRevenueComparisonCell>>();

  selectedPlatforms.forEach((platform) => rawCells.set(platform, new Map()));

  rows.forEach((row) => {
    if (row.status === "cancelled" || normalizeCurrency(row.currency) !== currency) {
      return;
    }
    const date = resolveBookingsSummaryDate(row, options.dateField);
    if (!date) {
      return;
    }
    const periodId = dateToPeriod.get(date);
    if (!periodId) {
      return;
    }
    const platform = normalizePlatform(row.platformLabel);
    if (selectedPlatformSet.size > 0 && !selectedPlatformSet.has(platform)) {
      return;
    }
    const platformCells = rawCells.get(platform) ?? new Map<string, PlatformRevenueComparisonCell>();
    const cell = platformCells.get(periodId) ?? createEmptyCell();
    cell.revenue += row.netRevenue - Math.max(0, Number(row.processingFee) || 0);
    cell.bookings += 1;
    cell.people += Math.max(0, Number(row.people) || 0);
    platformCells.set(periodId, cell);
    rawCells.set(platform, platformCells);
  });

  const comparisonRows = Array.from(rawCells.entries()).map(([platform, platformCells]) => {
    const cells: Record<string, PlatformRevenueComparisonCell> = {};
    let total = createEmptyCell();
    periods.forEach((period) => {
      const rawCell = platformCells.get(period.id) ?? createEmptyCell();
      const cell = { ...rawCell, revenue: roundMoney(rawCell.revenue) };
      cells[period.id] = cell;
      total = addCell(total, cell);
    });
    return { platform, cells, total };
  });

  comparisonRows.sort(
    (left, right) => right.total.revenue - left.total.revenue || left.platform.localeCompare(right.platform),
  );

  const columnTotals: Record<string, PlatformRevenueComparisonCell> = {};
  periods.forEach((period) => {
    columnTotals[period.id] = comparisonRows.reduce(
      (total, row) => addCell(total, row.cells[period.id]),
      createEmptyCell(),
    );
  });
  const grandTotal = comparisonRows.reduce(
    (total, row) => addCell(total, row.total),
    createEmptyCell(),
  );

  return { periods, rows: comparisonRows, columnTotals, grandTotal };
};

export const getCompletedPlatformComparisonRange = (
  referenceDate: string,
  weekCount: number,
  weekStartsOn: PlatformComparisonWeekStartsOn,
): [string, string] | null => {
  const reference = parseDateOnly(referenceDate);
  const normalizedWeekCount = Math.max(1, Math.floor(weekCount));
  if (!reference || !Number.isFinite(normalizedWeekCount)) {
    return null;
  }
  const daysFromWeekStart = (reference.getUTCDay() - weekStartsOn + 7) % 7;
  const currentWeekStart = addDays(reference, -daysFromWeekStart);
  const completedRangeEnd = addDays(currentWeekStart, -1);
  const completedRangeStart = addDays(completedRangeEnd, -(normalizedWeekCount * 7 - 1));
  return [formatDateOnly(completedRangeStart), formatDateOnly(completedRangeEnd)];
};
