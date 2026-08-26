export type ScheduleWeekState = 'collecting' | 'locked' | 'assigned' | 'published';

export interface ScheduleWeek {
  id: number;
  year: number;
  isoWeek: number;
  tz: string;
  state: ScheduleWeekState;
}

export interface ScheduleTotals {
  shiftInstances: number;
  assignments: number;
  volunteersWithTooFew: number;
  volunteersWithTooMany: number;
  pendingSwaps: number;
}

export interface ScheduleViolation {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  meta?: Record<string, unknown>;
}

export interface ScheduleWeekSummary {
  week: ScheduleWeek;
  totals: ScheduleTotals;
  violations: ScheduleViolation[];
}

export interface ShiftRoleRequirement {
  shiftRoleId?: number | null;
  role: string;
  required: number | null;
}

export interface ShiftTemplateRoleRequirement extends ShiftRoleRequirement {}

export interface ShiftTemplate {
  id: number;
  shiftTypeId: number;
  name: string;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  defaultCapacity: number | null;
  requiresLeader: boolean;
  defaultRoles: ShiftTemplateRoleRequirement[] | null;
  repeatOn: number[] | null;
  managerCoversTeam: boolean;
  defaultMeta: Record<string, unknown> | null;
}

export interface ShiftType {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  productIds?: number[];
}

export interface ShiftAssignment {
  id: number;
  shiftInstanceId: number;
  userId: number;
  roleInShift: string;
  shiftRoleId?: number | null;
  assignee?: {
    id: number;
    firstName: string;
    lastName: string;
    profilePhotoPath?: string | null;
    profilePhotoUrl?: string | null;
    updatedAt?: string | null;
    staffProfile?: {
      staffType: string | null;
    } | null;
    userShiftRoles?: Array<{
      staffType?: string | null;
    }> | null;
  };
  shiftRole?: {
    id: number;
    name: string;
  } | null;
  shiftInstance?: ShiftInstance;
}

export interface ShiftInstance {
  id: number;
  scheduleWeekId: number;
  shiftTypeId: number;
  shiftTemplateId?: number | null;
  date: string;
  timeStart: string;
  timeEnd?: string | null;
  capacity?: number | null;
  requiredRoles?: ShiftRoleRequirement[] | null;
  meta?: Record<string, unknown> | null;
  shiftType?: ShiftType;
  template?: ShiftTemplate | null;
  assignments?: ShiftAssignment[];
}

export interface AvailabilityEntry {
  id?: number;
  userId: number;
  scheduleWeekId: number;
  day: string;
  startTime?: string | null;
  endTime?: string | null;
  shiftTypeId?: number | null;
  status: 'available' | 'unavailable';
}

export type ShiftRequestType = 'swap' | 'takeover' | 'drop';

export type ShiftRequestStatus = 'pending_partner' | 'pending_manager' | 'approved' | 'denied' | 'canceled';

export interface ShiftAssignmentSnapshotBase {
  id: number;
  shiftInstanceId: number;
  userId: number;
  shiftRoleId: number | null;
  roleInShift: string;
  assignee: {
    id: number;
    firstName: string | null;
    lastName: string | null;
  } | null;
  shiftInstance: {
    id: number;
    date: string;
    timeStart: string;
    timeEnd: string | null;
    shiftTypeId: number;
    shiftType: {
      id: number;
      name: string;
    } | null;
  } | null;
}

export interface ShiftAssignmentSnapshot extends ShiftAssignmentSnapshotBase {
  toAssignment?: ShiftAssignmentSnapshotBase | null;
}

export interface ShiftRequest {
  id: number;
  requestType: ShiftRequestType;
  fromAssignmentId: number | null;
  toAssignmentId: number | null;
  requesterId: number;
  partnerId: number | null;
  status: ShiftRequestStatus;
  requestNote?: string | null;
  partnerResponseNote?: string | null;
  decisionReason?: string | null;
  managerId?: number | null;
  createdAt?: string;
  fromAssignment?: ShiftAssignment | null;
  toAssignment?: ShiftAssignment | null;
  requester?: {
    id: number;
    firstName: string;
    lastName: string;
  } | null;
  partner?: {
    id: number;
    firstName: string;
    lastName: string;
  } | null;
  manager?: {
    id: number;
    firstName: string;
    lastName: string;
  } | null;
  assignmentSnapshot?: ShiftAssignmentSnapshot | null;
}

/** @deprecated Prefer ShiftRequest. Retained while legacy swap call sites migrate. */
export type SwapRequest = ShiftRequest;

export interface ScheduleExport {
  id: number;
  scheduleWeekId: number;
  driveFileId: string;
  url: string;
  createdAt: string;
}

export interface AssignmentInput {
  shiftInstanceId: number;
  userId: number;
  roleInShift: string;
  shiftRoleId?: number | null;
  overrideReason?: string;
}

export interface AvailabilityPayload {
  scheduleWeekId: number;
  entries: Array<{
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    shiftTypeId?: number | null;
    status: 'available' | 'unavailable';
  }>;
}

export interface ShiftInstancePayload {
  scheduleWeekId: number;
  shiftTypeId: number;
  date: string;
  timeStart: string;
  timeEnd?: string | null;
  capacity?: number | null;
  meta?: Record<string, unknown> | null;
  requiredRoles?: ShiftRoleRequirement[] | null;
  shiftTemplateId?: number | null;
}

export interface ReportsQuery {
  from: string;
  to: string;
  userId?: number;
}
