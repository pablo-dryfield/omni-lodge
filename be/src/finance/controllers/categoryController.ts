import { Request, Response } from 'express';
import { Op } from 'sequelize';
import FinanceCategory from '../models/FinanceCategory.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

export const listCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const kind = req.query.kind?.toString();
    const onlyActive = (req.query.active ?? '').toString().toLowerCase() === 'true';
    const categories = await FinanceCategory.findAll({
      where: {
        ...(kind ? { kind } : {}),
        ...(onlyActive ? { isActive: true } : {}),
      },
      order: [
        ['kind', 'ASC'],
        ['parentId', 'ASC'],
        ['name', 'ASC'],
      ],
    });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const searchCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.q?.toString() ?? '';
    const categories = await FinanceCategory.findAll({
      where: {
        name: { [Op.iLike]: `%${query}%` },
      },
      order: [['name', 'ASC']],
      limit: 25,
    });
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const getCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const category = await FinanceCategory.findByPk(req.params.id);
    if (!category) {
      res.status(404).json([{ message: 'Category not found' }]);
      return;
    }
    res.status(200).json(category);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const category = await FinanceCategory.create(req.body);
    await recordFinanceAuditLog({
      entity: 'finance_category',
      entityId: category.id,
      action: 'create',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
      changes: category.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const updateCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const [count] = await FinanceCategory.update(req.body, { where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Category not found' }]);
      return;
    }
    const updated = await FinanceCategory.findByPk(req.params.id);
    if (updated) {
      await recordFinanceAuditLog({
        entity: 'finance_category',
        entityId: updated.id,
        action: 'update',
        performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
        changes: req.body,
      });
    }
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FinanceCategory.destroy({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Category not found' }]);
      return;
    }
    await recordFinanceAuditLog({
      entity: 'finance_category',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

