import { Request, Response } from 'express';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import { Op } from 'sequelize';
import FinanceTransaction from '../models/FinanceTransaction.js';
import FinanceBudget from '../models/FinanceBudget.js';
import FinanceCategory from '../models/FinanceCategory.js';
import FinanceAccount from '../models/FinanceAccount.js';
import FinanceVendor from '../models/FinanceVendor.js';
import FinanceClient from '../models/FinanceClient.js';

dayjs.extend(isSameOrBefore);

const DEFAULT_MONTH_WINDOW = 6;
const BASE_CURRENCY = process.env.FINANCE_BASE_CURRENCY?.trim().toUpperCase() ?? 'PLN';
const NON_REPORTABLE_STATUSES = ['void'];
const PNL_KINDS = ['income', 'expense', 'refund'] as const;
const UNCATEGORIZED_CATEGORY_NAME = 'Uncategorized';

type MonthAggregation = {
  income: number;
  expense: number;
  net: number;
};

type CashFlowAggregation = {
  inflow: number;
  outflow: number;
};

const OUTSTANDING_STATUSES = new Set(['planned', 'approved']);

const formatMonthKey = (value: dayjs.Dayjs): string => value.format('YYYY-MM');
const formatMonthLabel = (value: dayjs.Dayjs): string => value.format('MMM YYYY');

export const getFinanceReports = async (req: Request, res: Response): Promise<void> => {
  try {
    const today = dayjs().endOf('month');
    const endParam = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const startParam = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;

    const endDate = endParam ? dayjs(endParam).endOf('month') : today;
    if (!endDate.isValid()) {
      res.status(400).json({ message: 'Invalid endDate parameter' });
      return;
    }

    let startDate = startParam
      ? dayjs(startParam).startOf('month')
      : endDate.startOf('month').subtract(DEFAULT_MONTH_WINDOW - 1, 'month');
    if (!startDate.isValid()) {
      res.status(400).json({ message: 'Invalid startDate parameter' });
      return;
    }
    if (startDate.isAfter(endDate)) {
      startDate = endDate.startOf('month');
    }

    const monthKeys: string[] = [];
    const monthLabels = new Map<string, string>();
    let cursor = startDate.startOf('month');
    while (cursor.isSameOrBefore(endDate, 'month')) {
      const key = formatMonthKey(cursor);
      monthKeys.push(key);
      monthLabels.set(key, formatMonthLabel(cursor));
      cursor = cursor.add(1, 'month');
    }

    const startIso = startDate.format('YYYY-MM-DD');
    const endIso = endDate.format('YYYY-MM-DD');

    const rangeTransactions = await FinanceTransaction.findAll({
      where: {
        date: { [Op.between]: [startIso, endIso] },
        status: { [Op.notIn]: NON_REPORTABLE_STATUSES },
      },
      attributes: [
        'id',
        'date',
        'kind',
        'baseAmountMinor',
        'amountMinor',
        'accountId',
        'currency',
        'status',
        'categoryId',
        'counterpartyType',
        'counterpartyId',
        'meta',
      ],
      include: [{ model: FinanceCategory, attributes: ['id', 'name'] }],
      order: [['date', 'ASC']],
    });

    const transactions = rangeTransactions.filter((transaction) =>
      (PNL_KINDS as readonly string[]).includes(transaction.kind),
    );

    const monthlyPnL = new Map<string, MonthAggregation>();
    const monthlyCashFlow = new Map<string, CashFlowAggregation>();
    monthKeys.forEach((key) => {
      monthlyPnL.set(key, { income: 0, expense: 0, net: 0 });
      monthlyCashFlow.set(key, { inflow: 0, outflow: 0 });
    });

    let incomeTotal = 0;
    let expenseTotal = 0;
    let inflowTotal = 0;
    let outflowTotal = 0;

    const expenseByCategory = new Map<
      number | 'uncategorized',
      { categoryId: number | null; categoryName: string; total: number }
    >();

    transactions.forEach((transaction) => {
      const monthKey = formatMonthKey(dayjs(transaction.date));
      if (!monthlyPnL.has(monthKey)) {
        return;
      }
      const amount = (transaction.baseAmountMinor ?? 0) / 100;
      const pnlBucket = monthlyPnL.get(monthKey)!;
      const cashBucket = monthlyCashFlow.get(monthKey)!;

      if (transaction.kind === 'income' || transaction.kind === 'refund') {
        pnlBucket.income += amount;
        cashBucket.inflow += amount;
        incomeTotal += amount;
        inflowTotal += amount;
      } else if (transaction.kind === 'expense') {
        pnlBucket.expense += amount;
        cashBucket.outflow += amount;
        expenseTotal += amount;
        outflowTotal += amount;

        const key = transaction.categoryId ?? 'uncategorized';
        const entry = expenseByCategory.get(key) ?? {
          categoryId: transaction.categoryId ?? null,
          categoryName: transaction.category?.name ?? UNCATEGORIZED_CATEGORY_NAME,
          total: 0,
        };
        entry.total += amount;
        expenseByCategory.set(key, entry);
      }
    });

    monthlyPnL.forEach((bucket) => {
      bucket.net = bucket.income - bucket.expense;
    });

    const topCategories = Array.from(expenseByCategory.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const budgets = await FinanceBudget.findAll({
      where: {
        period: { [Op.in]: monthKeys },
      },
      include: [{ model: FinanceCategory, attributes: ['id', 'name'] }],
    });

    const budgetByCategory = new Map<
      number | 'uncategorized',
      { categoryId: number | null; categoryName: string; budget: number }
    >();
    budgets.forEach((budget) => {
      const amount = (budget.amountMinor ?? 0) / 100;
      const key = budget.categoryId ?? 'uncategorized';
      const entry = budgetByCategory.get(key) ?? {
        categoryId: budget.categoryId ?? null,
        categoryName: budget.category?.name ?? UNCATEGORIZED_CATEGORY_NAME,
        budget: 0,
      };
      entry.budget += amount;
      budgetByCategory.set(key, entry);
    });

    const actualByCategory = new Map<
      number | 'uncategorized',
      { categoryId: number | null; categoryName: string; actual: number }
    >();
    transactions
      .filter((transaction) => transaction.kind === 'expense')
      .forEach((transaction) => {
        const amount = (transaction.baseAmountMinor ?? 0) / 100;
        const key = transaction.categoryId ?? 'uncategorized';
        const entry = actualByCategory.get(key) ?? {
          categoryId: transaction.categoryId ?? null,
          categoryName: transaction.category?.name ?? UNCATEGORIZED_CATEGORY_NAME,
          actual: 0,
        };
        entry.actual += amount;
        actualByCategory.set(key, entry);
      });

    const categoryKeys = new Set([...budgetByCategory.keys(), ...actualByCategory.keys()]);
    const budgetRows = Array.from(categoryKeys).map((key) => {
      const budgetEntry = budgetByCategory.get(key);
      const actualEntry = actualByCategory.get(key);
      const categoryId = budgetEntry?.categoryId ?? actualEntry?.categoryId ?? null;
      const categoryName = budgetEntry?.categoryName ?? actualEntry?.categoryName ?? UNCATEGORIZED_CATEGORY_NAME;
      const budget = budgetEntry?.budget ?? 0;
      const actual = actualEntry?.actual ?? 0;
      const variance = actual - budget;
      return { categoryId, categoryName, budget, actual, variance };
    });

    budgetRows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

    const budgetTotals = budgetRows.reduce(
      (acc, row) => {
        acc.budget += row.budget;
        acc.actual += row.actual;
        return acc;
      },
      { budget: 0, actual: 0, variance: 0 }
    );
    budgetTotals.variance = budgetTotals.actual - budgetTotals.budget;

    const accounts = await FinanceAccount.findAll({
      attributes: ['id', 'name', 'currency', 'openingBalanceMinor', 'isActive'],
    });
    const vendors = await FinanceVendor.findAll({
      attributes: ['id', 'name'],
    });
    const clients = await FinanceClient.findAll({
      attributes: ['id', 'name'],
    });

    type AccountSummaryRow = {
      accountId: number;
      name: string;
      currency: string;
      openingBalance: number;
      inflow: number;
      outflow: number;
      net: number;
      closingBalance: number;
      outstanding: number;
      isActive: boolean;
    };

    const accountSummaryMap = new Map<number, AccountSummaryRow>();
    accounts.forEach((account) => {
      const opening = (account.openingBalanceMinor ?? 0) / 100;
      accountSummaryMap.set(account.id, {
        accountId: account.id,
        name: account.name,
        currency: account.currency,
        openingBalance: opening,
        inflow: 0,
        outflow: 0,
        net: 0,
        closingBalance: opening,
        outstanding: 0,
        isActive: account.isActive ?? true,
      });
    });

    const getTransferDirection = (meta: Record<string, unknown> | null | undefined): 'in' | 'out' | null => {
      if (!meta || typeof meta !== 'object') {
        return null;
      }
      const direction = (meta as { direction?: unknown }).direction;
      if (typeof direction !== 'string') {
        return null;
      }
      const normalized = direction.toLowerCase();
      if (normalized === 'in' || normalized === 'out') {
        return normalized;
      }
      return null;
    };

    const determineSignedAmount = (transaction: FinanceTransaction): number => {
      const amount = (transaction.amountMinor ?? 0) / 100;
      if (transaction.kind === 'income' || transaction.kind === 'refund') {
        return amount;
      }
      if (transaction.kind === 'expense') {
        return -amount;
      }
      if (transaction.kind === 'transfer') {
        const direction = getTransferDirection(transaction.meta);
        return direction === 'in' ? amount : -amount;
      }
      return 0;
    };

    rangeTransactions.forEach((transaction) => {
      const summary = accountSummaryMap.get(transaction.accountId);
      if (!summary) {
        return;
      }
      const signedAmount = determineSignedAmount(transaction);
      if (signedAmount >= 0) {
        summary.inflow += signedAmount;
      } else {
        summary.outflow += Math.abs(signedAmount);
      }
      summary.net += signedAmount;
      summary.closingBalance += signedAmount;
      if (OUTSTANDING_STATUSES.has(transaction.status)) {
        summary.outstanding += signedAmount;
      }
    });

    const accountSummary = Array.from(accountSummaryMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const categoryIncomeMap = new Map<
      number | 'uncategorized',
      { categoryId: number | null; categoryName: string; amount: number }
    >();
    const categoryExpenseMap = new Map<
      number | 'uncategorized',
      { categoryId: number | null; categoryName: string; amount: number }
    >();

    rangeTransactions.forEach((transaction) => {
      const amount = (transaction.baseAmountMinor ?? 0) / 100;
      const key = transaction.categoryId ?? 'uncategorized';
      const categoryName = transaction.category?.name ?? UNCATEGORIZED_CATEGORY_NAME;
      if (transaction.kind === 'income' || transaction.kind === 'refund') {
        const entry = categoryIncomeMap.get(key) ?? {
          categoryId: transaction.categoryId ?? null,
          categoryName,
          amount: 0,
        };
        entry.amount += amount;
        categoryIncomeMap.set(key, entry);
      } else if (transaction.kind === 'expense') {
        const entry = categoryExpenseMap.get(key) ?? {
          categoryId: transaction.categoryId ?? null,
          categoryName,
          amount: 0,
        };
        entry.amount += amount;
        categoryExpenseMap.set(key, entry);
      }
    });

    const categorySummary = {
      income: Array.from(categoryIncomeMap.values()).sort((a, b) => b.amount - a.amount),
      expense: Array.from(categoryExpenseMap.values()).sort((a, b) => b.amount - a.amount),
    };

    type VendorSummaryRow = {
      vendorId: number;
      vendorName: string;
      total: number;
      settled: number;
      outstanding: number;
      lastActivity: string | null;
    };

    const vendorLookup = new Map<number, string>();
    vendors.forEach((vendor) => vendorLookup.set(vendor.id, vendor.name));

    const vendorSummaryMap = new Map<number, VendorSummaryRow>();

    rangeTransactions.forEach((transaction) => {
      if (transaction.counterpartyType !== 'vendor' || !transaction.counterpartyId) {
        return;
      }
      const amount = Math.abs((transaction.baseAmountMinor ?? 0) / 100);
      if (amount === 0) {
        return;
      }
      if (transaction.kind !== 'expense' && transaction.kind !== 'transfer') {
        return;
      }
      if (transaction.kind === 'transfer') {
        const direction = getTransferDirection(transaction.meta);
        if (direction !== 'out') {
          return;
        }
      }

      const entry =
        vendorSummaryMap.get(transaction.counterpartyId) ?? {
          vendorId: transaction.counterpartyId,
          vendorName: vendorLookup.get(transaction.counterpartyId) ?? `Vendor ${transaction.counterpartyId}`,
          total: 0,
          settled: 0,
          outstanding: 0,
          lastActivity: null,
        };
      entry.total += amount;
      if (OUTSTANDING_STATUSES.has(transaction.status)) {
        entry.outstanding += amount;
      } else if (transaction.status === 'paid' || transaction.status === 'reimbursed') {
        entry.settled += amount;
      }
      if (!entry.lastActivity || dayjs(transaction.date).isAfter(dayjs(entry.lastActivity))) {
        entry.lastActivity = transaction.date;
      }
      vendorSummaryMap.set(transaction.counterpartyId, entry);
    });

    type ClientSummaryRow = {
      clientId: number;
      clientName: string;
      total: number;
      settled: number;
      outstanding: number;
      lastActivity: string | null;
    };

    const clientLookup = new Map<number, string>();
    clients.forEach((client) => clientLookup.set(client.id, client.name));

    const clientSummaryMap = new Map<number, ClientSummaryRow>();

    rangeTransactions.forEach((transaction) => {
      if (transaction.counterpartyType !== 'client' || !transaction.counterpartyId) {
        return;
      }
      const amount = Math.abs((transaction.baseAmountMinor ?? 0) / 100);
      if (amount === 0) {
        return;
      }
      if (!['income', 'refund'].includes(transaction.kind)) {
        return;
      }
      const signed = transaction.kind === 'refund' ? -amount : amount;
      const entry =
        clientSummaryMap.get(transaction.counterpartyId) ?? {
          clientId: transaction.counterpartyId,
          clientName: clientLookup.get(transaction.counterpartyId) ?? `Client ${transaction.counterpartyId}`,
          total: 0,
          settled: 0,
          outstanding: 0,
          lastActivity: null,
        };
      entry.total += signed;
      if (OUTSTANDING_STATUSES.has(transaction.status)) {
        entry.outstanding += signed;
      } else if (transaction.status === 'paid' || transaction.status === 'reimbursed') {
        entry.settled += signed;
      }
      if (!entry.lastActivity || dayjs(transaction.date).isAfter(dayjs(entry.lastActivity))) {
        entry.lastActivity = transaction.date;
      }
      clientSummaryMap.set(transaction.counterpartyId, entry);
    });

    const vendorSummary = Array.from(vendorSummaryMap.values()).sort(
      (a, b) => b.outstanding - a.outstanding || b.total - a.total,
    );
    const clientSummary = Array.from(clientSummaryMap.values()).sort(
      (a, b) => b.total - a.total || (b.lastActivity ? dayjs(b.lastActivity).valueOf() : 0),
    );

    res.status(200).json({
      period: {
        start: startDate.format('YYYY-MM-DD'),
        end: endDate.format('YYYY-MM-DD'),
      },
      currency: BASE_CURRENCY,
      profitAndLoss: {
        totals: {
          income: incomeTotal,
          expense: expenseTotal,
          net: incomeTotal - expenseTotal,
        },
        monthly: monthKeys.map((key) => {
          const bucket = monthlyPnL.get(key)!;
          return {
            month: key,
            label: monthLabels.get(key),
            income: bucket.income,
            expense: bucket.expense,
            net: bucket.net,
          };
        }),
        topCategories,
      },
      cashFlow: {
        totals: {
          inflow: inflowTotal,
          outflow: outflowTotal,
          net: inflowTotal - outflowTotal,
        },
        timeline: monthKeys.map((key) => {
          const bucket = monthlyCashFlow.get(key)!;
          return {
            month: key,
            label: monthLabels.get(key),
            inflow: bucket.inflow,
            outflow: bucket.outflow,
          };
        }),
      },
      budgetsVsActual: {
        rows: budgetRows,
        totals: budgetTotals,
      },
      accountSummary,
      categorySummary,
      vendorSummary,
      clientSummary,
    });
  } catch (error) {
    console.error('Failed to load finance reports', error);
    res.status(500).json({ message: 'Unable to load finance reports' });
  }
};
