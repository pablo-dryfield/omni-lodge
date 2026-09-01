jest.mock('../../models/FinanceTransaction.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

jest.mock('../../models/FinanceBudget.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

jest.mock('../../models/FinanceCategory.js', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../models/FinanceAccount.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

jest.mock('../../models/FinanceVendor.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

jest.mock('../../models/FinanceClient.js', () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

jest.mock('../../../services/configService.js', () => ({
  getConfigValue: jest.fn(() => 'PLN'),
}));

import type { Request, Response } from 'express';
import FinanceTransaction from '../../models/FinanceTransaction';
import FinanceBudget from '../../models/FinanceBudget';
import FinanceAccount from '../../models/FinanceAccount';
import FinanceVendor from '../../models/FinanceVendor';
import FinanceClient from '../../models/FinanceClient';
import { getFinanceReports } from '../reportController';

const createResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
  };
};

const category = { id: 7, name: 'Operations' };

const makeTransaction = (overrides: Record<string, unknown>) => ({
  id: 1,
  date: '2026-08-15',
  kind: 'expense',
  baseAmountMinor: 10_000,
  amountMinor: 10_000,
  accountId: 3,
  currency: 'PLN',
  status: 'paid',
  categoryId: 7,
  category,
  counterpartyType: 'vendor',
  counterpartyId: 11,
  meta: null,
  ...overrides,
});

describe('finance report actual and forecast accounting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (FinanceBudget.findAll as jest.Mock).mockResolvedValue([
      { categoryId: 7, category, amountMinor: 50_000 },
    ]);
    (FinanceAccount.findAll as jest.Mock).mockResolvedValue([
      {
        id: 3,
        name: 'Cash PLN',
        currency: 'PLN',
        openingBalanceMinor: 100_000,
        isActive: true,
      },
    ]);
    (FinanceVendor.findAll as jest.Mock).mockResolvedValue([{ id: 11, name: 'Supplier' }]);
    (FinanceClient.findAll as jest.Mock).mockResolvedValue([{ id: 21, name: 'Customer' }]);
  });

  it('keeps planned activity out of actuals and avoids double-counting staff reimbursements', async () => {
    (FinanceTransaction.findAll as jest.Mock).mockResolvedValue([
      makeTransaction({ id: 1, status: 'paid', amountMinor: 10_000, baseAmountMinor: 10_000 }),
      makeTransaction({ id: 2, status: 'awaiting_reimbursement', amountMinor: 2_000, baseAmountMinor: 2_000 }),
      makeTransaction({ id: 3, status: 'reimbursed', amountMinor: 3_000, baseAmountMinor: 3_000 }),
      makeTransaction({
        id: 4,
        status: 'paid',
        amountMinor: 3_000,
        baseAmountMinor: 3_000,
        meta: { source: 'staff-payments', lineLabel: 'Reimbursements' },
      }),
      makeTransaction({ id: 5, status: 'planned', amountMinor: 5_000, baseAmountMinor: 5_000 }),
      makeTransaction({
        id: 6,
        status: 'approved',
        kind: 'income',
        amountMinor: 7_000,
        baseAmountMinor: 7_000,
        counterpartyType: 'client',
        counterpartyId: 21,
      }),
      makeTransaction({
        id: 7,
        status: 'paid',
        kind: 'income',
        amountMinor: 20_000,
        baseAmountMinor: 20_000,
        counterpartyType: 'client',
        counterpartyId: 21,
      }),
      makeTransaction({ id: 8, status: 'void', amountMinor: 99_900, baseAmountMinor: 99_900 }),
    ]);

    const response = createResponse();
    await getFinanceReports(
      {
        query: { startDate: '2026-08-01', endDate: '2026-08-31' },
      } as unknown as Request,
      response,
    );

    expect(response.status).toHaveBeenCalledWith(200);
    const result = response.json.mock.calls[0][0];

    expect(result.profitAndLoss.totals).toEqual({ income: 200, expense: 150, net: 50 });
    expect(result.profitAndLoss.forecast.totals).toEqual({ income: 70, expense: 50, net: 20 });
    expect(result.cashFlow.totals).toEqual({ inflow: 200, outflow: 130, net: 70 });
    expect(result.cashFlow.forecast.totals).toEqual({ inflow: 70, outflow: 50, net: 20 });

    expect(result.budgetsVsActual.rows).toEqual([
      expect.objectContaining({
        categoryId: 7,
        budget: 500,
        actual: 150,
        forecast: 50,
        projected: 200,
        variance: -350,
        projectedVariance: -300,
      }),
    ]);

    expect(result.accountSummary).toEqual([
      expect.objectContaining({
        accountId: 3,
        inflow: 200,
        outflow: 130,
        net: 70,
        closingBalance: 1070,
        forecastInflow: 70,
        forecastOutflow: 50,
        forecastNet: 20,
        projectedClosingBalance: 1090,
        outstanding: 20,
      }),
    ]);

    expect(result.categorySummary.expense).toEqual([
      expect.objectContaining({ categoryId: 7, amount: 150 }),
    ]);
    expect(result.categorySummary.forecast.expense).toEqual([
      expect.objectContaining({ categoryId: 7, amount: 50 }),
    ]);
    expect(result.vendorSummary).toEqual([
      expect.objectContaining({
        vendorId: 11,
        total: 150,
        settled: 150,
        awaitingReimbursement: 20,
        forecast: 50,
        projectedTotal: 200,
        outstanding: 50,
      }),
    ]);
    expect(result.clientSummary).toEqual([
      expect.objectContaining({
        clientId: 21,
        total: 200,
        settled: 200,
        forecast: 70,
        projectedTotal: 270,
        outstanding: 70,
      }),
    ]);
  });
});
