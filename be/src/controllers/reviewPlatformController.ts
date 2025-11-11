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

const sanitizePayload = (payload: Partial<ReviewPlatform>) => {
  const next: Partial<ReviewPlatform> = {};
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
