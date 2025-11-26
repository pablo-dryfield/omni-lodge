import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  ActionIcon,
  Button,
  Card,
  Grid,
  Group,
  Loader,
  NumberInput,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import dayjs from "dayjs";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import axiosInstance from "../../utils/axiosInstance";
import { ServerResponse } from "../../types/general/ServerResponse";
import type {
  VenuePayoutSummary,
  VenuePayoutVenueBreakdown,
  VenuePayoutVenueDaily,
} from "../../types/nightReports/VenuePayoutSummary";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { useFinanceBootstrap } from "../../hooks/useFinanceBootstrap";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { createFinanceTransaction } from "../../actions/financeActions";
import type { EditSelectOption } from "../../utils/CustomEditSelect";

type DailyRow = VenuePayoutVenueDaily & { placeholder?: boolean };

type CashEntryState = {
  amount: number;
  currency: string;
  date: Date;
  accountId: string;
  categoryId: string;
  counterpartyId: string;
  venueId: string;
  description: string;
};

type MessageState = { type: "success" | "error"; text: string } | null;

const PERIOD_OPTIONS = [
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
  { label: "Custom", value: "custom" },
];

const DEFAULT_CURRENCY = "PLN";

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);

const toMinorUnits = (value: number) => Math.round(value * 100);

dayjs.extend(isSameOrBefore);

const VenueNumbersSummary = () => {
  const dispatch = useAppDispatch();
  useFinanceBootstrap();
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);

  const [period, setPeriod] = useState<string>("this_month");
  const [customRange, setCustomRange] = useState<[Date | null, Date | null]>([null, null]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<VenuePayoutSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commissionEntry, setCommissionEntry] = useState<CashEntryState>({
    amount: 0,
    currency: DEFAULT_CURRENCY,
    date: new Date(),
    accountId: "",
    categoryId: "",
    counterpartyId: "",
    venueId: "",
    description: "",
  });
  const [payoutEntry, setPayoutEntry] = useState<CashEntryState>({
    amount: 0,
    currency: DEFAULT_CURRENCY,
    date: new Date(),
    accountId: "",
    categoryId: "",
    counterpartyId: "",
    venueId: "",
    description: "",
  });
  const [commissionMessage, setCommissionMessage] = useState<MessageState>(null);
  const [payoutMessage, setPayoutMessage] = useState<MessageState>(null);
  const [commissionSubmitting, setCommissionSubmitting] = useState(false);
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (rowKey: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  const commissionVenueOptions = useMemo<EditSelectOption[]>(() => {
    if (!summary) {
      return [];
    }
    return summary.venues
      .filter((venue) => venue.venueId !== null && (venue.receivable > 0 || venue.receivableOutstanding > 0))
      .map((venue) => ({
        value: String(venue.venueId),
        label: `${venue.venueName} (${venue.currency})`,
      }));
  }, [summary]);

  const payoutVenueOptions = useMemo<EditSelectOption[]>(() => {
    if (!summary) {
      return [];
    }
    return summary.venues
      .filter((venue) => venue.venueId !== null && (venue.payable > 0 || venue.payableOutstanding > 0))
      .map((venue) => ({
        value: String(venue.venueId),
        label: `${venue.venueName} (${venue.currency})`,
      }));
  }, [summary]);

  const canFetch = period !== "custom" || (customRange[0] && customRange[1]);

  const fetchSummary = useCallback(async () => {
    if (!canFetch) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { period };
      if (period === "custom" && customRange[0] && customRange[1]) {
        params.startDate = dayjs(customRange[0]).format("YYYY-MM-DD");
        params.endDate = dayjs(customRange[1]).format("YYYY-MM-DD");
      }
      const response = await axiosInstance.get<ServerResponse<VenuePayoutSummary>>(
        "/nightReports/metrics/venue-summary",
        {
          params,
          withCredentials: true,
        },
      );
      const payload = response.data[0]?.data;
      if (Array.isArray(payload)) {
        setSummary((payload[0] as VenuePayoutSummary) ?? null);
      } else {
        setSummary((payload as unknown as VenuePayoutSummary) ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load summary";
      setError(message);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [canFetch, customRange, period]);

  useEffect(() => {
    if (canFetch) {
      fetchSummary();
    }
  }, [fetchSummary, canFetch]);

  useEffect(() => {
    setExpandedRows(new Set());
  }, [summary]);

  useEffect(() => {
    if (!summary) {
      return;
    }
    const defaultCurrency = summary.totalsByCurrency[0]?.currency ?? DEFAULT_CURRENCY;
    const defaultReceivable =
      summary.totalsByCurrency[0]?.receivableOutstanding ??
      summary.totalsByCurrency[0]?.receivable ??
      0;
    const defaultPayable =
      summary.totalsByCurrency[0]?.payableOutstanding ?? summary.totalsByCurrency[0]?.payable ?? 0;
    const rangeLabel = `${summary.range.startDate} → ${summary.range.endDate}`;

    setCommissionEntry((prev) => ({
      ...prev,
      currency: defaultCurrency,
      amount: prev.amount === 0 ? defaultReceivable : prev.amount,
      description: prev.description || `Commission collection for ${rangeLabel}`,
      date: prev.date ?? new Date(),
      venueId: prev.venueId,
    }));

    setPayoutEntry((prev) => ({
      ...prev,
      currency: defaultCurrency,
      amount: prev.amount === 0 ? defaultPayable : prev.amount,
      description: prev.description || `Open bar payout for ${rangeLabel}`,
      date: prev.date ?? new Date(),
      venueId: prev.venueId,
    }));
  }, [summary]);

useEffect(() => {
    if (!commissionVenueOptions.length) {
      if (commissionEntry.venueId) {
        setCommissionEntry((prev) => ({ ...prev, venueId: "" }));
      }
      return;
    }
    const exists = commissionVenueOptions.some((opt) => opt.value === commissionEntry.venueId);
    if (!exists) {
      setCommissionEntry((prev) => ({ ...prev, venueId: commissionVenueOptions[0].value }));
    }
  }, [commissionEntry.venueId, commissionVenueOptions]);

useEffect(() => {
    if (!payoutVenueOptions.length) {
      if (payoutEntry.venueId) {
        setPayoutEntry((prev) => ({ ...prev, venueId: "" }));
      }
      return;
    }
    const exists = payoutVenueOptions.some((opt) => opt.value === payoutEntry.venueId);
    if (!exists) {
      setPayoutEntry((prev) => ({ ...prev, venueId: payoutVenueOptions[0].value }));
    }
  }, [payoutEntry.venueId, payoutVenueOptions]);

  const accountOptions = useMemo(
    () =>
      accounts.data.map((account) => ({
        value: String(account.id),
        label: `${account.name} (${account.currency})`,
      })),
    [accounts.data],
  );

  const incomeCategoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.kind === "income")
        .map((category) => ({ value: String(category.id), label: category.name })),
    [categories.data],
  );

  const expenseCategoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.kind === "expense")
        .map((category) => ({ value: String(category.id), label: category.name })),
    [categories.data],
  );

  const vendorOptions = useMemo(
    () => vendors.data.map((vendor) => ({ value: String(vendor.id), label: vendor.name })),
    [vendors.data],
  );

  const clientOptions = useMemo(
    () => clients.data.map((client) => ({ value: String(client.id), label: client.name })),
    [clients.data],
  );

  const handleCommissionSubmit = async () => {
    setCommissionMessage(null);
    if (
      commissionEntry.amount <= 0 ||
      !commissionEntry.accountId ||
      !commissionEntry.categoryId ||
      !commissionEntry.counterpartyId ||
      !commissionEntry.venueId
    ) {
      setCommissionMessage({
        type: "error",
        text: "Fill in the amount, account, category, client, and venue.",
      });
      return;
    }
    if (!summary) {
      setCommissionMessage({ type: "error", text: "Load a summary range before recording payments." });
      return;
    }
    setCommissionSubmitting(true);
    try {
      const transaction = await dispatch(
        createFinanceTransaction({
          kind: "income",
          date: dayjs(commissionEntry.date).format("YYYY-MM-DD"),
          accountId: Number(commissionEntry.accountId),
          currency: commissionEntry.currency,
          amountMinor: toMinorUnits(commissionEntry.amount),
          categoryId: Number(commissionEntry.categoryId),
          counterpartyType: "client",
          counterpartyId: Number(commissionEntry.counterpartyId),
          status: "paid",
          description: commissionEntry.description || null,
          meta: {
            source: "venue-numbers-summary",
            period: summary.period,
            rangeStart: summary.range.startDate,
            rangeEnd: summary.range.endDate,
          },
        }),
      ).unwrap();

      await axiosInstance.post(
        "/nightReports/venue-collections",
        {
          venueId: Number(commissionEntry.venueId),
          direction: "receivable",
          currency: commissionEntry.currency,
          amount: commissionEntry.amount,
          rangeStart: summary.range.startDate,
          rangeEnd: summary.range.endDate,
          financeTransactionId: transaction.id,
          note: commissionEntry.description ?? null,
        },
        { withCredentials: true },
      );

      setCommissionMessage({ type: "success", text: "Commission recorded and logged." });
      setCommissionEntry((prev) => ({ ...prev, amount: 0 }));
      await fetchSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to record transaction.";
      setCommissionMessage({ type: "error", text: message });
    } finally {
      setCommissionSubmitting(false);
    }
  };

  const buildDailyRows = useCallback(
    (venue: VenuePayoutVenueBreakdown): DailyRow[] => {
      if (!summary) {
        return venue.daily;
      }
      const start = dayjs(summary.range.startDate).startOf("day");
      const end = dayjs(summary.range.endDate).endOf("day");
      if (!start.isValid() || !end.isValid()) {
        return venue.daily;
      }
      const rows: DailyRow[] = venue.daily.map((entry) => ({ ...entry }));
      const seenDates = new Set(rows.map((row) => row.date));
      let cursor = start.clone();
      while (cursor.isSameOrBefore(end, "day")) {
        const dateKey = cursor.format("YYYY-MM-DD");
        if (!seenDates.has(dateKey)) {
          rows.push({
            date: dateKey,
            reportId: null,
            totalPeople: 0,
            amount: 0,
            direction: "receivable",
            placeholder: true,
          });
        }
        cursor = cursor.add(1, "day");
      }
      rows.sort((a, b) => a.date.localeCompare(b.date));
      return rows;
    },
    [summary],
  );

  const handlePayoutSubmit = async () => {
    setPayoutMessage(null);
    if (
      payoutEntry.amount <= 0 ||
      !payoutEntry.accountId ||
      !payoutEntry.categoryId ||
      !payoutEntry.counterpartyId ||
      !payoutEntry.venueId
    ) {
      setPayoutMessage({
        type: "error",
        text: "Fill in the amount, account, category, vendor, and venue.",
      });
      return;
    }
    if (!summary) {
      setPayoutMessage({ type: "error", text: "Load a summary range before recording payments." });
      return;
    }
    setPayoutSubmitting(true);
    try {
      const transaction = await dispatch(
        createFinanceTransaction({
          kind: "expense",
          date: dayjs(payoutEntry.date).format("YYYY-MM-DD"),
          accountId: Number(payoutEntry.accountId),
          currency: payoutEntry.currency,
          amountMinor: toMinorUnits(payoutEntry.amount),
          categoryId: Number(payoutEntry.categoryId),
          counterpartyType: "vendor",
          counterpartyId: Number(payoutEntry.counterpartyId),
          status: "paid",
          description: payoutEntry.description || null,
          meta: {
            source: "venue-numbers-summary",
            period: summary.period,
            rangeStart: summary.range.startDate,
            rangeEnd: summary.range.endDate,
          },
        }),
      ).unwrap();

      await axiosInstance.post(
        "/nightReports/venue-collections",
        {
          venueId: Number(payoutEntry.venueId),
          direction: "payable",
          currency: payoutEntry.currency,
          amount: payoutEntry.amount,
          rangeStart: summary.range.startDate,
          rangeEnd: summary.range.endDate,
          financeTransactionId: transaction.id,
          note: payoutEntry.description ?? null,
        },
        { withCredentials: true },
      );

      setPayoutMessage({ type: "success", text: "Open bar payout recorded and logged." });
      setPayoutEntry((prev) => ({ ...prev, amount: 0 }));
      await fetchSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to record transaction.";
      setPayoutMessage({ type: "error", text: message });
    } finally {
      setPayoutSubmitting(false);
    }
  };

  const handleAccountChange = (value: string | null, target: "commission" | "payout") => {
    if (!value) {
      if (target === "commission") {
        setCommissionEntry((prev) => ({ ...prev, accountId: "" }));
      } else {
        setPayoutEntry((prev) => ({ ...prev, accountId: "" }));
      }
      return;
    }
    const account = accounts.data.find((item) => item.id === Number(value));
    if (target === "commission") {
      setCommissionEntry((prev) => ({
        ...prev,
        accountId: value,
        currency: account?.currency ?? prev.currency,
      }));
    } else {
      setPayoutEntry((prev) => ({
        ...prev,
        accountId: value,
        currency: account?.currency ?? prev.currency,
      }));
    }
  };

  return (
    <Stack gap="xl">
      <Card withBorder padding="md">
        <Stack gap="md">
          <Group justify="space-between" align="flex-end">
            <div>
              <Text fw={600}>Reporting period</Text>
              <SegmentedControl
                value={period}
                onChange={setPeriod}
                data={PERIOD_OPTIONS}
                size="sm"
                fullWidth
              />
            </div>
            <div>
              <Button onClick={fetchSummary} disabled={!canFetch || loading}>
                Refresh
              </Button>
            </div>
          </Group>
          {period === "custom" && (
            <DatePickerInput
              type="range"
              label="Custom date range"
              value={customRange}
              onChange={setCustomRange}
              allowSingleDateInRange
            />
          )}
          {error && <Alert color="red">{error}</Alert>}
          {!canFetch && period === "custom" && (
            <Alert color="yellow">Select both start and end dates to load the summary.</Alert>
          )}
        </Stack>
      </Card>

      {loading && (
        <Card withBorder padding="xl">
          <Group justify="center">
            <Loader />
            <Text>Loading summary...</Text>
          </Group>
        </Card>
      )}

      {!loading && summary && (
        <Stack gap="xl">
          <Card withBorder padding="lg">
            <Stack gap="sm">
              <Group justify="space-between">
                <div>
                  <Title order={4}>Totals</Title>
                  <Text c="dimmed">
                    {dayjs(summary.range.startDate).format("MMM D, YYYY")} →{" "}
                    {dayjs(summary.range.endDate).format("MMM D, YYYY")}
                  </Text>
                </div>
              </Group>
              {summary.totalsByCurrency.length === 0 ? (
                <Text>No payouts or commissions recorded for this range.</Text>
              ) : (
                <Grid>
                  {summary.totalsByCurrency.map((row) => (
                    <Grid.Col span={{ base: 12, md: 4 }} key={row.currency}>
                      <Card shadow="sm" padding="md" withBorder>
                        <Stack gap={4}>
                          <Text fw={600}>{row.currency}</Text>
                          <Stack gap={2}>
                            <Group justify="space-between">
                              <Text c="dimmed" size="sm">
                                Commission owed
                              </Text>
                              <Text>{formatCurrency(row.receivable, row.currency)}</Text>
                            </Group>
                            <Group justify="space-between">
                              <Text c="dimmed" size="sm">
                                Collected
                              </Text>
                              <Text>{formatCurrency(row.receivableCollected, row.currency)}</Text>
                            </Group>
                            <Group justify="space-between">
                              <Text c="dimmed" size="sm">
                                Outstanding
                              </Text>
                              <Text>{formatCurrency(row.receivableOutstanding, row.currency)}</Text>
                            </Group>
                          </Stack>
                          <Stack gap={2}>
                            <Group justify="space-between">
                              <Text c="dimmed" size="sm">
                                Open bar payouts
                              </Text>
                              <Text>{formatCurrency(row.payable, row.currency)}</Text>
                            </Group>
                            <Group justify="space-between">
                              <Text c="dimmed" size="sm">
                                Paid
                              </Text>
                              <Text>{formatCurrency(row.payableCollected, row.currency)}</Text>
                            </Group>
                            <Group justify="space-between">
                              <Text c="dimmed" size="sm">
                                Outstanding
                              </Text>
                              <Text>{formatCurrency(row.payableOutstanding, row.currency)}</Text>
                            </Group>
                          </Stack>
                          <Group justify="space-between" mt="sm">
                            <Text c="dimmed" size="sm">
                              Net
                            </Text>
                            <Text fw={600} c={row.net >= 0 ? "green" : "red"}>
                              {formatCurrency(row.net, row.currency)}
                            </Text>
                          </Group>
                        </Stack>
                      </Card>
                    </Grid.Col>
                  ))}
                </Grid>
              )}
            </Stack>
          </Card>

          <Card withBorder padding="lg">
            <Stack gap="sm">
              <Title order={5}>Breakdown by venue</Title>
              {summary.venues.length === 0 ? (
                <Text>No venue data for this range.</Text>
              ) : (
                <Table highlightOnHover withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th />
                      <Table.Th>Venue</Table.Th>
                      <Table.Th>Total People</Table.Th>
                      <Table.Th>Commission Owed</Table.Th>
                      <Table.Th>Commission Collected</Table.Th>
                      <Table.Th>Commission Outstanding</Table.Th>
                      <Table.Th>Payout Owed</Table.Th>
                      <Table.Th>Payout Paid</Table.Th>
                      <Table.Th>Payout Outstanding</Table.Th>
                      <Table.Th>Net</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.venues.map((venue) => {
                      const isExpanded = expandedRows.has(venue.rowKey);
                      const dailyRows = buildDailyRows(venue);
                      return (
                        <Fragment key={venue.rowKey}>
                          <Table.Tr>
                            <Table.Td w={40}>
                              <ActionIcon
                                variant="subtle"
                                onClick={() => toggleRow(venue.rowKey)}
                                aria-label={isExpanded ? "Collapse venue details" : "Expand venue details"}
                              >
                                {isExpanded ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                              </ActionIcon>
                            </Table.Td>
                            <Table.Td>
                              <Text fw={600}>{venue.venueName}</Text>
                            </Table.Td>
                            <Table.Td>{venue.totalPeople}</Table.Td>
                            <Table.Td>{formatCurrency(venue.receivable, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.receivableCollected, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.receivableOutstanding, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.payable, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.payableCollected, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.payableOutstanding, venue.currency)}</Table.Td>
                            <Table.Td c={venue.net >= 0 ? "green" : "red"}>
                              {formatCurrency(venue.net, venue.currency)}
                            </Table.Td>
                          </Table.Tr>
                          {isExpanded && (
                            <Table.Tr>
                              <Table.Td colSpan={10}>
                                <Stack gap="xs">
                                  <Group justify="space-between">
                                    <Text fw={600} size="sm">
                                      Daily performance
                                    </Text>
                                    <Text size="sm" c="dimmed">
                                      {dailyRows.length} day{dailyRows.length === 1 ? "" : "s"} tracked
                                    </Text>
                                  </Group>
                                  {dailyRows.length === 0 ? (
                                    <Text size="sm" c="dimmed">
                                      No submitted reports match this venue during the selected period.
                                    </Text>
                                  ) : (
                                    <Table striped withColumnBorders>
                                      <Table.Thead>
                                        <Table.Tr>
                                          <Table.Th>Date</Table.Th>
                                          <Table.Th>Total People</Table.Th>
                                          <Table.Th>Report</Table.Th>
                                          <Table.Th>Type</Table.Th>
                                          <Table.Th>Amount</Table.Th>
                                        </Table.Tr>
                                      </Table.Thead>
                                      <Table.Tbody>
                                        {dailyRows.map((day) => {
                                          const placeholder = Boolean(day.placeholder);
                                          const amountColor = placeholder
                                            ? "dimmed"
                                            : day.direction === "receivable"
                                              ? "green"
                                              : "red";
                                          return (
                                            <Table.Tr key={`${day.date}-${day.reportId ?? "none"}-${day.direction}`}>
                                              <Table.Td>{dayjs(day.date).format("MMM D, YYYY")}</Table.Td>
                                              <Table.Td>{day.totalPeople}</Table.Td>
                                              <Table.Td>
                                                {placeholder
                                                  ? "No report"
                                                  : day.reportId
                                                    ? `Report #${day.reportId}`
                                                    : "N/A"}
                                              </Table.Td>
                                              <Table.Td>
                                                {placeholder
                                                  ? "No activity"
                                                  : day.direction === "receivable"
                                                    ? "Commission"
                                                    : "Open bar payout"}
                                              </Table.Td>
                                              <Table.Td c={amountColor}>
                                                {formatCurrency(day.amount, venue.currency)}
                                              </Table.Td>
                                            </Table.Tr>
                                          );
                                        })}
                                      </Table.Tbody>
                                    </Table>
                                  )}
                                </Stack>
                              </Table.Td>
                            </Table.Tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </Card>

          <Grid>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder padding="lg">
                <Stack gap="sm">
                  <Title order={5}>Record commission collected</Title>
                  <NumberInput
                    label="Amount"
                    value={commissionEntry.amount}
                    onChange={(value) =>
                      setCommissionEntry((prev) => ({
                        ...prev,
                        amount: typeof value === "number" ? value : 0,
                      }))
                    }
                    min={0}
                    decimalScale={2}
                    fixedDecimalScale
                    hideControls
                  />
                  <Select
                    label="Account"
                    data={accountOptions}
                    value={commissionEntry.accountId}
                    onChange={(value) => handleAccountChange(value, "commission")}
                    placeholder="Select account"
                  />
                  <Select
                    label="Category"
                    data={incomeCategoryOptions}
                    value={commissionEntry.categoryId}
                    onChange={(value) =>
                      setCommissionEntry((prev) => ({ ...prev, categoryId: value ?? "" }))
                    }
                    placeholder="Select category"
                  />
                  <Select
                    label="Venue"
                    data={commissionVenueOptions}
                    value={commissionEntry.venueId}
                    onChange={(value) =>
                      setCommissionEntry((prev) => ({ ...prev, venueId: value ?? "" }))
                    }
                    placeholder="Select venue"
                    disabled={!commissionVenueOptions.length}
                  />
                  <Select
                    label="Client"
                    data={clientOptions}
                    value={commissionEntry.counterpartyId}
                    onChange={(value) =>
                      setCommissionEntry((prev) => ({ ...prev, counterpartyId: value ?? "" }))
                    }
                    placeholder="Select client"
                  />
                  <DatePickerInput
                    label="Date"
                    value={commissionEntry.date}
                    onChange={(value) =>
                      setCommissionEntry((prev) => ({ ...prev, date: value ?? new Date() }))
                    }
                  />
                  <Textarea
                    label="Description"
                    value={commissionEntry.description}
                    onChange={(event) =>
                      setCommissionEntry((prev) => ({ ...prev, description: event.currentTarget.value }))
                    }
                    minRows={2}
                  />
                  {commissionMessage && (
                    <Alert color={commissionMessage.type === "success" ? "green" : "red"}>
                      {commissionMessage.text}
                    </Alert>
                  )}
                  <Button
                    onClick={handleCommissionSubmit}
                    loading={commissionSubmitting}
                    disabled={!commissionVenueOptions.length || !summary}
                  >
                    Record collection
                  </Button>
                </Stack>
              </Card>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }}>
              <Card withBorder padding="lg">
                <Stack gap="sm">
                  <Title order={5}>Record open bar payout</Title>
                  <NumberInput
                    label="Amount"
                    value={payoutEntry.amount}
                    onChange={(value) =>
                      setPayoutEntry((prev) => ({
                        ...prev,
                        amount: typeof value === "number" ? value : 0,
                      }))
                    }
                    min={0}
                    decimalScale={2}
                    fixedDecimalScale
                    hideControls
                  />
                  <Select
                    label="Account"
                    data={accountOptions}
                    value={payoutEntry.accountId}
                    onChange={(value) => handleAccountChange(value, "payout")}
                    placeholder="Select account"
                  />
                  <Select
                    label="Category"
                    data={expenseCategoryOptions}
                    value={payoutEntry.categoryId}
                    onChange={(value) =>
                      setPayoutEntry((prev) => ({ ...prev, categoryId: value ?? "" }))
                    }
                    placeholder="Select category"
                  />
                  <Select
                    label="Venue"
                    data={payoutVenueOptions}
                    value={payoutEntry.venueId}
                    onChange={(value) => setPayoutEntry((prev) => ({ ...prev, venueId: value ?? "" }))}
                    placeholder="Select venue"
                    disabled={!payoutVenueOptions.length}
                  />
                  <Select
                    label="Vendor"
                    data={vendorOptions}
                    value={payoutEntry.counterpartyId}
                    onChange={(value) =>
                      setPayoutEntry((prev) => ({ ...prev, counterpartyId: value ?? "" }))
                    }
                    placeholder="Select vendor"
                  />
                  <DatePickerInput
                    label="Date"
                    value={payoutEntry.date}
                    onChange={(value) =>
                      setPayoutEntry((prev) => ({ ...prev, date: value ?? new Date() }))
                    }
                  />
                  <Textarea
                    label="Description"
                    value={payoutEntry.description}
                    onChange={(event) =>
                      setPayoutEntry((prev) => ({ ...prev, description: event.currentTarget.value }))
                    }
                    minRows={2}
                  />
                  {payoutMessage && (
                    <Alert color={payoutMessage.type === "success" ? "green" : "red"}>
                      {payoutMessage.text}
                    </Alert>
                  )}
                  <Button
                    onClick={handlePayoutSubmit}
                    loading={payoutSubmitting}
                    disabled={!payoutVenueOptions.length || !summary}
                  >
                    Record payout
                  </Button>
                </Stack>
              </Card>
            </Grid.Col>
          </Grid>
        </Stack>
      )}
    </Stack>
  );
};

export default VenueNumbersSummary;
