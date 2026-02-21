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
import ShiftTypeProduct from '../models/ShiftTypeProduct.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import Availability from '../models/Availability.js';
import StaffProfile from '../models/StaffProfile.js';
import User from '../models/User.js';
import Export from '../models/Export.js';
import SwapRequest, { type SwapRequestStatus } from '../models/SwapRequest.js';
import AuditLog from '../models/AuditLog.js';
import ShiftRole from '../models/ShiftRole.js';
import UserShiftRole from '../models/UserShiftRole.js';
import Product from '../models/Product.js';
import { renderScheduleHTML } from './renderSchedule.js';
import { ensureFolderPath, uploadBuffer } from './googleDrive.js';
import { sendSchedulingNotification } from './notificationService.js';
import HttpError from '../errors/HttpError.js';
import { getConfigValue } from './configService.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(weekday);
dayjs.extend(customParseFormat);

const resolveScheduleTimezone = (): string => (getConfigValue('SCHED_TZ') as string) ?? 'Europe/Warsaw';
const resolveLockDay = (): number => Number(getConfigValue('SCHED_LOCK_DAY') ?? 0);
const resolveLockHour = (): number => Number(getConfigValue('SCHED_LOCK_HOUR') ?? 18);

const PUBLISHED_STATES: ScheduleWeekState[] = ['published'];
const PUB_CRAWL_KEYS = new Set(['PUB_CRAWL', 'PRIVATE_PUB_CRAWL']);

const DEFAULT_SHIFT_TYPES: Array<{ key: string; name: string; description: string | null }> = [
  { key: 'PUB_CRAWL', name: 'Pub Crawl', description: 'Nightly pub crawl with designated leader and guides.' },
  { key: 'PRIVATE_PUB_CRAWL', name: 'Private Pub Crawl', description: 'Private crawl for booked groups.' },
  { key: 'BOTTOMLESS_BRUNCH', name: 'Bottomless Brunch', description: 'Brunch shift covering guests and logistics.' },
  { key: 'GO_KARTING', name: 'Go Karting', description: 'Go-karting coordination shift.' },
  { key: 'PROMOTION', name: 'Promotion', description: 'Street promotion and outreach shift.' },
  { key: 'SOCIAL_MEDIA', name: 'Social Media', description: 'Evening social media coverage.' },
  { key: 'CLEANING', name: 'Cleaning', description: 'Cleaning shift for assigned area.' },
  { key: 'ORG_MANAGER', name: 'Organization Duty Manager', description: 'Manager on duty overseeing operations.' },
];

const ALL_WEEKDAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

const MAX_VOLUNTEER_WEEKLY_ASSIGNMENTS = 4;
const MIN_VOLUNTEER_WEEKLY_ASSIGNMENTS = 4;
const DEFAULT_SHIFT_DURATION_HOURS = 2;

function getWeekStart(year: number, week: number): dayjs.Dayjs {
  // Derive the Monday of the ISO week directly to avoid parsing quirks around year boundaries.
  return dayjs().tz(resolveScheduleTimezone()).year(year).isoWeek(week).startOf('isoWeek');
}

function formatWeekLabel(year: number, week: number): string {
  return `${year}-W${week.toString().padStart(2, '0')}`;
}

export type WeekIdentifier = {
  year: number;
  isoWeek: number;
};

const ISO_WEEK_PARAM_REGEX = /^(\d{4})-W(\d{1,2})$/i;

export function parseWeekParam(weekParam?: string | null): WeekIdentifier {
  if (typeof weekParam === 'string') {
    const trimmed = weekParam.trim();
    const match = ISO_WEEK_PARAM_REGEX.exec(trimmed);
    if (match) {
      const year = Number(match[1]);
      const week = Number(match[2]);
      if (!Number.isNaN(year) && !Number.isNaN(week) && week >= 1 && week <= 53) {
        return { year, isoWeek: week };
      }
    }
    if (dayjs(weekParam, 'YYYY-[W]WW', true).isValid()) {
      const [year, week] = weekParam.split('-W');
      return { year: Number(year), isoWeek: Number(week) };
    }
  }
  const target = dayjs().tz(resolveScheduleTimezone()).add(1, 'week');
  return { year: target.isoWeekYear(), isoWeek: target.isoWeek() };
}

export async function listScheduleWeeks(options?: { limit?: number }): Promise<ScheduleWeek[]> {
  const queryOptions: { order: Array<[string, string]>; limit?: number } = {
    order: [
      ['year', 'ASC'],
      ['isoWeek', 'ASC'],
    ],
  };
  if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
    queryOptions.limit = Math.floor(options.limit);
  }
  return ScheduleWeek.findAll(queryOptions);
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
  shiftRoleId?: number | null;
  overrideReason?: string | null;
};

const matchesRoleDefinition = (definition: ShiftTemplateRoleRequirement, assignment: AssignmentInput): boolean => {
  if (definition.shiftRoleId != null && assignment.shiftRoleId != null) {
    return definition.shiftRoleId === assignment.shiftRoleId;
  }
  if (definition.shiftRoleId == null && assignment.shiftRoleId == null) {
    const normalizedDefinition = normalizeRoleName(definition.role ?? '');
    const normalizedAssignment = normalizeRoleName(assignment.roleInShift);
    if (!normalizedDefinition || !normalizedAssignment) {
      return false;
    }
    return (
      normalizedDefinition === normalizedAssignment ||
      normalizedDefinition.includes(normalizedAssignment) ||
      normalizedAssignment.includes(normalizedDefinition)
    );
  }
  return false;
};

const doesUserHaveRoleForDefinition = (
  userId: number,
  definition: ShiftTemplateRoleRequirement,
  userRoleIdsByUserId: Map<number, Set<number>>,
  shiftRoleNameById: Map<number, string>,
): boolean => {
  const roleSet = userRoleIdsByUserId.get(userId);
  if (!roleSet || roleSet.size === 0) {
    return false;
  }
  if (definition.shiftRoleId != null) {
    return roleSet.has(definition.shiftRoleId);
  }
  const normalizedDefinition = normalizeRoleName(definition.role ?? '');
  if (!normalizedDefinition) {
    return false;
  }
  for (const roleId of roleSet) {
    const roleName = shiftRoleNameById.get(roleId);
    if (!roleName) {
      continue;
    }
    const normalizedUserRole = normalizeRoleName(roleName);
    if (
      normalizedUserRole === normalizedDefinition ||
      normalizedUserRole.includes(normalizedDefinition) ||
      normalizedDefinition.includes(normalizedUserRole)
    ) {
      return true;
    }
  }
  return false;
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
    createdAt: dayjs().tz(resolveScheduleTimezone()).toDate(),
  });
}

async function ensureWeekExists(identifier: WeekIdentifier, transaction?: Transaction): Promise<{ week: ScheduleWeek; created: boolean }> {
  const [week, created] = await ScheduleWeek.findOrCreate({
    where: { year: identifier.year, isoWeek: identifier.isoWeek },
    defaults: {
      tz: resolveScheduleTimezone(),
      state: 'collecting',
    },
    transaction,
  });
  return { week, created };
}

type SpawnInstancesOptions = {
  templateIds?: number[] | null;
  logAction?: string;
};

type SpawnInstancesSummary = {
  created: number;
  skipped: number;
  templateCount: number;
};

async function spawnInstancesFromTemplates(
  week: ScheduleWeek,
  actorId: number | null,
  transaction: Transaction,
  options?: SpawnInstancesOptions,
): Promise<SpawnInstancesSummary> {
  const templateFilter =
    options?.templateIds && options.templateIds.length > 0 ? { id: options.templateIds } : undefined;
  const templates = await ShiftTemplate.findAll({ where: templateFilter, transaction });
  if (options?.templateIds && options.templateIds.length > 0 && templates.length === 0) {
    throw new HttpError(404, 'No matching shift templates were found.');
  }
  const weekStart = getWeekStart(week.year, week.isoWeek);
  let created = 0;
  let skipped = 0;

  for (const template of templates) {
    if (!template.defaultStartTime) {
      continue;
    }
    const activeDays = Array.isArray(template.repeatOn) && template.repeatOn.length > 0 ? template.repeatOn : ALL_WEEKDAY_NUMBERS.slice();
    const activeDaySet = new Set(activeDays);
    for (let offset = 0; offset < 7; offset += 1) {
      const currentDay = weekStart.add(offset, 'day');
      const isoWeekday = currentDay.isoWeekday();
      if (!activeDaySet.has(isoWeekday)) {
        continue;
      }
      const date = currentDay.format('YYYY-MM-DD');
      const alreadyExists = await ShiftInstance.findOne({
        where: {
          scheduleWeekId: week.id,
          date,
          [Op.or]: [
            { shiftTemplateId: template.id },
            {
              shiftTemplateId: null,
              shiftTypeId: template.shiftTypeId,
            },
          ],
        },
        transaction,
      });
      if (alreadyExists) {
        skipped += 1;
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
      created += 1;
    }
  }

  await logAudit({
    actorId,
    action: options?.logAction ?? 'schedule.week.autospawn',
    entity: 'schedule_week',
    entityId: String(week.id),
    meta: { templateCount: templates.length, created, skipped },
  });

  return { created, skipped, templateCount: templates.length };
}

type VolunteerWeekAssignmentSummary = {
  totalAssignments: number;
  uniqueDayCount: number;
};

async function getVolunteerAssignmentCounts(
  weekId: number,
  transaction?: Transaction,
): Promise<Map<number, VolunteerWeekAssignmentSummary>> {
  const assignments = await ShiftAssignment.findAll({
    attributes: ['userId'],
    include: [{
      model: ShiftInstance,
      as: 'shiftInstance',
      attributes: ['date'],
      where: { scheduleWeekId: weekId },
    }],
    transaction,
  });
  const interim = new Map<number, { totalAssignments: number; dates: Set<string> }>();
  assignments.forEach((assignment) => {
    if (!assignment.userId) {
      return;
    }
    const existing = interim.get(assignment.userId);
    const dates = existing?.dates ?? new Set<string>();
    const totalAssignments = (existing?.totalAssignments ?? 0) + 1;
    const date = assignment.shiftInstance?.date;
    if (date) {
      dates.add(date);
    }
    interim.set(assignment.userId, { totalAssignments, dates });
  });
  const summaries = new Map<number, VolunteerWeekAssignmentSummary>();
  interim.forEach((value, userId) => {
    summaries.set(userId, {
      totalAssignments: value.totalAssignments,
      uniqueDayCount: value.dates.size,
    });
  });
  return summaries;
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

type ShiftRange = { start: dayjs.Dayjs; end: dayjs.Dayjs };

type RoleSlot = { roleId: number | null; roleName: string };

function getShiftRange(instance: ShiftInstance): ShiftRange {
  const start = dayjs(`${instance.date} ${instance.timeStart}`, 'YYYY-MM-DD HH:mm');
  const end = instance.timeEnd
    ? dayjs(`${instance.date} ${instance.timeEnd}`, 'YYYY-MM-DD HH:mm')
    : start.add(DEFAULT_SHIFT_DURATION_HOURS, 'hour');
  return { start, end };
}

function availabilityAllowsShift(availability: Availability, range: ShiftRange, shiftTypeId: number): boolean {
  if (availability.day !== range.start.format('YYYY-MM-DD')) {
    return false;
  }
  if (availability.shiftTypeId && availability.shiftTypeId !== shiftTypeId) {
    return false;
  }
  if (availability.startTime) {
    const availabilityStart = dayjs(`${availability.day} ${availability.startTime}`, 'YYYY-MM-DD HH:mm');
    if (range.start.isBefore(availabilityStart)) {
      return false;
    }
  }
  if (availability.endTime) {
    const availabilityEnd = dayjs(`${availability.day} ${availability.endTime}`, 'YYYY-MM-DD HH:mm');
    if (range.end.isAfter(availabilityEnd)) {
      return false;
    }
  }
  return true;
}

function rangesOverlap(a: ShiftRange, b: ShiftRange): boolean {
  return a.start.isBefore(b.end) && b.start.isBefore(a.end);
}

function parseDateOnly(value: string | Date | null | undefined): dayjs.Dayjs | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const strictDate = dayjs(value, 'YYYY-MM-DD', true);
    if (strictDate.isValid()) {
      return strictDate.startOf('day');
    }
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed.startOf('day') : null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.startOf('day') : null;
}

function isShiftWithinVolunteerDateWindow(
  shiftDate: string,
  arrivalDate: string | Date | null | undefined,
  departureDate: string | Date | null | undefined,
): boolean {
  const shiftDay = parseDateOnly(shiftDate);
  if (!shiftDay) {
    return true;
  }
  const arrival = parseDateOnly(arrivalDate);
  if (arrival && shiftDay.isBefore(arrival, 'day')) {
    return false;
  }
  const departure = parseDateOnly(departureDate);
  if (departure && shiftDay.isAfter(departure, 'day')) {
    return false;
  }
  return true;
}

function getVolunteerDateWindowViolationMessage(
  shiftDate: string,
  arrivalDate: string | Date | null | undefined,
  departureDate: string | Date | null | undefined,
): string | null {
  const shiftDay = parseDateOnly(shiftDate);
  if (!shiftDay) {
    return null;
  }
  const arrival = parseDateOnly(arrivalDate);
  if (arrival && shiftDay.isBefore(arrival, 'day')) {
    return `Volunteer cannot be assigned before arrival date (${arrival.format('YYYY-MM-DD')}).`;
  }
  const departure = parseDateOnly(departureDate);
  if (departure && shiftDay.isAfter(departure, 'day')) {
    return `Volunteer cannot be assigned after departure date (${departure.format('YYYY-MM-DD')}).`;
  }
  return null;
}

const createRoleKey = (roleId: number | null, roleName: string) =>
  roleId != null ? `id:${roleId}` : `name:${roleName.trim().toLowerCase()}`;

const ROLE_PRIORITY: Record<string, number> = {
  manager: 0,
  leader: 1,
  guide: 2,
  'social media': 3,
};

const normalizeRoleName = (roleName: string | null | undefined): string => roleName?.trim().toLowerCase() ?? '';

const getRolePriority = (roleName: string, fallbackIndex: number): number => {
  const normalized = normalizeRoleName(roleName);
  return (ROLE_PRIORITY[normalized] ?? 10) + fallbackIndex / 1000;
};

function buildRoleSlots(instance: ShiftInstance): RoleSlot[] {
  const roleDefinitions = (instance.requiredRoles && instance.requiredRoles.length > 0
    ? instance.requiredRoles
    : instance.template?.defaultRoles) ?? [];

  if (roleDefinitions.length === 0) {
    const fallback = Math.max(1, instance.capacity ?? 1);
    return Array.from({ length: fallback }).map(() => ({ roleId: null, roleName: 'Staff' }));
  }

  const slots: RoleSlot[] = [];
  roleDefinitions.forEach((definition) => {
    const roleId = definition.shiftRoleId ?? null;
    const roleName = definition.role ?? 'Staff';
    const requiredCount = Math.max(1, definition.required ?? 1);
    for (let index = 0; index < requiredCount; index += 1) {
      slots.push({ roleId, roleName });
    }
  });
  return slots;
}

function computeRolesToFill(instance: ShiftInstance, volunteerSet: Set<number>): RoleSlot[] {
  const allSlots = buildRoleSlots(instance);
  if (allSlots.length === 0) {
    return [];
  }

  const nonVolunteerAssignments = new Map<string, number>();
  (instance.assignments ?? []).forEach((assignment) => {
    if (volunteerSet.has(assignment.userId)) {
      return;
    }
    const key = createRoleKey(assignment.shiftRoleId ?? null, assignment.roleInShift ?? 'Staff');
    const current = nonVolunteerAssignments.get(key) ?? 0;
    nonVolunteerAssignments.set(key, current + 1);
  });

  const consumed = new Map<string, number>();
  const rolesToFill: RoleSlot[] = [];

  allSlots.forEach((slot) => {
    const key = createRoleKey(slot.roleId, slot.roleName);
    const alreadyUsed = consumed.get(key) ?? 0;
    const coveredByNonVolunteers = nonVolunteerAssignments.get(key) ?? 0;
    if (alreadyUsed < coveredByNonVolunteers) {
      consumed.set(key, alreadyUsed + 1);
      return;
    }
    rolesToFill.push(slot);
  });

  const decorated = rolesToFill.map((slot, index) => ({ slot, index }));
  decorated.sort((a, b) => {
    const diff = getRolePriority(a.slot.roleName, a.index) - getRolePriority(b.slot.roleName, b.index);
    if (diff !== 0) {
      return diff;
    }
    return a.index - b.index;
  });
  return decorated.map((item) => item.slot);
}

const getRoleDefinitionsForInstance = (instance: ShiftInstance): ShiftTemplateRoleRequirement[] => {
  if (instance.requiredRoles && instance.requiredRoles.length > 0) {
    return instance.requiredRoles;
  }
  return instance.template?.defaultRoles ?? [];
};

const countAssignmentsForRole = (instance: ShiftInstance, role: ShiftTemplateRoleRequirement): number => {
  const roleLabel = (role.role ?? 'Staff').trim() || 'Staff';
  const targetKey = createRoleKey(role.shiftRoleId ?? null, roleLabel);
  const assignments = instance.assignments ?? [];
  return assignments.filter((assignment) => {
    const assignmentLabel = (assignment.roleInShift ?? '').trim();
    const assignmentKey = createRoleKey(assignment.shiftRoleId ?? null, assignmentLabel || 'Staff');
    return assignmentKey === targetKey;
  }).length;
};

async function validateVolunteerLimits(weekId: number, transaction?: Transaction): Promise<ScheduleViolation[]> {
  const counts = await getVolunteerAssignmentCounts(weekId, transaction);
  const profiles = await getStaffProfiles(Array.from(counts.keys()), transaction);
  const violations: ScheduleViolation[] = [];

  counts.forEach((summary, userId) => {
    const profile = profiles.get(userId);
    if (!profile || !profile.active || profile.staffType !== 'volunteer' || !profile.livesInAccom) {
      return;
    }
    const { uniqueDayCount, totalAssignments } = summary;
    if (totalAssignments < MIN_VOLUNTEER_WEEKLY_ASSIGNMENTS) {
      violations.push({
        code: 'volunteer-too-few',
        message: `Volunteer ${userId} has only ${totalAssignments} shift${totalAssignments === 1 ? '' : 's'} scheduled (minimum ${MIN_VOLUNTEER_WEEKLY_ASSIGNMENTS}).`,
        meta: { userId, totalAssignments, minRequired: MIN_VOLUNTEER_WEEKLY_ASSIGNMENTS },
        severity: 'warning',
      });
    }
    if (uniqueDayCount > 4) {
      violations.push({
        code: 'volunteer-too-many',
        message: `Volunteer ${userId} exceeds weekly day limit (scheduled on ${uniqueDayCount} days)`,
        meta: { userId, uniqueDayCount, totalAssignments },
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
        if (first.shiftInstanceId === second.shiftInstanceId) {
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
    let shouldSpawn = false;
    if (options.autoSpawn) {
      if (created) {
        shouldSpawn = true;
      } else {
        const existingInstances = await ShiftInstance.count({
          where: { scheduleWeekId: week.id },
          transaction,
        });
        shouldSpawn = existingInstances === 0;
      }
    }
    if (shouldSpawn) {
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

export async function generateShiftInstancesFromTemplates(options: {
  weekId: number;
  templateIds?: number[] | null;
  actorId?: number | null;
}): Promise<{ weekId: number; created: number; skipped: number; templateCount: number }> {
  const week = await ScheduleWeek.findByPk(options.weekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  assertWeekMutable(week);

  const transaction = await sequelize.transaction();
  try {
    const summary = await spawnInstancesFromTemplates(week, options.actorId ?? null, transaction, {
      templateIds: options.templateIds,
      logAction: 'schedule.week.spawn_instances',
    });
    await transaction.commit();
    return { weekId: week.id, ...summary };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function clearShiftInstances(options: {
  weekId: number;
  actorId?: number | null;
}): Promise<{ weekId: number; deletedInstances: number; deletedAssignments: number }> {
  const week = await ScheduleWeek.findByPk(options.weekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  assertWeekMutable(week);

  const transaction = await sequelize.transaction();
  try {
    const instances = await ShiftInstance.findAll({
      where: { scheduleWeekId: week.id },
      attributes: ['id'],
      transaction,
    });
    if (instances.length === 0) {
      await transaction.commit();
      return { weekId: week.id, deletedInstances: 0, deletedAssignments: 0 };
    }
    const instanceIds = instances.map((instance) => instance.id);
    const deletedAssignments = await ShiftAssignment.destroy({
      where: { shiftInstanceId: { [Op.in]: instanceIds } },
      transaction,
    });
    const deletedInstances = await ShiftInstance.destroy({
      where: { id: { [Op.in]: instanceIds } },
      transaction,
    });
    await transaction.commit();

    await logAudit({
      actorId: options.actorId ?? null,
      action: 'schedule.week.clear_instances',
      entity: 'schedule_week',
      entityId: String(week.id),
      meta: { deletedInstances, deletedAssignments },
    });

    return { weekId: week.id, deletedInstances, deletedAssignments };
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
  const headlessEnv = String(getConfigValue('PUPPETEER_HEADLESS') ?? '').toLowerCase();
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
        createdAt: dayjs().tz(resolveScheduleTimezone()).toDate(),
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

export async function reopenWeek(weekId: number, actorId: number | null): Promise<ScheduleWeekSummary> {
  const week = await ScheduleWeek.findByPk(weekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  if (week.state !== 'published') {
    throw new HttpError(400, 'Only published weeks can be reopened.');
  }

  await Export.destroy({ where: { scheduleWeekId: weekId } });

  week.state = 'collecting';
  await week.save();

  await logAudit({
    actorId,
    action: 'schedule.week.reopen',
    entity: 'schedule_week',
    entityId: String(week.id),
  });

  return getWeekSummary(weekId);
}

export async function listShiftTemplates(): Promise<ShiftTemplate[]> {
  return ShiftTemplate.findAll({
    order: [['name', 'ASC']],
  });
}

export async function listShiftTypes(): Promise<ShiftType[]> {
  return sequelize.transaction(async (transaction) => {
    const existing = await ShiftType.findAll({
      order: [['name', 'ASC']],
      transaction,
    });

    if (existing.length > 0) {
      const links = await ShiftTypeProduct.findAll({
        attributes: ['shiftTypeId', 'productId'],
        transaction,
      });
      const productIdsByShiftType = new Map<number, number[]>();
      links.forEach((link) => {
        const list = productIdsByShiftType.get(link.shiftTypeId) ?? [];
        list.push(link.productId);
        productIdsByShiftType.set(link.shiftTypeId, list);
      });

      return existing.map((record) => {
        const plain = record.get({ plain: true }) as ShiftType & { productIds?: number[] };
        plain.productIds = productIdsByShiftType.get(record.id) ?? [];
        return plain as ShiftType;
      });
    }

    await ShiftType.bulkCreate(DEFAULT_SHIFT_TYPES, {
      updateOnDuplicate: ['name', 'description'],
      transaction,
    });

    const created = await ShiftType.findAll({
      order: [['name', 'ASC']],
      transaction,
    });
    return created.map((record) => {
      const plain = record.get({ plain: true }) as ShiftType & { productIds?: number[] };
      plain.productIds = [];
      return plain as ShiftType;
    });
  });
}

export async function updateShiftTypeProducts(
  shiftTypeId: number,
  productIds: number[],
  actorId: number | null,
): Promise<{ shiftTypeId: number; productIds: number[] }> {
  const normalizedIds = Array.from(
    new Set(
      productIds
        .map((value) => Number(value))
        .filter((value): value is number => Number.isInteger(value) && value > 0),
    ),
  );

  return sequelize.transaction(async (transaction) => {
    const shiftType = await ShiftType.findByPk(shiftTypeId, { transaction });
    if (!shiftType) {
      throw new HttpError(404, 'Shift type not found');
    }

    if (normalizedIds.length > 0) {
      const count = await Product.count({ where: { id: { [Op.in]: normalizedIds } }, transaction });
      if (count !== normalizedIds.length) {
        throw new HttpError(400, 'One or more products do not exist');
      }
    }

    await ShiftTypeProduct.destroy({ where: { shiftTypeId }, transaction });

    if (normalizedIds.length > 0) {
      await ShiftTypeProduct.bulkCreate(
        normalizedIds.map((productId) => ({ shiftTypeId, productId })),
        { transaction },
      );
    }

    await logAudit({
      actorId,
      action: 'schedule.shift-type.products.update',
      entity: 'shift_type',
      entityId: String(shiftTypeId),
      meta: { productIds: normalizedIds },
    });

    return { shiftTypeId, productIds: normalizedIds };
  });
}

export async function listScheduledStaffForProduct(
  date: string,
  productId: number,
): Promise<{ userIds: number[]; managerIds: number[] }> {
  if (!date || !productId) {
    return { userIds: [], managerIds: [] };
  }

  const shiftTypeLinks = await ShiftTypeProduct.findAll({ where: { productId } });
  const shiftTypeIds = shiftTypeLinks.map((link) => link.shiftTypeId);
  if (shiftTypeIds.length === 0) {
    return { userIds: [], managerIds: [] };
  }

  const shiftRoles = await ShiftRole.findAll({
    where: {
      [Op.or]: [
        { slug: { [Op.in]: ['guide', 'manager'] } },
        { name: { [Op.in]: ['Guide', 'Manager'] } },
      ],
    },
  });
  const allowedRoleIds = new Set(shiftRoles.map((role) => role.id));
  const managerRoleIds = new Set(
    shiftRoles.filter((role) => role.slug === 'manager' || role.name === 'Manager').map((role) => role.id),
  );

  const instances = await ShiftInstance.findAll({
    where: { date, shiftTypeId: { [Op.in]: shiftTypeIds } },
    include: [{ model: ShiftAssignment, as: 'assignments' }],
  });

  const userIds = new Set<number>();
  const managerIds = new Set<number>();
  instances.forEach((instance) => {
    (instance.assignments ?? []).forEach((assignment) => {
      if (!assignment.userId) {
        return;
      }
      const roleId = assignment.shiftRoleId ?? null;
      if (roleId != null && allowedRoleIds.has(roleId)) {
        userIds.add(assignment.userId);
        if (managerRoleIds.has(roleId)) {
          managerIds.add(assignment.userId);
        }
        return;
      }
      const roleLabel = (assignment.roleInShift ?? '').trim().toLowerCase();
      if (roleLabel === 'manager') {
        userIds.add(assignment.userId);
        managerIds.add(assignment.userId);
        return;
      }
      if (roleLabel === 'guide') {
        userIds.add(assignment.userId);
      }
    });
  });

  return { userIds: Array.from(userIds.values()), managerIds: Array.from(managerIds.values()) };
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
    repeatOn?: number[] | null;
    managerCoversTeam?: boolean;
  },
  actorId: number | null,
): Promise<ShiftTemplate> {
  let normalizedRoles: ShiftTemplateRoleRequirement[] | null = null;
  if (payload.defaultRoles && payload.defaultRoles.length > 0) {
    const uniqueRoleIds = Array.from(
      new Set(
        payload.defaultRoles
          .map((role) => role.shiftRoleId)
          .filter((value): value is number => typeof value === 'number' && Number.isInteger(value)),
      ),
    );
    let rolesById = new Map<number, ShiftRole>();
    if (uniqueRoleIds.length > 0) {
      const roleRecords = await ShiftRole.findAll({ where: { id: uniqueRoleIds } });
      rolesById = new Map(roleRecords.map((record) => [record.id, record]));
    }
    normalizedRoles = payload.defaultRoles.map((role) => {
      const roleId = role.shiftRoleId ?? null;
      const reference = roleId != null ? rolesById.get(roleId) : null;
      return {
        shiftRoleId: roleId,
        role: reference?.name ?? role.role ?? 'Staff',
        required: role.required ?? null,
      };
    });
  }

  let cleanedRepeatOn: number[] | null = null;
  if (Array.isArray(payload.repeatOn)) {
    const uniqueDays = Array.from(
      new Set(
        payload.repeatOn
          .map((value) => Number(value))
          .filter((value): value is number => Number.isInteger(value) && value >= 1 && value <= 7),
      ),
    ).sort((a, b) => a - b);
    cleanedRepeatOn = uniqueDays.length > 0 ? uniqueDays : null;
  }

  const data: {
    shiftTypeId: number;
    name: string;
    defaultStartTime: string | null;
    defaultEndTime: string | null;
    defaultCapacity: number | null;
    requiresLeader: boolean;
    defaultRoles: ShiftTemplateRoleRequirement[] | null;
    defaultMeta: Record<string, unknown> | null;
    repeatOn?: number[] | null;
    managerCoversTeam: boolean;
  } = {
    shiftTypeId: payload.shiftTypeId,
    name: payload.name.trim(),
    defaultStartTime: payload.defaultStartTime ?? null,
    defaultEndTime: payload.defaultEndTime ?? null,
    defaultCapacity: payload.defaultCapacity ?? null,
    requiresLeader: payload.requiresLeader ?? false,
    defaultRoles: normalizedRoles ?? payload.defaultRoles ?? null,
    defaultMeta: payload.defaultMeta ?? null,
    managerCoversTeam: payload.managerCoversTeam ?? false,
  };
  if (payload.repeatOn !== undefined) {
    data.repeatOn = cleanedRepeatOn;
  }

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

  await sequelize.transaction(async (transaction) => {
    await ShiftAssignment.destroy({ where: { shiftInstanceId: instanceId }, transaction });
    await instance.destroy({ transaction });
  });
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
        include: [
          { model: User, as: 'assignee', include: [{ model: StaffProfile, as: 'staffProfile' }] },
          { model: ShiftRole, as: 'shiftRole' },
        ],
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
    const uniqueUserIds = Array.from(new Set(assignments.map((assignment) => assignment.userId))).filter((id) =>
      Number.isFinite(id),
    );
    const userRoleLinks = uniqueUserIds.length
      ? await UserShiftRole.findAll({
          where: { userId: uniqueUserIds },
          transaction,
        })
      : [];
    const userRoleIdsByUserId = new Map<number, Set<number>>();
    const referencedRoleIds = new Set<number>();
    userRoleLinks.forEach((link) => {
      const set = userRoleIdsByUserId.get(link.userId) ?? new Set<number>();
      if (link.shiftRoleId != null) {
        set.add(link.shiftRoleId);
        referencedRoleIds.add(link.shiftRoleId);
      }
      userRoleIdsByUserId.set(link.userId, set);
    });
    const usersById = new Map<number, User>();
    if (uniqueUserIds.length > 0) {
      const users = await User.findAll({
        where: { id: uniqueUserIds },
        attributes: ['id', 'status', 'arrivalDate', 'departureDate'],
        include: [
          {
            model: StaffProfile,
            as: 'staffProfile',
            attributes: ['active', 'staffType', 'livesInAccom'],
          },
        ],
        transaction,
      });
      users.forEach((user) => {
        usersById.set(user.id, user);
      });
    }
    const shiftRoleNameById = new Map<number, string>();
    if (referencedRoleIds.size > 0) {
      const roles = await ShiftRole.findAll({
        where: { id: Array.from(referencedRoleIds) },
        transaction,
      });
      roles.forEach((role) => shiftRoleNameById.set(role.id, role.name));
    }
    const pendingAssignmentsByInstance = new Map<number, ShiftAssignment[]>();

    for (const input of assignments) {
      const instance = await ShiftInstance.findByPk(input.shiftInstanceId, {
        include: [
          { model: ScheduleWeek, as: 'scheduleWeek' },
          { model: ShiftAssignment, as: 'assignments' },
          { model: ShiftTemplate, as: 'template' },
        ],
        transaction,
      });
      if (!instance || !instance.scheduleWeek) {
        throw new HttpError(404, 'Shift instance not found');
      }
      assertWeekMutable(instance.scheduleWeek);
      const persistedAssignments = instance.assignments ?? [];
      const pendingAssignments = pendingAssignmentsByInstance.get(instance.id) ?? [];
      instance.assignments = persistedAssignments.concat(pendingAssignments);

      const existingAssignments = await ShiftAssignment.findAll({
        where: {
          shiftInstanceId: input.shiftInstanceId,
          userId: input.userId,
        },
        transaction,
      });

      const duplicateAssignment = existingAssignments.some((assignment) => {
        if (assignment.shiftRoleId != null && input.shiftRoleId != null) {
          return assignment.shiftRoleId === input.shiftRoleId;
        }
        if (assignment.shiftRoleId == null && input.shiftRoleId == null) {
          const existingRole = (assignment.roleInShift ?? '').trim().toLowerCase();
          const requestedRole = (input.roleInShift ?? '').trim().toLowerCase();
          return existingRole.length > 0 && existingRole === requestedRole;
        }
        return false;
      });

      if (duplicateAssignment) {
        throw new HttpError(400, 'User already assigned to this shift with that role.');
      }

      const userRecord = usersById.get(input.userId);
      if (!userRecord || !userRecord.status) {
        throw new HttpError(400, 'Only active users can be assigned to shifts.');
      }
      const profile = (userRecord as User & { staffProfile?: StaffProfile | null }).staffProfile;
      if (!profile || !profile.active) {
        throw new HttpError(400, 'Only users with an active staff profile can be assigned.');
      }
      const userRoleIds = userRoleIdsByUserId.get(input.userId);
      if (!userRoleIds || userRoleIds.size === 0) {
        throw new HttpError(400, 'User must have at least one shift role before being assigned.');
      }
      if (profile.staffType === 'volunteer') {
        const dateWindowError = getVolunteerDateWindowViolationMessage(
          instance.date,
          userRecord.arrivalDate,
          userRecord.departureDate,
        );
        if (dateWindowError) {
          throw new HttpError(400, dateWindowError);
        }
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

      if (profile && profile.active && profile.staffType === 'volunteer' && profile.livesInAccom) {
        const uniqueDates = new Set<string>();
        weekAssignments.forEach((assignment) => {
          const date = assignment.shiftInstance?.date;
          if (date) {
            uniqueDates.add(date);
          }
        });
        const currentDate = instance.date;
        const totalUniqueDays = uniqueDates.has(currentDate) ? uniqueDates.size : uniqueDates.size + 1;
        if (totalUniqueDays > 4) {
          throw new HttpError(400, 'Volunteer living in accommodation cannot exceed 4 working days per week.');
        }
      }

      weekAssignments.forEach((assignment) => {
        if (assignment.shiftInstanceId === instance.id) {
          return;
        }

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
      const fallbackAvailable = Boolean(profile?.active && profile?.livesInAccom);
      if (!availability && !fallbackAvailable && (!input.overrideReason || input.overrideReason.trim().length === 0)) {
        throw new HttpError(400, 'Assignment outside availability. Provide override reason.');
      }

      const roleDefinitions = getRoleDefinitionsForInstance(instance);
      if (roleDefinitions.length > 0) {
        const matchingDefinition = roleDefinitions.find((definition) => matchesRoleDefinition(definition, input));
        if (!matchingDefinition) {
          throw new HttpError(400, 'Shift does not accept the specified role.');
        }
        if (!doesUserHaveRoleForDefinition(input.userId, matchingDefinition, userRoleIdsByUserId, shiftRoleNameById)) {
          throw new HttpError(400, 'User does not have the required shift role for this assignment.');
        }
        const requiredSlots = Math.max(1, matchingDefinition.required ?? 1);
        const filledSlots = countAssignmentsForRole(instance, matchingDefinition);
        if (filledSlots >= requiredSlots) {
          throw new HttpError(400, 'All slots for this role are already filled.');
        }
      }

      const assignment = await ShiftAssignment.create(
        {
          shiftInstanceId: input.shiftInstanceId,
          userId: input.userId,
          roleInShift: input.roleInShift,
          shiftRoleId: input.shiftRoleId ?? null,
        },
        { transaction },
      );
      created.push(assignment);
      const buffered = pendingAssignmentsByInstance.get(instance.id) ?? [];
      buffered.push(assignment);
      pendingAssignmentsByInstance.set(instance.id, buffered);
      if (instance.assignments) {
        instance.assignments.push(assignment);
      } else {
        instance.assignments = [assignment];
      }

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

type VolunteerAssignmentSummary = {
  userId: number;
  fullName: string | null;
  assigned: number;
};

type AutoAssignSummary = {
  created: number;
  removed: number;
  volunteerCount: number;
  unfilled: Array<{ shiftInstanceId: number; role: string; date: string; timeStart: string }>;
  volunteerAssignments: VolunteerAssignmentSummary[];
};

export async function autoAssignWeek(weekId: number, actorId: number | null): Promise<AutoAssignSummary> {
  const week = await ScheduleWeek.findByPk(weekId);
  if (!week) {
    throw new HttpError(404, 'Schedule week not found');
  }
  assertWeekMutable(week);

  return sequelize.transaction(async (transaction) => {
    const volunteerProfiles = await StaffProfile.findAll({
      where: {
        staffType: { [Op.in]: ['volunteer', 'long_term'] },
        livesInAccom: true,
        active: true,
      },
      include: [{
        model: User,
        as: 'user',
        required: true,
        where: { status: true },
        attributes: ['id', 'firstName', 'lastName', 'arrivalDate', 'departureDate'],
      }],
      transaction,
    });

    if (volunteerProfiles.length === 0) {
      return {
        created: 0,
        removed: 0,
        volunteerCount: 0,
        unfilled: [],
        volunteerAssignments: [],
      };
    }

    const volunteerIds = volunteerProfiles.map((profile) => profile.userId);
    const volunteerRoleAssignments = volunteerIds.length
      ? await UserShiftRole.findAll({
          where: { userId: volunteerIds },
          transaction,
        })
      : [];
    const volunteerRoleMap = new Map<number, Set<number>>();
    volunteerRoleAssignments.forEach((assignment) => {
      const set = volunteerRoleMap.get(assignment.userId) ?? new Set<number>();
      set.add(assignment.shiftRoleId);
      volunteerRoleMap.set(assignment.userId, set);
    });
    const eligibleVolunteerIds = volunteerIds.filter((volunteerId) => {
      const roleSet = volunteerRoleMap.get(volunteerId);
      return Boolean(roleSet && roleSet.size > 0);
    });
    const volunteerSet = new Set(eligibleVolunteerIds);
    const volunteerProfileByUserId = new Map<number, StaffProfile>();
    volunteerProfiles.forEach((profile) => {
      if (volunteerSet.has(profile.userId)) {
        volunteerProfileByUserId.set(profile.userId, profile);
      }
    });
    const eligibleVolunteerProfiles = volunteerProfiles.filter((profile) => volunteerSet.has(profile.userId));

    const availabilities = await Availability.findAll({
      where: {
        scheduleWeekId: weekId,
        userId: { [Op.in]: eligibleVolunteerIds },
        status: 'available',
      },
      transaction,
    });

    const availabilityByUser = new Map<number, Availability[]>();
    availabilities.forEach((availability) => {
      const existing = availabilityByUser.get(availability.userId) ?? [];
      existing.push(availability);
      availabilityByUser.set(availability.userId, existing);
    });

    const shiftInstances = await ShiftInstance.findAll({
      where: { scheduleWeekId: weekId },
      include: [
        { model: ShiftAssignment, as: 'assignments' },
        { model: ShiftTemplate, as: 'template' },
      ],
      order: [
        ['date', 'ASC'],
        ['timeStart', 'ASC'],
      ],
      transaction,
    });

    if (shiftInstances.length === 0) {
      const volunteerAssignments = eligibleVolunteerProfiles.map((profile) => {
        const user = profile.user as User | undefined;
        const fullName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null : null;
        return { userId: profile.userId, fullName, assigned: 0 };
      });
      return {
        created: 0,
        removed: 0,
        volunteerCount: eligibleVolunteerProfiles.length,
        unfilled: [],
        volunteerAssignments,
      };
    }

    const shiftInstanceIds = shiftInstances.map((instance) => instance.id);
    const removed = await ShiftAssignment.destroy({
      where: {
        shiftInstanceId: shiftInstanceIds,
        userId: { [Op.in]: volunteerIds },
      },
      transaction,
    });

    const assignmentCounts = new Map<number, number>();
    const assignmentSlotsByVolunteer = new Map<number, ShiftRange[]>();
    eligibleVolunteerIds.forEach((volunteerId) => {
      assignmentCounts.set(volunteerId, 0);
      assignmentSlotsByVolunteer.set(volunteerId, []);
    });

    const plannedAssignments: Array<{ shiftInstanceId: number; userId: number; roleInShift: string; shiftRoleId: number | null }> = [];
    const unfilledSlots: Array<{ shiftInstanceId: number; role: string; date: string; timeStart: string; shiftRoleId: number | null }> = [];

    for (const instance of shiftInstances) {
      const rawSlots = computeRolesToFill(instance, volunteerSet);
      if (rawSlots.length === 0) {
        continue;
      }
      const slots: Array<RoleSlot | null> = rawSlots.map((slot) => ({ ...slot }));
      const managerCoversTeam = Boolean(instance.template?.managerCoversTeam);

      const range = getShiftRange(instance);

      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const slot = slots[slotIndex];
        if (!slot) {
          continue;
        }
        const slotRoleId = slot.roleId;
        const roleName = slot.roleName;
        const roleKey = normalizeRoleName(roleName);
        const sortedVolunteers = [...eligibleVolunteerIds].sort((a, b) => {
          const aCount = assignmentCounts.get(a) ?? 0;
          const bCount = assignmentCounts.get(b) ?? 0;
          if (aCount !== bCount) {
            return aCount - bCount;
          }
          return a - b;
        });

        let assigned = false;

        for (const volunteerId of sortedVolunteers) {
          if (!volunteerSet.has(volunteerId)) {
            continue;
          }
          const profile = volunteerProfileByUserId.get(volunteerId);
          const volunteerUser = profile?.user as User | undefined;
          if (
            profile?.staffType === 'volunteer' &&
            !isShiftWithinVolunteerDateWindow(instance.date, volunteerUser?.arrivalDate, volunteerUser?.departureDate)
          ) {
            continue;
          }

          if (slotRoleId != null) {
            const allowedRoles = volunteerRoleMap.get(volunteerId);
            if (!allowedRoles || !allowedRoles.has(slotRoleId)) {
              continue;
            }
          }

          const currentCount = assignmentCounts.get(volunteerId) ?? 0;
          if (currentCount >= MAX_VOLUNTEER_WEEKLY_ASSIGNMENTS) {
            continue;
          }

          const volunteerSlots = assignmentSlotsByVolunteer.get(volunteerId) ?? [];
          if (volunteerSlots.some((slot) => rangesOverlap(slot, range))) {
            continue;
          }

          const availabilityEntries = availabilityByUser.get(volunteerId) ?? [];
          const availabilityMatches =
            availabilityEntries.length === 0 ||
            availabilityEntries.some((entry) => availabilityAllowsShift(entry, range, instance.shiftTypeId));

          if (!availabilityMatches) {
            continue;
          }

          plannedAssignments.push({
            shiftInstanceId: instance.id,
            userId: volunteerId,
            roleInShift: roleName,
            shiftRoleId: slotRoleId,
          });
          assignmentCounts.set(volunteerId, currentCount + 1);
          volunteerSlots.push(range);
          assignmentSlotsByVolunteer.set(volunteerId, volunteerSlots);
          assigned = true;

          if (managerCoversTeam && roleKey === 'manager') {
            const coverageTargets: Array<{ key: string; label: string }> = [
              { key: 'leader', label: 'Leader' },
              { key: 'guide', label: 'Guide' },
            ];
            coverageTargets.forEach((target) => {
              const targetIndex = slots.findIndex(
                (candidate, candidateIndex) =>
                  candidateIndex > slotIndex &&
                  candidate &&
                  normalizeRoleName(candidate.roleName) === target.key,
              );
              if (targetIndex !== -1) {
                const coveredSlot = slots[targetIndex];
                if (coveredSlot) {
                  plannedAssignments.push({
                    shiftInstanceId: instance.id,
                    userId: volunteerId,
                    roleInShift: coveredSlot.roleName || target.label,
                    shiftRoleId: coveredSlot.roleId,
                  });
                }
                slots[targetIndex] = null;
              }
            });
          }
          break;
        }

        if (!assigned) {
          unfilledSlots.push({
            shiftInstanceId: instance.id,
            role: roleName,
            date: instance.date,
            timeStart: instance.timeStart,
            shiftRoleId: slotRoleId,
          });
        }
      }
    }

    let created = 0;
    for (const assignment of plannedAssignments) {
      await ShiftAssignment.create(
        {
          shiftInstanceId: assignment.shiftInstanceId,
          userId: assignment.userId,
          roleInShift: assignment.roleInShift,
          shiftRoleId: assignment.shiftRoleId,
        },
        { transaction },
      );
      created += 1;
    }

    const volunteerAssignments = eligibleVolunteerProfiles.map((profile) => {
      const user = profile.user as User | undefined;
      const fullName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || null : null;
      return {
        userId: profile.userId,
        fullName,
        assigned: assignmentCounts.get(profile.userId) ?? 0,
      };
    });

    await logAudit({
      actorId,
      action: 'schedule.week.auto-assign',
      entity: 'schedule_week',
      entityId: String(week.id),
      meta: {
        weekId,
        created,
        removed,
        unfilled: unfilledSlots.length,
      },
    });

    return {
      created,
      removed,
      volunteerCount: eligibleVolunteerProfiles.length,
      unfilled: unfilledSlots,
      volunteerAssignments,
    };
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

export async function getAvailabilityForWeek(scheduleWeekId: number): Promise<Availability[]> {
  return Availability.findAll({
    where: { scheduleWeekId },
    order: [
      ['userId', 'ASC'],
      ['day', 'ASC'],
      ['startTime', 'ASC'],
    ],
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

export async function cancelSwapRequest(swapId: number, actorId: number): Promise<SwapRequest> {
  const swap = await SwapRequest.findByPk(swapId);
  if (!swap) {
    throw new HttpError(404, 'Swap request not found');
  }
  if (!['pending_partner', 'pending_manager'].includes(swap.status)) {
    throw new HttpError(400, 'Only pending swap requests can be canceled');
  }
  if (swap.requesterId !== actorId && swap.partnerId !== actorId) {
    throw new HttpError(403, 'You may only cancel swap requests you are part of');
  }

  swap.status = 'canceled';
  swap.decisionReason = 'Canceled by participant';
  await swap.save();

  await logAudit({
    actorId,
    action: 'schedule.swap.cancel',
    entity: 'swap_request',
    entityId: String(swap.id),
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
      {
        model: ShiftAssignment,
        as: 'fromAssignment',
        include: [
          { model: ShiftInstance, as: 'shiftInstance', include: [{ model: ShiftType, as: 'shiftType' }] },
          { model: User, as: 'assignee', include: [{ model: StaffProfile, as: 'staffProfile' }] },
        ],
      },
      {
        model: ShiftAssignment,
        as: 'toAssignment',
        include: [
          { model: ShiftInstance, as: 'shiftInstance', include: [{ model: ShiftType, as: 'shiftType' }] },
          { model: User, as: 'assignee', include: [{ model: StaffProfile, as: 'staffProfile' }] },
        ],
      },
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
      {
        model: ShiftAssignment,
        as: 'fromAssignment',
        include: [
          { model: ShiftInstance, as: 'shiftInstance' },
          { model: User, as: 'assignee', include: [{ model: StaffProfile, as: 'staffProfile' }] },
        ],
      },
      {
        model: ShiftAssignment,
        as: 'toAssignment',
        include: [
          { model: ShiftInstance, as: 'shiftInstance' },
          { model: User, as: 'assignee', include: [{ model: StaffProfile, as: 'staffProfile' }] },
        ],
      },
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
  const deadline = getWeekStart(week.year, week.isoWeek)
    .weekday(resolveLockDay())
    .hour(resolveLockHour())
    .format('dddd HH:mm');

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
