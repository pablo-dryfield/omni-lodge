import {
  buildPaidBySelectionChange,
  hasManualPaymentStateChanged,
  isManualExpenseStatus,
  readTransactionPaidByUserId,
  validateManualExpensePayment,
} from "./financeTransactionPayment";

describe("finance transaction payment state", () => {
  it("allows only Paid and Awaiting reimbursement in the manual expense form", () => {
    expect(isManualExpenseStatus("paid")).toBe(true);
    expect(isManualExpenseStatus("awaiting_reimbursement")).toBe(true);
    expect(isManualExpenseStatus("planned")).toBe(false);
    expect(isManualExpenseStatus("approved")).toBe(false);
    expect(isManualExpenseStatus("reimbursed")).toBe(false);
    expect(isManualExpenseStatus("void")).toBe(false);
  });

  it("selecting a staff payer sets Awaiting reimbursement and canonical metadata", () => {
    const change = buildPaidBySelectionChange({ source: "manual", staffUserId: 9 }, 42);

    expect(change).toEqual({
      status: "awaiting_reimbursement",
      meta: { source: "manual", paidByUserId: 42 },
    });
    expect(readTransactionPaidByUserId(change.meta)).toBe(42);
  });

  it("selecting Company Funds sets Paid and clears current and legacy payer metadata", () => {
    expect(buildPaidBySelectionChange({
      paidByUserId: 42,
      staffUserId: 9,
      source: "manual",
    }, null)).toEqual({
      status: "paid",
      meta: { source: "manual" },
    });
  });

  it("requires a known staff user for Awaiting reimbursement", () => {
    expect(validateManualExpensePayment("awaiting_reimbursement", null, false))
      .toBe("Select the staff member who paid this expense personally.");
    expect(validateManualExpensePayment("awaiting_reimbursement", 42, false))
      .toBe("Select the staff member who paid this expense personally.");
    expect(validateManualExpensePayment("awaiting_reimbursement", 42, true)).toBeNull();
  });

  it("rejects a personal payer paired with Paid as a defensive submit check", () => {
    expect(validateManualExpensePayment("paid", 42, true))
      .toBe("An expense paid by a staff member must be awaiting reimbursement.");
    expect(validateManualExpensePayment("paid", null, false)).toBeNull();
  });

  it("preserves untouched legacy payment state but detects an explicit repair", () => {
    expect(hasManualPaymentStateChanged("paid", 42, "paid", 42)).toBe(false);
    expect(hasManualPaymentStateChanged("awaiting_reimbursement", 42, "paid", 42)).toBe(true);
    expect(hasManualPaymentStateChanged("paid", null, "paid", 42)).toBe(true);
  });
});
