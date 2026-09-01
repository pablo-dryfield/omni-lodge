import { resolveHomeNativeDashboard } from "./homeNativeDashboard";

describe("resolveHomeNativeDashboard", () => {
  it("keeps dashboards without a page kind on the legacy report-card path", () => {
    expect(resolveHomeNativeDashboard({ config: {}, filters: {} })).toBeNull();
  });

  it("resolves a Booking Summary page and normalizes its saved filters", () => {
    expect(
      resolveHomeNativeDashboard({
        config: { schemaVersion: 1, kind: "page", pageId: "bookings-summary" },
        filters: {
          summaryDateField: "source_received_at",
          summaryProductTypes: ["2", "1", "2"],
          summaryPreset: "last_week",
          summaryMetric: "costs",
          summaryStart: "2026-08-01",
          summaryEnd: "2026-08-31",
        },
      }),
    ).toEqual({
      kind: "bookings-summary",
      filters: {
        summaryDateField: "source_received_at",
        summaryProductTypes: ["1", "2"],
        summaryPreset: "last_week",
        summaryMetric: "costs",
        summaryStart: null,
        summaryEnd: null,
      },
    });
  });

  it("does not treat unknown page identifiers as native Home dashboards", () => {
    expect(
      resolveHomeNativeDashboard({
        config: { schemaVersion: 1, kind: "page", pageId: "unknown" },
        filters: {},
      }),
    ).toBeNull();
  });
});
