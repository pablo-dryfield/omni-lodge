import {
  DashboardPageConfigError,
  normalizeDashboardConfiguration,
} from "../dashboardPageConfig";

describe("dashboard page configuration", () => {
  it("keeps legacy report dashboard configuration intact", () => {
    expect(
      normalizeDashboardConfiguration(
        { theme: "dark" },
        { region: "Krakow" },
      ),
    ).toEqual({
      config: { theme: "dark" },
      filters: { region: "Krakow" },
    });
  });

  it("normalizes a Booking Summary page and whitelists its filters", () => {
    expect(
      normalizeDashboardConfiguration(
        { schemaVersion: 1, kind: "page", pageId: "bookings-summary", route: "/admin" },
        {
          summaryDateField: "source_received_at",
          summaryProductTypes: ["2", 1, "02", "invalid"],
          summaryPreset: "custom",
          summaryMetric: "costs",
          summaryStart: "2026-08-20",
          summaryEnd: "2026-08-01",
          unsafe: true,
        },
      ),
    ).toEqual({
      config: { schemaVersion: 1, kind: "page", pageId: "bookings-summary" },
      filters: {
        summaryDateField: "source_received_at",
        summaryProductTypes: ["1", "2"],
        summaryPreset: "custom",
        summaryMetric: "costs",
        summaryStart: "2026-08-01",
        summaryEnd: "2026-08-20",
      },
    });
  });

  it("uses today and product types 1 and 2 for a new Booking Summary dashboard", () => {
    expect(
      normalizeDashboardConfiguration(
        { kind: "page", pageId: "bookings-summary" },
        {},
      ),
    ).toEqual({
      config: { schemaVersion: 1, kind: "page", pageId: "bookings-summary" },
      filters: {
        summaryDateField: "experience_date",
        summaryProductTypes: ["1", "2"],
        summaryPreset: "today",
        summaryMetric: "revenue",
        summaryStart: null,
        summaryEnd: null,
      },
    });
  });

  it("turns a one-sided custom date into a single-day range", () => {
    const result = normalizeDashboardConfiguration(
      { kind: "page", pageId: "bookings-summary" },
      { summaryPreset: "custom", summaryStart: "2026-08-16" },
    );
    expect(result.filters.summaryStart).toBe("2026-08-16");
    expect(result.filters.summaryEnd).toBe("2026-08-16");
  });

  it("does not persist invalid custom dates", () => {
    const result = normalizeDashboardConfiguration(
      { kind: "page", pageId: "bookings-summary" },
      { summaryPreset: "custom", summaryStart: "2026-02-31" },
    );
    expect(result.filters.summaryStart).toBeNull();
    expect(result.filters.summaryEnd).toBeNull();
  });

  it("rejects arbitrary page identifiers", () => {
    expect(() =>
      normalizeDashboardConfiguration(
        { kind: "page", pageId: "https://example.com" },
        {},
      ),
    ).toThrow(DashboardPageConfigError);
  });
});
