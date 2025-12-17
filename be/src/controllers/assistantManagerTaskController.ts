import { randomUUID } from 'crypto';
import { Op, type WhereOptions } from 'sequelize';
import type { Request, Response } from 'express';
import dayjs from 'dayjs';
import AssistantManagerTaskTemplate, { type AssistantManagerTaskCadence } from '../models/AssistantManagerTaskTemplate.js';
import AssistantManagerTaskAssignment, { type AssistantManagerTaskAssignmentScope } from '../models/AssistantManagerTaskAssignment.js';
import AssistantManagerTaskLog, { type AssistantManagerTaskStatus } from '../models/AssistantManagerTaskLog.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const CADENCE_VALUES = new Set<AssistantManagerTaskCadence>(['daily', 'weekly', 'biweekly', 'every_two_weeks', 'monthly']);
const STATUS_VALUES = new Set<AssistantManagerTaskStatus>(['pending', 'completed', 'missed', 'waived']);
const ASSIGNMENT_SCOPE_VALUES = new Set<AssistantManagerTaskAssignmentScope>(['staff_type', 'user']);
const PRIORITY_VALUES = new Set(['high', 'medium', 'low']);
const TIME_INPUT_FORMATS = ['HH:mm', 'H:mm', 'HH:mm:ss', 'h:mm A', 'h A'];

type ShiftDayInfo = {
  shiftInstanceId: number;
  shiftAssignmentId: number;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
};

type ManualTaskPayload = {
  templateId: number | null;
  userId: number | null;
  assignmentId: number | null;
  taskDate: string | null;
  status?: AssistantManagerTaskStatus;
  notes?: string | null;
  meta: Record<string, unknown>;
  initialComment?: string | null;
  requireShift: boolean;
};

type MetaUpdatePayload = {
  metaPatch: Record<string, unknown>;
  taskDate?: string | null;
  notes?: string | null;
  comment?: string | null;
  requireShift?: boolean | null;
};

const toScheduleConfig = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
};

const sanitizeTemplatePayload = (body: Record<string, unknown>) => {
  const next: Partial<AssistantManagerTaskTemplate> & { scheduleConfig?: Record<string, unknown> } = {};
  if (typeof body.name === 'string') {
    next.name = body.name.trim();
  }
  if (typeof body.description === 'string') {
    next.description = body.description.trim();
  } else if (body.description === null) {
    next.description = null;
  }
  if (typeof body.cadence === 'string' && CADENCE_VALUES.has(body.cadence.trim() as AssistantManagerTaskCadence)) {
    next.cadence = body.cadence.trim() as AssistantManagerTaskCadence;
  }
  if (body.scheduleConfig != null) {
    next.scheduleConfig = toScheduleConfig(body.scheduleConfig);
  }
  if (body.isActive != null) {
    next.isActive = Boolean(body.isActive);
  }
  return next;
};

const sanitizeAssignmentPayload = (body: Record<string, unknown>) => {
  const next: Partial<AssistantManagerTaskAssignment> & { targetScope?: AssistantManagerTaskAssignmentScope } = {};
  if (typeof body.targetScope === 'string' && ASSIGNMENT_SCOPE_VALUES.has(body.targetScope.trim() as AssistantManagerTaskAssignmentScope)) {
    next.targetScope = body.targetScope.trim() as AssistantManagerTaskAssignmentScope;
  }
  if (typeof body.staffType === 'string') {
    next.staffType = body.staffType.trim() || null;
  } else if (body.staffType === null) {
    next.staffType = null;
  }
  if (body.userId != null) {
    const numeric = Number(body.userId);
    if (Number.isFinite(numeric) && numeric > 0) {
      next.userId = numeric;
    }
  }
  if (typeof body.effectiveStart === 'string' && body.effectiveStart.trim()) {
    next.effectiveStart = body.effectiveStart.trim();
  } else if (body.effectiveStart === null) {
    next.effectiveStart = null;
  }
  if (typeof body.effectiveEnd === 'string' && body.effectiveEnd.trim()) {
    next.effectiveEnd = body.effectiveEnd.trim();
  } else if (body.effectiveEnd === null) {
    next.effectiveEnd = null;
  }
  if (body.isActive != null) {
    next.isActive = Boolean(body.isActive);
  }
  return next;
};

const parsePositiveInt = (value: unknown): number | null => {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return null;
};

const sanitizeTaskDate = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = dayjs(trimmed);
  if (!parsed.isValid()) {
    return null;
  }
  return parsed.format('YYYY-MM-DD');
};

const normalizeTimeValue = (value: unknown): string | null => {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const hours = Math.max(0, Math.min(23, Math.floor(value)));
    const minutes = Math.max(0, Math.min(59, Math.round((value - hours) * 60)));
    return dayjs().hour(hours).minute(minutes).second(0).format('HH:mm');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = dayjs(trimmed, TIME_INPUT_FORMATS, true);
    if (parsed.isValid()) {
      return parsed.format('HH:mm');
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const hours = Math.max(0, Math.min(23, Math.floor(numeric)));
      const minutes = Math.max(0, Math.min(59, Math.round((numeric - hours) * 60)));
      return dayjs().hour(hours).minute(minutes).second(0).format('HH:mm');
    }
  }
  return null;
};

const parseOptionalTime = (value: unknown, fieldName: string): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const normalized = normalizeTimeValue(value);
  if (!normalized) {
    throw new Error(`${fieldName} is invalid`);
  }
  return normalized;
};

const parseOptionalNumber = (value: unknown, fieldName: string, options?: { min?: number }): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${fieldName} must be numeric`);
  }
  if (options?.min != null && numeric < options.min) {
    throw new Error(`${fieldName} must be at least ${options.min}`);
  }
  return numeric;
};

const parseOptionalPriority = (value: unknown, fieldName: string): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (PRIORITY_VALUES.has(normalized)) {
      return normalized;
    }
  }
  throw new Error(`${fieldName} must be one of high, medium, or low`);
};

const parseOptionalStringArray = (value: unknown, fieldName: string): string[] | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return [];
  }
  let values: unknown[] = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === 'string') {
    values = value
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  } else {
    throw new Error(`${fieldName} must be an array or comma separated string`);
  }
  return values
    .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry));
};

const sanitizePlannerMetaInput = (source: Record<string, unknown>) => {
  const meta: Record<string, unknown> = {};
  if ('time' in source) {
    const parsed = parseOptionalTime(source.time, 'time');
    if (parsed !== undefined) {
      meta.time = parsed;
    }
  }
  if ('durationHours' in source) {
    const parsed = parseOptionalNumber(source.durationHours, 'durationHours', { min: 0.25 });
    if (parsed !== undefined) {
      meta.durationHours = parsed;
    }
  }
  if ('priority' in source) {
    const parsed = parseOptionalPriority(source.priority, 'priority');
    if (parsed !== undefined) {
      meta.priority = parsed;
    }
  }
  if ('points' in source) {
    const parsed = parseOptionalNumber(source.points, 'points', { min: 0 });
    if (parsed !== undefined) {
      meta.points = parsed;
    }
  }
  if ('tags' in source) {
    const parsed = parseOptionalStringArray(source.tags, 'tags');
    if (parsed !== undefined) {
      meta.tags = parsed;
    }
  }
  if ('evidence' in source) {
    const parsed = parseOptionalStringArray(source.evidence, 'evidence');
    if (parsed !== undefined) {
      meta.evidence = parsed;
    }
  } else if ('attachments' in source) {
    const parsed = parseOptionalStringArray(source.attachments, 'attachments');
    if (parsed !== undefined) {
      meta.evidence = parsed;
    }
  }
  if ('manual' in source) {
    meta.manual = Boolean(source.manual);
  }
  return meta;
};

const sanitizeScheduleConfigMeta = (config: Record<string, unknown>, shiftTime?: string | null) => {
  const meta: Record<string, unknown> = {};
  const timeRaw = config.time ?? config.timeSlot ?? config.hour ?? config.startTime ?? null;
  const normalizedTime = normalizeTimeValue(timeRaw);
  if (normalizedTime) {
    meta.time = normalizedTime;
  } else if (shiftTime) {
    meta.time = shiftTime;
  }
  const durationRaw = Number(config.durationHours ?? config.duration ?? 1);
  if (Number.isFinite(durationRaw) && durationRaw > 0) {
    meta.durationHours = durationRaw;
  }
  if (typeof config.priority === 'string' && PRIORITY_VALUES.has(config.priority.toLowerCase())) {
    meta.priority = config.priority.toLowerCase();
  }
  const pointsRaw = Number(config.points ?? config.pointValue ?? 1);
  if (Number.isFinite(pointsRaw) && pointsRaw >= 0) {
    meta.points = pointsRaw;
  }
  if (Array.isArray(config.tags)) {
    meta.tags = config.tags.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  return meta;
};

const getRequireShiftFlag = (template: AssistantManagerTaskTemplate): boolean => {
  const config = template.scheduleConfig ?? {};
  if (config.requireShift === false || config.allowOffDays === true || config.requireScheduledShift === false) {
    return false;
  }
  return true;
};

const buildShiftMeta = (shiftInfo: ShiftDayInfo | null, requireShift: boolean) => {
  const shiftStart = shiftInfo?.timeStart ? normalizeTimeValue(shiftInfo.timeStart) : null;
  const shiftEnd = shiftInfo?.timeEnd ? normalizeTimeValue(shiftInfo.timeEnd) : null;
  return {
    requireShift,
    onShift: Boolean(shiftInfo),
    offDay: !shiftInfo,
    scheduleConflict: requireShift && !shiftInfo,
    shiftInstanceId: shiftInfo?.shiftInstanceId ?? null,
    shiftAssignmentId: shiftInfo?.shiftAssignmentId ?? null,
    shiftTimeStart: shiftStart,
    shiftTimeEnd: shiftEnd,
  };
};

const buildShiftAvailabilityMap = async (userId: number, rangeStart: dayjs.Dayjs, rangeEnd: dayjs.Dayjs) => {
  const assignments = await ShiftAssignment.findAll({
    where: { userId },
    include: [
      {
        model: ShiftInstance,
        as: 'shiftInstance',
        attributes: ['id', 'date', 'timeStart', 'timeEnd'],
        required: true,
        where: {
          date: {
            [Op.between]: [rangeStart.format('YYYY-MM-DD'), rangeEnd.format('YYYY-MM-DD')],
          },
        },
      },
    ],
  });
  const map = new Map<string, ShiftDayInfo>();
  assignments.forEach((assignment) => {
    const instance = assignment.shiftInstance;
    if (instance?.date) {
      map.set(instance.date, {
        shiftInstanceId: instance.id,
        shiftAssignmentId: assignment.id,
        date: instance.date,
        timeStart: instance.timeStart ?? null,
        timeEnd: instance.timeEnd ?? null,
      });
    }
  });
  return map;
};

const getShiftInfoForUserOnDate = async (
  userId: number,
  taskDate: string,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  cache?: Map<number, Map<string, ShiftDayInfo>>,
): Promise<ShiftDayInfo | null> => {
  const store = cache ?? new Map<number, Map<string, ShiftDayInfo>>();
  let userMap = store.get(userId);
  if (!userMap) {
    userMap = await buildShiftAvailabilityMap(userId, rangeStart, rangeEnd);
    store.set(userId, userMap);
  }
  return userMap.get(taskDate) ?? null;
};

const sanitizeManualTaskPayload = (body: Record<string, unknown>): ManualTaskPayload => {
  const templateId = parsePositiveInt(body.templateId);
  const userId = parsePositiveInt(body.userId);
  const assignmentId = parsePositiveInt(body.assignmentId);
  const taskDate = sanitizeTaskDate(body.taskDate);
  const status =
    typeof body.status === 'string' && STATUS_VALUES.has(body.status.trim() as AssistantManagerTaskStatus)
      ? (body.status.trim() as AssistantManagerTaskStatus)
      : undefined;
  const metaPatch = sanitizePlannerMetaInput(body);
  const nestedPatch =
    body.meta && typeof body.meta === 'object' ? sanitizePlannerMetaInput(body.meta as Record<string, unknown>) : {};
  const requireShift = body.requireShift === true || body.enforceShift === true;
  return {
    templateId,
    userId,
    assignmentId,
    taskDate,
    status,
    notes:
      typeof body.notes === 'string'
        ? body.notes.trim()
        : body.notes === null
          ? null
          : undefined,
    meta: { ...metaPatch, ...nestedPatch },
    initialComment: typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : undefined,
    requireShift,
  };
};

const sanitizeLogMetaPayload = (body: Record<string, unknown>): MetaUpdatePayload => {
  const metaPatch = sanitizePlannerMetaInput(body);
  if (body.meta && typeof body.meta === 'object') {
    Object.assign(metaPatch, sanitizePlannerMetaInput(body.meta as Record<string, unknown>));
  }
  const payload: MetaUpdatePayload = { metaPatch };
  if ('taskDate' in body) {
    const nextDate = sanitizeTaskDate(body.taskDate);
    if (!nextDate) {
      throw new Error('taskDate is invalid');
    }
    payload.taskDate = nextDate;
  }
  if ('notes' in body) {
    if (typeof body.notes === 'string') {
      payload.notes = body.notes.trim();
    } else if (body.notes === null) {
      payload.notes = null;
    } else {
      throw new Error('notes must be a string or null');
    }
  }
  if (typeof body.comment === 'string' && body.comment.trim()) {
    payload.comment = body.comment.trim();
  }
  if ('requireShift' in body || 'enforceShift' in body) {
    payload.requireShift = Boolean(body.requireShift ?? body.enforceShift);
  }
  return payload;
};

const appendCommentEntry = (
  meta: Record<string, unknown>,
  comment: string,
  authorId: number | null,
  authorName: string | null,
) => {
  const existing = Array.isArray(meta['comments']) ? (meta['comments'] as unknown[]) : [];
  meta['comments'] = [
    ...existing,
    {
      id: randomUUID(),
      body: comment,
      authorId,
      authorName,
      createdAt: new Date().toISOString(),
    },
  ];
};

const getActorIdentity = async (actorId: number | null): Promise<string | null> => {
  if (!actorId) {
    return 'System';
  }
  const actor = await User.findByPk(actorId, { attributes: ['id', 'firstName', 'lastName', 'username'] });
  if (!actor) {
    return `User #${actorId}`;
  }
  const fullName = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim();
  return fullName || actor.username || `User #${actorId}`;
};

const formatTemplate = (
  template: AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] },
) => ({
  id: template.id,
  name: template.name,
  description: template.description ?? null,
  cadence: template.cadence,
  scheduleConfig: template.scheduleConfig ?? {},
  isActive: template.isActive ?? true,
  createdAt: template.createdAt?.toISOString() ?? null,
  updatedAt: template.updatedAt?.toISOString() ?? null,
  assignments: template.assignments
    ? template.assignments.map((assignment) =>
        formatAssignment(assignment as AssistantManagerTaskAssignment & { user?: User | null }),
      )
    : [],
});

const formatAssignment = (assignment: AssistantManagerTaskAssignment & { user?: User | null }) => ({
  id: assignment.id,
  templateId: assignment.templateId,
  targetScope: assignment.targetScope,
  staffType: assignment.staffType ?? null,
  userId: assignment.userId ?? null,
  userName: assignment.user ? `${assignment.user.firstName ?? ''} ${assignment.user.lastName ?? ''}`.trim() || null : null,
  effectiveStart: assignment.effectiveStart ?? null,
  effectiveEnd: assignment.effectiveEnd ?? null,
  isActive: assignment.isActive ?? true,
  createdAt: assignment.createdAt?.toISOString() ?? null,
  updatedAt: assignment.updatedAt?.toISOString() ?? null,
});

const formatLog = (
  log: AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null },
) => ({
  id: log.id,
  templateId: log.templateId,
  templateName: log.template?.name ?? null,
  userId: log.userId,
  userName: log.user ? `${log.user.firstName ?? ''} ${log.user.lastName ?? ''}`.trim() || null : null,
  taskDate: log.taskDate,
  status: log.status,
  completedAt: log.completedAt?.toISOString() ?? null,
  notes: log.notes ?? null,
  meta: log.meta ?? {},
  createdAt: log.createdAt?.toISOString() ?? null,
  updatedAt: log.updatedAt?.toISOString() ?? null,
});

const getActorId = (req: AuthenticatedRequest) => req.authContext?.id ?? null;

const resolveStaffTypeUsers = async (staffType: string, cache: Map<string, number[]>) => {
  if (!staffType) {
    return [];
  }
  if (cache.has(staffType)) {
    return cache.get(staffType) ?? [];
  }
  const profiles = await StaffProfile.findAll({
    where: { staffType, active: true },
    attributes: ['userId'],
  });
  const userIds = profiles.map((profile) => profile.userId);
  cache.set(staffType, userIds);
  return userIds;
};

const enumerateDatesForCadence = (
  template: AssistantManagerTaskTemplate,
  assignment: AssistantManagerTaskAssignment,
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
) => {
  const config = template.scheduleConfig ?? {};
  const dates: string[] = [];
  const effectiveStart = assignment.effectiveStart ? dayjs(assignment.effectiveStart) : null;
  const effectiveEnd = assignment.effectiveEnd ? dayjs(assignment.effectiveEnd) : null;
  const windowStart = effectiveStart && effectiveStart.isAfter(rangeStart, 'day') ? effectiveStart : rangeStart;
  const windowEnd = effectiveEnd && effectiveEnd.isBefore(rangeEnd, 'day') ? effectiveEnd : rangeEnd;
  if (windowStart.isAfter(windowEnd, 'day')) {
    return dates;
  }

  const pushDate = (date: dayjs.Dayjs) => {
    if (!date.isBefore(windowStart, 'day') && !date.isAfter(windowEnd, 'day')) {
      dates.push(date.format('YYYY-MM-DD'));
    }
  };

  if (template.cadence === 'daily') {
    let cursor = windowStart.clone();
    while (!cursor.isAfter(windowEnd, 'day')) {
      pushDate(cursor);
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'weekly') {
    const daysOfWeek = Array.isArray(config.daysOfWeek)
      ? (config.daysOfWeek as number[]).map((value) => Number(value))
      : [windowStart.day()];
    let cursor = windowStart.clone().startOf('day');
    while (!cursor.isAfter(windowEnd, 'day')) {
      if (daysOfWeek.includes(cursor.day())) {
        pushDate(cursor);
      }
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'biweekly') {
    const daysOfWeek = Array.isArray(config.daysOfWeek)
      ? (config.daysOfWeek as number[]).map((value) => Number(value))
      : [1, 4];
    let cursor = windowStart.clone().startOf('day');
    while (!cursor.isAfter(windowEnd, 'day')) {
      if (daysOfWeek.includes(cursor.day())) {
        pushDate(cursor);
      }
      cursor = cursor.add(1, 'day');
    }
    return dates;
  }

  if (template.cadence === 'every_two_weeks') {
    const anchor = effectiveStart ?? rangeStart;
    let cursor = anchor.clone();
    if (cursor.isBefore(windowStart, 'day')) {
      const diff = windowStart.diff(cursor, 'day');
      const remainder = diff % 14;
      cursor = windowStart.clone().add(remainder === 0 ? 0 : 14 - remainder, 'day');
    }
    while (!cursor.isAfter(windowEnd, 'day')) {
      pushDate(cursor);
      cursor = cursor.add(14, 'day');
    }
    return dates;
  }

  if (template.cadence === 'monthly') {
    const dayOfMonth = Number(config.dayOfMonth ?? (effectiveStart ? effectiveStart.date() : 1));
    let cursor = windowStart.clone().date(Math.min(dayOfMonth, windowStart.daysInMonth()));
    if (cursor.isBefore(windowStart, 'day')) {
      cursor = cursor.add(1, 'month').date(Math.min(dayOfMonth, cursor.daysInMonth()));
    }
    while (!cursor.isAfter(windowEnd, 'day')) {
      pushDate(cursor);
      cursor = cursor.add(1, 'month').date(Math.min(dayOfMonth, cursor.daysInMonth()));
    }
    return dates;
  }

  return dates;
};

const generateLogsForAssignments = async (
  assignments: AssistantManagerTaskAssignment[],
  rangeStart: dayjs.Dayjs,
  rangeEnd: dayjs.Dayjs,
  actorId: number | null,
) => {
  const staffTypeCache = new Map<string, number[]>();
  const shiftCache = new Map<number, Map<string, ShiftDayInfo>>();
  for (const assignment of assignments) {
    const template = assignment.template;
    if (!template || template.isActive === false || assignment.isActive === false) {
      continue;
    }
     const requireShift = getRequireShiftFlag(template);
    const dates = enumerateDatesForCadence(template, assignment, rangeStart, rangeEnd);
    if (dates.length === 0) {
      continue;
    }

    let userIds: number[] = [];
    if (assignment.targetScope === 'user' && assignment.userId) {
      userIds = [assignment.userId];
    } else if (assignment.targetScope === 'staff_type' && assignment.staffType) {
      userIds = await resolveStaffTypeUsers(assignment.staffType, staffTypeCache);
    }

    if (userIds.length === 0) {
      continue;
    }

    for (const userId of userIds) {
      for (const taskDate of dates) {
        const shiftInfo = await getShiftInfoForUserOnDate(userId, taskDate, rangeStart, rangeEnd, shiftCache);
        if (requireShift && !shiftInfo) {
          continue;
        }
        const shiftTime = shiftInfo?.timeStart ? normalizeTimeValue(shiftInfo.timeStart) : null;
        const scheduleMeta = sanitizeScheduleConfigMeta(template.scheduleConfig ?? {}, shiftTime);
        const baseMeta: Record<string, unknown> = {
          manual: false,
          ...scheduleMeta,
        };
        if (!Object.prototype.hasOwnProperty.call(baseMeta, 'priority')) {
          baseMeta.priority = 'medium';
        }
        if (!Object.prototype.hasOwnProperty.call(baseMeta, 'points')) {
          baseMeta.points = 1;
        }
        if (!Object.prototype.hasOwnProperty.call(baseMeta, 'durationHours')) {
          baseMeta.durationHours = 1;
        }
        if (!Object.prototype.hasOwnProperty.call(baseMeta, 'time') && shiftTime) {
          baseMeta.time = shiftTime;
        }
        const shiftMeta = buildShiftMeta(shiftInfo, requireShift);
        Object.assign(baseMeta, shiftMeta);
        const [log, created] = await AssistantManagerTaskLog.findOrCreate({
          where: {
            templateId: template.id,
            userId,
            taskDate,
          },
          defaults: {
            assignmentId: assignment.id,
            status: 'pending',
            meta: baseMeta,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        if (!created) {
          const existingMeta = (log.meta ?? {}) as Record<string, unknown>;
          let shouldUpdateMeta = false;
          Object.entries(shiftMeta).forEach(([key, value]) => {
            if (existingMeta[key] !== value) {
              existingMeta[key] = value;
              shouldUpdateMeta = true;
            }
          });
          const updatePayload: Partial<AssistantManagerTaskLog> = {};
          if (shouldUpdateMeta) {
            updatePayload.meta = existingMeta;
          }
          if (log.assignmentId !== assignment.id) {
            updatePayload.assignmentId = assignment.id;
          }
          if (Object.keys(updatePayload).length > 0) {
            updatePayload.updatedBy = actorId;
            await AssistantManagerTaskLog.update(updatePayload, { where: { id: log.id } });
          }
        }
      }
    }
  }
};

export const listTaskTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const includeAssignments = req.query.includeAssignments !== 'false';
    const templates = await AssistantManagerTaskTemplate.findAll({
      include: includeAssignments
        ? [{ model: AssistantManagerTaskAssignment, as: 'assignments', include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] }] }]
        : [],
      order: [
        ['isActive', 'DESC'],
        ['name', 'ASC'],
      ],
    });
    res.status(200).json([{ data: templates.map((template) => formatTemplate(template as AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] })), columns: [] }]);
  } catch (error) {
    console.error('Failed to list assistant manager task templates', error);
    res.status(500).json([{ message: 'Failed to list assistant manager tasks' }]);
  }
};

export const createTaskTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = sanitizeTemplatePayload(req.body ?? {});
    if (!payload.name) {
      res.status(400).json([{ message: 'name is required' }]);
      return;
    }
    if (!payload.cadence || !CADENCE_VALUES.has(payload.cadence)) {
      res.status(400).json([{ message: 'cadence is invalid' }]);
      return;
    }
    payload.createdBy = getActorId(req);
    payload.updatedBy = getActorId(req);
    const created = await AssistantManagerTaskTemplate.create(payload);
    const refreshed = await AssistantManagerTaskTemplate.findByPk(created.id, {
      include: [{ model: AssistantManagerTaskAssignment, as: 'assignments' }],
    });
    res.status(201).json([{ data: refreshed ? [formatTemplate(refreshed as AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] })] : [] }]);
  } catch (error) {
    console.error('Failed to create assistant manager task template', error);
    res.status(500).json([{ message: 'Failed to create task template' }]);
  }
};

export const updateTaskTemplate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const payload = sanitizeTemplatePayload(req.body ?? {});
    payload.updatedBy = getActorId(req);
    const [updated] = await AssistantManagerTaskTemplate.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    const refreshed = await AssistantManagerTaskTemplate.findByPk(id, {
      include: [{ model: AssistantManagerTaskAssignment, as: 'assignments' }],
    });
    res.status(200).json([{ data: refreshed ? [formatTemplate(refreshed as AssistantManagerTaskTemplate & { assignments?: AssistantManagerTaskAssignment[] })] : [] }]);
  } catch (error) {
    console.error('Failed to update assistant manager task template', error);
    res.status(500).json([{ message: 'Failed to update task template' }]);
  }
};

export const deleteTaskTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const deleted = await AssistantManagerTaskTemplate.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete task template', error);
    res.status(500).json([{ message: 'Failed to delete task template' }]);
  }
};

export const listTaskAssignments = async (req: Request, res: Response): Promise<void> => {
  try {
    const templateId = Number(req.params.id);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const assignments = await AssistantManagerTaskAssignment.findAll({
      where: { templateId },
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] }],
      order: [
        ['isActive', 'DESC'],
        ['id', 'ASC'],
      ],
    });
    res.status(200).json([{ data: assignments.map((assignment) => formatAssignment(assignment as AssistantManagerTaskAssignment & { user?: User | null })), columns: [] }]);
  } catch (error) {
    console.error('Failed to list task assignments', error);
    res.status(500).json([{ message: 'Failed to list task assignments' }]);
  }
};

export const createTaskAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const templateId = Number(req.params.id);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      res.status(400).json([{ message: 'Invalid template id' }]);
      return;
    }
    const template = await AssistantManagerTaskTemplate.findByPk(templateId);
    if (!template) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    const payload = sanitizeAssignmentPayload(req.body ?? {});
    payload.templateId = templateId;
    payload.createdBy = getActorId(req);
    payload.updatedBy = getActorId(req);
    payload.targetScope = payload.targetScope ?? 'staff_type';
    if (payload.targetScope === 'user' && !payload.userId) {
      res.status(400).json([{ message: 'userId is required for user scope' }]);
      return;
    }
    if (payload.targetScope === 'staff_type' && !payload.staffType) {
      res.status(400).json([{ message: 'staffType is required for staff_type scope' }]);
      return;
    }
    const created = await AssistantManagerTaskAssignment.create(payload);
    const refreshed = await AssistantManagerTaskAssignment.findByPk(created.id, {
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] }],
    });
    res.status(201).json([{ data: refreshed ? [formatAssignment(refreshed as AssistantManagerTaskAssignment & { user?: User | null })] : [] }]);
  } catch (error) {
    console.error('Failed to create task assignment', error);
    res.status(500).json([{ message: 'Failed to create task assignment' }]);
  }
};

export const updateTaskAssignment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const templateId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(templateId) || templateId <= 0 || !Number.isInteger(assignmentId) || assignmentId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }
    const assignment = await AssistantManagerTaskAssignment.findOne({ where: { id: assignmentId, templateId } });
    if (!assignment) {
      res.status(404).json([{ message: 'Assignment not found' }]);
      return;
    }
    const payload = sanitizeAssignmentPayload({ ...assignment.get(), ...req.body });
    payload.updatedBy = getActorId(req);
    if (payload.targetScope === 'user' && !payload.userId) {
      res.status(400).json([{ message: 'userId is required for user scope' }]);
      return;
    }
    if (payload.targetScope === 'staff_type' && !payload.staffType) {
      res.status(400).json([{ message: 'staffType is required for staff_type scope' }]);
      return;
    }
    await AssistantManagerTaskAssignment.update(payload, { where: { id: assignmentId, templateId } });
    const refreshed = await AssistantManagerTaskAssignment.findByPk(assignmentId, {
      include: [{ model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] }],
    });
    res.status(200).json([{ data: refreshed ? [formatAssignment(refreshed as AssistantManagerTaskAssignment & { user?: User | null })] : [] }]);
  } catch (error) {
    console.error('Failed to update task assignment', error);
    res.status(500).json([{ message: 'Failed to update task assignment' }]);
  }
};

export const deleteTaskAssignment = async (req: Request, res: Response): Promise<void> => {
  try {
    const templateId = Number(req.params.id);
    const assignmentId = Number(req.params.assignmentId);
    if (!Number.isInteger(templateId) || templateId <= 0 || !Number.isInteger(assignmentId) || assignmentId <= 0) {
      res.status(400).json([{ message: 'Invalid ids provided' }]);
      return;
    }
    const deleted = await AssistantManagerTaskAssignment.destroy({ where: { id: assignmentId, templateId } });
    if (!deleted) {
      res.status(404).json([{ message: 'Assignment not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete task assignment', error);
    res.status(500).json([{ message: 'Failed to delete task assignment' }]);
  }
};

export const listTaskLogs = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate, scope, userId } = req.query;
    const start = typeof startDate === 'string' && startDate.trim() ? dayjs(startDate) : dayjs().startOf('week');
    const end = typeof endDate === 'string' && endDate.trim() ? dayjs(endDate) : start.add(6, 'day');
    if (!start.isValid() || !end.isValid()) {
      res.status(400).json([{ message: 'Invalid date range provided' }]);
      return;
    }
    const actorId = getActorId(req);
    const assignments = await AssistantManagerTaskAssignment.findAll({
      where: { isActive: true },
      include: [{ model: AssistantManagerTaskTemplate, as: 'template', where: { isActive: true }, required: true }],
    });

    await generateLogsForAssignments(assignments, start.startOf('day'), end.endOf('day'), actorId);

    const where: WhereOptions = {
      taskDate: {
        [Op.between]: [start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')],
      },
    };

    if (typeof userId === 'string' && userId.trim()) {
      const numeric = Number(userId);
      if (Number.isFinite(numeric) && numeric > 0) {
        where.userId = numeric;
      }
    } else if (scope === 'self' && actorId) {
      where.userId = actorId;
    }

    const logs = await AssistantManagerTaskLog.findAll({
      where,
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'cadence'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [
        ['taskDate', 'ASC'],
        ['userId', 'ASC'],
      ],
    });

    res.status(200).json([
      {
        data: logs.map((log) =>
          formatLog(log as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null }),
        ),
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to list assistant manager task logs', error);
    res.status(500).json([{ message: 'Failed to list task logs' }]);
  }
};

export const updateTaskLogStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const logId = Number(req.params.id);
    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json([{ message: 'Invalid task log id' }]);
      return;
    }
    const log = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    if (!log) {
      res.status(404).json([{ message: 'Task log not found' }]);
      return;
    }
    const status = typeof req.body.status === 'string' ? (req.body.status.trim() as AssistantManagerTaskStatus) : undefined;
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : undefined;
    if (status && !STATUS_VALUES.has(status)) {
      res.status(400).json([{ message: 'Invalid status provided' }]);
      return;
    }
    const payload: Partial<AssistantManagerTaskLog> = {};
    if (status) {
      payload.status = status;
      payload.completedAt = status === 'completed' ? new Date() : null;
    }
    if (notes !== undefined) {
      payload.notes = notes;
    }
    payload.updatedBy = getActorId(req);
    await AssistantManagerTaskLog.update(payload, { where: { id: logId } });
    const refreshed = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'cadence'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    res.status(200).json([{ data: refreshed ? [formatLog(refreshed as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null })] : [] }]);
  } catch (error) {
    console.error('Failed to update task log status', error);
    res.status(500).json([{ message: 'Failed to update task log' }]);
  }
};

export const createManualTaskLog = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    let payload: ManualTaskPayload;
    try {
      payload = sanitizeManualTaskPayload(req.body ?? {});
    } catch (error) {
      res.status(400).json([{ message: error instanceof Error ? error.message : 'Invalid payload' }]);
      return;
    }
    if (!payload.templateId) {
      res.status(400).json([{ message: 'templateId is required' }]);
      return;
    }
    if (!payload.userId) {
      res.status(400).json([{ message: 'userId is required' }]);
      return;
    }
    if (!payload.taskDate) {
      res.status(400).json([{ message: 'taskDate is required' }]);
      return;
    }
    const template = await AssistantManagerTaskTemplate.findByPk(payload.templateId);
    if (!template) {
      res.status(404).json([{ message: 'Task template not found' }]);
      return;
    }
    if (template.isActive === false) {
      res.status(400).json([{ message: 'Template is inactive' }]);
      return;
    }
    const user = await User.findByPk(payload.userId, { attributes: ['id'] });
    if (!user) {
      res.status(404).json([{ message: 'User not found' }]);
      return;
    }
    if (payload.assignmentId) {
      const assignment = await AssistantManagerTaskAssignment.findOne({
        where: { id: payload.assignmentId, templateId: template.id },
      });
      if (!assignment) {
        res.status(400).json([{ message: 'assignmentId does not belong to template' }]);
        return;
      }
    }
    const actorId = getActorId(req);
    const taskDay = dayjs(payload.taskDate);
    const shiftInfo = await getShiftInfoForUserOnDate(
      payload.userId,
      payload.taskDate,
      taskDay.startOf('day'),
      taskDay.endOf('day'),
    );
    const meta: Record<string, unknown> = { manual: true, ...payload.meta };
    if (!Object.prototype.hasOwnProperty.call(meta, 'priority') || meta['priority'] == null) {
      meta['priority'] = 'medium';
    }
    if (!Object.prototype.hasOwnProperty.call(meta, 'points') || meta['points'] == null) {
      meta['points'] = 1;
    }
    if (!Object.prototype.hasOwnProperty.call(meta, 'durationHours') || meta['durationHours'] == null) {
      meta['durationHours'] = 1;
    }
    if (
      (!Object.prototype.hasOwnProperty.call(meta, 'time') || meta['time'] == null) &&
      shiftInfo?.timeStart
    ) {
      meta['time'] = normalizeTimeValue(shiftInfo.timeStart);
    }
    Object.assign(meta, buildShiftMeta(shiftInfo, payload.requireShift));
    if (payload.initialComment) {
      const actorName = await getActorIdentity(actorId);
      appendCommentEntry(meta, payload.initialComment, actorId, actorName);
    }
    const created = await AssistantManagerTaskLog.create({
      templateId: template.id,
      assignmentId: payload.assignmentId,
      userId: payload.userId,
      taskDate: payload.taskDate,
      status: payload.status ?? 'pending',
      notes: payload.notes ?? null,
      meta,
      createdBy: actorId,
      updatedBy: actorId,
    });
    const refreshed = await AssistantManagerTaskLog.findByPk(created.id, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'cadence'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    res.status(201).json([
      {
        data: refreshed
          ? [formatLog(refreshed as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null })]
          : [],
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to create manual assistant manager task log', error);
    res.status(500).json([{ message: 'Failed to create manual task log' }]);
  }
};

export const updateTaskLogMeta = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const logId = Number(req.params.id);
    if (!Number.isInteger(logId) || logId <= 0) {
      res.status(400).json([{ message: 'Invalid task log id' }]);
      return;
    }
    const log = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'cadence', 'scheduleConfig', 'isActive'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    if (!log) {
      res.status(404).json([{ message: 'Task log not found' }]);
      return;
    }
    let payload: MetaUpdatePayload;
    try {
      payload = sanitizeLogMetaPayload(req.body ?? {});
    } catch (error) {
      res.status(400).json([{ message: error instanceof Error ? error.message : 'Invalid payload' }]);
      return;
    }
    const actorId = getActorId(req);
    const meta = { ...(log.meta ?? {}) } as Record<string, unknown>;
    Object.assign(meta, payload.metaPatch);
    let nextTaskDate = log.taskDate;
    if (payload.taskDate) {
      nextTaskDate = payload.taskDate;
    }
    const day = dayjs(nextTaskDate);
    const baseRequireShift =
      typeof meta['requireShift'] === 'boolean'
        ? Boolean(meta['requireShift'])
        : log.template
          ? getRequireShiftFlag(log.template)
          : false;
    const effectiveRequireShift =
      payload.requireShift != null ? Boolean(payload.requireShift) : baseRequireShift;
    const shiftInfo = await getShiftInfoForUserOnDate(
      log.userId,
      nextTaskDate,
      day.startOf('day'),
      day.endOf('day'),
    );
    Object.assign(meta, buildShiftMeta(shiftInfo, effectiveRequireShift));
    if (
      (!Object.prototype.hasOwnProperty.call(meta, 'time') || meta['time'] == null) &&
      shiftInfo?.timeStart
    ) {
      meta['time'] = normalizeTimeValue(shiftInfo.timeStart);
    }
    if (payload.comment) {
      const actorName = await getActorIdentity(actorId);
      appendCommentEntry(meta, payload.comment, actorId, actorName);
    }
    const updatePayload: Partial<AssistantManagerTaskLog> = {
      meta,
      updatedBy: actorId,
    };
    if (payload.taskDate) {
      updatePayload.taskDate = payload.taskDate;
    }
    if (payload.notes !== undefined) {
      updatePayload.notes = payload.notes;
    }
    await AssistantManagerTaskLog.update(updatePayload, { where: { id: logId } });
    const refreshed = await AssistantManagerTaskLog.findByPk(logId, {
      include: [
        { model: AssistantManagerTaskTemplate, as: 'template', attributes: ['id', 'name', 'cadence'] },
        { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
      ],
    });
    res.status(200).json([
      {
        data: refreshed
          ? [formatLog(refreshed as AssistantManagerTaskLog & { template?: AssistantManagerTaskTemplate | null; user?: User | null })]
          : [],
        columns: [],
      },
    ]);
  } catch (error) {
    console.error('Failed to update assistant manager task meta', error);
    res.status(500).json([{ message: 'Failed to update task log metadata' }]);
  }
};
