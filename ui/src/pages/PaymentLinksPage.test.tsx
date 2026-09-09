import type { ReactNode } from "react";
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import PaymentLinksPage from "./PaymentLinksPage";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const fullPermissions = {
  ready: true,
  loading: false,
  canView: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
};
let mockBookingPermissions = { ...fullPermissions };
let mockBankTransferPermissions = { ...fullPermissions };

class TestResizeObserver implements ResizeObserver {
  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

global.ResizeObserver = TestResizeObserver;

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

jest.mock("../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../hooks/useModuleAccess", () => ({
  useModuleAccess: (moduleSlug: string) => (
    moduleSlug === "bank-transfer-booking-management"
      ? mockBankTransferPermissions
      : mockBookingPermissions
  ),
}));

const awaitingOrder = {
  publicId: "1a4f62ba-a79a-4af0-a6d4-9623a60cd775",
  status: "awaiting_transfer" as const,
  paymentStatus: "unpaid",
  paymentReference: "KTK-BT-000041",
  receivedPaymentReference: null,
  paymentDueAt: "2026-09-05T20:00:00.000Z",
  paymentNote: null,
  total: 240,
  currency: "PLN",
  customer: {
    fullName: "Ada Guest",
    email: "ada@example.com",
    phoneCountry: "PL",
    phone: "500600700",
  },
  items: [{
    productName: "Pub Crawl",
    quantity: 2,
    experienceDate: "2026-09-12",
    experienceTime: "21:00",
    addons: [],
    options: { participants: { men: 1, women: 1 } },
  }],
  createdBy: { id: 7, fullName: "Jamie Manager" },
  receivedBy: null,
  createdAt: "2026-09-07T10:00:00.000Z",
  paidAt: null,
  customerEmailSentAt: null,
  internalEmailSentAt: null,
  confirmationEmailComplete: false,
  bankTransferInstructionsEmailSentAt: "2026-09-07T10:01:00.000Z",
  bankTransferCancellationEmailSentAt: null,
  cancellationReason: null,
  cancelledAt: null,
};

const paymentReceivedOrder = {
  ...awaitingOrder,
  status: "payment_received" as const,
  paymentStatus: "paid",
  receivedPaymentReference: "BANK-8841",
  paymentNote: "Visible in PLN account",
  receivedBy: { id: 8, fullName: "Pablo Cabrera" },
  paidAt: "2026-09-07T11:00:00.000Z",
  customerEmailSentAt: "2026-09-07T11:01:00.000Z",
  internalEmailSentAt: "2026-09-07T11:01:00.000Z",
  confirmationEmailComplete: true,
};

let listedBankTransferOrders: unknown[] = [awaitingOrder];

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
};

const renderPage = (entry = "/bookings/payment-links?tab=bank-transfers") => render(
  <MemoryRouter initialEntries={[entry]}>
    <MantineProvider>
      <PaymentLinksPage />
      <LocationProbe />
    </MantineProvider>
  </MemoryRouter>,
);

describe("PaymentLinksPage bank transfer bookings", () => {
  beforeEach(() => {
    mockBookingPermissions = { ...fullPermissions };
    mockBankTransferPermissions = { ...fullPermissions };
    mockGet.mockReset();
    mockPost.mockReset();
    mockPatch.mockReset();
    listedBankTransferOrders = [awaitingOrder];
    mockGet.mockImplementation((url: string) => {
      if (url === "/storefront/products") return Promise.resolve({ data: { products: [] } });
      if (url === "/storefront-bank-transfer-orders/catalog") {
        return Promise.resolve({ data: { products: [] } });
      }
      if (url === "/storefront-saved-carts") return Promise.resolve({ data: { data: [] } });
      if (url === "/storefront-ongoing-carts") return Promise.resolve({ data: { data: [] } });
      if (url === "/storefront-ongoing-carts/recovered") return Promise.resolve({ data: { data: [] } });
      if (url === "/storefront-bank-transfer-orders") {
        return Promise.resolve({ data: { data: listedBankTransferOrders } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
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
  });

  it("opens the bank transfer creator from its URL action and consumes the action", async () => {
    renderPage("/bookings/payment-links?tab=bank-transfers&action=create-bank-transfer");

    expect(await screen.findByRole("dialog", { name: "Create bank transfer booking" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Full name/)).toBeRequired();
    expect(screen.getByLabelText(/Email/)).toBeRequired();
    await waitFor(() => {
      const query = new URLSearchParams(screen.getByTestId("location-search").textContent || "");
      expect(query.has("action")).toBe(false);
    });
    const query = new URLSearchParams(screen.getByTestId("location-search").textContent || "");
    expect(query.get("tab")).toBe("bank-transfers");
  });

  it("keeps bank-transfer creation available when unrelated Direct Sales requests fail", async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === "/storefront-bank-transfer-orders/catalog") {
        return Promise.resolve({ data: { products: [] } });
      }
      if (url === "/storefront-bank-transfer-orders") {
        return Promise.resolve({ data: { data: [awaitingOrder] } });
      }
      if (url === "/storefront/products") return Promise.resolve({ data: { products: [] } });
      return Promise.reject(new Error("Unrelated Direct Sales endpoint failed"));
    });

    renderPage("/bookings/payment-links?tab=bank-transfers&action=create-bank-transfer");

    const dialog = await screen.findByRole("dialog", { name: "Create bank transfer booking" });
    expect(within(dialog).getByRole("button", { name: "Create booking & send email" })).toBeEnabled();
    expect((await screen.findAllByText("Ada Guest")).length).toBeGreaterThan(0);
  });

  it("hides creation and payment actions without the matching module permissions", async () => {
    mockBankTransferPermissions = {
      ...mockBankTransferPermissions,
      canCreate: false,
      canUpdate: false,
    };
    renderPage("/bookings/payment-links?tab=bank-transfers&action=create-bank-transfer");

    expect(await screen.findAllByText("Ada Guest")).not.toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "Create bank transfer booking" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New booking" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark (payment )?received/ })).not.toBeInTheDocument();
    await waitFor(() => {
      const query = new URLSearchParams(screen.getByTestId("location-search").textContent || "");
      expect(query.has("action")).toBe(false);
    });
  });

  it("falls back safely and never loads bank data when dedicated view access is missing", async () => {
    mockBankTransferPermissions = {
      ...mockBankTransferPermissions,
      canView: false,
      canCreate: false,
      canUpdate: false,
    };

    renderPage("/bookings/payment-links?tab=bank-transfers&action=create-bank-transfer");

    expect(await screen.findByText("No payment links yet")).toBeInTheDocument();
    await waitFor(() => {
      const query = new URLSearchParams(screen.getByTestId("location-search").textContent || "");
      expect({ tab: query.get("tab"), hasAction: query.has("action") }).toEqual({
        tab: "prepared",
        hasAction: false,
      });
    });
    expect(screen.queryByRole("tab", { name: "Bank transfers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Create bank transfer booking" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New payment link" }).length).toBeGreaterThan(0);
    expect(
      mockGet.mock.calls.some(([url]) => String(url).startsWith("/storefront-bank-transfer-orders")),
    ).toBe(false);
  });

  it("marks an awaiting order received with optional audit details", async () => {
    mockPatch.mockResolvedValue({ data: { data: paymentReceivedOrder } });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Mark received" }));
    expect(await screen.findByRole("dialog", { name: "Confirm payment received" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Payment reference/), { target: { value: "BANK-8841" } });
    fireEvent.change(screen.getByLabelText(/Internal note/), { target: { value: "Visible in PLN account" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm payment received" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        `/storefront-bank-transfer-orders/${awaitingOrder.publicId}/payment-received`,
        expect.objectContaining({
          paymentReference: "BANK-8841",
          note: "Visible in PLN account",
          clientRequestId: expect.any(String),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Confirm payment received" })).not.toBeInTheDocument();
    });
    expect(screen.getAllByText("Payment received").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bank ref: BANK-8841").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Note: Visible in PLN account").length).toBeGreaterThan(0);
  });

  it("shows the transfer reference and deadline and can resend instructions", async () => {
    const resentOrder = {
      ...awaitingOrder,
      bankTransferInstructionsEmailSentAt: "2026-09-07T12:00:00.000Z",
    };
    mockPost.mockResolvedValue({ data: { data: resentOrder } });
    renderPage();

    expect((await screen.findAllByText("Ref KTK-BT-000041")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Overdue since 5 Sep 2026, \d{2}:\d{2}/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        `/storefront-bank-transfer-orders/${awaitingOrder.publicId}/resend-instructions`,
      );
    });
    expect((await screen.findAllByText("Instructions sent")).length).toBeGreaterThan(0);
  });

  it("retries a failed paid-booking confirmation email", async () => {
    const missingConfirmation = {
      ...paymentReceivedOrder,
      internalEmailSentAt: null,
      confirmationEmailComplete: false,
    };
    const deliveredConfirmation = {
      ...missingConfirmation,
      internalEmailSentAt: "2026-09-07T12:30:00.000Z",
      confirmationEmailComplete: true,
    };
    listedBankTransferOrders = [missingConfirmation];
    mockPost.mockResolvedValue({ data: { data: deliveredConfirmation } });
    renderPage();

    const retryButtons = await screen.findAllByRole("button", { name: "Retry confirmation" });
    fireEvent.click(retryButtons[0]);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith(
        `/storefront-bank-transfer-orders/${awaitingOrder.publicId}/retry-confirmation`,
      );
    });
    expect((await screen.findAllByText("Confirmation sent")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Retry confirmation" })).not.toBeInTheDocument();
  });

  it("cancels an awaiting reservation only after confirmation and removes it from the active queue", async () => {
    const cancelledOrder = {
      ...awaitingOrder,
      status: "cancelled" as const,
      bankTransferCancellationEmailSentAt: "2026-09-07T12:45:00.000Z",
      cancellationReason: "cancelled_by_staff",
      cancelledAt: "2026-09-07T12:44:00.000Z",
    };
    mockPatch.mockResolvedValue({ data: { data: cancelledOrder } });
    renderPage();

    const cancelButtons = await screen.findAllByRole("button", { name: "Cancel booking" });
    fireEvent.click(cancelButtons[0]);
    const dialog = await screen.findByRole("dialog", { name: "Cancel bank transfer booking" });
    fireEvent.change(within(dialog).getByLabelText(/Internal cancellation note/), {
      target: { value: "Customer changed plans" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel booking" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        `/storefront-bank-transfer-orders/${awaitingOrder.publicId}/cancel`,
        { note: "Customer changed plans" },
      );
    });
    await waitFor(() => expect(screen.queryByText("Ada Guest")).not.toBeInTheDocument());
    expect(screen.getByText("Reservation cancelled")).toBeInTheDocument();
  });

  it("keeps cancelled bookings out of the queue until the archive switch is enabled", async () => {
    renderPage();
    await screen.findAllByText("Ada Guest");

    fireEvent.click(screen.getByRole("switch", { name: "Show cancelled bookings" }));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(
        "/storefront-bank-transfer-orders?includeCancelled=true",
      );
    });
  });
});
