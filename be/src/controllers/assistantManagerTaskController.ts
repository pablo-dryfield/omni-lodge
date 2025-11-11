import { Op, type WhereOptions } from 'sequelize';
import type { Request, Response } from 'express';
import dayjs from 'dayjs';
import AssistantManagerTaskTemplate, { type AssistantManagerTaskCadence } from '../models/AssistantManagerTaskTemplate.js';
import AssistantManagerTaskAssignment, { type AssistantManagerTaskAssignmentScope } from '../models/AssistantManagerTaskAssignment.js';
import AssistantManagerTaskLog, { type AssistantManagerTaskStatus } from '../models/AssistantManagerTaskLog.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const CADENCE_VALUES = new Set<AssistantManagerTaskCadence>(['daily', 'weekly', 'biweekly', 'every_two_weeks', 'monthly']);
const STATUS_VALUES = new Set<AssistantManagerTaskStatus>(['pending', 'completed', 'missed', 'waived']);
const ASSIGNMENT_SCOPE_VALUES = new Set<AssistantManagerTaskAssignmentScope>(['staff_type', 'user']);

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
  for (const assignment of assignments) {
    const template = assignment.template;
    if (!template || template.isActive === false || assignment.isActive === false) {
      continue;
    }
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
        await AssistantManagerTaskLog.findOrCreate({
          where: {
            templateId: template.id,
            userId,
            taskDate,
          },
          defaults: {
            assignmentId: assignment.id,
            status: 'pending',
            meta: {},
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
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
