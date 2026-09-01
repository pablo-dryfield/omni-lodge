import { fireEvent, render, screen, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import RevenueBookingsTable, { type RevenueBookingRow } from "./RevenueBookingsTable";

const buildRows = (count: number): RevenueBookingRow[] =>
  Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return {
      bookingId: 82000 + sequence,
      reference: `REF-${sequence}`,
      customerName: `Guest ${sequence}`,
      customerEmail: `guest${sequence}@example.com`,
      platform: "OmniLodge",
      productName: "Pub Crawl",
      sourceReceivedAt: `2026-08-${String(sequence).padStart(2, "0")}T08:15:00.000Z`,
      sourceReceivedAtLabel: `2026-08-${String(sequence).padStart(2, "0")} 10:15:00`,
      experienceDate: "2026-08-31",
      experienceTime: "21:00",
      guests: 2,
      status: "confirmed",
      paymentStatus: "paid",
      revenue: sequence * 10,
      currency: "PLN",
      onSeeDetails: jest.fn(),
    };
  });

const renderTable = (rows: RevenueBookingRow[]) =>
  render(
    <MantineProvider>
      <RevenueBookingsTable rows={rows} />
    </MantineProvider>,
  );

describe("RevenueBookingsTable", () => {
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

  it("renders an accessible, paginated table and opens the selected booking", () => {
    const rows = buildRows(26);
    renderTable(rows);

    const table = screen.getByRole("table", { name: "Bookings revenue table" });
    expect(within(table).getByRole("columnheader", {
      name: "Source Received At (Europe/Warsaw)",
    })).toHaveAttribute("aria-sort", "descending");
    expect(within(table).getByRole("columnheader", { name: "Experience Date" })).toBeInTheDocument();
    expect(within(table).getByText("Guest 26")).toBeInTheDocument();
    expect(within(table).queryByText("Guest 1")).not.toBeInTheDocument();
    expect(within(table).getAllByRole("button", { name: /See details for/i })).toHaveLength(25);

    const firstDetailsButton = within(table).getByRole("button", {
      name: "See details for Guest 26 (REF-26, booking #82026)",
    });
    fireEvent.click(firstDetailsButton);
    expect(rows[25].onSeeDetails).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(within(table).getByText("Guest 1")).toBeInTheDocument();
    expect(within(table).queryByText("Guest 26")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 26\u201326 of 26")).toBeInTheDocument();
  });

  it("shows source-received and experience dates in separate columns", () => {
    renderTable(buildRows(1));

    expect(screen.getByText("2026-08-01 10:15:00")).toBeInTheDocument();
    expect(screen.getByText("2026-08-31 \u00b7 21:00")).toBeInTheDocument();
    expect(screen.getByText("1 total")).toBeInTheDocument();
  });
});
