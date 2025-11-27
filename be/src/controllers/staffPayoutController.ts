import type { Response } from 'express';
import dayjs from 'dayjs';
import StaffPayoutCollectionLog from '../models/StaffPayoutCollectionLog.js';
import StaffProfile from '../models/StaffProfile.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const DEFAULT_CURRENCY = process.env.FINANCE_BASE_CURRENCY?.trim().toUpperCase() ?? 'PLN';

const parseAmountToMinor = (value: unknown): number => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, 'Amount must be a positive number.');
  }
  return Math.round(parsed * 100);
};

const requireActorId = (req: AuthenticatedRequest): number => {
  const actorId = req.authContext?.id;
  if (!actorId) {
    throw new HttpError(401, 'Unauthorized');
  }
  return actorId;
};

export const createStaffPayoutCollectionLog = async (
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> => {
  try {
    const actorId = requireActorId(req);
    const staffProfileId = Number(req.body.staffProfileId);
    if (!Number.isInteger(staffProfileId) || staffProfileId <= 0) {
      throw new HttpError(400, 'A valid staffProfileId is required.');
    }

    const directionInput = typeof req.body.direction === 'string' ? req.body.direction.toLowerCase() : 'payable';
    const direction: 'receivable' | 'payable' =
      directionInput === 'receivable' || directionInput === 'payable' ? directionInput : 'payable';

    const currency =
      typeof req.body.currency === 'string' && req.body.currency.trim().length > 0
        ? req.body.currency.trim().toUpperCase()
        : DEFAULT_CURRENCY;

    const amountMinor = parseAmountToMinor(req.body.amount);
    const rangeStartRaw = typeof req.body.rangeStart === 'string' ? req.body.rangeStart : '';
    const rangeEndRaw = typeof req.body.rangeEnd === 'string' ? req.body.rangeEnd : '';

    const rangeStart = dayjs(rangeStartRaw).startOf('day');
    const rangeEnd = dayjs(rangeEndRaw).endOf('day');
    if (!rangeStart.isValid() || !rangeEnd.isValid() || rangeEnd.isBefore(rangeStart)) {
      throw new HttpError(400, 'Provide a valid rangeStart and rangeEnd.');
    }

    const isCanonicalRange =
      rangeStart.isSame(rangeStart.startOf('month'), 'day') &&
      rangeEnd.isSame(rangeStart.endOf('month'), 'day') &&
      rangeStart.isSame(rangeEnd, 'month') &&
      rangeStart.year() === rangeEnd.year();
    if (!isCanonicalRange) {
      throw new HttpError(400, 'Payouts can only be recorded for full calendar months.');
    }

    const staffProfile = await StaffProfile.findOne({
      where: { userId: staffProfileId, active: true },
      attributes: ['userId', 'financeVendorId', 'financeClientId'],
    });
    if (!staffProfile) {
      throw new HttpError(404, 'Staff profile not found.');
    }

    if (direction === 'payable' && !staffProfile.financeVendorId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance vendor.');
    }
    if (direction === 'receivable' && !staffProfile.financeClientId) {
      throw new HttpError(400, 'This staff profile is not linked to a finance client.');
    }

    const financeTransactionIdRaw =
      req.body.financeTransactionId !== undefined ? Number(req.body.financeTransactionId) : null;
    let financeTransactionId: number | null = null;
    if (financeTransactionIdRaw !== null && financeTransactionIdRaw !== 0) {
      if (!Number.isInteger(financeTransactionIdRaw) || financeTransactionIdRaw <= 0) {
        throw new HttpError(400, 'financeTransactionId must be a positive integer.');
      }
      const transactionExists = await FinanceTransaction.count({ where: { id: financeTransactionIdRaw } });
      if (!transactionExists) {
        throw new HttpError(400, 'Finance transaction not found.');
      }
      financeTransactionId = financeTransactionIdRaw;
    }

    const note = typeof req.body.note === 'string' && req.body.note.trim().length > 0 ? req.body.note.trim() : null;

    const record = await StaffPayoutCollectionLog.create({
      staffProfileId,
      direction,
      currencyCode: currency,
      amountMinor,
      rangeStart: rangeStart.format('YYYY-MM-DD'),
      rangeEnd: rangeEnd.format('YYYY-MM-DD'),
      financeTransactionId,
      note,
      createdBy: actorId,
    });

    res.status(201).json([record]);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json([{ message: error.message }]);
      return;
    }
    res.status(500).json([{ message: 'Failed to record staff payout' }]);
  }
};
