import { Request, Response } from 'express';
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
import { Op } from 'sequelize';
import FinanceTransaction from '../models/FinanceTransaction.js';
import FinanceBudget from '../models/FinanceBudget.js';
import FinanceCategory from '../models/FinanceCategory.js';

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

    const transactions = await FinanceTransaction.findAll({
      where: {
        date: { [Op.between]: [startIso, endIso] },
        status: { [Op.notIn]: NON_REPORTABLE_STATUSES },
        kind: { [Op.in]: PNL_KINDS },
      },
      attributes: ['date', 'kind', 'baseAmountMinor', 'categoryId'],
      include: [{ model: FinanceCategory, attributes: ['id', 'name'] }],
      order: [['date', 'ASC']],
    });

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
    });
  } catch (error) {
    console.error('Failed to load finance reports', error);
    res.status(500).json({ message: 'Unable to load finance reports' });
  }
};
