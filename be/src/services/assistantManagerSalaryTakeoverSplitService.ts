import type {
  AssistantManagerSalaryDailyBreakdown,
  AssistantManagerSalaryTakeoverSplit,
} from "./assistantManagerSalaryTaskCompletionService.js";

export type AssistantManagerSalaryTakeoverAllocatedRows = {
  shiftTakerRow: AssistantManagerSalaryDailyBreakdown;
  taskOwnerRow: AssistantManagerSalaryDailyBreakdown;
  taskOwnerPayableAmount: number;
};

const toMinor = (value: number): number => Math.round(value * 100);
const toMajor = (value: number): number => value / 100;

const splitMinor = (
  totalMinor: number,
  firstPercent: number,
): { firstMinor: number; secondMinor: number } => {
  const firstMinor = Math.min(
    Math.max(Math.round(totalMinor * (firstPercent / 100)), 0),
    totalMinor,
  );
  return { firstMinor, secondMinor: totalMinor - firstMinor };
};

/**
 * Splits one already task-adjusted salary day in integer minor units. The
 * shift taker is the first recipient, so an unavoidable odd remainder cent
 * follows the same deterministic first-recipient convention used elsewhere
 * in payroll. The two rows always add back to the original row exactly.
 */
export const allocateAssistantManagerSalaryTakeoverDay = (
  row: AssistantManagerSalaryDailyBreakdown,
): AssistantManagerSalaryTakeoverAllocatedRows | null => {
  const policy = row.takeoverSplitPolicy;
  const baseMinor = toMinor(row.baseAmount);
  const payableMinor = toMinor(row.payableAmount);
  if (
    !policy
    || policy.shiftTakerUserId === policy.taskOwnerUserId
    || !Number.isFinite(policy.shiftTakerPercent)
    || policy.shiftTakerPercent <= 0
    || policy.shiftTakerPercent >= 100
    || baseMinor < 0
    || payableMinor < 0
    || payableMinor > baseMinor
  ) {
    return null;
  }

  const baseSplit = splitMinor(baseMinor, policy.shiftTakerPercent);
  const payableSplit = splitMinor(payableMinor, policy.shiftTakerPercent);
  const takeoverSplit: AssistantManagerSalaryTakeoverSplit = {
    ...policy,
    fullDayBaseAmount: toMajor(baseMinor),
    fullDayPayableAmount: toMajor(payableMinor),
    shiftTakerBaseAmount: toMajor(baseSplit.firstMinor),
    shiftTakerPayableAmount: toMajor(payableSplit.firstMinor),
    taskOwnerBaseAmount: toMajor(baseSplit.secondMinor),
    taskOwnerPayableAmount: toMajor(payableSplit.secondMinor),
  };
  const { takeoverSplitPolicy: _policy, ...sharedRow } = row;
  const shiftTakerRow: AssistantManagerSalaryDailyBreakdown = {
    ...sharedRow,
    baseAmount: takeoverSplit.shiftTakerBaseAmount,
    deductionAmount: toMajor(baseSplit.firstMinor - payableSplit.firstMinor),
    payableAmount: takeoverSplit.shiftTakerPayableAmount,
    takeoverSplit,
    takeoverAllocationRole: "shift_taker",
  };
  const taskOwnerRow: AssistantManagerSalaryDailyBreakdown = {
    ...sharedRow,
    baseAmount: takeoverSplit.taskOwnerBaseAmount,
    deductionAmount: toMajor(baseSplit.secondMinor - payableSplit.secondMinor),
    payableAmount: takeoverSplit.taskOwnerPayableAmount,
    takeoverSplit,
    takeoverAllocationRole: "task_owner",
  };

  return {
    shiftTakerRow,
    taskOwnerRow,
    taskOwnerPayableAmount: takeoverSplit.taskOwnerPayableAmount,
  };
};
