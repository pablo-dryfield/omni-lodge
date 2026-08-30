import crypto from 'crypto';
import dayjs from 'dayjs';
import { Op, type Transaction as SequelizeTransaction } from 'sequelize';
import sequelize from '../config/database.js';
import User from '../models/User.js';
import AffiliatePayoutLog from '../models/AffiliatePayoutLog.js';
import RequiredAction from '../models/RequiredAction.js';
import StaffPayoutCollectionLog from '../models/StaffPayoutCollectionLog.js';
import StaffPayoutLedger from '../models/StaffPayoutLedger.js';
import StaffPayoutReceipt from '../models/StaffPayoutReceipt.js';
import StaffPayoutReceiptItem from '../models/StaffPayoutReceiptItem.js';
import StaffProfile from '../models/StaffProfile.js';
import { getAffiliateOverview } from './affiliateService.js';
import FinanceAccount from '../finance/models/FinanceAccount.js';
import FinanceCategory from '../finance/models/FinanceCategory.js';
import FinanceVendor from '../finance/models/FinanceVendor.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import { createFinanceTransaction } from '../finance/services/transactionService.js';
import { cleanupInvoiceFileIfOrphan } from '../finance/services/transactionDeletionService.js';
import { recordFinanceAuditLog } from '../finance/services/auditLogService.js';
import { createStaffPayoutReceipt } from './staffPayoutReceiptService.js';
import { reconcilePersistedStaffPayoutLedgers } from './staffPayoutLedgerReconciliationService.js';
import { getConfigValue } from './configService.js';
import { loadCompensationSettlementRouter } from './compensationSettlementRoutingService.js';
import HttpError from '../errors/HttpError.js';

const normalizeMoney = (value: unknown): number => {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
};

const resolveStaffPayoutCurrency = (): string =>
  String(getConfigValue('FINANCE_BASE_CURRENCY') ?? 'PLN').trim().toUpperCase();

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
  receipt: {
    id: number;
    actionId: number | null;
    status: 'pending' | 'completed' | 'cancelled';
  } | null;
};

const buildPayoutPayload = (
  payoutLog: AffiliatePayoutLog,
  affiliateUserName: string,
  receipt: StaffPayoutReceipt | null,
): AffiliatePayoutPayload => ({
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
  receipt: receipt
    ? {
        id: receipt.id,
        actionId: receipt.requiredActionId,
        status: receipt.status,
      }
    : null,
});

const buildAffiliatePayoutBatchKey = (params: {
  affiliateUserId: number;
  currencyCode: string;
  amountMinor: number;
  startDate: string;
  endDate: string;
  paidDate: string;
  bookingIds: number[];
}): string => {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      ...params,
      bookingIds: [...params.bookingIds].sort((left, right) => left - right),
    }))
    .digest('hex');
  return `affiliate-direct:${digest}`;
};

export const createAffiliatePayout = async (input: CreateAffiliatePayoutInput): Promise<AffiliatePayoutPayload> => {
  const affiliateUser = await User.findByPk(input.affiliateUserId);
  if (!affiliateUser) {
    throw new Error('Affiliate user not found');
  }

  return sequelize.transaction(async (transaction) => {
    // Serialize payout eligibility per affiliate. The overview is deliberately
    // refreshed only after this lock, so two requests cannot both claim the
    // same still-unpaid bookings using stale pre-transaction data.
    const lockedAffiliateUser = await User.findByPk(input.affiliateUserId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lockedAffiliateUser) {
      throw new Error('Affiliate user not found');
    }
    const staffProfile = await StaffProfile.findByPk(input.affiliateUserId, {
      attributes: ['userId', 'financeVendorId', 'staffType'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (
      staffProfile
      && !dayjs(input.startDate).startOf('day').isSame(dayjs(input.endDate).startOf('day'), 'month')
    ) {
      throw new Error(
        'Staff affiliate payouts must stay within one calendar month so the payout ledger remains reconcilable.',
      );
    }
    if (staffProfile) {
      const settlementRouter = await loadCompensationSettlementRouter({
        effectiveDate: input.endDate,
        transaction,
      });
      const promotionRoute = settlementRouter.resolve({
        userId: input.affiliateUserId,
        staffType: staffProfile.staffType,
        systemSource: 'promotion_sales',
      });
      if (promotionRoute.destination !== 'staff_vendor') {
        throw new HttpError(
          409,
          promotionRoute.destination === 'volunteer_fund'
            ? 'Promotion Sales for this staff member are routed to a Volunteer Fund. Process them from Pays so the fund allocation is recorded.'
            : 'Promotion Sales for this staff member are excluded from direct payment. Review the payout routing rule in Pays.',
        );
      }
    }
    const [account, category] = await Promise.all([
      FinanceAccount.findByPk(input.accountId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      }),
      FinanceCategory.findByPk(input.categoryId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      }),
    ]);
    if (!account || !account.isActive) {
      throw new Error('Finance account not found');
    }
    if (!category || !category.isActive || category.kind !== 'expense') {
      throw new Error('Finance expense category not found');
    }
    const overview = await getAffiliateOverview({
      startDate: input.startDate,
      endDate: input.endDate,
      selectedAffiliateUserId: input.affiliateUserId,
      currentUserId: input.actorId,
      currentRoleSlug: 'manager',
      transaction,
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
    if (staffProfile) {
      const overlappingLedgers = await StaffPayoutLedger.findAll({
        attributes: ['currencyCode'],
        where: {
          staffUserId: input.affiliateUserId,
          rangeStart: { [Op.lte]: input.endDate },
          rangeEnd: { [Op.gte]: input.startDate },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const expectedCurrencies = new Set(
        overlappingLedgers.map((ledger) => ledger.currencyCode.trim().toUpperCase()),
      );
      if (expectedCurrencies.size > 1) {
        throw new Error('Overlapping staff payout ledgers use different currencies');
      }
      const expectedCurrency = Array.from(expectedCurrencies)[0] ?? resolveStaffPayoutCurrency();
      if (currencyCode !== expectedCurrency) {
        throw new Error(`Staff affiliate payout currency must match payout ledger currency ${expectedCurrency}`);
      }
    }
    if (account.currency.trim().toUpperCase() !== currencyCode) {
      throw new Error(`Selected finance account currency must match payout currency ${currencyCode}`);
    }
    const bookingIds = unpaidBookings.map((booking) => booking.id);
    const commissionTotal = normalizeMoney(
      unpaidBookings.reduce((sum, booking) => sum + booking.affiliateCommissionAmount, 0),
    );
    const amountMinor = Math.round(commissionTotal * 100);
    if (amountMinor <= 0) {
      throw new Error('Affiliate payout amount must be positive');
    }
    const affiliateUserName = overview.affiliateUsers.find(
      (user) => user.id === input.affiliateUserId,
    )?.fullName ?? deriveCounterpartyName(lockedAffiliateUser);
    const payoutBatchKey = buildAffiliatePayoutBatchKey({
      affiliateUserId: input.affiliateUserId,
      currencyCode,
      amountMinor,
      startDate: input.startDate,
      endDate: input.endDate,
      paidDate: input.paidDate,
      bookingIds,
    });

    let financeVendorId: number;
    const staffVendor = staffProfile?.financeVendorId
      ? await FinanceVendor.findByPk(staffProfile.financeVendorId, { transaction })
      : null;
    if (staffVendor) {
      financeVendorId = staffVendor.id;
      if (lockedAffiliateUser.financeVendorId !== financeVendorId) {
        await lockedAffiliateUser.update({ financeVendorId }, { transaction });
      }
    } else {
      financeVendorId = await ensureAffiliateFinanceVendor(lockedAffiliateUser, transaction);
      if (staffProfile && staffProfile.financeVendorId !== financeVendorId) {
        await staffProfile.update({ financeVendorId }, { transaction });
      }
    }
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
          payoutBatchKey,
          ...(staffProfile
            ? {
                staffUserId: input.affiliateUserId,
                lineLabel: 'Affiliate commission',
                sourceKey: 'promotion_sales',
                affiliatePayout: true,
              }
            : {}),
        },
      },
      input.actorId,
      { transaction, allowStaffPayoutReceiptFlow: Boolean(staffProfile) },
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

    let receipt: StaffPayoutReceipt | null = null;
    if (staffProfile) {
      const collectionLog = await StaffPayoutCollectionLog.create(
        {
          staffProfileId: input.affiliateUserId,
          direction: 'payable',
          currencyCode,
          amountMinor,
          rangeStart: input.startDate,
          rangeEnd: input.endDate,
          financeTransactionId: financeTransaction.id,
          note: input.note?.trim() || 'Affiliate commission payout',
          createdBy: input.actorId,
        },
        { transaction },
      );

      receipt = await createStaffPayoutReceipt({
        staffUserId: input.affiliateUserId,
        payoutBatchKey,
        rangeStart: input.startDate,
        rangeEnd: input.endDate,
        paidDate: input.paidDate,
        createdBy: input.actorId,
        items: [
          {
            collectionLogId: collectionLog.id,
            financeTransactionId: financeTransaction.id,
            label: 'Affiliate commission',
            amountMinor,
            currencyCode,
          },
        ],
        transaction,
      });

      await reconcilePersistedStaffPayoutLedgers({
        staffUserId: input.affiliateUserId,
        affectedRangeStart: input.startDate,
        affectedRangeEnd: input.endDate,
        transaction,
      });
    }

    return buildPayoutPayload(payoutLog, affiliateUserName, receipt);
  });
};

export const undoAffiliatePayout = async (payoutLogId: number, actorId: number): Promise<void> => {
  let deletedFinanceTransactionId: number | null = null;
  let orphanedInvoiceFileId: number | null = null;

  await sequelize.transaction(async (transaction) => {
    const payoutIdentity = await AffiliatePayoutLog.findByPk(payoutLogId, {
      attributes: ['id', 'affiliateUserId'],
      transaction,
    });
    if (!payoutIdentity) {
      throw new Error('Affiliate payout not found');
    }

    // Pays deletion serializes receipt changes on the staff profile row. Take
    // that same lock before locking the affiliate payout so both entry points
    // observe/reissue mixed receipts in one consistent order. External
    // affiliates have no StaffProfile row and retain the ordinary payout lock.
    const staffProfile = await StaffProfile.findOne({
      where: { userId: payoutIdentity.affiliateUserId },
      attributes: ['userId'],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const payoutLog = await AffiliatePayoutLog.findByPk(payoutLogId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!payoutLog) {
      throw new Error('Affiliate payout not found');
    }

    const financeTransactionId = payoutLog.financeTransactionId ?? null;
    const collectionLogs = financeTransactionId
      ? await StaffPayoutCollectionLog.findAll({
          where: {
            staffProfileId: payoutLog.affiliateUserId,
            financeTransactionId,
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
      : [];
    const collectionLogIds = collectionLogs.map((entry) => entry.id);
    const receiptItemSources = [
      ...(collectionLogIds.length > 0
        ? [{ collectionLogId: { [Op.in]: collectionLogIds } }]
        : []),
      ...(financeTransactionId ? [{ financeTransactionId }] : []),
    ];
    const affectedReceiptItems = receiptItemSources.length > 0
      ? await StaffPayoutReceiptItem.findAll({
          where: { [Op.or]: receiptItemSources },
          transaction,
          lock: transaction.LOCK.UPDATE,
        })
      : [];
    const receiptIds = Array.from(new Set(affectedReceiptItems.map((item) => item.receiptId)));

    if (receiptIds.length > 0) {
      const receipts = await StaffPayoutReceipt.findAll({
        where: {
          id: { [Op.in]: receiptIds },
          status: { [Op.in]: ['pending', 'completed'] },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const allReceiptItems = await StaffPayoutReceiptItem.findAll({
        where: { receiptId: { [Op.in]: receiptIds } },
        transaction,
        lock: transaction.LOCK.UPDATE,
        order: [['id', 'ASC']],
      });
      const cancelledAt = new Date();
      for (const receipt of receipts) {
        const remainingItems = allReceiptItems.filter(
          (item) =>
            item.receiptId === receipt.id
            && item.collectionLogId != null
            && !collectionLogIds.includes(item.collectionLogId)
            && (financeTransactionId == null || item.financeTransactionId !== financeTransactionId),
        );
        await receipt.update(
          {
            status: 'cancelled',
            cancelledAt,
            cancelledBy: actorId,
            cancelReason: 'The affiliate payout was undone after the receipt request was created.',
          },
          { transaction },
        );
        if (receipt.requiredActionId) {
          await RequiredAction.update(
            { status: false, updatedBy: actorId },
            { where: { id: receipt.requiredActionId }, transaction },
          );
        }

        // Keep immutable ids, amounts, photo, and signature as audit evidence while
        // releasing the live foreign keys before their payout rows are removed.
        await StaffPayoutReceiptItem.update(
          { collectionLogId: null, financeTransactionId: null },
          { where: { receiptId: receipt.id }, transaction },
        );

        // A payout created from Pays can combine affiliate commission with other
        // wages in one receipt. Reissue the still-valid portion instead of leaving
        // those sibling payments without a confirmation request.
        if (remainingItems.length > 0) {
          await createStaffPayoutReceipt({
            staffUserId: receipt.staffUserId,
            payoutBatchKey: receipt.payoutBatchKey,
            rangeStart: receipt.rangeStart,
            rangeEnd: receipt.rangeEnd,
            paidDate: receipt.paidDate,
            createdBy: receipt.createdBy,
            items: remainingItems.map((item) => ({
              collectionLogId: Number(item.collectionLogId),
              financeTransactionId: item.financeTransactionId,
              label: item.label,
              amountMinor: Number(item.amountMinor),
              currencyCode: item.currencyCode,
            })),
            transaction,
          });
        }
      }
    }

    if (collectionLogIds.length > 0) {
      await StaffPayoutCollectionLog.destroy({
        where: { id: { [Op.in]: collectionLogIds } },
        transaction,
      });
    }

    await AffiliatePayoutLog.destroy({
      where: { id: payoutLog.id },
      transaction,
    });

    if (financeTransactionId) {
      const financeTransaction = await FinanceTransaction.findByPk(financeTransactionId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (financeTransaction) {
        deletedFinanceTransactionId = financeTransaction.id;
        orphanedInvoiceFileId = financeTransaction.invoiceFileId ?? null;
        await FinanceTransaction.destroy({ where: { id: financeTransaction.id }, transaction });
      }
    }

    if (staffProfile) {
      await reconcilePersistedStaffPayoutLedgers({
        staffUserId: payoutLog.affiliateUserId,
        affectedRangeStart: payoutLog.rangeStart,
        affectedRangeEnd: payoutLog.rangeEnd,
        transaction,
      });
    }
  });

  if (orphanedInvoiceFileId) {
    await cleanupInvoiceFileIfOrphan(orphanedInvoiceFileId);
  }
  if (deletedFinanceTransactionId) {
    await recordFinanceAuditLog({
      entity: 'finance_transaction',
      entityId: deletedFinanceTransactionId,
      action: 'delete',
      performedBy: actorId,
      metadata: { source: 'affiliate-payout-undo', payoutLogId },
    });
  }
};
