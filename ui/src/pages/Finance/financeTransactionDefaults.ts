import type { FinanceAccount } from "../../types/finance";

const normalizeAccountName = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_-]+/g, " ");

const CASH_PLN_ACCOUNT_NAMES = new Set([
  "cash register pln",
  "cash pln",
  "cash in pln",
]);

const MANUAL_TRANSACTION_ACCOUNT_RULES = [
  {
    names: CASH_PLN_ACCOUNT_NAMES,
    type: "cash",
    currency: "PLN",
  },
  {
    names: new Set(["cash register eur", "cash eur", "cash in eur"]),
    type: "cash",
    currency: "EUR",
  },
  {
    names: new Set(["dave"]),
    type: "cash",
    currency: "PLN",
  },
] as const;

export const selectManualTransactionAccounts = (
  accounts: readonly FinanceAccount[],
  volunteerFundLinkedAccountIds: ReadonlySet<number> = new Set<number>(),
): FinanceAccount[] => {
  const operationalAccounts = MANUAL_TRANSACTION_ACCOUNT_RULES.flatMap((rule) => {
    const matches = accounts
      .filter((account) => (
        account.isActive
        && account.type === rule.type
        && account.currency.trim().toUpperCase() === rule.currency
        && rule.names.has(normalizeAccountName(account.name))
      ))
      .sort((left, right) => left.id - right.id);
    return matches.length === 1 ? [matches[0]] : [];
  });
  const operationalIds = new Set(operationalAccounts.map(({ id }) => id));
  const linkedFundAccounts = accounts
    .filter((account) => (
      account.isActive
      && volunteerFundLinkedAccountIds.has(account.id)
      && !operationalIds.has(account.id)
    ))
    .sort((left, right) => left.id - right.id);

  return [...operationalAccounts, ...linkedFundAccounts];
};

export const findDefaultCashPlnAccount = (
  accounts: readonly FinanceAccount[],
): FinanceAccount | null => selectManualTransactionAccounts(accounts).find((account) => (
  account.currency.trim().toUpperCase() === "PLN"
  && CASH_PLN_ACCOUNT_NAMES.has(normalizeAccountName(account.name))
)) ?? null;

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
