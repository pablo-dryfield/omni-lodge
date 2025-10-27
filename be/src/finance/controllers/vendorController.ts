import { Request, Response } from 'express';
import { Op } from 'sequelize';
import FinanceVendor from '../models/FinanceVendor.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

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
    const vendor = await FinanceVendor.create(req.body);
    await recordFinanceAuditLog({
      entity: 'finance_vendor',
      entityId: vendor.id,
      action: 'create',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
      changes: vendor.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(vendor);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const updateVendor = async (req: Request, res: Response): Promise<void> => {
  try {
    const [count] = await FinanceVendor.update(req.body, { where: { id: req.params.id } });
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
        changes: req.body,
      });
    }
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
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

