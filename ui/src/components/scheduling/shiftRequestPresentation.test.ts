import type { ShiftRequest } from "../../types/scheduling";
import {
  canRequestTakeoverAssignment,
  getShiftRequestType,
  getShiftRequestTypeLabel,
  resolveShiftRequestAssignment,
} from "./shiftRequestPresentation";

const makeRequest = (overrides: Partial<ShiftRequest> = {}): ShiftRequest => ({
  id: 1,
  requestType: "drop",
  fromAssignmentId: null,
  toAssignmentId: null,
  requesterId: 10,
  partnerId: null,
  status: "approved",
  assignmentSnapshot: {
    id: 42,
    shiftInstanceId: 7,
    userId: 10,
    shiftRoleId: 3,
    roleInShift: "guide",
    assignee: { id: 10, firstName: "Jamie", lastName: "Guide" },
    shiftInstance: {
      id: 7,
      date: "2026-08-25",
      timeStart: "21:00",
      timeEnd: "23:00",
      shiftTypeId: 2,
      shiftType: { id: 2, name: "Pub Crawl" },
    },
  },
  ...overrides,
});

describe("shift request presentation", () => {
  it("uses the immutable assignment snapshot after an approved drop deletes the live assignment", () => {
    const assignment = resolveShiftRequestAssignment(makeRequest(), "from");

    expect(assignment?.id).toBe(42);
    expect(assignment?.shiftInstance?.date).toBe("2026-08-25");
    expect(assignment?.shiftInstance?.shiftType?.name).toBe("Pub Crawl");
  });

  it("prefers the live assignment for swaps while it still exists", () => {
    const liveAssignment = {
      id: 99,
      shiftInstanceId: 8,
      userId: 11,
      roleInShift: "leader",
      shiftInstance: {
        id: 8,
        scheduleWeekId: 1,
        shiftTypeId: 2,
        date: "2026-08-26",
        timeStart: "20:00",
      },
    };

    expect(
      resolveShiftRequestAssignment(
        makeRequest({ requestType: "swap", status: "pending_manager", fromAssignment: liveAssignment }),
        "from",
      ),
    ).toBe(liveAssignment);
  });

  it("prefers the immutable snapshot for approved takeover history", () => {
    const reassignedLiveAssignment = {
      id: 42,
      shiftInstanceId: 7,
      userId: 99,
      roleInShift: "guide",
      assignee: { id: 99, firstName: "New", lastName: "Owner" },
    };

    const resolved = resolveShiftRequestAssignment(
      makeRequest({ requestType: "takeover", status: "approved", fromAssignment: reassignedLiveAssignment }),
      "from",
    );

    expect(resolved?.userId).toBe(10);
    expect(resolved?.assignee?.firstName).toBe("Jamie");
  });

  it("uses both immutable snapshot sides for approved swap history", () => {
    const request = makeRequest({ requestType: "swap", status: "approved" });
    const sourceSnapshot = request.assignmentSnapshot!;
    request.assignmentSnapshot = {
      ...sourceSnapshot,
      toAssignment: {
        ...sourceSnapshot,
        id: 43,
        userId: 12,
        assignee: { id: 12, firstName: "Taylor", lastName: "Target" },
      },
    };

    expect(resolveShiftRequestAssignment(request, "from")?.id).toBe(42);
    expect(resolveShiftRequestAssignment(request, "to")?.id).toBe(43);
    expect(resolveShiftRequestAssignment(request, "to")?.assignee?.firstName).toBe("Taylor");
  });

  it("falls back to the target snapshot when a pending swap assignment was deleted", () => {
    const request = makeRequest({ requestType: "swap", status: "pending_partner" });
    const sourceSnapshot = request.assignmentSnapshot!;
    request.assignmentSnapshot = {
      ...sourceSnapshot,
      toAssignment: {
        ...sourceSnapshot,
        id: 43,
        userId: 12,
        assignee: { id: 12, firstName: "Taylor", lastName: "Target" },
      },
    };

    expect(resolveShiftRequestAssignment(request, "to")?.id).toBe(43);
    expect(resolveShiftRequestAssignment(request, "to")?.assignee?.firstName).toBe("Taylor");
  });

  it.each(["denied", "canceled"] as const)("keeps %s request history immutable", (status) => {
    const changedLiveAssignment = {
      id: 42,
      shiftInstanceId: 7,
      userId: 99,
      roleInShift: "manager",
      assignee: { id: 99, firstName: "Changed", lastName: "Owner" },
    };

    const resolved = resolveShiftRequestAssignment(
      makeRequest({ status, fromAssignment: changedLiveAssignment }),
      "from",
    );

    expect(resolved?.userId).toBe(10);
    expect(resolved?.roleInShift).toBe("guide");
  });

  it("provides stable labels for every request type", () => {
    expect(getShiftRequestType(makeRequest({ requestType: "takeover" }))).toBe("takeover");
    expect(getShiftRequestTypeLabel("swap")).toBe("Swap");
    expect(getShiftRequestTypeLabel("takeover")).toBe("Takeover");
    expect(getShiftRequestTypeLabel("drop")).toBe("Drop");
  });

  it("allows a takeover when the requester has no shift to swap", () => {
    const assignment = {
      id: 50,
      shiftInstanceId: 8,
      userId: 11,
      roleInShift: "guide",
      shiftInstance: {
        id: 8,
        scheduleWeekId: 1,
        shiftTypeId: 2,
        date: "2026-08-26",
        timeStart: "20:00",
      },
    };

    expect(
      canRequestTakeoverAssignment({
        assignment,
        currentUserId: 10,
        ownShiftInstanceIds: new Set(),
        activeRequestAssignmentIds: new Set(),
        shiftHasStarted: false,
      }),
    ).toBe(true);
  });

  it("blocks self, started, duplicate, and same-instance takeovers", () => {
    const assignment = {
      id: 50,
      shiftInstanceId: 8,
      userId: 11,
      roleInShift: "guide",
      shiftInstance: {
        id: 8,
        scheduleWeekId: 1,
        shiftTypeId: 2,
        date: "2026-08-26",
        timeStart: "20:00",
      },
    };
    const base = {
      assignment,
      currentUserId: 10,
      ownShiftInstanceIds: new Set<number>(),
      activeRequestAssignmentIds: new Set<number>(),
      shiftHasStarted: false,
    };

    expect(canRequestTakeoverAssignment({ ...base, currentUserId: 11 })).toBe(false);
    expect(canRequestTakeoverAssignment({ ...base, shiftHasStarted: true })).toBe(false);
    expect(canRequestTakeoverAssignment({ ...base, activeRequestAssignmentIds: new Set([50]) })).toBe(false);
    expect(canRequestTakeoverAssignment({ ...base, ownShiftInstanceIds: new Set([8]) })).toBe(false);
  });
});
