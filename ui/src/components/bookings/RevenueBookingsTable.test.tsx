import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import RevenueBookingsTable, { type RevenueBookingRow } from "./RevenueBookingsTable";
import { copyBookingExportImage, downloadBookingExport } from '../../utils/bookingTableExport';

jest.mock('../../utils/bookingTableExport', () => ({
  ...jest.requireActual('../../utils/bookingTableExport'),
  downloadBookingExport: jest.fn().mockResolvedValue(undefined),
  copyBookingExportImage: jest.fn().mockResolvedValue('copied'),
}));

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
  jest.setTimeout(20_000);
  beforeAll(() => configure({ asyncUtilTimeout: 5000 }));
  afterAll(() => configure({ asyncUtilTimeout: 1000 }));
  beforeEach(() => {
    jest.clearAllMocks();
    // Mantine's select schedules scrolling; jsdom has no layout/scroll implementation.
    Element.prototype.scrollIntoView = jest.fn();
    (copyBookingExportImage as jest.Mock).mockResolvedValue('copied');
    (downloadBookingExport as jest.Mock).mockResolvedValue(undefined);
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
    expect(screen.getByRole('columnheader', { name: 'Customer', exact: true })).toHaveStyle({ textAlign: 'center', verticalAlign: 'middle' });
    expect(screen.getByRole('cell', { name: 'Guest 1', exact: true })).toHaveStyle({ textAlign: 'center', verticalAlign: 'middle', justifyContent: 'center' });
  });

  it('combines text, exact platform and numeric filters across every page, and resets them', async () => {
    const rows = buildRows(26).map((row, index) => ({ ...row, platform: index % 2 ? 'Viator' : 'OmniLodge' }));
    renderTable(rows);
    fireEvent.click(screen.getByRole('button', { name: '2', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter Platform', exact: true }), { target: { value: 'Viator' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter Customer', exact: true }), { target: { value: 'Guest 2' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Filter Revenue', exact: true }), { target: { value: '230' } });
    expect(await screen.findByText('2 matching')).toBeInTheDocument();
    expect(await screen.findByText('Showing 1–2 of 2')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Guest 24')).toBeInTheDocument();
    expect(within(table).getByText('Guest 26')).toBeInTheDocument();
    expect(within(table).queryByText('Guest 22')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset table' }));
    expect(await screen.findByText('26 matching')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Filter Revenue', exact: true })).toHaveValue(null);
  });

  it('supports inclusive numeric ranges, numeric sorting and multiple sort columns', async () => {
    renderTable(buildRows(4));
    const revenueHeader = screen.getByRole('columnheader', { name: 'Revenue', exact: true });
    fireEvent.click(within(revenueHeader).getByRole('button', { name: 'Change filter mode' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Between Inclusive/ }));
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Filter Revenue minimum' }), { target: { value: '20' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Filter Revenue maximum' }), { target: { value: '30' } });
    expect(await screen.findByText('2 matching')).toBeInTheDocument();
    expect(screen.getByText('Guest 2')).toBeInTheDocument();
    expect(screen.getByText('Guest 3')).toBeInTheDocument();
    fireEvent.click(within(revenueHeader).getByRole('button', { name: 'Sort by Revenue ascending' }));
    expect(revenueHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getAllByRole('button', { name: /See details for/ })[0]).toHaveAccessibleName(/Guest 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Customer ascending' }), { shiftKey: true });
    expect(revenueHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByRole('columnheader', { name: 'Customer', exact: true })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('searches hidden metadata, allows showing/hiding it, and restores default columns', async () => {
    renderTable(buildRows(2));
    expect(screen.getByRole('columnheader', { name: 'Customer Email', exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show/Hide columns' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Customer Email' }));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Customer Email', exact: true })).not.toBeInTheDocument());
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search all booking columns' }), { target: { value: 'guest1@example.com' } });
    expect(await screen.findByText('1 matching')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share image' }));
    expect(await screen.findByText('Image copied to clipboard. You can paste it into your message.')).toBeInTheDocument();
    expect(JSON.stringify((copyBookingExportImage as jest.Mock).mock.calls[0][0])).not.toContain('guest1@example.com');
    fireEvent.click(await screen.findByRole('button', { name: 'Reset table' }));
    expect(await screen.findByText('2 matching')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Customer Email', exact: true })).toBeInTheDocument();
  });

  it('compares source dates as Warsaw calendar days rather than UTC days or midnight timestamps', async () => {
    const rows = buildRows(3).map((row, index) => ({ ...row, sourceReceivedAt: [
      '2026-08-01T21:59:59Z', '2026-08-01T22:00:00Z', '2026-08-02T21:59:59Z',
    ][index] }));
    renderTable(rows);
    const header = screen.getByRole('columnheader', { name: 'Source Received At (Europe/Warsaw)', exact: true });
    fireEvent.click(within(header).getByRole('button', { name: 'Change filter mode' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '= Equals', exact: true }));
    const input = await screen.findByRole('textbox', { name: 'Filter Source Received At (Europe/Warsaw)', exact: true });
    fireEvent.change(input, { target: { value: '2026-08-02' } });
    fireEvent.blur(input);
    expect(await screen.findByText('2 matching')).toBeInTheDocument();
    expect(screen.queryByText('Guest 1')).not.toBeInTheDocument();
    expect(screen.getByText('Guest 2')).toBeInTheDocument();
    expect(screen.getByText('Guest 3')).toBeInTheDocument();
  });

  it('exports all matching rows without changing pagination, or just the current page, excluding hidden/display columns', async () => {
    renderTable(buildRows(26));
    fireEvent.click(screen.getByRole('button', { name: 'Share image' }));
    await waitFor(() => expect(copyBookingExportImage).toHaveBeenCalledTimes(1));
    const all = (copyBookingExportImage as jest.Mock).mock.calls[0][0];
    expect(all.rows).toHaveLength(26);
    expect(all.columns).toHaveLength(12);
    expect(all.columns.map((column: { id: string }) => column.id)).not.toEqual(expect.arrayContaining(['actions', 'experienceTime', 'currency', 'mrt-row-spacer']));
    expect(all.rows[0][0].value).toBe('REF-26');
    expect(all.rows[25][0].value).toBe('REF-1');
    expect(await screen.findByText('Image copied to clipboard. You can paste it into your message.')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–25 of 26')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('textbox', { name: 'Export row scope' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Current page', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: '2', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Download', exact: true }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excel workbook (.xlsx)' }));
    await waitFor(() => expect(downloadBookingExport).toHaveBeenCalledTimes(1));
    const [page, format] = (downloadBookingExport as jest.Mock).mock.calls[0];
    expect(format).toBe('xlsx'); expect(page.rows).toHaveLength(1); expect(page.rows[0][0].value).toBe('REF-1');
    expect(await screen.findByText('XLSX download prepared with 1 booking.')).toBeInTheDocument();
  });
});
