import type {
  AssistantManagerSalaryDailyTaskProgress,
  AssistantManagerSalaryTaskAttributionMethod,
} from "./assistantManagerSalaryTaskCompletionService.js";

export type AssistantManagerSalaryManagerShift = {
  shiftInstanceId: number;
  shiftAssignmentIds: number[];
};

export type AssistantManagerSalaryLinkedTaskSet = {
  taskOwnerUserId: number;
  taskOwnerName: string;
  shiftInstanceId: number;
  shiftAssignmentIds: number[];
  progress: AssistantManagerSalaryDailyTaskProgress;
};

export type AssistantManagerSalaryApprovedTakeover = {
  originalOwnerUserId: number;
  originalOwnerName: string;
  shiftInstanceId: number;
  shiftAssignmentId: number | null;
  originalRoleInShift?: string | null;
};

type ResolveAssistantManagerSalaryTaskProgressParams = {
  salaryRecipientUserId: number;
  salaryRecipientName: string;
  ownProgress?: AssistantManagerSalaryDailyTaskProgress;
  managerShifts: AssistantManagerSalaryManagerShift[];
  linkedTaskSets: AssistantManagerSalaryLinkedTaskSet[];
  approvedTakeovers?: AssistantManagerSalaryApprovedTakeover[];
};

const PROGRESS_NUMBER_KEYS = [
  "totalTasks",
  "completedTasks",
  "waivedTasks",
  "pendingTasks",
  "missedTasks",
  "totalPoints",
  "completedPoints",
  "waivedPoints",
  "pendingPoints",
  "missedPoints",
] as const satisfies ReadonlyArray<keyof AssistantManagerSalaryDailyTaskProgress>;

const normalizePositiveInteger = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;

const uniquePositiveIntegers = (values: Iterable<number>): number[] =>
  Array.from(new Set(Array.from(values, normalizePositiveInteger).filter(
    (value): value is number => value !== null,
  ))).sort((left, right) => left - right);

const isManagerRole = (value: string | null | undefined): boolean => {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  return ["manager", "assistant_manager", "assistantmanager"].includes(normalized);
};

const addProgress = (
  taskSets: AssistantManagerSalaryLinkedTaskSet[],
): AssistantManagerSalaryDailyTaskProgress => {
  const aggregate: AssistantManagerSalaryDailyTaskProgress = {
    totalTasks: 0,
    completedTasks: 0,
    waivedTasks: 0,
    pendingTasks: 0,
    missedTasks: 0,
    totalPoints: 0,
    completedPoints: 0,
    waivedPoints: 0,
    pendingPoints: 0,
    missedPoints: 0,
  };
  taskSets.forEach((taskSet) => {
    PROGRESS_NUMBER_KEYS.forEach((key) => {
      aggregate[key] += Number(taskSet.progress[key]) || 0;
    });
  });
  return aggregate;
};

const resolveLinkedTaskSets = (
  taskSets: AssistantManagerSalaryLinkedTaskSet[],
  method: Exclude<AssistantManagerSalaryTaskAttributionMethod, "salary_recipient" | "ambiguous">,
): AssistantManagerSalaryDailyTaskProgress | undefined => {
  if (taskSets.length === 0) {
    return undefined;
  }

  const owners = new Map<number, AssistantManagerSalaryLinkedTaskSet[]>();
  taskSets.forEach((taskSet) => {
    const ownerSets = owners.get(taskSet.taskOwnerUserId) ?? [];
    ownerSets.push(taskSet);
    owners.set(taskSet.taskOwnerUserId, ownerSets);
  });
  const shiftInstanceIds = uniquePositiveIntegers(
    taskSets.map((taskSet) => taskSet.shiftInstanceId),
  );

  if (owners.size !== 1) {
    return {
      totalTasks: 0,
      completedTasks: 0,
      waivedTasks: 0,
      pendingTasks: 0,
      missedTasks: 0,
      totalPoints: 0,
      completedPoints: 0,
      waivedPoints: 0,
      pendingPoints: 0,
      missedPoints: 0,
      attributionMethod: "ambiguous",
      shiftInstanceIds,
      attributionWarning:
        "Multiple task owners are linked to this manager shift. No task deduction was applied automatically.",
    };
  }

  const [taskOwnerUserId, ownerTaskSets] = Array.from(owners.entries())[0];
  const taskOwnerName = ownerTaskSets.find((taskSet) => taskSet.taskOwnerName.trim())
    ?.taskOwnerName.trim() || `Staff #${taskOwnerUserId}`;
  return {
    ...addProgress(ownerTaskSets),
    taskOwnerUserId,
    taskOwnerName,
    attributionMethod: method,
    shiftInstanceIds,
  };
};

/**
 * Resolves the Task Planner set that controls one manager salary day.
 *
 * Shift-linked logs take priority because takeovers deliberately leave task
 * ownership with the person whose plan/evidence was completed. An approved
 * takeover keeps the assignment id; historical manual replacements can still
 * be matched by the shared shift instance id. A date-only cross-staff match is
 * never allowed.
 */
export const resolveAssistantManagerSalaryTaskProgress = (
  params: ResolveAssistantManagerSalaryTaskProgressParams,
): AssistantManagerSalaryDailyTaskProgress | undefined => {
  const ownProgressWithAttribution = ():
    AssistantManagerSalaryDailyTaskProgress | undefined => {
    if (!params.ownProgress) {
      return undefined;
    }
    return {
      ...params.ownProgress,
      taskOwnerUserId: params.salaryRecipientUserId,
      taskOwnerName:
        params.salaryRecipientName.trim() || `Staff #${params.salaryRecipientUserId}`,
      attributionMethod: "salary_recipient",
    };
  };

  const managerShiftsByInstance = new Map<number, Set<number>>();
  params.managerShifts.forEach((shift) => {
    const shiftInstanceId = normalizePositiveInteger(shift.shiftInstanceId);
    if (!shiftInstanceId) {
      return;
    }
    const assignmentIds = managerShiftsByInstance.get(shiftInstanceId) ?? new Set<number>();
    uniquePositiveIntegers(shift.shiftAssignmentIds).forEach((assignmentId) =>
      assignmentIds.add(assignmentId),
    );
    managerShiftsByInstance.set(shiftInstanceId, assignmentIds);
  });

  const recordedTakeovers = params.approvedTakeovers ?? [];
  const sameInstanceTakeovers = recordedTakeovers.filter((takeover) =>
    managerShiftsByInstance.has(takeover.shiftInstanceId),
  );
  const approvedTakeovers = sameInstanceTakeovers.filter((takeover) => {
    const managerAssignmentIds = managerShiftsByInstance.get(takeover.shiftInstanceId);
    if (!managerAssignmentIds) {
      return false;
    }
    const takeoverAssignmentId = takeover.shiftAssignmentId == null
      ? null
      : normalizePositiveInteger(takeover.shiftAssignmentId);
    return takeoverAssignmentId
      ? managerAssignmentIds.has(takeoverAssignmentId)
      : isManagerRole(takeover.originalRoleInShift);
  });
  if (sameInstanceTakeovers.length > 0 && approvedTakeovers.length === 0) {
    // An explicit takeover exists for this person/date, but it was not one of
    // the manager assignments that earns this salary. Do not let the weaker
    // historical shift-instance fallback reinterpret that unrelated role.
    return ownProgressWithAttribution();
  }
  if (approvedTakeovers.length > 0) {
    const originalOwners = new Map<number, AssistantManagerSalaryApprovedTakeover[]>();
    approvedTakeovers.forEach((takeover) => {
      const ownerTakeovers = originalOwners.get(takeover.originalOwnerUserId) ?? [];
      ownerTakeovers.push(takeover);
      originalOwners.set(takeover.originalOwnerUserId, ownerTakeovers);
    });
    const takeoverShiftInstanceIds = uniquePositiveIntegers(
      approvedTakeovers.map((takeover) => takeover.shiftInstanceId),
    );
    if (originalOwners.size !== 1) {
      return {
        totalTasks: 0,
        completedTasks: 0,
        waivedTasks: 0,
        pendingTasks: 0,
        missedTasks: 0,
        totalPoints: 0,
        completedPoints: 0,
        waivedPoints: 0,
        pendingPoints: 0,
        missedPoints: 0,
        attributionMethod: "ambiguous",
        shiftInstanceIds: takeoverShiftInstanceIds,
        attributionWarning:
          "Multiple original owners are linked to approved takeovers on this salary day. No salary split was applied automatically.",
      };
    }

    const [originalOwnerUserId, ownerTakeovers] = Array.from(originalOwners.entries())[0];
    const originalOwnerName = ownerTakeovers.find(
      (takeover) => takeover.originalOwnerName.trim(),
    )?.originalOwnerName.trim() || `Staff #${originalOwnerUserId}`;
    const selectedOwnerTaskSet = new Set<AssistantManagerSalaryLinkedTaskSet>();
    let usedTakeoverInstanceFallback = false;
    let hasTakeoverAssignmentId = false;
    ownerTakeovers.forEach((takeover) => {
      const instanceTaskSets = params.linkedTaskSets.filter(
        (taskSet) =>
          taskSet.taskOwnerUserId === originalOwnerUserId
          && taskSet.shiftInstanceId === takeover.shiftInstanceId,
      );
      const assignmentId = takeover.shiftAssignmentId;
      const exactTaskSets = assignmentId
        ? instanceTaskSets.filter((taskSet) =>
            taskSet.shiftAssignmentIds.includes(assignmentId),
          )
        : [];
      if (assignmentId) {
        hasTakeoverAssignmentId = true;
      }
      if (exactTaskSets.length > 0) {
        exactTaskSets.forEach((taskSet) => selectedOwnerTaskSet.add(taskSet));
      } else {
        if (instanceTaskSets.length > 0) {
          usedTakeoverInstanceFallback = true;
        }
        instanceTaskSets.forEach((taskSet) => selectedOwnerTaskSet.add(taskSet));
      }
    });
    const selectedOwnerTaskSets = Array.from(selectedOwnerTaskSet);
    const attributedOwnerProgress = resolveLinkedTaskSets(
      selectedOwnerTaskSets,
      usedTakeoverInstanceFallback ? "shift_instance" : "shift_assignment",
    );
    if (attributedOwnerProgress) {
      return attributedOwnerProgress;
    }
    // An approved takeover remains authoritative even when no task was
    // generated. The existing no-task rule treats that day as satisfied, and
    // the alternate owner metadata still enables the configured 50/50 split.
    return {
      totalTasks: 0,
      completedTasks: 0,
      waivedTasks: 0,
      pendingTasks: 0,
      missedTasks: 0,
      totalPoints: 0,
      completedPoints: 0,
      waivedPoints: 0,
      pendingPoints: 0,
      missedPoints: 0,
      taskOwnerUserId: originalOwnerUserId,
      taskOwnerName: originalOwnerName,
      attributionMethod:
        hasTakeoverAssignmentId ? "shift_assignment" : "shift_instance",
      shiftInstanceIds: takeoverShiftInstanceIds,
    };
  }

  const selectedTaskSets = new Set<AssistantManagerSalaryLinkedTaskSet>();
  let usedShiftInstanceFallback = false;
  let exactAssignmentConflict = false;
  managerShiftsByInstance.forEach((managerAssignmentIds, shiftInstanceId) => {
    const instanceTaskSets = params.linkedTaskSets.filter(
      (taskSet) => taskSet.shiftInstanceId === shiftInstanceId,
    );
    const assignmentMatches = instanceTaskSets.filter((taskSet) =>
      taskSet.shiftAssignmentIds.some((assignmentId) => managerAssignmentIds.has(assignmentId)),
    );
    if (assignmentMatches.length > 0) {
      if (new Set(assignmentMatches.map((taskSet) => taskSet.taskOwnerUserId)).size > 1) {
        exactAssignmentConflict = true;
      }
      assignmentMatches.forEach((taskSet) => selectedTaskSets.add(taskSet));
      return;
    }
    if (instanceTaskSets.length > 0) {
      usedShiftInstanceFallback = true;
      instanceTaskSets.forEach((taskSet) => selectedTaskSets.add(taskSet));
    }
  });

  const selected = Array.from(selectedTaskSets);
  if (selected.length === 0) {
    return ownProgressWithAttribution();
  }

  const everySelectedOwnerIsRecipient = selected.every(
    (taskSet) => taskSet.taskOwnerUserId === params.salaryRecipientUserId,
  );
  const recipientAppearsInSelected = selected.some(
    (taskSet) => taskSet.taskOwnerUserId === params.salaryRecipientUserId,
  );
  // The instance-only fallback is intentionally weaker. For one normal shift,
  // prefer the recipient's complete day plan if it is among several task sets.
  // Exact assignment conflicts remain ambiguous because they commonly mean a
  // takeover plan was regenerated for both the old and new owner.
  const preferOwnProgress = everySelectedOwnerIsRecipient || (
    managerShiftsByInstance.size === 1
    && usedShiftInstanceFallback
    && recipientAppearsInSelected
    && !exactAssignmentConflict
  );
  if (preferOwnProgress) {
    const ownProgress = ownProgressWithAttribution();
    if (ownProgress) {
      return ownProgress;
    }
  }

  return resolveLinkedTaskSets(
    selected,
    usedShiftInstanceFallback ? "shift_instance" : "shift_assignment",
  );
};
