import dayjs from 'dayjs';
import { Op, type WhereOptions } from 'sequelize';

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
import HttpError from '../errors/HttpError.js';
import NightReport from '../models/NightReport.js';
import { DID_NOT_OPERATE_NOTE } from '../constants/nightReports.js';
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
  toAddonConfig,
} from './counterMetricUtils.js';

const COUNTER_DATE_FORMAT = 'YYYY-MM-DD';
const DEFAULT_PRODUCT_NAME = 'Pub Crawl';

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

function buildChannelConfigs(
  channels: Array<Channel & { paymentMethod?: PaymentMethod | null }>,
  priceByChannel: Map<number, number | null>,
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
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export default class CounterRegistryService {
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

    if (Object.keys(delta).length === 0) {
      const context = await this.buildContext(counter);
      return this.buildPayload(context);
    }

    delta.updatedBy = actorUserId;
    counter.set(delta);
    await counter.save();

    const refreshed = await this.loadCounterById(counterId);
    if (!refreshed) {
      throw new HttpError(404, 'Counter not found after update');
    }

    const context = await this.buildContext(refreshed);
    return this.buildPayload(context);
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

    const assignments: Array<{ user: UserWithRole; role: CounterStaffRole }> = users.map((user) => {
      const roleSlug = getUserRole(user)?.slug ?? '';
      const role = this.resolveStaffRole(roleSlug);
      if (!role) {
        throw new HttpError(
          400,
          `User ${user.id} is not eligible for staff assignment`,
        );
      }
      return { user, role: role as CounterStaffRole };
    });

    await sequelize.transaction(async (transaction) => {
      const existing = await CounterUser.findAll({ where: { counterId }, transaction });
      const existingMap = new Map<number, CounterUser>();
      existing.forEach((record) => existingMap.set(record.userId, record));

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

      type Aggregate = {
        channelId: number;
        kind: MetricKind;
        addonId: number | null;
        beforeQty: number;
        attendedQty: number;
        afterQty: number | null;
      };

      const aggregateByKey = new Map<string, Aggregate>();

      const applyToAggregate = (metric: NormalizedMetric) => {
        if (metric.kind === 'cash_payment') {
          return;
        }
        const aggregateKey = [metric.channelId, metric.kind, metric.addonId ?? 'null'].join('|');
        let aggregate = aggregateByKey.get(aggregateKey);
        if (!aggregate) {
          aggregate = {
            channelId: metric.channelId,
            kind: metric.kind,
            addonId: metric.addonId ?? null,
            beforeQty: 0,
            attendedQty: 0,
            afterQty: null,
          };
          aggregateByKey.set(aggregateKey, aggregate);
        }

        const numericQty = Number(metric.qty) || 0;
        if (metric.tallyType === 'booked') {
          if (metric.period === 'before_cutoff') {
            aggregate.beforeQty = numericQty;
          } else if (metric.period === 'after_cutoff') {
            aggregate.afterQty = numericQty;
          }
        } else if (metric.tallyType === 'attended') {
          aggregate.attendedQty = numericQty;
        }
      };

      existingMetrics.forEach((metric: CounterChannelMetric) => {
        const normalizedPeriod: MetricPeriod =
          metric.tallyType === 'booked'
            ? (metric.period ?? 'before_cutoff')
            : metric.tallyType === 'attended'
            ? null
            : metric.period ?? null;

        applyToAggregate({
          channelId: metric.channelId,
          kind: metric.kind as MetricKind,
          addonId: metric.addonId ?? null,
          tallyType: metric.tallyType as MetricTallyType,
          period: normalizedPeriod,
          qty: Number(metric.qty),
        });
      });

      incomingByKey.forEach((metric: NormalizedMetric) => {
        applyToAggregate(metric);
      });

      aggregateByKey.forEach((aggregate) => {
        const beforeQty = aggregate.beforeQty ?? 0;
        const attendedQty = aggregate.attendedQty ?? 0;
        const diff = Math.max(attendedQty - beforeQty, 0);
        const afterKey = buildMetricKey({
          channelId: aggregate.channelId,
          kind: aggregate.kind,
          addonId: aggregate.addonId,
          tallyType: 'booked',
          period: 'after_cutoff',
        });
        if (diff > 0 || aggregate.afterQty !== null) {
          incomingByKey.set(afterKey, {
            channelId: aggregate.channelId,
            kind: aggregate.kind,
            addonId: aggregate.addonId,
            tallyType: 'booked',
            period: 'after_cutoff',
            qty: diff,
          });
        }
      });

      const rowsToCreate: NormalizedMetric[] = [];
      const rowsToUpdate: Array<{ metric: CounterChannelMetric; row: NormalizedMetric }> = [];
      const rowsToDelete: CounterChannelMetric[] = [];

      incomingByKey.forEach((row: NormalizedMetric, key) => {
        const current = existingByKey.get(key);
        if (!current) {
          rowsToCreate.push(row);
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

    if (targetProductId != null && channels.length > 0) {
      const channelIds = channels.map((channel) => channel.id);
      const priceRecords = await ChannelProductPrice.findAll({
        where: { productId: targetProductId, channelId: channelIds },
        order: [['validFrom', 'DESC']],
      });

      const counterDate = dayjs(counter.date);

      for (const record of priceRecords) {
        if (priceByChannel.has(record.channelId)) {
          continue;
        }
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
        priceByChannel.set(record.channelId, numericPrice);
      }
    }

    const channelConfigs = buildChannelConfigs(
      channels as Array<Channel & { paymentMethod?: PaymentMethod | null }>,
      priceByChannel,
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

    const summary = computeSummary({ metrics: grid, channels, addons });

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


