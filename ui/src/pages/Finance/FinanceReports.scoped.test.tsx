import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import axiosInstance from '../../utils/axiosInstance';
import FinanceReports from './FinanceReports';
jest.mock('../../utils/axiosInstance', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('axios', () => ({ isAxiosError: jest.fn(() => false) }));
jest.mock('../../components/finance/FinanceReportsChart', () => ({ __esModule: true, default: () => null }));
beforeEach(() => {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({
    matches: false, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(),
  })) });
});
it('labels the limited ledger report clearly and omits company bank/budget sections', async () => {
  (axiosInstance.get as jest.Mock).mockResolvedValue({ data: {
    productTypeIds: [3], excludesCompanyWideBalances: true,
    period: { start: '2026-10-01', end: '2026-10-31' }, currency: 'PLN',
    profitAndLoss: { totals: { income: 90, expense: 0, net: 90 }, monthly: [], topCategories: [] },
    cashFlow: { totals: { inflow: 90, outflow: 0, net: 90 }, timeline: [] },
    budgetsVsActual: { rows: [], totals: { budget: 0, actual: 0, variance: 0 } },
    accountSummary: [], vendorSummary: [], clientSummary: [], categorySummary: { income: [], expense: [] },
  } });
  render(<MantineProvider><FinanceReports /></MantineProvider>);
  expect(await screen.findByText('Product-scoped financial report')).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Accounts' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Budgets vs Actual' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Cash Flow' })).toBeInTheDocument();
  expect(screen.getByText(/company budgets and bank balances are excluded/i)).toBeInTheDocument();
});
