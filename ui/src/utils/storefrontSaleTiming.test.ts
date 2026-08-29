import {
  formatStorefrontSaleDuration,
  getStorefrontSaleTiming,
} from "./storefrontSaleTiming";

describe("storefront sale timing", () => {
  it("uses the earliest and latest recorded events across every visit", () => {
    const timing = getStorefrontSaleTiming([
      {
        events: [
          { occurredAt: "2026-08-29T15:07:54.900Z" },
          { occurredAt: "invalid" },
        ],
      },
      {
        events: [
          { occurredAt: "2026-08-29T15:04:47.100Z" },
          { occurredAt: "2026-08-29T15:06:41.000Z" },
        ],
      },
    ]);

    expect(timing).toEqual({
      startedAt: "2026-08-29T15:04:47.100Z",
      finishedAt: "2026-08-29T15:07:54.900Z",
      durationSeconds: 187,
    });
  });

  it("returns no timing when no valid event has been recorded", () => {
    expect(getStorefrontSaleTiming([{ events: [{ occurredAt: "invalid" }] }])).toBeNull();
    expect(getStorefrontSaleTiming([])).toBeNull();
  });

  it("formats duration while omitting zero-value larger units", () => {
    expect(formatStorefrontSaleDuration(3730)).toBe("1 Hour, 2 mins, 10 seconds");
    expect(formatStorefrontSaleDuration(121)).toBe("2 mins, 1 second");
    expect(formatStorefrontSaleDuration(10)).toBe("10 seconds");
    expect(formatStorefrontSaleDuration(0)).toBe("0 seconds");
  });
});
