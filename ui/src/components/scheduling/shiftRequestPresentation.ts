import type {
  ShiftAssignment,
  ShiftAssignmentSnapshot,
  ShiftAssignmentSnapshotBase,
  ShiftRequest,
  ShiftRequestType,
} from "../../types/scheduling";

export type ShiftRequestAssignmentLike = ShiftAssignment | ShiftAssignmentSnapshot | ShiftAssignmentSnapshotBase;

export const getShiftRequestType = (request: ShiftRequest): ShiftRequestType => request.requestType ?? "swap";

export const getShiftRequestTypeLabel = (requestType: ShiftRequestType): string =>
  requestType === "takeover" ? "Takeover" : requestType === "drop" ? "Drop" : "Swap";

export const getRoleBundleSummary = (request: ShiftRequest): string | null => {
  const bundle = request.assignmentSnapshot?.roleBundle;
  if (!bundle) return null;
  const roles = bundle.roles.map((role) => role[0].toUpperCase() + role.slice(1)).join(" + ");
  if (bundle.salaryPolicy === "takeover_split") {
    return `${roles}: task plans stay with their original owners and both affected Assistant Manager salary days split 50/50.`;
  }
  if (bundle.taskPolicy === "reassign_to_new_manager") {
    return `${roles}: full handover; task plans move to the new Managers and salary is not split.`;
  }
  return `${roles}: Manager assignments, task plans, and Assistant Manager salary remain unchanged.`;
};

export const resolveShiftRequestAssignment = (
  request: ShiftRequest,
  side: "from" | "to" = "from",
): ShiftRequestAssignmentLike | null => {
  const snapshotAssignment = side === "from"
    ? request.assignmentSnapshot ?? null
    : request.assignmentSnapshot?.toAssignment ?? null;
  const isTerminal = request.status === "approved" || request.status === "denied" || request.status === "canceled";
  if (isTerminal && snapshotAssignment) return snapshotAssignment;

  const assignment = side === "from" ? request.fromAssignment : request.toAssignment;
  if (assignment) return assignment;
  return snapshotAssignment;
};

export const getShiftRequestUserName = (
  user: { firstName?: string | null; lastName?: string | null } | null | undefined,
  fallback = "Teammate",
) => `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim() || fallback;

export const canRequestTakeoverAssignment = ({
  assignment,
  currentUserId,
  ownShiftInstanceIds,
  activeRequestAssignmentIds,
  shiftHasStarted,
}: {
  assignment: ShiftAssignment;
  currentUserId: number;
  ownShiftInstanceIds: ReadonlySet<number>;
  activeRequestAssignmentIds: ReadonlySet<number>;
  shiftHasStarted: boolean;
}): boolean =>
  currentUserId > 0 &&
  assignment.userId !== currentUserId &&
  Boolean(assignment.shiftInstance) &&
  !shiftHasStarted &&
  !ownShiftInstanceIds.has(assignment.shiftInstanceId) &&
  !activeRequestAssignmentIds.has(assignment.id);
