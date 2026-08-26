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
