import HttpError from '../errors/HttpError.js';

export type StaffPayoutBatchDirection = 'payable' | 'receivable';

export type StaffPayoutFinanceLineSelection = {
  accountId: number;
  categoryId: number;
  currency: string | null;
};

export type StaffPayoutFinanceAccountRecord = {
  id: number;
  currency: string;
  isActive: boolean;
};

export type StaffPayoutFinanceCategoryRecord = {
  id: number;
  kind: string;
  isActive: boolean;
};

export type StaffPayoutReimbursementSourceRecord = {
  id: number;
  kind: string;
  status: string;
  date: string;
  currency: string;
  amountMinor: number;
  baseAmountMinor: number;
  counterpartyId: number | null;
  meta: Record<string, unknown> | null;
};

const normalizeCurrency = (value: unknown, field: string): string => {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new HttpError(400, `${field} must be a valid three-letter currency code.`);
  }
  return currency;
};

const normalizePositiveUserId = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

export const parseStrictStaffPayoutDate = (raw: unknown): string => {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, 'date must use YYYY-MM-DD format.');
  }
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new HttpError(400, 'date must be a valid calendar date.');
  }
  return raw;
};

export const assertStaffPayoutDirectionDetails = (params: {
  direction: StaffPayoutBatchDirection;
  hasReimbursement: boolean;
  hasAffiliatePayout: boolean;
}): void => {
  if (params.direction === 'receivable' && params.hasReimbursement) {
    throw new HttpError(400, 'Reimbursements can only be included in payable staff batches.');
  }
  if (params.direction === 'receivable' && params.hasAffiliatePayout) {
    throw new HttpError(400, 'Affiliate commissions can only be included in payable staff batches.');
  }
};

export const assertUniqueStaffAffiliatePayoutClaims = (params: {
  staffUserId: number;
  claims: Array<{ affiliateUserId: number; bookingIds: number[] }>;
}): void => {
  const claimedBookingIds = new Set<number>();
  params.claims.forEach((claim) => {
    if (claim.affiliateUserId !== params.staffUserId) {
      throw new HttpError(400, 'Affiliate payout user must match the staff payout user.');
    }
    claim.bookingIds.forEach((bookingId) => {
      if (claimedBookingIds.has(bookingId)) {
        throw new HttpError(400, `Affiliate booking ${bookingId} is included in more than one payout line.`);
      }
      claimedBookingIds.add(bookingId);
    });
  });
};

export const validateStaffPayoutFinanceSelections = (params: {
  direction: StaffPayoutBatchDirection;
  lines: StaffPayoutFinanceLineSelection[];
  reimbursement: { accountId: number; categoryId: number } | null;
  accounts: StaffPayoutFinanceAccountRecord[];
  categories: StaffPayoutFinanceCategoryRecord[];
  baseCurrency: string;
}): { lineCurrencies: string[]; reimbursementCurrency: string | null } => {
  const accountsById = new Map(params.accounts.map((account) => [Number(account.id), account]));
  const categoriesById = new Map(params.categories.map((category) => [Number(category.id), category]));
  const expectedCategoryKind = params.direction === 'payable' ? 'expense' : 'income';

  const validateAccount = (accountId: number, field: string): string => {
    const account = accountsById.get(accountId);
    if (!account || !account.isActive) {
      throw new HttpError(400, `${field} must reference an active finance account.`);
    }
    return normalizeCurrency(account.currency, `${field} currency`);
  };

  const validateCategory = (categoryId: number, expectedKind: string, field: string): void => {
    const category = categoriesById.get(categoryId);
    if (!category || !category.isActive || category.kind !== expectedKind) {
      throw new HttpError(400, `${field} must reference an active ${expectedKind} category.`);
    }
  };

  const lineCurrencies = params.lines.map((line, index) => {
    const accountCurrency = validateAccount(line.accountId, `lines[${index}].accountId`);
    validateCategory(line.categoryId, expectedCategoryKind, `lines[${index}].categoryId`);
    if (line.currency && normalizeCurrency(line.currency, `lines[${index}].currency`) !== accountCurrency) {
      throw new HttpError(400, `lines[${index}].currency must match the selected account currency.`);
    }
    return accountCurrency;
  });

  let reimbursementCurrency: string | null = null;
  if (params.reimbursement) {
    reimbursementCurrency = validateAccount(params.reimbursement.accountId, 'reimbursement.accountId');
    validateCategory(params.reimbursement.categoryId, 'expense', 'reimbursement.categoryId');
    if (reimbursementCurrency !== normalizeCurrency(params.baseCurrency, 'Base currency')) {
      throw new HttpError(400, 'Reimbursements must be paid from an account in the finance base currency.');
    }
  }

  return { lineCurrencies, reimbursementCurrency };
};

export const deriveStaffPayoutReimbursementAmount = (params: {
  requestedTransactionIds: number[];
  requestedAmountMinor: number;
  sourceRows: StaffPayoutReimbursementSourceRecord[];
  staffUserId: number;
  staffVendorId: number;
  rangeStart: string;
  rangeEnd: string;
  baseCurrency: string;
  requireAwaitingStatus?: boolean;
}): number => {
  const requestedIds = [...params.requestedTransactionIds];
  const uniqueRequestedIds = new Set(requestedIds);
  if (requestedIds.length === 0 || uniqueRequestedIds.size !== requestedIds.length) {
    throw new HttpError(400, 'Reimbursement entries must contain unique finance transaction IDs.');
  }
  if (
    params.sourceRows.length !== requestedIds.length
    || params.sourceRows.some((row) => !uniqueRequestedIds.has(Number(row.id)))
  ) {
    throw new HttpError(400, 'One or more reimbursement transactions were not found.');
  }

  const baseCurrency = normalizeCurrency(params.baseCurrency, 'Base currency');
  let amountMinor = 0;
  for (const row of params.sourceRows) {
    if (row.kind !== 'expense') {
      throw new HttpError(400, `Finance transaction ${row.id} is not an expense reimbursement.`);
    }
    if (params.requireAwaitingStatus !== false && row.status !== 'awaiting_reimbursement') {
      throw new HttpError(409, `Finance transaction ${row.id} is no longer awaiting reimbursement.`);
    }
    if (row.date < params.rangeStart || row.date > params.rangeEnd) {
      throw new HttpError(400, `Finance transaction ${row.id} is outside the selected payout period.`);
    }

    const meta = row.meta && typeof row.meta === 'object' ? row.meta : null;
    const attributedUserId = normalizePositiveUserId(meta?.paidByUserId ?? meta?.staffUserId);
    const belongsToStaff = attributedUserId
      ? attributedUserId === params.staffUserId
      : Number(row.counterpartyId) === params.staffVendorId;
    if (!belongsToStaff) {
      throw new HttpError(400, `Finance transaction ${row.id} does not belong to the selected staff member.`);
    }

    normalizeCurrency(row.currency, `Finance transaction ${row.id} currency`);
    const rowBaseAmountMinor = Number(row.baseAmountMinor);
    if (!Number.isInteger(rowBaseAmountMinor) || rowBaseAmountMinor <= 0) {
      throw new HttpError(400, `Finance transaction ${row.id} has an invalid base amount.`);
    }
    amountMinor += rowBaseAmountMinor;
  }

  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new HttpError(400, 'Reimbursement total is invalid.');
  }
  if (amountMinor !== params.requestedAmountMinor) {
    throw new HttpError(409, 'Reimbursement total changed. Refresh Pays and try again.');
  }

  return amountMinor;
};
