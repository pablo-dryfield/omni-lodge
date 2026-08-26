import type { ShiftRequestType, SwapRequestStatus } from '../models/SwapRequest.js';

export const SHIFT_REQUEST_NOTE_MAX_LENGTH = 2000;

export type ShiftRequestAssignmentReferences = {
  requestType: ShiftRequestType;
  fromAssignmentId?: number | null;
  toAssignmentId?: number | null;
};

export type ActiveShiftRequestReference = ShiftRequestAssignmentReferences & {
  id?: number | null;
  status: SwapRequestStatus;
};

export type ShiftRequestAssignmentConflict = {
  assignmentId: number;
  requestId: number | null;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Parses JSON boolean fields without JavaScript truthiness coercion.
 * Callers can turn `null` into their preferred validation error.
 */
export const parseStrictBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

/**
 * Normalizes optional requester notes while keeping validation independent
 * from Express and Sequelize.
 */
export const normalizeShiftRequestNote = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new TypeError('requestNote must be a string or null');
  }

  const note = value.trim();
  if (!note) {
    return null;
  }
  if (note.length > SHIFT_REQUEST_NOTE_MAX_LENGTH) {
    throw new RangeError(`requestNote must be at most ${SHIFT_REQUEST_NOTE_MAX_LENGTH} characters`);
  }
  return note;
};

export const isActiveShiftRequestStatus = (status: SwapRequestStatus): boolean =>
  status === 'pending_partner' || status === 'pending_manager';

export const getInitialShiftRequestStatus = (requestType: ShiftRequestType): SwapRequestStatus =>
  requestType === 'drop' ? 'pending_manager' : 'pending_partner';

export const canPartnerRespondToShiftRequest = (
  requestType: ShiftRequestType,
  status: SwapRequestStatus,
): boolean =>
  (requestType === 'swap' || requestType === 'takeover') && status === 'pending_partner';

export const getShiftRequestStatusAfterPartnerResponse = (
  requestType: ShiftRequestType,
  status: SwapRequestStatus,
  accept: boolean,
): SwapRequestStatus => {
  if (!canPartnerRespondToShiftRequest(requestType, status)) {
    throw new Error('Shift request is not awaiting a partner response');
  }
  return accept ? 'pending_manager' : 'denied';
};

export const canManagerDecideShiftRequest = (status: SwapRequestStatus): boolean =>
  status === 'pending_manager';

export const getShiftRequestStatusAfterManagerDecision = (
  status: SwapRequestStatus,
  approve: boolean,
): SwapRequestStatus => {
  if (!canManagerDecideShiftRequest(status)) {
    throw new Error('Shift request is not awaiting a manager decision');
  }
  return approve ? 'approved' : 'denied';
};

export const canCancelShiftRequest = (status: SwapRequestStatus): boolean =>
  isActiveShiftRequestStatus(status);

/**
 * A takeover and a drop affect their single `from` assignment. A swap affects
 * both assignments. Invalid/missing IDs are intentionally omitted so callers
 * can validate request shape separately without ever treating them as locks.
 */
export const getAffectedShiftAssignmentIds = (
  request: ShiftRequestAssignmentReferences,
): number[] => {
  const candidates = request.requestType === 'swap'
    ? [request.fromAssignmentId, request.toAssignmentId]
    : [request.fromAssignmentId];

  return Array.from(new Set(candidates.filter(isPositiveInteger))).sort((left, right) => left - right);
};

/**
 * Finds an active request that reserves any of the same assignments. It checks
 * both swap sides, which avoids a source-vs-target blind spot in conflict checks.
 */
export const findActiveShiftRequestAssignmentConflict = (
  candidate: ShiftRequestAssignmentReferences,
  existingRequests: readonly ActiveShiftRequestReference[],
  excludeRequestId?: number | null,
): ShiftRequestAssignmentConflict | null => {
  const candidateIds = new Set(getAffectedShiftAssignmentIds(candidate));
  if (candidateIds.size === 0) {
    return null;
  }

  for (const request of existingRequests) {
    if (!isActiveShiftRequestStatus(request.status)) {
      continue;
    }
    if (excludeRequestId != null && request.id === excludeRequestId) {
      continue;
    }

    const assignmentId = getAffectedShiftAssignmentIds(request)
      .find((id) => candidateIds.has(id));
    if (assignmentId != null) {
      return {
        assignmentId,
        requestId: isPositiveInteger(request.id) ? request.id : null,
      };
    }
  }
  return null;
};

