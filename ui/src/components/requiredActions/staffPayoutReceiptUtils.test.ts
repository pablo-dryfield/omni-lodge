import {
  formatPayoutReceiptAmount,
  normalizeStaffPayoutReceipt,
} from "./staffPayoutReceiptUtils";

describe("staff payout receipt normalization", () => {
  it("uses the immutable minor-unit amount and prepares the exact acknowledged value", () => {
    const receipt = normalizeStaffPayoutReceipt({
      id: 41,
      amount: 999,
      amountMinor: 53240,
      currency: "pln",
      rangeStart: "2026-07-01",
      rangeEnd: "2026-07-31",
      payoutDate: "2026-08-29",
      acceptanceText: "I confirm receipt of the immutable payout snapshot.",
      acceptanceVersion: "v1",
    });

    expect(receipt).toMatchObject({
      id: 41,
      amount: 532.4,
      acknowledgedAmount: "532.40",
      currency: "PLN",
      acceptanceText: "I confirm receipt of the immutable payout snapshot.",
      acceptanceVersion: "v1",
    });
    expect(receipt && formatPayoutReceiptAmount(receipt)).toBe("PLN 532.40");
  });

  it("rejects an invalid receipt instead of allowing a confirmation with ambiguous evidence", () => {
    expect(
      normalizeStaffPayoutReceipt({
        id: 0,
        amountMinor: 0,
        currency: "",
        rangeStart: "2026-07-01",
        rangeEnd: "2026-07-31",
      }),
    ).toBeNull();
  });
});
