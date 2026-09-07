import {
  canManageVolunteerProgress,
  clampProgressPercent,
  formatMilestoneAmount,
  formatVolunteerProgressNumber,
  formatVolunteerProgressTimestamp,
  getCurrentMonth,
  moveVolunteerProgressMonth,
  normalizeVolunteerProgressRole,
  orderVolunteerMilestones,
} from "./volunteerMilestones";
import type { VolunteerMilestone } from "../api/volunteerMilestones";

const milestone = (key: VolunteerMilestone["key"], title = key): VolunteerMilestone => ({
  key,
  title,
  current: 1,
  target: 2,
  unit: "items",
  progressPercent: 50,
  earned: false,
  state: "in_progress",
  remainingText: "One more to go",
  reason: "The target has not been met yet.",
  evidence: [],
});

describe("volunteer milestone helpers", () => {
  it.each([
    ["owner", true],
    ["administrator", true],
    ["assistant_manager", true],
    ["Assistant Manager", true],
    ["guide", false],
    ["volunteer", false],
    [null, false],
  ] as const)("identifies management role %s", (role, expected) => {
    expect(canManageVolunteerProgress(role)).toBe(expected);
  });

  it("normalizes role aliases", () => {
    expect(normalizeVolunteerProgressRole(" assistant_manager ")).toBe("assistant-manager");
    expect(normalizeVolunteerProgressRole("Administrator")).toBe("admin");
  });

  it("keeps progress values inside the visual range", () => {
    expect(clampProgressPercent(-20)).toBe(0);
    expect(clampProgressPercent(64)).toBe(64);
    expect(clampProgressPercent(160)).toBe(100);
    expect(clampProgressPercent(Number.NaN)).toBe(0);
  });

  it("moves month periods across year boundaries", () => {
    expect(moveVolunteerProgressMonth("2026-01", -1)).toBe("2025-12");
    expect(moveVolunteerProgressMonth("2026-12", 1)).toBe("2027-01");
  });

  it("derives the current period in Europe/Warsaw", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-31T22:30:00.000Z"));
    expect(getCurrentMonth()).toBe("2026-09");
    jest.useRealTimers();
  });

  it("formats near-midnight evidence in the scoring timezone", () => {
    expect(
      formatVolunteerProgressTimestamp(
        "2026-08-31T22:30:00.000Z",
        "Europe/Warsaw",
        "D MMM, HH:mm",
      ),
    ).toBe("1 Sep, 00:30");
  });

  it("keeps DATEONLY evidence invariant for a browser in Tokyo", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      expect(
        formatVolunteerProgressTimestamp("2026-09-01", "Europe/Warsaw", "D MMM"),
      ).toBe("1 Sep");
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it("orders the five stars consistently", () => {
    const ordered = orderVolunteerMilestones([
      milestone("management_feedback"),
      milestone("cleaning"),
      milestone("reviews"),
      milestone("monthly_shifts"),
      milestone("attendance"),
    ]);
    expect(ordered.map((item) => item.key)).toEqual([
      "reviews",
      "attendance",
      "monthly_shifts",
      "cleaning",
      "management_feedback",
    ]);
  });

  it("formats exact progress in plain language", () => {
    expect(formatMilestoneAmount(milestone("reviews"))).toBe("1 of 2 items");
    expect(
      formatMilestoneAmount({ ...milestone("attendance"), current: 90, target: 90, unit: "%" }),
    ).toBe("90% (target 90%)");
  });

  it("keeps fractional stay goals readable without rounding stored values", () => {
    const fractional = { ...milestone("reviews"), current: 1 / 3, target: 5 / 3, unit: "reviews" };
    expect(formatMilestoneAmount(fractional)).toBe("0.3333 of 1.6667 reviews");
    expect(fractional.target).toBe(5 / 3);
    expect(formatVolunteerProgressNumber(1234.56789)).toBe("1,234.5679");
    expect(formatVolunteerProgressNumber(15 * (23 / 31))).toBe("11.129");
  });
});
