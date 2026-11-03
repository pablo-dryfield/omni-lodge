import type { FinanceAccount } from "../../types/finance";

const normalizeAccountName = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_-]+/g, " ");

const CASH_PLN_ACCOUNT_NAMES = new Set([
  "cash register pln",
  "cash pln",
  "cash in pln",
]);

export const selectManualTransactionAccounts = (
  accounts: readonly FinanceAccount[],
  excludedAccountIds: ReadonlySet<number> = new Set<number>(),
): FinanceAccount[] => accounts
  .filter(account => account.isActive && !excludedAccountIds.has(account.id))
  .sort((left, right) => left.name.localeCompare(right.name)
    || left.currency.localeCompare(right.currency) || left.id - right.id);

export const findDefaultCashPlnAccount = (
  accounts: readonly FinanceAccount[],
): FinanceAccount | null => {
  const matches = accounts.filter(account => account.isActive && account.type === "cash"
    && account.currency.trim().toUpperCase() === "PLN"
    && CASH_PLN_ACCOUNT_NAMES.has(normalizeAccountName(account.name)));
  return matches.length === 1 ? matches[0] : null;
};

export const applyDefaultTransactionAccount = <T extends {
  accountId: number | null;
  currency: string;
}>(draft: T, defaultAccount: FinanceAccount | null): T => {
  if (draft.accountId || !defaultAccount) {
    return draft;
  }
  return {
    ...draft,
    accountId: defaultAccount.id,
    currency: defaultAccount.currency.trim().toUpperCase(),
  };
};

export const applyTransactionAccountSelection = <T extends {
  kind: "income" | "expense" | "transfer" | "refund";
  accountId: number | null;
  targetAccountId?: number | null;
  currency: string;
  fxRate: number;
}>(
  draft: T,
  selectedAccount: FinanceAccount | null,
  accounts: readonly FinanceAccount[],
): T => {
  const previousCurrency = draft.currency.trim().toUpperCase();
  const nextCurrency = selectedAccount?.currency.trim().toUpperCase() ?? previousCurrency;
  const nextAccountId = selectedAccount?.id ?? null;
  const currentTarget = accounts.find((account) => account.id === draft.targetAccountId);
  const targetStillCompatible = !draft.targetAccountId || Boolean(
    currentTarget
    && currentTarget.id !== nextAccountId
    && currentTarget.currency.trim().toUpperCase() === nextCurrency,
  );
  const shouldResetFxRate = (
    draft.kind === "transfer"
    || nextCurrency === "PLN"
    || nextCurrency !== previousCurrency
  );

  return {
    ...draft,
    accountId: nextAccountId,
    currency: nextCurrency,
    targetAccountId: draft.kind === "transfer" && !targetStillCompatible
      ? null
      : draft.targetAccountId,
    fxRate: shouldResetFxRate ? 1 : draft.fxRate,
  };
};
