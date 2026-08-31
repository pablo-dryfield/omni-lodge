import type { Response } from 'express';
import { Op, fn, col, type WhereOptions } from 'sequelize';
import HttpError from '../../errors/HttpError.js';
import CompensationComponent from '../../models/CompensationComponent.js';
import User from '../../models/User.js';
import type { AuthenticatedRequest } from '../../types/AuthenticatedRequest.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import VolunteerFund from '../models/VolunteerFund.js';
import VolunteerFundEntry, { type VolunteerFundEntryType } from '../models/VolunteerFundEntry.js';
import {
  createManualVolunteerFundEntry,
  createVolunteerFund,
  deactivateVolunteerFund,
  parseFinanceDate,
  reverseVolunteerFundEntry,
  updateVolunteerFund,
} from '../services/volunteerFundService.js';

const ENTRY_TYPES = new Set<VolunteerFundEntryType>(['allocation', 'spend', 'adjustment', 'reversal']);

const requireActorId = (req: AuthenticatedRequest): number => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return actorId;
};

const parseId = (value: unknown, field = 'id'): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${field} must be a positive integer.`);
  }
  return parsed;
};

const parsePageInteger = (value: unknown, fallback: number, max: number): number => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    throw new HttpError(400, `Pagination value must be between 0 and ${max}.`);
  }
  return parsed;
};

const handleError = (res: Response, error: unknown): void => {
  if (error instanceof HttpError) {
    res.status(error.status).json([{ message: error.message }]);
    return;
  }
  const code = (error as { original?: { code?: string }; parent?: { code?: string } })?.original?.code
    ?? (error as { parent?: { code?: string } })?.parent?.code;
  if (code === '23505') {
    res.status(409).json([{ message: 'This volunteer fund record already exists.' }]);
    return;
  }
  if (code === '23503') {
    res.status(409).json([{ message: 'This volunteer fund record is still referenced.' }]);
    return;
  }
  console.error('Volunteer fund request failed', error);
  res.status(500).json([{ message: 'Unable to process volunteer fund request.' }]);
};

const fundIncludes = [
  { model: FinanceAccount, as: 'linkedAccount', attributes: ['id', 'name', 'type', 'currency', 'isActive'] },
  {
    model: FinanceAccount,
    as: 'fundingSourceAccount',
    attributes: ['id', 'name', 'type', 'currency', 'isActive'],
  },
  { model: FinanceCategory, as: 'expenseCategory', attributes: ['id', 'name', 'kind', 'isActive'] },
];

const entryIncludes = [
  { model: User, as: 'attributedStaffUser', attributes: ['id', 'firstName', 'lastName'] },
  { model: CompensationComponent, as: 'compensationComponent', attributes: ['id', 'name', 'slug', 'category'] },
  {
    model: FinanceTransaction,
    as: 'financeTransaction',
    attributes: ['id', 'kind', 'date', 'accountId', 'currency', 'amountMinor', 'status', 'description'],
  },
  {
    model: VolunteerFundEntry,
    as: 'reversalOfEntry',
    attributes: ['id', 'entryType', 'amountMinor', 'entryDate', 'description'],
  },
  {
    model: VolunteerFundEntry,
    as: 'reversalEntry',
    attributes: ['id', 'entryType', 'amountMinor', 'entryDate', 'description'],
  },
];

const serializeEntry = (
  entry: VolunteerFundEntry,
  runningBalanceMinor?: number,
): Record<string, unknown> => ({
  ...(entry.get({ plain: true }) as Record<string, unknown>),
  amountMinor: Number(entry.amountMinor),
  ...(runningBalanceMinor === undefined ? {} : { runningBalanceMinor }),
});

const hydrateFund = async (id: number): Promise<VolunteerFund | null> =>
  VolunteerFund.findByPk(id, { include: fundIncludes });

export const listVolunteerFunds = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const where: WhereOptions = {};
    if (req.query.active !== undefined) {
      const normalized = String(req.query.active).trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        throw new HttpError(400, 'active must be true or false.');
      }
      where.isActive = normalized === 'true';
    }
    const [funds, balances] = await Promise.all([
      VolunteerFund.findAll({ where, include: fundIncludes, order: [['name', 'ASC']] }),
      VolunteerFundEntry.findAll({
        attributes: ['fundId', [fn('COALESCE', fn('SUM', col('amount_minor')), 0), 'balanceMinor']],
        group: ['fund_id'],
        raw: true,
      }) as unknown as Promise<Array<{ fundId: number; balanceMinor: string | number }>>,
    ]);
    const balanceByFund = new Map(balances.map((row) => [Number(row.fundId), Number(row.balanceMinor)]));
    res.status(200).json(funds.map((fund) => ({
      ...(fund.get({ plain: true }) as Record<string, unknown>),
      balanceMinor: balanceByFund.get(fund.id) ?? 0,
    })));
  } catch (error) {
    handleError(res, error);
  }
};

export const getVolunteerFund = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const fund = await hydrateFund(parseId(req.params.id));
    if (!fund) {
      throw new HttpError(404, 'Volunteer fund not found.');
    }
    const balance = await VolunteerFundEntry.sum('amountMinor', { where: { fundId: fund.id } });
    res.status(200).json({
      ...(fund.get({ plain: true }) as Record<string, unknown>),
      balanceMinor: Number(balance ?? 0),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const createVolunteerFundHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const created = await createVolunteerFund(req.body ?? {}, requireActorId(req));
    res.status(201).json((await hydrateFund(created.id)) ?? created);
  } catch (error) {
    handleError(res, error);
  }
};

export const updateVolunteerFundHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const updated = await updateVolunteerFund(parseId(req.params.id), req.body ?? {}, requireActorId(req));
    res.status(200).json((await hydrateFund(updated.id)) ?? updated);
  } catch (error) {
    handleError(res, error);
  }
};

export const deleteVolunteerFundHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const deactivated = await deactivateVolunteerFund(parseId(req.params.id), requireActorId(req));
    res.status(200).json(deactivated);
  } catch (error) {
    handleError(res, error);
  }
};

export const getVolunteerFundLedger = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const fundId = parseId(req.params.id);
    const fund = await hydrateFund(fundId);
    if (!fund) {
      throw new HttpError(404, 'Volunteer fund not found.');
    }
    const startDate = req.query.startDate
      ? parseFinanceDate(req.query.startDate, 'startDate')
      : null;
    const endDate = req.query.endDate
      ? parseFinanceDate(req.query.endDate, 'endDate')
      : null;
    if (startDate && endDate && endDate < startDate) {
      throw new HttpError(400, 'endDate must be on or after startDate.');
    }
    const entryTypeRaw = req.query.entryType ? String(req.query.entryType).trim() : null;
    const entryType = entryTypeRaw as VolunteerFundEntryType | null;
    if (entryType && !ENTRY_TYPES.has(entryType)) {
      throw new HttpError(400, 'entryType is invalid.');
    }
    const limit = parsePageInteger(req.query.limit, 100, 200) || 100;
    const offset = parsePageInteger(req.query.offset, 0, 1_000_000);

    const dateWhere: Record<PropertyKey, unknown> = {};
    if (startDate || endDate) {
      dateWhere.entryDate = {
        ...(startDate ? { [Op.gte]: startDate } : {}),
        ...(endDate ? { [Op.lte]: endDate } : {}),
      };
    }
    const allPeriodEntries = await VolunteerFundEntry.findAll({
      where: { fundId, ...dateWhere },
      include: entryIncludes,
      order: [['entryDate', 'ASC'], ['id', 'ASC']],
    });

    const openingBalance = startDate
      ? await VolunteerFundEntry.sum('amountMinor', {
          where: { fundId, entryDate: { [Op.lt]: startDate } },
        })
      : 0;
    let runningBalanceMinor = Number(openingBalance ?? 0);
    const entriesWithBalances = allPeriodEntries.map((entry) => {
      runningBalanceMinor += Number(entry.amountMinor);
      return { entry, runningBalanceMinor };
    });
    const filteredEntries = entryType
      ? entriesWithBalances.filter(({ entry }) => entry.entryType === entryType)
      : entriesWithBalances;
    const pageEntries = filteredEntries.slice(offset, offset + limit);

    const summary = allPeriodEntries.reduce(
      (acc, entry) => {
        const amount = Number(entry.amountMinor);
        acc.entryCount += 1;
        acc.netChangeMinor += amount;
        if (amount > 0) {
          acc.creditsMinor += amount;
        } else {
          acc.debitsMinor += Math.abs(amount);
        }
        if (entry.entryType === 'allocation') {
          acc.allocationsMinor += amount;
        } else if (entry.entryType === 'spend') {
          acc.spendMinor += Math.abs(amount);
        } else if (entry.entryType === 'adjustment') {
          acc.adjustmentsMinor += amount;
        } else if (entry.entryType === 'reversal') {
          acc.reversalsMinor += amount;
        }
        return acc;
      },
      {
        openingBalanceMinor: Number(openingBalance ?? 0),
        allocationsMinor: 0,
        spendMinor: 0,
        adjustmentsMinor: 0,
        reversalsMinor: 0,
        creditsMinor: 0,
        debitsMinor: 0,
        netChangeMinor: 0,
        closingBalanceMinor: 0,
        balanceMinor: 0,
        entryCount: 0,
      },
    );
    summary.closingBalanceMinor = summary.openingBalanceMinor + summary.netChangeMinor;
    summary.balanceMinor = summary.closingBalanceMinor;

    res.status(200).json({
      fund,
      summary,
      entries: pageEntries.map(({ entry, runningBalanceMinor: balance }) => serializeEntry(entry, balance)),
      pagination: {
        limit,
        offset,
        total: filteredEntries.length,
        hasMore: offset + pageEntries.length < filteredEntries.length,
      },
      filters: { startDate, endDate, entryType },
    });
  } catch (error) {
    handleError(res, error);
  }
};

const createManualEntryHandler = async (
  req: AuthenticatedRequest,
  res: Response,
  entryType: 'spend' | 'adjustment',
): Promise<void> => {
  try {
    const result = await createManualVolunteerFundEntry(
      parseId(req.params.id),
      entryType,
      req.body ?? {},
      requireActorId(req),
    );
    const hydrated = await VolunteerFundEntry.findByPk(result.entry.id, { include: entryIncludes });
    res.status(result.duplicated ? 200 : 201).json({
      duplicated: result.duplicated,
      entry: serializeEntry(hydrated ?? result.entry),
    });
  } catch (error) {
    handleError(res, error);
  }
};

export const createVolunteerFundSpend = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => createManualEntryHandler(req, res, 'spend');

export const createVolunteerFundAdjustment = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => createManualEntryHandler(req, res, 'adjustment');

export const reverseVolunteerFundEntryHandler = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await reverseVolunteerFundEntry(
      parseId(req.params.id),
      parseId(req.params.entryId, 'entryId'),
      req.body ?? {},
      requireActorId(req),
    );
    const hydrated = await VolunteerFundEntry.findByPk(result.entry.id, { include: entryIncludes });
    res.status(result.duplicated ? 200 : 201).json({
      duplicated: result.duplicated,
      entry: serializeEntry(hydrated ?? result.entry),
    });
  } catch (error) {
    handleError(res, error);
  }
};
