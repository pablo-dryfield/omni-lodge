import { Op, Transaction } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import weekday from 'dayjs/plugin/weekday.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import puppeteer from 'puppeteer';
import sequelize from '../config/database.js';
import ScheduleWeek, { type ScheduleWeekState } from '../models/ScheduleWeek.js';
import ShiftTemplate, { type ShiftTemplateRoleRequirement } from '../models/ShiftTemplate.js';
import ShiftType from '../models/ShiftType.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import Availability from '../models/Availability.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import Export from '../models/Export.js';
import SwapRequest, { type SwapRequestStatus } from '../models/SwapRequest.js';
import AuditLog from '../models/AuditLog.js';
import { renderScheduleHTML } from './renderSchedule.js';
import { ensureFolderPath, uploadBuffer } from './googleDrive.js';
import { sendSchedulingNotification } from './notificationService.js';
import HttpError from '../errors/HttpError.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(weekday);
dayjs.extend(customParseFormat);

const SCHED_TZ = process.env.SCHED_TZ || 'Europe/Warsaw';
const LOCK_DAY = Number(process.env.SCHED_LOCK_DAY ?? 0);
const LOCK_HOUR = Number(process.env.SCHED_LOCK_HOUR ?? 18);

const PUBLISHED_STATES: ScheduleWeekState[] = ['published'];
const PUB_CRAWL_KEYS = new Set(['PUB_CRAWL', 'PRIVATE_PUB_CRAWL']);

function getWeekStart(year: number, week: number): dayjs.Dayjs {
  return dayjs().tz(SCHED_TZ).isoWeekYear(year).isoWeek(week).startOf('isoWeek');
}

function formatWeekLabel(year: number, week: number): string {
  return `${year}-W${week.toString().padStart(2, '0')}`;
}

export type WeekIdentifier = {
  year: number;
  isoWeek: number;
};

function parseWeekParam(weekParam?: string | null): WeekIdentifier {
  if (weekParam && dayjs(weekParam, 'YYYY-[W]WW', true).isValid()) {
    const [year, week] = weekParam.split('-W');
    return { year: Number(year), isoWeek: Number(week) };
  }
  const target = dayjs().tz(SCHED_TZ).add(1, 'week');
  return { year: target.isoWeekYear(), isoWeek: target.isoWeek() };
}

export type ScheduleViolation = {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
  severity: 'error' | 'warning';
};

export type ScheduleWeekSummary = {
  week: ScheduleWeek;
  totals: {
    shiftInstances: number;
    assignments: number;
    volunteersWithTooFew: number;
    volunteersWithTooMany: number;
    pendingSwaps: number;
  };
  violations: ScheduleViolation[];
};

type AssignmentInput = {
  shiftInstanceId: number;
  userId: number;
  roleInShift: string;
  overrideReason?: string | null;
};

type AvailabilityInput = {
  day: string;
  startTime?: string | null;
  endTime?: string | null;
  shiftTypeId?: number | null;
  status: 'available' | 'unavailable';
};

type ShiftInstanceInput = {
  scheduleWeekId: number;
  shiftTypeId: number;
  date: string;
  timeStart: string;
  timeEnd?: string | null;
  capacity?: number | null;
  meta?: Record<string, unknown> | null;
  requiredRoles?: ShiftTemplateRoleRequirement[] | null;
  shiftTemplateId?: number | null;
};

async function logAudit(options: { actorId?: number | null; action: string; entity: string; entityId: string; meta?: Record<string, unknown> }): Promise<void> {
  await AuditLog.create({
    actorId: options.actorId ?? null,
    action: options.action,
    entity: options.entity,
    entityId: options.entityId,
    metaJson: options.meta ?? {},
    createdAt: dayjs().tz(SCHED_TZ).toDate(),
  });
}

async function ensureWeekExists(identifier: WeekIdentifier, transaction?: Transaction): Promise<{ week: ScheduleWeek; created: boolean }> {
  const [week, created] = await ScheduleWeek.findOrCreate({
    where: { year: identifier.year, isoWeek: identifier.isoWeek },
    defaults: {
      tz: SCHED_TZ,
      state: 'collecting',
    },
    transaction,
  });
  return { week, created };
}

async function spawnInstancesFromTemplates(week: ScheduleWeek, actorId: number | null, transaction: Transaction): Promise<void> {
  const templates = await ShiftTemplate.findAll({ transaction });
  const weekStart = getWeekStart(week.year, week.isoWeek);

  for (const template of templates) {
    if (!template.defaultStartTime) {
      continue;
    }
    for (let offset = 0; offset < 7; offset += 1) {
      const date = weekStart.add(offset, 'day').format('YYYY-MM-DD');
      const alreadyExists = await ShiftInstance.findOne({
        where: {
          scheduleWeekId: week.id,
          shiftTemplateId: template.id,
          date,
          timeStart: template.defaultStartTime,
        },
        transaction,
      });
      if (alreadyExists) {
        continue;
      }

      await ShiftInstance.create(
        {
          scheduleWeekId: week.id,
          shiftTypeId: template.shiftTypeId,
          shiftTemplateId: template.id,
          date,
          timeStart: template.defaultStartTime,
          timeEnd: template.defaultEndTime,
          capacity: template.defaultCapacity,
          requiredRoles: template.defaultRoles,
          meta: template.defaultMeta ?? {},
        },
        { transaction },
      );
    }
  }

  await logAudit({
    actorId,
    action: 'schedule.week.autospawn',
    entity: 'schedule_week',
    entityId: String(week.id),
    meta: { templateCount: templates.length },
  });
}

async function getVolunteerAssignmentCounts(weekId: number, transaction?: Transaction): Promise<Map<number, number>> {
  const assignments = await ShiftAssignment.findAll({
    attributes: ['userId'],
    include: [{
      model: ShiftInstance,
      as: 'shiftInstance',
      attributes: [],
      where: { scheduleWeekId: weekId },
    }],
    transaction,
  });
  const counts = new Map<number, number>();
  assignments.forEach((assignment) => {
    counts.set(assignment.userId, (counts.get(assignment.userId) ?? 0) + 1);
  });
  return counts;
}

async function getStaffProfiles(userIds: number[], transaction?: Transaction): Promise<Map<number, StaffProfile>> {
  if (userIds.length === 0) {
    return new Map();
  }
  const profiles = await StaffProfile.findAll({
    where: { userId: userIds },
    transaction,
  });
  const map = new Map<number, StaffProfile>();
  profiles.forEach((profile) => map.set(profile.userId, profile));
  return map;
}

async function validateVolunteerLimits(weekId: number, transaction?: Transaction): Promise<ScheduleViolation[]> {
  const counts = await getVolunteerAssignmentCounts(weekId, transaction);
  const profiles = await getStaffProfiles(Array.from(counts.keys()), transaction);
  const violations: ScheduleViolation[] = [];

  counts.forEach((count, userId) => {
    const profile = profiles.get(userId);
    if (!profile || !profile.active || profile.staffType !== 'volunteer' || !profile.livesInAccom) {
      return;
    }
    if (count < 3) {
      violations.push({
        code: 'volunteer-too-few',
        message: `Volunteer ${userId} has only ${count} shifts`,
        meta: { userId, count },
        severity: 'error',
      });
    }
    if (count > 4) {
      violations.push({
        code: 'volunteer-too-many',
        message: `Volunteer ${userId} exceeds weekly maximum (has ${count})`,
        meta: { userId, count },
        severity: 'error',
      });
    }
  });

  return violations;
}

async function validatePubCrawlAssignments(weekId: number, transaction?: Transaction): Promise<ScheduleViolation[]> {
  const violations: ScheduleViolation[] = [];
  const pubCrawlTypes = await ShiftType.findAll({
    where: { key: Array.from(PUB_CRAWL_KEYS) },
    transaction,
  });
  const typeIds = pubCrawlTypes.map((type) => type.id);
  if (typeIds.length === 0) {
    return violations;
  }

  const instances = await ShiftInstance.findAll({
    where: {
      scheduleWeekId: weekId,
      shiftTypeId: typeIds,
    },
    include: [{ model: ShiftAssignment, as: 'assignments' }],
    transaction,
  });

  instances.forEach((instance) => {
    const leaderCount = (instance.assignments ?? []).filter((assignment) => assignment.roleInShift.toLowerCase() === 'leader').length;
    const guideCount = (instance.assignments ?? []).filter((assignment) => assignment.roleInShift.toLowerCase() === 'guide').length;

    if (leaderCount !== 1) {
      violations.push({
        code: 'pub-crawl-leader',
        message: `Shift ${instance.id} must have exactly one leader (found ${leaderCount})`,
        meta: { shiftInstanceId: instance.id },
        severity: 'error',
      });
    }
    if (guideCount < 1) {
      violations.push({
        code: 'pub-crawl-guide',
        message: `Shift ${instance.id} must have at least one guide`,
        meta: { shiftInstanceId: instance.id },
        severity: 'error',
      });
    }
  });

  return violations;
}

async function validateAssistantManagers(weekId: number, transaction?: Transaction): Promise<ScheduleViolation[]> {
  const assignments = await ShiftAssignment.findAll({
    attributes: ['userId'],
    include: [
      {
        model: ShiftInstance,
        as: 'shiftInstance',
        where: { scheduleWeekId: weekId },
      },
      { model: User, as: 'assignee' },
    ],
    transaction,
  });

  const counts = new Map<number, number>();
  assignments.forEach((assignment) => counts.set(assignment.userId, (counts.get(assignment.userId) ?? 0) + 1));

  const profiles = await getStaffProfiles(Array.from(counts.keys()), transaction);
  const violations: ScheduleViolation[] = [];

  counts.forEach((count, userId) => {
    const profile = profiles.get(userId);
    const user = assignments.find((assignment) => assignment.userId === userId);
    const assignee = user ? (user as unknown as { assignee?: User }).assignee : undefined;
    if (!profile || !profile.active || !profile.livesInAccom) {
      return;
    }
    if (assignee?.roleKey === 'assistant_manager' && count > 6) {
      violations.push({
        code: 'assistant-manager-high-load',
        message: `Assistant Manager ${assignee.firstName} ${assignee.lastName} has ${count} shifts.`,
        meta: { userId, count },
        severity: 'warning',
      });
    }
  });
  return violations;
}

async function validateOverlaps(weekId: number, transaction?: Transaction): Promise<ScheduleViolation[]> {
  const assignments = await ShiftAssignment.findAll({
    include: [
      {
        model: ShiftInstance,
        as: 'shiftInstance',
        where: { scheduleWeekId: weekId },
      },
    ],
    transaction,
  });

  const grouped = new Map<number, ShiftAssignment[]>();
  assignments.forEach((assignment) => {
    const list = grouped.get(assignment.userId) ?? [];
    list.push(assignment);
    grouped.set(assignment.userId, list);
  });

  const violations: ScheduleViolation[] = [];
  grouped.forEach((list, userId) => {
    const sorted = list.sort((a, b) => {
      const aTime = dayjs(`${a.shiftInstance?.date} ${a.shiftInstance?.timeStart}`);
      const bTime = dayjs(`${b.shiftInstance?.date} ${b.shiftInstance?.timeStart}`);
      return aTime.valueOf() - bTime.valueOf();
    });

    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const first = sorted[i];
        const second = sorted[j];
        if (!first.shiftInstance || !second.shiftInstance) {
          continue;
        }
        if (first.shiftInstance.date !== second.shiftInstance.date) {
          continue;
        }

        const firstStart = dayjs(`${first.shiftInstance.date} ${first.shiftInstance.timeStart}`);
        const firstEnd = first.shiftInstance.timeEnd
          ? dayjs(`${first.shiftInstance.date} ${first.shiftInstance.timeEnd}`)
          : firstStart.add(2, 'hour');
        const secondStart = dayjs(`${second.shiftInstance.date} ${second.shiftInstance.timeStart}`);
        const secondEnd = second.shiftInstance.timeEnd
          ? dayjs(`${second.shiftInstance.date} ${second.shiftInstance.timeEnd}`)
          : secondStart.add(2, 'hour');

        if (firstEnd.isAfter(secondStart) && secondEnd.isAfter(firstStart)) {
          violations.push({
            code: 'overlap',
            message: `User ${userId} has overlapping assignments (${first.shiftInstanceId} & ${second.shiftInstanceId}).`,
            meta: { userId, shiftInstanceIds: [first.shiftInstanceId, second.shiftInstanceId] },
            severity: 'error',
          });
        }
      }
    }
  });

  return violations;
}

async function collectWeekViolations(weekId: number, transaction?: Transaction): Promise<ScheduleViolation[]> {
  const [volunteers, pubCrawl, assistantWarnings, overlaps] = await Promise.all([
    validateVolunteerLimits(weekId, transaction),
    validatePubCrawlAssignments(weekId, transaction),
    validateAssistantManagers(weekId, transaction),
    validateOverlaps(weekId, transaction),
  ]);
  return [...volunteers, ...pubCrawl, ...assistantWarnings, ...overlaps];
}

export async function generateWeek(options: { week?: string | null; actorId?: number | null; autoSpawn?: boolean }): Promise<{ week: ScheduleWeek; created: boolean }> {
  const identifier = parseWeekParam(options.week ?? null);
  const transaction = await sequelize.transaction();
  try {
    const { week, created } = await ensureWeekExists(identifier, transaction);
    if (created || options.autoSpawn) {
      await spawnInstancesFromTemplates(week, options.actorId ?? null, transaction);
    }
    await transaction.commit();

    await logAudit({
      actorId: options.actorId ?? null,
      action: 'schedule.week.generate',
      entity: 'schedule_week',
      entityId: String(week.id),
      meta: { created, identifier },
    });

    return { week, created };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function getWeekSummary(weekId: number): Promise<ScheduleWeekSummary> {
  const week = await ScheduleWeek.findByPk(weekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }

  const [shiftInstances, assignments, pendingSwaps, violations] = await Promise.all([
    ShiftInstance.count({ where: { scheduleWeekId: weekId } }),
    ShiftAssignment.count({
      include: [{
        model: ShiftInstance,
        as: 'shiftInstance',
        where: { scheduleWeekId: weekId },
      }],
    }),
    SwapRequest.count({
      where: { status: 'pending_manager' },
      include: [{
        model: ShiftAssignment,
        as: 'fromAssignment',
        include: [{
          model: ShiftInstance,
          as: 'shiftInstance',
          where: { scheduleWeekId: weekId },
        }],
      }],
    }),
    collectWeekViolations(weekId),
  ]);

  const volunteerTooFew = violations.filter((violation) => violation.code === 'volunteer-too-few').length;
  const volunteerTooMany = violations.filter((violation) => violation.code === 'volunteer-too-many').length;

  return {
    week,
    totals: {
      shiftInstances,
      assignments,
      volunteersWithTooFew: volunteerTooFew,
      volunteersWithTooMany: volunteerTooMany,
      pendingSwaps,
    },
    violations,
  };
}

export async function lockWeek(weekId: number, actorId: number | null): Promise<ScheduleWeekSummary> {
  const week = await ScheduleWeek.findByPk(weekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  if (week.state === 'published') {
    throw new HttpError(400, 'Week is already published');
  }

  week.state = 'locked';
  await week.save();

  await logAudit({
    actorId,
    action: 'schedule.week.lock',
    entity: 'schedule_week',
    entityId: String(week.id),
  });

  return getWeekSummary(weekId);
}

function assertWeekMutable(week: ScheduleWeek): void {
  if (PUBLISHED_STATES.includes(week.state)) {
    throw new HttpError(400, 'Week is already published');
  }
}

async function renderAndUploadWeek(week: ScheduleWeek, actorId: number | null): Promise<Export[]> {
  const { html } = await renderScheduleHTML(week.id);
  const headlessEnv = process.env.PUPPETEER_HEADLESS?.toLowerCase();
  const headlessMode: boolean | 'shell' | undefined =
    headlessEnv === 'shell' ? 'shell' : headlessEnv === 'false' ? false : true;
  const browser = await puppeteer.launch({
    headless: headlessMode,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const [pdf, png] = await Promise.all([
      page.pdf({ format: 'A4', printBackground: true }),
      page.screenshot({ type: 'png', fullPage: true }),
    ]);

    const folderPath = `Schedules/${week.year}/Week-${week.isoWeek.toString().padStart(2, '0')}`;
    const folder = await ensureFolderPath(folderPath);

    const uploads = await Promise.all([
      uploadBuffer({
        name: `Week-${week.isoWeek}-schedule.pdf`,
        mimeType: 'application/pdf',
        buffer: pdf,
        parents: [folder.id],
      }),
      uploadBuffer({
        name: `Week-${week.isoWeek}-schedule.png`,
        mimeType: 'image/png',
        buffer: png,
        parents: [folder.id],
      }),
    ]);

    const records: Export[] = [];
    for (const upload of uploads) {
      const record = await Export.create({
        scheduleWeekId: week.id,
        driveFileId: upload.id,
        url: upload.webViewLink ?? upload.webContentLink ?? '',
        createdAt: dayjs().tz(SCHED_TZ).toDate(),
      });
      records.push(record);
    }

    await logAudit({
      actorId,
      action: 'schedule.week.export',
      entity: 'schedule_week',
      entityId: String(week.id),
      meta: { files: records.map((record) => record.url) },
    });

    return records;
  } finally {
    await browser.close();
  }
}

export async function publishWeek(weekId: number, actorId: number | null): Promise<{ exports: Export[]; summary: ScheduleWeekSummary }> {
  const week = await ScheduleWeek.findByPk(weekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  if (week.state === 'collecting') {
    throw new HttpError(400, 'Lock the week before publishing.');
  }
  if (week.state === 'published') {
    throw new HttpError(400, 'Week already published.');
  }

  const violations = await collectWeekViolations(weekId);
  const blocking = violations.filter((violation) => violation.severity === 'error');
  if (blocking.length > 0) {
    throw new HttpError(400, 'Week has blocking violations.', { violations: blocking });
  }

  const exports = await renderAndUploadWeek(week, actorId);
  week.state = 'published';
  await week.save();

  const assignments = await ShiftAssignment.findAll({
    include: [
      { model: User, as: 'assignee' },
      {
        model: ShiftInstance,
        as: 'shiftInstance',
        where: { scheduleWeekId: weekId },
        include: [{ model: ShiftType, as: 'shiftType' }],
      },
    ],
  });

  const grouped = new Map<number, Array<Record<string, unknown>>>();
  assignments.forEach((assignment) => {
    if (!assignment.shiftInstance) {
      return;
    }
    const shiftType = (assignment.shiftInstance as unknown as { shiftType?: ShiftType }).shiftType;
    const dayLabel = dayjs(assignment.shiftInstance.date).format('dddd, MMM D');
    const entry = grouped.get(assignment.userId) ?? [];
    entry.push({
      shiftType: shiftType?.name ?? 'Shift',
      day: dayLabel,
      timeStart: assignment.shiftInstance.timeStart,
      roleInShift: assignment.roleInShift,
    });
    grouped.set(assignment.userId, entry);
  });

  await Promise.all(
    Array.from(grouped.entries()).map(async ([userId, payload]) => {
      const user = await User.findByPk(userId);
      if (!user) {
        return;
      }
      await sendSchedulingNotification({
        user,
        templateKey: 'assignment_published',
        payload: {
          weekLabel: formatWeekLabel(week.year, week.isoWeek),
          assignments: payload,
        },
      });
    }),
  );

  await logAudit({
    actorId,
    action: 'schedule.week.publish',
    entity: 'schedule_week',
    entityId: String(week.id),
    meta: { exportCount: exports.length },
  });

  return {
    exports,
    summary: await getWeekSummary(weekId),
  };
}

export async function listShiftTemplates(): Promise<ShiftTemplate[]> {
  return ShiftTemplate.findAll({
    order: [['name', 'ASC']],
  });
}

export async function upsertShiftTemplate(
  payload: {
    id?: number;
    shiftTypeId: number;
    name: string;
    defaultStartTime?: string | null;
    defaultEndTime?: string | null;
    defaultCapacity?: number | null;
    requiresLeader?: boolean;
    defaultRoles?: ShiftTemplateRoleRequirement[] | null;
    defaultMeta?: Record<string, unknown> | null;
  },
  actorId: number | null,
): Promise<ShiftTemplate> {
  const data = {
    shiftTypeId: payload.shiftTypeId,
    name: payload.name.trim(),
    defaultStartTime: payload.defaultStartTime ?? null,
    defaultEndTime: payload.defaultEndTime ?? null,
    defaultCapacity: payload.defaultCapacity ?? null,
    requiresLeader: payload.requiresLeader ?? false,
    defaultRoles: payload.defaultRoles ?? null,
    defaultMeta: payload.defaultMeta ?? null,
  };

  let template: ShiftTemplate | null = null;
  if (payload.id) {
    template = await ShiftTemplate.findByPk(payload.id);
    if (!template) {
      throw new HttpError(404, 'Shift template not found');
    }
    await template.update(data);
  } else {
    template = await ShiftTemplate.create(data);
  }

  await logAudit({
    actorId,
    action: payload.id ? 'schedule.template.update' : 'schedule.template.create',
    entity: 'shift_template',
    entityId: String(template.id),
  });

  return template;
}

export async function deleteShiftTemplate(templateId: number, actorId: number | null): Promise<void> {
  const template = await ShiftTemplate.findByPk(templateId);
  if (!template) {
    throw new HttpError(404, 'Shift template not found');
  }
  await template.destroy();

  await logAudit({
    actorId,
    action: 'schedule.template.delete',
    entity: 'shift_template',
    entityId: String(templateId),
  });
}

export async function createShiftInstance(input: ShiftInstanceInput, actorId: number | null): Promise<ShiftInstance> {
  const week = await ScheduleWeek.findByPk(input.scheduleWeekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  assertWeekMutable(week);

  const instance = await ShiftInstance.create({
    scheduleWeekId: input.scheduleWeekId,
    shiftTypeId: input.shiftTypeId,
    shiftTemplateId: input.shiftTemplateId ?? null,
    date: input.date,
    timeStart: input.timeStart,
    timeEnd: input.timeEnd ?? null,
    capacity: input.capacity ?? null,
    requiredRoles: input.requiredRoles ?? null,
    meta: input.meta ?? {},
  });

  await logAudit({
    actorId,
    action: 'schedule.instance.create',
    entity: 'shift_instance',
    entityId: String(instance.id),
  });

  return instance;
}

export async function updateShiftInstance(instanceId: number, updates: Partial<ShiftInstanceInput>, actorId: number | null): Promise<ShiftInstance> {
  const instance = await ShiftInstance.findByPk(instanceId);
  if (!instance) {
    throw new HttpError(404, 'Shift instance not found');
  }
  const week = await ScheduleWeek.findByPk(instance.scheduleWeekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  assertWeekMutable(week);

  await instance.update({
    date: updates.date ?? instance.date,
    timeStart: updates.timeStart ?? instance.timeStart,
    timeEnd: updates.timeEnd ?? instance.timeEnd,
    capacity: updates.capacity ?? instance.capacity,
    requiredRoles: updates.requiredRoles ?? instance.requiredRoles,
    meta: updates.meta ?? instance.meta,
  });

  await logAudit({
    actorId,
    action: 'schedule.instance.update',
    entity: 'shift_instance',
    entityId: String(instance.id),
  });

  return instance;
}

export async function deleteShiftInstance(instanceId: number, actorId: number | null): Promise<void> {
  const instance = await ShiftInstance.findByPk(instanceId, {
    include: [{ model: ScheduleWeek, as: 'scheduleWeek' }],
  });
  if (!instance) {
    throw new HttpError(404, 'Shift instance not found');
  }
  const week = instance.scheduleWeek;
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  assertWeekMutable(week);

  await instance.destroy();
  await logAudit({
    actorId,
    action: 'schedule.instance.delete',
    entity: 'shift_instance',
    entityId: String(instanceId),
  });
}

export async function listShiftInstances(weekId: number): Promise<ShiftInstance[]> {
  return ShiftInstance.findAll({
    where: { scheduleWeekId: weekId },
    include: [
      { model: ShiftType, as: 'shiftType' },
      { model: ShiftTemplate, as: 'template' },
      {
        model: ShiftAssignment,
        as: 'assignments',
        include: [{ model: User, as: 'assignee' }],
      },
    ],
    order: [
      ['date', 'ASC'],
      ['timeStart', 'ASC'],
    ],
  });
}

async function findAvailabilityForAssignment(instance: ShiftInstance, userId: number): Promise<Availability | null> {
  return Availability.findOne({
    where: {
      userId,
      scheduleWeekId: instance.scheduleWeekId,
      day: instance.date,
      status: 'available',
    },
  });
}

export async function createShiftAssignmentsBulk(assignments: AssignmentInput[], actorId: number | null): Promise<ShiftAssignment[]> {
  if (assignments.length === 0) {
    return [];
  }

  return sequelize.transaction(async (transaction) => {
    const created: ShiftAssignment[] = [];

    for (const input of assignments) {
      const instance = await ShiftInstance.findByPk(input.shiftInstanceId, {
        include: [{ model: ScheduleWeek, as: 'scheduleWeek' }],
        transaction,
      });
      if (!instance || !instance.scheduleWeek) {
        throw new HttpError(404, 'Shift instance not found');
      }
      assertWeekMutable(instance.scheduleWeek);

      const existing = await ShiftAssignment.findOne({
        where: {
          shiftInstanceId: input.shiftInstanceId,
          userId: input.userId,
        },
        transaction,
      });
      if (existing) {
        throw new HttpError(400, 'User already assigned to this shift.');
      }

      const weekAssignments = await ShiftAssignment.findAll({
        where: { userId: input.userId },
        include: [{
          model: ShiftInstance,
          as: 'shiftInstance',
          where: { scheduleWeekId: instance.scheduleWeekId },
        }],
        transaction,
      });

      const profile = await StaffProfile.findOne({
        where: { userId: input.userId },
        transaction,
      });

      if (profile && profile.active && profile.staffType === 'volunteer' && profile.livesInAccom && weekAssignments.length >= 4) {
        throw new HttpError(400, 'Volunteer living in accommodation cannot exceed 4 shifts per week.');
      }

      weekAssignments.forEach((assignment) => {
        const other = assignment.shiftInstance;
        if (!other || other.date !== instance.date) {
          return;
        }

        const thisStart = dayjs(`${instance.date} ${instance.timeStart}`);
        const thisEnd = instance.timeEnd ? dayjs(`${instance.date} ${instance.timeEnd}`) : thisStart.add(2, 'hour');
        const otherStart = dayjs(`${other.date} ${other.timeStart}`);
        const otherEnd = other.timeEnd ? dayjs(`${other.date} ${other.timeEnd}`) : otherStart.add(2, 'hour');

        if (thisEnd.isAfter(otherStart) && otherEnd.isAfter(thisStart)) {
          throw new HttpError(400, `Assignment for user ${input.userId} overlaps with shift ${assignment.shiftInstanceId}.`);
        }
      });

      const availability = await findAvailabilityForAssignment(instance, input.userId);
      if (!availability && (!input.overrideReason || input.overrideReason.trim().length === 0)) {
        throw new HttpError(400, 'Assignment outside availability. Provide override reason.');
      }

      const assignment = await ShiftAssignment.create(
        {
          shiftInstanceId: input.shiftInstanceId,
          userId: input.userId,
          roleInShift: input.roleInShift,
        },
        { transaction },
      );
      created.push(assignment);

      if (!availability && input.overrideReason) {
        await logAudit({
          actorId,
          action: 'schedule.assignment.override',
          entity: 'shift_assignment',
          entityId: String(assignment.id),
          meta: {
            reason: input.overrideReason,
            shiftInstanceId: assignment.shiftInstanceId,
            userId: assignment.userId,
          },
        });
      }
    }

    await logAudit({
      actorId,
      action: 'schedule.assignment.create-bulk',
      entity: 'schedule_week',
      entityId: String(created[0]?.shiftInstanceId ?? 0),
      meta: { created: created.length },
    });

    return created;
  });
}

export async function deleteShiftAssignment(assignmentId: number, actorId: number | null): Promise<void> {
  const assignment = await ShiftAssignment.findByPk(assignmentId, {
    include: [{
      model: ShiftInstance,
      as: 'shiftInstance',
      include: [{ model: ScheduleWeek, as: 'scheduleWeek' }],
    }],
  });
  if (!assignment || !assignment.shiftInstance || !assignment.shiftInstance.scheduleWeek) {
    throw new HttpError(404, 'Assignment not found');
  }
  assertWeekMutable(assignment.shiftInstance.scheduleWeek);

  const profile = await StaffProfile.findOne({ where: { userId: assignment.userId } });
  if (profile && profile.active && profile.staffType === 'volunteer' && profile.livesInAccom) {
    const remaining = await ShiftAssignment.count({
      where: { userId: assignment.userId },
      include: [{
        model: ShiftInstance,
        as: 'shiftInstance',
        where: { scheduleWeekId: assignment.shiftInstance.scheduleWeekId },
      }],
    });
    if (remaining <= 3) {
      throw new HttpError(400, 'Removing this assignment would drop volunteer below minimum shift requirement.');
    }
  }

  await assignment.destroy();
  await logAudit({
    actorId,
    action: 'schedule.assignment.delete',
    entity: 'shift_assignment',
    entityId: String(assignmentId),
  });
}

export async function upsertAvailability(userId: number, scheduleWeekId: number, entries: AvailabilityInput[]): Promise<Availability[]> {
  const week = await ScheduleWeek.findByPk(scheduleWeekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  if (week.state !== 'collecting') {
    throw new HttpError(400, 'Availability submissions are locked.');
  }

  const transaction = await sequelize.transaction();
  try {
    const saved: Availability[] = [];
    for (const entry of entries) {
      const [record] = await Availability.findOrCreate({
        where: {
          userId,
          scheduleWeekId,
          day: entry.day,
          shiftTypeId: entry.shiftTypeId ?? null,
          startTime: entry.startTime ?? null,
          endTime: entry.endTime ?? null,
        },
        defaults: {
          status: entry.status,
        },
        transaction,
      });

      await record.update(
        {
          status: entry.status,
          startTime: entry.startTime ?? null,
          endTime: entry.endTime ?? null,
          shiftTypeId: entry.shiftTypeId ?? null,
        },
        { transaction },
      );
      saved.push(record);
    }
    await transaction.commit();
    return saved;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function getAvailabilityForUser(userId: number, scheduleWeekId: number): Promise<Availability[]> {
  return Availability.findAll({
    where: { userId, scheduleWeekId },
    order: [['day', 'ASC']],
  });
}

export async function createSwapRequest(payload: {
  fromAssignmentId: number;
  toAssignmentId: number;
  partnerId: number;
  requesterId: number;
}): Promise<SwapRequest> {
  const fromAssignment = await ShiftAssignment.findByPk(payload.fromAssignmentId);
  if (!fromAssignment) {
    throw new HttpError(404, 'Source assignment not found');
  }
  if (fromAssignment.userId !== payload.requesterId) {
    throw new HttpError(403, 'You can only swap your own assignment');
  }

  const toAssignment = await ShiftAssignment.findByPk(payload.toAssignmentId);
  if (!toAssignment) {
    throw new HttpError(404, 'Target assignment not found');
  }
  if (toAssignment.userId !== payload.partnerId) {
    throw new HttpError(400, 'Target assignment must belong to partner');
  }

  const swap = await SwapRequest.create({
    fromAssignmentId: payload.fromAssignmentId,
    toAssignmentId: payload.toAssignmentId,
    requesterId: payload.requesterId,
    partnerId: payload.partnerId,
    status: 'pending_partner',
  });

  const partner = await User.findByPk(payload.partnerId);
  if (partner) {
    await sendSchedulingNotification({
      user: partner,
      templateKey: 'swap_request',
      payload: {
        shiftType: 'Shift',
        day: dayjs().format('dddd'),
        requesterName: 'Colleague',
      },
    });
  }

  await logAudit({
    actorId: payload.requesterId,
    action: 'schedule.swap.create',
    entity: 'swap_request',
    entityId: String(swap.id),
  });

  return swap;
}

export async function swapPartnerResponse(swapId: number, partnerId: number, accept: boolean): Promise<SwapRequest> {
  const swap = await SwapRequest.findByPk(swapId);
  if (!swap) {
    throw new HttpError(404, 'Swap request not found');
  }
  if (swap.partnerId !== partnerId) {
    throw new HttpError(403, 'Only the partner can respond to swap');
  }

  swap.status = accept ? 'pending_manager' : 'denied';
  await swap.save();

  await logAudit({
    actorId: partnerId,
    action: 'schedule.swap.partner-response',
    entity: 'swap_request',
    entityId: String(swap.id),
    meta: { accept },
  });

  return swap;
}

export async function swapManagerDecision(swapId: number, managerId: number, approve: boolean, reason?: string): Promise<SwapRequest> {
  const swap = await SwapRequest.findByPk(swapId, {
    include: [
      { model: ShiftAssignment, as: 'fromAssignment' },
      { model: ShiftAssignment, as: 'toAssignment' },
    ],
  });
  if (!swap) {
    throw new HttpError(404, 'Swap request not found');
  }
  if (swap.status !== 'pending_manager') {
    throw new HttpError(400, 'Swap not awaiting manager decision');
  }

  if (approve) {
    await sequelize.transaction(async (transaction) => {
      if (!swap.fromAssignment || !swap.toAssignment) {
        throw new HttpError(400, 'Swap assignments missing');
      }
      const fromUser = swap.fromAssignment.userId;
      const toUser = swap.toAssignment.userId;

      await swap.fromAssignment.update({ userId: toUser }, { transaction });
      await swap.toAssignment.update({ userId: fromUser }, { transaction });
    });
  }

  swap.status = approve ? 'approved' : 'denied';
  swap.managerId = managerId;
  swap.decisionReason = reason ?? null;
  await swap.save();

  const participants = await User.findAll({
    where: { id: [swap.requesterId, swap.partnerId] },
  });
  await Promise.all(
    participants.map((participant) =>
      sendSchedulingNotification({
        user: participant,
        templateKey: 'swap_manager_decision',
        payload: {
          decision: approve ? 'approved' : 'denied',
          reason: reason ?? '',
        },
      }),
    ),
  );

  await logAudit({
    actorId: managerId,
    action: 'schedule.swap.manager-decision',
    entity: 'swap_request',
    entityId: String(swap.id),
    meta: { approve, reason },
  });

  return swap;
}

export async function listSwapsByStatus(status: SwapRequestStatus): Promise<SwapRequest[]> {
  return SwapRequest.findAll({
    where: { status },
    include: [
      { model: ShiftAssignment, as: 'fromAssignment' },
      { model: ShiftAssignment, as: 'toAssignment' },
      { model: User, as: 'requester' },
      { model: User, as: 'partner' },
      { model: User, as: 'manager' },
    ],
    order: [['createdAt', 'DESC']],
  });
}

export async function listSwapsForUser(userId: number): Promise<SwapRequest[]> {
  return SwapRequest.findAll({
    where: {
      [Op.or]: [{ requesterId: userId }, { partnerId: userId }],
    },
    include: [
      { model: ShiftAssignment, as: 'fromAssignment', include: [{ model: ShiftInstance, as: 'shiftInstance' }] },
      { model: ShiftAssignment, as: 'toAssignment', include: [{ model: ShiftInstance, as: 'shiftInstance' }] },
      { model: User, as: 'requester' },
      { model: User, as: 'partner' },
      { model: User, as: 'manager' },
    ],
    order: [['createdAt', 'DESC']],
  });
}

export async function listExports(weekId: number): Promise<Export[]> {
  return Export.findAll({
    where: { scheduleWeekId: weekId },
    order: [['createdAt', 'DESC']],
  });
}

export async function listHistoricalAssignments(params: { from: WeekIdentifier; to: WeekIdentifier; userId?: number }): Promise<ShiftAssignment[]> {
  const start = getWeekStart(params.from.year, params.from.isoWeek);
  const end = getWeekStart(params.to.year, params.to.isoWeek).endOf('isoWeek');

  return ShiftAssignment.findAll({
    where: params.userId ? { userId: params.userId } : undefined,
    include: [
      {
        model: ShiftInstance,
        as: 'shiftInstance',
        where: {
          date: {
            [Op.between]: [start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD')],
          },
        },
        include: [{ model: ShiftType, as: 'shiftType' }],
      },
      { model: User, as: 'assignee' },
    ],
    order: [[{ model: ShiftInstance, as: 'shiftInstance' }, 'date', 'ASC']],
  });
}

export async function sendAvailabilityReminder(reminderKey: 'availability_reminder_first' | 'availability_reminder_final'): Promise<void> {
  const identifier = parseWeekParam(null);
  const { week } = await ensureWeekExists(identifier);
  if (week.state !== 'collecting') {
    return;
  }

  const weekLabel = formatWeekLabel(week.year, week.isoWeek);
  const deadline = getWeekStart(week.year, week.isoWeek).weekday(LOCK_DAY).hour(LOCK_HOUR).format('dddd HH:mm');

  const staff = await StaffProfile.findAll({
    where: { active: true },
    include: [{ model: User, as: 'user' }],
  });
  const submitted = await Availability.findAll({
    attributes: ['userId'],
    where: { scheduleWeekId: week.id },
  });
  const submittedIds = new Set(submitted.map((record) => record.userId));

  await Promise.all(
    staff
      .filter((profile) => profile.user && !submittedIds.has(profile.user.id))
      .map((profile) =>
        sendSchedulingNotification({
          user: profile.user!,
          templateKey: reminderKey,
          payload: {
            weekLabel,
            deadline,
          },
        }),
      ),
  );
}

export async function autoLockCollectingWeek(): Promise<void> {
  const identifier = parseWeekParam(null);
  const { week } = await ensureWeekExists(identifier);
  if (week.state !== 'collecting') {
    return;
  }

  week.state = 'locked';
  await week.save();

  const managers = await User.findAll({
    where: { roleKey: ['owner', 'admin', 'assistant_manager'] },
  });

  await Promise.all(
    managers.map((manager) =>
      sendSchedulingNotification({
        user: manager,
        templateKey: 'submissions_locked',
        payload: {
          weekLabel: formatWeekLabel(week.year, week.isoWeek),
        },
      }),
    ),
  );
}
