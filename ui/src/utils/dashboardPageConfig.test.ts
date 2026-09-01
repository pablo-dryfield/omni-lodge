import {
  BOOKINGS_SUMMARY_DASHBOARD_PAGE_CONFIG,
  createDefaultBookingsSummaryDashboardFilters,
  isBookingsSummaryDashboardPageConfig,
  normalizeBookingsSummaryDashboardFilters,
} from "./dashboardPageConfig";

describe("dashboard page configuration", () => {
  it("recognizes only the canonical Booking Summary page config", () => {
    expect(isBookingsSummaryDashboardPageConfig(BOOKINGS_SUMMARY_DASHBOARD_PAGE_CONFIG)).toBe(true);
    expect(isBookingsSummaryDashboardPageConfig({})).toBe(false);
    expect(isBookingsSummaryDashboardPageConfig({
      schemaVersion: 1,
      kind: "page",
      pageId: "another-page",
    })).toBe(false);
  });

  it("uses the requested Booking Summary defaults when filters are missing", () => {
    expect(normalizeBookingsSummaryDashboardFilters(undefined)).toEqual({
      summaryDateField: "experience_date",
      summaryProductTypes: ["1", "2"],
      summaryPreset: "today",
      summaryMetric: "revenue",
      summaryStart: null,
      summaryEnd: null,
    });
  });

  it("normalizes supported filters into the persisted shape", () => {
    expect(normalizeBookingsSummaryDashboardFilters({
      summaryDateField: "source_received_at",
      summaryProductTypes: ["2", 1, "02", "nope", 0, "2"],
      summaryPreset: "custom",
      summaryMetric: "costs",
      summaryStart: "2026-08-01",
      summaryEnd: "2026-08-31",
    })).toEqual({
      summaryDateField: "source_received_at",
      summaryProductTypes: ["1", "2"],
      summaryPreset: "custom",
      summaryMetric: "costs",
      summaryStart: "2026-08-01",
      summaryEnd: "2026-08-31",
    });
  });

  it("preserves an explicit empty product selection", () => {
    expect(normalizeBookingsSummaryDashboardFilters({ summaryProductTypes: [] }).summaryProductTypes).toEqual([]);
  });

  it("drops custom dates for non-custom presets and orders reversed ranges", () => {
    expect(normalizeBookingsSummaryDashboardFilters({
      summaryPreset: "today",
      summaryStart: "2026-08-01",
      summaryEnd: "2026-08-31",
    })).toMatchObject({ summaryStart: null, summaryEnd: null });

    expect(normalizeBookingsSummaryDashboardFilters({
      summaryPreset: "custom",
      summaryStart: "2026-09-01",
      summaryEnd: "2026-08-31",
    })).toMatchObject({ summaryStart: "2026-08-31", summaryEnd: "2026-09-01" });
  });

  it("preserves an in-progress custom range until the second date is selected", () => {
    expect(normalizeBookingsSummaryDashboardFilters({
      summaryPreset: "custom",
      summaryStart: "2026-08-31",
      summaryEnd: null,
    })).toMatchObject({
      summaryStart: "2026-08-31",
      summaryEnd: null,
    });
  });

  it("returns independent default filter objects", () => {
    const first = createDefaultBookingsSummaryDashboardFilters();
    const second = createDefaultBookingsSummaryDashboardFilters();
    first.summaryProductTypes.push("9");
    expect(second.summaryProductTypes).toEqual(["1", "2"]);
  });
});
