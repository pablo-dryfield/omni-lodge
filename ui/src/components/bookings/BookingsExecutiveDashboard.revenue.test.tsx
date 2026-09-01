import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";

import type { UnifiedOrder } from "../../store/bookingPlatformsTypes";
import BookingsExecutiveDashboard from "./BookingsExecutiveDashboard";

jest.mock("recharts", () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Leaf = () => null;

  return {
    __esModule: true,
    Area: Leaf,
    AreaChart: Container,
    CartesianGrid: Leaf,
    Cell: Leaf,
    Legend: Leaf,
    Line: Leaf,
    Pie: Container,
    PieChart: Container,
    ResponsiveContainer: Container,
    Tooltip: Leaf,
    XAxis: Leaf,
    YAxis: Leaf,
  };
});

jest.mock("./PlatformRevenueComparisonModal", () => () => null);
jest.mock("../../utils/axiosInstance", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "http://localhost:3001/api" } },
}));

jest.mock("./BookingDetailsModal", () => {
  return {
    __esModule: true,
    getBookingIdFromOrder: (order: { rawData?: { bookingId?: unknown } }): number | null => {
      const candidate = order.rawData?.bookingId;
      const parsed = typeof candidate === "number"
        ? candidate
        : Number.parseInt(String(candidate ?? ""), 10);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    },
    default: ({ opened, bookingId }: { opened: boolean; bookingId: number | null }) =>
      opened ? (
        <div role="dialog" aria-label="Mock booking details" data-booking-id={bookingId ?? undefined} />
      ) : null,
  };
});

const orders: UnifiedOrder[] = [
  {
    id: "summary-row-julia",
    platformBookingId: "40761-20260819110313-600",
    productId: "crawl-pub",
    productName: "Pub Crawl",
    date: "2026-08-31",
    timeslot: "21:00",
    quantity: 4,
    menCount: 2,
    womenCount: 2,
    customerName: "Julia Fitzgerald",
    customerEmail: "julia@example.com",
    platform: "omnilodge",
    sourceReceivedAt: "2026-08-30T20:15:16.000Z",
    status: "confirmed",
    rawData: {
      bookingId: 82518,
      currency: "PLN",
      paymentStatus: "paid",
      baseAmount: 150,
      baseAmountAfterChannelCommission: 120.5,
      tipAmount: 10,
      processingFee: 5.25,
    },
  },
  {
    id: "92002",
    platformBookingId: "VIA-92002",
    productId: "food-tour",
    productName: "Food Tour Krakow",
    date: "2026-09-02",
    timeslot: "14:30",
    quantity: 2,
    menCount: 1,
    womenCount: 1,
    customerName: "Lauren Macleod",
    customerEmail: "lauren@example.com",
    platform: "viator",
    sourceReceivedAt: "2026-08-31T08:04:05.000Z",
    status: "completed",
    rawData: {
      bookingId: 92002,
      currency: "PLN",
      paymentStatus: "paid",
      baseAmount: 75,
      tipAmount: 0,
      processingFee: 2,
    },
  },
];

const cancelledOrder: UnifiedOrder = {
  id: "93003",
  platformBookingId: "CANCELLED-93003",
  productId: "crawl-pub",
  productName: "Pub Crawl",
  date: "2026-09-03",
  timeslot: "21:00",
  quantity: 1,
  menCount: 1,
  womenCount: 0,
  customerName: "Cancelled Guest",
  platform: "viator",
  sourceReceivedAt: "2026-08-31T09:04:05.000Z",
  status: "cancelled",
  rawData: {
    bookingId: 93003,
    currency: "PLN",
    paymentStatus: "refunded",
    baseAmount: 0,
    refundedAmount: 50,
    processingFee: 0,
  },
};

describe("BookingsExecutiveDashboard revenue bookings", () => {
  beforeEach(() => {
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

  it("lists the filtered bookings before highlights and opens details with the internal booking ID", () => {
    render(
      <MantineProvider>
        <BookingsExecutiveDashboard
          orders={orders}
          allOrders={[...orders, cancelledOrder]}
          bookingAddons={[]}
          counterInsights={null}
          metricMode="revenue"
          dateField="experience_date"
        />
      </MantineProvider>,
    );

    const table = screen.getByRole("table", { name: "Bookings revenue table" });
    const highlights = screen.getByText("Executive highlights");

    expect(table.compareDocumentPosition(highlights) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const sourceReceivedHeader = within(table).getByRole("columnheader", {
      name: "Source Received At (Europe/Warsaw)",
    });
    const experienceHeader = within(table).getByRole("columnheader", {
      name: "Experience Date",
    });
    expect(sourceReceivedHeader).toHaveAttribute("aria-sort", "descending");
    expect(sourceReceivedHeader.compareDocumentPosition(experienceHeader) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.getByText("3 total")).toBeInTheDocument();

    const bookingRows = within(table).getAllByRole("row").slice(1);
    expect(within(bookingRows[0]).getByText("CANCELLED-93003")).toBeInTheDocument();
    expect(within(bookingRows[1]).getByText("VIA-92002")).toBeInTheDocument();
    expect(within(bookingRows[2]).getByText("40761-20260819110313-600")).toBeInTheDocument();

    expect(within(table).getByText("40761-20260819110313-600")).toBeInTheDocument();
    expect(within(table).getByText("#82518")).toBeInTheDocument();
    expect(within(table).getByText("Julia Fitzgerald")).toBeInTheDocument();
    expect(within(table).getByText("julia@example.com")).toBeInTheDocument();
    expect(within(table).getAllByText("Pub Crawl")).toHaveLength(2);
    expect(within(table).getByText("2026-08-30 22:15:16")).toBeInTheDocument();
    expect(within(table).getByText("2026-08-31 · 21:00")).toBeInTheDocument();
    expect(within(table).getByText("125.25 zł")).toBeInTheDocument();

    expect(within(table).getByText("VIA-92002")).toBeInTheDocument();
    expect(within(table).getByText("Lauren Macleod")).toBeInTheDocument();
    expect(within(table).getByText("Food Tour Krakow")).toBeInTheDocument();
    expect(within(table).getByText("CANCELLED-93003")).toBeInTheDocument();
    expect(within(table).getByText("Cancelled Guest")).toBeInTheDocument();
    expect(within(table).getByText("73.00 zł")).toBeInTheDocument();

    expect(screen.queryByRole("dialog", { name: "Mock booking details" })).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", {
      name: "See details for Julia Fitzgerald (40761-20260819110313-600, booking #82518)",
    }));
    expect(screen.getByRole("dialog", { name: "Mock booking details" })).toHaveAttribute(
      "data-booking-id",
      "82518",
    );
  });
});
