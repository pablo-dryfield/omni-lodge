import type { VolunteerFundSummary } from "../../types/finance";

export type VolunteerFundAccountResolution =
  | { status: "none"; fund: null; matches: [] }
  | { status: "matched"; fund: VolunteerFundSummary; matches: [VolunteerFundSummary] }
  | { status: "ambiguous"; fund: null; matches: VolunteerFundSummary[] };

const activeFundsLinkedToAccount = (
  funds: readonly VolunteerFundSummary[],
  accountId: number | null | undefined,
): VolunteerFundSummary[] => {
  if (!accountId) {
    return [];
  }
  return funds.filter((fund) => fund.isActive && fund.linkedAccountId === accountId);
};

export const resolveActiveVolunteerFundAccount = (
  funds: readonly VolunteerFundSummary[],
  accountId: number | null | undefined,
): VolunteerFundAccountResolution => {
  const matches = activeFundsLinkedToAccount(funds, accountId);
  if (matches.length === 0) {
    return { status: "none", fund: null, matches: [] };
  }
  if (matches.length === 1) {
    return { status: "matched", fund: matches[0], matches: [matches[0]] };
  }
  return { status: "ambiguous", fund: null, matches };
};

export const activeVolunteerFundLinkedAccountIds = (
  funds: readonly VolunteerFundSummary[],
): ReadonlySet<number> => new Set(
  funds.flatMap((fund) => (
    fund.isActive && fund.linkedAccountId ? [fund.linkedAccountId] : []
  )),
);

export const transferTouchesActiveVolunteerFund = (
  funds: readonly VolunteerFundSummary[],
  sourceAccountId: number | null | undefined,
  targetAccountId: number | null | undefined,
): boolean => (
  resolveActiveVolunteerFundAccount(funds, sourceAccountId).status !== "none"
  || resolveActiveVolunteerFundAccount(funds, targetAccountId).status !== "none"
);

export const isVolunteerFundManagedTransactionMeta = (
  meta: Record<string, unknown> | null | undefined,
): boolean => (
  meta?.source === "volunteer-fund"
  || meta?.source === "volunteer-fund-allocation"
);

export const buildVolunteerFundSpendIdempotencyKey = (uniquePart: string): string =>
  `manual-spend:finance-transactions:${uniquePart}`;

export const createVolunteerFundSpendIdempotencyKey = (): string => {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return buildVolunteerFundSpendIdempotencyKey(uuid);
};
