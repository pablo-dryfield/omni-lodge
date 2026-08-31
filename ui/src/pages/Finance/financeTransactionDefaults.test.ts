import type { FinanceAccount } from "../../types/finance";
import {
  applyDefaultTransactionAccount,
  applyTransactionAccountSelection,
  findDefaultCashPlnAccount,
  selectManualTransactionAccounts,
} from "./financeTransactionDefaults";

const account = (overrides: Partial<FinanceAccount>): FinanceAccount => ({
  id: 1,
  name: "Cash Register PLN",
  type: "cash",
  currency: "PLN",
  openingBalanceMinor: 0,
  isActive: true,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: null,
  ...overrides,
});

describe("finance transaction defaults", () => {
  it("selects the canonical Cash Register PLN account among multiple cash accounts", () => {
    const preferred = account({ id: 8 });
    const result = findDefaultCashPlnAccount([
      account({ id: 2, name: "Dave" }),
      preferred,
      account({ id: 4, name: "Staff Reimbursements" }),
    ]);

    expect(result?.id).toBe(8);
  });

  it("matches the canonical account without depending on casing or separators", () => {
    expect(findDefaultCashPlnAccount([
      account({ name: "  CASH_REGISTER PLN  " }),
      account({ id: 2, name: "Dave" }),
    ])?.id).toBe(1);
  });

  it("does not default a different cash PLN account when the cash register is missing", () => {
    expect(findDefaultCashPlnAccount([
      account({ id: 3, name: "Main till" }),
      account({ id: 4, name: "EUR till", currency: "EUR" }),
    ])).toBeNull();
  });

  it("does not guess when multiple non-canonical cash PLN accounts exist", () => {
    expect(findDefaultCashPlnAccount([
      account({ id: 2, name: "Dave" }),
      account({ id: 4, name: "Staff Reimbursements" }),
    ])).toBeNull();
  });

  it("does not default when duplicate Cash PLN aliases make the account ambiguous", () => {
    expect(findDefaultCashPlnAccount([
      account({ id: 1, name: "Cash Register PLN" }),
      account({ id: 2, name: "Cash in PLN" }),
    ])).toBeNull();
  });

  it("ignores inactive, non-cash, and non-PLN accounts", () => {
    expect(findDefaultCashPlnAccount([
      account({ isActive: false }),
      account({ id: 2, name: "Cash Register PLN", type: "bank" }),
      account({ id: 3, name: "Cash Register PLN", currency: "EUR" }),
    ])).toBeNull();
  });

  it("fills a new draft after accounts arrive", () => {
    expect(applyDefaultTransactionAccount(
      { accountId: null, currency: "PLN", amountMinor: 2500 },
      account({ id: 8, currency: "pln" }),
    )).toEqual({ accountId: 8, currency: "PLN", amountMinor: 2500 });
  });

  it("never overwrites an existing create or edit selection", () => {
    const draft = { accountId: 14, currency: "EUR", amountMinor: 2500 };
    expect(applyDefaultTransactionAccount(draft, account({ id: 8 }))).toBe(draft);
  });

  it("resets a hidden FX rate when switching from a foreign-currency account to PLN", () => {
    const eurAccount = account({ id: 2, name: "EUR bank", type: "bank", currency: "EUR" });
    const plnAccount = account({ id: 8 });
    const result = applyTransactionAccountSelection({
      kind: "expense" as const,
      accountId: eurAccount.id,
      targetAccountId: null,
      currency: "EUR",
      fxRate: 4.2,
    }, plnAccount, [eurAccount, plnAccount]);

    expect(result).toMatchObject({ accountId: 8, currency: "PLN", fxRate: 1 });
  });

  it("clears a transfer target when the newly selected source is that same account", () => {
    const source = account({ id: 2, name: "Cash desk" });
    const target = account({ id: 8 });
    const result = applyTransactionAccountSelection({
      kind: "transfer" as const,
      accountId: source.id,
      targetAccountId: target.id,
      currency: "PLN",
      fxRate: 1,
    }, target, [source, target]);

    expect(result).toMatchObject({ accountId: 8, targetAccountId: null, fxRate: 1 });
  });

  it("returns only the four operational manual-entry accounts in a stable order", () => {
    const result = selectManualTransactionAccounts([
      account({ id: 10, name: "Staff Reimbursements" }),
      account({ id: 11, name: "Volunteer reserve" }),
      account({ id: 9, name: "Dave" }),
      account({ id: 2, name: "Cash Register EUR", currency: "EUR" }),
      account({ id: 1, name: "Cash Register PLN" }),
      account({ id: 3, name: "FareHarbor Payouts", type: "other" }),
    ], new Set([11]));

    expect(result.map(({ id }) => id)).toEqual([1, 2, 9, 11]);
  });

  it("does not expose inactive, misconfigured, or duplicate operational accounts", () => {
    const result = selectManualTransactionAccounts([
      account({ id: 1, name: "Cash Register PLN", isActive: false }),
      account({ id: 2, name: "Cash Register EUR", currency: "PLN" }),
      account({ id: 9, name: "Dave", type: "bank" }),
      account({ id: 11, name: "Volunteer Fund", currency: "EUR" }),
      account({ id: 12, name: "Cash in PLN" }),
      account({ id: 13, name: "Cash PLN" }),
    ]);

    expect(result).toEqual([]);
  });

  it("does not expose an account merely because it is named Volunteer Fund", () => {
    expect(selectManualTransactionAccounts([
      account({ id: 11, name: "Volunteer Fund" }),
    ])).toEqual([]);
  });

  it("exposes the exact active account linked by Volunteer Fund configuration", () => {
    const linked = account({ id: 42, name: "Volunteer reserve ledger", type: "other", currency: "EUR" });

    expect(selectManualTransactionAccounts([linked], new Set([42]))).toEqual([linked]);
    expect(selectManualTransactionAccounts([
      { ...linked, isActive: false },
    ], new Set([42]))).toEqual([]);
  });
});
