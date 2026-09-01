import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { BOOKINGS_SUMMARY_TIMEZONE } from "../../utils/bookingsSummaryDate";

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

const RevenueBookingsTable = ({ rows }: RevenueBookingsTableProps) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);

  const sortedRows = useMemo(
    () => sortRevenueBookingRowsBySourceReceivedAt(rows),
    [rows],
  );
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const firstVisibleIndex = (currentPage - 1) * pageSize;
  const visibleRows = useMemo(
    () => sortedRows.slice(firstVisibleIndex, firstVisibleIndex + pageSize),
    [firstVisibleIndex, pageSize, sortedRows],
  );
  const lastVisibleIndex = Math.min(firstVisibleIndex + visibleRows.length, sortedRows.length);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  useEffect(() => {
    setPage(1);
  }, [rows]);

  const handlePageSizeChange = (value: string | null) => {
    const parsed = Number(value);
    if (!PAGE_SIZE_OPTIONS.some((option) => option === parsed)) return;
    setPageSize(parsed);
    setPage(1);
  };

  return (
    <Paper withBorder radius="lg" p={{ base: "sm", sm: "md" }} shadow="sm">
      <Group justify="space-between" align="center" gap="sm" wrap="wrap" mb="sm">
        <Group gap="xs" align="center" wrap="nowrap">
          <Text fw={800} size="lg">
            Bookings
          </Text>
          <Badge variant="light" color="blue" size="lg">
            {`${rows.length.toLocaleString()} total`}
          </Badge>
        </Group>
      </Group>

      <Table.ScrollContainer minWidth={1260}>
        <Table
          aria-label="Bookings revenue table"
          striped
          highlightOnHover
          withColumnBorders
          verticalSpacing="sm"
          horizontalSpacing="sm"
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th
                scope="col"
                ta="center"
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 3,
                  background: "var(--mantine-color-body)",
                  boxShadow: "2px 0 4px rgba(0, 0, 0, 0.06)",
                }}
              >
                Booking
              </Table.Th>
              <Table.Th scope="col" ta="center">Customer</Table.Th>
              <Table.Th scope="col" ta="center">Platform</Table.Th>
              <Table.Th scope="col" ta="center">Product</Table.Th>
              <Table.Th scope="col" ta="center" aria-sort="descending">
                <span>{`Source Received At (${BOOKINGS_SUMMARY_TIMEZONE})`}</span>{" "}
                <span aria-hidden="true">↓</span>
              </Table.Th>
              <Table.Th scope="col" ta="center">Experience Date</Table.Th>
              <Table.Th scope="col" ta="center">Guests</Table.Th>
              <Table.Th scope="col" ta="center">Status</Table.Th>
              <Table.Th scope="col" ta="center">Payment</Table.Th>
              <Table.Th scope="col" ta="center">Revenue</Table.Th>
              <Table.Th
                scope="col"
                ta="center"
                style={{
                  position: "sticky",
                  right: 0,
                  zIndex: 3,
                  background: "var(--mantine-color-body)",
                  boxShadow: "-2px 0 4px rgba(0, 0, 0, 0.06)",
                }}
              >
                Action
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibleRows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={11} ta="center" py="xl">
                  <Text c="dimmed" size="sm">No bookings found for the selected filters.</Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              visibleRows.map((row, index) => {
                const bookingId = cleanText(row.bookingId);
                const reference = cleanText(row.reference, bookingId);
                const customerName = cleanText(row.customerName, "Unknown customer");
                const detailsLabel = `See details for ${customerName} (${reference}, booking #${bookingId})`;

                return (
                  <Table.Tr key={`${bookingId}-${reference}-${firstVisibleIndex + index}`}>
                    <Table.Td
                      ta="center"
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 2,
                        background: "var(--mantine-color-body)",
                        boxShadow: "2px 0 4px rgba(0, 0, 0, 0.06)",
                      }}
                    >
                      <Stack gap={1} align="center">
                        <Text size="sm" fw={700} style={{ overflowWrap: "anywhere" }}>
                          {reference}
                        </Text>
                        <Text size="xs" c="dimmed">{`#${bookingId}`}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Stack gap={1} align="center">
                        <Text size="sm" fw={700} ta="center" style={{ overflowWrap: "anywhere" }}>
                          {customerName}
                        </Text>
                        {row.customerEmail ? (
                          <Text size="xs" c="dimmed" ta="center" style={{ overflowWrap: "anywhere" }}>
                            {row.customerEmail}
                          </Text>
                        ) : null}
                      </Stack>
                    </Table.Td>
                    <Table.Td ta="center">{cleanText(row.platform, "Unknown")}</Table.Td>
                    <Table.Td ta="center">
                      <Text size="sm" ta="center" style={{ overflowWrap: "anywhere" }}>
                        {cleanText(row.productName, "Unknown product")}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Text size="sm" fw={600} ta="center" style={{ whiteSpace: "nowrap" }}>
                        {cleanText(row.sourceReceivedAtLabel)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Text size="sm" fw={600} ta="center" style={{ whiteSpace: "nowrap" }}>
                        {formatExperience(row.experienceDate, row.experienceTime)}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="center">
                      {Math.max(0, Number(row.guests) || 0).toLocaleString()}
                    </Table.Td>
                    <Table.Td ta="center">
                      <Badge size="sm" variant="light" color={getStatusColor(row.status)}>
                        {formatStatus(row.status)}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Badge size="sm" variant="light" color={getStatusColor(row.paymentStatus)}>
                        {formatStatus(row.paymentStatus)}
                      </Badge>
                    </Table.Td>
                    <Table.Td ta="center">
                      <Text size="sm" fw={800} ta="center" style={{ whiteSpace: "nowrap" }}>
                        {formatMoney(row.revenue, row.currency)}
                      </Text>
                    </Table.Td>
                    <Table.Td
                      ta="center"
                      style={{
                        position: "sticky",
                        right: 0,
                        zIndex: 2,
                        background: "var(--mantine-color-body)",
                        boxShadow: "-2px 0 4px rgba(0, 0, 0, 0.06)",
                      }}
                    >
                      <Button
                        size="xs"
                        variant="light"
                        aria-label={detailsLabel}
                        onClick={row.onSeeDetails}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        See Details
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                );
              })
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {rows.length > 0 ? (
        <Group justify="space-between" align="center" gap="sm" wrap="wrap" mt="md">
          <Text size="xs" c="dimmed" ta="center">
            {`Showing ${firstVisibleIndex + 1}\u2013${lastVisibleIndex} of ${rows.length.toLocaleString()}`}
          </Text>
          <Group gap="sm" align="center" justify="center" wrap="wrap">
            <Group gap={6} align="center" wrap="nowrap">
              <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>Rows per page</Text>
              <Select
                aria-label="Rows per page"
                value={String(pageSize)}
                onChange={handlePageSizeChange}
                data={PAGE_SIZE_OPTIONS.map((option) => ({ value: String(option), label: String(option) }))}
                allowDeselect={false}
                size="xs"
                w={76}
                styles={{
                  input: { textAlign: "center", fontWeight: 700 },
                  option: { justifyContent: "center" },
                }}
              />
            </Group>
            {pageCount > 1 ? (
              <Pagination
                value={currentPage}
                onChange={setPage}
                total={pageCount}
                size="xs"
                boundaries={1}
                siblings={1}
              />
            ) : null}
          </Group>
        </Group>
      ) : null}
    </Paper>
  );
};

export default RevenueBookingsTable;
