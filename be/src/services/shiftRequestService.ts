import { Op, type Transaction } from 'sequelize';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import AuditLog from '../models/AuditLog.js';
import RequiredAction from '../models/RequiredAction.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftRole from '../models/ShiftRole.js';
import ShiftType from '../models/ShiftType.js';
import StaffProfile from '../models/StaffProfile.js';
import SwapRequest, {
  type ShiftAssignmentSnapshot,
  type ShiftRequestType,
  type SwapRequestStatus,
} from '../models/SwapRequest.js';
import User from '../models/User.js';
import UserShiftRole from '../models/UserShiftRole.js';
import logger from '../utils/logger.js';
import { getConfigValue } from './configService.js';
import { sendSchedulingNotification } from './notificationService.js';
import { buildAssignmentInclude, buildRequestInclude } from './shiftRequestIncludes.js';
import {
  canCancelShiftRequest,
  findActiveShiftRequestAssignmentConflict,
  getAffectedShiftAssignmentIds,
  getInitialShiftRequestStatus,
  getShiftRequestStatusAfterManagerDecision,
  getShiftRequestStatusAfterPartnerResponse,
  normalizeShiftRequestNote,
} from './shiftRequestRulesService.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const ACTIVE_REQUEST_STATUSES: SwapRequestStatus[] = ['pending_partner', 'pending_manager'];
const REQUEST_STATUSES: SwapRequestStatus[] = [
  'pending_partner',
  'pending_manager',
  'approved',
  'denied',
  'canceled',
];
const REQUEST_TYPES: ShiftRequestType[] = ['swap', 'takeover', 'drop'];
const DEFAULT_SHIFT_DURATION_HOURS = 2;
const MAX_LIVE_IN_VOLUNTEER_WORKING_DAYS = 4;

type CreateShiftChangeRequestPayload = {
  requesterId: number;
  requestType: ShiftRequestType;
  fromAssignmentId?: number | null;
  toAssignmentId?: number | null;
  assignmentId?: number | null;
  requestNote?: unknown;
};

type AssignmentDetails = ShiftAssignment & {
  assignee?: User | null;
  shiftRole?: ShiftRole | null;
  shiftInstance?: (ShiftInstance & {
    shiftType?: ShiftType | null;
  }) | null;
};

type RequestDetails = SwapRequest & {
  fromAssignment?: AssignmentDetails | null;
  toAssignment?: AssignmentDetails | null;
  requester?: User | null;
  partner?: User | null;
  manager?: User | null;
};

const resolveScheduleTimezone = (): string =>
  (getConfigValue('SCHED_TZ') as string) ?? 'Europe/Warsaw';

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const resolveRequestType = (request: Pick<SwapRequest, 'requestType'>): ShiftRequestType =>
  request.requestType ?? 'swap';

const normalizeNote = (value: unknown, fieldName: string): string | null => {
  try {
    return normalizeShiftRequestNote(value);
  } catch (error) {
    const message = error instanceof Error
      ? error.message.replaceAll('requestNote', fieldName)
      : `${fieldName} is invalid`;
    throw new HttpError(400, message);
  }
};

const assertRequestType = (value: unknown): ShiftRequestType => {
  if (typeof value !== 'string' || !REQUEST_TYPES.includes(value as ShiftRequestType)) {
    throw new HttpError(400, 'requestType must be swap, takeover, or drop');
  }
  return value as ShiftRequestType;
};

const assertRequestStatus = (value: unknown): SwapRequestStatus => {
  if (typeof value !== 'string' || !REQUEST_STATUSES.includes(value as SwapRequestStatus)) {
    throw new HttpError(400, 'Invalid shift request status');
  }
  return value as SwapRequestStatus;
};

const getDetailedAssignment = async (
  assignmentId: number,
  transaction: Transaction,
): Promise<AssignmentDetails> => {
  const assignment = await ShiftAssignment.findByPk(assignmentId, {
    include: buildAssignmentInclude(),
    transaction,
  }) as AssignmentDetails | null;
  if (!assignment?.shiftInstance) {
    throw new HttpError(404, 'Shift assignment not found');
  }
  return assignment;
};

const lockAssignmentRows = async (
  assignmentIds: number[],
  transaction: Transaction,
): Promise<void> => {
  const assignments = await ShiftAssignment.findAll({
    where: { id: { [Op.in]: assignmentIds } },
    attributes: ['id'],
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (assignments.length !== assignmentIds.length) {
    throw new HttpError(404, 'Shift assignment not found');
  }
};

const lockReceivingStaffRows = async (
  userIds: number[],
  transaction: Transaction,
): Promise<void> => {
  const normalizedUserIds = Array.from(new Set(userIds.filter(isPositiveInteger)))
    .sort((left, right) => left - right);
  if (normalizedUserIds.length === 0) {
    return;
  }
  const users = await User.findAll({
    where: { id: { [Op.in]: normalizedUserIds } },
    attributes: ['id'],
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (users.length !== normalizedUserIds.length) {
    throw new HttpError(409, 'A staff member in this request no longer exists');
  }
};

const normalizeDatabaseTime = (value: string): string => {
  const [hours = '00', minutes = '00', seconds = '00'] = value.split(':');
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
};

const getShiftRange = (assignment: AssignmentDetails): { start: dayjs.Dayjs; end: dayjs.Dayjs } => {
  const shift = assignment.shiftInstance;
  if (!shift) {
    throw new HttpError(404, 'Shift assignment details are unavailable');
  }
  const timeStart = normalizeDatabaseTime(String(shift.timeStart).slice(0, 8));
  const start = dayjs.tz(
    `${shift.date} ${timeStart}`,
    'YYYY-MM-DD HH:mm:ss',
    resolveScheduleTimezone(),
  );
  if (!start.isValid()) {
    throw new HttpError(400, 'Shift start time is invalid');
  }
  let end = shift.timeEnd
    ? dayjs.tz(
        `${shift.date} ${normalizeDatabaseTime(String(shift.timeEnd).slice(0, 8))}`,
        'YYYY-MM-DD HH:mm:ss',
        resolveScheduleTimezone(),
      )
    : start.add(DEFAULT_SHIFT_DURATION_HOURS, 'hour');
  if (!end.isValid()) {
    throw new HttpError(400, 'Shift end time is invalid');
  }
  if (!end.isAfter(start)) {
    end = end.add(1, 'day');
  }
  return { start, end };
};

const assertFutureAssignment = (assignment: AssignmentDetails): void => {
  const { start } = getShiftRange(assignment);
  if (!start.isAfter(dayjs().tz(resolveScheduleTimezone()))) {
    throw new HttpError(400, 'Shift requests are closed after the shift has started');
  }
};

const rangesOverlap = (
  left: { start: dayjs.Dayjs; end: dayjs.Dayjs },
  right: { start: dayjs.Dayjs; end: dayjs.Dayjs },
): boolean => left.start.isBefore(right.end) && right.start.isBefore(left.end);

const normalizeRoleName = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const roleNamesMatch = (left: string, right: string): boolean =>
  left === right || left.includes(right) || right.includes(left);

const assertStaffCanReceiveAssignment = async (
  requesterId: number,
  targetAssignment: AssignmentDetails,
  transaction: Transaction,
  excludedAssignmentIds: number[] = [targetAssignment.id],
): Promise<void> => {
  const requester = await User.findByPk(requesterId, {
    attributes: ['id', 'status', 'approved', 'arrivalDate', 'departureDate'],
    include: [{ model: StaffProfile, as: 'staffProfile' }],
    transaction,
  }) as (User & { staffProfile?: StaffProfile | null }) | null;
  if (!requester?.status || !requester.approved || !requester.staffProfile?.active) {
    throw new HttpError(400, 'Only active, approved staff members can receive shifts');
  }

  const targetShiftDate = targetAssignment.shiftInstance?.date;
  if (requester.staffProfile.staffType === 'volunteer' && targetShiftDate) {
    const shiftDate = dayjs(targetShiftDate).startOf('day');
    const arrivalDate = requester.arrivalDate ? dayjs(requester.arrivalDate).startOf('day') : null;
    const departureDate = requester.departureDate ? dayjs(requester.departureDate).startOf('day') : null;
    if (arrivalDate?.isValid() && shiftDate.isBefore(arrivalDate)) {
      throw new HttpError(400, 'This shift is before the staff member arrival date');
    }
    if (departureDate?.isValid() && shiftDate.isAfter(departureDate)) {
      throw new HttpError(400, 'This shift is after the staff member departure date');
    }
  }

  const roleLinks = await UserShiftRole.findAll({
    where: { userId: requesterId },
    transaction,
  });
  if (roleLinks.length === 0) {
    throw new HttpError(400, 'You do not have a shift role that can cover this assignment');
  }

  if (targetAssignment.shiftRoleId != null) {
    if (!roleLinks.some((link) => link.shiftRoleId === targetAssignment.shiftRoleId)) {
      throw new HttpError(400, 'You do not have the required role for this shift');
    }
  } else {
    const roleIds = roleLinks.map((link) => link.shiftRoleId);
    const roles = await ShiftRole.findAll({ where: { id: roleIds }, transaction });
    const targetRole = normalizeRoleName(targetAssignment.roleInShift);
    const hasMatchingRole = targetRole.length === 0 || roles.some((role) => {
      const userRole = normalizeRoleName(role.name);
      return userRole.length > 0 && roleNamesMatch(userRole, targetRole);
    });
    if (!hasMatchingRole) {
      throw new HttpError(400, 'You do not have the required role for this shift');
    }
  }

  const targetShift = targetAssignment.shiftInstance;
  if (!targetShift) {
    throw new HttpError(404, 'Shift assignment details are unavailable');
  }
  if (requester.staffProfile.staffType === 'volunteer' && requester.staffProfile.livesInAccom) {
    const weekAssignments = await ShiftAssignment.findAll({
      where: {
        userId: requesterId,
        ...(excludedAssignmentIds.length > 0 ? { id: { [Op.notIn]: excludedAssignmentIds } } : {}),
      },
      include: [{
        model: ShiftInstance,
        as: 'shiftInstance',
        where: { scheduleWeekId: targetShift.scheduleWeekId },
      }],
      transaction,
    }) as AssignmentDetails[];
    const uniqueWorkingDates = new Set(
      weekAssignments
        .map((assignment) => assignment.shiftInstance?.date)
        .filter((date): date is string => Boolean(date)),
    );
    uniqueWorkingDates.add(targetShift.date);
    if (uniqueWorkingDates.size > MAX_LIVE_IN_VOLUNTEER_WORKING_DAYS) {
      throw new HttpError(
        400,
        `Volunteer living in accommodation cannot exceed ${MAX_LIVE_IN_VOLUNTEER_WORKING_DAYS} working days per week`,
      );
    }
  }
  const existingAssignments = await ShiftAssignment.findAll({
    where: {
      userId: requesterId,
      ...(excludedAssignmentIds.length > 0 ? { id: { [Op.notIn]: excludedAssignmentIds } } : {}),
    },
    include: [{
      model: ShiftInstance,
      as: 'shiftInstance',
      where: {
        date: {
          [Op.between]: [
            dayjs(targetShift.date).subtract(1, 'day').format('YYYY-MM-DD'),
            dayjs(targetShift.date).add(1, 'day').format('YYYY-MM-DD'),
          ],
        },
      },
    }],
    transaction,
  }) as AssignmentDetails[];
  const targetRange = getShiftRange(targetAssignment);
  const overlap = existingAssignments.some((assignment) => {
    if (!assignment.shiftInstance) {
      return false;
    }
    return rangesOverlap(targetRange, getShiftRange(assignment));
  });
  if (overlap) {
    throw new HttpError(400, 'Receiving this shift would overlap another assigned shift');
  }
};

const assignmentsHaveMatchingRole = (
  left: AssignmentDetails,
  right: AssignmentDetails,
): boolean => {
  if (left.shiftRoleId != null || right.shiftRoleId != null) {
    return left.shiftRoleId != null
      && right.shiftRoleId != null
      && left.shiftRoleId === right.shiftRoleId;
  }
  const leftRole = normalizeRoleName(left.roleInShift);
  const rightRole = normalizeRoleName(right.roleInShift);
  return leftRole.length > 0 && rightRole.length > 0 && roleNamesMatch(leftRole, rightRole);
};

const createAssignmentSnapshot = (assignment: AssignmentDetails): ShiftAssignmentSnapshot => ({
  id: assignment.id,
  shiftInstanceId: assignment.shiftInstanceId,
  userId: assignment.userId,
  shiftRoleId: assignment.shiftRoleId,
  roleInShift: assignment.roleInShift,
  assignee: assignment.assignee
    ? {
        id: assignment.assignee.id,
        firstName: assignment.assignee.firstName ?? null,
        lastName: assignment.assignee.lastName ?? null,
      }
    : null,
  shiftInstance: assignment.shiftInstance
    ? {
        id: assignment.shiftInstance.id,
        date: assignment.shiftInstance.date,
        timeStart: assignment.shiftInstance.timeStart,
        timeEnd: assignment.shiftInstance.timeEnd,
        shiftTypeId: assignment.shiftInstance.shiftTypeId,
        shiftType: assignment.shiftInstance.shiftType
          ? {
              id: assignment.shiftInstance.shiftType.id,
              name: assignment.shiftInstance.shiftType.name,
            }
          : null,
      }
    : null,
});

const assertNoActiveAssignmentConflict = async (
  request: {
    requestType: ShiftRequestType;
    fromAssignmentId: number | null;
    toAssignmentId: number | null;
  },
  transaction: Transaction,
  excludeRequestId?: number,
): Promise<void> => {
  const assignmentIds = getAffectedShiftAssignmentIds(request);
  if (assignmentIds.length === 0) {
    throw new HttpError(400, 'A shift assignment is required');
  }
  const activeRequests = await SwapRequest.findAll({
    where: {
      status: { [Op.in]: ACTIVE_REQUEST_STATUSES },
      [Op.or]: [
        { fromAssignmentId: { [Op.in]: assignmentIds } },
        { toAssignmentId: { [Op.in]: assignmentIds } },
      ],
    },
    attributes: ['id', 'requestType', 'status', 'fromAssignmentId', 'toAssignmentId'],
    transaction,
  });
  const conflict = findActiveShiftRequestAssignmentConflict(
    request,
    activeRequests.map((activeRequest) => ({
      id: activeRequest.id,
      requestType: resolveRequestType(activeRequest),
      status: activeRequest.status,
      fromAssignmentId: activeRequest.fromAssignmentId,
      toAssignmentId: activeRequest.toAssignmentId,
    })),
    excludeRequestId,
  );
  if (conflict) {
    throw new HttpError(
      409,
      conflict.requestId
        ? `Assignment already has an active shift request (#${conflict.requestId})`
        : 'Assignment already has an active shift request',
    );
  }
};

const logRequestAudit = async (options: {
  actorId: number;
  action: string;
  request: SwapRequest;
  meta?: Record<string, unknown>;
}): Promise<void> => {
  await AuditLog.create({
    actorId: options.actorId,
    action: options.action,
    entity: 'shift_change_request',
    entityId: String(options.request.id),
    metaJson: {
      requestType: resolveRequestType(options.request),
      fromAssignmentId: options.request.fromAssignmentId,
      toAssignmentId: options.request.toAssignmentId,
      assignmentSnapshotId: options.request.assignmentSnapshot?.id ?? null,
      ...options.meta,
    },
    createdAt: dayjs().tz(resolveScheduleTimezone()).toDate(),
  });
};

const runPostCommit = async (label: string, operation: () => Promise<void>): Promise<void> => {
  try {
    await operation();
  } catch (error) {
    logger.error(`${label}: ${(error as Error).message}`);
  }
};

const formatUserName = (user?: User | null): string => {
  const fullName = [user?.firstName, user?.lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return fullName || user?.username || user?.email || 'A teammate';
};

const getRequestLabel = (requestType: ShiftRequestType): string => {
  if (requestType === 'takeover') {
    return 'Shift takeover request';
  }
  if (requestType === 'drop') {
    return 'Shift drop request';
  }
  return 'Shift swap request';
};

const getPrimaryAssignment = (request: RequestDetails): AssignmentDetails | null => {
  if (resolveRequestType(request) === 'swap') {
    return request.toAssignment ?? request.fromAssignment ?? null;
  }
  return request.fromAssignment ?? null;
};

const getNotificationShiftPayload = (request: RequestDetails): Record<string, unknown> => {
  const assignment = getPrimaryAssignment(request);
  const snapshot = request.assignmentSnapshot;
  const shift = assignment?.shiftInstance ?? snapshot?.shiftInstance ?? null;
  const shiftTypeName = assignment?.shiftInstance?.shiftType?.name
    ?? snapshot?.shiftInstance?.shiftType?.name
    ?? 'Shift';
  const date = shift?.date ?? null;
  const start = shift?.timeStart ? String(shift.timeStart).slice(0, 5) : null;
  const end = shift?.timeEnd ? String(shift.timeEnd).slice(0, 5) : null;
  return {
    shiftType: shiftTypeName,
    day: date && dayjs(date).isValid() ? dayjs(date).format('dddd, MMMM D') : 'the scheduled day',
    time: [start, end].filter(Boolean).join(' - '),
  };
};

const loadShiftChangeRequest = async (
  requestId: number,
  transaction?: Transaction,
): Promise<RequestDetails> => {
  const request = await SwapRequest.findByPk(requestId, {
    include: buildRequestInclude(),
    transaction,
  }) as RequestDetails | null;
  if (!request) {
    throw new HttpError(404, 'Shift request not found');
  }
  return request;
};

const notifyRequestCreated = async (request: RequestDetails): Promise<void> => {
  const requestType = resolveRequestType(request);
  const shiftPayload = getNotificationShiftPayload(request);
  if (requestType === 'drop') {
    const requester = await User.findByPk(request.requesterId);
    if (requester) {
      await sendSchedulingNotification({
        user: requester,
        templateKey: 'shift_drop_request',
        payload: shiftPayload,
      });
    }
    return;
  }
  if (!isPositiveInteger(request.partnerId)) {
    return;
  }
  const partner = await User.findByPk(request.partnerId);
  if (!partner) {
    return;
  }
  await sendSchedulingNotification({
    user: partner,
    templateKey: requestType === 'takeover' ? 'shift_takeover_request' : 'swap_request',
    payload: {
      ...shiftPayload,
      requesterName: formatUserName(request.requester),
    },
  });
};

const notifyPartnerResponse = async (request: RequestDetails, accept: boolean): Promise<void> => {
  const requester = await User.findByPk(request.requesterId);
  if (!requester) {
    return;
  }
  await sendSchedulingNotification({
    user: requester,
    templateKey: 'shift_request_partner_response',
    payload: {
      ...getNotificationShiftPayload(request),
      requestLabel: getRequestLabel(resolveRequestType(request)),
      partnerName: formatUserName(request.partner),
      accepted: accept,
    },
  });
};

const notifyManagerDecision = async (
  request: RequestDetails,
  approve: boolean,
  reason?: string | null,
): Promise<void> => {
  const participantIds = Array.from(new Set(
    [request.requesterId, request.partnerId].filter(isPositiveInteger),
  ));
  if (participantIds.length === 0) {
    return;
  }
  const participants = await User.findAll({ where: { id: participantIds } });
  await Promise.all(participants.map((participant) => sendSchedulingNotification({
    user: participant,
    templateKey: 'shift_request_manager_decision',
    payload: {
      ...getNotificationShiftPayload(request),
      requestLabel: getRequestLabel(resolveRequestType(request)),
      decision: approve ? 'approved' : 'denied',
      reason: reason ?? '',
    },
  })));
};

const notifyRequestCanceled = async (request: RequestDetails, actorId: number): Promise<void> => {
  const recipientId = request.requesterId === actorId ? request.partnerId : request.requesterId;
  if (!isPositiveInteger(recipientId)) {
    return;
  }
  const [recipient, actor] = await Promise.all([
    User.findByPk(recipientId),
    User.findByPk(actorId),
  ]);
  if (!recipient) {
    return;
  }
  await sendSchedulingNotification({
    user: recipient,
    templateKey: 'shift_request_canceled',
    payload: {
      ...getNotificationShiftPayload(request),
      requestLabel: getRequestLabel(resolveRequestType(request)),
      actorName: formatUserName(actor),
    },
  });
};

const formatAssignmentForPopup = (request: RequestDetails): string => {
  const assignment = getPrimaryAssignment(request);
  const snapshot = request.assignmentSnapshot;
  const shift = assignment?.shiftInstance ?? snapshot?.shiftInstance ?? null;
  const shiftType = assignment?.shiftInstance?.shiftType?.name
    ?? snapshot?.shiftInstance?.shiftType?.name
    ?? 'Shift';
  const date = shift?.date && dayjs(shift.date).isValid()
    ? dayjs(shift.date).format('ddd, MMM D')
    : 'date unavailable';
  const start = shift?.timeStart ? String(shift.timeStart).slice(0, 5) : null;
  const end = shift?.timeEnd ? String(shift.timeEnd).slice(0, 5) : null;
  const role = assignment?.roleInShift ?? snapshot?.roleInShift ?? 'role not specified';
  return `${shiftType} | ${date} | ${[start, end].filter(Boolean).join(' - ')} | ${role}`;
};

const createApprovalAcknowledgement = async (
  request: RequestDetails,
  managerId: number,
): Promise<void> => {
  const requestType = resolveRequestType(request);
  const targetUserIds = Array.from(new Set(
    [request.requesterId, request.partnerId].filter(isPositiveInteger),
  ));
  if (targetUserIds.length === 0) {
    return;
  }
  const requesterName = formatUserName(request.requester);
  const summary = requestType === 'takeover'
    ? `${requesterName}'s takeover of ${formatAssignmentForPopup(request)} was approved. The schedule has been updated.`
    : requestType === 'drop'
      ? `Your request to drop ${formatAssignmentForPopup(request)} was approved. The shift is now open on the schedule.`
      : `The shift swap between ${requesterName} and ${formatUserName(request.partner)} was approved. The schedule has been updated.`;
  const body = request.decisionReason
    ? `${summary}\n\nManager note: ${request.decisionReason}`
    : summary;
  await RequiredAction.create({
    type: 'custom',
    title: `${getRequestLabel(requestType)} approved`,
    body,
    payload: {
      source: 'schedule_shift_request_manager_decision',
      requestId: request.id,
      swapId: request.id,
      requestType,
      decision: 'approved',
      requesterId: request.requesterId,
      partnerId: request.partnerId,
      fromAssignmentId: request.fromAssignmentId,
      toAssignmentId: request.toAssignmentId,
      assignmentSnapshot: request.assignmentSnapshot,
    },
    targetUserIds,
    requiresCompletion: true,
    requiresSignature: false,
    startsAt: new Date(),
    status: true,
    createdBy: managerId,
    updatedBy: managerId,
  });
};

export async function createShiftChangeRequest(
  payload: CreateShiftChangeRequestPayload,
): Promise<SwapRequest> {
  if (!isPositiveInteger(payload.requesterId)) {
    throw new HttpError(401, 'Unauthorized');
  }
  const requestType = assertRequestType(payload.requestType);
  const requestNote = normalizeNote(payload.requestNote, 'requestNote');
  const fromAssignmentId = requestType === 'swap'
    ? payload.fromAssignmentId
    : payload.assignmentId ?? payload.fromAssignmentId;
  const toAssignmentId = requestType === 'swap' ? payload.toAssignmentId : null;
  if (!isPositiveInteger(fromAssignmentId)) {
    throw new HttpError(400, 'A valid assignmentId is required');
  }
  if (requestType === 'swap' && !isPositiveInteger(toAssignmentId)) {
    throw new HttpError(400, 'A valid toAssignmentId is required for swaps');
  }
  if (requestType === 'swap' && fromAssignmentId === toAssignmentId) {
    throw new HttpError(400, 'A shift cannot be exchanged with itself');
  }

  const requestId = await sequelize.transaction(async (transaction) => {
    const assignmentIds = getAffectedShiftAssignmentIds({
      requestType,
      fromAssignmentId,
      toAssignmentId,
    });
    await lockAssignmentRows(assignmentIds, transaction);
    const fromAssignment = await getDetailedAssignment(fromAssignmentId, transaction);
    const toAssignment = isPositiveInteger(toAssignmentId)
      ? await getDetailedAssignment(toAssignmentId, transaction)
      : null;
    assertFutureAssignment(fromAssignment);
    if (toAssignment) {
      assertFutureAssignment(toAssignment);
    }

    let partnerId: number | null = null;
    if (requestType === 'swap') {
      if (fromAssignment.userId !== payload.requesterId) {
        throw new HttpError(403, 'You can only swap your own assignment');
      }
      if (!toAssignment) {
        throw new HttpError(404, 'Target assignment not found');
      }
      if (toAssignment.userId === payload.requesterId) {
        throw new HttpError(400, 'The target assignment must belong to another staff member');
      }
      if (fromAssignment.shiftInstanceId === toAssignment.shiftInstanceId) {
        throw new HttpError(400, 'Swap assignments must belong to different shift instances');
      }
      if (fromAssignment.shiftInstance?.shiftTypeId !== toAssignment.shiftInstance?.shiftTypeId) {
        throw new HttpError(400, 'Swap assignments must have the same shift type');
      }
      if (!assignmentsHaveMatchingRole(fromAssignment, toAssignment)) {
        throw new HttpError(400, 'Swap assignments must have the same shift role');
      }
      const swapAssignmentIds = [fromAssignment.id, toAssignment.id];
      await lockReceivingStaffRows([payload.requesterId, toAssignment.userId], transaction);
      await assertStaffCanReceiveAssignment(
        payload.requesterId,
        toAssignment,
        transaction,
        swapAssignmentIds,
      );
      await assertStaffCanReceiveAssignment(
        toAssignment.userId,
        fromAssignment,
        transaction,
        swapAssignmentIds,
      );
      partnerId = toAssignment.userId;
    } else if (requestType === 'takeover') {
      if (fromAssignment.userId === payload.requesterId) {
        throw new HttpError(400, 'You already own this shift assignment');
      }
      partnerId = fromAssignment.userId;
      await lockReceivingStaffRows([payload.requesterId], transaction);
      await assertStaffCanReceiveAssignment(payload.requesterId, fromAssignment, transaction);
    } else if (fromAssignment.userId !== payload.requesterId) {
      throw new HttpError(403, 'You can only drop your own assignment');
    }

    await assertNoActiveAssignmentConflict({
      requestType,
      fromAssignmentId,
      toAssignmentId: toAssignmentId ?? null,
    }, transaction);

    const request = await SwapRequest.create({
      requestType,
      fromAssignmentId,
      toAssignmentId: toAssignmentId ?? null,
      requesterId: payload.requesterId,
      partnerId,
      status: getInitialShiftRequestStatus(requestType),
      requestNote,
      partnerResponseNote: null,
      assignmentSnapshot: requestType === 'swap' && toAssignment
        ? {
            ...createAssignmentSnapshot(fromAssignment),
            toAssignment: createAssignmentSnapshot(toAssignment),
          }
        : createAssignmentSnapshot(fromAssignment),
    }, { transaction });
    return request.id;
  });

  const request = await loadShiftChangeRequest(requestId);
  await runPostCommit('Unable to write shift-request creation audit', () => logRequestAudit({
    actorId: payload.requesterId,
    action: 'schedule.shift-request.create',
    request,
  }));
  await runPostCommit('Unable to send shift-request creation notification', () => notifyRequestCreated(request));
  return request;
}

export async function respondToShiftChangeRequest(
  requestId: number,
  partnerId: number,
  accept: boolean,
  note?: unknown,
): Promise<SwapRequest> {
  if (!isPositiveInteger(requestId)) {
    throw new HttpError(400, 'Invalid shift request id');
  }
  const partnerResponseNote = normalizeNote(note, 'note');
  await sequelize.transaction(async (transaction) => {
    const request = await SwapRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw new HttpError(404, 'Shift request not found');
    }
    const requestType = resolveRequestType(request);
    if (request.partnerId !== partnerId) {
      throw new HttpError(403, 'Only the affected staff member can respond to this request');
    }
    let nextStatus: SwapRequestStatus;
    try {
      nextStatus = getShiftRequestStatusAfterPartnerResponse(requestType, request.status, accept);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (accept) {
      await assertRequestAssignmentsStillValid(request, transaction);
    }
    request.status = nextStatus;
    request.partnerResponseNote = partnerResponseNote;
    await request.save({ transaction });
  });

  const request = await loadShiftChangeRequest(requestId);
  await runPostCommit('Unable to write shift-request partner-response audit', () => logRequestAudit({
    actorId: partnerId,
    action: 'schedule.shift-request.partner-response',
    request,
    meta: { accept },
  }));
  await runPostCommit('Unable to send shift-request partner-response notification', () =>
    notifyPartnerResponse(request, accept));
  return request;
}

export async function cancelShiftChangeRequest(
  requestId: number,
  actorId: number,
  note?: unknown,
): Promise<SwapRequest> {
  if (!isPositiveInteger(requestId)) {
    throw new HttpError(400, 'Invalid shift request id');
  }
  const cancelNote = normalizeNote(note, 'note');
  await sequelize.transaction(async (transaction) => {
    const request = await SwapRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw new HttpError(404, 'Shift request not found');
    }
    if (!canCancelShiftRequest(request.status)) {
      throw new HttpError(400, 'Only pending shift requests can be canceled');
    }
    if (request.requesterId !== actorId && request.partnerId !== actorId) {
      throw new HttpError(403, 'You may only cancel shift requests you are part of');
    }
    request.status = 'canceled';
    request.decisionReason = cancelNote ?? 'Canceled by participant';
    await request.save({ transaction });
  });

  const request = await loadShiftChangeRequest(requestId);
  await runPostCommit('Unable to write shift-request cancellation audit', () => logRequestAudit({
    actorId,
    action: 'schedule.shift-request.cancel',
    request,
  }));
  await runPostCommit('Unable to send shift-request cancellation notification', () =>
    notifyRequestCanceled(request, actorId));
  return request;
}

const assertRequestAssignmentsStillValid = async (
  request: SwapRequest,
  transaction: Transaction,
): Promise<{ fromAssignment: AssignmentDetails; toAssignment: AssignmentDetails | null }> => {
  const requestType = resolveRequestType(request);
  const assignmentIds = getAffectedShiftAssignmentIds({
    requestType,
    fromAssignmentId: request.fromAssignmentId,
    toAssignmentId: request.toAssignmentId,
  });
  if (assignmentIds.length === 0) {
    throw new HttpError(409, 'The affected assignment no longer exists');
  }
  await lockAssignmentRows(assignmentIds, transaction);
  const fromAssignmentId = request.fromAssignmentId;
  if (!isPositiveInteger(fromAssignmentId)) {
    throw new HttpError(409, 'The affected assignment no longer exists');
  }
  const fromAssignment = await getDetailedAssignment(fromAssignmentId, transaction);
  const toAssignment = isPositiveInteger(request.toAssignmentId)
    ? await getDetailedAssignment(request.toAssignmentId, transaction)
    : null;
  assertFutureAssignment(fromAssignment);
  if (toAssignment) {
    assertFutureAssignment(toAssignment);
  }

  if (requestType === 'swap') {
    if (!toAssignment || !isPositiveInteger(request.partnerId)) {
      throw new HttpError(409, 'Swap assignments are incomplete');
    }
    if (fromAssignment.userId !== request.requesterId || toAssignment.userId !== request.partnerId) {
      throw new HttpError(409, 'A swap assignment owner changed after this request was created');
    }
    if (fromAssignment.shiftInstanceId === toAssignment.shiftInstanceId) {
      throw new HttpError(409, 'Swap assignments must belong to different shift instances');
    }
    if (fromAssignment.shiftInstance?.shiftTypeId !== toAssignment.shiftInstance?.shiftTypeId) {
      throw new HttpError(409, 'Swap assignments no longer have the same shift type');
    }
    if (!assignmentsHaveMatchingRole(fromAssignment, toAssignment)) {
      throw new HttpError(409, 'Swap assignments no longer have the same shift role');
    }
    const swapAssignmentIds = [fromAssignment.id, toAssignment.id];
    await lockReceivingStaffRows([request.requesterId, request.partnerId], transaction);
    await assertStaffCanReceiveAssignment(
      request.requesterId,
      toAssignment,
      transaction,
      swapAssignmentIds,
    );
    await assertStaffCanReceiveAssignment(
      request.partnerId,
      fromAssignment,
      transaction,
      swapAssignmentIds,
    );
  } else if (requestType === 'takeover') {
    if (!isPositiveInteger(request.partnerId) || fromAssignment.userId !== request.partnerId) {
      throw new HttpError(409, 'The assignment owner changed after this request was created');
    }
    await lockReceivingStaffRows([request.requesterId], transaction);
    await assertStaffCanReceiveAssignment(request.requesterId, fromAssignment, transaction);
  } else if (fromAssignment.userId !== request.requesterId) {
    throw new HttpError(409, 'The dropped assignment owner changed after this request was created');
  }

  await assertNoActiveAssignmentConflict({
    requestType,
    fromAssignmentId: request.fromAssignmentId,
    toAssignmentId: request.toAssignmentId,
  }, transaction, request.id);
  return { fromAssignment, toAssignment };
};

const applyApprovedRequest = async (
  request: SwapRequest,
  transaction: Transaction,
): Promise<void> => {
  const requestType = resolveRequestType(request);
  const { fromAssignment, toAssignment } = await assertRequestAssignmentsStillValid(request, transaction);
  if (!request.assignmentSnapshot) {
    request.assignmentSnapshot = requestType === 'swap' && toAssignment
      ? {
          ...createAssignmentSnapshot(fromAssignment),
          toAssignment: createAssignmentSnapshot(toAssignment),
        }
      : createAssignmentSnapshot(fromAssignment);
  }
  if (requestType === 'swap') {
    if (!toAssignment) {
      throw new HttpError(409, 'Swap assignments are incomplete');
    }
    await sequelize.query(
      `
        UPDATE "shift_assignments"
        SET "user_id" = CASE
          WHEN "id" = :fromAssignmentId THEN :toUserId
          WHEN "id" = :toAssignmentId THEN :fromUserId
          ELSE "user_id"
        END,
        "updated_at" = NOW()
        WHERE "id" IN (:fromAssignmentId, :toAssignmentId)
      `,
      {
        replacements: {
          fromAssignmentId: fromAssignment.id,
          toAssignmentId: toAssignment.id,
          fromUserId: fromAssignment.userId,
          toUserId: toAssignment.userId,
        },
        transaction,
      },
    );
  } else if (requestType === 'takeover') {
    await fromAssignment.update({ userId: request.requesterId }, { transaction });
  } else {
    await fromAssignment.destroy({ transaction });
  }
};

export async function decideShiftChangeRequest(
  requestId: number,
  managerId: number,
  approve: boolean,
  reason?: unknown,
): Promise<SwapRequest> {
  if (!isPositiveInteger(requestId)) {
    throw new HttpError(400, 'Invalid shift request id');
  }
  if (!isPositiveInteger(managerId)) {
    throw new HttpError(401, 'Missing authenticated manager');
  }
  const decisionReason = normalizeNote(reason, 'reason');
  await sequelize.transaction(async (transaction) => {
    const request = await SwapRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw new HttpError(404, 'Shift request not found');
    }
    if (request.requesterId === managerId || request.partnerId === managerId) {
      throw new HttpError(403, 'A different manager must make the final decision on this request');
    }
    let nextStatus: SwapRequestStatus;
    try {
      nextStatus = getShiftRequestStatusAfterManagerDecision(request.status, approve);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }
    if (approve) {
      await applyApprovedRequest(request, transaction);
    }
    request.status = nextStatus;
    request.managerId = managerId;
    request.decisionReason = decisionReason;
    await request.save({ transaction });
  });

  const request = await loadShiftChangeRequest(requestId);
  await runPostCommit('Unable to write shift-request manager-decision audit', () => logRequestAudit({
    actorId: managerId,
    action: 'schedule.shift-request.manager-decision',
    request,
    meta: { approve, reason: decisionReason },
  }));
  if (approve) {
    await runPostCommit('Unable to create shift-request approval acknowledgement', () =>
      createApprovalAcknowledgement(request, managerId));
  }
  await runPostCommit('Unable to send shift-request manager-decision notification', () =>
    notifyManagerDecision(request, approve, decisionReason));
  return request;
}

export async function listShiftChangeRequests(options: {
  status: SwapRequestStatus | string;
  requestType?: ShiftRequestType | string | null;
}): Promise<SwapRequest[]> {
  const status = assertRequestStatus(options.status);
  const requestType = options.requestType == null ? null : assertRequestType(options.requestType);
  return SwapRequest.findAll({
    where: {
      status,
      ...(requestType ? { requestType } : {}),
    },
    include: buildRequestInclude(),
    order: [['createdAt', 'DESC']],
  });
}

export async function listShiftChangeRequestsForUser(userId: number): Promise<SwapRequest[]> {
  return SwapRequest.findAll({
    where: {
      [Op.or]: [{ requesterId: userId }, { partnerId: userId }],
    },
    include: buildRequestInclude(),
    order: [['createdAt', 'DESC']],
  });
}

// Legacy swap API adapters. New callers should use the shift-change request API.
export async function createSwapRequest(payload: {
  fromAssignmentId: number;
  toAssignmentId: number;
  partnerId?: number;
  requesterId: number;
}): Promise<SwapRequest> {
  return createShiftChangeRequest({
    requestType: 'swap',
    requesterId: payload.requesterId,
    fromAssignmentId: payload.fromAssignmentId,
    toAssignmentId: payload.toAssignmentId,
  });
}

export async function swapPartnerResponse(
  requestId: number,
  partnerId: number,
  accept: boolean,
  note?: unknown,
): Promise<SwapRequest> {
  return respondToShiftChangeRequest(requestId, partnerId, accept, note);
}

export async function cancelSwapRequest(
  requestId: number,
  actorId: number,
  note?: unknown,
): Promise<SwapRequest> {
  return cancelShiftChangeRequest(requestId, actorId, note);
}

export async function swapManagerDecision(
  requestId: number,
  managerId: number,
  approve: boolean,
  reason?: unknown,
): Promise<SwapRequest> {
  return decideShiftChangeRequest(requestId, managerId, approve, reason);
}

export async function listSwapsByStatus(status: SwapRequestStatus): Promise<SwapRequest[]> {
  return listShiftChangeRequests({ status, requestType: 'swap' });
}

export async function listSwapsForUser(userId: number): Promise<SwapRequest[]> {
  const requests = await listShiftChangeRequestsForUser(userId);
  return requests.filter((request) => resolveRequestType(request) === 'swap');
}
