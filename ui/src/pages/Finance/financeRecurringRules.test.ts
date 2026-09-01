import type { FinanceRecurringRule } from "../../types/finance";
import {
  buildRecurringRulePayload,
  canToggleRecurringRuleStatus,
  changeDraftFrequency,
  changeDraftStartDate,
  createRecurringRuleDraft,
  describeRecurringSchedule,
  getRecurringRuleLifecycle,
  getRecurringExecutionPresentation,
  projectRecurringRulesMonthly,
  usesMonthDay,
  validateRecurringRuleDraft,
} from "./financeRecurringRules";

const makeRule = (changes: Partial<FinanceRecurringRule> = {}): FinanceRecurringRule => ({
  id: 1,
  kind: "expense",
  templateJson: {
    kind: "expense",
    accountId: 4,
    currency: "PLN",
    amountMinor: 120_00,
    categoryId: 8,
    counterpartyType: "vendor",
    counterpartyId: 10,
    status: "planned",
    description: "Rent",
  },
  frequency: "monthly",
  interval: 1,
  byMonthDay: 5,
  startDate: "2026-09-05",
  endDate: null,
  timezone: "Europe/Warsaw",
  nextRunDate: "2026-09-05T00:00:00.000Z",
  lastRunAt: null,
  status: "active",
  createdBy: 1,
  updatedBy: null,
  createdAt: "2026-08-31T12:00:00.000Z",
  updatedAt: null,
  ...changes,
});

describe("finance recurring rule helpers", () => {
  it("shows a month-day control only for month-based frequencies", () => {
    expect(usesMonthDay("daily")).toBe(false);
    expect(usesMonthDay("weekly")).toBe(false);
    expect(usesMonthDay("monthly")).toBe(true);
    expect(usesMonthDay("quarterly")).toBe(true);
    expect(usesMonthDay("yearly")).toBe(true);
  });

  it("clears irrelevant month-day values when frequency changes", () => {
    const draft = createRecurringRuleDraft(makeRule());
    expect(changeDraftFrequency(draft, "daily").byMonthDay).toBeNull();
    expect(changeDraftFrequency({ ...draft, byMonthDay: null }, "monthly").byMonthDay).toBe(5);
  });

  it("keeps a month-based schedule anchored to a changed start date", () => {
    const draft = createRecurringRuleDraft(makeRule());
    expect(changeDraftStartDate(draft, "2026-09-18").byMonthDay).toBe(18);
  });

  it("describes weekly and yearly anchors accurately", () => {
    expect(describeRecurringSchedule(makeRule({ frequency: "weekly", interval: 2 })))
      .toBe("Every 2 weeks on Saturday");
    expect(describeRecurringSchedule(makeRule({ frequency: "yearly", byMonthDay: 20 })))
      .toBe("Every year in September on day 20");
  });

  it("never sends a month day for daily or weekly rules", () => {
    const draft = {
      ...createRecurringRuleDraft(makeRule()),
      frequency: "daily" as const,
      byMonthDay: 31,
    };
    expect(buildRecurringRulePayload(draft).byMonthDay).toBeNull();
  });

  it("validates end date, timezone, and month day", () => {
    const valid = createRecurringRuleDraft(makeRule());
    expect(validateRecurringRuleDraft(valid)).toBeNull();
    expect(validateRecurringRuleDraft({ ...valid, endDate: "2026-09-01" }))
      .toBe("End date must be on or after the start date.");
    expect(validateRecurringRuleDraft({ ...valid, timezone: "Mars/Olympus" }))
      .toBe("Enter a valid timezone, such as Europe/Warsaw.");
    expect(validateRecurringRuleDraft({ ...valid, byMonthDay: 32 }))
      .toBe("Month day must be between 1 and 31.");
  });

  it("prioritizes failures in the visible lifecycle", () => {
    expect(getRecurringRuleLifecycle(makeRule({ lastError: "Vendor is inactive" }), "2026-08-31"))
      .toEqual({ label: "Needs attention", color: "red" });
    expect(getRecurringRuleLifecycle(makeRule({ status: "paused", lastError: "Old error" }), "2026-08-31"))
      .toEqual({ label: "Paused", color: "gray" });
    expect(getRecurringRuleLifecycle(makeRule({ status: "completed" }), "2026-08-31"))
      .toEqual({ label: "Ended", color: "blue" });
  });

  it("does not offer pause or resume for completed rules", () => {
    expect(canToggleRecurringRuleStatus("active")).toBe(true);
    expect(canToggleRecurringRuleStatus("paused")).toBe(true);
    expect(canToggleRecurringRuleStatus("completed")).toBe(false);
  });

  it("does not present partial failures as a successful run", () => {
    expect(getRecurringExecutionPresentation({
      processed: 3,
      createdTransactions: 2,
      skipped: 0,
      failed: 1,
      completed: 0,
      deferred: 0,
      failures: [{ ruleId: 9, message: "Inactive vendor" }],
    })).toEqual({ color: "orange", title: "Run finished with errors" });
    expect(getRecurringExecutionPresentation({
      processed: 1,
      createdTransactions: 0,
      skipped: 0,
      failed: 1,
      completed: 0,
      deferred: 0,
      failures: [{ ruleId: 9, message: "Inactive vendor" }],
    })).toEqual({ color: "red", title: "Run finished with errors" });
  });

  it("warns when catch-up work remains", () => {
    expect(getRecurringExecutionPresentation({
      processed: 1,
      createdTransactions: 12,
      skipped: 0,
      failed: 0,
      completed: 0,
      deferred: 1,
      failures: [],
    })).toEqual({ color: "orange", title: "More catch-up remains" });
  });

  it("projects active rules monthly without mixing currencies or kinds", () => {
    const projection = projectRecurringRulesMonthly([
      makeRule({
        id: 1,
        kind: "expense",
        frequency: "monthly",
        templateJson: { ...makeRule().templateJson, currency: "PLN", amountMinor: 100_00 },
      }),
      makeRule({
        id: 2,
        kind: "income",
        frequency: "yearly",
        templateJson: { ...makeRule().templateJson, currency: "PLN", amountMinor: 1200_00 },
      }),
      makeRule({
        id: 3,
        frequency: "monthly",
        templateJson: { ...makeRule().templateJson, currency: "EUR", amountMinor: 50_00 },
      }),
      makeRule({
        id: 4,
        status: "paused",
        templateJson: { ...makeRule().templateJson, currency: "PLN", amountMinor: 999_00 },
      }),
    ]);

    expect(projection).toEqual({
      PLN: { expenseMinor: 100_00, incomeMinor: 100_00 },
      EUR: { expenseMinor: 50_00, incomeMinor: 0 },
    });
  });
});
