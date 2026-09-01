import {
  parseBookingOpenBarRateBands,
  parseBookingOtherExpensesInsight,
  parseBookingStaffPaymentBreakdown,
} from "./bookingCostInsights";

const insightPayload = (overrides: Record<string, unknown> = {}) => ({
  otherExpenses: {
    baseCurrency: "pln",
    baseAmountMinor: 405650,
    transactionCount: 1,
    dateBasis: "finance_transaction_date",
    productTypeScoped: false,
    transactionLimit: 250,
    transactionsTruncated: false,
    byCategory: [
      {
        categoryId: 8,
        categoryName: "Supplies",
        baseAmountMinor: 405650,
        transactionCount: 1,
      },
    ],
    byDate: [
      {
        date: "2026-08-12",
        baseAmountMinor: 405650,
        transactionCount: 1,
      },
    ],
    transactions: [
      {
        id: 91,
        date: "2026-08-12",
        description: "T-shirts",
        currency: "PLN",
        amountMinor: 405650,
        baseAmountMinor: 405650,
        categoryId: 8,
        categoryName: "Supplies",
        vendorId: 5,
        vendorName: "Print Shop",
        accountId: 2,
        accountName: "Cash Register PLN",
        paymentMethod: "cash",
        source: "inventory_purchase",
        invoiceFile: null,
      },
    ],
    ...overrides,
  },
});

describe("Booking Summary Other Expenses insight", () => {
  it("converts aggregates and paid transaction details from minor units", () => {
    expect(parseBookingOtherExpensesInsight(insightPayload())).toEqual({
      currency: "PLN",
      amount: 4056.5,
      transactionCount: 1,
      dateBasis: "finance_transaction_date",
      productTypeScoped: false,
      transactionLimit: 250,
      transactionsTruncated: false,
      categories: [
        { categoryId: 8, categoryName: "Supplies", amount: 4056.5, transactionCount: 1 },
      ],
      dates: [{ date: "2026-08-12", amount: 4056.5, transactionCount: 1 }],
      transactions: [
        {
          id: 91,
          date: "2026-08-12",
          description: "T-shirts",
          currency: "PLN",
          amount: 4056.5,
          baseCurrency: "PLN",
          baseAmount: 4056.5,
          categoryId: 8,
          categoryName: "Supplies",
          vendorId: 5,
          vendorName: "Print Shop",
          accountId: 2,
          accountName: "Cash Register PLN",
          paymentMethod: "cash",
          source: "inventory_purchase",
          invoiceFile: null,
        },
      ],
    });
  });

  it("keeps safe invoice metadata for lazy previews", () => {
    const payload = insightPayload();
    const transaction = (payload.otherExpenses.transactions as Array<Record<string, unknown>>)[0];
    transaction.invoiceFile = {
      id: 14,
      originalName: "supplier-invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
    };

    expect(parseBookingOtherExpensesInsight(payload)?.transactions[0].invoiceFile).toEqual({
      id: 14,
      originalName: "supplier-invoice.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12345,
    });
  });

  it("keeps a valid empty period as zero paid transactions", () => {
    expect(
      parseBookingOtherExpensesInsight(
        insightPayload({
          baseAmountMinor: 0,
          transactionCount: 0,
          byCategory: [],
          byDate: [],
          transactions: [],
        }),
      ),
    ).toMatchObject({ amount: 0, transactionCount: 0, transactions: [] });
  });

  it("accepts a truncated detail list while retaining the complete aggregate", () => {
    expect(
      parseBookingOtherExpensesInsight(
        insightPayload({ transactionCount: 300, transactionsTruncated: true }),
      ),
    ).toMatchObject({ transactionCount: 300, transactionsTruncated: true });
  });

  it.each([
    null,
    {},
    { otherExpenses: null },
    insightPayload({ baseAmountMinor: "100" }),
    insightPayload({ transactionCount: -1 }),
    insightPayload({ dateBasis: undefined }),
    insightPayload({ productTypeScoped: true }),
    insightPayload({ byCategory: null }),
    insightPayload({ transactions: [], transactionCount: 1, transactionsTruncated: false }),
    insightPayload({ transactionCount: 1, transactionsTruncated: true }),
  ])("returns unavailable for an absent or malformed aggregate", (value) => {
    expect(parseBookingOtherExpensesInsight(value)).toBeNull();
  });
});

describe("Booking Summary cost detail parsers", () => {
  it("keeps only structurally valid Open Bar rate bands", () => {
    expect(parseBookingOpenBarRateBands([
      {
        ticketType: "normal",
        configuredTicketType: "normal",
        count: 12,
        rateBandId: 4,
        rateAmount: 5,
        rateUnit: "per_person",
        source: "ticket_rate",
        amount: 60,
      },
      { ticketType: "normal", count: "12" },
    ])).toEqual([{
      ticketType: "normal",
      configuredTicketType: "normal",
      count: 12,
      rateBandId: 4,
      rateAmount: 5,
      rateUnit: "per_person",
      source: "ticket_rate",
      amount: 60,
    }]);
  });

  it("parses the safe staff payout breakdown including deductions", () => {
    expect(parseBookingStaffPaymentBreakdown([
      {
        label: "Promotion sales",
        category: "promotion_sales",
        amount: 80,
        earningStart: "2026-08-01",
        earningEnd: "2026-08-31",
        staffType: "Long-Term",
      },
      {
        label: "Task deduction",
        category: "assistant_manager_adjustment",
        amount: -20,
        earningStart: "2026-08-08",
        earningEnd: "2026-08-08",
        staffType: "Long-Term",
      },
    ])).toHaveLength(2);
  });

  it("rejects the whole staff breakdown when one entry is malformed", () => {
    expect(parseBookingStaffPaymentBreakdown([
      {
        label: "Promotion sales",
        category: "promotion_sales",
        amount: 80,
        earningStart: null,
        earningEnd: null,
        staffType: null,
      },
      { label: "Invalid", amount: "20" },
    ])).toBeNull();
  });
});
