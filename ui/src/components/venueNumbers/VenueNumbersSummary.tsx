import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
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
import axiosInstance from "../../utils/axiosInstance";
import { ServerResponse } from "../../types/general/ServerResponse";
import type { VenuePayoutSummary } from "../../types/nightReports/VenuePayoutSummary";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { useFinanceBootstrap } from "../../hooks/useFinanceBootstrap";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { createFinanceTransaction } from "../../actions/financeActions";

type CashEntryState = {
  amount: number;
  currency: string;
  date: Date;
  accountId: string;
  categoryId: string;
  counterpartyId: string;
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
    description: "",
  });
  const [payoutEntry, setPayoutEntry] = useState<CashEntryState>({
    amount: 0,
    currency: DEFAULT_CURRENCY,
    date: new Date(),
    accountId: "",
    categoryId: "",
    counterpartyId: "",
    description: "",
  });
  const [commissionMessage, setCommissionMessage] = useState<MessageState>(null);
  const [payoutMessage, setPayoutMessage] = useState<MessageState>(null);
  const [commissionSubmitting, setCommissionSubmitting] = useState(false);
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);

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
    if (!summary) {
      return;
    }
    const defaultCurrency = summary.totalsByCurrency[0]?.currency ?? DEFAULT_CURRENCY;
    const defaultReceivable = summary.totalsByCurrency[0]?.receivable ?? 0;
    const defaultPayable = summary.totalsByCurrency[0]?.payable ?? 0;
    const rangeLabel = `${summary.range.startDate} → ${summary.range.endDate}`;

    setCommissionEntry((prev) => ({
      ...prev,
      currency: defaultCurrency,
      amount: prev.amount === 0 ? defaultReceivable : prev.amount,
      description: prev.description || `Commission collection for ${rangeLabel}`,
      date: prev.date ?? new Date(),
    }));

    setPayoutEntry((prev) => ({
      ...prev,
      currency: defaultCurrency,
      amount: prev.amount === 0 ? defaultPayable : prev.amount,
      description: prev.description || `Open bar payout for ${rangeLabel}`,
      date: prev.date ?? new Date(),
    }));
  }, [summary]);

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
      !commissionEntry.counterpartyId
    ) {
      setCommissionMessage({ type: "error", text: "Fill in the amount, account, category, and client." });
      return;
    }
    setCommissionSubmitting(true);
    try {
      await dispatch(
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
          meta: summary
            ? {
                source: "venue-numbers-summary",
                period: summary.period,
                rangeStart: summary.range.startDate,
                rangeEnd: summary.range.endDate,
              }
            : null,
        }),
      ).unwrap();
      setCommissionMessage({ type: "success", text: "Commission transaction recorded." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create transaction.";
      setCommissionMessage({ type: "error", text: message });
    } finally {
      setCommissionSubmitting(false);
    }
  };

  const handlePayoutSubmit = async () => {
    setPayoutMessage(null);
    if (
      payoutEntry.amount <= 0 ||
      !payoutEntry.accountId ||
      !payoutEntry.categoryId ||
      !payoutEntry.counterpartyId
    ) {
      setPayoutMessage({ type: "error", text: "Fill in the amount, account, category, and vendor." });
      return;
    }
    setPayoutSubmitting(true);
    try {
      await dispatch(
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
          meta: summary
            ? {
                source: "venue-numbers-summary",
                period: summary.period,
                rangeStart: summary.range.startDate,
                rangeEnd: summary.range.endDate,
              }
            : null,
        }),
      ).unwrap();
      setPayoutMessage({ type: "success", text: "Open bar payout recorded." });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to create transaction.";
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
                          <Group justify="space-between">
                            <Text c="dimmed" size="sm">
                              Commission
                            </Text>
                            <Text>{formatCurrency(row.receivable, row.currency)}</Text>
                          </Group>
                          <Group justify="space-between">
                            <Text c="dimmed" size="sm">
                              Open bar payouts
                            </Text>
                            <Text>{formatCurrency(row.payable, row.currency)}</Text>
                          </Group>
                          <Group justify="space-between">
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
                      <Table.Th>Venue</Table.Th>
                      <Table.Th>Commission</Table.Th>
                      <Table.Th>Open Bar Payout</Table.Th>
                      <Table.Th>Net</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.venues.map((venue) => (
                      <Table.Tr key={`${venue.venueId ?? "unknown"}-${venue.currency}`}>
                        <Table.Td>{venue.venueName}</Table.Td>
                        <Table.Td>{formatCurrency(venue.receivable, venue.currency)}</Table.Td>
                        <Table.Td>{formatCurrency(venue.payable, venue.currency)}</Table.Td>
                        <Table.Td c={venue.net >= 0 ? "green" : "red"}>
                          {formatCurrency(venue.net, venue.currency)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
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
                  <Button onClick={handleCommissionSubmit} loading={commissionSubmitting}>
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
                  <Button onClick={handlePayoutSubmit} loading={payoutSubmitting}>
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
