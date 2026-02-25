import { Response } from 'express';
import { Op } from 'sequelize';
import { DataType } from 'sequelize-typescript';
import CounterRegistryService, {
  type CounterRegistryPayload,
  type MetricInput,
} from '../services/counterRegistryService.js';
import HttpError from '../errors/HttpError.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import logger from '../utils/logger.js';
import Counter from '../models/Counter.js';
import CounterProduct from '../models/CounterProduct.js';
import CounterUser from '../models/CounterUser.js';
import User from '../models/User.js';
import Product from '../models/Product.js';
import CounterChannelMetric from '../models/CounterChannelMetric.js';
import Booking from '../models/Booking.js';
import NightReport from '../models/NightReport.js';
import NightReportPhoto from '../models/NightReportPhoto.js';
import NightReportVenue from '../models/NightReportVenue.js';
import { deleteNightReportPhoto as removeNightReportFile } from '../services/nightReportStorageService.js';
import { type BookingAttendanceStatus, type BookingStatus } from '../constants/bookings.js';

const REGISTRY_FORMAT = 'registry';
const DEFAULT_ATTENDANCE_STATUS: BookingAttendanceStatus = 'pending';
const CHECKIN_ALLOWED_STATUSES = new Set<BookingStatus>(['pending', 'confirmed', 'amended', 'completed']);

type BookingAttendanceExtras = {
  tshirts: number;
  cocktails: number;
  photos: number;
};

type AttendanceUpdateInput = {
  bookingId: number;
  attendedTotal?: number;
  attendedExtras?: Partial<BookingAttendanceExtras>;
};

function requireActorId(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return actorId;
}

function resolveFormat(req: AuthenticatedRequest): string {
  const body = (req.body ?? {}) as { format?: unknown };
  const raw =
    (req.query.format ?? req.query.view ?? (typeof body.format === 'string' ? body.format : '') ?? '').toString();
  return raw.toLowerCase();
}

function buildCounterColumns() {
  const attributes = Counter.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
}

async function fetchTableCounters(where: Record<string, unknown> = {}) {
  return Counter.findAll({
    where,
    include: [
      { model: User, as: 'manager', attributes: ['id', 'firstName', 'lastName'] },
      { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
      { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
      { model: Product, as: 'product', attributes: ['id', 'name'] },
    ],
    order: [['date', 'DESC']],
  });
}

function parseBodyAsArray(payload: unknown): MetricInput[] {
  if (!Array.isArray(payload)) {
    throw new HttpError(400, 'Metrics payload must be an array');
  }

  return payload.map((item) => {
    const typed = item as Partial<MetricInput>;
    if (typeof typed.channelId !== 'number') {
      throw new HttpError(400, 'channelId is required for each metric');
    }
    if (typeof typed.kind !== 'string') {
      throw new HttpError(400, 'kind is required for each metric');
    }
    if (typeof typed.tallyType !== 'string') {
      throw new HttpError(400, 'tallyType is required for each metric');
    }
    if (typeof typed.qty !== 'number') {
      throw new HttpError(400, 'qty is required for each metric');
    }

    return {
      channelId: Number(typed.channelId),
      kind: typed.kind,
      addonId: typed.addonId == null ? null : Number(typed.addonId),
      tallyType: typed.tallyType,
      period: (typed.period ?? null) as MetricInput['period'],
      qty: Number(typed.qty),
    } satisfies MetricInput;
  });
}

function normalizeBookingExtras(snapshot: unknown): BookingAttendanceExtras {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  const extras = (snapshot as { extras?: Partial<BookingAttendanceExtras> }).extras;
  if (!extras) {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Number(extras.tshirts) || 0,
    cocktails: Number(extras.cocktails) || 0,
    photos: Number(extras.photos) || 0,
  };
}

function normalizeAttendedExtras(snapshot: unknown): BookingAttendanceExtras {
  if (!snapshot || typeof snapshot !== 'object') {
    return { tshirts: 0, cocktails: 0, photos: 0 };
  }
  return {
    tshirts: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).tshirts) || 0)),
    cocktails: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).cocktails) || 0)),
    photos: Math.max(0, Math.round(Number((snapshot as Record<string, unknown>).photos) || 0)),
  };
}

function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) {
    return min;
  }
  return Math.min(Math.max(rounded, min), max);
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

function resolveCheckInAllowance(booking: Booking): number {
  return CHECKIN_ALLOWED_STATUSES.has(booking.status as BookingStatus) ? deriveBookingPartySize(booking) : 0;
}

function resolveAttendanceStatus(
  booking: Booking,
  attendedTotal: number,
  hasAttendedExtrasValue: boolean,
  options: { markNoShowWhenAbsent?: boolean } = {},
): BookingAttendanceStatus {
  const allowance = resolveCheckInAllowance(booking);
  if (allowance <= 0) {
    return DEFAULT_ATTENDANCE_STATUS;
  }
  const normalizedAttendedTotal = clampInt(attendedTotal, 0, allowance);
  if (normalizedAttendedTotal >= allowance) {
    return 'checked_in_full';
  }
  if (normalizedAttendedTotal > 0 || hasAttendedExtrasValue) {
    return 'checked_in_partial';
  }
  if (options.markNoShowWhenAbsent) {
    return 'no_show';
  }
  return DEFAULT_ATTENDANCE_STATUS;
}

function parseAttendanceUpdates(payload: unknown): AttendanceUpdateInput[] {
  if (payload === undefined || payload === null) {
    return [];
  }
  if (!Array.isArray(payload)) {
    throw new HttpError(400, 'attendanceUpdates must be an array');
  }
  if (payload.length > 500) {
    throw new HttpError(400, 'attendanceUpdates must contain at most 500 rows');
  }

  return payload.map((item) => {
    const typed = (item ?? {}) as {
      bookingId?: unknown;
      attendedTotal?: unknown;
      attendedExtras?: unknown;
    };
    const bookingId = Number(typed.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      throw new HttpError(400, 'attendanceUpdates[].bookingId must be a positive integer');
    }

    const hasAttendedTotal = Object.prototype.hasOwnProperty.call(typed, 'attendedTotal');
    const hasAttendedExtras = Object.prototype.hasOwnProperty.call(typed, 'attendedExtras');
    if (!hasAttendedTotal && !hasAttendedExtras) {
      throw new HttpError(
        400,
        'Each attendance update must include attendedTotal or attendedExtras',
      );
    }

    const update: AttendanceUpdateInput = { bookingId };

    if (hasAttendedTotal) {
      const parsed = Number(typed.attendedTotal);
      if (!Number.isFinite(parsed)) {
        throw new HttpError(400, 'attendanceUpdates[].attendedTotal must be a number');
      }
      update.attendedTotal = parsed;
    }

    if (hasAttendedExtras) {
      if (!typed.attendedExtras || typeof typed.attendedExtras !== 'object') {
        throw new HttpError(400, 'attendanceUpdates[].attendedExtras must be an object');
      }
      const extrasInput = typed.attendedExtras as Record<string, unknown>;
      const nextExtras: Partial<BookingAttendanceExtras> = {};
      (['tshirts', 'cocktails', 'photos'] as const).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(extrasInput, key)) {
          return;
        }
        const parsed = Number(extrasInput[key]);
        if (!Number.isFinite(parsed)) {
          throw new HttpError(400, `attendanceUpdates[].attendedExtras.${key} must be a number`);
        }
        nextExtras[key] = parsed;
      });
      update.attendedExtras = nextExtras;
    }

    return update;
  });
}

async function applyBookingAttendanceUpdate(
  booking: Booking,
  update: AttendanceUpdateInput,
  actorId: number,
): Promise<void> {
  const allowance = resolveCheckInAllowance(booking);

  const currentAttended = Number(booking.attendedTotal ?? 0);
  let nextAttendedTotal = Number.isFinite(currentAttended) ? Math.max(0, Math.round(currentAttended)) : 0;
  if (update.attendedTotal !== undefined) {
    nextAttendedTotal = clampInt(Number(update.attendedTotal), 0, allowance);
  } else {
    nextAttendedTotal = clampInt(nextAttendedTotal, 0, allowance);
  }

  const purchasedExtras = normalizeBookingExtras(booking.addonsSnapshot ?? undefined);
  const nextAttendedExtras = normalizeAttendedExtras(booking.attendedAddonsSnapshot ?? undefined);
  if (update.attendedExtras) {
    (['tshirts', 'cocktails', 'photos'] as const).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(update.attendedExtras as object, key)) {
        return;
      }
      const parsed = Number(update.attendedExtras?.[key]);
      if (!Number.isFinite(parsed)) {
        throw new HttpError(400, `attendedExtras.${key} must be a number`);
      }
      const purchased = Math.max(0, Math.round(Number(purchasedExtras[key]) || 0));
      nextAttendedExtras[key] = clampInt(parsed, 0, purchased);
    });
  }

  booking.attendedTotal = nextAttendedTotal;
  const hasAttendedExtrasValue =
    nextAttendedExtras.tshirts > 0 ||
    nextAttendedExtras.cocktails > 0 ||
    nextAttendedExtras.photos > 0;
  booking.attendedAddonsSnapshot = hasAttendedExtrasValue ? nextAttendedExtras : null;
  const nextAttendanceStatus = resolveAttendanceStatus(booking, nextAttendedTotal, hasAttendedExtrasValue);
  booking.attendanceStatus = nextAttendanceStatus;

  const hasAttendance = nextAttendanceStatus === 'checked_in_full' || nextAttendanceStatus === 'checked_in_partial';
  booking.checkedInAt = hasAttendance ? new Date() : null;
  booking.checkedInBy = hasAttendance ? (actorId ?? booking.checkedInBy ?? null) : null;
  booking.updatedBy = actorId;

  await booking.save();
}

function handleError(res: Response, error: unknown): void {
  if (error instanceof HttpError) {
    const payload: Record<string, unknown> = { message: error.message };
    if (error.details !== undefined) {
      payload.details = error.details;
    }
    res.status(error.status).json(payload);
    return;
  }

  logger.error('Counter controller error', error);
  res.status(500).json({ message: 'Internal server error' });
}

export const createOrLoadCounter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const format = resolveFormat(req);

  if (format !== REGISTRY_FORMAT) {
    try {
      const newCounter = await Counter.create(req.body);
      res.status(201).json([newCounter]);
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Failed to create counter';
      res.status(500).json([{ message }]);
    }
    return;
  }

  try {
    const actorId = requireActorId(req);
    const body = (req.body ?? {}) as {
      date?: string;
      userId?: number;
      productId?: number | null;
      notes?: string | null;
    };

    const payload = await CounterRegistryService.findOrCreateCounter(
      {
        date: body.date ?? '',
        userId: body.userId ?? actorId,
        productId: body.productId ?? null,
        notes: body.notes ?? null,
      },
      actorId,
    );

    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const getCounterByDate = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const format = resolveFormat(req);

  if (format !== REGISTRY_FORMAT) {
    try {
      const where: Record<string, unknown> = {};
      if (typeof req.query.date === 'string' && req.query.date.trim()) {
        where.date = req.query.date;
      }
      const data = await fetchTableCounters(where);
      res.status(200).json([{ data, columns: buildCounterColumns() }]);
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Failed to fetch counters';
      res.status(500).json([{ message }]);
    }
    return;
  }

  try {
    const date = req.query.date;
    if (typeof date !== 'string') {
      throw new HttpError(400, 'date query parameter is required');
    }

    const productIdParam = req.query.productId;
    let productId: number | null | undefined = undefined;
    if (productIdParam !== undefined) {
      if (Array.isArray(productIdParam)) {
        throw new HttpError(400, 'productId query parameter must be a single value');
      }
      if (typeof productIdParam !== 'string') {
        throw new HttpError(400, 'productId query parameter must be a single value');
      }
      const trimmed = productIdParam.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'null') {
        productId = null;
      } else {
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new HttpError(400, 'Invalid productId');
        }
        productId = parsed;
      }
    }

    const payload = await CounterRegistryService.getCounterByDate(date, productId);
    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const getCounterById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const format = resolveFormat(req);

  if (format !== REGISTRY_FORMAT) {
    try {
      const { id } = req.params;
      const data = await Counter.findByPk(id, {
        include: [
          { model: User, as: 'manager', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
        ],
      });

      if (!data) {
        res.status(404).json([{ message: 'Counter not found' }]);
        return;
      }

      res.status(200).json([{ data, columns: buildCounterColumns() }]);
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Failed to fetch counter';
      res.status(500).json([{ message }]);
    }
    return;
  }

  try {
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'Invalid counter id');
    }

    const payload = await CounterRegistryService.getCounterById(counterId);
    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const updateCounter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const format = resolveFormat(req);

  if (format !== REGISTRY_FORMAT) {
    try {
      const { id } = req.params;
      const [updated] = await Counter.update(req.body, { where: { id } });

      if (!updated) {
        res.status(404).json([{ message: 'Counter not found' }]);
        return;
      }

      const updatedCounter = await Counter.findByPk(id);
      res.status(200).json([updatedCounter]);
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Failed to update counter';
      res.status(500).json([{ message }]);
    }
    return;
  }

  try {
    const actorId = requireActorId(req);
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'Invalid counter id');
    }

    const body = (req.body ?? {}) as { status?: string; notes?: string | null };

    const payload = await CounterRegistryService.updateCounterMetadata(counterId, body, actorId);
    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteCounter = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const counterId = Number(id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'Invalid counter id');
    }
    const actorId = req.authContext?.id ?? null;

    const counter = await Counter.findByPk(counterId, {
      attributes: ['id', 'date', 'productId'],
    });
    if (!counter) {
      res.status(404).json([{ message: 'Counter not found' }]);
      return;
    }

    const sequelize = Counter.sequelize;
    if (!sequelize) {
      throw new HttpError(500, 'Database connection is not available');
    }

    const reports = await NightReport.findAll({
      where: { counterId },
      include: [{ model: NightReportPhoto, as: 'photos', attributes: ['id', 'storagePath'] }],
    });
    const reportIds = reports.map((report) => report.id);
    const photoStoragePaths = reports.flatMap((report) =>
      (report.photos ?? []).map((photo) => photo.storagePath),
    );

    let deleted = 0;
    await sequelize.transaction(async (transaction) => {
      await Booking.update(
        {
          attendedTotal: null,
          attendanceStatus: DEFAULT_ATTENDANCE_STATUS,
          attendedAddonsSnapshot: null,
          checkedInAt: null,
          checkedInBy: null,
          updatedBy: actorId,
        },
        {
          where: {
            experienceDate: counter.date,
            productId: counter.productId ?? null,
          },
          transaction,
        },
      );

      if (reportIds.length > 0) {
        await NightReportVenue.destroy({ where: { reportId: reportIds }, transaction });
        await NightReportPhoto.destroy({ where: { reportId: reportIds }, transaction });
        await NightReport.destroy({ where: { id: reportIds }, transaction });
      }
      await CounterChannelMetric.destroy({ where: { counterId }, transaction });
      await CounterUser.destroy({ where: { counterId }, transaction });
      await CounterProduct.destroy({ where: { counterId }, transaction });
      deleted = await Counter.destroy({ where: { id: counterId }, transaction });
    });

    if (!deleted) {
      res.status(404).json([{ message: 'Counter not found' }]);
      return;
    }

    await Promise.all(
      photoStoragePaths.map((storagePath) =>
        removeNightReportFile(storagePath).catch((error) => {
          logger.warn(`Failed to remove night report photo at ${storagePath}`, error);
        }),
      ),
    );

    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
};

export const upsertCounterSetup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (resolveFormat(req) !== REGISTRY_FORMAT) {
    res.status(400).json({ message: 'Counter setup updates require registry format' });
    return;
  }

  try {
    const actorId = requireActorId(req);
    const body = (req.body ?? {}) as {
      date?: string;
      userId?: number;
      productId?: number | null;
      notes?: string | null;
      staffIds?: number[];
      status?: string;
    };

    if (!body.date || typeof body.date !== 'string') {
      throw new HttpError(400, 'date is required');
    }

    const userId = Number(body.userId ?? actorId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new HttpError(400, 'Invalid manager id');
    }

    let payload: CounterRegistryPayload = await CounterRegistryService.findOrCreateCounter(
      {
        date: body.date,
        userId,
        productId: body.productId ?? null,
        notes: body.notes ?? null,
      },
      actorId,
    );

    const counterId = payload.counter?.id ?? null;
    if (!counterId) {
      throw new HttpError(404, 'Counter not found after setup');
    }

    if (Array.isArray(body.staffIds)) {
      payload = await CounterRegistryService.updateCounterStaff(counterId, body.staffIds, actorId);
    }

    if (body.status) {
      payload = await CounterRegistryService.updateCounterMetadata(
        counterId,
        { status: body.status },
        actorId,
      );
    }

    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const updateCounterStaff = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (resolveFormat(req) !== REGISTRY_FORMAT) {
      throw new HttpError(400, 'Counter staff updates require registry format');
    }

    const actorId = requireActorId(req);
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'Invalid counter id');
    }

    const rawIds = Array.isArray(req.body?.userIds) ? (req.body.userIds as unknown[]) : [];
    const userIds = rawIds.map((value) => {
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new HttpError(400, 'userIds must contain positive integers');
      }
      return parsed;
    });

    const payload = await CounterRegistryService.updateCounterStaff(counterId, userIds, actorId);
    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const commitCounterRegistry = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (resolveFormat(req) !== REGISTRY_FORMAT) {
      throw new HttpError(400, 'Counter registry commit requires registry format');
    }

    const actorId = requireActorId(req);
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'Invalid counter id');
    }

    const body = (req.body ?? {}) as {
      metrics?: unknown;
      status?: string;
      notes?: string | null;
    };

    if (body.metrics !== undefined) {
      const rows = parseBodyAsArray(body.metrics);
      await CounterRegistryService.upsertMetrics(counterId, rows, actorId);
    }

    const metadataUpdates: { status?: string; notes?: string | null } = {};
    if (body.status) {
      metadataUpdates.status = body.status;
    }
    if (body.notes !== undefined) {
      metadataUpdates.notes = body.notes ?? null;
    }

    let payload;
    if (Object.keys(metadataUpdates).length > 0) {
      payload = await CounterRegistryService.updateCounterMetadata(counterId, metadataUpdates, actorId);
    } else {
      payload = await CounterRegistryService.getCounterById(counterId);
    }

    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const finalizeCounterReservations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (resolveFormat(req) !== REGISTRY_FORMAT) {
      throw new HttpError(400, 'Counter finalization requires registry format');
    }

    const actorId = requireActorId(req);
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'Invalid counter id');
    }

    const body = (req.body ?? {}) as {
      attendanceUpdates?: unknown;
      metrics?: unknown;
      status?: string;
      notes?: string | null;
    };

    const attendanceUpdates = parseAttendanceUpdates(body.attendanceUpdates);
    if (attendanceUpdates.length > 0) {
      const bookingIds = Array.from(new Set(attendanceUpdates.map((row) => row.bookingId)));
      const bookings = await Booking.findAll({
        where: { id: { [Op.in]: bookingIds } },
      });
      const bookingById = new Map<number, Booking>();
      bookings.forEach((booking) => bookingById.set(booking.id, booking));

      for (const update of attendanceUpdates) {
        const booking = bookingById.get(update.bookingId);
        if (!booking) {
          throw new HttpError(404, `Booking ${update.bookingId} not found`);
        }
        await applyBookingAttendanceUpdate(booking, update, actorId);
      }
    }

    if (body.metrics !== undefined) {
      const rows = parseBodyAsArray(body.metrics);
      await CounterRegistryService.upsertMetrics(counterId, rows, actorId);
    }

    const metadataUpdates: { status?: string; notes?: string | null } = {};
    if (body.status) {
      metadataUpdates.status = body.status;
    }
    if (body.notes !== undefined) {
      metadataUpdates.notes = body.notes ?? null;
    }

    const payload =
      Object.keys(metadataUpdates).length > 0
        ? await CounterRegistryService.updateCounterMetadata(counterId, metadataUpdates, actorId)
        : await CounterRegistryService.getCounterById(counterId);

    res.status(200).json(payload);
  } catch (error) {
    handleError(res, error);
  }
};

export const upsertCounterMetrics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (resolveFormat(req) !== REGISTRY_FORMAT) {
      throw new HttpError(400, 'Counter metrics updates require registry format');
    }

    const actorId = requireActorId(req);
    const counterId = Number(req.params.id);
    if (!Number.isInteger(counterId) || counterId <= 0) {
      throw new HttpError(400, 'Invalid counter id');
    }

    const rows = parseBodyAsArray(req.body);
    const result = await CounterRegistryService.upsertMetrics(counterId, rows, actorId);
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error);
  }
};


