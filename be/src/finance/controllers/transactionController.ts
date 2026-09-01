import { Request, Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { literal, Op, WhereOptions } from 'sequelize';
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
import {
  deleteFinanceTransactionAndCleanupInvoice,
  VOLUNTEER_FUND_ALLOCATION_TRANSFER_PROTECTED_MESSAGE,
} from '../services/transactionDeletionService.js';
import { STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE } from '../../services/staffPayoutReceiptProtectionService.js';
import { getConfigValue } from '../../services/configService.js';
import { hasModuleActionPermission } from '../../middleware/authorizationMiddleware.js';
import {
  applyPlannedExpenseAction,
  listEligibleExpensePayers,
  PlannedExpenseActionError,
} from '../services/plannedExpenseService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_PLANNED_EXPENSE_LIMIT = 10;
const MAX_PLANNED_EXPENSE_LIMIT = 50;
const DEFAULT_FINANCE_TIMEZONE = 'Europe/Warsaw';

type PlannedExpenseTiming = 'all' | 'overdue' | 'due_today' | 'upcoming';
type PlannedExpenseCounts = {
  total: number;
  overdue: number;
  dueToday: number;
  upcoming: number;
};

function boundedInteger(value: unknown, fallback: number, maximum: number, allowZero = false): number {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    return fallback;
  }
  return Math.min(parsed, maximum);
}

function resolveFinanceTimezone(): string {
  const configured = getConfigValue('SCHED_TZ');
  const candidate = typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : DEFAULT_FINANCE_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_FINANCE_TIMEZONE;
  }
}

function resolvePlannedExpenseTiming(value: unknown): PlannedExpenseTiming {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : 'all';
  if (
    normalized !== 'all'
    && normalized !== 'overdue'
    && normalized !== 'due_today'
    && normalized !== 'upcoming'
  ) {
    throw new Error('timing must be all, overdue, due_today, or upcoming');
  }
  return normalized;
}

function databaseNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

/**
 * Homepage-friendly queue of unpaid planned expenses. Overdue items are
 * returned first (oldest first), followed by today and the nearest upcoming
 * items. The bounded server-side ordering keeps pagination globally correct;
 * fetching a generic transaction page and sorting it in the UI would not.
 */
export const listPlannedExpenseTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = boundedInteger(
      req.query.limit ?? DEFAULT_PLANNED_EXPENSE_LIMIT,
      DEFAULT_PLANNED_EXPENSE_LIMIT,
      MAX_PLANNED_EXPENSE_LIMIT,
    );
    const offset = boundedInteger(req.query.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, true);
    const timing = resolvePlannedExpenseTiming(req.query.timing);
    const financeTimezone = resolveFinanceTimezone();
    const today = dayjs().tz(financeTimezone).format('YYYY-MM-DD');
    const canUpdateTransactions = await hasModuleActionPermission(
      req as AuthenticatedRequest,
      'finance-transactions',
      'update',
    );
    const dateWhere = timing === 'overdue'
      ? { [Op.lt]: today }
      : timing === 'due_today'
        ? { [Op.eq]: today }
        : timing === 'upcoming'
          ? { [Op.gt]: today }
          : undefined;

    const baseWhere = { kind: 'expense' as const, status: 'planned' as const };
    const [{ rows, count }, rawSummaryRows, eligiblePayers] = await Promise.all([
      FinanceTransaction.findAndCountAll({
        where: {
          ...baseWhere,
          ...(dateWhere ? { date: dateWhere } : {}),
        },
        limit,
        offset,
        order: [
          literal(
            `CASE WHEN "FinanceTransaction"."date" < '${today}' THEN 0 WHEN "FinanceTransaction"."date" = '${today}' THEN 1 ELSE 2 END ASC`,
          ),
          ['date', 'ASC'],
          ['id', 'ASC'],
        ],
        include: [
          { model: FinanceAccount, as: 'account' },
          { model: FinanceCategory, as: 'category' },
          { model: FinanceVendor, as: 'vendor', required: false },
        ],
      }),
      FinanceTransaction.findAll({
        attributes: [
          'currency',
          [literal('COUNT(*)'), 'totalCount'],
          [literal(`COUNT(*) FILTER (WHERE "FinanceTransaction"."date" < '${today}')`), 'overdueCount'],
          [literal(`COUNT(*) FILTER (WHERE "FinanceTransaction"."date" = '${today}')`), 'dueTodayCount'],
          [literal(`COUNT(*) FILTER (WHERE "FinanceTransaction"."date" > '${today}')`), 'upcomingCount'],
          [literal('COALESCE(SUM("FinanceTransaction"."amount_minor"), 0)'), 'totalMinor'],
          [
            literal(
              `COALESCE(SUM("FinanceTransaction"."amount_minor") FILTER (WHERE "FinanceTransaction"."date" < '${today}'), 0)`,
            ),
            'overdueMinor',
          ],
          [
            literal(
              `COALESCE(SUM("FinanceTransaction"."amount_minor") FILTER (WHERE "FinanceTransaction"."date" = '${today}'), 0)`,
            ),
            'dueTodayMinor',
          ],
          [
            literal(
              `COALESCE(SUM("FinanceTransaction"."amount_minor") FILTER (WHERE "FinanceTransaction"."date" > '${today}'), 0)`,
            ),
            'upcomingMinor',
          ],
        ],
        where: baseWhere,
        group: ['currency'],
        order: [['currency', 'ASC']],
        raw: true,
      }),
      canUpdateTransactions ? listEligibleExpensePayers() : Promise.resolve([]),
    ]);

    const data = rows.map((transaction) => {
      const item = transaction.toJSON() as Record<string, unknown>;
      const transactionDate = String(transaction.date);
      const dueState = transactionDate < today
        ? 'overdue'
        : transactionDate === today
          ? 'due_today'
          : 'upcoming';
      return { ...item, dueState };
    });
    const amountsByCurrency = (rawSummaryRows as unknown as Array<Record<string, unknown>>).map((row) => ({
      currency: String(row.currency ?? '').toUpperCase(),
      totalMinor: databaseNumber(row.totalMinor),
      overdueMinor: databaseNumber(row.overdueMinor),
      dueTodayMinor: databaseNumber(row.dueTodayMinor),
      upcomingMinor: databaseNumber(row.upcomingMinor),
    }));
    const counts = (rawSummaryRows as unknown as Array<Record<string, unknown>>).reduce<PlannedExpenseCounts>(
      (totals, row) => ({
        total: totals.total + databaseNumber(row.totalCount),
        overdue: totals.overdue + databaseNumber(row.overdueCount),
        dueToday: totals.dueToday + databaseNumber(row.dueTodayCount),
        upcoming: totals.upcoming + databaseNumber(row.upcomingCount),
      }),
      { total: 0, overdue: 0, dueToday: 0, upcoming: 0 },
    );

    res.status(200).json({
      data,
      summary: { counts, amountsByCurrency },
      options: canUpdateTransactions ? { eligiblePayers } : {},
      meta: {
        count,
        limit,
        offset,
        today,
        timezone: financeTimezone,
        timing,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith('timing must be') ? 400 : 500;
    res.status(status).json([{ message }]);
  }
};

/**
 * A deliberately narrow state transition for the homepage planned-expense
 * queue. The service locks and re-checks the row, so a stale double click
 * cannot post the same expense twice.
 */
export const applyPlannedExpenseActionHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const authRequest = req as AuthenticatedRequest;
    const actorId = requireActor(authRequest);
    // The transaction update route guard has already populated this request's
    // permission cache. Manual rows ignore this flag; recurring occurrences
    // require both permissions after the locked row is inspected.
    const allowRecurringUpdate = await hasModuleActionPermission(
      authRequest,
      'finance-recurring',
      'update',
    );
    const transaction = await applyPlannedExpenseAction(
      req.params.id,
      req.body ?? {},
      actorId,
      { allowRecurringUpdate },
    );
    res.status(200).json({ data: transaction });
  } catch (error) {
    if (error instanceof PlannedExpenseActionError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    res.status(message === 'Missing authenticated user' ? 401 : 500).json([{ message }]);
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
    const transactionId = Number(req.params.id);
    const transaction = await updateFinanceTransaction(transactionId, req.body, actorId);
    res.status(200).json(transaction);
  } catch (error) {
    const message = (error as Error).message;
    const status = message === 'Transaction not found'
      ? 404
      : message === STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE
        || message === VOLUNTEER_FUND_ALLOCATION_TRANSFER_PROTECTED_MESSAGE
        ? 409
        : 400;
    res.status(status).json([{ message }]);
  }
};

export const deleteTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const transaction = await FinanceTransaction.findByPk(req.params.id);
    if (!transaction) {
      res.status(404).json([{ message: 'Transaction not found' }]);
      return;
    }
    await deleteFinanceTransactionAndCleanupInvoice(transaction);
    await recordFinanceAuditLog({
      entity: 'finance_transaction',
      entityId: Number(req.params.id),
      action: 'delete',
      performedBy: (req as AuthenticatedRequest).authContext?.id ?? null,
    });
    res.status(204).send();
  } catch (error) {
    const message = (error as Error).message;
    const status = message === STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE
      || message === VOLUNTEER_FUND_ALLOCATION_TRANSFER_PROTECTED_MESSAGE
      ? 409
      : message === 'Transaction not found'
        ? 404
        : 500;
    res.status(status).json([{ message }]);
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
