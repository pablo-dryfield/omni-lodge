import {
  resolveAssistantManagerSalaryTaskProgress,
  type AssistantManagerSalaryLinkedTaskSet,
} from "../assistantManagerSalaryTaskAttributionService.js";
import type { AssistantManagerSalaryDailyTaskProgress } from "../assistantManagerSalaryTaskCompletionService.js";

const progress = (
  completedTasks: number,
  totalTasks: number,
): AssistantManagerSalaryDailyTaskProgress => ({
  totalTasks,
  completedTasks,
  waivedTasks: 0,
  pendingTasks: totalTasks - completedTasks,
  missedTasks: 0,
  totalPoints: totalTasks * 2,
  completedPoints: completedTasks * 2,
  waivedPoints: 0,
  pendingPoints: (totalTasks - completedTasks) * 2,
  missedPoints: 0,
});

const linkedTaskSet = (
  overrides: Partial<AssistantManagerSalaryLinkedTaskSet> = {},
): AssistantManagerSalaryLinkedTaskSet => ({
  taskOwnerUserId: 188,
  taskOwnerName: "Natalie Looper",
  shiftInstanceId: 2376,
  shiftAssignmentIds: [2656],
  progress: progress(11, 11),
  ...overrides,
});

describe("Assistant Manager Salary shift task attribution", () => {
  it("keeps the original owner auditable when an approved takeover has no task logs", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2656] }],
      linkedTaskSets: [],
      approvedTakeovers: [{
        originalOwnerUserId: 188,
        originalOwnerName: "Natalie Looper",
        shiftInstanceId: 2376,
        shiftAssignmentId: 2656,
      }],
    })).toMatchObject({
      taskOwnerUserId: 188,
      taskOwnerName: "Natalie Looper",
      attributionMethod: "shift_assignment",
      shiftInstanceIds: [2376],
      totalTasks: 0,
      completedTasks: 0,
      totalPoints: 0,
      completedPoints: 0,
    });
  });

  it("lets an approved takeover override the salary recipient's unrelated own progress", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      ownProgress: progress(4, 4),
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2656] }],
      linkedTaskSets: [linkedTaskSet({ progress: progress(7, 11) })],
      approvedTakeovers: [{
        originalOwnerUserId: 188,
        originalOwnerName: "Natalie Looper",
        shiftInstanceId: 2376,
        shiftAssignmentId: 2656,
      }],
    })).toMatchObject({
      taskOwnerUserId: 188,
      taskOwnerName: "Natalie Looper",
      attributionMethod: "shift_assignment",
      shiftInstanceIds: [2376],
      totalTasks: 11,
      completedTasks: 7,
      totalPoints: 22,
      completedPoints: 14,
    });
  });

  it("does not auto-attribute approved takeovers with distinct original owners on one day", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      ownProgress: progress(4, 4),
      managerShifts: [
        { shiftInstanceId: 2376, shiftAssignmentIds: [2656] },
        { shiftInstanceId: 3000, shiftAssignmentIds: [3001] },
      ],
      linkedTaskSets: [],
      approvedTakeovers: [
        {
          originalOwnerUserId: 188,
          originalOwnerName: "Natalie Looper",
          shiftInstanceId: 2376,
          shiftAssignmentId: 2656,
        },
        {
          originalOwnerUserId: 191,
          originalOwnerName: "Jamie Felton",
          shiftInstanceId: 3000,
          shiftAssignmentId: 3001,
        },
      ],
    })).toMatchObject({
      attributionMethod: "ambiguous",
      shiftInstanceIds: [2376, 3000],
      totalTasks: 0,
      totalPoints: 0,
      attributionWarning: expect.stringContaining("No salary split"),
    });
  });

  it("ignores a non-manager takeover when the requester separately manages the same shift", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      ownProgress: progress(4, 4),
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2656] }],
      linkedTaskSets: [linkedTaskSet({
        shiftAssignmentIds: [3001],
        progress: progress(0, 11),
      })],
      approvedTakeovers: [{
        originalOwnerUserId: 188,
        originalOwnerName: "Natalie Looper",
        shiftInstanceId: 2376,
        shiftAssignmentId: 3001,
        originalRoleInShift: "Guide",
      }],
    })).toMatchObject({
      taskOwnerUserId: 1,
      attributionMethod: "salary_recipient",
      completedTasks: 4,
      totalTasks: 4,
    });
  });

  it("uses the original owner's task plan after a modern takeover preserves the assignment id", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      // An unrelated personal plan on the same date must not override the
      // task set linked to the salary shift.
      ownProgress: progress(0, 11),
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2656] }],
      linkedTaskSets: [linkedTaskSet()],
    })).toMatchObject({
      taskOwnerUserId: 188,
      taskOwnerName: "Natalie Looper",
      attributionMethod: "shift_assignment",
      shiftInstanceIds: [2376],
      completedTasks: 11,
      totalTasks: 11,
      completedPoints: 22,
      totalPoints: 22,
    });
  });

  it("covers the August 8 legacy replacement through the shared shift instance", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2724] }],
      linkedTaskSets: [linkedTaskSet()],
    })).toMatchObject({
      taskOwnerUserId: 188,
      attributionMethod: "shift_instance",
      shiftInstanceIds: [2376],
      completedPoints: 22,
      totalPoints: 22,
    });
  });

  it("resolves exact and legacy task links independently across two manager shifts", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      managerShifts: [
        { shiftInstanceId: 2376, shiftAssignmentIds: [2656] },
        { shiftInstanceId: 3000, shiftAssignmentIds: [3002] },
      ],
      linkedTaskSets: [
        linkedTaskSet({ progress: progress(2, 2) }),
        linkedTaskSet({
          shiftInstanceId: 3000,
          shiftAssignmentIds: [3001],
          progress: progress(3, 3),
        }),
      ],
    })).toMatchObject({
      taskOwnerUserId: 188,
      attributionMethod: "shift_instance",
      shiftInstanceIds: [2376, 3000],
      completedTasks: 5,
      totalTasks: 5,
      completedPoints: 10,
      totalPoints: 10,
    });
  });

  it("does not borrow another staff member's unrelated tasks from the same date", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2724] }],
      linkedTaskSets: [linkedTaskSet({ shiftInstanceId: 9999 })],
    })).toBeUndefined();
  });

  it("uses the salary recipient's own daily plan when no shift-linked set exists", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      ownProgress: progress(3, 4),
      managerShifts: [],
      linkedTaskSets: [],
    })).toMatchObject({
      taskOwnerUserId: 1,
      taskOwnerName: "Pablo Camacho",
      attributionMethod: "salary_recipient",
      completedTasks: 3,
      totalTasks: 4,
    });
  });

  it("keeps all of the recipient's daily tasks when their own shift plan is linked", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      ownProgress: progress(3, 4),
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2724] }],
      linkedTaskSets: [linkedTaskSet({
        taskOwnerUserId: 1,
        taskOwnerName: "Pablo Camacho",
        shiftAssignmentIds: [2724],
        progress: progress(2, 2),
      })],
    })).toMatchObject({
      taskOwnerUserId: 1,
      attributionMethod: "salary_recipient",
      completedTasks: 3,
      totalTasks: 4,
    });
  });

  it("prefers the recipient's own plan when only the weaker shift-instance match has several owners", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      ownProgress: progress(3, 4),
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2724] }],
      linkedTaskSets: [
        linkedTaskSet(),
        linkedTaskSet({
          taskOwnerUserId: 1,
          taskOwnerName: "Pablo Camacho",
          shiftAssignmentIds: [2726],
          progress: progress(3, 4),
        }),
      ],
    })).toMatchObject({
      taskOwnerUserId: 1,
      attributionMethod: "salary_recipient",
      completedTasks: 3,
      totalTasks: 4,
    });
  });

  it("does not guess or deduct when multiple task owners match one manager shift", () => {
    expect(resolveAssistantManagerSalaryTaskProgress({
      salaryRecipientUserId: 1,
      salaryRecipientName: "Pablo Camacho",
      managerShifts: [{ shiftInstanceId: 2376, shiftAssignmentIds: [2656] }],
      linkedTaskSets: [
        linkedTaskSet(),
        linkedTaskSet({
          taskOwnerUserId: 1,
          taskOwnerName: "Pablo Camacho",
          progress: progress(0, 11),
        }),
      ],
    })).toMatchObject({
      attributionMethod: "ambiguous",
      totalPoints: 0,
      shiftInstanceIds: [2376],
      attributionWarning: expect.stringContaining("No task deduction"),
    });
  });
});
