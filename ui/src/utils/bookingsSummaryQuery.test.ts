import dayjs from "dayjs";
import {
  parseBookingsSummarySearchParams,
  resolveBookingsSummaryRange,
  serializeBookingsSummarySearchParams,
  writeBookingsSummarySearchParams,
  type BookingsSummaryFilters,
} from "./bookingsSummaryQuery";

const baseFilters: BookingsSummaryFilters = {
  summaryDateField: "experience_date",
  summaryProductTypes: ["1", "2"],
  summaryPreset: "today",
  summaryMetric: "revenue",
  summaryStart: null,
  summaryEnd: null,
};

describe("Booking Summary query configuration", () => {
  it("parses the today dashboard URL with product types 1 and 2", () => {
    const result = parseBookingsSummarySearchParams(
      new URLSearchParams("tab=summary&summaryProductTypes=1%2C2&summaryPreset=today"),
    );

    expect(result.hasExplicitProductTypes).toBe(true);
    expect(result.filters).toEqual(baseFilters);
  });

  it("round-trips the supported Summary filters without carrying unrelated URL state", () => {
    const filters: BookingsSummaryFilters = {
      summaryDateField: "source_received_at",
      summaryProductTypes: ["2", "1"],
      summaryPreset: "custom",
      summaryMetric: "costs",
      summaryStart: "2026-08-08",
      summaryEnd: "2026-08-12",
    };

    const serialized = serializeBookingsSummarySearchParams(filters);
    const parsed = parseBookingsSummarySearchParams(new URLSearchParams(serialized));

    expect(parsed.filters).toEqual({
      ...filters,
      summaryProductTypes: ["1", "2"],
    });
    expect(parsed.hasExplicitProductTypes).toBe(true);
  });

  it("preserves unrelated parameters while replacing legacy Summary parameters", () => {
    const existing = new URLSearchParams(
      "tab=summary&summaryProductType=9&emailPage=3",
    );
    const next = writeBookingsSummarySearchParams(existing, baseFilters);

    expect(next.get("tab")).toBe("summary");
    expect(next.get("emailPage")).toBe("3");
    expect(next.get("summaryProductType")).toBeNull();
    expect(next.get("summaryProductTypes")).toBe("1,2");
    expect(next.get("summaryPreset")).toBe("today");
  });

  it("supports a custom single-day range", () => {
    const range = resolveBookingsSummaryRange(
      {
        summaryPreset: "custom",
        summaryStart: "2026-08-24",
        summaryEnd: "2026-08-24",
      },
      dayjs("2026-09-01T12:00:00"),
    );

    expect(range.start.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-08-24 00:00:00");
    expect(range.end.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-08-24 23:59:59");
  });
});
