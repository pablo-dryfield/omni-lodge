jest.mock('../../../config/database.js', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock('../../../services/configService.js', () => ({
  getConfigValue: jest.fn(),
}));

import { QueryTypes } from 'sequelize';
import sequelize from '../../../config/database.js';
import { getConfigValue } from '../../../services/configService.js';
import {
  BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT,
  getBookingSummaryCostInsights,
} from '../bookingSummaryExpenseService.js';

const query = sequelize.query as jest.Mock;
const configValue = getConfigValue as jest.Mock;

describe('getBookingSummaryCostInsights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configValue.mockReturnValue('pln');
  });

  it('aggregates only paid Finance expenses in the exact inclusive transaction-date range', async () => {
    query.mockResolvedValue([{ baseAmountMinor: '12650', transactionCount: '4' }]);

    const result = await getBookingSummaryCostInsights('2026-08-03', '2026-08-17');

    expect(result).toEqual({
      otherExpenses: {
        baseCurrency: 'PLN',
        baseAmountMinor: 12650,
        transactionCount: 4,
        dateBasis: 'finance_transaction_date',
        productTypeScoped: false,
        transactions: [],
        transactionLimit: BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT,
        transactionsTruncated: true,
        byCategory: [],
        byDate: [],
      },
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, options] = query.mock.calls[0];
    expect(sql).toContain("finance_transaction.kind = 'expense'");
    expect(sql).toContain("finance_transaction.status = 'paid'");
    expect(sql).toContain('finance_transaction.date BETWEEN :startDate AND :endDate');
    expect(sql).toContain('SUM(eligible_expenses.base_amount_minor)');
    expect(sql).toContain('LIMIT :transactionDetailLimit');
    expect(sql).toContain('GROUP BY category_id, category_name');
    expect(sql).toContain('GROUP BY date');
    expect(sql).toContain('LEFT JOIN finance_files AS invoice_file');
    expect(sql).toContain("invoice_file.purpose = 'general'");
    expect(sql).toContain("'invoiceFile', CASE");
    expect(sql).not.toContain('drive_file_id');
    expect(sql).not.toContain('drive_web_view_link');
    expect(sql).not.toContain('sha256');
    expect(options).toEqual({
      type: QueryTypes.SELECT,
      replacements: {
        startDate: '2026-08-03',
        endDate: '2026-08-17',
        excludedMetaSources: [
          'staff-payments',
          'affiliate-payout',
          'venue-numbers-summary',
        ],
        transactionDetailLimit: BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT,
      },
    });
  });

  it('excludes canonical and linked staff, affiliate, and payable venue settlements', async () => {
    query.mockResolvedValue([{ baseAmountMinor: '0', transactionCount: '0' }]);

    await getBookingSummaryCostInsights('2026-08-01', '2026-08-31');

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("meta->>'source'");
    expect(sql).toContain('staff_payout_collection_logs');
    expect(sql).toContain("staff_collection.direction = 'payable'");
    expect(sql).toContain('affiliate_payout_logs');
    expect(sql).toContain('venue_compensation_collection_logs');
    expect(sql).toContain("venue_collection.direction = 'payable'");
  });

  it('returns a zero aggregate and the configured base currency when no row is returned', async () => {
    configValue.mockReturnValue('eur');
    query.mockResolvedValue([]);

    await expect(
      getBookingSummaryCostInsights('2026-08-01', '2026-08-01'),
    ).resolves.toEqual({
      otherExpenses: {
        baseCurrency: 'EUR',
        baseAmountMinor: 0,
        transactionCount: 0,
        dateBasis: 'finance_transaction_date',
        productTypeScoped: false,
        transactions: [],
        transactionLimit: BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT,
        transactionsTruncated: false,
        byCategory: [],
        byDate: [],
      },
    });
  });

  it('returns bounded transaction detail and complete chart breakdowns in base minor units', async () => {
    query.mockResolvedValue([{
      baseAmountMinor: '20250',
      transactionCount: '2',
      transactions: [{
        id: 91,
        date: '2026-08-17',
        description: 'Supplies',
        currency: 'pln',
        amountMinor: 10050,
        baseAmountMinor: 10050,
        categoryId: 8,
        categoryName: 'Operations',
        vendorId: 11,
        vendorName: 'Local Shop',
        accountId: 3,
        accountName: 'Cash PLN',
        paymentMethod: 'cash',
        source: 'manual',
        invoiceFile: {
          id: 44,
          originalName: 'supplies.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          driveFileId: 'must-not-leak',
          driveWebViewLink: 'https://drive.example/private',
          sha256: 'must-not-leak',
        },
      }, {
        id: 90,
        date: '2026-08-16',
        description: null,
        currency: 'EUR',
        amountMinor: 2000,
        baseAmountMinor: 10200,
        categoryId: null,
        categoryName: 'Uncategorized',
        vendorId: null,
        vendorName: null,
        accountId: 4,
        accountName: 'Cash EUR',
        paymentMethod: null,
        source: null,
        invoiceFile: null,
      }],
      byCategory: JSON.stringify([{
        categoryId: 8,
        categoryName: 'Operations',
        baseAmountMinor: '10050',
        transactionCount: '1',
      }, {
        categoryId: null,
        categoryName: 'Uncategorized',
        baseAmountMinor: '10200',
        transactionCount: '1',
      }]),
      byDate: [{
        date: '2026-08-16',
        baseAmountMinor: '10200',
        transactionCount: '1',
      }, {
        date: '2026-08-17',
        baseAmountMinor: '10050',
        transactionCount: '1',
      }],
    }]);

    const result = await getBookingSummaryCostInsights('2026-08-01', '2026-08-31');

    expect(result.otherExpenses).toEqual(expect.objectContaining({
      baseAmountMinor: 20250,
      transactionCount: 2,
      transactionsTruncated: false,
      transactions: [
        expect.objectContaining({
          id: 91,
          currency: 'PLN',
          baseAmountMinor: 10050,
          categoryName: 'Operations',
          vendorName: 'Local Shop',
          accountName: 'Cash PLN',
          invoiceFile: {
            id: 44,
            originalName: 'supplies.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 4096,
          },
        }),
        expect.objectContaining({ id: 90, categoryName: 'Uncategorized', invoiceFile: null }),
      ],
      byCategory: [
        {
          categoryId: 8,
          categoryName: 'Operations',
          baseAmountMinor: 10050,
          transactionCount: 1,
        },
        {
          categoryId: null,
          categoryName: 'Uncategorized',
          baseAmountMinor: 10200,
          transactionCount: 1,
        },
      ],
      byDate: [
        { date: '2026-08-16', baseAmountMinor: 10200, transactionCount: 1 },
        { date: '2026-08-17', baseAmountMinor: 10050, transactionCount: 1 },
      ],
    }));
  });

  it('marks transaction detail as truncated without truncating aggregate or chart totals', async () => {
    query.mockResolvedValue([{
      baseAmountMinor: '999999',
      transactionCount: String(BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT + 1),
      transactions: Array.from({ length: BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT }, (_, index) => ({
        id: index + 1,
        date: '2026-08-01',
        description: null,
        currency: 'PLN',
        amountMinor: 100,
        baseAmountMinor: 100,
        categoryId: null,
        categoryName: 'Uncategorized',
        vendorId: null,
        vendorName: null,
        accountId: 1,
        accountName: 'Cash PLN',
        paymentMethod: null,
        source: 'manual',
      })),
      byCategory: [{
        categoryId: null,
        categoryName: 'Uncategorized',
        baseAmountMinor: '999999',
        transactionCount: String(BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT + 1),
      }],
      byDate: [{
        date: '2026-08-01',
        baseAmountMinor: '999999',
        transactionCount: String(BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT + 1),
      }],
    }]);

    const result = await getBookingSummaryCostInsights('2026-08-01', '2026-08-31');

    expect(result.otherExpenses.transactions).toHaveLength(BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT);
    expect(result.otherExpenses.transactionsTruncated).toBe(true);
    expect(result.otherExpenses.baseAmountMinor).toBe(999999);
    expect(result.otherExpenses.byCategory[0].baseAmountMinor).toBe(999999);
    expect(result.otherExpenses.byDate[0].transactionCount).toBe(
      BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT + 1,
    );
  });

  it('rejects malformed invoice metadata instead of returning an unsafe partial file', async () => {
    query.mockResolvedValue([{
      baseAmountMinor: '100',
      transactionCount: '1',
      transactions: [{
        id: 1,
        date: '2026-08-01',
        description: null,
        currency: 'PLN',
        amountMinor: 100,
        baseAmountMinor: 100,
        categoryId: null,
        categoryName: 'Uncategorized',
        vendorId: null,
        vendorName: null,
        accountId: 1,
        accountName: 'Cash PLN',
        paymentMethod: null,
        source: null,
        invoiceFile: {
          id: 4,
          originalName: 'receipt.pdf',
          mimeType: 'application/pdf',
          sizeBytes: -1,
        },
      }],
      byCategory: [],
      byDate: [],
    }]);

    await expect(
      getBookingSummaryCostInsights('2026-08-01', '2026-08-01'),
    ).rejects.toThrow('transactions[0].invoiceFile.sizeBytes must be a non-negative integer');
  });

  it.each([
    ['not-a-date', '2026-08-31', 'startDate must use YYYY-MM-DD'],
    ['2026-02-30', '2026-08-31', 'startDate must be a valid date'],
    ['2026-09-01', '2026-08-31', 'startDate must not be after endDate'],
  ])('rejects an invalid range before querying: %s to %s', async (startDate, endDate, message) => {
    await expect(getBookingSummaryCostInsights(startDate, endDate)).rejects.toThrow(message);
    expect(query).not.toHaveBeenCalled();
  });
});
