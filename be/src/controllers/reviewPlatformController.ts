import { Request, Response } from 'express';
import { DataType } from 'sequelize-typescript';
import ReviewPlatform from '../models/ReviewPlatform.js';
import { ErrorWithMessage } from '../types/ErrorWithMessage.js';

const buildColumns = () => {
  const attributes = ReviewPlatform.getAttributes();
  return Object.entries(attributes).map(([key, attribute]) => ({
    header: key.charAt(0).toUpperCase() + key.slice(1),
    accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text',
  }));
};

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const toNumber = (value: unknown, fallback: number): number => {
  if (value == null) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
};

const normalizeUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const sanitizeAliasList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
};

const sanitizePayload = (payload: Record<string, unknown>): Partial<ReviewPlatform> => {
  const next: Partial<ReviewPlatform> & { aliases?: string[] } = {};
  if (typeof payload.name === 'string') {
    next.name = payload.name.trim();
  }
  if (typeof payload.slug === 'string') {
    next.slug = slugify(payload.slug);
  } else if (next.name && !payload.slug) {
    next.slug = slugify(next.name);
  }
  if (typeof payload.description === 'string') {
    next.description = payload.description.trim();
  }
  if (payload.description === null) {
    next.description = null;
  }
  if (payload.isActive != null) {
    next.isActive = Boolean(payload.isActive);
  }
  if (payload.weight != null) {
    const parsedWeight = Math.max(0, toNumber(payload.weight, 1));
    next.weight = parsedWeight === 0 ? 0 : Number(parsedWeight.toFixed(2));
  }
  if ('sourceKey' in payload || 'source_key' in payload) {
    const raw = (payload.sourceKey ?? payload.source_key) as unknown;
    if (typeof raw === 'string') {
      next.sourceKey = raw.trim() || null;
    } else if (raw == null) {
      next.sourceKey = null;
    }
  }
  if ('platformUrl' in payload || 'platform_url' in payload) {
    const normalized = normalizeUrl(payload.platformUrl ?? payload.platform_url);
    next.platformUrl = normalized;
  }
  if ('aliases' in payload) {
    next.aliases = sanitizeAliasList(payload.aliases);
  }
  return next;
};

export const listReviewPlatforms = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await ReviewPlatform.findAll({ order: [['name', 'ASC']] });
    res.status(200).json([{ data: data.map((record) => record.get({ plain: true })), columns: buildColumns() }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const createReviewPlatform = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = sanitizePayload(req.body ?? {});
    if (!payload.name || !payload.slug) {
      res.status(400).json([{ message: 'Name is required' }]);
      return;
    }
    const created = await ReviewPlatform.create(payload);
    res.status(201).json([{ data: [created.get({ plain: true })] }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const updateReviewPlatform = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid id' }]);
      return;
    }
    const payload = sanitizePayload(req.body ?? {});
    const [updated] = await ReviewPlatform.update(payload, { where: { id } });
    if (!updated) {
      res.status(404).json([{ message: 'Review platform not found' }]);
      return;
    }
    const record = await ReviewPlatform.findByPk(id);
    res.status(200).json([{ data: record ? [record.get({ plain: true })] : [] }]);
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};

export const deleteReviewPlatform = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json([{ message: 'Invalid id' }]);
      return;
    }
    const deleted = await ReviewPlatform.destroy({ where: { id } });
    if (!deleted) {
      res.status(404).json([{ message: 'Review platform not found' }]);
      return;
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as ErrorWithMessage).message }]);
  }
};
