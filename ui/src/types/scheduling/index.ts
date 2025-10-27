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

export interface ShiftTemplateRoleRequirement {
  role: string;
  required: number | null;
}

export interface ShiftTemplate {
  id: number;
  shiftTypeId: number;
  name: string;
  defaultStartTime: string | null;
  defaultEndTime: string | null;
  defaultCapacity: number | null;
  requiresLeader: boolean;
  defaultRoles: ShiftTemplateRoleRequirement[] | null;
  defaultMeta: Record<string, unknown> | null;
}

export interface ShiftType {
  id: number;
  key: string;
  name: string;
  description?: string | null;
}

export interface ShiftAssignment {
  id: number;
  shiftInstanceId: number;
  userId: number;
  roleInShift: string;
  assignee?: {
    id: number;
    firstName: string;
    lastName: string;
  };
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
  requiredRoles?: ShiftTemplateRoleRequirement[] | null;
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

export interface SwapRequest {
  id: number;
  fromAssignmentId: number;
  toAssignmentId: number;
  requesterId: number;
  partnerId: number;
  status: 'pending_partner' | 'pending_manager' | 'approved' | 'denied' | 'canceled';
  decisionReason?: string | null;
  managerId?: number | null;
  createdAt?: string;
}

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
  requiredRoles?: ShiftTemplateRoleRequirement[] | null;
  shiftTemplateId?: number | null;
}

export interface ReportsQuery {
  from: string;
  to: string;
  userId?: number;
}
