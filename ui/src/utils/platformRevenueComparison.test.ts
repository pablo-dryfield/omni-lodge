import type { PlatformRevenueComparisonInput } from "./platformRevenueComparison";
import {
  ALL_PLATFORM_COMPARISON_WEEKDAYS,
  buildPlatformRevenueComparisonPeriods,
  buildPlatformRevenueComparisonPivot,
  comparePlatformRevenueValues,
  getCompletedPlatformComparisonRange,
  getPlatformComparisonCurrencies,
  getPlatformComparisonPlatforms,
} from "./platformRevenueComparison";

const createRow = (
  overrides: Partial<PlatformRevenueComparisonInput> = {},
): PlatformRevenueComparisonInput => ({
  date: "2026-08-02",
  sourceReceivedAt: "2026-08-02T10:00:00.000Z",
  status: "confirmed",
  platformLabel: "Civitatis",
  currency: "PLN",
  netRevenue: 100,
  processingFee: 10,
  people: 2,
  ...overrides,
});

describe("Platform Revenue comparison", () => {
  it("builds Sunday-start week columns and keeps the exact range boundaries", () => {
    expect(
      buildPlatformRevenueComparisonPeriods({
        startDate: "2026-08-02",
        endDate: "2026-08-15",
        columnMode: "week",
        weekStartsOn: 0,
        weekdays: [0, 1, 2, 3, 4],
      }),
    ).toEqual([
      {
        id: "week:2026-08-02:2026-08-08",
        label: "Aug 2–8, 2026",
        startDate: "2026-08-02",
        endDate: "2026-08-08",
      },
      {
        id: "week:2026-08-09:2026-08-15",
        label: "Aug 9–15, 2026",
        startDate: "2026-08-09",
        endDate: "2026-08-15",
      },
    ]);
  });

  it("creates daily columns only for the selected weekdays", () => {
    expect(
      buildPlatformRevenueComparisonPeriods({
        startDate: "2026-08-02",
        endDate: "2026-08-15",
        columnMode: "day",
        weekStartsOn: 0,
        weekdays: [5, 6],
      }).map((period) => period.startDate),
    ).toEqual(["2026-08-07", "2026-08-08", "2026-08-14", "2026-08-15"]);
  });

  it("builds Monday-start week columns when requested", () => {
    expect(
      buildPlatformRevenueComparisonPeriods({
        startDate: "2026-08-03",
        endDate: "2026-08-16",
        columnMode: "week",
        weekStartsOn: 1,
        weekdays: ALL_PLATFORM_COMPARISON_WEEKDAYS,
      }).map((period) => [period.startDate, period.endDate]),
    ).toEqual([
      ["2026-08-03", "2026-08-09"],
      ["2026-08-10", "2026-08-16"],
    ]);
  });

  it("returns no periods for invalid ranges or an empty weekday selection", () => {
    expect(
      buildPlatformRevenueComparisonPeriods({
        startDate: "2026-08-10",
        endDate: "2026-08-01",
        columnMode: "week",
        weekStartsOn: 0,
        weekdays: ALL_PLATFORM_COMPARISON_WEEKDAYS,
      }),
    ).toEqual([]);
    expect(
      buildPlatformRevenueComparisonPeriods({
        startDate: "2026-08-01",
        endDate: "2026-08-10",
        columnMode: "week",
        weekStartsOn: 0,
        weekdays: [],
      }),
    ).toEqual([]);
  });

  it("uses the selected Experience Date or Warsaw Source Received At basis", () => {
    const rows = [
      createRow({
        date: "2026-08-10",
        sourceReceivedAt: "2026-08-01T21:30:00.000Z",
        processingFee: 0,
      }),
      createRow({
        date: "2026-08-10",
        sourceReceivedAt: "2026-08-01T22:30:00.000Z",
        processingFee: 0,
      }),
    ];
    const common = {
      startDate: "2026-08-01",
      endDate: "2026-08-10",
      columnMode: "day" as const,
      weekStartsOn: 0 as const,
      weekdays: ALL_PLATFORM_COMPARISON_WEEKDAYS,
      currency: "PLN",
      platforms: [] as string[],
    };

    const byExperience = buildPlatformRevenueComparisonPivot(rows, {
      ...common,
      dateField: "experience_date",
    });
    const byReceived = buildPlatformRevenueComparisonPivot(rows, {
      ...common,
      dateField: "source_received_at",
    });

    expect(byExperience.rows[0].cells["day:2026-08-10"].bookings).toBe(2);
    expect(byReceived.rows[0].cells["day:2026-08-01"].bookings).toBe(1);
    expect(byReceived.rows[0].cells["day:2026-08-02"].bookings).toBe(1);
  });

  it("applies weekday, platform, currency, and cancelled-booking filters", () => {
    const rows = [
      createRow(),
      createRow({ platformLabel: "Viator", date: "2026-08-07" }),
      createRow({ platformLabel: "GetYourGuide", currency: "EUR" }),
      createRow({ platformLabel: "Cancelled only", status: "cancelled" }),
    ];
    const pivot = buildPlatformRevenueComparisonPivot(rows, {
      startDate: "2026-08-02",
      endDate: "2026-08-08",
      columnMode: "week",
      weekStartsOn: 0,
      weekdays: [0, 1, 2, 3, 4],
      dateField: "experience_date",
      currency: "PLN",
      platforms: ["Civitatis", "Viator"],
    });

    expect(pivot.rows.map((row) => row.platform)).toEqual(["Civitatis", "Viator"]);
    expect(pivot.rows[0].total).toEqual({ revenue: 90, bookings: 1, people: 2 });
    expect(pivot.rows[1].total).toEqual({ revenue: 0, bookings: 0, people: 0 });
    expect(pivot.grandTotal).toEqual({ revenue: 90, bookings: 1, people: 2 });
  });

  it("uses the Platform Revenue Share formula and keeps displayed totals additive", () => {
    const rows = [
      createRow({ netRevenue: 100, processingFee: 10, people: 2 }),
      createRow({ netRevenue: 50, processingFee: -5, people: 1 }),
      createRow({ date: "2026-08-09", netRevenue: 25.555, processingFee: 0, people: 3 }),
    ];
    const pivot = buildPlatformRevenueComparisonPivot(rows, {
      startDate: "2026-08-02",
      endDate: "2026-08-15",
      columnMode: "week",
      weekStartsOn: 0,
      weekdays: ALL_PLATFORM_COMPARISON_WEEKDAYS,
      dateField: "experience_date",
      currency: "PLN",
      platforms: [],
    });

    expect(pivot.rows[0].cells["week:2026-08-02:2026-08-08"].revenue).toBe(140);
    expect(pivot.rows[0].cells["week:2026-08-09:2026-08-15"].revenue).toBe(25.56);
    expect(pivot.rows[0].total.revenue).toBe(165.56);
    expect(pivot.columnTotals["week:2026-08-02:2026-08-08"].revenue).toBe(140);
    expect(pivot.columnTotals["week:2026-08-09:2026-08-15"].revenue).toBe(25.56);
    expect(pivot.grandTotal.revenue).toBe(165.56);
  });

  it("lists only usable currencies and platforms", () => {
    const rows = [
      createRow(),
      createRow({ platformLabel: "Viator" }),
      createRow({ platformLabel: "GetYourGuide", currency: "EUR" }),
      createRow({ platformLabel: "Cancelled only", status: "cancelled" }),
    ];

    expect(getPlatformComparisonCurrencies(rows)).toEqual(["EUR", "PLN"]);
    expect(getPlatformComparisonPlatforms(rows, "PLN")).toEqual(["Civitatis", "Viator"]);
    expect(getPlatformComparisonPlatforms(rows, "EUR")).toEqual(["GetYourGuide"]);
  });

  it("creates completed-week presets for either week start", () => {
    expect(getCompletedPlatformComparisonRange("2026-08-21", 2, 0)).toEqual([
      "2026-08-02",
      "2026-08-15",
    ]);
    expect(getCompletedPlatformComparisonRange("2026-08-21", 2, 1)).toEqual([
      "2026-08-03",
      "2026-08-16",
    ]);
  });

  it("classifies period-over-period revenue changes after currency rounding", () => {
    expect(comparePlatformRevenueValues(120, 100)).toBe("higher");
    expect(comparePlatformRevenueValues(80, 100)).toBe("lower");
    expect(comparePlatformRevenueValues(100.004, 100)).toBe("equal");
  });
});
