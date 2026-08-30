import { allocateAssistantManagerSalaryTakeoverDay } from "../assistantManagerSalaryTakeoverSplitService.js";
import type { AssistantManagerSalaryDailyBreakdown } from "../assistantManagerSalaryTaskCompletionService.js";

const takeoverRow = (
  overrides: Partial<AssistantManagerSalaryDailyBreakdown> = {},
): AssistantManagerSalaryDailyBreakdown => ({
  date: "2026-08-08",
  baseAmount: 83.33,
  completedPercent: 100,
  missingPercent: 0,
  deductionAmount: 0,
  payableAmount: 83.33,
  taskOwnerUserId: 188,
  taskOwnerName: "Natalie Looper",
  attributionMethod: "shift_instance",
  shiftInstanceIds: [2376],
  takeoverSplitPolicy: {
    shiftTakerUserId: 1,
    shiftTakerName: "Pablo Camacho",
    taskOwnerUserId: 188,
    taskOwnerName: "Natalie Looper",
    shiftTakerPercent: 50,
    taskOwnerPercent: 50,
  },
  ...overrides,
});

describe("Assistant Manager Salary takeover split", () => {
  it("conserves the odd cent when splitting the August 8 salary day", () => {
    const allocated = allocateAssistantManagerSalaryTakeoverDay(takeoverRow());

    expect(allocated?.shiftTakerRow).toMatchObject({
      baseAmount: 41.67,
      payableAmount: 41.67,
      deductionAmount: 0,
      takeoverAllocationRole: "shift_taker",
    });
    expect(allocated?.taskOwnerRow).toMatchObject({
      baseAmount: 41.66,
      payableAmount: 41.66,
      deductionAmount: 0,
      takeoverAllocationRole: "task_owner",
    });
    expect(allocated?.taskOwnerPayableAmount).toBe(41.66);
    expect(
      Math.round((allocated!.shiftTakerRow.payableAmount + allocated!.taskOwnerRow.payableAmount) * 100),
    ).toBe(8_333);

    const natalieExistingSalary = 1_000;
    const pabloSalaryAfterSplit = allocated!.shiftTakerRow.payableAmount;
    const natalieSalaryAfterSplit = natalieExistingSalary
      + allocated!.taskOwnerRow.payableAmount;
    expect(pabloSalaryAfterSplit).toBe(41.67);
    expect(natalieSalaryAfterSplit).toBe(1_041.66);
    expect(Math.round((pabloSalaryAfterSplit + natalieSalaryAfterSplit) * 100))
      .toBe(108_333);
  });

  it("splits the task-adjusted payable pool and its deduction without changing totals", () => {
    const allocated = allocateAssistantManagerSalaryTakeoverDay(takeoverRow({
      baseAmount: 100,
      completedPercent: 83.33,
      missingPercent: 16.67,
      deductionAmount: 16.67,
      payableAmount: 83.33,
    }));

    expect(allocated?.shiftTakerRow).toMatchObject({
      baseAmount: 50,
      payableAmount: 41.67,
      deductionAmount: 8.33,
    });
    expect(allocated?.taskOwnerRow).toMatchObject({
      baseAmount: 50,
      payableAmount: 41.66,
      deductionAmount: 8.34,
    });
    expect(
      Math.round((allocated!.shiftTakerRow.deductionAmount + allocated!.taskOwnerRow.deductionAmount) * 100),
    ).toBe(1_667);
  });

  it("does not allocate a normal salary row without a takeover policy", () => {
    const row = takeoverRow();
    delete row.takeoverSplitPolicy;
    expect(allocateAssistantManagerSalaryTakeoverDay(row)).toBeNull();
  });
});
