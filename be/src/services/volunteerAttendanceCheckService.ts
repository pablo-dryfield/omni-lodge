import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op, type Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import HttpError from '../errors/HttpError.js';
import AssistantManagerTaskLog from '../models/AssistantManagerTaskLog.js';
import AssistantManagerTaskTemplate from '../models/AssistantManagerTaskTemplate.js';
import AuditLog from '../models/AuditLog.js';
import ScheduleWeek from '../models/ScheduleWeek.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftType from '../models/ShiftType.js';
import User from '../models/User.js';
import VolunteerShiftAttendance from '../models/VolunteerShiftAttendance.js';

dayjs.extend(utc);
dayjs.extend(timezone);
const TIMEZONE = 'Europe/Warsaw';
const AUDIT_ACTION = 'volunteer_attendance.checked';
export type VolunteerAttendanceCheckConfig = {
  checkKind: 'meeting_point' | 'promotion_chat';
  shiftTypeIds: number[];
  evidenceRuleKey: string;
  expectedTime: string;
};
export type AttendanceCheckActor = { actorId: number; roleSlug: string | null };
type Evidence = {
  id: string; ruleKey: string; type: string; valid?: boolean; storagePath?: string | null;
  driveFileId?: string | null; fileName?: string | null; uploadedAt?: string | null;
  uploadedBy?: number | null; subjectUserId?: number | null;
};
type Attendance = VolunteerShiftAttendance & {
  revision: number; evidenceTaskLogId: number | null; evidenceRuleKey: string | null;
  evidenceFileId: string | null; checkKind: string | null; expectedTime: string | null; lateMinutes: number | null;
};
const attendanceIdentityMatches = (attendance: Attendance | undefined, assignment: Assignment): boolean => Boolean(attendance
  && (attendance.subjectUserId == null || attendance.subjectUserId === assignment.userId)
  && (attendance.evidenceTaskLogId == null || (attendance.evidenceShiftInstanceId === assignment.shiftInstanceId
    && attendance.evidenceShiftTypeId === assignment.shiftInstance?.shiftTypeId
    && attendance.evidenceTaskLog?.id === attendance.evidenceTaskLogId && attendance.evidenceTaskLog.taskDate === assignment.shiftInstance?.date)));
type Assignment = ShiftAssignment & {
  assignee?: User;
  shiftInstance?: ShiftInstance & { shiftType?: ShiftType; scheduleWeek?: ScheduleWeek };
  volunteerAttendance?: Attendance;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const role = (value: string | null): string => {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[\s_-]/gu, '');
  return normalized === 'administrator' ? 'admin' : normalized;
};
const assertActor = (actor: AttendanceCheckActor, log: AssistantManagerTaskLog): void => {
  const actorRole = role(actor.roleSlug);
  if (!positiveId(actor.actorId)) throw new HttpError(401, 'Authentication is required.');
  if (!['admin', 'owner', 'manager', 'assistantmanager'].includes(actorRole)
    || (actorRole === 'assistantmanager' && actor.actorId !== log.userId)) {
    throw new HttpError(403, 'You cannot manage attendance for this task.');
  }
};

/** Only this explicit configuration activates an evidence-linked attendance check. */
export const validateAttendanceCheckConfig = (scheduleConfig: unknown): VolunteerAttendanceCheckConfig | null => {
  const source = object(scheduleConfig).volunteerAttendance;
  if (source == null) return null;
  const config = object(source);
  if (!['meeting_point', 'promotion_chat'].includes(String(config.checkKind))
    || typeof config.evidenceRuleKey !== 'string' || !config.evidenceRuleKey.trim()
    || config.evidenceRuleKey.length > 100 || !Array.isArray(config.shiftTypeIds)
    || config.shiftTypeIds.length === 0 || config.shiftTypeIds.length > 100
    || config.shiftTypeIds.some((id) => !positiveId(id))
    || new Set(config.shiftTypeIds).size !== config.shiftTypeIds.length
    || Object.keys(config).some((key) => !['checkKind', 'evidenceRuleKey', 'shiftTypeIds', 'expectedTime'].includes(key))) {
    throw new HttpError(400, 'Configure a valid attendance check kind, photo rule and shift types.');
  }
  const expectedTime = config.expectedTime ?? (config.checkKind === 'meeting_point' ? '20:45' : null);
  if (typeof expectedTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/u.test(expectedTime)) {
    throw new HttpError(400, 'The attendance check time must use HH:mm.');
  }
  const rules = object(scheduleConfig).evidenceRules;
  if (!Array.isArray(rules) || !rules.some((entry) => object(entry).key === config.evidenceRuleKey && object(entry).type === 'image'
    && (object(entry).required !== false || Number(object(entry).minItems ?? 0) > 0))) {
    throw new HttpError(400, 'The attendance check must reference a required image evidence rule.');
  }
  return { checkKind: config.checkKind as VolunteerAttendanceCheckConfig['checkKind'],
    evidenceRuleKey: config.evidenceRuleKey.trim(), shiftTypeIds: config.shiftTypeIds as number[], expectedTime };
};

export const validateAttendanceCheckShiftTypes = async (scheduleConfig: unknown, transaction?: Transaction): Promise<void> => {
  const config = validateAttendanceCheckConfig(scheduleConfig);
  if (!config) return;
  const types = await ShiftType.findAll({ where: { id: { [Op.in]: config.shiftTypeIds } }, attributes: ['id'], transaction });
  if (types.length !== config.shiftTypeIds.length) throw new HttpError(400, 'One or more attendance shift types no longer exist.');
};

const images = (log: Pick<AssistantManagerTaskLog, 'meta'>, config: VolunteerAttendanceCheckConfig): Evidence[] => {
  const items = Array.isArray(log.meta?.evidenceItems) ? log.meta.evidenceItems : [];
  return items.filter((item): item is Evidence => {
    const evidence = object(item);
    return typeof evidence.id === 'string' && evidence.id.length > 0 && evidence.ruleKey === config.evidenceRuleKey
      && evidence.type === 'image' && evidence.valid === true
      && Boolean(evidence.storagePath || evidence.driveFileId)
      && positiveId(evidence.uploadedBy) && typeof evidence.uploadedAt === 'string'
      && Number.isFinite(new Date(evidence.uploadedAt).valueOf());
  });
};

const loadTask = async (logId: number, actor: AttendanceCheckActor, transaction?: Transaction) => {
  if (!positiveId(logId)) throw new HttpError(400, 'Task log ID must be a positive integer.');
  const log = await AssistantManagerTaskLog.findByPk(logId, { transaction,
    ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!log) throw new HttpError(404, 'Task log was not found.');
  assertActor(actor, log);
  const template = await AssistantManagerTaskTemplate.findByPk(log.templateId, { attributes: ['id', 'scheduleConfig'], transaction });
  const config = validateAttendanceCheckConfig(template?.scheduleConfig);
  if (!config) throw new HttpError(409, 'This task is not configured for an attendance check.');
  return { log, config };
};

const roster = async (log: AssistantManagerTaskLog, config: VolunteerAttendanceCheckConfig, transaction?: Transaction): Promise<Assignment[]> => {
  const assignments = await ShiftAssignment.findAll({
    attributes: ['id', 'userId', 'shiftInstanceId', 'roleInShift'],
    include: [
      { model: User, as: 'assignee', required: true, attributes: ['id', 'firstName', 'lastName'] },
      { model: ShiftInstance, as: 'shiftInstance', required: true,
        attributes: ['id', 'date', 'timeStart', 'timeEnd', 'shiftTypeId', 'meta'],
        where: { date: log.taskDate, shiftTypeId: { [Op.in]: config.shiftTypeIds } },
        include: [{ model: ScheduleWeek, as: 'scheduleWeek', required: true, attributes: ['id', 'state'], where: { state: 'published' } },
          { model: ShiftType, as: 'shiftType', attributes: ['id', 'name'] }],
      },
      { model: VolunteerShiftAttendance, as: 'volunteerAttendance', required: false,
        include: [{ model: AssistantManagerTaskLog, as: 'evidenceTaskLog', required: false, attributes: ['id', 'taskDate'] }] },
    ],
    order: [['id', 'ASC']], transaction,
  }) as Assignment[];
  // One decision per person and physical shift, even when they hold several shift roles.
  const byPersonShift = new Map<string, Assignment>();
  for (const assignment of assignments) {
    // The task owner is taking the evidence and must not assess or block the
    // task on their own attendance. Another manager/task can assess them.
    if (assignment.userId === log.userId) continue;
    const key = `${assignment.userId}:${assignment.shiftInstanceId}`;
    const previous = byPersonShift.get(key);
    const recordedAt = attendanceIdentityMatches(assignment.volunteerAttendance, assignment)
      ? assignment.volunteerAttendance?.recordedAt?.valueOf() ?? -Infinity : -Infinity;
    const previousAt = previous && attendanceIdentityMatches(previous.volunteerAttendance, previous)
      ? previous?.volunteerAttendance?.recordedAt?.valueOf() ?? -Infinity : -Infinity;
    if (!previous || recordedAt > previousAt) byPersonShift.set(key, assignment);
  }
  return [...byPersonShift.values()];
};

export const getVolunteerAttendanceCheck = async (logId: number, actor: AttendanceCheckActor) => {
  const { log, config } = await loadTask(logId, actor);
  const assignments = await roster(log, config);
  return {
    taskLogId: log.id, taskDate: log.taskDate, ...config, serverTime: new Date().toISOString(),
    evidence: images(log, config).map((item) => ({ id: item.id, fileName: item.fileName ?? 'Task photo',
      subjectUserId: item.subjectUserId ?? null, uploadedAt: item.uploadedAt })),
    assignments: assignments.map((assignment) => {
      const attendance = attendanceIdentityMatches(assignment.volunteerAttendance, assignment)
        ? assignment.volunteerAttendance : undefined;
      return ({
      assignmentId: assignment.id, userId: assignment.userId,
      name: `${assignment.assignee?.firstName ?? ''} ${assignment.assignee?.lastName ?? ''}`.trim() || `Staff #${assignment.userId}`,
      role: assignment.roleInShift, shiftName: assignment.shiftInstance?.shiftType?.name ?? 'Shift',
      startTime: assignment.shiftInstance?.timeStart, endTime: assignment.shiftInstance?.timeEnd,
      status: attendance?.status === 'attended' ? 'on_time' : attendance?.status ?? null,
      revision: assignment.volunteerAttendance?.revision ?? 0,
      evidenceTaskLogId: attendance?.evidenceTaskLogId ?? null,
      evidenceFileId: attendance?.evidenceFileId ?? null,
      lateMinutes: attendance?.lateMinutes ?? null,
      notes: attendance?.notes ?? null,
      recordedAt: attendance?.recordedAt ?? null,
      self: assignment.userId === actor.actorId,
    }); }),
  };
};

export const saveVolunteerAttendanceCheck = async (params: AttendanceCheckActor & {
  taskLogId: number; assignmentId: number; body: unknown;
}) => {
  const body = object(params.body);
  if (Object.keys(body).some((key) => !['status', 'evidenceFileId', 'lateMinutes', 'notes', 'expectedRevision'].includes(key))) {
    throw new HttpError(400, 'Unknown attendance field.');
  }
  if (!['on_time', 'late', 'absent', 'excused'].includes(String(body.status))) throw new HttpError(400, 'Choose on time, late, absent or excused.');
  if (!positiveId(params.assignmentId) || typeof body.expectedRevision !== 'number'
    || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new HttpError(400, 'Valid assignment and expected revision are required.');
  if (typeof body.evidenceFileId !== 'string' || !body.evidenceFileId || body.evidenceFileId.length > 255) throw new HttpError(400, 'Select an uploaded task photo.');
  if (body.notes != null && (typeof body.notes !== 'string' || body.notes.length > 2000)) throw new HttpError(400, 'Notes must be at most 2000 characters.');
  if (body.lateMinutes != null && (!Number.isInteger(body.lateMinutes) || Number(body.lateMinutes) < 1 || Number(body.lateMinutes) > 1440 || body.status !== 'late')) {
    throw new HttpError(400, 'Late minutes must be a positive whole number up to 1440, only for a late arrival.');
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
  if ((body.status === 'absent' || body.status === 'excused') && !notes) throw new HttpError(400, 'Explain an absence or excuse in the notes.');
  await sequelize.transaction(async (transaction) => {
    const { log, config } = await loadTask(params.taskLogId, params, transaction);
    if (log.status === 'waived') throw new HttpError(409, 'A waived task cannot confirm attendance.');
    const now = new Date();
    const checkAt = dayjs.tz(`${log.taskDate}T${config.expectedTime}:00`, TIMEZONE);
    if (!checkAt.isValid() || checkAt.valueOf() > now.valueOf()) throw new HttpError(409, 'Attendance can be checked only at or after the configured time.');
    const image = images(log, config).find((item) => item.id === body.evidenceFileId);
    if (!image || new Date(image.uploadedAt!).valueOf() > now.valueOf()) throw new HttpError(409, 'The selected uploaded photo is no longer available. Refresh the task.');
    const assignment = await ShiftAssignment.findByPk(params.assignmentId, { attributes: ['id', 'userId', 'shiftInstanceId'],
      transaction, lock: transaction.LOCK.UPDATE });
    if (!assignment) throw new HttpError(404, 'The scheduled assignment was not found.');
    if (assignment.userId === params.actorId) throw new HttpError(403, 'Another manager must confirm your own attendance.');
    if (assignment.userId === log.userId) {
      throw new HttpError(409, 'The person assigned to this task is excluded from its attendance check.');
    }
    const instance = await ShiftInstance.findByPk(assignment.shiftInstanceId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!instance || instance.date !== log.taskDate || !config.shiftTypeIds.includes(instance.shiftTypeId)) {
      throw new HttpError(409, 'This person is not scheduled for the configured check.');
    }
    const week = await ScheduleWeek.findByPk(instance.scheduleWeekId, { attributes: ['id', 'state'], transaction, lock: transaction.LOCK.UPDATE });
    if (week?.state !== 'published') throw new HttpError(409, 'The schedule is no longer published.');
    if (image.subjectUserId != null && image.subjectUserId !== assignment.userId) throw new HttpError(409, 'The selected photo belongs to a different staff member.');
    const existing = await VolunteerShiftAttendance.findOne({ where: { shiftAssignmentId: assignment.id }, transaction, lock: transaction.LOCK.UPDATE }) as Attendance | null;
    if ((existing?.revision ?? 0) !== body.expectedRevision) throw new HttpError(409, 'Attendance changed since this task was opened. Refresh before saving.');
    const previous = existing ? { subjectUserId: existing.subjectUserId, evidenceShiftInstanceId: existing.evidenceShiftInstanceId,
      evidenceShiftTypeId: existing.evidenceShiftTypeId, status: existing.status, notes: existing.notes, recordedBy: existing.recordedBy,
      recordedAt: existing.recordedAt, revision: existing.revision, evidenceTaskLogId: existing.evidenceTaskLogId,
      evidenceRuleKey: existing.evidenceRuleKey, evidenceFileId: existing.evidenceFileId,
      checkKind: existing.checkKind, expectedTime: existing.expectedTime, lateMinutes: existing.lateMinutes } : null;
    const values = { shiftAssignmentId: assignment.id, subjectUserId: assignment.userId, status: body.status === 'on_time' ? 'attended' : body.status,
      notes, recordedBy: params.actorId, recordedAt: now, revision: (existing?.revision ?? 0) + 1,
      evidenceTaskLogId: log.id, evidenceRuleKey: config.evidenceRuleKey, evidenceFileId: image.id,
      evidenceShiftInstanceId: instance.id, evidenceShiftTypeId: instance.shiftTypeId,
      checkKind: config.checkKind, expectedTime: config.expectedTime,
      lateMinutes: body.status === 'late' ? body.lateMinutes ?? null : null };
    if (existing) await existing.update(values, { transaction });
    else await VolunteerShiftAttendance.create(values, { transaction });
    await AuditLog.create({ actorId: params.actorId, action: AUDIT_ACTION, entity: 'am_task_log', entityId: String(log.id),
      metaJson: { userId: assignment.userId, assignmentId: assignment.id, shiftInstanceId: instance.id,
        taskDate: log.taskDate, config, previous, attendance: values, evidence: image } }, { transaction });
  }).catch((error: unknown) => {
    const failure = object(error);
    const code = object(failure.original).code ?? object(failure.parent).code ?? failure.code;
    if (code === '40001' || code === '40P01') throw new HttpError(409, 'The schedule or attendance changed. Refresh before saving again.');
    throw error;
  });
  return getVolunteerAttendanceCheck(params.taskLogId, params);
};

/** Call while holding the task-log lock, before removing/replacing evidence or deleting/moving a task. */
export const assertAttendanceEvidencePreserved = async (
  logId: number, _currentMeta: unknown, nextMeta: unknown, transaction?: Transaction,
): Promise<void> => {
  const [links, audits] = await Promise.all([
    VolunteerShiftAttendance.findAll({ where: { evidenceTaskLogId: logId }, attributes: ['evidenceFileId'], transaction }) as Promise<Attendance[]>,
    AuditLog.findAll({ where: { action: AUDIT_ACTION, entity: 'am_task_log', entityId: String(logId) }, attributes: ['metaJson'], transaction }),
  ]);
  const nextEvidenceItems = object(nextMeta).evidenceItems;
  const proposed = Array.isArray(nextEvidenceItems) ? nextEvidenceItems : [];
  const currentIds = new Set(proposed.filter((item) => object(item).type === 'image').map((item) => object(item).id));
  const referencedIds = new Set([...links.map((link) => link.evidenceFileId), ...audits.map((audit) => object(object(audit.metaJson).evidence).id)].filter(Boolean));
  if ([...referencedIds].some((id) => !currentIds.has(id))) {
    throw new HttpError(409, 'This photo is retained as attendance evidence. Keep it and upload an additional photo if a correction is needed.');
  }
};

/** Completion requires explicit decisions for every currently published assignment in this check. */
export const ensureTaskAttendanceCheckSatisfied = async (
  log: AssistantManagerTaskLog, meta: unknown, transaction?: Transaction,
): Promise<void> => {
  const template = await AssistantManagerTaskTemplate.findByPk(log.templateId, { attributes: ['id', 'scheduleConfig'], transaction });
  const config = validateAttendanceCheckConfig(template?.scheduleConfig);
  if (!config) return;
  const evidence = images({ meta: object(meta) }, config);
  const assignments = await roster(log, config, transaction);
  const incomplete = assignments.filter((assignment) => {
    const attendance = assignment.volunteerAttendance;
    const image = evidence.find((entry) => entry.id === attendance?.evidenceFileId);
    return !attendance || attendance.evidenceTaskLogId !== log.id || attendance.evidenceRuleKey !== config.evidenceRuleKey
      || attendance.evidenceShiftInstanceId !== assignment.shiftInstanceId || attendance.evidenceShiftTypeId !== assignment.shiftInstance?.shiftTypeId
      || (attendance.subjectUserId != null && attendance.subjectUserId !== assignment.userId)
      || attendance.checkKind !== config.checkKind || attendance.expectedTime !== config.expectedTime || !image
      || (image.subjectUserId != null && image.subjectUserId !== assignment.userId)
      || !['attended', 'late', 'absent', 'excused'].includes(attendance.status);
  });
  if (incomplete.length) throw new HttpError(409, `Confirm attendance with the task photo for ${incomplete.length} scheduled assignment(s) before completing this task.`);
};
