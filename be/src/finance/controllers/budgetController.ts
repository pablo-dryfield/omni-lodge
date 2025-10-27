import { Request, Response } from 'express';
import FinanceBudget from '../models/FinanceBudget.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

export const listBudgets = async (req: Request, res: Response): Promise<void> => {
  try {
    const period = req.query.period?.toString();
    const budgets = await FinanceBudget.findAll({
      where: period ? { period } : undefined,
      order: [
        ['period', 'DESC'],
        ['categoryId', 'ASC'],
      ],
    });
    res.status(200).json(budgets);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const getBudget = async (req: Request, res: Response): Promise<void> => {
  try {
    const budget = await FinanceBudget.findByPk(req.params.id);
    if (!budget) {
      res.status(404).json([{ message: 'Budget not found' }]);
      return;
    }
    res.status(200).json(budget);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createBudget = async (req: Request, res: Response): Promise<void> => {
  try {
    const budget = await FinanceBudget.create(req.body);
    await recordFinanceAuditLog({
      entity: 'finance_budget',
      entityId: budget.id,
      action: 'create',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
      changes: budget.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(budget);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const updateBudget = async (req: Request, res: Response): Promise<void> => {
  try {
    const [count] = await FinanceBudget.update(req.body, { where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Budget not found' }]);
      return;
    }
    const updated = await FinanceBudget.findByPk(req.params.id);
    if (updated) {
      await recordFinanceAuditLog({
        entity: 'finance_budget',
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

export const deleteBudget = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FinanceBudget.destroy({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Budget not found' }]);
      return;
    }
    await recordFinanceAuditLog({
      entity: 'finance_budget',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

