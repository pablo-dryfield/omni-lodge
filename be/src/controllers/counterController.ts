import { Response } from 'express';
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
import NightReport from '../models/NightReport.js';
import NightReportPhoto from '../models/NightReportPhoto.js';
import NightReportVenue from '../models/NightReportVenue.js';
import { deleteNightReportPhoto as removeNightReportFile } from '../services/nightReportStorageService.js';

const REGISTRY_FORMAT = 'registry';

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


