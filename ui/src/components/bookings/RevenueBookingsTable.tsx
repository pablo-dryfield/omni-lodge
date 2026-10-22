import { useMemo } from "react";
import { Badge, Button, Group, Paper, Text } from "@mantine/core";
import { MantineReactTable, useMantineReactTable, type MRT_ColumnDef } from "mantine-react-table";
import { bookingTableCalendarDate, sourceReceivedCalendarDate } from "../../utils/revenueBookingTableDate";
import { BOOKINGS_SUMMARY_TIMEZONE } from "../../utils/bookingsSummaryDate";
import BookingTableExportControls from "./BookingTableExportControls";
import { useMediaQuery } from "@mantine/hooks";

export type RevenueBookingRow = {
  bookingId: string | number;
  reference: string;
  customerName: string;
  customerEmail?: string | null;
  platform: string;
  productName: string;
  sourceReceivedAt?: string | null;
  sourceReceivedAtLabel: string;
  experienceDate: string;
  experienceTime?: string | null;
  guests: number;
  status: string;
  paymentStatus: string;
  revenue: number;
  currency: string;
  onSeeDetails: () => void;
};

type RevenueBookingsTableProps = {
  rows: RevenueBookingRow[];
};

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const cleanText = (value: unknown, fallback = "-"): string => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const formatStatus = (value: string): string => {
  const normalized = cleanText(value, "Unknown").replace(/[_-]+/g, " ");
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
};

const getStatusColor = (value: string): string => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["paid", "confirmed", "completed", "checked_in_full"].includes(normalized)) return "green";
  if (["pending", "awaiting_payment", "unpaid"].includes(normalized)) return "yellow";
  if (["cancelled", "failed", "refunded", "void", "no_show"].includes(normalized)) return "red";
  if (["partially_refunded", "checked_in_partial"].includes(normalized)) return "orange";
  if (["amended", "rebooked", "processing"].includes(normalized)) return "blue";
  return "gray";
};

const formatMoney = (amount: number, currency: string): string => {
  const safeAmount = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const normalizedCurrency = cleanText(currency, "PLN").toUpperCase();
  const currencyLabel = normalizedCurrency === "PLN" ? "z\u0142" : normalizedCurrency;
  return `${safeAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currencyLabel}`;
};

const formatExperience = (date: string, time?: string | null): string => {
  const normalizedDate = cleanText(date);
  const normalizedTime = String(time ?? "").trim();
  return normalizedTime && normalizedTime !== "--:--"
    ? `${normalizedDate} \u00b7 ${normalizedTime}`
    : normalizedDate;
};

const parseSourceReceivedTimestamp = (value?: string | null): number | null => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const sortRevenueBookingRowsBySourceReceivedAt = (
  rows: readonly RevenueBookingRow[],
): RevenueBookingRow[] => rows
  .map((row, originalIndex) => ({
    row,
    originalIndex,
    timestamp: parseSourceReceivedTimestamp(row.sourceReceivedAt),
  }))
  .sort((left, right) => {
    if (left.timestamp === null && right.timestamp === null) {
      return left.originalIndex - right.originalIndex;
    }
    if (left.timestamp === null) return 1;
    if (right.timestamp === null) return -1;
    return right.timestamp - left.timestamp || left.originalIndex - right.originalIndex;
  })
  .map(({ row }) => row);


const TEXT_FILTER_MODES = ["contains", "equals", "notEquals", "startsWith", "endsWith", "empty", "notEmpty"];
const COMPARISON_FILTER_MODES = ["equals", "notEquals", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo", "between", "betweenInclusive", "empty", "notEmpty"];
const OPTIONAL_COLUMNS = { experienceTime: false, currency: false };
const BookingTextCell = ({ value, strong = false }: { value: unknown; strong?: boolean }) =>
  <Text size="sm" fw={strong ? 700 : undefined} ta="center" style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" }}>{cleanText(value)}</Text>;

const RevenueBookingsTable = ({ rows }: RevenueBookingsTableProps) => {
  const canPinColumns = useMediaQuery('(min-width: 48em)');
  const data = useMemo(() => sortRevenueBookingRowsBySourceReceivedAt(rows), [rows]);
  const columns = useMemo<MRT_ColumnDef<RevenueBookingRow>[]>(() => [
    {
      accessorKey: "reference", header: "Booking", size: 220, filterFn: "contains",
      Cell: ({ row }) => <BookingTextCell strong value={cleanText(row.original.reference, String(row.original.bookingId))} />,
    },
    {
      accessorKey: "customerName", header: "Customer", size: 220, filterFn: "contains",
      Cell: ({ row }) => <BookingTextCell strong value={cleanText(row.original.customerName, "Unknown customer")} />,
    },
    { accessorKey: "bookingId", header: "Booking ID", size: 160, filterFn: "contains", Cell: ({ row }) => `#${cleanText(row.original.bookingId)}` },
    { accessorKey: "customerEmail", header: "Customer Email", size: 240, filterFn: "contains", Cell: ({ cell }) => <BookingTextCell value={cell.getValue()} /> },
    { accessorKey: "platform", header: "Platform", filterVariant: "autocomplete", filterFn: "equals", size: 160, Cell: ({ cell }) => <BookingTextCell value={cell.getValue()} /> },
    { accessorKey: "productName", header: "Product", filterVariant: "autocomplete", filterFn: "contains", size: 220, Cell: ({ cell }) => <BookingTextCell value={cell.getValue()} /> },
    {
      id: "sourceReceivedAt", header: `Source Received At (${BOOKINGS_SUMMARY_TIMEZONE})`, size: 260,
      // Filter by Warsaw calendar days; sort by the actual instant, including time.
      accessorFn: row => sourceReceivedCalendarDate(row.sourceReceivedAt),
      filterVariant: "date", filterFn: "greaterThanOrEqualTo", columnFilterModeOptions: COMPARISON_FILTER_MODES,
      sortUndefined: "last",
      sortingFn: (left, right) => (parseSourceReceivedTimestamp(left.original.sourceReceivedAt) ?? 0)
        - (parseSourceReceivedTimestamp(right.original.sourceReceivedAt) ?? 0),
      Cell: ({ row }) => <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>{cleanText(row.original.sourceReceivedAtLabel)}</Text>,
    },
    {
      id: "experienceDate", header: "Experience Date", size: 220,
      accessorFn: row => bookingTableCalendarDate(row.experienceDate),
      filterVariant: "date", filterFn: "greaterThanOrEqualTo", columnFilterModeOptions: COMPARISON_FILTER_MODES,
      sortUndefined: "last",
      sortingFn: (left, right) => formatExperience(left.original.experienceDate, left.original.experienceTime)
        .localeCompare(formatExperience(right.original.experienceDate, right.original.experienceTime)),
      Cell: ({ row }) => <Text size="sm" fw={600} style={{ whiteSpace: "nowrap" }}>{formatExperience(row.original.experienceDate, row.original.experienceTime)}</Text>,
    },
    {
      accessorKey: "guests", header: "Guests", size: 150, filterFn: "greaterThanOrEqualTo", columnFilterModeOptions: COMPARISON_FILTER_MODES,
      Cell: ({ cell }) => Math.max(0, Number(cell.getValue()) || 0).toLocaleString(),
    },
    {
      id: "status", header: "Status", accessorFn: row => formatStatus(row.status),
      filterVariant: "autocomplete", filterFn: "equals", size: 170,
      Cell: ({ row }) => <Badge size="sm" variant="light" color={getStatusColor(row.original.status)}>{formatStatus(row.original.status)}</Badge>,
    },
    {
      id: "paymentStatus", header: "Payment", accessorFn: row => formatStatus(row.paymentStatus),
      filterVariant: "autocomplete", filterFn: "equals", size: 180,
      Cell: ({ row }) => <Badge size="sm" variant="light" color={getStatusColor(row.original.paymentStatus)}>{formatStatus(row.original.paymentStatus)}</Badge>,
    },
    {
      accessorKey: "revenue", header: "Revenue", size: 170, filterFn: "greaterThanOrEqualTo", columnFilterModeOptions: COMPARISON_FILTER_MODES,
      Cell: ({ row }) => <Text size="sm" fw={800} style={{ whiteSpace: "nowrap" }}>{formatMoney(row.original.revenue, row.original.currency)}</Text>,
    },
    { accessorKey: "experienceTime", header: "Experience Time", size: 180, filterFn: "contains" },
    { accessorKey: "currency", header: "Currency", size: 150, filterVariant: "autocomplete", filterFn: "equals" },
    {
      id: "actions", header: "Action", columnDefType: "display", size: 145,
      enableHiding: false, enableColumnActions: false, enableColumnOrdering: false,
      Cell: ({ row }) => <Button size="xs" variant="light" style={{ whiteSpace: "nowrap" }}
        aria-label={`See details for ${cleanText(row.original.customerName, "Unknown customer")} (${cleanText(row.original.reference, String(row.original.bookingId))}, booking #${cleanText(row.original.bookingId)})`}
        onClick={row.original.onSeeDetails}>See Details</Button>,
    },
  ], []);
  const defaultFilterFns = useMemo(() => Object.fromEntries(columns
    .filter(column => column.columnDefType !== "display")
    .map(column => [column.id ?? column.accessorKey, column.filterFn])), [columns]);
  const table = useMantineReactTable({
    columns, data,
    enableColumnFilters: true, enableColumnFilterModes: true, columnFilterModeOptions: TEXT_FILTER_MODES,
    enableFacetedValues: true, enableGlobalFilter: true, globalFilterFn: "contains",
    enableGlobalFilterRankedResults: false, enableFilterMatchHighlighting: false,
    enableMultiSort: true, enableHiding: true,
    enableColumnActions: false,
    enableColumnPinning: canPinColumns, enableColumnResizing: true, enableStickyHeader: true, enableRowSelection: false,
    paginationDisplayMode: "pages", sortDescFirst: false,
    initialState: {
      showColumnFilters: true, showGlobalFilter: true, density: "xs",
      sorting: [{ id: "sourceReceivedAt", desc: true }],
      pagination: { pageIndex: 0, pageSize: PAGE_SIZE_OPTIONS[0] },
      columnVisibility: OPTIONAL_COLUMNS, columnPinning: { left: ["reference"], right: ["actions"] },
    },
    mantineTableProps: { "aria-label": "Bookings revenue table", striped: true, highlightOnHover: true, withColumnBorders: true },
    mantineTableHeadCellProps: ({ column }) => ({
      scope: "col", align: "center", "aria-label": column.columnDef.header,
      style: { verticalAlign: "middle", justifyContent: "center", textAlign: "center" },
      "aria-sort": column.getIsSorted() === "asc" ? "ascending" : column.getIsSorted() === "desc" ? "descending" : "none",
    }),
    mantineTableBodyCellProps: { align: "center", style: { verticalAlign: "middle", justifyContent: "center", alignItems: "center", textAlign: "center", overflowWrap: "anywhere" } },
    mantineTableContainerProps: { style: { maxHeight: 640 } },
    mantinePaperProps: { withBorder: false, shadow: undefined },
    mantinePaginationProps: { rowsPerPageOptions: PAGE_SIZE_OPTIONS.map(String) },
    mantineSearchTextInputProps: { placeholder: "Search all booking columns", "aria-label": "Search all booking columns" },
    mantineFilterTextInputProps: ({ column, rangeFilterIndex }) => ({
      "aria-label": `Filter ${column.columnDef.header}${rangeFilterIndex === 0 ? " minimum" : rangeFilterIndex === 1 ? " maximum" : ""}`,
      type: ["revenue", "guests"].includes(column.id) ? "number" : "text",
    }),
    mantineFilterAutocompleteProps: ({ column }) => ({ "aria-label": `Filter ${column.columnDef.header}` }),
    mantineFilterDateInputProps: ({ column, rangeFilterIndex }) => ({
      valueFormat: "YYYY-MM-DD",
      "aria-label": `Filter ${column.columnDef.header}${rangeFilterIndex === 0 ? " minimum" : rangeFilterIndex === 1 ? " maximum" : ""}`,
    }),
    renderTopToolbarCustomActions: ({ table }) => <Group gap="xs" wrap="wrap">
      <Badge variant="light">{`${table.getFilteredRowModel().rows.length.toLocaleString()} matching`}</Badge>
      <Button size="xs" variant="subtle" onClick={() => {
        table.resetColumnFilters(); table.resetGlobalFilter(); table.setColumnFilterFns(defaultFilterFns);
        table.resetSorting(); table.resetColumnVisibility(); table.resetColumnOrder();
        table.resetColumnPinning(); table.resetPagination();
      }}>Reset table</Button>
    </Group>,
    renderBottomToolbarCustomActions: ({ table }) => {
      const total = table.getFilteredRowModel().rows.length;
      const { pageIndex, pageSize } = table.getState().pagination;
      const first = total ? pageIndex * pageSize + 1 : 0;
      return <Text size="xs" c="dimmed">{`Showing ${first}\u2013${Math.min((pageIndex + 1) * pageSize, total)} of ${total.toLocaleString()}`}</Text>;
    },
    renderEmptyRowsFallback: () => <Text ta="center" p="xl" c="dimmed">No bookings found for the selected filters.</Text>,
  });
  return <Paper withBorder radius="lg" p={{ base: "sm", sm: "md" }} shadow="sm">
    <Group gap="xs" mb="xs">
      <Text fw={800} size="lg">Bookings</Text>
      <Badge variant="light" color="blue" size="lg">{`${rows.length.toLocaleString()} total`}</Badge>
    </Group>
    <Text size="xs" c="dimmed" mb="sm">
      Filter multiple columns together. Use the filter menus for conditions and ranges; Shift-click headers to sort by multiple columns.
      Show/hide columns to customize this list. Summary totals above stay unchanged.
    </Text>
    <BookingTableExportControls table={table} />
    <MantineReactTable table={table} />
  </Paper>;
};

export default RevenueBookingsTable;
