import { Request, Response } from 'express';
import FinanceAccount from '../models/FinanceAccount.js';
import { ErrorWithMessage } from '../../types/ErrorWithMessage.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

export const listAccounts = async (req: Request, res: Response): Promise<void> => {
  try {
    const onlyActive = (req.query.active ?? '').toString().toLowerCase() === 'true';
    const accounts = await FinanceAccount.findAll({
      where: onlyActive ? { isActive: true } : undefined,
      order: [['name', 'ASC']],
    });
    res.status(200).json(accounts);
  } catch (error) {
    const message = (error as ErrorWithMessage).message;
    res.status(500).json([{ message }]);
  }
};

export const getAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await FinanceAccount.findByPk(req.params.id);
    if (!account) {
      res.status(404).json([{ message: 'Account not found' }]);
      return;
    }
    res.status(200).json(account);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const account = await FinanceAccount.create(req.body);
    await recordFinanceAuditLog({
      entity: 'finance_account',
      entityId: account.id,
      action: 'create',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
      changes: account.toJSON() as Record<string, unknown>,
    });
    res.status(201).json(account);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const updateAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const [count] = await FinanceAccount.update(req.body, { where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Account not found' }]);
      return;
    }
    const updated = await FinanceAccount.findByPk(req.params.id);
    if (updated) {
      await recordFinanceAuditLog({
        entity: 'finance_account',
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

export const deleteAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FinanceAccount.destroy({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Account not found' }]);
      return;
    }
    await recordFinanceAuditLog({
      entity: 'finance_account',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as { authContext?: { id?: number } }).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

