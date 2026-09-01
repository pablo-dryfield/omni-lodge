import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { Op, type Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../../config/database.js';
import StaffProfile from '../../models/StaffProfile.js';
import User from '../../models/User.js';
import { getConfigValue } from '../../services/configService.js';
import {
  STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE,
  STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE,
} from '../../services/staffPayoutReceiptProtectionService.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceTransaction from '../models/FinanceTransaction.js';
import FinanceVendor from '../models/FinanceVendor.js';
import VolunteerFund from '../models/VolunteerFund.js';
import VolunteerFundEntry from '../models/VolunteerFundEntry.js';
import { updateFinanceTransaction } from './transactionService.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_FINANCE_TIMEZONE = 'Europe/Warsaw';

export type PlannedExpenseAction = 'pay' | 'staff_paid';

export type PlannedExpenseActionInput = {
  action: PlannedExpenseAction;
  paidByUserId?: unknown;
  paymentDate?: unknown;
};

export type EligibleExpensePayer = {
  userId: number;
  fullName: string;
};

export class PlannedExpenseActionError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = 'PlannedExpenseActionError';
  }
}

const normalizeMeta = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
);

const normalizePositiveId = (value: unknown, fieldName: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new PlannedExpenseActionError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
};

const normalizeAction = (value: unknown): PlannedExpenseAction => {
  const action = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (action !== 'pay' && action !== 'staff_paid') {
    throw new PlannedExpenseActionError('action must be pay or staff_paid', 400);
  }
  return action;
};

const resolveFinanceTimezone = (): string => {
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
};

const normalizePaymentDate = (value: unknown): string => {
  if (value === undefined || value === null || value === '') {
    return dayjs().tz(resolveFinanceTimezone()).format('YYYY-MM-DD');
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PlannedExpenseActionError('paymentDate must use YYYY-MM-DD', 400);
  }
  const parsed = dayjs.utc(value);
  if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== value) {
    throw new PlannedExpenseActionError('paymentDate must be a valid date', 400);
  }
  return value;
};

const readRecurringRuleId = (meta: Record<string, unknown>): number | null => {
  if (!Object.prototype.hasOwnProperty.call(meta, 'recurring_rule_id')) {
    return null;
  }
  const parsed = Number(meta.recurring_rule_id);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new PlannedExpenseActionError(
      'This planned expense has invalid recurring-rule provenance and cannot be changed here.',
      409,
    );
  }
  return parsed;
};

const assertQuickActionEligibleSource = (
  record: FinanceTransaction,
  meta: Record<string, unknown>,
  recurringRuleId: number | null,
): void => {
  if (recurringRuleId) {
    return;
  }
  const source = typeof meta.source === 'string' ? meta.source.trim().toLowerCase() : '';
  if (source && source !== 'manual') {
    throw new PlannedExpenseActionError(
      'This system-managed planned expense must be changed from its source workflow.',
      409,
    );
  }
  if (record.nightReportId || record.receiptGroupKey) {
    throw new PlannedExpenseActionError(
      'This system-managed planned expense must be changed from its source workflow.',
      409,
    );
  }
};

const assertOrdinaryPlannedExpenseReferences = async (
  record: FinanceTransaction,
  transaction: SequelizeTransaction,
): Promise<void> => {
  if (!Number.isSafeInteger(Number(record.amountMinor)) || Number(record.amountMinor) <= 0) {
    throw new PlannedExpenseActionError('The planned expense amount must be positive.', 409);
  }
  const account = await FinanceAccount.findByPk(record.accountId, { transaction });
  if (!account || !account.isActive) {
    throw new PlannedExpenseActionError('The planned expense account is no longer active.', 409);
  }
  if (account.currency.trim().toUpperCase() !== record.currency.trim().toUpperCase()) {
    throw new PlannedExpenseActionError(
      'The planned expense currency no longer matches its account.',
      409,
    );
  }
  if (record.counterpartyType !== 'vendor' || !record.counterpartyId) {
    throw new PlannedExpenseActionError('The planned expense needs an active vendor.', 409);
  }
  const vendor = await FinanceVendor.findByPk(record.counterpartyId, { transaction });
  if (!vendor || !vendor.isActive) {
    throw new PlannedExpenseActionError('The planned expense vendor is no longer active.', 409);
  }
  if (record.categoryId) {
    const category = await FinanceCategory.findByPk(record.categoryId, { transaction });
    if (!category || !category.isActive || category.kind !== 'expense') {
      throw new PlannedExpenseActionError(
        'The planned expense category is no longer an active expense category.',
        409,
      );
    }
  }

  const [linkedFund, linkedFundEntry] = await Promise.all([
    VolunteerFund.findOne({
      attributes: ['id'],
      where: { isActive: true, linkedAccountId: record.accountId },
      transaction,
    }),
    VolunteerFundEntry.findOne({
      attributes: ['id'],
      where: {
        [Op.or]: [
          { financeTransactionId: record.id },
          { financeCounterTransactionId: record.id },
        ],
      },
      transaction,
    }),
  ]);
  if (linkedFund || linkedFundEntry) {
    throw new PlannedExpenseActionError(
      'This planned expense belongs to a Volunteer Fund workflow and cannot be changed here.',
      409,
    );
  }
};

const assertEligiblePayer = async (
  userId: number,
  transaction: SequelizeTransaction,
): Promise<void> => {
  const profile = await StaffProfile.findByPk(userId, { transaction });
  if (!profile || !profile.active || !profile.financeVendorId) {
    throw new PlannedExpenseActionError(
      'Select an active staff member with a linked Finance vendor.',
      409,
    );
  }
  const [user, vendor] = await Promise.all([
    User.findByPk(userId, { transaction }),
    FinanceVendor.findByPk(profile.financeVendorId, { transaction }),
  ]);
  if (!user || !user.status || !user.approved || !vendor || !vendor.isActive) {
    throw new PlannedExpenseActionError(
      'Select an active staff member with a linked Finance vendor.',
      409,
    );
  }
};

const isKnownProtectedUpdateError = (message: string): boolean => (
  message === STAFF_PAYOUT_RECEIPT_TRANSACTION_PROTECTED_MESSAGE
  || message === STAFF_PAYMENT_REQUIRES_PAYS_MESSAGE
  || message.includes('Volunteer Fund')
  || message.includes('backs a Volunteer Fund')
);

export async function applyPlannedExpenseAction(
  transactionIdValue: unknown,
  input: PlannedExpenseActionInput,
  actorIdValue: unknown,
  options?: { allowRecurringUpdate?: boolean },
): Promise<FinanceTransaction> {
  const transactionId = normalizePositiveId(transactionIdValue, 'transactionId');
  const actorId = normalizePositiveId(actorIdValue, 'actorId');
  const action = normalizeAction(input?.action);
  if (action !== 'staff_paid' && input?.paidByUserId != null && input.paidByUserId !== '') {
    throw new PlannedExpenseActionError('paidByUserId is only accepted for staff_paid', 400);
  }
  const paidByUserId = action === 'staff_paid'
    ? normalizePositiveId(input?.paidByUserId, 'paidByUserId')
    : null;
  const paymentDate = normalizePaymentDate(input?.paymentDate);

  return sequelize.transaction(async (transaction) => {
    const record = await FinanceTransaction.findByPk(transactionId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!record) {
      throw new PlannedExpenseActionError('Transaction not found', 404);
    }
    if (record.kind !== 'expense' || record.status !== 'planned') {
      throw new PlannedExpenseActionError(
        'This transaction is no longer an unpaid planned expense. Refresh and try again.',
        409,
      );
    }

    const meta = normalizeMeta(record.meta);
    const recurringRuleId = readRecurringRuleId(meta);
    if (recurringRuleId && options?.allowRecurringUpdate !== true) {
      throw new PlannedExpenseActionError(
        'Updating a recurring occurrence also requires recurring-rule update access.',
        403,
      );
    }
    assertQuickActionEligibleSource(record, meta, recurringRuleId);
    await assertOrdinaryPlannedExpenseReferences(record, transaction);
    if (paidByUserId) {
      await assertEligiblePayer(paidByUserId, transaction);
    }

    const nextMeta: Record<string, unknown> = {
      ...meta,
      plannedExpenseScheduledFor: meta.plannedExpenseScheduledFor ?? record.date,
      plannedExpenseAction: action,
      plannedExpenseActionAt: new Date().toISOString(),
      plannedExpenseActionBy: actorId,
    };
    delete nextMeta.staffUserId;
    if (paidByUserId) {
      nextMeta.paidByUserId = paidByUserId;
    } else if (action === 'pay') {
      delete nextMeta.paidByUserId;
    }

    try {
      return await updateFinanceTransaction(
        record.id,
        {
          status: action === 'staff_paid' ? 'awaiting_reimbursement' : 'paid',
          date: paymentDate,
          meta: nextMeta,
        },
        actorId,
        { transaction },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isKnownProtectedUpdateError(message)) {
        throw new PlannedExpenseActionError(message, 409);
      }
      throw error;
    }
  });
}

export async function listEligibleExpensePayers(): Promise<EligibleExpensePayer[]> {
  const profiles = await StaffProfile.findAll({
    attributes: ['userId', 'financeVendorId'],
    where: {
      active: true,
      financeVendorId: { [Op.ne]: null },
    },
    include: [
      {
        model: User,
        as: 'user',
        attributes: ['id', 'firstName', 'lastName', 'email'],
        required: true,
        where: { status: true, approved: true },
      },
      {
        model: FinanceVendor,
        as: 'financeVendor',
        attributes: ['id'],
        required: true,
        where: { isActive: true },
      },
    ],
  });

  return profiles
    .map((profile) => {
      const user = profile.user;
      const fullName = user
        ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
        : '';
      return {
        userId: profile.userId,
        fullName: fullName || user?.email?.trim() || `User #${profile.userId}`,
      };
    })
    .sort((left, right) => (
      left.fullName.localeCompare(right.fullName, undefined, { sensitivity: 'base' })
      || left.userId - right.userId
    ));
}
