import { Request, Response } from 'express';
import FinanceRecurringRule from '../models/FinanceRecurringRule.js';
import { executeRecurringRules } from '../services/recurringRuleService.js';
import { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

function requireActor(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new Error('Missing authenticated user');
  }
  return actorId;
}

export const listRecurringRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const rules = await FinanceRecurringRule.findAll({
      order: [['createdAt', 'DESC']],
    });
    res.status(200).json(rules);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const getRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const rule = await FinanceRecurringRule.findByPk(req.params.id);
    if (!rule) {
      res.status(404).json([{ message: 'Recurring rule not found' }]);
      return;
    }
    res.status(200).json(rule);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const payload = {
      ...req.body,
      createdBy: actorId,
      nextRunDate: req.body.nextRunDate ?? req.body.startDate,
    };
    const rule = await FinanceRecurringRule.create(payload);
    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: rule.id,
      action: 'create',
      performedBy: actorId,
      changes: rule.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(rule);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const updateRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const [count] = await FinanceRecurringRule.update(
      { ...req.body, updatedBy: actorId },
      { where: { id: req.params.id } },
    );
    if (!count) {
      res.status(404).json([{ message: 'Recurring rule not found' }]);
      return;
    }
    const updated = await FinanceRecurringRule.findByPk(req.params.id);
    if (updated) {
      await recordFinanceAuditLog({
        entity: 'finance_recurring_rule',
        entityId: updated.id,
        action: 'update',
        performedBy: actorId,
        changes: req.body,
      });
    }
    res.status(200).json(updated);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const deleteRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FinanceRecurringRule.destroy({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Recurring rule not found' }]);
      return;
    }
    await recordFinanceAuditLog({
      entity: 'finance_recurring_rule',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as AuthenticatedRequest).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const executeRecurringRulesHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const result = await executeRecurringRules(actorId);
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

