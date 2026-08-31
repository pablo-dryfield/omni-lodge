import { Request, Response } from 'express';
import { Op } from 'sequelize';
import HttpError from '../../errors/HttpError.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceVendor from '../models/FinanceVendor.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const validateDefaultCategoryId = async (value: unknown): Promise<number | null> => {
  if (value === null) {
    return null;
  }

  if (
    (typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && !value.trim())
  ) {
    throw new HttpError(400, 'defaultCategoryId must be a positive integer or null.');
  }

  const categoryId = Number(value);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
    throw new HttpError(400, 'defaultCategoryId must be a positive integer or null.');
  }

  const category = await FinanceCategory.findByPk(categoryId, {
    attributes: ['id', 'kind'],
  });
  if (!category) {
    throw new HttpError(400, 'Default category was not found.');
  }
  if (category.kind !== 'expense') {
    throw new HttpError(400, 'A vendor default category must be an expense category.');
  }

  return categoryId;
};

const prepareVendorChanges = async (
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const changes = { ...body };
  if (hasOwn(body, 'defaultCategoryId')) {
    changes.defaultCategoryId = await validateDefaultCategoryId(body.defaultCategoryId);
  }
  return changes;
};

const handleVendorError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message }]);
    return;
  }
  res.status(500).json([{ message: (error as Error).message }]);
};

export const listVendors = async (req: Request, res: Response): Promise<void> => {
  try {
    const onlyActive = (req.query.active ?? '').toString().toLowerCase() === 'true';
    const vendors = await FinanceVendor.findAll({
      where: onlyActive ? { isActive: true } : undefined,
      order: [['name', 'ASC']],
    });
    res.status(200).json(vendors);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const searchVendors = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q?.toString() ?? '';
    const vendors = await FinanceVendor.findAll({
      where: {
        name: { [Op.iLike]: `%${query}%` },
      },
      order: [['name', 'ASC']],
      limit: 25,
    });
    res.status(200).json(vendors);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const getVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const vendor = await FinanceVendor.findByPk(req.params.id);
    if (!vendor) {
      res.status(404).json([{ message: 'Vendor not found' }]);
      return;
    }
    res.status(200).json(vendor);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const changes = await prepareVendorChanges(req.body as Record<string, unknown>);
    const vendor = await FinanceVendor.create(changes);
    await recordFinanceAuditLog({
      entity: 'finance_vendor',
      entityId: vendor.id,
      action: 'create',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
      changes: vendor.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(vendor);
  } catch (error) {
    handleVendorError(res, error);
  }
};

export const updateVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const changes = await prepareVendorChanges(req.body as Record<string, unknown>);
    const [count] = await FinanceVendor.update(changes, { where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Vendor not found' }]);
      return;
    }
    const updated = await FinanceVendor.findByPk(req.params.id);
    if (updated) {
      await recordFinanceAuditLog({
        entity: 'finance_vendor',
        entityId: updated.id,
        action: 'update',
        performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
        changes,
      });
    }
    res.status(200).json(updated);
  } catch (error) {
    handleVendorError(res, error);
  }
};

export const deleteVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FinanceVendor.destroy({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Vendor not found' }]);
      return;
    }
    await recordFinanceAuditLog({
      entity: 'finance_vendor',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};
