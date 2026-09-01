import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HomePlannedExpenses from "./HomePlannedExpenses";

const mockUseHomePlannedExpenses = jest.fn();
const mockUsePlannedExpenseAction = jest.fn();
const mockMutateAsync = jest.fn();
const mockAccessByModule = new Map<string, {
  ready: boolean;
  loading: boolean;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}>();

let mockState = {
  accessControl: { loaded: true },
  session: { roleSlug: "manager" },
  allowedPageSlugs: new Set(["finance"]),
};

jest.mock("../../api/homePlannedExpenses", () => ({
  useHomePlannedExpenses: (options: unknown) => mockUseHomePlannedExpenses(options),
  usePlannedExpenseAction: () => mockUsePlannedExpenseAction(),
}));

jest.mock("../../hooks/useModuleAccess", () => ({
  useModuleAccess: (moduleSlug: string) => mockAccessByModule.get(moduleSlug),
}));

jest.mock("../../selectors/accessControlSelectors", () => ({
  selectAllowedPageSlugs: (state: typeof mockState) => state.allowedPageSlugs,
}));

jest.mock("../../store/hooks", () => ({
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

const fullAccess = {
  ready: true,
  loading: false,
  canView: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
};

const plannedExpense = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  kind: "expense",
  date: "2026-08-31",
  accountId: 2,
  currency: "PLN",
  amountMinor: 12500,
  fxRate: "1",
  baseAmountMinor: 12500,
  categoryId: 3,
  counterpartyType: "vendor",
  counterpartyId: 4,
  paymentMethod: null,
  status: "planned",
  description: "Internet bill",
  tags: null,
  meta: null,
  invoiceFileId: null,
  createdBy: 1,
  approvedBy: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: null,
  dueState: "overdue",
  account: { id: 2, name: "Cash Register PLN", currency: "PLN" },
  category: { id: 3, name: "Utilities" },
  vendor: { id: 4, name: "Internet Provider" },
  ...overrides,
});

describe("HomePlannedExpenses", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      accessControl: { loaded: true },
      session: { roleSlug: "manager" },
      allowedPageSlugs: new Set(["finance"]),
    };
    mockAccessByModule.clear();
    mockAccessByModule.set("finance-transactions", fullAccess);
    mockAccessByModule.set("finance-recurring", fullAccess);
    mockUsePlannedExpenseAction.mockReturnValue({
      isPending: false,
      mutateAsync: mockMutateAsync,
    });
    mockUseHomePlannedExpenses.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });
  });

  it("keeps the finance request disabled and renders nothing without Finance page access", () => {
    mockState.allowedPageSlugs = new Set();

    const { container } = render(
      <MemoryRouter>
        <HomePlannedExpenses />
      </MemoryRouter>,
    );

    expect(mockUseHomePlannedExpenses).toHaveBeenCalledWith({ enabled: false, limit: 8 });
    expect(container).toBeEmptyDOMElement();
  });

  it("removes the entire section after a successful empty response", () => {
    mockUseHomePlannedExpenses.mockReturnValue({
      data: {
        data: [],
        summary: {
          counts: { total: 0, overdue: 0, dueToday: 0, upcoming: 0 },
          amountsByCurrency: [],
        },
        options: { eligiblePayers: [] },
        meta: {
          count: 0,
          limit: 8,
          offset: 0,
          today: "2026-09-01",
          timezone: "Europe/Warsaw",
          timing: "all",
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    const { container } = render(
      <MemoryRouter>
        <HomePlannedExpenses />
      </MemoryRouter>,
    );

    expect(mockUseHomePlannedExpenses).toHaveBeenCalledWith({ enabled: true, limit: 8 });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a centered, concise payment queue and keeps currencies separate", () => {
    mockUseHomePlannedExpenses.mockReturnValue({
      data: {
        data: [
          plannedExpense(),
          plannedExpense({ id: 2, currency: "EUR", amountMinor: 3000, description: "Hosting" }),
        ],
        summary: {
          counts: { total: 2, overdue: 2, dueToday: 0, upcoming: 0 },
          amountsByCurrency: [
            { currency: "EUR", totalMinor: 3000, overdueMinor: 3000, dueTodayMinor: 0, upcomingMinor: 0 },
            { currency: "PLN", totalMinor: 12500, overdueMinor: 12500, dueTodayMinor: 0, upcomingMinor: 0 },
          ],
        },
        options: { eligiblePayers: [{ userId: 7, fullName: "Aimee Kelly" }] },
        meta: {
          count: 2,
          limit: 8,
          offset: 0,
          today: "2026-09-01",
          timezone: "Europe/Warsaw",
          timing: "all",
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <HomePlannedExpenses />
      </MemoryRouter>,
    );

    expect(mockUseHomePlannedExpenses).toHaveBeenCalledWith({ enabled: true, limit: 8 });
    expect(screen.getByRole("heading", { name: "Planned payments" })).toBeInTheDocument();
    expect(screen.getAllByText("€30.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/PLN\s+125\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Record payment" })).toHaveLength(2);
    expect(screen.queryByText("Planned expenses waiting for confirmation.")).not.toBeInTheDocument();
    expect(screen.queryByText(/DUE NOW/i)).not.toBeInTheDocument();
  });

  it("requires recurring update access before exposing actions for a recurring occurrence", () => {
    mockAccessByModule.set("finance-recurring", { ...fullAccess, canUpdate: false });
    mockUseHomePlannedExpenses.mockReturnValue({
      data: {
        data: [plannedExpense({ meta: { recurring_rule_id: 18 } })],
        summary: {
          counts: { total: 1, overdue: 1, dueToday: 0, upcoming: 0 },
          amountsByCurrency: [
            { currency: "PLN", totalMinor: 12500, overdueMinor: 12500, dueTodayMinor: 0, upcomingMinor: 0 },
          ],
        },
        options: { eligiblePayers: [{ userId: 7, fullName: "Aimee Kelly" }] },
        meta: {
          count: 1,
          limit: 8,
          offset: 0,
          today: "2026-09-01",
          timezone: "Europe/Warsaw",
          timing: "all",
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <HomePlannedExpenses />
      </MemoryRouter>,
    );

    expect(screen.getByText("Internet bill")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View details" })).not.toBeInTheDocument();
  });

  it("confirms a company payment with the server business date", async () => {
    mockMutateAsync.mockResolvedValue({ id: 1, status: "paid" });
    mockUseHomePlannedExpenses.mockReturnValue({
      data: {
        data: [plannedExpense()],
        summary: {
          counts: { total: 1, overdue: 1, dueToday: 0, upcoming: 0 },
          amountsByCurrency: [
            { currency: "PLN", totalMinor: 12500, overdueMinor: 12500, dueTodayMinor: 0, upcomingMinor: 0 },
          ],
        },
        options: { eligiblePayers: [] },
        meta: {
          count: 1,
          limit: 8,
          offset: 0,
          today: "2026-09-01",
          timezone: "Europe/Warsaw",
          timing: "all",
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <HomePlannedExpenses />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    const dialog = screen.getByRole("dialog", { name: "Record payment" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Company funds")).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).queryByRole("button", { name: "Void" })).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("Payment date")).toHaveValue("2026-09-01");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as paid" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 1,
        action: "pay",
        paymentDate: "2026-09-01",
      });
    });
    expect(await screen.findByText("Internet bill was marked as paid.")).toBeInTheDocument();
  });

  it("keeps staff reimbursement inside the same payment dialog", async () => {
    mockMutateAsync.mockResolvedValue({ id: 1, status: "awaiting_reimbursement" });
    mockUseHomePlannedExpenses.mockReturnValue({
      data: {
        data: [plannedExpense()],
        summary: {
          counts: { total: 1, overdue: 1, dueToday: 0, upcoming: 0 },
          amountsByCurrency: [
            { currency: "PLN", totalMinor: 12500, overdueMinor: 12500, dueTodayMinor: 0, upcomingMinor: 0 },
          ],
        },
        options: { eligiblePayers: [{ userId: 7, fullName: "Aimee Kelly" }] },
        meta: {
          count: 1,
          limit: 8,
          offset: 0,
          today: "2026-09-01",
          timezone: "Europe/Warsaw",
          timing: "all",
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <HomePlannedExpenses />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    const dialog = screen.getByRole("dialog", { name: "Record payment" });
    fireEvent.click(within(dialog).getByLabelText("Staff member"));
    expect(within(dialog).getByLabelText("Staff member")).toHaveAttribute("aria-pressed", "true");

    fireEvent.mouseDown(within(dialog).getByRole("combobox", { name: "Paid by" }));
    fireEvent.click(await screen.findByRole("option", { name: "Aimee Kelly" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Send to reimbursement" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        id: 1,
        action: "staff_paid",
        paymentDate: "2026-09-01",
        paidByUserId: 7,
      });
    });
    expect(await screen.findByText("Internet bill was sent to staff reimbursement.")).toBeInTheDocument();
  });

  it("uses the compact request limit without changing the one-action card design", () => {
    mockUseHomePlannedExpenses.mockReturnValue({
      data: {
        data: [plannedExpense()],
        summary: {
          counts: { total: 1, overdue: 1, dueToday: 0, upcoming: 0 },
          amountsByCurrency: [
            { currency: "PLN", totalMinor: 12500, overdueMinor: 12500, dueTodayMinor: 0, upcomingMinor: 0 },
          ],
        },
        options: { eligiblePayers: [] },
        meta: {
          count: 1,
          limit: 4,
          offset: 0,
          today: "2026-09-01",
          timezone: "Europe/Warsaw",
          timing: "all",
        },
      },
      isLoading: false,
      error: null,
      refetch: jest.fn(),
    });

    render(
      <MemoryRouter>
        <HomePlannedExpenses compact />
      </MemoryRouter>,
    );

    expect(mockUseHomePlannedExpenses).toHaveBeenCalledWith({ enabled: true, limit: 4 });
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();
  });
});
