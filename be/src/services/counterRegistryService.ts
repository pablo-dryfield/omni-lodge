import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op, type Transaction, type WhereOptions } from 'sequelize';

import sequelize from '../config/database.js';
import Counter, { type CounterStatus } from '../models/Counter.js';
import CounterChannelMetric from '../models/CounterChannelMetric.js';
import CounterUser, { type CounterStaffRole } from '../models/CounterUser.js';
import Channel from '../models/Channel.js';
import PaymentMethod from '../models/PaymentMethod.js';
import Addon from '../models/Addon.js';
import Product from '../models/Product.js';
import ProductAddon from '../models/ProductAddon.js';
import ChannelProductPrice from '../models/ChannelProductPrice.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import ShiftTypeProduct from '../models/ShiftTypeProduct.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftRole from '../models/ShiftRole.js';
import UserShiftRole from '../models/UserShiftRole.js';
import HttpError from '../errors/HttpError.js';
import NightReport from '../models/NightReport.js';
import Booking from '../models/Booking.js';
import { DID_NOT_OPERATE_NOTE } from '../constants/nightReports.js';
import { type BookingAttendanceStatus, type BookingStatus } from '../constants/bookings.js';
import {
  normalizeCurrencyCode,
  normalizeWalkInTicketType,
} from '../constants/walkInTicketTypes.js';
import {
  buildMetricKey,
  computeSummary,
  createMetricGrid,
  type AddonConfig,
  type ChannelConfig,
  type CounterSummary,
  type MetricCell,
  type MetricKind,
  type MetricPeriod,
  type MetricTallyType,
  type WalkInTicketPriceConfig,
  toAddonConfig,
} from './counterMetricUtils.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const COUNTER_DATE_FORMAT = 'YYYY-MM-DD';
const DEFAULT_PRODUCT_NAME = 'Pub Crawl';
const COUNTER_SUMMARY_ATTENDANCE_NOSHOW_FROM_DATE = '2026-02-20';
const STORE_TIMEZONE = 'Europe/Warsaw';
const AFTER_CUTOFF_TIME = '21:00:00';

const DEFAULT_CHANNEL_ORDER = [
  'Fareharbor',
  'Viator',
  'GetYourGuide',
  'FreeTour',
  'Walk-In',
  'Ecwid',
  'Email',
  'Hostel Atlantis',
  'XperiencePoland',
  'TopDeck',
];
const CHECKIN_ALLOWED_BOOKING_STATUSES = new Set<BookingStatus>(['pending', 'confirmed', 'amended', 'completed']);
const SUMMARY_NOSHOW_BOOKING_STATUSES = new Set<BookingStatus>([
  'pending',
  'confirmed',
  'amended',
  'completed',
  'rebooked',
  'no_show',
]);
const SUMMARY_BOOKED_METRIC_BOOKING_STATUSES = new Set<BookingStatus>([
  'pending',
  'confirmed',
  'amended',
  'completed',
  'rebooked',
  'no_show',
]);
const DEFAULT_BOOKING_ATTENDANCE_STATUS: BookingAttendanceStatus = 'pending';


export type MetricInput = {
  channelId: number;
  kind: MetricKind;
  addonId: number | null;
  tallyType: MetricTallyType;
  period: MetricPeriod;
  qty: number;
};

type CounterContext = {
  counter: Counter;
  channels: ChannelConfig[];
  addons: AddonConfig[];
  product: Product | null;
};

export type CounterRegistryPayload = {
  counter: {
    id: number;
    date: string;
    userId: number;
    status: CounterStatus;
    notes: string | null;
    productId: number | null;
    createdAt: Date;
    updatedAt: Date;
    manager: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      fullName: string;
    } | null;
    product: { id: number; name: string } | null;
  };
  staff: Array<{
    userId: number;
    role: string;
    name: string;
    userTypeSlug: string | null;
    userTypeName: string | null;
  }>;
  metrics: MetricCell[];
  derivedSummary: CounterSummary;
  addons: AddonConfig[];
  channels: ChannelConfig[];
};

type FindOrCreateParams = {
  date: string;
  userId: number;
  productId?: number | null;
  notes?: string | null;
};

type UpdateMetadataParams = {
  status?: CounterStatus | string;
  notes?: string | null;
  userId?: number;
  productId?: number | null;
};

type UserWithRole = User & { role?: UserType | null };

function getUserRole(user: UserWithRole | null | undefined) {
  if (!user) {
    return null;
  }
  return user.role ?? null;
}

function buildFullName(firstName?: string | null, lastName?: string | null): string {
  return [firstName ?? '', lastName ?? ''].join(' ').trim();
}

function normalizeChannelSlug(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildChannelConfigs(
  channels: Array<Channel & { paymentMethod?: PaymentMethod | null }>,
  priceByChannel: Map<number, number | null>,
  walkInTicketPricesByChannel: Map<number, WalkInTicketPriceConfig[]>,
): ChannelConfig[] {
  const orderMap = new Map<string, number>();
  DEFAULT_CHANNEL_ORDER.forEach((name, index) => orderMap.set(name.toLowerCase(), index));

  return channels
    .map((channel) => {
      const lowerName = channel.name.toLowerCase();
      const explicitOrder = orderMap.get(lowerName);
      const paymentMethodName = channel.paymentMethod?.name ?? null;
      const isCashPaymentMethod = (paymentMethodName ?? '').toLowerCase() === 'cash';
      const cashPrice = priceByChannel.get(channel.id) ?? null;

      return {
        id: channel.id,
        name: channel.name,
        sortOrder: explicitOrder ?? DEFAULT_CHANNEL_ORDER.length + channel.name.charCodeAt(0),
        paymentMethodId: channel.paymentMethodId ?? null,
        paymentMethodName,
        cashPrice: isCashPaymentMethod ? (cashPrice ?? null) : null,
        cashPaymentEligible: isCashPaymentMethod,
        walkInTicketPrices: walkInTicketPricesByChannel.get(channel.id) ?? [],
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function deriveBookingPartySize(booking: Booking): number {
  const fromTotal = Number(booking.partySizeTotal);
  if (Number.isFinite(fromTotal) && fromTotal > 0) {
    return Math.max(0, Math.round(fromTotal));
  }
  const fromBreakdown = Number(booking.partySizeAdults ?? 0) + Number(booking.partySizeChildren ?? 0);
  if (Number.isFinite(fromBreakdown) && fromBreakdown > 0) {
    return Math.max(0, Math.round(fromBreakdown));
  }
  return 0;
}

type BookingExtras = { tshirts: number; cocktails: number; photos: number };

function normalizeBookingExtrasSnapshot(snapshot: unknown): BookingExtras {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const extras = (snapshot as { extras?: Partial<BookingExtras> }).extras;
  if (!extras || typeof extras !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Math.max(0, Math.round(Number(extras.tshirts) || 0)),
    cocktails: Math.max(0, Math.round(Number(extras.cocktails) || 0)),
    photos: Math.max(0, Math.round(Number(extras.photos) || 0)),
  };
}

function isAfterCutoffBySourceReceivedAt(
  experienceDate: string,
  sourceReceivedAt: Date | null,
): boolean {
  if (!sourceReceivedAt) {
    return false;
  }
  const sourceMoment = dayjs(sourceReceivedAt).tz(STORE_TIMEZONE);
  if (!sourceMoment.isValid()) {
    return false;
  }
  if (sourceMoment.format(COUNTER_DATE_FORMAT) !== experienceDate) {
    return false;
  }
  const cutoffMoment = dayjs.tz(
    `${experienceDate} ${AFTER_CUTOFF_TIME}`,
    'YYYY-MM-DD HH:mm:ss',
    STORE_TIMEZONE,
  );
  if (!cutoffMoment.isValid()) {
    return false;
  }
  return sourceMoment.isAfter(cutoffMoment);
}

function resolveAddonIdFromConfig(
  addons: AddonConfig[],
  extraKey: keyof BookingExtras,
): number | null {
  const match = addons.find((addon) => {
    const key = addon.key.toLowerCase();
    const name = addon.name.toLowerCase();
    if (extraKey === 'cocktails') {
      return key.includes('cocktail') || name.includes('cocktail');
    }
    if (extraKey === 'tshirts') {
      return key.includes('shirt') || key.includes('tshirt') || name.includes('shirt');
    }
    if (extraKey === 'photos') {
      return key.includes('photo') || key.includes('picture') || name.includes('photo') || name.includes('picture');
    }
    return false;
  });
  return match?.addonId ?? null;
}

function resolveCheckInAllowanceForBooking(booking: Booking): number {
  if (!CHECKIN_ALLOWED_BOOKING_STATUSES.has(booking.status)) {
    return 0;
  }
  return deriveBookingPartySize(booking);
}

function normalizeAttendedExtrasSnapshot(snapshot: unknown): { tshirts: number; cocktails: number; photos: number } {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).tshirts) || 0)),
    cocktails: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).cocktails) || 0)),
    photos: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).photos) || 0)),
  };
}

function resolveBookingAttendanceStatusForFinalization(booking: Booking): BookingAttendanceStatus {
  const allowance = resolveCheckInAllowanceForBooking(booking);
  if (allowance <= 0) {
    return DEFAULT_BOOKING_ATTENDANCE_STATUS;
  }
  const rawAttendedTotal = Number(booking.attendedTotal ?? 0);
  const normalizedAttendedTotal = Number.isFinite(rawAttendedTotal)
    ? Math.max(0, Math.round(rawAttendedTotal))
    : 0;
  const attendedTotal = Math.min(normalizedAttendedTotal, allowance);
  if (attendedTotal >= allowance) {
    return 'checked_in_full';
  }
  if (attendedTotal > 0) {
    return 'checked_in_partial';
  }
  const attendedExtras = normalizeAttendedExtrasSnapshot(booking.attendedAddonsSnapshot ?? undefined);
  if (attendedExtras.tshirts > 0 || attendedExtras.cocktails > 0 || attendedExtras.photos > 0) {
    return 'checked_in_partial';
  }
  return 'no_show';
}

function resolveBookingNoShowPeopleByAttendance(booking: Booking): number {
  const allowance = deriveBookingPartySize(booking);
  if (allowance <= 0) {
    return 0;
  }
  const status = booking.status as BookingStatus;
  if (status === 'no_show') {
    return allowance;
  }
  if (!CHECKIN_ALLOWED_BOOKING_STATUSES.has(status)) {
    return 0;
  }
  const attendanceStatus = String(booking.attendanceStatus ?? DEFAULT_BOOKING_ATTENDANCE_STATUS)
    .trim()
    .toLowerCase();
  if (attendanceStatus === 'checked_in_full' || attendanceStatus === 'checked_in_partial') {
    return 0;
  }
  if (attendanceStatus === 'no_show') {
    return allowance;
  }
  const attended = Math.max(0, Math.round(Number(booking.attendedTotal ?? 0) || 0));
  return Math.max(allowance - attended, 0);
}

export default class CounterRegistryService {
  static resolveStaffRoleForUser(
    userId: number,
    userShiftRoles: Map<number, Set<number>>,
    roles: { guideRoleId: number | null; managerRoleId: number | null },
    fallbackSlug?: string | null,
  ): CounterStaffRole | null {
    const roleIds = userShiftRoles.get(userId);
    if (roleIds) {
      if (roles.managerRoleId != null && roleIds.has(roles.managerRoleId)) {
        return 'assistant_manager';
      }
      if (roles.guideRoleId != null && roleIds.has(roles.guideRoleId)) {
        return 'guide';
      }
    }
    if (fallbackSlug) {
      return this.resolveStaffRole(fallbackSlug);
    }
    return null;
  }

  static async syncScheduleAssignmentsForCounter(
    params: {
      date: string;
      productId: number | null;
      addedUserIds: number[];
      removedUserIds: number[];
      userShiftRoles: Map<number, Set<number>>;
      roles: { guideRoleId: number | null; managerRoleId: number | null };
    },
    transaction: Transaction,
  ): Promise<void> {
    const { date, productId, addedUserIds, removedUserIds, userShiftRoles, roles } = params;
    if (!date || !productId) {
      return;
    }
    if (addedUserIds.length === 0 && removedUserIds.length === 0) {
      return;
    }

    const shiftTypeLinks = await ShiftTypeProduct.findAll({
      where: { productId },
      transaction,
    });
    const shiftTypeIds = shiftTypeLinks.map((link) => link.shiftTypeId);
    if (shiftTypeIds.length === 0) {
      return;
    }

    const instances = await ShiftInstance.findAll({
      where: { date, shiftTypeId: { [Op.in]: shiftTypeIds } },
      transaction,
    });
    if (instances.length === 0) {
      return;
    }
    const instanceIds = instances.map((instance) => instance.id);

    const relevantUserIds = Array.from(new Set([...addedUserIds, ...removedUserIds]));
    const existingAssignments = await ShiftAssignment.findAll({
      where: {
        shiftInstanceId: { [Op.in]: instanceIds },
        userId: { [Op.in]: relevantUserIds },
      },
      transaction,
    });

    const assignmentsByInstanceUser = new Map<string, ShiftAssignment>();
    existingAssignments.forEach((assignment) => {
      assignmentsByInstanceUser.set(`${assignment.shiftInstanceId}:${assignment.userId}`, assignment);
    });

    if (removedUserIds.length > 0) {
      const removedSet = new Set(removedUserIds);
      const removals = existingAssignments.filter((assignment) => removedSet.has(assignment.userId));
      for (const assignment of removals) {
        await assignment.destroy({ transaction });
      }
    }

    if (addedUserIds.length > 0) {
      const addedSet = new Set(addedUserIds);
      for (const instance of instances) {
        for (const userId of addedSet) {
          const key = `${instance.id}:${userId}`;
          if (assignmentsByInstanceUser.has(key)) {
            continue;
          }
          const roleIds = userShiftRoles.get(userId);
          let shiftRoleId: number | null = null;
          let roleInShift = 'Guide';
          if (roles.managerRoleId != null && roleIds?.has(roles.managerRoleId)) {
            shiftRoleId = roles.managerRoleId;
            roleInShift = 'Manager';
          } else if (roles.guideRoleId != null && roleIds?.has(roles.guideRoleId)) {
            shiftRoleId = roles.guideRoleId;
            roleInShift = 'Guide';
          } else {
            roleInShift = 'Staff';
          }

          await ShiftAssignment.create(
            {
              shiftInstanceId: instance.id,
              userId,
              shiftRoleId,
              roleInShift,
            },
            { transaction },
          );
        }
      }
    }
  }

  static async findOrCreateCounter(
    params: FindOrCreateParams,
    actorUserId: number,
  ): Promise<CounterRegistryPayload> {
    const normalizedDate = this.normalizeDate(params.date);
    const manager = await this.loadUser(params.userId);
    if (!manager) {
      throw new HttpError(400, 'Manager not found');
    }

    const resolvedProductId = await this.resolveProductId(params.productId);

    const where: WhereOptions<Counter> = {
      date: normalizedDate,
      productId: resolvedProductId ?? null,
    };

    const [counter] = await Counter.findOrCreate({
      where,
      defaults: {
        userId: params.userId,
        productId: resolvedProductId,
        notes: params.notes ?? null,
        status: 'draft',
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
    });

    const delta: Partial<Counter> & { [key: string]: unknown } = {};

    if (counter.userId !== params.userId) {
      delta.userId = params.userId;
    }
    if (params.notes !== undefined && params.notes !== counter.notes) {
      delta.notes = params.notes ?? null;
    }
    if (resolvedProductId !== counter.productId) {
      delta.productId = resolvedProductId;
    }

    if (Object.keys(delta).length > 0) {
      delta.updatedBy = actorUserId;
      counter.set(delta);
      await counter.save();
    }

    const refreshed = await this.loadCounterById(counter.id);
    if (!refreshed) {
      throw new HttpError(404, 'Counter not found after creation');
    }

    const context = await this.buildContext(refreshed);
    return this.buildPayload(context);
  }

  static async getCounterByDate(date: string, productId?: number | null): Promise<CounterRegistryPayload> {
    const normalized = this.normalizeDate(date);
    const where: WhereOptions<Counter> = { date: normalized };
    if (productId !== undefined) {
      where.productId = productId ?? null;
    }
    const counter = await this.loadCounter(where);
    if (!counter) {
      throw new HttpError(404, 'Counter not found');
    }
    const context = await this.buildContext(counter);
    return this.buildPayload(context);
  }

  static async getCounterById(counterId: number): Promise<CounterRegistryPayload> {
    const counter = await this.loadCounterById(counterId);
    if (!counter) {
      throw new HttpError(404, 'Counter not found');
    }
    const context = await this.buildContext(counter);
    return this.buildPayload(context);
  }

  static async updateCounterMetadata(
    counterId: number,
    updates: UpdateMetadataParams,
    actorUserId: number,
  ): Promise<CounterRegistryPayload> {
    const counter = await this.loadCounterById(counterId);
    if (!counter) {
      throw new HttpError(404, 'Counter not found');
    }

    const delta: Partial<Counter> & { [key: string]: unknown } = {};

    if (updates.status !== undefined) {
      const allowedStatuses: CounterStatus[] = ['draft', 'platforms', 'reservations', 'final'];
      const nextStatus = updates.status as string;
      if (!allowedStatuses.includes(nextStatus as CounterStatus)) {
        throw new HttpError(400, 'Invalid status value');
      }
      let normalizedStatus = nextStatus as CounterStatus;
      if (normalizedStatus === 'final') {
        const staffCount = await CounterUser.count({ where: { counterId } });
        if (staffCount === 0) {
          throw new HttpError(400, 'Cannot finalize counter without staff assigned');
        }
      }
      if (counter.status === 'final' && normalizedStatus !== 'final') {
        normalizedStatus = counter.status;
      }
      if (counter.status !== normalizedStatus) {
        delta.status = normalizedStatus;
      }
    }

    if (updates.notes !== undefined) {
      delta.notes = updates.notes ?? null;
    }

    if (updates.userId !== undefined) {
      if (!Number.isInteger(updates.userId) || (updates.userId ?? 0) <= 0) {
        throw new HttpError(400, 'Invalid manager id');
      }
      const manager = await this.loadUser(updates.userId);
      if (!manager) {
        throw new HttpError(400, 'Manager not found');
      }
      const role = getUserRole(manager);
      const slug = role?.slug ?? '';
      if (!['manager', 'assistant-manager'].includes(slug)) {
        throw new HttpError(400, 'Manager must have manager or assistant-manager role');
      }
      if (counter.userId !== updates.userId) {
        delta.userId = updates.userId;
      }
    }

    if (updates.productId !== undefined) {
      const resolvedProductId =
        updates.productId == null ? null : await this.resolveProductId(Number(updates.productId));
      if (counter.productId !== resolvedProductId) {
        delta.productId = resolvedProductId;
      }
    }

    const shouldFinalizeBookingAttendance = delta.status === 'final' && counter.status !== 'final';

    if (Object.keys(delta).length === 0) {
      const context = await this.buildContext(counter);
      return this.buildPayload(context);
    }

    await sequelize.transaction(async (transaction) => {
      delta.updatedBy = actorUserId;
      counter.set(delta);
      await counter.save({ transaction });

      if (shouldFinalizeBookingAttendance) {
        await this.finalizeBookingAttendanceForCounter(counter, actorUserId, transaction);
      }
    });

    const refreshed = await this.loadCounterById(counterId);
    if (!refreshed) {
      throw new HttpError(404, 'Counter not found after update');
    }

    const context = await this.buildContext(refreshed);
    return this.buildPayload(context);
  }

  static async finalizeBookingAttendanceForCounter(
    counter: Counter,
    actorUserId: number,
    transaction: Transaction,
  ): Promise<void> {
    const where: WhereOptions = {
      experienceDate: counter.date,
      productId: counter.productId ?? null,
    };
    const bookings = await Booking.findAll({ where, transaction });
    for (const booking of bookings) {
      const nextAttendanceStatus = resolveBookingAttendanceStatusForFinalization(booking);
      let shouldSave = false;
      if (booking.attendanceStatus !== nextAttendanceStatus) {
        booking.attendanceStatus = nextAttendanceStatus;
        shouldSave = true;
      }
      if (nextAttendanceStatus === 'no_show' || nextAttendanceStatus === DEFAULT_BOOKING_ATTENDANCE_STATUS) {
        if (booking.checkedInAt !== null) {
          booking.checkedInAt = null;
          shouldSave = true;
        }
        if (booking.checkedInBy !== null) {
          booking.checkedInBy = null;
          shouldSave = true;
        }
      }
      if (shouldSave) {
        booking.updatedBy = actorUserId;
        await booking.save({ transaction });
      }
    }
  }

  static async updateCounterStaff(
    counterId: number,
    userIds: number[],
    actorUserId: number,
  ): Promise<CounterRegistryPayload> {
    const counter = await this.loadCounterById(counterId);
    if (!counter) {
      throw new HttpError(404, 'Counter not found');
    }

    const uniqueUserIds = Array.from(new Set(userIds));
    const users = (await User.findAll({
      where: { id: { [Op.in]: uniqueUserIds } },
      include: [{ model: UserType, as: 'role' }],
    })) as UserWithRole[];

    if (users.length !== uniqueUserIds.length) {
      throw new HttpError(400, 'One or more users not found');
    }

    const shiftRoles = await ShiftRole.findAll({
      where: {
        [Op.or]: [
          { slug: { [Op.in]: ['guide', 'manager'] } },
          { name: { [Op.in]: ['Guide', 'Manager'] } },
        ],
      },
    });
    const guideRole = shiftRoles.find((role) => role.slug === 'guide' || role.name === 'Guide') ?? null;
    const managerRole = shiftRoles.find((role) => role.slug === 'manager' || role.name === 'Manager') ?? null;
    const roleIds = [guideRole?.id, managerRole?.id].filter((id): id is number => typeof id === 'number');
    const userShiftRoles = new Map<number, Set<number>>();
    if (roleIds.length > 0 && uniqueUserIds.length > 0) {
      const shiftRoleLinks = await UserShiftRole.findAll({
        where: { userId: { [Op.in]: uniqueUserIds }, shiftRoleId: { [Op.in]: roleIds } },
      });
      shiftRoleLinks.forEach((link) => {
        const set = userShiftRoles.get(link.userId) ?? new Set<number>();
        set.add(link.shiftRoleId);
        userShiftRoles.set(link.userId, set);
      });
    }

    const assignments: Array<{ user: UserWithRole; role: CounterStaffRole }> = users.map((user) => {
      const roleSlug = getUserRole(user)?.slug ?? null;
      const resolvedRole = this.resolveStaffRoleForUser(
        user.id,
        userShiftRoles,
        { guideRoleId: guideRole?.id ?? null, managerRoleId: managerRole?.id ?? null },
        roleSlug,
      );
      if (!resolvedRole) {
        throw new HttpError(400, `User ${user.id} is not eligible for staff assignment`);
      }
      return { user, role: resolvedRole as CounterStaffRole };
    });

    await sequelize.transaction(async (transaction) => {
      const existing = await CounterUser.findAll({ where: { counterId }, transaction });
      const existingMap = new Map<number, CounterUser>();
      existing.forEach((record) => existingMap.set(record.userId, record));
      const existingUserIds = new Set(existing.map((record) => record.userId));

      const handledUserIds = new Set<number>();

      for (const entry of assignments) {
        const existingRecord = existingMap.get(entry.user.id);
        if (existingRecord) {
          if (existingRecord.role !== entry.role) {
            existingRecord.role = entry.role;
            existingRecord.updatedBy = actorUserId;
            await existingRecord.save({ transaction });
          }
        } else {
          await CounterUser.create(
            {
              counterId,
              userId: entry.user.id,
              role: entry.role,
              createdBy: actorUserId,
              updatedBy: actorUserId,
            },
            { transaction },
          );
        }
        handledUserIds.add(entry.user.id);
      }

      for (const record of existing) {
        if (!handledUserIds.has(record.userId)) {
          await record.destroy({ transaction });
        }
      }

      const addedUserIds = uniqueUserIds.filter((id) => !existingUserIds.has(id));
      const removedUserIds = Array.from(existingUserIds).filter((id) => !uniqueUserIds.includes(id));

      await this.syncScheduleAssignmentsForCounter(
        {
          date: counter.date,
          productId: counter.productId ?? null,
          addedUserIds,
          removedUserIds,
          userShiftRoles,
          roles: { guideRoleId: guideRole?.id ?? null, managerRoleId: managerRole?.id ?? null },
        },
        transaction,
      );
    });

    const refreshed = await this.loadCounterById(counterId);
    if (!refreshed) {
      throw new HttpError(404, 'Counter not found after staff update');
    }
    const context = await this.buildContext(refreshed);
    return this.buildPayload(context);
  }

  static async upsertMetrics(
    counterId: number,
    rows: MetricInput[],
    actorUserId: number,
  ): Promise<{ metrics: MetricCell[]; derivedSummary: CounterSummary }> {
    const counter = await this.loadCounterById(counterId);
    if (!counter) {
      throw new HttpError(404, 'Counter not found');
    }

    const [channelRecords, addonRecords] = await Promise.all([
      Channel.findAll({
        include: [{ model: PaymentMethod, as: 'paymentMethod' }],
        attributes: ['id', 'name', 'paymentMethodId'],
      }) as Promise<Array<Channel & { paymentMethod?: PaymentMethod | null }>>,
      Addon.findAll({
        where: { isActive: true },
        attributes: ['id', 'name'],
        order: [['name', 'ASC']],
      }),
    ]);

    const walkInChannelIdSet = new Set<number>();
    const onlineChannelIdByPlatform = new Map<string, number>();
    channelRecords.forEach((channel) => {
      const slug = normalizeChannelSlug(channel.name);
      if (!slug) {
        return;
      }
      if (slug === 'walkin') {
        walkInChannelIdSet.add(channel.id);
        return;
      }
      const paymentMethodName = (channel.paymentMethod?.name ?? '').toLowerCase();
      const isCashChannel = paymentMethodName === 'cash';
      if (!isCashChannel) {
        onlineChannelIdByPlatform.set(slug, channel.id);
      }
    });
    const onlineChannelIdSet = new Set<number>(Array.from(onlineChannelIdByPlatform.values()));

    const addonConfigs = addonRecords.map((addon, index) =>
      toAddonConfig({
        addonId: addon.id,
        name: addon.name,
        maxPerAttendee: null,
        sortOrder: index,
      }),
    );
    const addonIdByExtraKey: Record<keyof BookingExtras, number | null> = {
      cocktails: resolveAddonIdFromConfig(addonConfigs, 'cocktails'),
      tshirts: resolveAddonIdFromConfig(addonConfigs, 'tshirts'),
      photos: resolveAddonIdFromConfig(addonConfigs, 'photos'),
    };

    const bookedPeopleByChannelPeriod = new Map<string, number>();
    const bookedAddonByChannelPeriod = new Map<string, number>();
    if (counter.productId && onlineChannelIdSet.size > 0) {
      const bookings = await Booking.findAll({
        where: {
          experienceDate: counter.date,
          productId: counter.productId,
          status: { [Op.in]: Array.from(SUMMARY_BOOKED_METRIC_BOOKING_STATUSES) },
        },
        attributes: [
          'platform',
          'sourceReceivedAt',
          'partySizeTotal',
          'partySizeAdults',
          'partySizeChildren',
          'addonsSnapshot',
        ],
      });

      bookings.forEach((booking) => {
        const platformKey = normalizeChannelSlug(booking.platform);
        const channelId = onlineChannelIdByPlatform.get(platformKey);
        if (!channelId) {
          return;
        }

        const bookedPeriod: MetricPeriod = isAfterCutoffBySourceReceivedAt(counter.date, booking.sourceReceivedAt)
          ? 'after_cutoff'
          : 'before_cutoff';
        const partySize = deriveBookingPartySize(booking);
        if (partySize > 0) {
          const peopleKey = `${channelId}|${bookedPeriod}`;
          bookedPeopleByChannelPeriod.set(peopleKey, (bookedPeopleByChannelPeriod.get(peopleKey) ?? 0) + partySize);
        }

        const extras = normalizeBookingExtrasSnapshot(booking.addonsSnapshot ?? undefined);
        (Object.keys(extras) as Array<keyof BookingExtras>).forEach((extraKey) => {
          const addonId = addonIdByExtraKey[extraKey];
          if (!addonId) {
            return;
          }
          const qty = Math.max(0, Math.round(Number(extras[extraKey]) || 0));
          if (qty <= 0) {
            return;
          }
          const addonKey = `${channelId}|${bookedPeriod}|${addonId}`;
          bookedAddonByChannelPeriod.set(addonKey, (bookedAddonByChannelPeriod.get(addonKey) ?? 0) + qty);
        });
      });
    }

    const job = await sequelize.transaction(async (transaction) => {
      const existingMetrics = await CounterChannelMetric.findAll({
        where: { counterId },
        transaction,
      });

      const existingByKey = new Map<string, CounterChannelMetric>(
        existingMetrics.map((metric) => [
          buildMetricKey({
            channelId: metric.channelId,
            kind: metric.kind as MetricKind,
            addonId: metric.addonId ?? null,
            tallyType: metric.tallyType as MetricTallyType,
            period:
              metric.tallyType === 'booked'
                ? (metric.period ?? 'before_cutoff')
                : metric.tallyType === 'attended'
                ? null
                : metric.period ?? null,
          }),
          metric,
        ]),
      );

      type NormalizedMetric = MetricInput & { period: MetricPeriod };

      const incomingByKey = new Map<string, NormalizedMetric>();

      for (const row of rows) {
        const normalizedPeriod: MetricPeriod =
          row.tallyType === 'booked'
            ? (row.period ?? 'before_cutoff')
            : row.tallyType === 'attended'
            ? null
            : row.period ?? null;

        const key = buildMetricKey({
          channelId: row.channelId,
          kind: row.kind,
          addonId: row.addonId,
          tallyType: row.tallyType,
          period: normalizedPeriod,
        });

        incomingByKey.set(key, { ...row, period: normalizedPeriod });
      }

      if (onlineChannelIdSet.size > 0) {
        const setBookedMetricFromSource = (
          channelId: number,
          kind: MetricKind,
          addonId: number | null,
          period: Extract<MetricPeriod, 'before_cutoff' | 'after_cutoff'>,
          qty: number,
        ) => {
          const normalizedQty = Math.max(0, Math.round(Number(qty) || 0));
          const key = buildMetricKey({
            channelId,
            kind,
            addonId,
            tallyType: 'booked',
            period,
          });
          const hasExisting = existingByKey.has(key);
          const hasIncoming = incomingByKey.has(key);
          if (normalizedQty <= 0 && !hasExisting && !hasIncoming) {
            return;
          }
          incomingByKey.set(key, {
            channelId,
            kind,
            addonId,
            tallyType: 'booked',
            period,
            qty: normalizedQty,
          });
        };

        onlineChannelIdSet.forEach((channelId) => {
          const beforePeopleQty = bookedPeopleByChannelPeriod.get(`${channelId}|before_cutoff`) ?? 0;
          const afterPeopleQty = bookedPeopleByChannelPeriod.get(`${channelId}|after_cutoff`) ?? 0;
          setBookedMetricFromSource(channelId, 'people', null, 'before_cutoff', beforePeopleQty);
          setBookedMetricFromSource(channelId, 'people', null, 'after_cutoff', afterPeopleQty);

          const addonIds = new Set<number>();
          (Object.values(addonIdByExtraKey) as Array<number | null>).forEach((addonId) => {
            if (addonId != null) {
              addonIds.add(addonId);
            }
          });
          incomingByKey.forEach((incomingMetric) => {
            if (
              incomingMetric.channelId === channelId &&
              incomingMetric.kind === 'addon' &&
              incomingMetric.tallyType === 'booked' &&
              incomingMetric.addonId != null
            ) {
              addonIds.add(incomingMetric.addonId);
            }
          });
          existingByKey.forEach((existingMetric) => {
            if (
              existingMetric.channelId === channelId &&
              existingMetric.kind === 'addon' &&
              existingMetric.tallyType === 'booked' &&
              existingMetric.addonId != null
            ) {
              addonIds.add(existingMetric.addonId);
            }
          });

          addonIds.forEach((addonId) => {
            const beforeAddonQty = bookedAddonByChannelPeriod.get(`${channelId}|before_cutoff|${addonId}`) ?? 0;
            const afterAddonQty = bookedAddonByChannelPeriod.get(`${channelId}|after_cutoff|${addonId}`) ?? 0;
            setBookedMetricFromSource(channelId, 'addon', addonId, 'before_cutoff', beforeAddonQty);
            setBookedMetricFromSource(channelId, 'addon', addonId, 'after_cutoff', afterAddonQty);
          });
        });
      }

      if (walkInChannelIdSet.size > 0) {
        const resolveMetricQty = (
          channelId: number,
          kind: MetricKind,
          addonId: number | null,
          tallyType: MetricTallyType,
          period: MetricPeriod,
        ): number => {
          const key = buildMetricKey({ channelId, kind, addonId, tallyType, period });
          const incoming = incomingByKey.get(key);
          if (incoming) {
            return Math.max(0, Number(incoming.qty) || 0);
          }
          const current = existingByKey.get(key);
          return Math.max(0, Number(current?.qty) || 0);
        };

        const ensureAfterCutoffMetric = (
          channelId: number,
          kind: MetricKind,
          addonId: number | null,
        ) => {
          const bookedBeforeQty = resolveMetricQty(channelId, kind, addonId, 'booked', 'before_cutoff');
          const attendedQty = resolveMetricQty(channelId, kind, addonId, 'attended', null);
          const desiredBookedAfterQty = Math.max(attendedQty - bookedBeforeQty, 0);
          const afterKey = buildMetricKey({
            channelId,
            kind,
            addonId,
            tallyType: 'booked',
            period: 'after_cutoff',
          });

          const hasExistingAfter = existingByKey.has(afterKey);
          const existingIncomingAfter = incomingByKey.get(afterKey);
          if (desiredBookedAfterQty <= 0 && !hasExistingAfter && !existingIncomingAfter) {
            return;
          }

          incomingByKey.set(afterKey, {
            channelId,
            kind,
            addonId,
            tallyType: 'booked',
            period: 'after_cutoff',
            qty: desiredBookedAfterQty,
          });
        };

        walkInChannelIdSet.forEach((channelId) => {
          ensureAfterCutoffMetric(channelId, 'people', null);
          const addonIds = new Set<number>();
          incomingByKey.forEach((row) => {
            if (row.channelId === channelId && row.kind === 'addon' && row.addonId != null) {
              addonIds.add(row.addonId);
            }
          });
          existingByKey.forEach((metric) => {
            if (metric.channelId === channelId && metric.kind === 'addon' && metric.addonId != null) {
              addonIds.add(metric.addonId);
            }
          });
          addonIds.forEach((addonId) => {
            ensureAfterCutoffMetric(channelId, 'addon', addonId);
          });
        });
      }

      const rowsToCreate: NormalizedMetric[] = [];
      const rowsToUpdate: Array<{ metric: CounterChannelMetric; row: NormalizedMetric }> = [];
      const rowsToDelete: CounterChannelMetric[] = [];

      incomingByKey.forEach((row: NormalizedMetric, key) => {
        const current = existingByKey.get(key);
        if (!current) {
          const nextQty = Math.max(0, Number(row.qty) || 0);
          if (nextQty > 0) {
            rowsToCreate.push({ ...row, qty: nextQty });
          }
          return;
        }

        const currentPeriod: MetricPeriod =
          current.tallyType === 'booked'
            ? (current.period ?? 'before_cutoff')
            : current.tallyType === 'attended'
            ? null
            : current.period ?? null;

        const currentQty = Number(current.qty);
        const nextQty = Math.max(0, Number(row.qty) || 0);
        if (currentPeriod !== row.period || currentQty !== nextQty) {
          if (nextQty === 0) {
            rowsToDelete.push(current);
          } else {
            rowsToUpdate.push({ metric: current, row: { ...row, qty: nextQty } });
          }
        }
      });

      if (rowsToCreate.length > 0) {
        await CounterChannelMetric.bulkCreate(
          rowsToCreate
            .map((row) => ({
              counterId,
              channelId: row.channelId,
              kind: row.kind,
              addonId: row.addonId,
              tallyType: row.tallyType,
              period: row.tallyType === 'attended' ? null : row.period,
              qty: row.qty,
              createdBy: actorUserId,
              updatedBy: actorUserId,
            }))
            .map((payload) => payload as Record<string, unknown>),
          { transaction, returning: false },
        );
      }

      for (const record of rowsToDelete) {
        await record.destroy({ transaction });
      }

      for (const { metric, row } of rowsToUpdate) {
        const nextPeriod = row.tallyType === 'attended' ? null : row.period;
        const nextQty = Math.max(0, Number(row.qty) || 0);
        metric.qty = nextQty;
        metric.period = nextPeriod;
        metric.set('updatedBy', actorUserId);
        await metric.save({ transaction });
      }

      const refreshedMetrics = await CounterChannelMetric.findAll({
        where: { counterId },
        transaction,
      });

      return refreshedMetrics.map(
        (metric): MetricCell => ({
          id: metric.id,
          counterId: metric.counterId,
          channelId: metric.channelId,
          kind: metric.kind as MetricKind,
          addonId: metric.addonId ?? null,
          tallyType: metric.tallyType as MetricTallyType,
          period:
            metric.tallyType === 'attended'
              ? null
              : (metric.period as MetricPeriod) ?? 'before_cutoff',
          qty: Number(metric.qty ?? 0),
        }),
      );
    });

    const context = await this.buildContext(counter);
    const metrics = createMetricGrid({
      counterId: counter.id,
      channels: context.channels,
      addons: context.addons,
      existingMetrics: job,
    });
    const summary = computeSummary({
      metrics,
      channels: context.channels,
      addons: context.addons,
    });
    return { metrics, derivedSummary: summary };
  }

  static normalizeDate(date: string): string {
    const parsed = dayjs(date, COUNTER_DATE_FORMAT, true);
    if (!parsed.isValid()) {
      throw new HttpError(400, 'date must be in YYYY-MM-DD format');
    }
    return parsed.format(COUNTER_DATE_FORMAT);
  }

  static async loadUser(userId: number): Promise<UserWithRole | null> {
    return (await User.findByPk(userId, {
      include: [{ model: UserType, as: 'role' }],
    })) as UserWithRole | null;
  }

  static async resolveProductId(productId?: number | null): Promise<number | null> {
    if (productId != null) {
      const product = await Product.findByPk(productId);
      if (!product || product.status === false) {
        throw new HttpError(400, 'Invalid product');
      }
      return product.id;
    }
    const defaultProduct = await Product.findOne({
      where: {
        name: DEFAULT_PRODUCT_NAME,
        status: { [Op.ne]: false },
      },
      order: [['id', 'ASC']],
    });
    if (defaultProduct) {
      return defaultProduct.id;
    }
    return null;
  }

  static async loadCounter(where: WhereOptions<Counter>) {
    return Counter.findOne({
      where,
      include: [
        { model: User, as: 'manager' },
        { model: Product, as: 'product' },
      ],
    });
  }

  static async loadCounterById(counterId: number) {
    return this.loadCounter({ id: counterId });
  }

  static resolveStaffRole(slug: string): CounterStaffRole | null {
    if (slug === 'pub-crawl-guide' || slug === 'guide') {
      return 'guide';
    }
    if (slug === 'manager') {
      return 'assistant_manager';
    }
    if (slug === 'assistant-manager') {
      return 'assistant_manager';
    }
    return null;
  }

  static async buildContext(counter: Counter): Promise<CounterContext> {
    const [channels, addons, product] = await Promise.all([
      Channel.findAll({
        order: [['name', 'ASC']],
        include: [{ model: PaymentMethod, as: 'paymentMethod' }],
      }),
      Addon.findAll({ where: { isActive: true }, order: [['name', 'ASC']] }),
      counter.productId ? Product.findByPk(counter.productId) : Promise.resolve(null),
    ]);

    const targetProductId = product?.id ?? counter.productId ?? null;
    const priceByChannel = new Map<number, number | null>();
    const walkInTicketPricesByChannel = new Map<number, WalkInTicketPriceConfig[]>();

    if (targetProductId != null && channels.length > 0) {
      const channelIds = channels.map((channel) => channel.id);
      const priceRecords = await ChannelProductPrice.findAll({
        where: { productId: targetProductId, channelId: channelIds },
        order: [
          ['channelId', 'ASC'],
          ['ticketType', 'ASC'],
          ['currencyCode', 'ASC'],
          ['validFrom', 'DESC'],
          ['id', 'DESC'],
        ],
      });

      const counterDate = dayjs(counter.date);
      const walkInChannelIds = new Set(
        channels
          .filter((channel) => normalizeChannelSlug(channel.name) === 'walkin')
          .map((channel) => channel.id),
      );
      const walkInPriceMapByChannel = new Map<number, Map<string, WalkInTicketPriceConfig>>();

      for (const record of priceRecords) {
        const validFrom = dayjs(record.validFrom);
        if (validFrom.isAfter(counterDate, 'day')) {
          continue;
        }
        const validTo = record.validTo ? dayjs(record.validTo) : null;
        if (validTo && counterDate.isAfter(validTo, 'day')) {
          continue;
        }
        const numericPrice = Number(record.price);
        if (!Number.isFinite(numericPrice)) {
          continue;
        }

        const ticketType = normalizeWalkInTicketType(record.ticketType);
        const currencyCode = normalizeCurrencyCode(record.currencyCode);

        if (ticketType === 'normal' && currencyCode === 'PLN' && !priceByChannel.has(record.channelId)) {
          priceByChannel.set(record.channelId, numericPrice);
        }

        if (!walkInChannelIds.has(record.channelId)) {
          continue;
        }
        const byKey = walkInPriceMapByChannel.get(record.channelId) ?? new Map<string, WalkInTicketPriceConfig>();
        const key = `${ticketType}|${currencyCode}`;
        if (byKey.has(key)) {
          continue;
        }
        byKey.set(key, {
          ticketType,
          currencyCode,
          price: numericPrice,
        });
        walkInPriceMapByChannel.set(record.channelId, byKey);
      }

      walkInPriceMapByChannel.forEach((priceMap, channelId) => {
        const rows = Array.from(priceMap.values()).sort((left, right) => {
          return (
            left.ticketType.localeCompare(right.ticketType) ||
            left.currencyCode.localeCompare(right.currencyCode)
          );
        });
        walkInTicketPricesByChannel.set(channelId, rows);
      });
    }

    const channelConfigs = buildChannelConfigs(
      channels as Array<Channel & { paymentMethod?: PaymentMethod | null }>,
      priceByChannel,
      walkInTicketPricesByChannel,
    );

    let addonConfigs = addons.map((addon, index) =>
      toAddonConfig({
        addonId: addon.id,
        name: addon.name,
        maxPerAttendee: null,
        sortOrder: index,
      }),
    );

    if (product) {
      const productAddons = (await ProductAddon.findAll({
        where: { productId: product.id },
        include: [{ model: Addon, as: 'addon' }],
        order: [['sortOrder', 'ASC']],
      })) as Array<ProductAddon & { addon?: Addon | null }>;

      addonConfigs = productAddons
        .filter((record) => record.addon?.isActive !== false)
        .map((record, index) => {
          const addon = record.addon;
          return toAddonConfig({
            addonId: record.addonId,
            name: addon?.name ?? `Addon ${record.addonId}`,
            maxPerAttendee: record.maxPerAttendee ?? null,
            sortOrder: record.sortOrder ?? index,
          });
        });
    }

    return {
      counter,
      channels: channelConfigs,
      addons: addonConfigs,
      product: product ?? null,
    };
  }

  static async buildPayload(context: CounterContext): Promise<CounterRegistryPayload> {
    const { counter, channels, addons, product } = context;

    const [metricRows, staffRows] = await Promise.all([
      CounterChannelMetric.findAll({ where: { counterId: counter.id } }),
      CounterUser.findAll({
        where: { counterId: counter.id },
        include: [
          {
            model: User,
            as: 'counterUser',
            include: [{ model: UserType, as: 'role' }],
          },
        ],
        order: [[{ model: User, as: 'counterUser' }, 'firstName', 'ASC']],
      }),
    ]);

    const grid = createMetricGrid({
      counterId: counter.id,
      channels,
      addons,
      existingMetrics: metricRows.map((metric) => ({
        id: metric.id,
        counterId: metric.counterId,
        channelId: metric.channelId,
        kind: metric.kind,
        addonId: metric.addonId ?? null,
        tallyType: metric.tallyType,
        period: metric.period ?? null,
        qty: Number(metric.qty ?? 0),
      })),
    });

    const baseSummary = computeSummary({ metrics: grid, channels, addons });
    const attendanceAdjustedSummary = await this.applyAttendanceNoShowSummary(baseSummary, counter, channels);
    const summary = this.applyWalkInAfterCutoffSummary(attendanceAdjustedSummary, channels);

    const staff = staffRows.map((record) => {
      const user = record.counterUser;
      const role = getUserRole(user);
      const name = user ? buildFullName(user.firstName, user.lastName) : '';
      return {
        userId: record.userId,
        role: record.role,
        name,
        userTypeSlug: role?.slug ?? null,
        userTypeName: role?.name ?? null,
      };
    });

    const manager = counter.manager
      ? {
          id: counter.manager.id,
          firstName: counter.manager.firstName ?? null,
          lastName: counter.manager.lastName ?? null,
          fullName: buildFullName(counter.manager.firstName, counter.manager.lastName),
        }
      : null;

    const productSummary = product
      ? { id: product.id, name: product.name }
      : counter.product
      ? { id: counter.product.id, name: counter.product.name }
      : null;

    const payload: CounterRegistryPayload = {
      counter: {
        id: counter.id,
        date: counter.date,
        userId: counter.userId,
        status: counter.status as CounterStatus,
        notes: counter.notes ?? null,
        productId: counter.productId ?? productSummary?.id ?? null,
        createdAt: counter.createdAt,
        updatedAt: counter.updatedAt,
        manager,
        product: productSummary,
      },
      staff,
      metrics: grid,
      derivedSummary: summary,
      addons,
      channels,
    };

    await CounterRegistryService.ensureNightReportForCounter(counter, summary);

    return payload;
  }

  private static async applyAttendanceNoShowSummary(
    summary: CounterSummary,
    counter: Counter,
    channels: ChannelConfig[],
  ): Promise<CounterSummary> {
    if (!counter.productId) {
      return summary;
    }
    if (counter.date < COUNTER_SUMMARY_ATTENDANCE_NOSHOW_FROM_DATE) {
      return summary;
    }

    const onlineChannels = channels.filter((channel) => {
      const slug = normalizeChannelSlug(channel.name);
      if (slug === 'walkin') {
        return false;
      }
      return !channel.cashPaymentEligible;
    });
    if (onlineChannels.length === 0) {
      return summary;
    }

    const channelIdByPlatform = new Map<string, number>();
    onlineChannels.forEach((channel) => {
      const key = normalizeChannelSlug(channel.name);
      if (key) {
        channelIdByPlatform.set(key, channel.id);
      }
    });

    const bookings = await Booking.findAll({
      where: {
        experienceDate: counter.date,
        productId: counter.productId,
        status: { [Op.in]: Array.from(SUMMARY_NOSHOW_BOOKING_STATUSES) },
      },
      attributes: [
        'id',
        'platform',
        'status',
        'attendanceStatus',
        'attendedTotal',
        'partySizeTotal',
        'partySizeAdults',
        'partySizeChildren',
      ],
    });

    const noShowByChannelId = new Map<number, number>();
    bookings.forEach((booking) => {
      const platformKey = normalizeChannelSlug(booking.platform);
      const channelId = channelIdByPlatform.get(platformKey);
      if (!channelId) {
        return;
      }
      const noShowPeople = resolveBookingNoShowPeopleByAttendance(booking);
      if (noShowPeople <= 0) {
        return;
      }
      noShowByChannelId.set(channelId, (noShowByChannelId.get(channelId) ?? 0) + noShowPeople);
    });

    if (noShowByChannelId.size === 0) {
      return summary;
    }

    const onlineChannelIdSet = new Set<number>(onlineChannels.map((channel) => channel.id));
    const byChannel = summary.byChannel.map((channelSummary) => {
      if (!onlineChannelIdSet.has(channelSummary.channelId)) {
        return channelSummary;
      }
      const nextNoShow = Math.max(
        0,
        Math.round(Number(noShowByChannelId.get(channelSummary.channelId) ?? 0) || 0),
      );
      if (nextNoShow === channelSummary.people.nonShow) {
        return channelSummary;
      }
      return {
        ...channelSummary,
        people: {
          ...channelSummary.people,
          nonShow: nextNoShow,
        },
      };
    });

    const totalPeopleNoShow = byChannel.reduce(
      (sum, channelSummary) => sum + Math.max(0, Math.round(Number(channelSummary.people.nonShow) || 0)),
      0,
    );

    return {
      ...summary,
      byChannel,
      totals: {
        ...summary.totals,
        people: {
          ...summary.totals.people,
          nonShow: totalPeopleNoShow,
        },
      },
    };
  }

  private static applyWalkInAfterCutoffSummary(
    summary: CounterSummary,
    channels: ChannelConfig[],
  ): CounterSummary {
    const walkInChannelIdSet = new Set<number>(
      channels
        .filter((channel) => normalizeChannelSlug(channel.name) === 'walkin')
        .map((channel) => channel.id),
    );
    if (walkInChannelIdSet.size === 0) {
      return summary;
    }

    let changed = false;
    const byChannel = summary.byChannel.map((channelSummary) => {
      if (!walkInChannelIdSet.has(channelSummary.channelId)) {
        return channelSummary;
      }

      const nextPeopleBookedAfter = Math.max(channelSummary.people.attended - channelSummary.people.bookedBefore, 0);
      const nextPeopleNonShow = Math.max(
        channelSummary.people.bookedBefore + nextPeopleBookedAfter - channelSummary.people.attended,
        0,
      );

      let addonChanged = false;
      const nextAddons = Object.fromEntries(
        Object.entries(channelSummary.addons).map(([key, addonBucket]) => {
          const nextBookedAfter = Math.max(addonBucket.attended - addonBucket.bookedBefore, 0);
          const nextNonShow = Math.max(addonBucket.bookedBefore + nextBookedAfter - addonBucket.attended, 0);
          if (nextBookedAfter !== addonBucket.bookedAfter || nextNonShow !== addonBucket.nonShow) {
            addonChanged = true;
          }
          return [
            key,
            {
              ...addonBucket,
              bookedAfter: nextBookedAfter,
              nonShow: nextNonShow,
            },
          ];
        }),
      );

      const peopleChanged =
        nextPeopleBookedAfter !== channelSummary.people.bookedAfter ||
        nextPeopleNonShow !== channelSummary.people.nonShow;

      if (!peopleChanged && !addonChanged) {
        return channelSummary;
      }

      changed = true;
      return {
        ...channelSummary,
        people: {
          ...channelSummary.people,
          bookedAfter: nextPeopleBookedAfter,
          nonShow: nextPeopleNonShow,
        },
        addons: nextAddons,
      };
    });

    if (!changed) {
      return summary;
    }

    const totalsPeople = {
      bookedBefore: 0,
      bookedAfter: 0,
      attended: 0,
      nonShow: 0,
    };
    const totalsAddons: CounterSummary['totals']['addons'] = {};

    Object.entries(summary.totals.addons).forEach(([key, bucket]) => {
      totalsAddons[key] = {
        ...bucket,
        bookedBefore: 0,
        bookedAfter: 0,
        attended: 0,
        nonShow: 0,
      };
    });

    byChannel.forEach((channelSummary) => {
      totalsPeople.bookedBefore += Math.max(0, Math.round(Number(channelSummary.people.bookedBefore) || 0));
      totalsPeople.bookedAfter += Math.max(0, Math.round(Number(channelSummary.people.bookedAfter) || 0));
      totalsPeople.attended += Math.max(0, Math.round(Number(channelSummary.people.attended) || 0));
      totalsPeople.nonShow += Math.max(0, Math.round(Number(channelSummary.people.nonShow) || 0));

      Object.entries(channelSummary.addons).forEach(([key, addonBucket]) => {
        const existing = totalsAddons[key] ?? {
          ...addonBucket,
          bookedBefore: 0,
          bookedAfter: 0,
          attended: 0,
          nonShow: 0,
        };
        existing.bookedBefore += Math.max(0, Math.round(Number(addonBucket.bookedBefore) || 0));
        existing.bookedAfter += Math.max(0, Math.round(Number(addonBucket.bookedAfter) || 0));
        existing.attended += Math.max(0, Math.round(Number(addonBucket.attended) || 0));
        existing.nonShow += Math.max(0, Math.round(Number(addonBucket.nonShow) || 0));
        totalsAddons[key] = existing;
      });
    });

    return {
      ...summary,
      byChannel,
      totals: {
        people: totalsPeople,
        addons: totalsAddons,
      },
    };
  }

  private static async ensureNightReportForCounter(
    counter: Counter,
    summary: CounterSummary,
  ): Promise<void> {
    if (counter.status !== 'final') {
      return;
    }
    const totals = summary?.totals?.people ?? {
      bookedBefore: 0,
      bookedAfter: 0,
      attended: 0,
      nonShow: 0,
    };
    const zeroAttendance =
      Math.max(0, totals.attended ?? 0) === 0 &&
      Math.max(0, totals.bookedBefore ?? 0) === 0 &&
      Math.max(0, totals.bookedAfter ?? 0) === 0;

    let normalizedNotes = (counter.notes ?? '').trim().toLowerCase();
    let didNotOperate = normalizedNotes === DID_NOT_OPERATE_NOTE.toLowerCase();

    if (!didNotOperate && zeroAttendance) {
      await Counter.update(
        {
          notes: DID_NOT_OPERATE_NOTE,
          updatedBy: counter.updatedBy ?? counter.createdBy ?? counter.userId,
        },
        { where: { id: counter.id } },
      );
      counter.notes = DID_NOT_OPERATE_NOTE;
      normalizedNotes = DID_NOT_OPERATE_NOTE.toLowerCase();
      didNotOperate = true;
    }

    if (!didNotOperate) {
      return;
    }

    const existing = await NightReport.findOne({ where: { counterId: counter.id } });
    if (existing) {
      if (existing.status !== 'submitted') {
        existing.notes = DID_NOT_OPERATE_NOTE;
        existing.status = 'submitted';
        existing.submittedAt = new Date();
        await existing.save();
      }
      return;
    }

    await NightReport.create({
      counterId: counter.id,
      leaderId: counter.userId,
      activityDate: counter.date,
      status: 'submitted',
      notes: DID_NOT_OPERATE_NOTE,
      createdBy: counter.createdBy ?? counter.userId,
      updatedBy: counter.updatedBy ?? counter.userId,
      submittedAt: new Date(),
    });
  }
}


