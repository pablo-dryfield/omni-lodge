import { Request, Response } from 'express';
import sequelize from '../../config/database.js';
import HttpError from '../../errors/HttpError.js';
import { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceClient from '../models/FinanceClient.js';
import FinanceRecurringRule from '../models/FinanceRecurringRule.js';
import FinanceVendor from '../models/FinanceVendor.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';
import {
  createFinanceRecurringRule,
  executeRecurringRules,
  listFinanceRecurringRuleOccurrences,
  postFinanceRecurringRuleOccurrence,
  updateFinanceRecurringRule,
  voidFinanceRecurringRuleOccurrence,
} from '../services/recurringRuleService.js';

function requireActor(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Missing authenticated user');
  }
  return actorId;
}

function positiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} must be a positive integer`);
  }
  return parsed;
}

function handleRecurringError(res: Response, error: unknown): void {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message }]);
    return;
  }
  res.status(500).json([{ message: error instanceof Error ? error.message : String(error) }]);
}

export const listRecurringRules = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rules = await FinanceRecurringRule.findAll({
      order: [['createdAt', 'DESC']],
    });
    res.status(200).json(rules);
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const getRecurringWorkspaceBootstrap = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [rules, accounts, categories, vendors, clients] = await Promise.all([
      FinanceRecurringRule.findAll({ order: [['createdAt', 'DESC']] }),
      FinanceAccount.findAll({ order: [['name', 'ASC']] }),
      FinanceCategory.findAll({
        order: [['kind', 'ASC'], ['parentId', 'ASC'], ['name', 'ASC']],
      }),
      FinanceVendor.findAll({ order: [['name', 'ASC']] }),
      FinanceClient.findAll({ order: [['name', 'ASC']] }),
    ]);
    res.status(200).json({ rules, accounts, categories, vendors, clients });
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const getRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = positiveId(req.params.id, 'Recurring rule ID');
    const rule = await FinanceRecurringRule.findByPk(id);
    if (!rule) {
      throw new HttpError(404, 'Recurring rule not found');
    }
    res.status(200).json(rule);
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const createRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const rule = await createFinanceRecurringRule(req.body, actorId);
    res.status(201).json(rule);
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const updateRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const id = positiveId(req.params.id, 'Recurring rule ID');
    const updated = await updateFinanceRecurringRule(id, req.body, actorId);
    res.status(200).json(updated);
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const deleteRecurringRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const id = positiveId(req.params.id, 'Recurring rule ID');
    await sequelize.transaction(async (transaction) => {
      const rule = await FinanceRecurringRule.findByPk(id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!rule) {
        throw new HttpError(404, 'Recurring rule not found');
      }
      const snapshot = rule.toJSON() as Record<string, unknown>;
      await rule.destroy({ transaction });
      await recordFinanceAuditLog({
        entity: 'finance_recurring_rule',
        entityId: id,
        action: 'delete',
        performedBy: actorId,
        changes: snapshot,
        transaction,
      });
    });
    res.status(204).send();
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const executeRecurringRulesHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const result = await executeRecurringRules(actorId);
    res.status(200).json(result);
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const listRecurringRuleOccurrences = async (req: Request, res: Response): Promise<void> => {
  try {
    const ruleId = positiveId(req.params.id, 'Recurring rule ID');
    const result = await listFinanceRecurringRuleOccurrences(ruleId, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.status(200).json(result);
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const postRecurringRuleOccurrence = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const ruleId = positiveId(req.params.id, 'Recurring rule ID');
    const transactionId = positiveId(req.params.transactionId, 'Transaction ID');
    const result = await postFinanceRecurringRuleOccurrence(ruleId, transactionId, actorId);
    res.status(200).json(result);
  } catch (error) {
    handleRecurringError(res, error);
  }
};

export const voidRecurringRuleOccurrence = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const ruleId = positiveId(req.params.id, 'Recurring rule ID');
    const transactionId = positiveId(req.params.transactionId, 'Transaction ID');
    const result = await voidFinanceRecurringRuleOccurrence(ruleId, transactionId, actorId);
    res.status(200).json(result);
  } catch (error) {
    handleRecurringError(res, error);
  }
};
