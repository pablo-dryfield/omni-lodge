import type {
  BookingOpenBarRateBand,
  BookingOtherExpenseCategoryDetail,
  BookingOtherExpenseDateDetail,
  BookingOtherExpenseInvoiceFile,
  BookingOtherExpenseTransactionDetail,
  BookingStaffPaymentBreakdown,
} from "../components/bookings/BookingCostsDashboard";

export type BookingOtherExpensesInsight = {
  currency: string;
  amount: number;
  transactionCount: number;
  dateBasis: "finance_transaction_date";
  productTypeScoped: false;
  categories: BookingOtherExpenseCategoryDetail[];
  dates: BookingOtherExpenseDateDetail[];
  transactions: BookingOtherExpenseTransactionDetail[];
  transactionLimit: number;
  transactionsTruncated: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const asSafeInteger = (value: unknown, minimum = 0): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : null;

const asNullableSafeInteger = (value: unknown, minimum = 0): number | null | undefined => {
  if (value == null) return null;
  const parsed = asSafeInteger(value, minimum);
  return parsed == null ? undefined : parsed;
};

const asRequiredText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const asNullableText = (value: unknown): string | null | undefined => {
  if (value == null) return null;
  return typeof value === "string" ? value.trim() || null : undefined;
};

const isCurrency = (value: string): boolean => /^[A-Z]{3}$/.test(value);

const parseInvoiceFile = (value: unknown): BookingOtherExpenseInvoiceFile | null | undefined => {
  if (value == null) return null;
  const row = asRecord(value);
  const id = asSafeInteger(row?.id, 1);
  const originalName = asRequiredText(row?.originalName);
  const mimeType = asRequiredText(row?.mimeType);
  const sizeBytes = asSafeInteger(row?.sizeBytes);
  if (!row || id == null || !originalName || !mimeType || sizeBytes == null) return undefined;
  return { id, originalName, mimeType, sizeBytes };
};

const OPEN_BAR_TICKET_TYPES = new Set(["normal", "cocktail", "brunch", "generic"]);
const OPEN_BAR_RATE_UNITS = new Set(["per_person", "flat"]);
const OPEN_BAR_RATE_SOURCES = new Set(["ticket_rate", "generic_rate", "term_default"]);

export const parseBookingOpenBarRateBands = (value: unknown): BookingOpenBarRateBand[] => {
  if (!Array.isArray(value)) return [];
  return value.reduce<BookingOpenBarRateBand[]>((rows, entry) => {
    const row = asRecord(entry);
    const ticketType = row?.ticketType;
    const configuredTicketType = row?.configuredTicketType;
    const count = asSafeInteger(row?.count);
    const rateBandId = asNullableSafeInteger(row?.rateBandId, 1);
    const rateAmount = row?.rateAmount;
    const rateUnit = row?.rateUnit;
    const source = row?.source;
    const amount = row?.amount;
    if (
      !row
      || typeof ticketType !== "string"
      || !OPEN_BAR_TICKET_TYPES.has(ticketType)
      || typeof configuredTicketType !== "string"
      || !OPEN_BAR_TICKET_TYPES.has(configuredTicketType)
      || count == null
      || rateBandId === undefined
      || typeof rateAmount !== "number"
      || !Number.isFinite(rateAmount)
      || rateAmount < 0
      || typeof rateUnit !== "string"
      || !OPEN_BAR_RATE_UNITS.has(rateUnit)
      || typeof source !== "string"
      || !OPEN_BAR_RATE_SOURCES.has(source)
      || typeof amount !== "number"
      || !Number.isFinite(amount)
      || amount < 0
    ) {
      return rows;
    }
    rows.push({
      ticketType: ticketType as BookingOpenBarRateBand["ticketType"],
      configuredTicketType: configuredTicketType as BookingOpenBarRateBand["configuredTicketType"],
      count,
      rateBandId,
      rateAmount,
      rateUnit: rateUnit as BookingOpenBarRateBand["rateUnit"],
      source: source as BookingOpenBarRateBand["source"],
      amount,
    });
    return rows;
  }, []);
};

export const parseBookingStaffPaymentBreakdown = (
  value: unknown,
): BookingStaffPaymentBreakdown[] | null => {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const rows: BookingStaffPaymentBreakdown[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const label = asRequiredText(row?.label);
    const category = asRequiredText(row?.category);
    const amount = row?.amount;
    const earningStart = asNullableText(row?.earningStart);
    const earningEnd = asNullableText(row?.earningEnd);
    const staffType = asNullableText(row?.staffType);
    if (
      !row
      || !label
      || !category
      || typeof amount !== "number"
      || !Number.isFinite(amount)
      || earningStart === undefined
      || earningEnd === undefined
      || staffType === undefined
    ) {
      return null;
    }
    rows.push({
      label,
      category,
      amount,
      earningStart,
      earningEnd,
      staffType,
    });
  }
  return rows;
};

const parseCategories = (value: unknown): BookingOtherExpenseCategoryDetail[] | null => {
  if (!Array.isArray(value)) return null;
  const rows: BookingOtherExpenseCategoryDetail[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const categoryId = asNullableSafeInteger(row?.categoryId, 1);
    const categoryName = asRequiredText(row?.categoryName);
    const baseAmountMinor = asSafeInteger(row?.baseAmountMinor);
    const transactionCount = asSafeInteger(row?.transactionCount);
    if (!row || categoryId === undefined || !categoryName || baseAmountMinor == null || transactionCount == null) {
      return null;
    }
    rows.push({
      categoryId,
      categoryName,
      amount: baseAmountMinor / 100,
      transactionCount,
    });
  }
  return rows;
};

const parseDates = (value: unknown): BookingOtherExpenseDateDetail[] | null => {
  if (!Array.isArray(value)) return null;
  const rows: BookingOtherExpenseDateDetail[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const date = asRequiredText(row?.date);
    const baseAmountMinor = asSafeInteger(row?.baseAmountMinor);
    const transactionCount = asSafeInteger(row?.transactionCount);
    if (!row || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || baseAmountMinor == null || transactionCount == null) {
      return null;
    }
    rows.push({ date, amount: baseAmountMinor / 100, transactionCount });
  }
  return rows;
};

const parseTransactions = (
  value: unknown,
  baseCurrency: string,
): BookingOtherExpenseTransactionDetail[] | null => {
  if (!Array.isArray(value)) return null;
  const rows: BookingOtherExpenseTransactionDetail[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    const id = asSafeInteger(row?.id, 1);
    const date = asRequiredText(row?.date);
    const description = asNullableText(row?.description);
    const currency = String(row?.currency ?? "").trim().toUpperCase();
    const amountMinor = asSafeInteger(row?.amountMinor);
    const baseAmountMinor = asSafeInteger(row?.baseAmountMinor);
    const categoryId = asNullableSafeInteger(row?.categoryId, 1);
    const categoryName = asRequiredText(row?.categoryName);
    const vendorId = asNullableSafeInteger(row?.vendorId, 1);
    const vendorName = asNullableText(row?.vendorName);
    const accountId = asSafeInteger(row?.accountId, 1);
    const accountName = asRequiredText(row?.accountName);
    const paymentMethod = asNullableText(row?.paymentMethod);
    const source = asNullableText(row?.source);
    const invoiceFile = parseInvoiceFile(row?.invoiceFile);
    if (
      !row ||
      id == null ||
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !isCurrency(currency) ||
      amountMinor == null ||
      baseAmountMinor == null ||
      categoryId === undefined ||
      !categoryName ||
      vendorId === undefined ||
      vendorName === undefined ||
      accountId == null ||
      !accountName ||
      description === undefined ||
      paymentMethod === undefined ||
      source === undefined ||
      invoiceFile === undefined
    ) {
      return null;
    }
    rows.push({
      id,
      date,
      description,
      currency,
      amount: amountMinor / 100,
      baseCurrency,
      baseAmount: baseAmountMinor / 100,
      categoryId,
      categoryName,
      vendorId,
      vendorName,
      accountId,
      accountName,
      paymentMethod,
      source,
      invoiceFile,
    });
  }
  return rows;
};

export const parseBookingOtherExpensesInsight = (
  value: unknown,
): BookingOtherExpensesInsight | null => {
  const insights = asRecord(value);
  const otherExpenses = asRecord(insights?.otherExpenses);
  if (!otherExpenses) {
    return null;
  }

  const currency = String(otherExpenses.baseCurrency ?? "")
    .trim()
    .toUpperCase();
  const baseAmountMinor = otherExpenses.baseAmountMinor;
  const transactionCount = otherExpenses.transactionCount;
  const dateBasis = otherExpenses.dateBasis;
  const productTypeScoped = otherExpenses.productTypeScoped;
  const transactionLimit = asSafeInteger(otherExpenses.transactionLimit, 1);
  const transactionsTruncated = otherExpenses.transactionsTruncated;
  const categories = parseCategories(otherExpenses.byCategory);
  const dates = parseDates(otherExpenses.byDate);
  const transactions = parseTransactions(otherExpenses.transactions, currency);

  if (
    !/^[A-Z]{3}$/.test(currency) ||
    typeof baseAmountMinor !== "number" ||
    !Number.isSafeInteger(baseAmountMinor) ||
    baseAmountMinor < 0 ||
    typeof transactionCount !== "number" ||
    !Number.isSafeInteger(transactionCount) ||
    transactionCount < 0 ||
    dateBasis !== "finance_transaction_date" ||
    productTypeScoped !== false ||
    transactionLimit == null ||
    typeof transactionsTruncated !== "boolean" ||
    categories == null ||
    dates == null ||
    transactions == null ||
    transactions.length > transactionLimit ||
    (!transactionsTruncated && transactions.length !== transactionCount) ||
    (transactionsTruncated && transactionCount <= transactions.length)
  ) {
    return null;
  }

  return {
    currency,
    amount: baseAmountMinor / 100,
    transactionCount,
    dateBasis,
    productTypeScoped,
    categories,
    dates,
    transactions,
    transactionLimit,
    transactionsTruncated,
  };
};
