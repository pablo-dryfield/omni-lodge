import type { VolunteerFundSummary } from "../../types/finance";
import {
  activeVolunteerFundLinkedAccountIds,
  buildVolunteerFundSpendIdempotencyKey,
  isVolunteerFundManagedTransactionMeta,
  resolveActiveVolunteerFundAccount,
  transferTouchesActiveVolunteerFund,
} from "./financeVolunteerFundTransaction";

const fund = (overrides: Partial<VolunteerFundSummary> = {}): VolunteerFundSummary => ({
  id: 1,
  name: "Volunteer reserve",
  currency: "PLN",
  description: null,
  fundingSourceAccountId: 1,
  linkedAccountId: 20,
  expenseCategoryId: 7,
  balanceMinor: 50_000,
  allocationTotalMinor: 50_000,
  spendTotalMinor: 0,
  adjustmentTotalMinor: 0,
  isActive: true,
  ...overrides,
});

describe("Finance transaction Volunteer Fund routing", () => {
  it("matches an active fund by its linked account id, independently of names", () => {
    const result = resolveActiveVolunteerFundAccount([
      fund({ id: 2, name: "Anything at all", linkedAccountId: 44 }),
    ], 44);

    expect(result.status).toBe("matched");
    expect(result.fund?.id).toBe(2);
  });

  it("does not treat an inactive fund or a similarly named account as an active link", () => {
    expect(resolveActiveVolunteerFundAccount([
      fund({ name: "Volunteer Fund", linkedAccountId: 44, isActive: false }),
    ], 44).status).toBe("none");
    expect(resolveActiveVolunteerFundAccount([
      fund({ name: "Volunteer Fund", linkedAccountId: 45 }),
    ], 44).status).toBe("none");
  });

  it("reports duplicate active links as ambiguous instead of choosing a fund", () => {
    const result = resolveActiveVolunteerFundAccount([
      fund({ id: 1, linkedAccountId: 44 }),
      fund({ id: 2, linkedAccountId: 44 }),
    ], 44);

    expect(result.status).toBe("ambiguous");
    expect(result.fund).toBeNull();
    expect(result.matches.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("returns unique active linked account ids and ignores inactive or unlinked funds", () => {
    expect([...activeVolunteerFundLinkedAccountIds([
      fund({ id: 1, linkedAccountId: 20 }),
      fund({ id: 2, linkedAccountId: 20 }),
      fund({ id: 3, linkedAccountId: 30 }),
      fund({ id: 4, linkedAccountId: 40, isActive: false }),
      fund({ id: 5, linkedAccountId: null }),
    ])]).toEqual([20, 30]);
  });

  it("blocks ordinary transfers when either side is an active fund account", () => {
    const funds = [fund({ linkedAccountId: 20 })];

    expect(transferTouchesActiveVolunteerFund(funds, 20, 30)).toBe(true);
    expect(transferTouchesActiveVolunteerFund(funds, 10, 20)).toBe(true);
    expect(transferTouchesActiveVolunteerFund(funds, 10, 30)).toBe(false);
  });

  it("builds a namespaced idempotency key", () => {
    expect(buildVolunteerFundSpendIdempotencyKey("retry-safe-id"))
      .toBe("manual-spend:finance-transactions:retry-safe-id");
  });

  it("recognizes transactions owned by either Volunteer Fund workflow", () => {
    expect(isVolunteerFundManagedTransactionMeta({ source: "volunteer-fund" })).toBe(true);
    expect(isVolunteerFundManagedTransactionMeta({ source: "volunteer-fund-allocation" })).toBe(true);
    expect(isVolunteerFundManagedTransactionMeta({ source: "manual" })).toBe(false);
    expect(isVolunteerFundManagedTransactionMeta(null)).toBe(false);
  });
});
