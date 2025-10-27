import { Request, Response } from 'express';
import { Op, WhereOptions } from 'sequelize';
import FinanceTransaction from '../models/FinanceTransaction.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceVendor from '../models/FinanceVendor.js';
import FinanceClient from '../models/FinanceClient.js';
import FinanceFile from '../models/FinanceFile.js';
import { AuthenticatedRequest } from '../../types/AuthenticatedRequest';
import {
  createFinanceTransaction,
  updateFinanceTransaction,
  createFinanceTransfer,
} from '../services/transactionService.js';
import { recordFinanceAuditLog } from '../services/auditLogService.js';

function requireActor(req: AuthenticatedRequest): number {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new Error('Missing authenticated user');
  }
  return actorId;
}

export const listTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const where: WhereOptions = {};
    if (req.query.status) {
      where.status = req.query.status;
    }
    if (req.query.kind) {
      where.kind = req.query.kind;
    }
    if (req.query.accountId) {
      where.accountId = Number(req.query.accountId);
    }
    if (req.query.categoryId) {
      where.categoryId = Number(req.query.categoryId);
    }
    if (req.query.counterpartyId) {
      where.counterpartyId = Number(req.query.counterpartyId);
    }
    if (req.query.counterpartyType) {
      where.counterpartyType = req.query.counterpartyType;
    }
    if (req.query.dateFrom || req.query.dateTo) {
      where.date = {
        ...(req.query.dateFrom ? { [Op.gte]: req.query.dateFrom } : {}),
        ...(req.query.dateTo ? { [Op.lte]: req.query.dateTo } : {}),
      };
    }

    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const { rows, count } = await FinanceTransaction.findAndCountAll({
      where,
      limit,
      offset,
      order: [
        ['date', 'DESC'],
        ['id', 'DESC'],
      ],
      include: [
        { model: FinanceAccount, as: 'account' },
        { model: FinanceCategory, as: 'category' },
        { model: FinanceVendor, as: 'vendor', required: false },
        { model: FinanceClient, as: 'client', required: false },
        { model: FinanceFile, as: 'invoiceFile', required: false },
      ],
    });

    res.status(200).json({ data: rows, meta: { count, limit, offset } });
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const getTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const transaction = await FinanceTransaction.findByPk(req.params.id, {
      include: [
        { model: FinanceAccount, as: 'account' },
        { model: FinanceCategory, as: 'category' },
        { model: FinanceVendor, as: 'vendor', required: false },
        { model: FinanceClient, as: 'client', required: false },
        { model: FinanceFile, as: 'invoiceFile', required: false },
      ],
    });
    if (!transaction) {
      res.status(404).json([{ message: 'Transaction not found' }]);
      return;
    }
    res.status(200).json(transaction);
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createTransactionHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const transaction = await createFinanceTransaction(req.body, actorId);
    res.status(201).json(transaction);
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

export const updateTransactionHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const transaction = await updateFinanceTransaction(Number(req.params.id), req.body, actorId);
    res.status(200).json(transaction);
  } catch (error) {
    const message = (error as Error).message;
    res.status(message === 'Transaction not found' ? 404 : 400).json([{ message }]);
  }
};

export const deleteTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await FinanceTransaction.destroy({ where: { id: req.params.id } });
    if (!count) {
      res.status(404).json([{ message: 'Transaction not found' }]);
      return;
    }
    await recordFinanceAuditLog({
      entity: 'finance_transaction',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as AuthenticatedRequest).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    res.status(500).json([{ message: (error as Error).message }]);
  }
};

export const createTransferHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const actorId = requireActor(req as AuthenticatedRequest);
    const { debit, credit } = await createFinanceTransfer(req.body, actorId);
    res.status(201).json({ debit, credit });
  } catch (error) {
    res.status(400).json([{ message: (error as Error).message }]);
  }
};

