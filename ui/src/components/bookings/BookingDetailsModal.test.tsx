import { fireEvent, render, screen, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import type { UnifiedOrder } from "../../store/bookingPlatformsTypes";
import axiosInstance from "../../utils/axiosInstance";
import BookingDetailsModal, { getBookingIdFromOrder } from "./BookingDetailsModal";

jest.mock("../../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedGet = axiosInstance.get as jest.Mock;

describe("BookingDetailsModal", () => {
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
    Object.defineProperty(global, "ResizeObserver", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      })),
    });
  });

  it("loads and renders the shared Manifest booking details experience", async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        booking: {
          id: 82518,
          platform: "omnilodge",
          platformBookingId: "40761-20260819110313-600",
          status: "confirmed",
          paymentStatus: "paid",
          experienceDate: "2026-08-31",
          experienceStartAt: "2026-08-31T19:00:00.000Z",
          productName: "Pub Crawl",
          partySizeTotal: 4,
          guestFirstName: "Julia",
          guestLastName: "Fitzgerald",
          guestEmail: "julia@example.com",
        },
        emails: [{
          id: 1,
          messageId: "message-1",
          subject: "Booking confirmed",
          ingestionStatus: "processed",
          receivedAt: "2026-08-30T20:15:16.000Z",
        }],
        events: [{
          id: 11,
          eventType: "booking_created",
          statusAfter: "confirmed",
          occurredAt: "2026-08-30T20:15:16.000Z",
          processedAt: "2026-08-30T20:15:17.000Z",
          emailMessageId: "message-1",
        }],
        stripe: {
          id: "pi_test",
          type: "payment_intent",
          amount: 12525,
          amountRefunded: 0,
          currency: "pln",
          status: "succeeded",
          created: 1788120916,
          fullyRefunded: false,
        },
        stripeError: null,
        ecwidOrderId: null,
        storeActivity: null,
      },
    });

    render(
      <MantineProvider>
        <BookingDetailsModal
          opened
          bookingId={82518}
          onClose={jest.fn()}
        />
      </MantineProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: /booking details/i });
    expect(mockedGet).toHaveBeenCalledWith("/bookings/82518/details");
    expect(within(dialog).getByText("Reservation overview and history")).toBeInTheDocument();
    expect(await within(dialog).findByText("Pub Crawl")).toBeInTheDocument();
    expect(within(dialog).getByText("Julia Fitzgerald")).toBeInTheDocument();
    expect(within(dialog).getByText("40761-20260819110313-600")).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Emails (1)" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Booking events (1)" }));
    expect(within(dialog).getByText("booking created")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Payment" }));
    expect(within(dialog).getByText("125.25 PLN")).toBeInTheDocument();
  });

  it("resolves the internal booking ID from raw data and the normalized order ID fallback", () => {
    const baseOrder = {
      platformBookingId: "external-reference",
      productId: "crawl-pub",
      productName: "Pub Crawl",
      date: "2026-08-31",
      timeslot: "21:00",
      quantity: 1,
      menCount: 1,
      womenCount: 0,
      customerName: "Guest",
      platform: "omnilodge",
      status: "confirmed",
    } as UnifiedOrder;

    expect(getBookingIdFromOrder({ ...baseOrder, id: "summary-row", rawData: { bookingId: 82518 } })).toBe(82518);
    expect(getBookingIdFromOrder({ ...baseOrder, id: "92002", rawData: null })).toBe(92002);
    expect(getBookingIdFromOrder({ ...baseOrder, id: "external-reference", rawData: null })).toBeNull();
  });
});
