import crypto from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op, UniqueConstraintError, type Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import AuditLog from '../models/AuditLog.js';
import PromotionCheckpointVisit from '../models/PromotionCheckpointVisit.js';
import PromotionCoPresenceChallenge from '../models/PromotionCoPresenceChallenge.js';
import PromotionCoPresenceResponse from '../models/PromotionCoPresenceResponse.js';
import PromotionIncident from '../models/PromotionIncident.js';
import PromotionLocationSample from '../models/PromotionLocationSample.js';
import PromotionManagerOverride from '../models/PromotionManagerOverride.js';
import PromotionRouteCheckpoint, { type PromotionPhase } from '../models/PromotionRouteCheckpoint.js';
import PromotionRoutePlan from '../models/PromotionRoutePlan.js';
import PromotionRouteVersion, { type PromotionCoordinateJson, type PromotionRoutePolicyJson } from '../models/PromotionRouteVersion.js';
import PromotionSession, { type PromotionLifecycleStatus, type PromotionVerificationQuality } from '../models/PromotionSession.js';
import PromotionSessionParticipant from '../models/PromotionSessionParticipant.js';
import PromotionTeamAssignment from '../models/PromotionTeamAssignment.js';
import ScheduleWeek from '../models/ScheduleWeek.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftType from '../models/ShiftType.js';
import User from '../models/User.js';
import Venue from '../models/Venue.js';
import VolunteerShiftAttendance from '../models/VolunteerShiftAttendance.js';
import {
  calculateDistanceMeters,
  coerceProofs,
  DEFAULT_PROMOTION_ROUTE_POLICY,
  evaluateLocationDwell,
  normalizePromotionPolicy,
  strongestQuality,
  type PromotionCoordinate,
  type PromotionLocationProofPayload,
} from './promotionTrackingRules.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const ACTIVE_LIFECYCLES: PromotionLifecycleStatus[] = ['STREET_ACTIVE', 'HOSTEL_ACTIVE'];
const TERMINAL_LIFECYCLES: PromotionLifecycleStatus[] = ['COMPLETED', 'ABORTED'];
const DEFAULT_TIME_ZONE = 'Europe/Warsaw';

type AllowedActions = {
  actions: string[];
  blockingReasons: Record<string, string[]>;
};

type LoadedAssignmentContext = {
  assignment: ShiftAssignment;
  shift: ShiftInstance;
  week: ScheduleWeek;
  shiftType: ShiftType;
  teamAssignment: PromotionTeamAssignment;
  routeVersion: PromotionRouteVersion;
  checkpoints: PromotionRouteCheckpoint[];
  shiftAssignments: ShiftAssignment[];
  scheduledStartUtc: Date;
  scheduledEndUtc: Date | null;
};

type SessionSnapshotOptions = {
  actorUserId: number;
  serverMessage?: string;
  transaction?: Transaction;
};

type RoutePointInput = {
  label?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  radiusMeters?: unknown;
};

type CheckpointInput = RoutePointInput & {
  phase?: unknown;
  sequence?: unknown;
  instruction?: unknown;
  requiredDwellSeconds?: unknown;
};

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

const parsePositiveInt = (value: unknown, label: string): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer.`);
  }
  return parsed;
};

const parseExpectedVersion = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, 'expectedSessionVersion must be a positive integer.');
  }
  return parsed;
};

const requireIdempotencyKey = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length < 8 || value.trim().length > 160) {
    throw new HttpError(400, 'Idempotency-Key header is required for this mutation.');
  }
  return value.trim();
};

const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

const dateFromShift = (shift: ShiftInstance, week: ScheduleWeek, timeValue: string | null): Date | null => {
  if (!timeValue) return null;
  const time = timeValue.slice(0, 5);
  const zone = week.tz || DEFAULT_TIME_ZONE;
  const parsed = dayjs.tz(`${shift.date} ${time}`, 'YYYY-MM-DD HH:mm', zone);
  return parsed.isValid() ? parsed.toDate() : null;
};

const isPromotionShiftType = (shiftType: ShiftType): boolean => {
  const key = (shiftType.key ?? '').toLowerCase();
  const name = (shiftType.name ?? '').toLowerCase();
  return key.includes('promotion') || name.includes('promotion') || key.includes('promo') || name.includes('promo');
};

const normalizePhase = (value: unknown): PromotionPhase | null => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'street') return 'street';
  if (normalized === 'hostel') return 'hostel';
  return null;
};

const publicPhase = (phase: PromotionPhase | null): 'STREET' | 'HOSTEL' | null => {
  if (phase === 'street') return 'STREET';
  if (phase === 'hostel') return 'HOSTEL';
  return null;
};

const currentPhase = (session: PromotionSession): PromotionPhase | null => {
  if (session.lifecycle === 'STREET_ACTIVE') return 'street';
  if (session.lifecycle === 'HOSTEL_ACTIVE') return 'hostel';
  return null;
};

const displayName = (user: User | null | undefined, fallback: string): string => {
  const first = user?.firstName?.trim();
  const last = user?.lastName?.trim();
  const combined = [first, last].filter(Boolean).join(' ').trim();
  return combined || fallback;
};

const audit = async (
  action: string,
  entity: string,
  entityId: string | number,
  actorId: number | null,
  metaJson: Record<string, unknown> | null,
  transaction?: Transaction,
): Promise<void> => {
  await AuditLog.create({
    action,
    entity,
    entityId: String(entityId),
    actorId,
    metaJson,
  }, { transaction });
};

const hashNonce = (nonce: string): string =>
  crypto.createHash('sha256').update(nonce, 'utf8').digest('hex');

const routePoint = (id: string, label: string, latitude: number, longitude: number, radiusMeters: number) => ({
  id,
  label,
  latitude,
  longitude,
  radiusMeters,
});

const serializeCoordinate = (coordinate: PromotionCoordinateJson): PromotionCoordinate => ({
  latitude: Number(coordinate.latitude),
  longitude: Number(coordinate.longitude),
});

const serializeCheckpoint = (checkpoint: PromotionRouteCheckpoint) => ({
  id: String(checkpoint.id),
  sequence: checkpoint.sequence,
  phase: publicPhase(checkpoint.phase),
  label: checkpoint.label,
  instruction: checkpoint.instruction,
  requiredDwellSeconds: checkpoint.requiredDwellSeconds,
  point: routePoint(
    String(checkpoint.id),
    checkpoint.label,
    checkpoint.latitude,
    checkpoint.longitude,
    checkpoint.radiusMeters,
  ),
});

const serializeRouteVersion = (routeVersion: PromotionRouteVersion, checkpoints: PromotionRouteCheckpoint[]) => {
  const policy = normalizePromotionPolicy(routeVersion.policyJson);
  return {
    routeVersionId: String(routeVersion.id),
    routePlanId: String(routeVersion.routePlanId),
    versionNumber: routeVersion.versionNumber,
    publishedAtUtc: iso(routeVersion.publishedAt) ?? iso(routeVersion.createdAt) ?? new Date(0).toISOString(),
    routeName: routeVersion.routeName,
    hostelName: routeVersion.hostelName ?? routeVersion.routeName,
    start: routePoint(
      `route-${routeVersion.id}-start`,
      routeVersion.startLabel,
      routeVersion.startLatitude,
      routeVersion.startLongitude,
      routeVersion.startRadiusMeters,
    ),
    streetPolyline: (routeVersion.streetPolyline ?? []).map(serializeCoordinate),
    streetCheckpoints: checkpoints
      .filter((checkpoint) => checkpoint.phase === 'street')
      .sort((left, right) => left.sequence - right.sequence)
      .map(serializeCheckpoint),
    hostelPolyline: (routeVersion.hostelPolyline ?? []).map(serializeCoordinate),
    hostelCheckpoints: checkpoints
      .filter((checkpoint) => checkpoint.phase === 'hostel')
      .sort((left, right) => left.sequence - right.sequence)
      .map(serializeCheckpoint),
    finish: routePoint(
      `route-${routeVersion.id}-finish`,
      routeVersion.finishLabel,
      routeVersion.finishLatitude,
      routeVersion.finishLongitude,
      routeVersion.finishRadiusMeters,
    ),
    policy,
  };
};

const allowed = (actions: string[], blockingReasons: Record<string, string[]> = {}): AllowedActions => ({
  actions,
  blockingReasons,
});

const pushBlocker = (blockers: Record<string, string[]>, action: string, reason: string): void => {
  blockers[action] = [...(blockers[action] ?? []), reason];
};

const getCheckpoints = async (
  routeVersionId: number,
  transaction?: Transaction,
): Promise<PromotionRouteCheckpoint[]> =>
  PromotionRouteCheckpoint.findAll({
    where: { routeVersionId },
    order: [['phase', 'ASC'], ['sequence', 'ASC']],
    transaction,
  });

const loadShiftContext = async (
  shiftInstanceId: number,
  transaction?: Transaction,
): Promise<{ shift: ShiftInstance; week: ScheduleWeek; shiftType: ShiftType; assignments: ShiftAssignment[] }> => {
  const shift = await ShiftInstance.findByPk(shiftInstanceId, { transaction });
  if (!shift) throw new HttpError(404, 'Promotion shift was not found.');
  const [week, shiftType, assignments] = await Promise.all([
    ScheduleWeek.findByPk(shift.scheduleWeekId, { transaction }),
    ShiftType.findByPk(shift.shiftTypeId, { transaction }),
    ShiftAssignment.findAll({
      where: { shiftInstanceId },
      include: [{ model: User, as: 'assignee', attributes: ['id', 'firstName', 'lastName'] }],
      order: [['id', 'ASC']],
      transaction,
    }),
  ]);
  if (!week) throw new HttpError(409, 'Promotion shift is missing its schedule week.');
  if (!shiftType || !isPromotionShiftType(shiftType)) {
    throw new HttpError(409, 'This shift is not a published promotion staffing shift.');
  }
  if (week.state !== 'published') {
    throw new HttpError(409, 'Promotion tracking is available only for published schedules.');
  }
  return { shift, week, shiftType, assignments };
};

const loadAssignmentContext = async (
  assignmentId: number,
  actorUserId: number,
  transaction?: Transaction,
): Promise<LoadedAssignmentContext> => {
  const assignment = await ShiftAssignment.findOne({ where: { id: assignmentId, userId: actorUserId }, transaction });
  if (!assignment) throw new HttpError(404, 'Current authenticated assignment was not found.');
  const { shift, week, shiftType, assignments } = await loadShiftContext(assignment.shiftInstanceId, transaction);
  const teamAssignment = await PromotionTeamAssignment.findOne({
    where: { shiftInstanceId: shift.id },
    order: [['id', 'ASC']],
    transaction,
  });
  if (!teamAssignment) {
    throw new HttpError(409, 'No published promotion route has been assigned to this shift.');
  }
  const routeVersion = await PromotionRouteVersion.findByPk(teamAssignment.routeVersionId, { transaction });
  if (!routeVersion || routeVersion.status !== 'published') {
    throw new HttpError(409, 'The assigned promotion route version is not published.');
  }
  const checkpoints = await getCheckpoints(routeVersion.id, transaction);
  const scheduledStartUtc = dateFromShift(shift, week, shift.timeStart);
  if (!scheduledStartUtc) throw new HttpError(409, 'Promotion shift start time is invalid.');
  const scheduledEndUtc = dateFromShift(shift, week, shift.timeEnd);
  return {
    assignment,
    shift,
    week,
    shiftType,
    teamAssignment,
    routeVersion,
    checkpoints,
    shiftAssignments: assignments,
    scheduledStartUtc,
    scheduledEndUtc,
  };
};

const findMyPromotionContexts = async (actorUserId: number): Promise<LoadedAssignmentContext[]> => {
  const assignments = await ShiftAssignment.findAll({
    where: { userId: actorUserId },
    order: [['id', 'DESC']],
    limit: 100,
  });
  const contexts: LoadedAssignmentContext[] = [];
  for (const assignment of assignments) {
    try {
      contexts.push(await loadAssignmentContext(assignment.id, actorUserId));
    } catch (error) {
      if ((error as { status?: number }).status === 404) continue;
      if ((error as { status?: number }).status === 409) continue;
      throw error;
    }
  }
  const now = Date.now();
  return contexts
    .filter((context) => {
      const start = context.scheduledStartUtc.valueOf();
      const end = context.scheduledEndUtc?.valueOf()
        ?? start + (normalizePromotionPolicy(context.routeVersion.policyJson).streetExpectedDurationMinutes
          + normalizePromotionPolicy(context.routeVersion.policyJson).hostelExpectedDurationMinutes
          + 120) * 60_000;
      return now >= start - 24 * 60 * 60_000 && now <= end + 24 * 60 * 60_000;
    })
    .sort((left, right) => Math.abs(left.scheduledStartUtc.valueOf() - now) - Math.abs(right.scheduledStartUtc.valueOf() - now));
};

const buildAssignmentSummary = (context: LoadedAssignmentContext) => ({
  assignmentId: String(context.assignment.id),
  shiftInstanceId: String(context.shift.id),
  scheduledStartUtc: context.scheduledStartUtc.toISOString(),
  scheduledEndUtc: iso(context.scheduledEndUtc),
  roleLabel: context.assignment.roleInShift || 'Promotion staff',
  routeVersionId: String(context.routeVersion.id),
  teamId: String(context.teamAssignment.id),
  hostelId: context.teamAssignment.hostelVenueId != null
    ? String(context.teamAssignment.hostelVenueId)
    : `route-${context.routeVersion.id}-finish`,
  hostelName: context.teamAssignment.hostelLabel ?? context.routeVersion.hostelName ?? 'Assigned hostel',
});

const startTimingBlockers = (context: LoadedAssignmentContext, now: Date): string[] => {
  const policy = normalizePromotionPolicy(context.routeVersion.policyJson);
  const startMs = context.scheduledStartUtc.valueOf();
  const earliest = startMs - policy.preShiftCheckInWindowMinutes * 60_000;
  const expectedEnd = context.scheduledEndUtc?.valueOf()
    ?? startMs + (policy.streetExpectedDurationMinutes + policy.hostelExpectedDurationMinutes + 120) * 60_000;
  if (now.valueOf() < earliest) {
    return [`Check-in opens ${policy.preShiftCheckInWindowMinutes} minutes before the scheduled start.`];
  }
  if (now.valueOf() > expectedEnd + 2 * 60 * 60_000) {
    return ['This promotion shift is outside the configured tracking window. Ask a manager for an audited exception.'];
  }
  return [];
};

const teamProofBlockers = async (
  context: LoadedAssignmentContext,
  transaction?: Transaction,
): Promise<string[]> => {
  const policy = normalizePromotionPolicy(context.routeVersion.policyJson);
  if (policy.requiredParticipantProof !== 'all_assigned') return [];
  if (context.shiftAssignments.length <= 1) return [];

  const maxAgeMs = (policy.participantProofMaxAgeSeconds ?? DEFAULT_PROMOTION_ROUTE_POLICY.participantProofMaxAgeSeconds ?? 120) * 1000;
  const since = new Date(Date.now() - maxAgeMs);
  const acceptedResponses = await PromotionCoPresenceResponse.findAll({
    where: {
      userId: { [Op.in]: context.shiftAssignments.map((assignment) => assignment.userId) },
      status: { [Op.in]: ['accepted', 'review_required'] },
      respondedAt: { [Op.gte]: since },
    },
    include: [{
      model: PromotionCoPresenceChallenge,
      as: 'challenge',
      where: { teamAssignmentId: context.teamAssignment.id },
      required: true,
    }],
    transaction,
  });
  const acceptedUserIds = new Set(acceptedResponses.map((response) => response.userId));
  const missing = context.shiftAssignments.filter((assignment) => !acceptedUserIds.has(assignment.userId));
  return missing.length > 0
    ? ['Each assigned participant must confirm from their own authenticated device or submit a manager-reviewed fallback.']
    : [];
};

const makeSessionQuality = (
  previous: PromotionVerificationQuality,
  decisionQuality: PromotionVerificationQuality,
): PromotionVerificationQuality => strongestQuality(previous, decisionQuality);

const assertExpectedSessionVersion = (session: PromotionSession, expectedSessionVersion: number | null): void => {
  if (expectedSessionVersion == null) throw new HttpError(400, 'expectedSessionVersion is required.');
  if (session.sessionVersion !== expectedSessionVersion) {
    throw new HttpError(409, 'This promotion session changed. Refresh before retrying.', {
      expectedSessionVersion: session.sessionVersion,
    });
  }
};

const loadSession = async (
  sessionId: number,
  transaction?: Transaction,
  lock?: boolean,
): Promise<PromotionSession> => {
  const session = await PromotionSession.findByPk(sessionId, {
    transaction,
    lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
  });
  if (!session) throw new HttpError(404, 'Promotion session was not found.');
  return session;
};

const assertSessionParticipant = async (
  session: PromotionSession,
  actorUserId: number,
  transaction?: Transaction,
): Promise<PromotionSessionParticipant> => {
  const participant = await PromotionSessionParticipant.findOne({
    where: { sessionId: session.id, userId: actorUserId },
    transaction,
  });
  if (!participant) throw new HttpError(403, 'Only assigned participants can update this promotion session.');
  return participant;
};

const createParticipants = async (
  session: PromotionSession,
  assignments: ShiftAssignment[],
  starterAssignmentId: number,
  decisionQuality: PromotionVerificationQuality,
  firstProofAt: Date | null,
  transaction: Transaction,
): Promise<void> => {
  await Promise.all(assignments.map((assignment) => PromotionSessionParticipant.create({
    sessionId: session.id,
    shiftAssignmentId: assignment.id,
    userId: assignment.userId,
    proofStatus: assignment.id === starterAssignmentId ? 'own_device' : 'pending',
    verificationQuality: assignment.id === starterAssignmentId ? decisionQuality : 'REVIEW_REQUIRED',
    proofReceivedAt: assignment.id === starterAssignmentId ? firstProofAt : null,
    lastHeartbeatAt: assignment.id === starterAssignmentId ? firstProofAt : null,
    proofMetadata: {},
  }, { transaction })));
};

const nextCheckpointFor = (
  lifecycle: PromotionLifecycleStatus,
  checkpoints: PromotionRouteCheckpoint[],
  visits: PromotionCheckpointVisit[],
): PromotionRouteCheckpoint | null => {
  const phase = lifecycle === 'STREET_ACTIVE' ? 'street' : lifecycle === 'HOSTEL_ACTIVE' ? 'hostel' : null;
  if (!phase) return null;
  const completed = new Set(visits.map((visit) => Number(visit.routeCheckpointId)));
  return checkpoints
    .filter((checkpoint) => checkpoint.phase === phase)
    .sort((left, right) => left.sequence - right.sequence)
    .find((checkpoint) => !completed.has(Number(checkpoint.id))) ?? null;
};

const buildSessionAllowedActions = (
  session: PromotionSession,
  nextCheckpoint: PromotionRouteCheckpoint | null,
  checkpoints: PromotionRouteCheckpoint[],
  visits: PromotionCheckpointVisit[],
): AllowedActions => {
  if (TERMINAL_LIFECYCLES.includes(session.lifecycle)) return allowed([]);
  const actions = ['REPORT_PROBLEM'];
  const blockers: Record<string, string[]> = {};
  if (nextCheckpoint) {
    actions.push('ACCEPT_CHECKPOINT');
  } else if (session.lifecycle === 'STREET_ACTIVE') {
    pushBlocker(blockers, 'ACCEPT_CHECKPOINT', 'Street checkpoints are complete; wait for the server transition.');
  }

  if (session.lifecycle === 'HOSTEL_ACTIVE') {
    const hostelCheckpointIds = checkpoints
      .filter((checkpoint) => checkpoint.phase === 'hostel')
      .map((checkpoint) => Number(checkpoint.id));
    const visited = new Set(visits.map((visit) => Number(visit.routeCheckpointId)));
    const missingHostel = hostelCheckpointIds.filter((id) => !visited.has(id));
    if (missingHostel.length === 0) {
      actions.push('FINISH');
    } else {
      pushBlocker(blockers, 'FINISH', `${missingHostel.length} hostel checkpoint(s) remain.`);
    }
  } else {
    pushBlocker(blockers, 'FINISH', 'Finish is available only during the hostel run.');
  }
  return allowed(actions, blockers);
};

export const serializePromotionSession = async (
  session: PromotionSession,
  options: SessionSnapshotOptions,
) => {
  const [routeVersion, checkpoints, visits, participants] = await Promise.all([
    PromotionRouteVersion.findByPk(session.routeVersionId, { transaction: options.transaction }),
    getCheckpoints(session.routeVersionId, options.transaction),
    PromotionCheckpointVisit.findAll({
      where: { sessionId: session.id },
      order: [['phase', 'ASC'], ['sequence', 'ASC']],
      transaction: options.transaction,
    }),
    PromotionSessionParticipant.findAll({
      where: { sessionId: session.id },
      include: [
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
        { model: ShiftAssignment, as: 'shiftAssignment' },
      ],
      order: [['id', 'ASC']],
      transaction: options.transaction,
    }),
  ]);
  if (!routeVersion) throw new HttpError(409, 'Session route version is missing.');
  const currentParticipant = participants.find((participant) => participant.userId === options.actorUserId) ?? null;
  const nextCheckpoint = nextCheckpointFor(session.lifecycle, checkpoints, visits);
  const completedCheckpointIds = visits.map((visit) => String(visit.routeCheckpointId));
  const allowedActions = buildSessionAllowedActions(session, nextCheckpoint, checkpoints, visits);
  return {
    sessionId: String(session.id),
    participantSessionId: currentParticipant ? String(currentParticipant.id) : '',
    lifecycle: session.lifecycle,
    phase: publicPhase(currentPhase(session)),
    expectedSessionVersion: session.sessionVersion,
    routeVersionId: String(session.routeVersionId),
    assignmentId: String(session.assignmentId),
    streetStartedAtUtc: iso(session.streetStartedAt),
    streetCompletedAtUtc: iso(session.streetCompletedAt),
    hostelStartedAtUtc: iso(session.hostelStartedAt),
    completedAtUtc: iso(session.completedAt),
    abortedAtUtc: iso(session.abortedAt),
    nextCheckpointId: nextCheckpoint ? String(nextCheckpoint.id) : null,
    nextCheckpointLabel: nextCheckpoint?.label ?? null,
    completedCheckpointIds,
    quality: session.verificationQuality,
    verificationQuality: session.verificationQuality,
    allowedActions,
    participants: participants.map((participant) => {
      const user = (participant as unknown as { user?: User | null }).user ?? null;
      return {
        participantId: String(participant.id),
        assignmentId: String(participant.shiftAssignmentId),
        displayName: displayName(user, `Staff #${participant.userId}`),
        isCurrentUser: participant.userId === options.actorUserId,
        proofStatus: participant.proofStatus,
        lastProofAtUtc: iso(participant.proofReceivedAt),
        lastHeartbeatAtUtc: iso(participant.lastHeartbeatAt),
        quality: participant.verificationQuality,
        verificationQuality: participant.verificationQuality,
      };
    }),
    serverMessage: options.serverMessage ?? null,
  };
};

export const getPromotionToday = async (actorUserId: number) => {
  const contexts = await findMyPromotionContexts(actorUserId);
  const context = contexts[0] ?? null;
  if (!context) {
    return {
      today: {
        assignment: null,
        routeVersion: null,
        activeSession: null,
        upcomingReminders: [],
        allowedActions: allowed([], { START: ['No published promotion assignment with a route was found for today.'] }),
        serverTimeUtc: new Date().toISOString(),
      },
    };
  }
  const activeSession = await PromotionSession.findOne({
    where: {
      shiftInstanceId: context.shift.id,
      lifecycle: { [Op.in]: ACTIVE_LIFECYCLES },
    },
    order: [['id', 'DESC']],
  });
  const blockers: Record<string, string[]> = {};
  startTimingBlockers(context, new Date()).forEach((reason) => pushBlocker(blockers, 'START', reason));
  if (activeSession) {
    pushBlocker(blockers, 'START', 'This team already has an active promotion tracking session.');
  }
  const upcomingReminders = normalizePromotionPolicy(context.routeVersion.policyJson).reminderOffsetsMinutes
    .map((minutes) => new Date(context.scheduledStartUtc.valueOf() - minutes * 60_000))
    .filter((date) => date.valueOf() > Date.now())
    .map((date) => date.toISOString());
  return {
    today: {
      assignment: buildAssignmentSummary(context),
      routeVersion: serializeRouteVersion(context.routeVersion, context.checkpoints),
      activeSession: activeSession
        ? await serializePromotionSession(activeSession, { actorUserId })
        : null,
      upcomingReminders,
      allowedActions: allowed(Object.keys(blockers).length ? [] : ['START', 'CREATE_TEAM_CHALLENGE'], blockers),
      serverTimeUtc: new Date().toISOString(),
    },
  };
};

export const startPromotionSession = async (input: {
  actorUserId: number;
  assignmentId: unknown;
  routeVersionId: unknown;
  body: Record<string, unknown>;
  idempotencyKey: unknown;
}) => {
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const assignmentId = parsePositiveInt(input.assignmentId, 'assignmentId');
  const routeVersionId = parsePositiveInt(input.routeVersionId, 'routeVersionId');
  const existing = await PromotionSession.findOne({ where: { idempotencyKey } });
  if (existing) {
    await assertSessionParticipant(existing, input.actorUserId);
    return { session: await serializePromotionSession(existing, { actorUserId: input.actorUserId, serverMessage: 'Already started.' }) };
  }

  const result = await sequelize.transaction(async (transaction) => {
    const context = await loadAssignmentContext(assignmentId, input.actorUserId, transaction);
    if (Number(context.routeVersion.id) !== routeVersionId) {
      throw new HttpError(409, 'The submitted route version does not match the published assignment route.');
    }
    const timingBlockers = startTimingBlockers(context, new Date());
    if (timingBlockers.length) throw new HttpError(409, timingBlockers[0], { blockingReasons: { START: timingBlockers } });
    const active = await PromotionSession.findOne({
      where: {
        [Op.or]: [
          { assignmentId: context.assignment.id },
          { teamAssignmentId: context.teamAssignment.id },
        ],
        lifecycle: { [Op.in]: ACTIVE_LIFECYCLES },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (active) throw new HttpError(409, 'This assignment or team already has an active promotion session.');

    const proofs = coerceProofs(input.body.locationProofs ?? input.body.locationProof);
    const policy = normalizePromotionPolicy(context.routeVersion.policyJson);
    const dwell = evaluateLocationDwell({
      proofs,
      target: { latitude: context.routeVersion.startLatitude, longitude: context.routeVersion.startLongitude },
      radiusMeters: context.routeVersion.startRadiusMeters,
      maxHorizontalAccuracyMeters: policy.maxHorizontalAccuracyMeters,
      requiredDwellSeconds: policy.startDwellSeconds,
      consecutiveFixesRequired: policy.consecutiveFixesRequired,
      maxAgeSeconds: policy.participantProofMaxAgeSeconds ?? DEFAULT_PROMOTION_ROUTE_POLICY.participantProofMaxAgeSeconds ?? 120,
      now: new Date(),
    });
    const proofBlockers = await teamProofBlockers(context, transaction);
    if (!dwell.accepted || proofBlockers.length > 0) {
      throw new HttpError(409, 'Start requirements are not satisfied.', {
        blockingReasons: { START: [...dwell.blockers, ...proofBlockers] },
      });
    }
    const startedAt = new Date();
    const session = await PromotionSession.create({
      shiftInstanceId: context.shift.id,
      assignmentId: context.assignment.id,
      teamAssignmentId: context.teamAssignment.id,
      routeVersionId: context.routeVersion.id,
      startedBy: input.actorUserId,
      lifecycle: 'STREET_ACTIVE',
      verificationQuality: dwell.quality,
      sessionVersion: 1,
      idempotencyKey,
      firstAcceptedProofAt: dwell.firstAcceptedProofAt,
      streetStartedAt: startedAt,
      qualityFlags: dwell.reviewFlags,
      serverMetadata: {
        startDistanceMeters: dwell.distanceMeters,
        startDwellSeconds: dwell.dwellSeconds,
      },
    }, { transaction });
    await createParticipants(
      session,
      context.shiftAssignments,
      context.assignment.id,
      dwell.quality,
      dwell.firstAcceptedProofAt,
      transaction,
    );
    await audit('promotion_session_started', 'promotion_session', session.id, input.actorUserId, {
      shiftInstanceId: context.shift.id,
      routeVersionId: context.routeVersion.id,
      firstAcceptedProofAt: iso(dwell.firstAcceptedProofAt),
      quality: dwell.quality,
    }, transaction);
    return serializePromotionSession(session, {
      actorUserId: input.actorUserId,
      serverMessage: 'Street promotion tracking has started.',
      transaction,
    });
  }).catch(async (error) => {
    if (error instanceof UniqueConstraintError) {
      const duplicate = await PromotionSession.findOne({ where: { idempotencyKey } });
      if (duplicate) {
        await assertSessionParticipant(duplicate, input.actorUserId);
        return serializePromotionSession(duplicate, { actorUserId: input.actorUserId, serverMessage: 'Already started.' });
      }
    }
    throw error;
  });
  return { session: result };
};

export const acceptPromotionCheckpoint = async (input: {
  actorUserId: number;
  sessionId: unknown;
  checkpointId: unknown;
  expectedSessionVersion: unknown;
  body: Record<string, unknown>;
  idempotencyKey: unknown;
}) => {
  const sessionId = parsePositiveInt(input.sessionId, 'sessionId');
  const checkpointId = parsePositiveInt(input.checkpointId, 'checkpointId');
  const expectedSessionVersion = parseExpectedVersion(input.expectedSessionVersion ?? input.body.expectedSessionVersion);
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);

  const existingVisit = await PromotionCheckpointVisit.findOne({ where: { idempotencyKey } });
  if (existingVisit) {
    const existingSession = await loadSession(existingVisit.sessionId);
    await assertSessionParticipant(existingSession, input.actorUserId);
    return { session: await serializePromotionSession(existingSession, { actorUserId: input.actorUserId, serverMessage: 'Checkpoint already accepted.' }) };
  }

  const result = await sequelize.transaction(async (transaction) => {
    const session = await loadSession(sessionId, transaction, true);
    await assertSessionParticipant(session, input.actorUserId, transaction);
    assertExpectedSessionVersion(session, expectedSessionVersion);
    if (!ACTIVE_LIFECYCLES.includes(session.lifecycle)) {
      throw new HttpError(409, 'Only active sessions can accept checkpoints.');
    }
    const [routeVersion, checkpoints, visits] = await Promise.all([
      PromotionRouteVersion.findByPk(session.routeVersionId, { transaction }),
      getCheckpoints(session.routeVersionId, transaction),
      PromotionCheckpointVisit.findAll({ where: { sessionId: session.id }, transaction, lock: transaction.LOCK.UPDATE }),
    ]);
    if (!routeVersion) throw new HttpError(409, 'Session route version is missing.');
    const checkpoint = checkpoints.find((item) => Number(item.id) === checkpointId);
    if (!checkpoint) throw new HttpError(404, 'Checkpoint was not found on this route version.');
    const nextCheckpoint = nextCheckpointFor(session.lifecycle, checkpoints, visits);
    if (!nextCheckpoint || Number(nextCheckpoint.id) !== checkpointId) {
      throw new HttpError(409, 'Checkpoints must be accepted once and in order.');
    }
    const policy = normalizePromotionPolicy(routeVersion.policyJson);
    const proofs = coerceProofs(input.body.locationProofs ?? input.body.locationProof);
    const dwell = evaluateLocationDwell({
      proofs,
      target: { latitude: checkpoint.latitude, longitude: checkpoint.longitude },
      radiusMeters: checkpoint.radiusMeters,
      maxHorizontalAccuracyMeters: policy.maxHorizontalAccuracyMeters,
      requiredDwellSeconds: checkpoint.requiredDwellSeconds || policy.checkpointDwellSeconds,
      consecutiveFixesRequired: policy.consecutiveFixesRequired,
      maxAgeSeconds: policy.participantProofMaxAgeSeconds ?? DEFAULT_PROMOTION_ROUTE_POLICY.participantProofMaxAgeSeconds ?? 120,
      now: new Date(),
    });
    if (!dwell.accepted) {
      throw new HttpError(409, 'Checkpoint requirements are not satisfied.', {
        blockingReasons: { ACCEPT_CHECKPOINT: dwell.blockers },
      });
    }
    const acceptedAt = new Date();
    await PromotionCheckpointVisit.create({
      sessionId: session.id,
      routeCheckpointId: checkpoint.id,
      phase: checkpoint.phase,
      sequence: checkpoint.sequence,
      acceptedAt,
      dwellSeconds: dwell.dwellSeconds,
      idempotencyKey,
      evidenceJson: {
        distanceMeters: dwell.distanceMeters,
        firstAcceptedProofAt: iso(dwell.firstAcceptedProofAt),
        boundaryProofAt: iso(dwell.boundaryProofAt),
        reviewFlags: dwell.reviewFlags,
      },
    }, { transaction });

    const samePhaseCheckpoints = checkpoints.filter((item) => item.phase === checkpoint.phase);
    const isLastInPhase = checkpoint.sequence === Math.max(...samePhaseCheckpoints.map((item) => item.sequence));
    const nextQuality = makeSessionQuality(session.verificationQuality, dwell.quality);
    const flags = Array.from(new Set([...(session.qualityFlags ?? []), ...dwell.reviewFlags]));
    const update: Partial<PromotionSession> & Record<string, unknown> = {
      verificationQuality: nextQuality,
      sessionVersion: session.sessionVersion + 1,
      qualityFlags: flags,
    };
    let message = 'Checkpoint accepted.';
    if (checkpoint.phase === 'street' && isLastInPhase) {
      update.lifecycle = 'HOSTEL_ACTIVE';
      update.streetCompletedAt = acceptedAt;
      update.hostelStartedAt = acceptedAt;
      update.actualStreetDurationSeconds = session.streetStartedAt
        ? Math.max(0, Math.floor((acceptedAt.valueOf() - session.streetStartedAt.valueOf()) / 1000))
        : null;
      message = 'Street route complete—hostel run tracking has started.';
    }
    await session.update(update, { transaction });
    await audit('promotion_checkpoint_accepted', 'promotion_session', session.id, input.actorUserId, {
      checkpointId,
      phase: checkpoint.phase,
      atomicHostelTransition: checkpoint.phase === 'street' && isLastInPhase,
      acceptedAt: acceptedAt.toISOString(),
    }, transaction);
    return serializePromotionSession(session, { actorUserId: input.actorUserId, serverMessage: message, transaction });
  }).catch(async (error) => {
    if (error instanceof UniqueConstraintError) {
      const duplicate = await PromotionCheckpointVisit.findOne({ where: { idempotencyKey } });
      if (duplicate) {
        const duplicateSession = await loadSession(duplicate.sessionId);
        await assertSessionParticipant(duplicateSession, input.actorUserId);
        return serializePromotionSession(duplicateSession, { actorUserId: input.actorUserId, serverMessage: 'Checkpoint already accepted.' });
      }
    }
    throw error;
  });
  return { session: result };
};

export const finishPromotionSession = async (input: {
  actorUserId: number;
  sessionId: unknown;
  expectedSessionVersion: unknown;
  body: Record<string, unknown>;
  idempotencyKey: unknown;
}) => {
  const sessionId = parsePositiveInt(input.sessionId, 'sessionId');
  const expectedSessionVersion = parseExpectedVersion(input.expectedSessionVersion ?? input.body.expectedSessionVersion);
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const result = await sequelize.transaction(async (transaction) => {
    const session = await loadSession(sessionId, transaction, true);
    await assertSessionParticipant(session, input.actorUserId, transaction);
    if (session.lifecycle === 'COMPLETED' && session.serverMetadata?.finishIdempotencyKey === idempotencyKey) {
      return serializePromotionSession(session, { actorUserId: input.actorUserId, serverMessage: 'Already completed.', transaction });
    }
    assertExpectedSessionVersion(session, expectedSessionVersion);
    if (session.lifecycle === 'COMPLETED') {
      return serializePromotionSession(session, { actorUserId: input.actorUserId, serverMessage: 'Already completed.', transaction });
    }
    if (session.lifecycle !== 'HOSTEL_ACTIVE') throw new HttpError(409, 'Finish is available only during the hostel run.');
    const [routeVersion, checkpoints, visits] = await Promise.all([
      PromotionRouteVersion.findByPk(session.routeVersionId, { transaction }),
      getCheckpoints(session.routeVersionId, transaction),
      PromotionCheckpointVisit.findAll({ where: { sessionId: session.id }, transaction }),
    ]);
    if (!routeVersion) throw new HttpError(409, 'Session route version is missing.');
    const completed = new Set(visits.map((visit) => Number(visit.routeCheckpointId)));
    const missing = checkpoints.filter((checkpoint) => !completed.has(Number(checkpoint.id)));
    if (missing.length > 0) {
      throw new HttpError(409, 'Finish requirements are not satisfied.', {
        blockingReasons: { FINISH: [`${missing.length} checkpoint(s) remain.`] },
      });
    }
    const policy = normalizePromotionPolicy(routeVersion.policyJson);
    const dwell = evaluateLocationDwell({
      proofs: coerceProofs(input.body.locationProofs ?? input.body.locationProof),
      target: { latitude: routeVersion.finishLatitude, longitude: routeVersion.finishLongitude },
      radiusMeters: routeVersion.finishRadiusMeters,
      maxHorizontalAccuracyMeters: policy.maxHorizontalAccuracyMeters,
      requiredDwellSeconds: policy.finishDwellSeconds,
      consecutiveFixesRequired: policy.consecutiveFixesRequired,
      maxAgeSeconds: policy.participantProofMaxAgeSeconds ?? DEFAULT_PROMOTION_ROUTE_POLICY.participantProofMaxAgeSeconds ?? 120,
      now: new Date(),
    });
    if (!dwell.accepted) {
      throw new HttpError(409, 'Finish requirements are not satisfied.', {
        blockingReasons: { FINISH: dwell.blockers },
      });
    }
    const completedAt = new Date();
    const flags = Array.from(new Set([...(session.qualityFlags ?? []), ...dwell.reviewFlags]));
    await session.update({
      lifecycle: 'COMPLETED',
      verificationQuality: makeSessionQuality(session.verificationQuality, dwell.quality),
      completedAt,
      sessionVersion: session.sessionVersion + 1,
      actualHostelDurationSeconds: session.hostelStartedAt
        ? Math.max(0, Math.floor((completedAt.valueOf() - session.hostelStartedAt.valueOf()) / 1000))
        : null,
      qualityFlags: flags,
      serverMetadata: {
        ...(session.serverMetadata ?? {}),
        finishIdempotencyKey: idempotencyKey,
        finishDistanceMeters: dwell.distanceMeters,
      },
    }, { transaction });
    const attendances = await VolunteerShiftAttendance.findAll({
      where: { shiftAssignmentId: session.assignmentId },
      transaction,
    });
    await audit('promotion_session_completed', 'promotion_session', session.id, input.actorUserId, {
      completedAt: completedAt.toISOString(),
      attendanceDecisionPreserved: attendances.length > 0,
      quality: session.verificationQuality,
    }, transaction);
    return serializePromotionSession(session, {
      actorUserId: input.actorUserId,
      serverMessage: 'Promotion route complete.',
      transaction,
    });
  });
  return { session: result };
};

export const abortPromotionSession = async (input: {
  actorUserId: number;
  sessionId: unknown;
  expectedSessionVersion: unknown;
  reason: unknown;
  body: Record<string, unknown>;
  idempotencyKey: unknown;
}) => {
  const sessionId = parsePositiveInt(input.sessionId, 'sessionId');
  const expectedSessionVersion = parseExpectedVersion(input.expectedSessionVersion ?? input.body.expectedSessionVersion);
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 2000) throw new HttpError(400, 'A report-problem reason is required.');
  const result = await sequelize.transaction(async (transaction) => {
    const session = await loadSession(sessionId, transaction, true);
    const participant = await assertSessionParticipant(session, input.actorUserId, transaction);
    if (session.lifecycle === 'ABORTED' && session.serverMetadata?.abortIdempotencyKey === idempotencyKey) {
      return serializePromotionSession(session, { actorUserId: input.actorUserId, serverMessage: 'Session is already aborted.', transaction });
    }
    assertExpectedSessionVersion(session, expectedSessionVersion);
    if (!ACTIVE_LIFECYCLES.includes(session.lifecycle)) {
      return serializePromotionSession(session, { actorUserId: input.actorUserId, serverMessage: 'Session is no longer active.', transaction });
    }
    const abortedAt = new Date();
    await PromotionIncident.create({
      sessionId: session.id,
      participantSessionId: participant.id,
      reportedBy: input.actorUserId,
      category: 'abort',
      reason,
      status: 'open',
      evidenceJson: {
        proofProvided: Boolean(input.body.locationProof),
      },
    }, { transaction });
    await session.update({
      lifecycle: 'ABORTED',
      abortedAt,
      sessionVersion: session.sessionVersion + 1,
      verificationQuality: strongestQuality(session.verificationQuality, 'REVIEW_REQUIRED'),
      qualityFlags: Array.from(new Set([...(session.qualityFlags ?? []), 'participant_abort'])),
      serverMetadata: {
        ...(session.serverMetadata ?? {}),
        abortIdempotencyKey: idempotencyKey,
      },
    }, { transaction });
    await audit('promotion_session_aborted', 'promotion_session', session.id, input.actorUserId, {
      abortedAt: abortedAt.toISOString(),
      reasonLength: reason.length,
    }, transaction);
    return serializePromotionSession(session, {
      actorUserId: input.actorUserId,
      serverMessage: 'Problem report received. Tracking has stopped for this session.',
      transaction,
    });
  });
  return { session: result };
};

type UploadSamplePayload = PromotionLocationProofPayload & {
  eventId?: string;
  participantSessionId?: string | number;
  sessionId?: string | number;
  sequence?: string | number;
  phase?: string;
};

const parseUploadSample = (raw: unknown): UploadSamplePayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const proof = coerceProofs(record)[0];
  if (!proof) return null;
  return {
    ...proof,
    eventId: typeof record.eventId === 'string' ? record.eventId : undefined,
    participantSessionId: record.participantSessionId as string | number | undefined,
    sessionId: record.sessionId as string | number | undefined,
    sequence: record.sequence as string | number | undefined,
    phase: typeof record.phase === 'string' ? record.phase : undefined,
  };
};

export const uploadPromotionLocationSamples = async (input: {
  actorUserId: number;
  body: Record<string, unknown>;
}) => {
  const rawSamples = Array.isArray(input.body.samples) ? input.body.samples : [];
  if (rawSamples.length > 500) throw new HttpError(413, 'Upload at most 500 promotion location samples per batch.');
  const acceptedEventIds: string[] = [];
  const duplicateEventIds: string[] = [];
  const rejectedEvents: Record<string, string> = {};

  for (const raw of rawSamples) {
    const sample = parseUploadSample(raw);
    const eventId = sample?.eventId ?? `invalid-${acceptedEventIds.length + duplicateEventIds.length + Object.keys(rejectedEvents).length}`;
    try {
      if (!sample?.eventId) throw new HttpError(400, 'eventId is required.');
      const sessionId = parsePositiveInt(sample.sessionId, 'sessionId');
      const participantSessionId = parsePositiveInt(sample.participantSessionId, 'participantSessionId');
      const sequence = parsePositiveInt(sample.sequence, 'sequence');
      const phase = normalizePhase(sample.phase);
      if (!phase) throw new HttpError(400, 'phase must be STREET or HOSTEL.');
      const capturedAt = new Date(sample.capturedAtUtc);
      if (!Number.isFinite(capturedAt.valueOf())) throw new HttpError(400, 'capturedAtUtc is invalid.');

      const existing = await PromotionLocationSample.findOne({ where: { sessionId, eventId: sample.eventId } });
      if (existing) {
        duplicateEventIds.push(sample.eventId);
        continue;
      }
      const session = await PromotionSession.findByPk(sessionId);
      if (!session) throw new HttpError(404, 'Session not found.');
      if (TERMINAL_LIFECYCLES.includes(session.lifecycle)) {
        throw new HttpError(409, 'Completed/aborted sessions do not accept more locations.');
      }
      const participant = await PromotionSessionParticipant.findOne({
        where: { id: participantSessionId, sessionId, userId: input.actorUserId },
      });
      if (!participant) throw new HttpError(403, 'Participant does not belong to this authenticated user/session.');
      const reviewFlags = sample.mockLocationSignal === true ? ['mock_location_signal'] : [];
      await PromotionLocationSample.create({
        sessionId,
        participantSessionId,
        userId: input.actorUserId,
        eventId: sample.eventId,
        sequence,
        capturedAt,
        elapsedRealtimeNanos: String(sample.elapsedRealtimeNanos ?? ''),
        bootId: String(sample.bootId ?? ''),
        latitude: sample.latitude,
        longitude: sample.longitude,
        horizontalAccuracyMeters: sample.horizontalAccuracyMeters,
        speedMetersPerSecond: sample.speedMetersPerSecond,
        bearingDegrees: sample.bearingDegrees,
        phase,
        mockLocationSignal: sample.mockLocationSignal,
        reviewFlags,
      });
      await participant.update({
        lastHeartbeatAt: capturedAt,
        lastSequence: sequence,
        verificationQuality: reviewFlags.length ? 'REVIEW_REQUIRED' : participant.verificationQuality,
      });
      if (reviewFlags.length) {
        await session.update({
          verificationQuality: strongestQuality(session.verificationQuality, 'REVIEW_REQUIRED'),
          qualityFlags: Array.from(new Set([...(session.qualityFlags ?? []), ...reviewFlags])),
        });
      }
      acceptedEventIds.push(sample.eventId);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        duplicateEventIds.push(eventId);
      } else {
        rejectedEvents[eventId] = (error as Error).message;
      }
    }
  }

  return { acceptedEventIds, duplicateEventIds, rejectedEvents };
};

const parseCoordinatePoint = (value: RoutePointInput, label: string) => {
  const parsedLabel = typeof value.label === 'string' && value.label.trim() ? value.label.trim() : label;
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const radiusMeters = Number(value.radiusMeters);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new HttpError(400, `${label} latitude is invalid.`);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new HttpError(400, `${label} longitude is invalid.`);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) throw new HttpError(400, `${label} radiusMeters must be positive.`);
  return { label: parsedLabel, latitude, longitude, radiusMeters };
};

const parsePolyline = (value: unknown): PromotionCoordinateJson[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === 'object' ? item as Record<string, unknown> : null)
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({ latitude: Number(item.latitude), longitude: Number(item.longitude) }))
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
};

const parseCheckpointInputs = (value: unknown, phase: PromotionPhase, defaultDwell: number): CheckpointInput[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      ...record,
      phase,
      sequence: record.sequence ?? index + 1,
      requiredDwellSeconds: record.requiredDwellSeconds ?? defaultDwell,
    };
  });
};

export const createPromotionRoutePlan = async (input: {
  actorUserId: number;
  body: Record<string, unknown>;
}) => {
  const name = typeof input.body.name === 'string' ? input.body.name.trim() : '';
  if (name.length < 3 || name.length > 160) throw new HttpError(400, 'Route plan name must be 3-160 characters.');
  const description = typeof input.body.description === 'string' ? input.body.description.trim() : null;
  const plan = await PromotionRoutePlan.create({
    name,
    description,
    status: 'active',
    createdBy: input.actorUserId,
    updatedBy: input.actorUserId,
  });
  await audit('promotion_route_plan_created', 'promotion_route_plan', plan.id, input.actorUserId, { name });
  return { routePlan: plan };
};

export const createPromotionRouteVersion = async (input: {
  actorUserId: number;
  routePlanId: unknown;
  body: Record<string, unknown>;
}) => {
  const routePlanId = parsePositiveInt(input.routePlanId, 'routePlanId');
  const result = await sequelize.transaction(async (transaction) => {
    const plan = await PromotionRoutePlan.findByPk(routePlanId, { transaction });
    if (!plan || plan.status !== 'active') throw new HttpError(404, 'Active route plan was not found.');
    const latest = await PromotionRouteVersion.findOne({
      where: { routePlanId },
      order: [['versionNumber', 'DESC']],
      transaction,
    });
    const policy = normalizePromotionPolicy(input.body.policy);
    const start = parseCoordinatePoint((input.body.start ?? {}) as RoutePointInput, 'Start');
    const finish = parseCoordinatePoint((input.body.finish ?? {}) as RoutePointInput, 'Finish');
    const routeName = typeof input.body.routeName === 'string' && input.body.routeName.trim()
      ? input.body.routeName.trim()
      : plan.name;
    const version = await PromotionRouteVersion.create({
      routePlanId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      status: 'draft',
      routeName,
      defaultHostelVenueId: input.body.defaultHostelVenueId == null ? null : parsePositiveInt(input.body.defaultHostelVenueId, 'defaultHostelVenueId'),
      hostelName: typeof input.body.hostelName === 'string' ? input.body.hostelName.trim() : null,
      startLabel: start.label,
      startLatitude: start.latitude,
      startLongitude: start.longitude,
      startRadiusMeters: start.radiusMeters,
      finishLabel: finish.label,
      finishLatitude: finish.latitude,
      finishLongitude: finish.longitude,
      finishRadiusMeters: finish.radiusMeters,
      streetPolyline: parsePolyline(input.body.streetPolyline),
      hostelPolyline: parsePolyline(input.body.hostelPolyline),
      policyJson: policy,
      createdBy: input.actorUserId,
    }, { transaction });
    const streetCheckpoints = parseCheckpointInputs(input.body.streetCheckpoints, 'street', policy.checkpointDwellSeconds);
    const hostelCheckpoints = parseCheckpointInputs(input.body.hostelCheckpoints, 'hostel', policy.checkpointDwellSeconds);
    for (const checkpointInput of [...streetCheckpoints, ...hostelCheckpoints]) {
      const point = parseCoordinatePoint(checkpointInput, 'Checkpoint');
      await PromotionRouteCheckpoint.create({
        routeVersionId: version.id,
        phase: checkpointInput.phase as PromotionPhase,
        sequence: Number(checkpointInput.sequence),
        label: point.label,
        instruction: typeof checkpointInput.instruction === 'string' ? checkpointInput.instruction : '',
        latitude: point.latitude,
        longitude: point.longitude,
        radiusMeters: point.radiusMeters,
        requiredDwellSeconds: Number(checkpointInput.requiredDwellSeconds),
      }, { transaction });
    }
    await audit('promotion_route_version_created', 'promotion_route_version', version.id, input.actorUserId, {
      routePlanId,
      versionNumber: version.versionNumber,
    }, transaction);
    return version;
  });
  return {
    routeVersion: serializeRouteVersion(result, await getCheckpoints(result.id)),
  };
};

export const publishPromotionRouteVersion = async (input: {
  actorUserId: number;
  routeVersionId: unknown;
}) => {
  const routeVersionId = parsePositiveInt(input.routeVersionId, 'routeVersionId');
  const result = await sequelize.transaction(async (transaction) => {
    const version = await PromotionRouteVersion.findByPk(routeVersionId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!version) throw new HttpError(404, 'Route version was not found.');
    const checkpoints = await getCheckpoints(version.id, transaction);
    if (!checkpoints.some((checkpoint) => checkpoint.phase === 'street')) {
      throw new HttpError(409, 'Publish requires at least one street checkpoint.');
    }
    await version.update({
      status: 'published',
      publishedAt: new Date(),
      publishedBy: input.actorUserId,
    }, { transaction });
    await audit('promotion_route_version_published', 'promotion_route_version', version.id, input.actorUserId, {
      routePlanId: version.routePlanId,
      versionNumber: version.versionNumber,
    }, transaction);
    return version;
  });
  return { routeVersion: serializeRouteVersion(result, await getCheckpoints(result.id)) };
};

export const assignPromotionRouteToShift = async (input: {
  actorUserId: number;
  body: Record<string, unknown>;
}) => {
  const shiftInstanceId = parsePositiveInt(input.body.shiftInstanceId, 'shiftInstanceId');
  const routeVersionId = parsePositiveInt(input.body.routeVersionId, 'routeVersionId');
  const teamKey = typeof input.body.teamKey === 'string' && input.body.teamKey.trim()
    ? input.body.teamKey.trim()
    : 'default';
  const result = await sequelize.transaction(async (transaction) => {
    await loadShiftContext(shiftInstanceId, transaction);
    const routeVersion = await PromotionRouteVersion.findByPk(routeVersionId, { transaction });
    if (!routeVersion || routeVersion.status !== 'published') throw new HttpError(409, 'Only published route versions can be assigned.');
    const existing = await PromotionTeamAssignment.findOne({
      where: { shiftInstanceId, teamKey },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (existing) {
      const active = await PromotionSession.findOne({
        where: { teamAssignmentId: existing.id, lifecycle: { [Op.in]: ACTIVE_LIFECYCLES } },
        transaction,
      });
      if (active) throw new HttpError(409, 'Cannot change a route assignment while this team has an active session.');
      await existing.update({
        routeVersionId,
        hostelVenueId: input.body.hostelVenueId == null ? routeVersion.defaultHostelVenueId : parsePositiveInt(input.body.hostelVenueId, 'hostelVenueId'),
        hostelLabel: typeof input.body.hostelLabel === 'string' ? input.body.hostelLabel.trim() : routeVersion.hostelName,
        notes: typeof input.body.notes === 'string' ? input.body.notes.trim() : null,
      }, { transaction });
      await audit('promotion_team_assignment_updated', 'promotion_team_assignment', existing.id, input.actorUserId, {
        shiftInstanceId,
        routeVersionId,
      }, transaction);
      return existing;
    }
    const created = await PromotionTeamAssignment.create({
      shiftInstanceId,
      routeVersionId,
      hostelVenueId: input.body.hostelVenueId == null ? routeVersion.defaultHostelVenueId : parsePositiveInt(input.body.hostelVenueId, 'hostelVenueId'),
      hostelLabel: typeof input.body.hostelLabel === 'string' ? input.body.hostelLabel.trim() : routeVersion.hostelName,
      teamKey,
      notes: typeof input.body.notes === 'string' ? input.body.notes.trim() : null,
      createdBy: input.actorUserId,
    }, { transaction });
    await audit('promotion_team_assignment_created', 'promotion_team_assignment', created.id, input.actorUserId, {
      shiftInstanceId,
      routeVersionId,
    }, transaction);
    return created;
  });
  return { teamAssignment: result };
};

export const createPromotionTeamChallenge = async (input: {
  actorUserId: number;
  assignmentId: unknown;
}) => {
  const context = await loadAssignmentContext(parsePositiveInt(input.assignmentId, 'assignmentId'), input.actorUserId);
  const nonce = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 2 * 60_000);
  const challenge = await PromotionCoPresenceChallenge.create({
    teamAssignmentId: context.teamAssignment.id,
    sessionId: null,
    issuedBy: input.actorUserId,
    nonceHash: hashNonce(nonce),
    expiresAt,
    status: 'active',
    metadata: { assignmentId: context.assignment.id },
  });
  return {
    challenge: {
      challengeId: String(challenge.id),
      nonce,
      expiresAtUtc: expiresAt.toISOString(),
      teamId: String(context.teamAssignment.id),
    },
  };
};

export const respondToPromotionTeamChallenge = async (input: {
  actorUserId: number;
  nonce: unknown;
  body: Record<string, unknown>;
}) => {
  const nonce = typeof input.nonce === 'string' ? input.nonce.trim() : '';
  if (nonce.length < 16) throw new HttpError(400, 'Challenge nonce is invalid.');
  const result = await sequelize.transaction(async (transaction) => {
    const challenge = await PromotionCoPresenceChallenge.findOne({
      where: { nonceHash: hashNonce(nonce) },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!challenge || challenge.status !== 'active') throw new HttpError(410, 'Challenge has expired or was already used.');
    if (challenge.expiresAt.valueOf() < Date.now()) {
      await challenge.update({ status: 'expired' }, { transaction });
      throw new HttpError(410, 'Challenge has expired.');
    }
    const teamAssignment = await PromotionTeamAssignment.findByPk(challenge.teamAssignmentId, { transaction });
    if (!teamAssignment) throw new HttpError(404, 'Challenge team assignment was not found.');
    const assignment = await ShiftAssignment.findOne({
      where: { shiftInstanceId: teamAssignment.shiftInstanceId, userId: input.actorUserId },
      transaction,
    });
    if (!assignment) throw new HttpError(403, 'Only assigned teammates can respond to this challenge.');
    const routeVersion = await PromotionRouteVersion.findByPk(teamAssignment.routeVersionId, { transaction });
    if (!routeVersion) throw new HttpError(409, 'Challenge route version is missing.');
    const policy = normalizePromotionPolicy(routeVersion.policyJson);
    const responseKind = input.body.responseKind === 'group_selfie_fallback' ? 'group_selfie_fallback' : 'own_device';
    const dwell = evaluateLocationDwell({
      proofs: coerceProofs(input.body.locationProofs ?? input.body.locationProof),
      target: { latitude: routeVersion.startLatitude, longitude: routeVersion.startLongitude },
      radiusMeters: policy.participantProofMaxDistanceMeters ?? routeVersion.startRadiusMeters,
      maxHorizontalAccuracyMeters: policy.maxHorizontalAccuracyMeters,
      requiredDwellSeconds: 0,
      consecutiveFixesRequired: 1,
      maxAgeSeconds: policy.participantProofMaxAgeSeconds ?? DEFAULT_PROMOTION_ROUTE_POLICY.participantProofMaxAgeSeconds ?? 120,
      now: new Date(),
    });
    const status = responseKind === 'group_selfie_fallback'
      ? 'review_required'
      : dwell.accepted ? 'accepted' : 'rejected';
    const verificationQuality: PromotionVerificationQuality = responseKind === 'group_selfie_fallback'
      ? 'REVIEW_REQUIRED'
      : dwell.quality;
    const response = await PromotionCoPresenceResponse.create({
      challengeId: challenge.id,
      shiftAssignmentId: assignment.id,
      userId: input.actorUserId,
      responseKind,
      status,
      verificationQuality,
      respondedAt: new Date(),
      latitude: dwell.accepted ? coerceProofs(input.body.locationProofs ?? input.body.locationProof).at(-1)?.latitude ?? null : null,
      longitude: dwell.accepted ? coerceProofs(input.body.locationProofs ?? input.body.locationProof).at(-1)?.longitude ?? null : null,
      horizontalAccuracyMeters: dwell.accepted ? coerceProofs(input.body.locationProofs ?? input.body.locationProof).at(-1)?.horizontalAccuracyMeters ?? null : null,
      distanceFromStartMeters: dwell.distanceMeters,
      rejectionReason: status === 'rejected' ? dwell.blockers.join(' ') : null,
      photoEvidenceRef: typeof input.body.photoEvidenceRef === 'string' ? input.body.photoEvidenceRef : null,
      proofMetadata: { reviewFlags: dwell.reviewFlags },
    }, { transaction });
    await challenge.update({ status: 'used', usedAt: new Date() }, { transaction });
    return response;
  });
  return {
    response: {
      responseId: String(result.id),
      status: result.status,
      verificationQuality: result.verificationQuality,
    },
  };
};

export const listPromotionLiveSessions = async (actorUserId: number) => {
  const sessions = await PromotionSession.findAll({
    where: { lifecycle: { [Op.in]: ACTIVE_LIFECYCLES } },
    order: [['updatedAt', 'DESC']],
    limit: 100,
  });
  return {
    sessions: await Promise.all(sessions.map((session) => serializePromotionSession(session, { actorUserId }))),
  };
};

export const getPromotionSessionPlayback = async (input: {
  actorUserId: number;
  sessionId: unknown;
}) => {
  const session = await loadSession(parsePositiveInt(input.sessionId, 'sessionId'));
  const samples = await PromotionLocationSample.findAll({
    where: { sessionId: session.id },
    order: [['capturedAt', 'ASC'], ['sequence', 'ASC']],
    limit: 10_000,
  });
  return {
    session: await serializePromotionSession(session, { actorUserId: input.actorUserId }),
    samples: samples.map((sample) => ({
      eventId: sample.eventId,
      participantSessionId: String(sample.participantSessionId),
      capturedAtUtc: sample.capturedAt.toISOString(),
      sequence: String(sample.sequence),
      latitude: sample.latitude,
      longitude: sample.longitude,
      horizontalAccuracyMeters: sample.horizontalAccuracyMeters,
      phase: publicPhase(sample.phase),
      mockLocationSignal: sample.mockLocationSignal,
      reviewFlags: sample.reviewFlags,
    })),
  };
};

export const createPromotionManagerOverride = async (input: {
  actorUserId: number;
  sessionId: unknown;
  body: Record<string, unknown>;
}) => {
  const sessionId = parsePositiveInt(input.sessionId, 'sessionId');
  const reason = typeof input.body.reason === 'string' ? input.body.reason.trim() : '';
  const overrideType = typeof input.body.overrideType === 'string' ? input.body.overrideType.trim() : '';
  if (reason.length < 5 || reason.length > 2000) throw new HttpError(400, 'Manager override reason is required.');
  if (overrideType.length < 3 || overrideType.length > 64) throw new HttpError(400, 'overrideType is required.');
  const result = await sequelize.transaction(async (transaction) => {
    const session = await loadSession(sessionId, transaction, true);
    const beforeJson = {
      lifecycle: session.lifecycle,
      verificationQuality: session.verificationQuality,
      sessionVersion: session.sessionVersion,
    };
    const quality = input.body.verificationQuality === 'VERIFIED' || input.body.verificationQuality === 'DEGRADED' || input.body.verificationQuality === 'REVIEW_REQUIRED'
      ? input.body.verificationQuality
      : session.verificationQuality;
    await session.update({
      verificationQuality: quality,
      sessionVersion: session.sessionVersion + 1,
      qualityFlags: Array.from(new Set([...(session.qualityFlags ?? []), 'manager_override'])),
    }, { transaction });
    const afterJson = {
      lifecycle: session.lifecycle,
      verificationQuality: session.verificationQuality,
      sessionVersion: session.sessionVersion,
    };
    const override = await PromotionManagerOverride.create({
      sessionId: session.id,
      actorId: input.actorUserId,
      overrideType,
      reason,
      beforeJson,
      afterJson,
    }, { transaction });
    await audit('promotion_manager_override_created', 'promotion_session', session.id, input.actorUserId, {
      overrideId: override.id,
      overrideType,
    }, transaction);
    return session;
  });
  return { session: await serializePromotionSession(result, { actorUserId: input.actorUserId }) };
};
