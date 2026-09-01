import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import axiosInstance from "../../utils/axiosInstance";
import BookingsExecutiveDashboard, { type BookingCostsSummary } from "./BookingsExecutiveDashboard";
import BookingCostsDashboard, {
  buildCostDriverRows,
  buildDatedCostTrendRows,
  buildOpenBarGuestMix,
  buildOpenBarRateBandRows,
} from "./BookingCostsDashboard";

jest.mock("./PlatformRevenueComparisonModal", () => () => null);
jest.mock("../../utils/axiosInstance", () => ({
  __esModule: true,
  default: { get: jest.fn(), defaults: { baseURL: "http://localhost:3001/api" } },
}));
jest.mock("../venueNumbers/NightReportPhotoPreviewDialog", () => ({ preview }: { preview: { name: string } | null }) => (
  preview ? <div>{`Previewing ${preview.name}`}</div> : null
));

const completeCostsSummary: BookingCostsSummary = {
  currency: "PLN",
  openBarPayouts: 100,
  staffPayments: 200,
  otherExpenses: 45.67,
  otherExpensesTransactionCount: 1,
  openBarDetails: [
    {
      venueId: 10,
      venueName: "Test Venue",
      currency: "PLN",
      amount: 100,
      paid: 60,
      outstanding: 40,
      totalPeople: 18,
      daily: [
        {
          date: "2026-08-10",
          amount: 100,
          totalPeople: 18,
          normalCount: 12,
          cocktailCount: 6,
          brunchCount: 0,
          rateBands: [
            {
              ticketType: "normal",
              configuredTicketType: "normal",
              count: 12,
              rateBandId: 1,
              rateAmount: 5,
              rateUnit: "per_person",
              source: "ticket_rate",
              amount: 60,
            },
            {
              ticketType: "cocktail",
              configuredTicketType: "cocktail",
              count: 6,
              rateBandId: 2,
              rateAmount: 6.666666,
              rateUnit: "per_person",
              source: "ticket_rate",
              amount: 40,
            },
          ],
          rateBreakdownMatchesPayout: true,
        },
      ],
    },
    {
      venueId: 11,
      venueName: "Zero Due Venue",
      currency: "PLN",
      amount: 0,
      paid: 0,
      outstanding: 0,
      totalPeople: 3,
      daily: [{
        date: "2026-08-12",
        amount: 0,
        totalPeople: 3,
        normalCount: 0,
        cocktailCount: 0,
        brunchCount: 3,
        rateBands: [],
        rateBreakdownMatchesPayout: null,
      }],
    },
  ],
  staffPaymentDetails: [
    {
      userId: 20,
      fullName: "Test Guide",
      staffType: "Long-Term",
      currency: "PLN",
      amount: 200,
      paid: 150,
      outstanding: 50,
      breakdown: [{
        label: "Guiding shifts",
        category: "shift_compensation",
        amount: 200,
        earningStart: "2026-08-01",
        earningEnd: "2026-08-31",
        staffType: "Long-Term",
      }],
    },
    {
      userId: 21,
      fullName: "Zero Due Guide",
      staffType: "Long-Term",
      currency: "PLN",
      amount: 0,
      paid: 0,
      outstanding: 0,
      breakdown: [],
    },
  ],
  otherExpenseCategories: [
    { categoryId: 30, categoryName: "Rent", amount: 45.67, transactionCount: 1 },
  ],
  otherExpenseDates: [
    { date: "2026-08-11", amount: 45.67, transactionCount: 1 },
  ],
  otherExpenseTransactions: [
    {
      id: 40,
      date: "2026-08-11",
      description: "Office supplies",
      currency: "PLN",
      amount: 45.67,
      baseCurrency: "PLN",
      baseAmount: 45.67,
      categoryId: 30,
      categoryName: "Rent",
      vendorId: null,
      vendorName: null,
      accountId: 50,
      accountName: "Cash Register PLN",
      paymentMethod: "cash",
      source: "manual",
      invoiceFile: {
        id: 70,
        originalName: "office-supplies.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2048,
      },
    },
  ],
  otherExpenseTransactionLimit: 250,
  otherExpenseTransactionsTruncated: false,
};

describe("Booking costs chart data", () => {
  it("builds ranked drivers and keeps dated sources separate", () => {
    expect(buildCostDriverRows(completeCostsSummary).map((row) => [row.source, row.value])).toEqual([
      ["Staff Payments", 200],
      ["Open Bar", 100],
      ["Other Expenses", 45.67],
    ]);
    expect(buildDatedCostTrendRows(completeCostsSummary)).toEqual([
      {
        date: "2026-08-10",
        label: "10 Aug",
        openBar: 100,
        otherExpenses: 0,
        total: 100,
      },
      {
        date: "2026-08-11",
        label: "11 Aug",
        openBar: 0,
        otherExpenses: 45.67,
        total: 45.67,
      },
    ]);
  });

  it("keeps zero-value detail rows out of drivers and hides zero guest types", () => {
    expect(buildCostDriverRows(completeCostsSummary).map((row) => row.label)).not.toEqual(
      expect.arrayContaining(["Zero Due Venue", "Zero Due Guide"]),
    );
    expect(buildOpenBarGuestMix(completeCostsSummary.openBarDetails![0])).toEqual([
      { key: "normal", label: "Normal", count: 12, color: "blue" },
      { key: "cocktail", label: "Cocktail", count: 6, color: "grape" },
    ]);
    expect(buildOpenBarGuestMix(completeCostsSummary.openBarDetails![1])).toEqual([
      { key: "brunch", label: "Brunch", count: 3, color: "orange" },
    ]);
    expect(buildOpenBarRateBandRows(completeCostsSummary.openBarDetails![0])).toEqual([
      expect.objectContaining({ ticketType: "normal", count: 12, rateAmount: 5, amount: 60, applications: 1 }),
      expect.objectContaining({ ticketType: "cocktail", count: 6, amount: 40, applications: 1 }),
    ]);
  });

  it("merges identical visible rate bands across product-specific rate IDs", () => {
    const venue = completeCostsSummary.openBarDetails![0];
    const rows = buildOpenBarRateBandRows({
      ...venue,
      daily: [{
        ...venue.daily[0],
        rateBands: [
          {
            ticketType: "normal",
            configuredTicketType: "normal",
            count: 331,
            rateBandId: 101,
            rateAmount: 24,
            rateUnit: "per_person",
            source: "ticket_rate",
            amount: 7_944,
          },
          {
            ticketType: "normal",
            configuredTicketType: "normal",
            count: 10,
            rateBandId: 202,
            rateAmount: 24,
            rateUnit: "per_person",
            source: "ticket_rate",
            amount: 240,
          },
          {
            ticketType: "normal",
            configuredTicketType: "normal",
            count: 2,
            rateBandId: 303,
            rateAmount: 25,
            rateUnit: "per_person",
            source: "ticket_rate",
            amount: 50,
          },
        ],
      }],
    });

    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({
        ticketType: "normal",
        count: 341,
        rateAmount: 24,
        amount: 8_184,
        applications: 2,
      }),
      expect.objectContaining({
        ticketType: "normal",
        count: 2,
        rateAmount: 25,
        amount: 50,
        applications: 1,
      }),
    ]);
  });
});

describe("BookingsExecutiveDashboard costs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: class ResizeObserver {
        observe = jest.fn();
        unobserve = jest.fn();
        disconnect = jest.fn();
      },
    });
    Object.defineProperty(URL, "createObjectURL", {
      writable: true,
      value: jest.fn(() => "blob:invoice-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      writable: true,
      value: jest.fn(),
    });
  });

  it("shows paid Other Expenses and includes them in Total Costs without bookings", () => {
    render(
      <MantineProvider>
        <BookingsExecutiveDashboard
          orders={[]}
          bookingAddons={[]}
          counterInsights={null}
          metricMode="costs"
          costsSummary={completeCostsSummary}
          dateField="experience_date"
        />
      </MantineProvider>,
    );

    expect(screen.getAllByText("Other Expenses").length).toBeGreaterThan(0);
    expect(screen.getByText("345.67 zł")).toBeInTheDocument();
    expect(screen.getAllByText("45.67 zł").length).toBeGreaterThan(0);
    expect(screen.getByText(/1 paid transaction/i)).toBeInTheDocument();
    expect(screen.getByText("Cost Mix")).toBeInTheDocument();
    expect(screen.getByText("Largest Cost Drivers")).toBeInTheDocument();
    expect(screen.getByText("Open Bar Detail")).toBeInTheDocument();
    expect(screen.getByText("Staff Payments Detail")).toBeInTheDocument();
    expect(screen.getByText("Other Expenses Detail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open Bar Detail/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Staff Payments Detail/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Other Expenses Detail/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("Zero Due Venue")).not.toBeInTheDocument();
    expect(screen.queryByText("Zero Due Guide")).not.toBeInTheDocument();
    expect(screen.getByText("Normal 12")).toBeInTheDocument();
    expect(screen.getByText("Cocktail 6")).toBeInTheDocument();
    expect(screen.queryByText("Brunch 3")).not.toBeInTheDocument();
    expect(screen.getByText(/12 guests × 5\.00 zł \/ guest/)).toBeInTheDocument();
    expect(screen.getByText("Office supplies")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View invoice" })).toBeInTheDocument();
    expect(axiosInstance.get).not.toHaveBeenCalled();
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Staff type" })).toBeInTheDocument();
    expect(screen.queryByText("Guiding shifts")).not.toBeInTheDocument();
    const staffMemberControl = screen.getByRole("button", {
      name: /Show payment details for Test Guide.*200\.00 zł/i,
    });
    expect(staffMemberControl).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(staffMemberControl);
    expect(staffMemberControl).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Guiding shifts")).toBeInTheDocument();
    fireEvent.keyDown(staffMemberControl, { key: "Enter" });
    expect(staffMemberControl).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Guiding shifts")).not.toBeInTheDocument();
    expect(screen.queryByText("Miscellaneous")).not.toBeInTheDocument();
    expect(screen.queryByText("No bookings")).not.toBeInTheDocument();
  });

  it("loads an attached invoice only when its preview button is used", async () => {
    (axiosInstance.get as jest.Mock).mockResolvedValue({
      data: new Blob(["invoice"], { type: "application/pdf" }),
    });

    render(
      <MantineProvider>
        <BookingCostsDashboard summary={completeCostsSummary} />
      </MantineProvider>,
    );

    expect(axiosInstance.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View invoice" }));
    expect(await screen.findByText("Previewing office-supplies.pdf")).toBeInTheDocument();
    expect(axiosInstance.get).toHaveBeenCalledWith("/finance/files/70/download", {
      responseType: "blob",
      withCredentials: true,
    });
  });

  it("offers non-previewable invoice files as downloads without fetching them", () => {
    const transaction = completeCostsSummary.otherExpenseTransactions![0];
    render(
      <MantineProvider>
        <BookingCostsDashboard
          summary={{
            ...completeCostsSummary,
            otherExpenseTransactions: [{
              ...transaction,
              invoiceFile: {
                ...transaction.invoiceFile!,
                originalName: "office-supplies.xlsx",
                mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              },
            }],
          }}
        />
      </MantineProvider>,
    );

    const download = screen.getByRole("link", { name: "Download invoice" });
    expect(download).toHaveAttribute("href", "http://localhost:3001/api/finance/files/70/download");
    expect(download).toHaveAttribute("download", "office-supplies.xlsx");
    expect(axiosInstance.get).not.toHaveBeenCalled();
  });

  it("does not present a partial total when finance expenses are unavailable", () => {
    render(
      <MantineProvider>
        <BookingsExecutiveDashboard
          orders={[]}
          bookingAddons={[]}
          counterInsights={null}
          metricMode="costs"
          costsSummary={{
            ...completeCostsSummary,
            otherExpenses: null,
            otherExpensesTransactionCount: null,
            otherExpenseCategories: null,
            otherExpenseDates: null,
            otherExpenseTransactions: null,
            otherExpenseTransactionLimit: null,
          }}
          dateField="experience_date"
        />
      </MantineProvider>,
    );

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Paid finance transactions unavailable")).toBeInTheDocument();
    expect(screen.queryByText("0 transactions")).not.toBeInTheDocument();
    expect(screen.queryByText("3,700.00 zł")).not.toBeInTheDocument();
  });

  it("loads long mobile transaction detail incrementally", async () => {
    (window.matchMedia as jest.Mock).mockImplementation((query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));
    const template = completeCostsSummary.otherExpenseTransactions?.[0];
    expect(template).toBeDefined();
    const transactions = Array.from({ length: 21 }, (_, index) => ({
      ...template!,
      id: index + 1,
      description: `Expense ${index + 1}`,
    }));

    render(
      <MantineProvider>
        <BookingCostsDashboard
          summary={{
            ...completeCostsSummary,
            otherExpensesTransactionCount: transactions.length,
            otherExpenseTransactions: transactions,
          }}
        />
      </MantineProvider>,
    );

    const showMore = await screen.findByRole("button", { name: "Show 1 more" });
    expect(screen.queryByText("Expense 21")).not.toBeInTheDocument();
    fireEvent.click(showMore);
    expect(await screen.findByText("Expense 21")).toBeInTheDocument();
  });
});
