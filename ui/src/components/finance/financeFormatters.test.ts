import {
  formatFinanceDate,
  formatFinanceMoneyMajor,
  formatFinanceMoneyMinor,
  getFinanceErrorMessage,
  humanizeFinanceValue,
} from "./financeFormatters";

describe("financeFormatters", () => {
  it("keeps minor-unit and major-unit money formatting explicit", () => {
    expect(formatFinanceMoneyMinor(12345, "PLN")).toContain("123.45");
    expect(formatFinanceMoneyMajor(123.45, "PLN")).toContain("123.45");
  });

  it("falls back safely for missing and invalid dates", () => {
    expect(formatFinanceDate(null)).toBe("—");
    expect(formatFinanceDate("not-a-date")).toBe("—");
  });

  it("turns stored values into readable labels", () => {
    expect(humanizeFinanceValue("awaiting_reimbursement")).toBe("Awaiting Reimbursement");
    expect(humanizeFinanceValue("card-payment")).toBe("Card Payment");
  });

  it("preserves useful thunk rejection messages", () => {
    expect(getFinanceErrorMessage({ message: "Account is still in use" }, "Fallback")).toBe(
      "Account is still in use",
    );
    expect(getFinanceErrorMessage("Validation failed", "Fallback")).toBe("Validation failed");
    expect(
      getFinanceErrorMessage({ response: { data: [{ message: "Vendor is required" }] } }, "Fallback"),
    ).toBe("Vendor is required");
    expect(getFinanceErrorMessage({}, "Fallback")).toBe("Fallback");
  });
});
