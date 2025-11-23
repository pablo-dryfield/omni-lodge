import type { Request, Response } from 'express';
import dayjs from 'dayjs';
import type { Includeable } from 'sequelize';
import { DataType } from 'sequelize-typescript';
import VenueCompensationTerm, { type VenueCompensationTermWithRelations } from '../models/VenueCompensationTerm.js';
import Venue from '../models/Venue.js';
import User from '../models/User.js';
import HttpError from '../errors/HttpError.js';
import { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const termIncludes: Includeable[] = [
  { model: Venue, as: 'venue', attributes: ['id', 'name', 'allowsOpenBar'] },
  { model: User, as: 'createdByUser', attributes: ['id', 'firstName', 'lastName'] },
  { model: User, as: 'updatedByUser', attributes: ['id', 'firstName', 'lastName'] },
];

const buildColumns = () => {
  const attributes = VenueCompensationTerm.getAttributes();
  const base = Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));

  return base.concat([
    { header: 'Venue Name', accessorKey: 'venueName', type: 'text' },
    { header: 'Created By', accessorKey: 'createdByName', type: 'text' },
    { header: 'Updated By', accessorKey: 'updatedByName', type: 'text' },
  ]);
};

const normalizeCurrencyCode = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'USD';
  }
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    throw new HttpError(400, 'currencyCode must be a 3-letter code');
  }
  return trimmed;
};

const normalizeDate = (value: unknown, field: string, { required }: { required: boolean }): string | null => {
  if (value == null || value === '') {
    if (required) {
      throw new HttpError(400, `${field} is required`);
    }
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string in YYYY-MM-DD format`);
  }
  const parsed = dayjs(value, 'YYYY-MM-DD', true);
  if (!parsed.isValid()) {
    throw new HttpError(400, `${field} must be in YYYY-MM-DD format`);
  }
  return parsed.format('YYYY-MM-DD');
};

type SanitizeOptions = {
  partial?: boolean;
};

const sanitizeTermPayload = (raw: Record<string, unknown> | undefined, options: SanitizeOptions = {}) => {
  const payload = raw ?? {};
  const partial = options.partial === true;
  const next: Record<string, unknown> = {};

  if (!partial || payload.venueId !== undefined) {
    const venueId = Number(payload.venueId);
    if (!Number.isInteger(venueId) || venueId <= 0) {
      throw new HttpError(400, 'venueId must be a positive integer');
    }
    next.venueId = venueId;
  }

  if (!partial || payload.compensationType !== undefined) {
    const rawType = typeof payload.compensationType === 'string' ? payload.compensationType.trim().toLowerCase() : '';
    if (rawType !== 'open_bar' && rawType !== 'commission') {
      throw new HttpError(400, 'compensationType must be "open_bar" or "commission"');
    }
    next.compensationType = rawType;
    next.direction = rawType === 'open_bar' ? 'payable' : 'receivable';
  }

  if (!partial || payload.rateAmount !== undefined || payload.rate !== undefined) {
    const candidate = payload.rateAmount ?? payload.rate;
    const rate = Number(candidate);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new HttpError(400, 'rateAmount must be a non-negative number');
    }
    next.rateAmount = rate;
  }

  if (!partial || payload.rateUnit !== undefined) {
    const rawUnit = typeof payload.rateUnit === 'string' ? payload.rateUnit.trim().toLowerCase() : '';
    next.rateUnit = rawUnit === 'flat' ? 'flat' : 'per_person';
  }

  if (!partial || payload.currencyCode !== undefined) {
    next.currencyCode = normalizeCurrencyCode(payload.currencyCode);
  }

  if (!partial || payload.validFrom !== undefined) {
    next.validFrom = normalizeDate(payload.validFrom, 'validFrom', { required: true });
  }

  if (payload.validTo !== undefined) {
    next.validTo = normalizeDate(payload.validTo, 'validTo', { required: false });
  } else if (!partial) {
    next.validTo = null;
  }

  if (!partial || payload.isActive !== undefined) {
    if (payload.isActive === undefined) {
      next.isActive = true;
    } else {
      next.isActive = typeof payload.isActive === 'boolean' ? payload.isActive : Boolean(payload.isActive);
    }
  }

  if (!partial || payload.notes !== undefined) {
    if (payload.notes == null) {
      next.notes = null;
    } else if (typeof payload.notes === 'string') {
      next.notes = payload.notes;
    } else {
      throw new HttpError(400, 'notes must be a string or null');
    }
  }

  return next;
};

const serializeTerm = (record: VenueCompensationTermWithRelations) => {
  const plain = record.get({ plain: true }) as Record<string, unknown>;
  const createdByName = record.createdByUser
    ? `${record.createdByUser.firstName ?? ''} ${record.createdByUser.lastName ?? ''}`.trim()
    : null;
  const updatedByName = record.updatedByUser
    ? `${record.updatedByUser.firstName ?? ''} ${record.updatedByUser.lastName ?? ''}`.trim()
    : null;

  return {
    ...plain,
    venueName: record.venue?.name ?? null,
    createdByName,
    updatedByName,
  };
};

const ensureVenueCompatibility = async (venueId: number | null | undefined, compensationType: string | undefined) => {
  if (!venueId) {
    return;
  }
  const venue = await Venue.findByPk(venueId);
  if (!venue) {
    throw new HttpError(404, 'Venue not found');
  }
  if (compensationType === 'open_bar' && venue.allowsOpenBar !== true) {
    throw new HttpError(400, `Venue "${venue.name}" is not marked as open-bar eligible`);
  }
};

type DateRangeFallback = {
  validFrom?: string | null;
  validTo?: string | null;
};

const ensureValidDateRange = (payload: Record<string, unknown>, fallback?: DateRangeFallback) => {
  const fromValue = payload.validFrom ?? fallback?.validFrom ?? null;
  const toValue = payload.validTo ?? fallback?.validTo ?? null;
  if (!fromValue || !toValue) {
    return;
  }
  const from = dayjs(String(fromValue), 'YYYY-MM-DD', true);
  const to = dayjs(String(toValue), 'YYYY-MM-DD', true);
  if (from.isValid() && to.isValid() && to.isBefore(from)) {
    throw new HttpError(400, 'validTo must be on or after validFrom');
  }
};

export const listVenueCompensationTerms = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (typeof req.query.venueId === 'string' && req.query.venueId.trim() !== '') {
      where.venueId = Number(req.query.venueId);
    }
    if (typeof req.query.active === 'string' && req.query.active.trim().toLowerCase() === 'true') {
      where.isActive = true;
    }
    if (typeof req.query.type === 'string' && req.query.type.trim() !== '') {
      where.compensationType = req.query.type.trim().toLowerCase();
    }

    const records = await VenueCompensationTerm.findAll({
      where,
      include: termIncludes,
      order: [
        ['venueId', 'ASC'],
        ['compensationType', 'ASC'],
        ['validFrom', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    const data = records.map((record) => serializeTerm(record as VenueCompensationTermWithRelations));
    res.status(200).json([
      {
        data,
        columns: buildColumns(),
      },
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch venue compensation terms';
    res.status(error instanceof HttpError ? error.status : 500).json([{ message }]);
  }
};

export const createVenueCompensationTerm = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    const payload = sanitizeTermPayload(req.body, { partial: false });
    ensureValidDateRange(payload);
    await ensureVenueCompatibility(Number(payload.venueId), payload.compensationType as string | undefined);

    const record = await VenueCompensationTerm.create({
      ...payload,
      direction: payload.direction ?? (payload.compensationType === 'open_bar' ? 'payable' : 'receivable'),
      createdBy: actorId,
      updatedBy: actorId,
    });

    const withRelations = await VenueCompensationTerm.findByPk(record.id, { include: termIncludes });
    if (!withRelations) {
      res.status(201).json([record]);
      return;
    }

    res.status(201).json([serializeTerm(withRelations as VenueCompensationTermWithRelations)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to create venue compensation term';
    res.status(500).json([{ message }]);
  }
};

export const updateVenueCompensationTerm = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actorId = req.authContext?.id ?? null;
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'id is required');
    }
    const existing = await VenueCompensationTerm.findByPk(id);
    if (!existing) {
      res.status(404).json([{ message: 'Venue compensation term not found' }]);
      return;
    }
    const payload = sanitizeTermPayload(req.body, { partial: true });
    ensureValidDateRange(payload, { validFrom: existing.validFrom, validTo: existing.validTo });

    const venueIdForValidation =
      (typeof payload.venueId === 'number' ? payload.venueId : null) ?? existing.venueId ?? null;
    const typeForValidation =
      (typeof payload.compensationType === 'string' ? (payload.compensationType as string) : undefined) ??
      existing.compensationType;
    await ensureVenueCompatibility(venueIdForValidation, typeForValidation);

    if (Object.keys(payload).length === 0) {
      res.status(200).json([{ message: 'No changes applied' }]);
      return;
    }

    payload.updatedBy = actorId;

    const [updated] = await VenueCompensationTerm.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Venue compensation term not found' }]);
      return;
    }

    const record = await VenueCompensationTerm.findByPk(id, { include: termIncludes });
    if (!record) {
      res.status(404).json([{ message: 'Venue compensation term not found' }]);
      return;
    }

    res.status(200).json([serializeTerm(record as VenueCompensationTermWithRelations)]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to update venue compensation term';
    res.status(500).json([{ message }]);
  }
};

export const deleteVenueCompensationTerm = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      throw new HttpError(400, 'id is required');
    }
    const deleted = await VenueCompensationTerm.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Venue compensation term not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    const message = error instanceof Error ? error.message : 'Failed to delete venue compensation term';
    res.status(500).json([{ message }]);
  }
};
