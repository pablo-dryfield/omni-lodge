import type { Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../config/database.js';
import User from '../models/User.js';
import AffiliatePayoutLog from '../models/AffiliatePayoutLog.js';
import { getAffiliateOverview } from './affiliateService.js';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import { createFinanceTransaction } from '../finance/services/transactionService.js';
import { deleteFinanceTransactionAndCleanupInvoice } from '../finance/services/transactionDeletionService.js';
import { recordFinanceAuditLog } from '../finance/services/auditLogService.js';

const normalizeMoney = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
};

const deriveCounterpartyName = (user: User): string => {
  const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  if (name.length > 0) {
    return name;
  }
  if (user.email) {
    return user.email;
  }
  if (user.username) {
    return user.username;
  }
  return `Affiliate #${user.id}`;
};

const ensureAffiliateFinanceVendor = async (affiliateUser: User, transaction?: SequelizeTransaction): Promise<number> => {
  if (affiliateUser.financeVendorId) {
    const existing = await FinanceVendor.findByPk(affiliateUser.financeVendorId, { transaction });
    if (existing) {
      return existing.id;
    }
  }

  const vendor = await FinanceVendor.create(
    {
      name: deriveCounterpartyName(affiliateUser),
      email: affiliateUser.email ?? null,
      phone: affiliateUser.phone ?? null,
      defaultCategoryId: null,
      notes: `Auto-created from affiliate user #${affiliateUser.id} on ${new Date().toISOString()}`,
      isActive: true,
    },
    { transaction },
  );

  await affiliateUser.update({ financeVendorId: vendor.id }, { transaction });

  return vendor.id;
};

export type CreateAffiliatePayoutInput = {
  affiliateUserId: number;
  startDate: string;
  endDate: string;
  accountId: number;
  categoryId: number;
  paidDate: string;
  note?: string | null;
  actorId: number;
};

export type AffiliatePayoutPayload = {
  id: number;
  affiliateUserId: number;
  affiliateUserName: string;
  currencyCode: string;
  amount: number;
  amountMinor: number;
  paidDate: string;
  rangeStart: string;
  rangeEnd: string;
  bookingIds: number[];
  bookingCount: number;
  financeTransactionId: number | null;
  note: string | null;
};

const buildPayoutPayload = (payoutLog: AffiliatePayoutLog, affiliateUserName: string): AffiliatePayoutPayload => ({
  id: payoutLog.id,
  affiliateUserId: payoutLog.affiliateUserId,
  affiliateUserName,
  currencyCode: payoutLog.currencyCode,
  amountMinor: payoutLog.amountMinor,
  amount: normalizeMoney(payoutLog.amountMinor / 100),
  paidDate: payoutLog.paidDate,
  rangeStart: payoutLog.rangeStart,
  rangeEnd: payoutLog.rangeEnd,
  bookingIds: Array.isArray(payoutLog.bookingIds) ? payoutLog.bookingIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0) : [],
  bookingCount: Array.isArray(payoutLog.bookingIds) ? payoutLog.bookingIds.length : 0,
  financeTransactionId: payoutLog.financeTransactionId ?? null,
  note: payoutLog.note ?? null,
});

export const createAffiliatePayout = async (input: CreateAffiliatePayoutInput): Promise<AffiliatePayoutPayload> => {
  const affiliateUser = await User.findByPk(input.affiliateUserId);
  if (!affiliateUser) {
    throw new Error('Affiliate user not found');
  }

  const account = await FinanceAccount.findByPk(input.accountId);
  if (!account || !account.isActive) {
    throw new Error('Finance account not found');
  }

  const category = await FinanceCategory.findByPk(input.categoryId);
  if (!category || !category.isActive || category.kind !== 'expense') {
    throw new Error('Finance expense category not found');
  }

  const overview = await getAffiliateOverview({
    startDate: input.startDate,
    endDate: input.endDate,
    selectedAffiliateUserId: input.affiliateUserId,
    currentUserId: input.actorId,
    currentRoleSlug: 'manager',
  });

  const unpaidBookings = overview.bookings.filter(
    (booking) => !booking.isCommissionPaid && booking.affiliateCommissionAmount > 0,
  );
  if (unpaidBookings.length === 0) {
    throw new Error('There are no unpaid affiliate commissions for the selected range');
  }

  const currencySet = new Set(
    unpaidBookings
      .map((booking) => booking.currency?.trim().toUpperCase())
      .filter((value): value is string => Boolean(value)),
  );
  if (currencySet.size !== 1) {
    throw new Error('Affiliate payout requires all unpaid bookings in the selected range to use the same currency');
  }

  const currencyCode = Array.from(currencySet)[0];
  if (account.currency.trim().toUpperCase() !== currencyCode) {
    throw new Error(`Selected finance account currency must match payout currency ${currencyCode}`);
  }

  const bookingIds = unpaidBookings.map((booking) => booking.id);
  const commissionTotal = normalizeMoney(unpaidBookings.reduce((sum, booking) => sum + booking.affiliateCommissionAmount, 0));
  const amountMinor = Math.round(commissionTotal * 100);

  if (amountMinor <= 0) {
    throw new Error('Affiliate payout amount must be positive');
  }

  const affiliateUserName = overview.affiliateUsers.find((user) => user.id === input.affiliateUserId)?.fullName ?? deriveCounterpartyName(affiliateUser);

  return sequelize.transaction(async (transaction) => {
    const financeVendorId = await ensureAffiliateFinanceVendor(affiliateUser, transaction);
    const financeTransaction = await createFinanceTransaction(
      {
        kind: 'expense',
        date: input.paidDate,
        accountId: input.accountId,
        currency: currencyCode,
        amountMinor,
        categoryId: input.categoryId,
        counterpartyId: financeVendorId,
        paymentMethod: null,
        status: 'paid',
        description: `Affiliate payout - ${affiliateUserName} (${input.startDate} to ${input.endDate})`,
        meta: {
          source: 'affiliate-payout',
          affiliateUserId: input.affiliateUserId,
          affiliateUserName,
          bookingIds,
          bookingCount: bookingIds.length,
          rangeStart: input.startDate,
          rangeEnd: input.endDate,
        },
      },
      input.actorId,
      { transaction },
    );

    const payoutLog = await AffiliatePayoutLog.create(
      {
        affiliateUserId: input.affiliateUserId,
        currencyCode,
        amountMinor,
        rangeStart: input.startDate,
        rangeEnd: input.endDate,
        paidDate: input.paidDate,
        bookingIds,
        financeTransactionId: financeTransaction.id,
        note: input.note?.trim() || null,
        createdBy: input.actorId,
      },
      { transaction },
    );

    return buildPayoutPayload(payoutLog, affiliateUserName);
  });
};

export const undoAffiliatePayout = async (payoutLogId: number, actorId: number): Promise<void> => {
  const payoutLog = await AffiliatePayoutLog.findByPk(payoutLogId);
  if (!payoutLog) {
    throw new Error('Affiliate payout not found');
  }

  if (payoutLog.financeTransactionId) {
    const financeTransaction = await FinanceTransaction.findByPk(payoutLog.financeTransactionId);
    if (financeTransaction) {
      await deleteFinanceTransactionAndCleanupInvoice(financeTransaction);
      await recordFinanceAuditLog({
        entity: 'finance_transaction',
        entityId: financeTransaction.id,
        action: 'delete',
        performedBy: actorId,
      });
    }
  }

  await AffiliatePayoutLog.destroy({
    where: { id: payoutLog.id },
  });
};
