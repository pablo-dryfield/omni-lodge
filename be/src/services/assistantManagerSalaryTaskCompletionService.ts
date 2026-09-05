export type AssistantManagerSalaryDailyBase = {
  date: string;
  baseAmount: number;
};

/**
 * A task superseded while moving Social Media publication credit is retained
 * for audit only. It is not an additional obligation and must never affect a
 * compensation numerator or denominator.
 */
export const shouldIncludeAssistantManagerTaskLogInCompensationScore = (
  status: string,
  metaValue: unknown,
): boolean => {
  if (status !== "waived") {
    return true;
  }
  if (!metaValue || typeof metaValue !== "object" || Array.isArray(metaValue)) {
    return true;
  }
  const supersession = (metaValue as Record<string, unknown>)
    .socialMediaPublishSupersession;
  if (!supersession || typeof supersession !== "object" || Array.isArray(supersession)) {
    return true;
  }
  const marker = supersession as Record<string, unknown>;
  return !(
    marker.version === 1
    && Number.isInteger(Number(marker.contentId))
    && Number(marker.contentId) > 0
    && Number.isInteger(Number(marker.supersededByTaskLogId))
    && Number(marker.supersededByTaskLogId) > 0
  );
};

export type AssistantManagerSalaryDailyTaskProgress = {
  totalTasks: number;
  completedTasks: number;
  waivedTasks: number;
  pendingTasks: number;
  missedTasks: number;
  totalPoints: number;
  completedPoints: number;
  waivedPoints: number;
  pendingPoints: number;
  missedPoints: number;
  taskOwnerUserId?: number;
  taskOwnerName?: string;
  attributionMethod?: AssistantManagerSalaryTaskAttributionMethod;
  shiftInstanceIds?: number[];
  attributionWarning?: string;
};

export type AssistantManagerSalaryTaskAttributionMethod =
  | "salary_recipient"
  | "shift_assignment"
  | "shift_instance"
  | "ambiguous";

export type AssistantManagerSalaryTakeoverSplitSettings = {
  enabled: boolean;
  effectiveStart: string | null;
  shiftTakerPercent: number;
};

export type AssistantManagerSalaryTakeoverSplitPolicy = {
  shiftTakerUserId: number;
  shiftTakerName: string;
  taskOwnerUserId: number;
  taskOwnerName: string;
  shiftTakerPercent: number;
  taskOwnerPercent: number;
};

export type AssistantManagerSalaryTakeoverSplit =
  AssistantManagerSalaryTakeoverSplitPolicy & {
    fullDayBaseAmount: number;
    fullDayPayableAmount: number;
    shiftTakerBaseAmount: number;
    shiftTakerPayableAmount: number;
    taskOwnerBaseAmount: number;
    taskOwnerPayableAmount: number;
  };

export type AssistantManagerSalaryTakeoverAllocationRole =
  | "shift_taker"
  | "task_owner";

export type AssistantManagerSalaryDailyBreakdown = {
  date: string;
  baseAmount: number;
  completedPercent: number;
  missingPercent: number;
  deductionAmount: number;
  payableAmount: number;
  totalTasks?: number;
  completedTasks?: number;
  waivedTasks?: number;
  incompleteTasks?: number;
  taskOwnerUserId?: number;
  taskOwnerName?: string;
  attributionMethod?: AssistantManagerSalaryTaskAttributionMethod;
  shiftInstanceIds?: number[];
  attributionWarning?: string;
  takeoverSplitPolicy?: AssistantManagerSalaryTakeoverSplitPolicy;
  takeoverSplit?: AssistantManagerSalaryTakeoverSplit;
  takeoverAllocationRole?: AssistantManagerSalaryTakeoverAllocationRole;
};

const roundPercent = (value: number): number => Math.round(value * 100) / 100;
const toMinor = (value: number): number => Math.round(value * 100);
const toMajor = (value: number): number => value / 100;

/**
 * Allocates a rounded currency total over concrete salary dates without losing
 * cents. Remainder cents are assigned chronologically, so the rows always add
 * back to the exact component amount used by the payout ledger.
 */
export const allocateAssistantManagerSalaryAcrossDays = (
  totalAmount: number,
  dates: string[],
): AssistantManagerSalaryDailyBase[] => {
  if (!Number.isFinite(totalAmount) || dates.length === 0) {
    return [];
  }
  const sortedDates = [...dates].sort((left, right) => left.localeCompare(right));
  const totalMinor = toMinor(totalAmount);
  const sign = totalMinor < 0 ? -1 : 1;
  const absoluteMinor = Math.abs(totalMinor);
  const baseMinor = Math.floor(absoluteMinor / sortedDates.length);
  const remainder = absoluteMinor % sortedDates.length;

  return sortedDates.map((date, index) => ({
    date,
    baseAmount: toMajor(sign * (baseMinor + (index < remainder ? 1 : 0))),
  }));
};

export const partitionAssistantManagerSalaryDaysForTaskProration = (
  dailyBase: AssistantManagerSalaryDailyBase[],
  effectiveStart: string,
): {
  unchangedDailyBase: AssistantManagerSalaryDailyBase[];
  proratedDailyBase: AssistantManagerSalaryDailyBase[];
} => ({
  unchangedDailyBase: dailyBase.filter((day) => day.date < effectiveStart),
  proratedDailyBase: dailyBase.filter((day) => day.date >= effectiveStart),
});

export const calculateAssistantManagerSalaryTaskCompletion = (params: {
  dailyBase: AssistantManagerSalaryDailyBase[];
  progressByDate: ReadonlyMap<string, AssistantManagerSalaryDailyTaskProgress>;
  treatWaivedAsComplete?: boolean;
  treatPendingAsComplete?: boolean;
  salaryRecipientUserId?: number;
  salaryRecipientName?: string;
  takeoverSplit?: AssistantManagerSalaryTakeoverSplitSettings;
}): AssistantManagerSalaryDailyBreakdown[] => {
  const treatWaivedAsComplete = params.treatWaivedAsComplete ?? true;
  const treatPendingAsComplete = params.treatPendingAsComplete ?? false;

  return [...params.dailyBase]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => {
      const baseMinor = toMinor(day.baseAmount);
      const progress = params.progressByDate.get(day.date);
      // A generated/eligible salary day with no applicable task is not a
      // failure. Waived tasks are satisfied in the Task Planner domain, while
      // cancelled/deleted tasks have no log and therefore no denominator.
      const totalPoints = progress && Number.isFinite(progress.totalPoints)
        ? Math.max(progress.totalPoints, 0)
        : 0;
      const completedPoints = totalPoints > 0 && progress
        ? Math.max(
            progress.completedPoints
              + (treatWaivedAsComplete ? progress.waivedPoints : 0)
              + (treatPendingAsComplete ? progress.pendingPoints : 0),
            0,
          )
        : totalPoints;
      const completionRatio = totalPoints > 0
        ? Math.min(completedPoints / totalPoints, 1)
        : 1;
      const payableMinor = Math.round(baseMinor * completionRatio);
      const deductionMinor = baseMinor - payableMinor;
      const completedPercent = roundPercent(completionRatio * 100);
      const splitSettings = params.takeoverSplit;
      const salaryRecipientUserId = params.salaryRecipientUserId;
      const taskOwnerUserId = progress?.taskOwnerUserId;
      const normalizedSalaryRecipientUserId = Number(salaryRecipientUserId);
      const normalizedTaskOwnerUserId = Number(taskOwnerUserId);
      const shiftTakerPercent = Number(splitSettings?.shiftTakerPercent);
      const isTrustedTakeoverAttribution =
        progress?.attributionMethod === "shift_assignment"
        || progress?.attributionMethod === "shift_instance";
      const takeoverSplitPolicy = splitSettings?.enabled
        && splitSettings.effectiveStart
        && day.date >= splitSettings.effectiveStart
        && Number.isInteger(normalizedSalaryRecipientUserId)
        && normalizedSalaryRecipientUserId > 0
        && Number.isInteger(normalizedTaskOwnerUserId)
        && normalizedTaskOwnerUserId > 0
        && normalizedSalaryRecipientUserId !== normalizedTaskOwnerUserId
        && isTrustedTakeoverAttribution
        && !progress?.attributionWarning
        && Number.isFinite(shiftTakerPercent)
        && shiftTakerPercent > 0
        && shiftTakerPercent < 100
        ? {
            shiftTakerUserId: normalizedSalaryRecipientUserId,
            shiftTakerName:
              params.salaryRecipientName?.trim() || `Staff #${normalizedSalaryRecipientUserId}`,
            taskOwnerUserId: normalizedTaskOwnerUserId,
            taskOwnerName:
              progress?.taskOwnerName?.trim() || `Staff #${normalizedTaskOwnerUserId}`,
            shiftTakerPercent,
            taskOwnerPercent: 100 - shiftTakerPercent,
          }
        : undefined;

      return {
        date: day.date,
        baseAmount: toMajor(baseMinor),
        completedPercent,
        missingPercent: roundPercent(100 - completedPercent),
        deductionAmount: toMajor(deductionMinor),
        payableAmount: toMajor(payableMinor),
        totalTasks: progress?.totalTasks ?? 0,
        completedTasks: progress?.completedTasks ?? 0,
        waivedTasks: progress?.waivedTasks ?? 0,
        incompleteTasks: (progress?.pendingTasks ?? 0) + (progress?.missedTasks ?? 0),
        ...(progress?.taskOwnerUserId !== undefined
          ? { taskOwnerUserId: progress.taskOwnerUserId }
          : {}),
        ...(progress?.taskOwnerName ? { taskOwnerName: progress.taskOwnerName } : {}),
        ...(progress?.attributionMethod
          ? { attributionMethod: progress.attributionMethod }
          : {}),
        ...(progress?.shiftInstanceIds && progress.shiftInstanceIds.length > 0
          ? { shiftInstanceIds: [...progress.shiftInstanceIds] }
          : {}),
        ...(progress?.attributionWarning
          ? { attributionWarning: progress.attributionWarning }
          : {}),
        ...(takeoverSplitPolicy ? { takeoverSplitPolicy } : {}),
      };
    });
};

export const mergeAssistantManagerSalaryDailyBreakdowns = (
  rows: AssistantManagerSalaryDailyBreakdown[],
): AssistantManagerSalaryDailyBreakdown[] => {
  type DailyAttribution = Pick<
    AssistantManagerSalaryDailyBreakdown,
    | "taskOwnerUserId"
    | "taskOwnerName"
    | "attributionMethod"
    | "shiftInstanceIds"
    | "attributionWarning"
  >;
  const totalsByDate = new Map<string, {
    baseMinor: number;
    payableMinor: number;
    completionWeightedMinor: number;
    rowCount: number;
    singleRowCounts?: {
      totalTasks: number;
      completedTasks: number;
      waivedTasks: number;
      incompleteTasks: number;
    };
    sharedAttribution?: DailyAttribution;
    sharedAttributionKey?: string;
    attributionConsistent: boolean;
    sharedTakeoverSplitPolicy?: AssistantManagerSalaryTakeoverSplitPolicy;
    sharedTakeoverSplitPolicyKey?: string;
    takeoverSplitPolicyConsistent: boolean;
  }>();
  rows.forEach((row) => {
    const current = totalsByDate.get(row.date) ?? {
      baseMinor: 0,
      payableMinor: 0,
      completionWeightedMinor: 0,
      rowCount: 0,
      attributionConsistent: true,
      takeoverSplitPolicyConsistent: true,
    };
    current.baseMinor += toMinor(row.baseAmount);
    current.payableMinor += toMinor(row.payableAmount);
    current.completionWeightedMinor += toMinor(row.baseAmount) * (row.completedPercent / 100);
    current.rowCount += 1;
    // Counts describe a task set, not money. Multiple salary assignments can
    // select identical, overlapping, or disjoint task sets, and the compact
    // breakdown does not carry task ids with which to union them safely. Keep
    // counts only when the date has one unambiguous calculation row rather
    // than showing a plausible but potentially duplicated total.
    current.singleRowCounts = current.rowCount === 1
      ? {
          totalTasks: row.totalTasks ?? 0,
          completedTasks: row.completedTasks ?? 0,
          waivedTasks: row.waivedTasks ?? 0,
          incompleteTasks: row.incompleteTasks ?? 0,
      }
      : undefined;
    const rowAttribution: DailyAttribution = {
      ...(row.taskOwnerUserId !== undefined
        ? { taskOwnerUserId: row.taskOwnerUserId }
        : {}),
      ...(row.taskOwnerName ? { taskOwnerName: row.taskOwnerName } : {}),
      ...(row.attributionMethod ? { attributionMethod: row.attributionMethod } : {}),
      ...(row.shiftInstanceIds && row.shiftInstanceIds.length > 0
        ? { shiftInstanceIds: [...row.shiftInstanceIds].sort((left, right) => left - right) }
        : {}),
      ...(row.attributionWarning
        ? { attributionWarning: row.attributionWarning }
        : {}),
    };
    const rowAttributionKey = JSON.stringify(rowAttribution);
    if (current.rowCount === 1) {
      current.sharedAttribution = rowAttribution;
      current.sharedAttributionKey = rowAttributionKey;
    } else if (
      current.attributionConsistent
      && current.sharedAttributionKey !== rowAttributionKey
    ) {
      current.attributionConsistent = false;
      current.sharedAttribution = undefined;
    }
    const rowTakeoverSplitPolicyKey = row.takeoverSplitPolicy
      ? JSON.stringify(row.takeoverSplitPolicy)
      : "";
    if (current.rowCount === 1) {
      current.sharedTakeoverSplitPolicy = row.takeoverSplitPolicy;
      current.sharedTakeoverSplitPolicyKey = rowTakeoverSplitPolicyKey;
    } else if (
      current.takeoverSplitPolicyConsistent
      && current.sharedTakeoverSplitPolicyKey !== rowTakeoverSplitPolicyKey
    ) {
      current.takeoverSplitPolicyConsistent = false;
      current.sharedTakeoverSplitPolicy = undefined;
    }
    totalsByDate.set(row.date, current);
  });

  return Array.from(totalsByDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, totals]) => {
      const completionRatio = totals.baseMinor !== 0
        ? Math.min(Math.max(totals.completionWeightedMinor / totals.baseMinor, 0), 1)
        : 1;
      const completedPercent = roundPercent(completionRatio * 100);
      return {
        date,
        baseAmount: toMajor(totals.baseMinor),
        completedPercent,
        missingPercent: roundPercent(100 - completedPercent),
        deductionAmount: toMajor(totals.baseMinor - totals.payableMinor),
        payableAmount: toMajor(totals.payableMinor),
        ...(totals.singleRowCounts ?? {}),
        ...(totals.attributionConsistent ? totals.sharedAttribution ?? {} : {}),
        ...(totals.takeoverSplitPolicyConsistent && totals.sharedTakeoverSplitPolicy
          ? { takeoverSplitPolicy: totals.sharedTakeoverSplitPolicy }
          : {}),
      };
    });
};
