import { Op, type Transaction, type WhereOptions } from 'sequelize';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import sequelize from '../config/database.js';
import AuditLog from '../models/AuditLog.js';
import ShiftRole from '../models/ShiftRole.js';
import StaffProfile, { type StaffType } from '../models/StaffProfile.js';
import StaffProfileTypePeriod from '../models/StaffProfileTypePeriod.js';
import User from '../models/User.js';
import UserShiftRole from '../models/UserShiftRole.js';
import UserShiftRoleMembershipPeriod from '../models/UserShiftRoleMembershipPeriod.js';
import UserType from '../models/UserType.js';
import UserTypeMembershipPeriod from '../models/UserTypeMembershipPeriod.js';

dayjs.extend(utc);
dayjs.extend(timezone);

export const STAFF_ELIGIBILITY_TIMEZONE = 'Europe/Warsaw';
const STAFF_TYPE_VALUES = new Set<StaffType>([
  'volunteer',
  'long_term',
  'assistant_manager',
  'manager',
  'guide',
]);

type HistoryMetadata = Record<string, unknown>;

type HistoryMutationBase = {
  userId: number;
  effectiveDate?: string | null;
  actorId?: number | null;
  reason?: string | null;
  metadata?: HistoryMetadata | null;
  source?: string | null;
  transaction?: Transaction;
};

export type ApplyUserTypeChangeParams = HistoryMutationBase & {
  userTypeId: number;
};

export type ApplyUserShiftRolesChangeParams = HistoryMutationBase & {
  shiftRoleIds: number[];
};

export type ApplyStaffProfileTypeChangeParams = HistoryMutationBase & {
  staffType: StaffType;
};

export type CloseStaffProfileTypeHistoryResult = {
  changed: boolean;
  effectiveDate: string;
  previous: StaffType | null;
  next: null;
  periodId: number | null;
  periodAction: 'closed' | 'none';
};

export type ScalarHistoryChangeResult<T> = {
  changed: boolean;
  effectiveDate: string;
  previous: T | null;
  next: T | null;
  applied: T;
  periodId: number | null;
};

export type ShiftRoleHistoryChangeResult = {
  changed: boolean;
  effectiveDate: string;
  previous: number[];
  next: number[];
  applied: number[];
};

export class StaffEligibilityHistoryError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'StaffEligibilityHistoryError';
    this.status = status;
    this.code = code;
  }
}

const normalizePositiveInteger = (value: unknown, field: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_ID', `${field} must be a positive integer.`);
  }
  return parsed;
};

const normalizeOptionalActorId = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }
  return normalizePositiveInteger(value, 'actorId');
};

const parseIsoDate = (value: string): { year: number; month: number; day: number } | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

export const currentStaffEligibilityDate = (now: Date = new Date()): string =>
  dayjs(now).tz(STAFF_ELIGIBILITY_TIMEZONE).format('YYYY-MM-DD');

export const normalizeStaffEligibilityEffectiveDate = (
  value?: string | null,
  now: Date = new Date(),
): string => {
  const today = currentStaffEligibilityDate(now);
  const candidate = typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : today;
  if (!parseIsoDate(candidate)) {
    throw new StaffEligibilityHistoryError(
      400,
      'INVALID_EFFECTIVE_DATE',
      'effectiveDate must be a valid date in YYYY-MM-DD format.',
    );
  }
  if (candidate > today) {
    throw new StaffEligibilityHistoryError(
      400,
      'FUTURE_EFFECTIVE_DATE_UNSUPPORTED',
      'Future-dated staff eligibility changes are not supported yet.',
    );
  }
  return candidate;
};

const normalizeQueryDate = (value: string, field: string): string => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!parseIsoDate(candidate)) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_DATE', `${field} must use YYYY-MM-DD format.`);
  }
  return candidate;
};

const previousDate = (value: string): string => dayjs(`${value}T12:00:00Z`).subtract(1, 'day').format('YYYY-MM-DD');

export const staffEligibilityPeriodContainsDate = (
  period: Pick<UserTypeMembershipPeriod, 'effectiveStart' | 'effectiveEnd'>,
  date: string,
): boolean => period.effectiveStart <= date && (!period.effectiveEnd || period.effectiveEnd >= date);

export const staffEligibilityPeriodOverlapsRange = (
  period: Pick<UserTypeMembershipPeriod, 'effectiveStart' | 'effectiveEnd'>,
  startDate: string,
  endDate: string,
): boolean => period.effectiveStart <= endDate && (!period.effectiveEnd || period.effectiveEnd >= startDate);

const buildDateWhere = (date: string): WhereOptions => ({
  effectiveStart: { [Op.lte]: date },
  [Op.or]: [
    { effectiveEnd: null },
    { effectiveEnd: { [Op.gte]: date } },
  ],
});

const buildRangeWhere = (startDate: string, endDate: string): WhereOptions => ({
  effectiveStart: { [Op.lte]: endDate },
  [Op.or]: [
    { effectiveEnd: null },
    { effectiveEnd: { [Op.gte]: startDate } },
  ],
});

const normalizeReason = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 4000) : null;
};

const normalizeSource = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'application';
  }
  return value.trim().slice(0, 64);
};

const normalizeMetadata = (value: unknown): HistoryMetadata => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as HistoryMetadata) }
    : {}
);

const normalizeRoleIds = (values: unknown): number[] => {
  if (!Array.isArray(values)) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_SHIFT_ROLES', 'shiftRoleIds must be an array.');
  }
  return Array.from(new Set(values.map((value) => normalizePositiveInteger(value, 'shiftRoleId'))))
    .sort((left, right) => left - right);
};

const withTransaction = async <T>(
  transaction: Transaction | undefined,
  work: (activeTransaction: Transaction) => Promise<T>,
): Promise<T> => transaction ? work(transaction) : sequelize.transaction(work);

const recordHistoryAudit = async (params: {
  actorId: number | null;
  action: string;
  userId: number;
  effectiveDate: string;
  reason: string | null;
  source: string;
  previous: unknown;
  next: unknown;
  applied: unknown;
  metadata: HistoryMetadata;
  transaction: Transaction;
}): Promise<void> => {
  await AuditLog.create({
    actorId: params.actorId,
    action: params.action,
    entity: 'user',
    entityId: String(params.userId),
    metaJson: {
      historyVersion: 1,
      effectiveDate: params.effectiveDate,
      reason: params.reason,
      source: params.source,
      previous: params.previous,
      next: params.next,
      applied: params.applied,
      metadata: params.metadata,
    },
  }, { transaction: params.transaction });
};

const assertNoRecordedChangeAfter = <T extends { effectiveStart: string }>(
  periods: T[],
  effectiveDate: string,
): void => {
  if (periods.some((period) => period.effectiveStart > effectiveDate)) {
    throw new StaffEligibilityHistoryError(
      409,
      'HISTORICAL_CHANGE_CONFLICT',
      'The effective date predates a recorded eligibility change. Use an explicit history reconciliation instead of overwriting later history.',
    );
  }
};

export async function getUserTypeAtDate(params: {
  userId: number;
  date: string;
  transaction?: Transaction;
}): Promise<UserTypeMembershipPeriod | null> {
  const userId = normalizePositiveInteger(params.userId, 'userId');
  const date = normalizeQueryDate(params.date, 'date');
  return UserTypeMembershipPeriod.findOne({
    where: { userId, ...buildDateWhere(date) },
    order: [['effectiveStart', 'DESC'], ['id', 'DESC']],
    transaction: params.transaction,
  });
}

export async function getUserTypePeriodsForRange(params: {
  userIds: number[];
  startDate: string;
  endDate: string;
  transaction?: Transaction;
}): Promise<UserTypeMembershipPeriod[]> {
  const userIds = Array.from(new Set(params.userIds.map((id) => normalizePositiveInteger(id, 'userId'))));
  const startDate = normalizeQueryDate(params.startDate, 'startDate');
  const endDate = normalizeQueryDate(params.endDate, 'endDate');
  if (endDate < startDate) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_RANGE', 'endDate cannot be before startDate.');
  }
  if (userIds.length === 0) {
    return [];
  }
  return UserTypeMembershipPeriod.findAll({
    where: { userId: { [Op.in]: userIds }, ...buildRangeWhere(startDate, endDate) },
    order: [['userId', 'ASC'], ['effectiveStart', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
  });
}

export async function getUserTypeMembersForRange(params: {
  userTypeId: number;
  startDate: string;
  endDate: string;
  transaction?: Transaction;
}): Promise<UserTypeMembershipPeriod[]> {
  const userTypeId = normalizePositiveInteger(params.userTypeId, 'userTypeId');
  const startDate = normalizeQueryDate(params.startDate, 'startDate');
  const endDate = normalizeQueryDate(params.endDate, 'endDate');
  if (endDate < startDate) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_RANGE', 'endDate cannot be before startDate.');
  }
  return UserTypeMembershipPeriod.findAll({
    where: { userTypeId, ...buildRangeWhere(startDate, endDate) },
    order: [['userId', 'ASC'], ['effectiveStart', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
  });
}

export async function getUserShiftRolesAtDate(params: {
  userId: number;
  date: string;
  transaction?: Transaction;
}): Promise<UserShiftRoleMembershipPeriod[]> {
  const userId = normalizePositiveInteger(params.userId, 'userId');
  const date = normalizeQueryDate(params.date, 'date');
  return UserShiftRoleMembershipPeriod.findAll({
    where: { userId, ...buildDateWhere(date) },
    order: [['shiftRoleId', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
  });
}

export async function getUserShiftRolePeriodsForRange(params: {
  userIds: number[];
  startDate: string;
  endDate: string;
  transaction?: Transaction;
}): Promise<UserShiftRoleMembershipPeriod[]> {
  const userIds = Array.from(new Set(params.userIds.map((id) => normalizePositiveInteger(id, 'userId'))));
  const startDate = normalizeQueryDate(params.startDate, 'startDate');
  const endDate = normalizeQueryDate(params.endDate, 'endDate');
  if (endDate < startDate) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_RANGE', 'endDate cannot be before startDate.');
  }
  if (userIds.length === 0) {
    return [];
  }
  return UserShiftRoleMembershipPeriod.findAll({
    where: { userId: { [Op.in]: userIds }, ...buildRangeWhere(startDate, endDate) },
    order: [['userId', 'ASC'], ['shiftRoleId', 'ASC'], ['effectiveStart', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
  });
}

export async function getShiftRoleMembersForRange(params: {
  shiftRoleId: number;
  startDate: string;
  endDate: string;
  transaction?: Transaction;
}): Promise<UserShiftRoleMembershipPeriod[]> {
  const shiftRoleId = normalizePositiveInteger(params.shiftRoleId, 'shiftRoleId');
  const startDate = normalizeQueryDate(params.startDate, 'startDate');
  const endDate = normalizeQueryDate(params.endDate, 'endDate');
  if (endDate < startDate) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_RANGE', 'endDate cannot be before startDate.');
  }
  return UserShiftRoleMembershipPeriod.findAll({
    where: { shiftRoleId, ...buildRangeWhere(startDate, endDate) },
    order: [['userId', 'ASC'], ['effectiveStart', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
  });
}

export async function getStaffProfileTypeAtDate(params: {
  userId: number;
  date: string;
  transaction?: Transaction;
}): Promise<StaffProfileTypePeriod | null> {
  const userId = normalizePositiveInteger(params.userId, 'userId');
  const date = normalizeQueryDate(params.date, 'date');
  return StaffProfileTypePeriod.findOne({
    where: { userId, ...buildDateWhere(date) },
    order: [['effectiveStart', 'DESC'], ['id', 'DESC']],
    transaction: params.transaction,
  });
}

export async function getStaffProfileTypePeriodsForRange(params: {
  userIds: number[];
  startDate: string;
  endDate: string;
  transaction?: Transaction;
}): Promise<StaffProfileTypePeriod[]> {
  const userIds = Array.from(new Set(params.userIds.map((id) => normalizePositiveInteger(id, 'userId'))));
  const startDate = normalizeQueryDate(params.startDate, 'startDate');
  const endDate = normalizeQueryDate(params.endDate, 'endDate');
  if (endDate < startDate) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_RANGE', 'endDate cannot be before startDate.');
  }
  if (userIds.length === 0) {
    return [];
  }
  return StaffProfileTypePeriod.findAll({
    where: { userId: { [Op.in]: userIds }, ...buildRangeWhere(startDate, endDate) },
    order: [['userId', 'ASC'], ['effectiveStart', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
  });
}

export async function getStaffTypeMembersForRange(params: {
  staffType: StaffType;
  startDate: string;
  endDate: string;
  transaction?: Transaction;
}): Promise<StaffProfileTypePeriod[]> {
  if (!STAFF_TYPE_VALUES.has(params.staffType)) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_STAFF_TYPE', 'staffType is invalid.');
  }
  const startDate = normalizeQueryDate(params.startDate, 'startDate');
  const endDate = normalizeQueryDate(params.endDate, 'endDate');
  if (endDate < startDate) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_RANGE', 'endDate cannot be before startDate.');
  }
  return StaffProfileTypePeriod.findAll({
    where: { staffType: params.staffType, ...buildRangeWhere(startDate, endDate) },
    order: [['userId', 'ASC'], ['effectiveStart', 'ASC'], ['id', 'ASC']],
    transaction: params.transaction,
  });
}

export async function applyUserTypeChange(
  params: ApplyUserTypeChangeParams,
): Promise<ScalarHistoryChangeResult<number>> {
  const userId = normalizePositiveInteger(params.userId, 'userId');
  const userTypeId = normalizePositiveInteger(params.userTypeId, 'userTypeId');
  const effectiveDate = normalizeStaffEligibilityEffectiveDate(params.effectiveDate);
  const actorId = normalizeOptionalActorId(params.actorId);
  const reason = normalizeReason(params.reason);
  const source = normalizeSource(params.source);
  const metadata = normalizeMetadata(params.metadata);

  return withTransaction(params.transaction, async (transaction) => {
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user) {
      throw new StaffEligibilityHistoryError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const userType = await UserType.findByPk(userTypeId, { transaction });
    if (!userType) {
      throw new StaffEligibilityHistoryError(400, 'USER_TYPE_NOT_FOUND', 'User type not found.');
    }

    const periods = await UserTypeMembershipPeriod.findAll({
      where: { userId },
      order: [['effectiveStart', 'ASC'], ['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertNoRecordedChangeAfter(periods, effectiveDate);
    const containing = periods.find((period) => staffEligibilityPeriodContainsDate(period, effectiveDate)) ?? null;
    const previousProjection = user.userTypeId ?? null;
    let periodId: number | null = containing?.id ?? null;
    let historyChanged = false;

    if (containing?.userTypeId !== userTypeId) {
      historyChanged = true;
      if (containing && containing.effectiveStart === effectiveDate) {
        await containing.update({
          userTypeId,
          createdBy: actorId,
          changeReason: reason,
          source,
          metadata: { ...containing.metadata, ...metadata, replacedValue: containing.userTypeId },
        }, { transaction });
        periodId = containing.id;
      } else {
        const inheritedEnd = containing?.effectiveEnd ?? null;
        if (containing) {
          await containing.update({
            effectiveEnd: previousDate(effectiveDate),
            endedBy: actorId,
            changeReason: reason ?? containing.changeReason,
          }, { transaction });
        }
        const nextPeriod = periods.find((period) => period.effectiveStart > effectiveDate) ?? null;
        const created = await UserTypeMembershipPeriod.create({
          userId,
          userTypeId,
          effectiveStart: effectiveDate,
          effectiveEnd: inheritedEnd ?? (nextPeriod ? previousDate(nextPeriod.effectiveStart) : null),
          createdBy: actorId,
          endedBy: null,
          changeReason: reason,
          source,
          metadata,
        }, { transaction });
        periodId = created.id;
      }
    }

    const today = currentStaffEligibilityDate();
    const activeToday = await UserTypeMembershipPeriod.findOne({
      where: { userId, ...buildDateWhere(today) },
      order: [['effectiveStart', 'DESC'], ['id', 'DESC']],
      transaction,
    });
    const nextProjection = activeToday?.userTypeId ?? userTypeId;
    const projectionChanged = previousProjection !== nextProjection;
    if (projectionChanged) {
      await user.update({ userTypeId: nextProjection, updatedBy: actorId }, { transaction });
    }

    const changed = historyChanged || projectionChanged;
    if (changed) {
      await recordHistoryAudit({
        actorId,
        action: 'staff_eligibility.user_type_changed',
        userId,
        effectiveDate,
        reason,
        source,
        previous: previousProjection,
        next: nextProjection,
        applied: userTypeId,
        metadata,
        transaction,
      });
    }

    return {
      changed,
      effectiveDate,
      previous: previousProjection,
      next: nextProjection,
      applied: userTypeId,
      periodId,
    };
  });
}

export async function applyUserShiftRolesChange(
  params: ApplyUserShiftRolesChangeParams,
): Promise<ShiftRoleHistoryChangeResult> {
  const userId = normalizePositiveInteger(params.userId, 'userId');
  const desiredRoleIds = normalizeRoleIds(params.shiftRoleIds);
  const effectiveDate = normalizeStaffEligibilityEffectiveDate(params.effectiveDate);
  const actorId = normalizeOptionalActorId(params.actorId);
  const reason = normalizeReason(params.reason);
  const source = normalizeSource(params.source);
  const metadata = normalizeMetadata(params.metadata);

  return withTransaction(params.transaction, async (transaction) => {
    const user = await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!user) {
      throw new StaffEligibilityHistoryError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    if (desiredRoleIds.length > 0) {
      const roleCount = await ShiftRole.count({
        where: { id: { [Op.in]: desiredRoleIds } },
        transaction,
      });
      if (roleCount !== desiredRoleIds.length) {
        throw new StaffEligibilityHistoryError(400, 'SHIFT_ROLE_NOT_FOUND', 'One or more shift roles do not exist.');
      }
    }

    const periods = await UserShiftRoleMembershipPeriod.findAll({
      where: { userId },
      order: [['shiftRoleId', 'ASC'], ['effectiveStart', 'ASC'], ['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertNoRecordedChangeAfter(periods, effectiveDate);
    const previousAtEffectiveDate = periods
      .filter((period) => staffEligibilityPeriodContainsDate(period, effectiveDate))
      .map((period) => period.shiftRoleId)
      .sort((left, right) => left - right);
    const previousSet = new Set(previousAtEffectiveDate);
    const desiredSet = new Set(desiredRoleIds);
    const removedRoleIds = previousAtEffectiveDate.filter((roleId) => !desiredSet.has(roleId));
    const addedRoleIds = desiredRoleIds.filter((roleId) => !previousSet.has(roleId));

    for (const roleId of removedRoleIds) {
      const containing = periods.find((period) => (
        period.shiftRoleId === roleId
        && staffEligibilityPeriodContainsDate(period, effectiveDate)
      ));
      if (!containing) {
        continue;
      }
      if (containing.effectiveStart === effectiveDate) {
        await containing.destroy({ transaction });
      } else {
        await containing.update({
          effectiveEnd: previousDate(effectiveDate),
          endedBy: actorId,
          changeReason: reason ?? containing.changeReason,
        }, { transaction });
      }
    }

    for (const roleId of addedRoleIds) {
      const nextPeriod = periods.find((period) => (
        period.shiftRoleId === roleId
        && period.effectiveStart > effectiveDate
      ));
      await UserShiftRoleMembershipPeriod.create({
        userId,
        shiftRoleId: roleId,
        effectiveStart: effectiveDate,
        effectiveEnd: nextPeriod ? previousDate(nextPeriod.effectiveStart) : null,
        createdBy: actorId,
        endedBy: null,
        changeReason: reason,
        source,
        metadata,
      }, { transaction });
    }

    const currentRows = await UserShiftRole.findAll({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const previousProjection = currentRows.map((row) => row.shiftRoleId).sort((left, right) => left - right);
    const today = currentStaffEligibilityDate();
    const activeToday = await UserShiftRoleMembershipPeriod.findAll({
      where: { userId, ...buildDateWhere(today) },
      attributes: ['shiftRoleId'],
      order: [['shiftRoleId', 'ASC']],
      transaction,
    });
    const nextProjection = Array.from(new Set(activeToday.map((period) => period.shiftRoleId)))
      .sort((left, right) => left - right);
    const nextProjectionSet = new Set(nextProjection);
    const projectionRemovals = currentRows.filter((row) => !nextProjectionSet.has(row.shiftRoleId));
    const currentProjectionSet = new Set(previousProjection);
    const projectionAdditions = nextProjection.filter((roleId) => !currentProjectionSet.has(roleId));
    if (projectionRemovals.length > 0) {
      await UserShiftRole.destroy({
        where: {
          userId,
          shiftRoleId: { [Op.in]: projectionRemovals.map((row) => row.shiftRoleId) },
        },
        transaction,
      });
    }
    if (projectionAdditions.length > 0) {
      await UserShiftRole.bulkCreate(
        projectionAdditions.map((shiftRoleId) => ({ userId, shiftRoleId })),
        { transaction },
      );
    }

    const changed = removedRoleIds.length > 0
      || addedRoleIds.length > 0
      || previousProjection.join(',') !== nextProjection.join(',');
    if (changed) {
      await recordHistoryAudit({
        actorId,
        action: 'staff_eligibility.shift_roles_changed',
        userId,
        effectiveDate,
        reason,
        source,
        previous: previousProjection,
        next: nextProjection,
        applied: desiredRoleIds,
        metadata,
        transaction,
      });
    }

    return {
      changed,
      effectiveDate,
      previous: previousProjection,
      next: nextProjection,
      applied: desiredRoleIds,
    };
  });
}

export async function applyStaffProfileTypeChange(
  params: ApplyStaffProfileTypeChangeParams,
): Promise<ScalarHistoryChangeResult<StaffType>> {
  const userId = normalizePositiveInteger(params.userId, 'userId');
  if (!STAFF_TYPE_VALUES.has(params.staffType)) {
    throw new StaffEligibilityHistoryError(400, 'INVALID_STAFF_TYPE', 'staffType is invalid.');
  }
  const staffType = params.staffType;
  const effectiveDate = normalizeStaffEligibilityEffectiveDate(params.effectiveDate);
  const actorId = normalizeOptionalActorId(params.actorId);
  const reason = normalizeReason(params.reason);
  const source = normalizeSource(params.source);
  const metadata = normalizeMetadata(params.metadata);

  return withTransaction(params.transaction, async (transaction) => {
    await User.findByPk(userId, {
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const profile = await StaffProfile.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!profile) {
      throw new StaffEligibilityHistoryError(404, 'STAFF_PROFILE_NOT_FOUND', 'Staff profile not found.');
    }

    const periods = await StaffProfileTypePeriod.findAll({
      where: { userId },
      order: [['effectiveStart', 'ASC'], ['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertNoRecordedChangeAfter(periods, effectiveDate);
    const containing = periods.find((period) => staffEligibilityPeriodContainsDate(period, effectiveDate)) ?? null;
    const previousProjection = profile.staffType ?? null;
    let periodId: number | null = containing?.id ?? null;
    let historyChanged = false;

    if (containing?.staffType !== staffType) {
      historyChanged = true;
      if (containing && containing.effectiveStart === effectiveDate) {
        await containing.update({
          staffType,
          createdBy: actorId,
          changeReason: reason,
          source,
          metadata: { ...containing.metadata, ...metadata, replacedValue: containing.staffType },
        }, { transaction });
        periodId = containing.id;
      } else {
        const inheritedEnd = containing?.effectiveEnd ?? null;
        if (containing) {
          await containing.update({
            effectiveEnd: previousDate(effectiveDate),
            endedBy: actorId,
            changeReason: reason ?? containing.changeReason,
          }, { transaction });
        }
        const nextPeriod = periods.find((period) => period.effectiveStart > effectiveDate) ?? null;
        const created = await StaffProfileTypePeriod.create({
          userId,
          staffType,
          effectiveStart: effectiveDate,
          effectiveEnd: inheritedEnd ?? (nextPeriod ? previousDate(nextPeriod.effectiveStart) : null),
          createdBy: actorId,
          endedBy: null,
          changeReason: reason,
          source,
          metadata,
        }, { transaction });
        periodId = created.id;
      }
    }

    const today = currentStaffEligibilityDate();
    const activeToday = await StaffProfileTypePeriod.findOne({
      where: { userId, ...buildDateWhere(today) },
      order: [['effectiveStart', 'DESC'], ['id', 'DESC']],
      transaction,
    });
    const nextProjection = activeToday?.staffType ?? staffType;
    const projectionChanged = previousProjection !== nextProjection;
    if (projectionChanged) {
      await profile.update({ staffType: nextProjection }, { transaction });
    }

    const changed = historyChanged || projectionChanged;
    if (changed) {
      await recordHistoryAudit({
        actorId,
        action: 'staff_eligibility.staff_type_changed',
        userId,
        effectiveDate,
        reason,
        source,
        previous: previousProjection,
        next: nextProjection,
        applied: staffType,
        metadata,
        transaction,
      });
    }

    return {
      changed,
      effectiveDate,
      previous: previousProjection,
      next: nextProjection,
      applied: staffType,
      periodId,
    };
  });
}

export async function closeStaffProfileTypeHistoryForDeletion(
  params: HistoryMutationBase,
): Promise<CloseStaffProfileTypeHistoryResult> {
  const userId = normalizePositiveInteger(params.userId, 'userId');
  const effectiveDate = normalizeStaffEligibilityEffectiveDate(params.effectiveDate);
  const actorId = normalizeOptionalActorId(params.actorId);
  const reason = normalizeReason(params.reason);
  const source = normalizeSource(params.source);
  const metadata = normalizeMetadata(params.metadata);

  return withTransaction(params.transaction, async (transaction) => {
    await User.findByPk(userId, {
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const profile = await StaffProfile.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!profile) {
      throw new StaffEligibilityHistoryError(404, 'STAFF_PROFILE_NOT_FOUND', 'Staff profile not found.');
    }

    const periods = await StaffProfileTypePeriod.findAll({
      where: { userId },
      order: [['effectiveStart', 'ASC'], ['id', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    assertNoRecordedChangeAfter(periods, effectiveDate);

    const containing = periods.find((period) => (
      staffEligibilityPeriodContainsDate(period, effectiveDate)
    )) ?? null;
    const previous = containing?.staffType ?? profile.staffType ?? null;
    const periodId = containing?.id ?? null;
    let periodAction: CloseStaffProfileTypeHistoryResult['periodAction'] = 'none';

    if (containing) {
      // Payroll eligibility is date-granular. Keep the deletion date covered
      // so earnings already created that day retain their routing evidence;
      // the profile is uncovered beginning on the following day.
      await containing.update({
        effectiveEnd: effectiveDate,
        endedBy: actorId,
        changeReason: reason ?? containing.changeReason,
      }, { transaction });
      periodAction = 'closed';
    }

    await recordHistoryAudit({
      actorId,
      action: 'staff_eligibility.staff_profile_deleted',
      userId,
      effectiveDate,
      reason,
      source,
      previous,
      next: null,
      applied: null,
      metadata: {
        ...metadata,
        periodId,
        periodAction,
        profileStaffType: profile.staffType,
      },
      transaction,
    });

    return {
      changed: periodAction !== 'none',
      effectiveDate,
      previous,
      next: null,
      periodId,
      periodAction,
    };
  });
}
