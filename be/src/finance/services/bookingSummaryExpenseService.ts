import { QueryTypes } from 'sequelize';
import sequelize from '../../config/database.js';
import { getConfigValue } from '../../services/configService.js';

const DEFAULT_BASE_CURRENCY = 'PLN';
export const BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT = 250;
const EXCLUDED_META_SOURCES = [
  'staff-payments',
  'affiliate-payout',
  'venue-numbers-summary',
] as const;

type ExpenseAggregateRow = {
  baseAmountMinor?: string | number | null;
  transactionCount?: string | number | null;
  transactions?: unknown;
  byCategory?: unknown;
  byDate?: unknown;
};

export type BookingSummaryOtherExpenseTransaction = {
  id: number;
  date: string;
  description: string | null;
  currency: string;
  amountMinor: number;
  baseAmountMinor: number;
  categoryId: number | null;
  categoryName: string;
  vendorId: number | null;
  vendorName: string | null;
  accountId: number;
  accountName: string;
  paymentMethod: string | null;
  source: string | null;
  invoiceFile: BookingSummaryOtherExpenseInvoiceFile | null;
};

export type BookingSummaryOtherExpenseInvoiceFile = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
};

export type BookingSummaryOtherExpenseCategory = {
  categoryId: number | null;
  categoryName: string;
  baseAmountMinor: number;
  transactionCount: number;
};

export type BookingSummaryOtherExpenseDate = {
  date: string;
  baseAmountMinor: number;
  transactionCount: number;
};

export type BookingSummaryCostInsights = {
  otherExpenses: {
    baseCurrency: string;
    baseAmountMinor: number;
    transactionCount: number;
    dateBasis: 'finance_transaction_date';
    productTypeScoped: false;
    transactions: BookingSummaryOtherExpenseTransaction[];
    transactionLimit: number;
    transactionsTruncated: boolean;
    byCategory: BookingSummaryOtherExpenseCategory[];
    byDate: BookingSummaryOtherExpenseDate[];
  };
};

const normalizeDateOnly = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} must be a valid date`);
  }
  return value;
};

const safeDatabaseInteger = (value: unknown, fieldName: string): number => {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${fieldName} exceeds the supported integer range`);
  }
  return parsed;
};

const databaseJsonArray = (value: unknown, fieldName: string): unknown[] => {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${fieldName} must be valid JSON`);
    }
  }
  if (parsed == null) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be an array`);
  }
  return parsed;
};

const databaseRecord = (value: unknown, fieldName: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
  return value as Record<string, unknown>;
};

const databaseString = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
};

const nullableDatabaseString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value : null
);

const nullableDatabaseInteger = (value: unknown, fieldName: string): number | null => (
  value == null ? null : safeDatabaseInteger(value, fieldName)
);

const mapInvoiceFile = (
  value: unknown,
  fieldName: string,
): BookingSummaryOtherExpenseInvoiceFile | null => {
  if (value == null) {
    return null;
  }
  const row = databaseRecord(value, fieldName);
  if (row.id == null) {
    throw new Error(`${fieldName}.id must be a positive integer`);
  }
  if (row.sizeBytes == null) {
    throw new Error(`${fieldName}.sizeBytes must be a non-negative integer`);
  }
  const id = safeDatabaseInteger(row.id, `${fieldName}.id`);
  const sizeBytes = safeDatabaseInteger(row.sizeBytes, `${fieldName}.sizeBytes`);
  if (id <= 0) {
    throw new Error(`${fieldName}.id must be a positive integer`);
  }
  if (sizeBytes < 0) {
    throw new Error(`${fieldName}.sizeBytes must be a non-negative integer`);
  }
  return {
    id,
    originalName: databaseString(row.originalName, `${fieldName}.originalName`),
    mimeType: databaseString(row.mimeType, `${fieldName}.mimeType`),
    sizeBytes,
  };
};

const mapTransactions = (value: unknown): BookingSummaryOtherExpenseTransaction[] => (
  databaseJsonArray(value, 'transactions').map((entry, index) => {
    const row = databaseRecord(entry, `transactions[${index}]`);
    return {
      id: safeDatabaseInteger(row.id, `transactions[${index}].id`),
      date: databaseString(row.date, `transactions[${index}].date`),
      description: nullableDatabaseString(row.description),
      currency: databaseString(row.currency, `transactions[${index}].currency`).toUpperCase(),
      amountMinor: safeDatabaseInteger(row.amountMinor, `transactions[${index}].amountMinor`),
      baseAmountMinor: safeDatabaseInteger(
        row.baseAmountMinor,
        `transactions[${index}].baseAmountMinor`,
      ),
      categoryId: nullableDatabaseInteger(row.categoryId, `transactions[${index}].categoryId`),
      categoryName: databaseString(row.categoryName, `transactions[${index}].categoryName`),
      vendorId: nullableDatabaseInteger(row.vendorId, `transactions[${index}].vendorId`),
      vendorName: nullableDatabaseString(row.vendorName),
      accountId: safeDatabaseInteger(row.accountId, `transactions[${index}].accountId`),
      accountName: databaseString(row.accountName, `transactions[${index}].accountName`),
      paymentMethod: nullableDatabaseString(row.paymentMethod),
      source: nullableDatabaseString(row.source),
      invoiceFile: mapInvoiceFile(row.invoiceFile, `transactions[${index}].invoiceFile`),
    };
  })
);

const mapCategoryBreakdown = (value: unknown): BookingSummaryOtherExpenseCategory[] => (
  databaseJsonArray(value, 'byCategory').map((entry, index) => {
    const row = databaseRecord(entry, `byCategory[${index}]`);
    return {
      categoryId: nullableDatabaseInteger(row.categoryId, `byCategory[${index}].categoryId`),
      categoryName: databaseString(row.categoryName, `byCategory[${index}].categoryName`),
      baseAmountMinor: safeDatabaseInteger(
        row.baseAmountMinor,
        `byCategory[${index}].baseAmountMinor`,
      ),
      transactionCount: safeDatabaseInteger(
        row.transactionCount,
        `byCategory[${index}].transactionCount`,
      ),
    };
  })
);

const mapDateBreakdown = (value: unknown): BookingSummaryOtherExpenseDate[] => (
  databaseJsonArray(value, 'byDate').map((entry, index) => {
    const row = databaseRecord(entry, `byDate[${index}]`);
    return {
      date: databaseString(row.date, `byDate[${index}].date`),
      baseAmountMinor: safeDatabaseInteger(row.baseAmountMinor, `byDate[${index}].baseAmountMinor`),
      transactionCount: safeDatabaseInteger(
        row.transactionCount,
        `byDate[${index}].transactionCount`,
      ),
    };
  })
);

const resolveBaseCurrency = (): string => {
  const configured = String(getConfigValue('FINANCE_BASE_CURRENCY') ?? '')
    .trim()
    .toUpperCase();
  return configured || DEFAULT_BASE_CURRENCY;
};

/**
 * Paid Other Expenses for Booking Summary, expressed in Finance's configured
 * base currency. Staff, affiliate, and venue settlements are deliberately
 * excluded because Booking Summary displays those costs in separate KPIs.
 *
 * The NOT EXISTS checks are the authoritative linkage guard. The source
 * filter also covers legacy/orphaned settlement transactions whose linked log
 * is missing.
 */
export async function getBookingSummaryCostInsights(
  startDateValue: unknown,
  endDateValue: unknown,
): Promise<BookingSummaryCostInsights> {
  const startDate = normalizeDateOnly(startDateValue, 'startDate');
  const endDate = normalizeDateOnly(endDateValue, 'endDate');
  if (startDate > endDate) {
    throw new Error('startDate must not be after endDate');
  }

  const rows = await sequelize.query<ExpenseAggregateRow>(
    `WITH eligible_expenses AS (
       SELECT
         finance_transaction.id,
         finance_transaction.date,
         finance_transaction.description,
         finance_transaction.currency,
         finance_transaction.amount_minor,
         finance_transaction.base_amount_minor,
         finance_transaction.category_id,
         CASE
           WHEN finance_category.name IS NOT NULL THEN finance_category.name
           WHEN finance_transaction.category_id IS NULL THEN 'Uncategorized'
           ELSE 'Category #' || finance_transaction.category_id::text
         END AS category_name,
         CASE
           WHEN finance_transaction.counterparty_type = 'vendor'
             THEN finance_transaction.counterparty_id
           ELSE NULL
         END AS vendor_id,
         CASE
           WHEN finance_transaction.counterparty_type = 'vendor'
             THEN finance_vendor.name
           ELSE NULL
         END AS vendor_name,
         finance_transaction.account_id,
         COALESCE(finance_account.name, 'Account #' || finance_transaction.account_id::text) AS account_name,
         finance_transaction.payment_method,
         NULLIF(BTRIM(finance_transaction.meta->>'source'), '') AS source,
         invoice_file.id AS invoice_file_id,
         invoice_file.original_name AS invoice_file_original_name,
         invoice_file.mime_type AS invoice_file_mime_type,
         invoice_file.size_bytes AS invoice_file_size_bytes
       FROM finance_transactions AS finance_transaction
       LEFT JOIN finance_categories AS finance_category
         ON finance_category.id = finance_transaction.category_id
       LEFT JOIN finance_vendors AS finance_vendor
         ON finance_transaction.counterparty_type = 'vendor'
        AND finance_vendor.id = finance_transaction.counterparty_id
       LEFT JOIN finance_accounts AS finance_account
         ON finance_account.id = finance_transaction.account_id
       LEFT JOIN finance_files AS invoice_file
         ON invoice_file.id = finance_transaction.invoice_file_id
        AND invoice_file.purpose = 'general'
       WHERE finance_transaction.kind = 'expense'
         AND finance_transaction.status = 'paid'
         AND finance_transaction.date BETWEEN :startDate AND :endDate
         AND LOWER(BTRIM(COALESCE(finance_transaction.meta->>'source', ''))) NOT IN (:excludedMetaSources)
         AND NOT EXISTS (
           SELECT 1
           FROM staff_payout_collection_logs AS staff_collection
           WHERE staff_collection.finance_transaction_id = finance_transaction.id
             AND staff_collection.direction = 'payable'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM affiliate_payout_logs AS affiliate_collection
           WHERE affiliate_collection.finance_transaction_id = finance_transaction.id
         )
         AND NOT EXISTS (
           SELECT 1
           FROM venue_compensation_collection_logs AS venue_collection
           WHERE venue_collection.finance_transaction_id = finance_transaction.id
             AND venue_collection.direction = 'payable'
         )
     ),
     transaction_detail AS (
       SELECT *
       FROM eligible_expenses
       ORDER BY date DESC, id DESC
       LIMIT :transactionDetailLimit
     ),
     category_breakdown AS (
       SELECT
         category_id,
         category_name,
         COALESCE(SUM(base_amount_minor), 0) AS base_amount_minor,
         COUNT(*) AS transaction_count
       FROM eligible_expenses
       GROUP BY category_id, category_name
     ),
     date_breakdown AS (
       SELECT
         date,
         COALESCE(SUM(base_amount_minor), 0) AS base_amount_minor,
         COUNT(*) AS transaction_count
       FROM eligible_expenses
       GROUP BY date
     )
     SELECT
       COALESCE(SUM(eligible_expenses.base_amount_minor), 0)::text AS "baseAmountMinor",
       COUNT(*)::text AS "transactionCount",
       COALESCE((
         SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'id', transaction_detail.id,
             'date', transaction_detail.date,
             'description', transaction_detail.description,
             'currency', transaction_detail.currency,
             'amountMinor', transaction_detail.amount_minor,
             'baseAmountMinor', transaction_detail.base_amount_minor,
             'categoryId', transaction_detail.category_id,
             'categoryName', transaction_detail.category_name,
             'vendorId', transaction_detail.vendor_id,
             'vendorName', transaction_detail.vendor_name,
             'accountId', transaction_detail.account_id,
             'accountName', transaction_detail.account_name,
             'paymentMethod', transaction_detail.payment_method,
             'source', transaction_detail.source,
             'invoiceFile', CASE
               WHEN transaction_detail.invoice_file_id IS NULL THEN NULL
               ELSE JSONB_BUILD_OBJECT(
                 'id', transaction_detail.invoice_file_id,
                 'originalName', transaction_detail.invoice_file_original_name,
                 'mimeType', transaction_detail.invoice_file_mime_type,
                 'sizeBytes', transaction_detail.invoice_file_size_bytes
               )
             END
           ) ORDER BY transaction_detail.date DESC, transaction_detail.id DESC
         )
         FROM transaction_detail
       ), '[]'::jsonb) AS transactions,
       COALESCE((
         SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'categoryId', category_breakdown.category_id,
             'categoryName', category_breakdown.category_name,
             'baseAmountMinor', category_breakdown.base_amount_minor::text,
             'transactionCount', category_breakdown.transaction_count::text
           ) ORDER BY category_breakdown.base_amount_minor DESC, category_breakdown.category_name ASC
         )
         FROM category_breakdown
       ), '[]'::jsonb) AS "byCategory",
       COALESCE((
         SELECT JSONB_AGG(
           JSONB_BUILD_OBJECT(
             'date', date_breakdown.date,
             'baseAmountMinor', date_breakdown.base_amount_minor::text,
             'transactionCount', date_breakdown.transaction_count::text
           ) ORDER BY date_breakdown.date ASC
         )
         FROM date_breakdown
       ), '[]'::jsonb) AS "byDate"
     FROM eligible_expenses`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        startDate,
        endDate,
        excludedMetaSources: [...EXCLUDED_META_SOURCES],
        transactionDetailLimit: BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT,
      },
    },
  );

  const aggregate = rows[0] ?? {};
  const transactionCount = safeDatabaseInteger(aggregate.transactionCount, 'transactionCount');
  const transactions = mapTransactions(aggregate.transactions);
  return {
    otherExpenses: {
      baseCurrency: resolveBaseCurrency(),
      baseAmountMinor: safeDatabaseInteger(aggregate.baseAmountMinor, 'baseAmountMinor'),
      transactionCount,
      dateBasis: 'finance_transaction_date',
      productTypeScoped: false,
      transactions,
      transactionLimit: BOOKING_SUMMARY_EXPENSE_DETAIL_LIMIT,
      transactionsTruncated: transactionCount > transactions.length,
      byCategory: mapCategoryBreakdown(aggregate.byCategory),
      byDate: mapDateBreakdown(aggregate.byDate),
    },
  };
}
