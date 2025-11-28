import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Anchor,
  ActionIcon,
  Button,
  Card,
  Group,
  Loader,
  Grid,
  Modal,
  NumberInput,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
  Box,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import dayjs from "dayjs";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import axiosInstance from "../../utils/axiosInstance";
import { ServerResponse } from "../../types/general/ServerResponse";
import type { NightReport } from "../../types/nightReports/NightReport";
import type {
  VenuePayoutSummary,
  VenuePayoutVenueBreakdown,
  VenuePayoutVenueDaily,
  VenuePayoutCurrencyTotals,
  VenueLedgerSnapshot,
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
import NightReportPhotoPreviewDialog from "./NightReportPhotoPreviewDialog";
import { resolvePhotoDownloadUrl, type NightReportPhotoPreview } from "../../utils/nightReportPhotoUtils";
import { fetchVenues } from "../../actions/venueActions";
import type { Venue } from "../../types/venues/Venue";
import type { FinanceClient } from "../../types/finance/Client";
import type { FinanceVendor } from "../../types/finance/Vendor";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";

type DailyRow = VenuePayoutVenueDaily & { placeholder?: boolean };

type MessageState = { type: "success" | "error"; text: string } | null;

type EntryModalState = {
  open: boolean;
  kind: "receivable" | "payable" | null;
  venue: VenuePayoutVenueBreakdown | null;
  amount: number;
  currency: string;
  date: Date;
  accountId: string;
  categoryId: string;
  counterpartyId: string;
  description: string;
};

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

const formatCurrencyCompact = (value: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

dayjs.extend(isSameOrBefore);

const createEmptyEntryModalState = (): EntryModalState => ({
  open: false,
  kind: null,
  venue: null,
  amount: 0,
  currency: DEFAULT_CURRENCY,
  date: new Date(),
  accountId: "",
  categoryId: "",
  counterpartyId: "",
  description: "",
});

type RadarMetric = {
  key: keyof Pick<
    VenuePayoutCurrencyTotals,
    "receivableCollected" | "receivableOutstanding" | "payableCollected" | "payableOutstanding"
  >;
  label: string;
};

const RADAR_METRICS: readonly RadarMetric[] = [
  { key: "receivableCollected", label: "Commission collected" },
  { key: "receivableOutstanding", label: "Commission outstanding" },
  { key: "payableCollected", label: "Payout paid" },
  { key: "payableOutstanding", label: "Payout outstanding" },
];

const LEDGER_LINE_CONFIG = [
  { key: "opening" as const, label: "Opening balance" },
  { key: "due" as const, label: "New activity" },
  { key: "paid" as const, label: "Payments" },
  { key: "closing" as const, label: "Closing balance" },
];

const VenueNumbersSummary = () => {
  const dispatch = useAppDispatch();
  useFinanceBootstrap();
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);
  const venuesState = useAppSelector((state) => state.venues[0]);
  const clientItems = clients.data;
  const vendorItems = vendors.data;

  const [period, setPeriod] = useState<string>("this_month");
  const [customRange, setCustomRange] = useState<[Date | null, Date | null]>([null, null]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<VenuePayoutSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entryModal, setEntryModal] = useState<EntryModalState>(() => createEmptyEntryModalState());
  const [entryMessage, setEntryMessage] = useState<MessageState>(null);
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [reportPreviewLoading, setReportPreviewLoading] = useState<number | null>(null);
  const [reportPreviewError, setReportPreviewError] = useState<string | null>(null);
  const [activePhotoPreview, setActivePhotoPreview] = useState<NightReportPhotoPreview | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const rangeIsCanonical = summary?.rangeIsCanonical ?? false;
  const canRecordPayments = rangeIsCanonical;

  const venueRecords = useMemo(
    () => (venuesState?.data?.[0]?.data as Venue[] | undefined) ?? [],
    [venuesState?.data],
  );
  const venuesLoading = Boolean(venuesState?.loading);
  const venuesLoaded = venueRecords.length > 0;

  useEffect(() => {
    if (!venuesLoaded && !venuesLoading) {
      dispatch(fetchVenues());
    }
  }, [dispatch, venuesLoaded, venuesLoading]);

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

  const handleClosePhotoPreview = useCallback(() => {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      setPreviewObjectUrl(null);
    }
    setActivePhotoPreview(null);
  }, [previewObjectUrl]);

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

  useEffect(
    () => () => {
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
      }
    },
    [previewObjectUrl],
  );


  const accountOptions = useMemo(
    () =>
      accounts.data
        .filter(
          (account) =>
            (account.type === "cash" || account.type === "bank") && (account.isActive ?? true),
        )
        .map((account) => ({
          value: String(account.id),
          label: `${account.name} (${account.currency})`,
        })),
    [accounts.data],
  );

  const venueById = useMemo(() => {
    const map = new Map<number, Venue>();
    venueRecords.forEach((venue) => {
      if (typeof venue?.id === "number") {
        map.set(venue.id, venue as Venue);
      }
    });
    return map;
  }, [venueRecords]);

  const financeClientsById = useMemo(() => {
    const map = new Map<number, FinanceClient>();
    clientItems.forEach((client) => {
      if (typeof client.id === "number") {
        map.set(client.id, client);
      }
    });
    return map;
  }, [clientItems]);

  const financeVendorsById = useMemo(() => {
    const map = new Map<number, FinanceVendor>();
    vendorItems.forEach((vendor) => {
      if (typeof vendor.id === "number") {
        map.set(vendor.id, vendor);
      }
    });
    return map;
  }, [vendorItems]);

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
    () => vendorItems.map((vendor) => ({ value: String(vendor.id), label: vendor.name })),
    [vendorItems],
  );

  const clientOptions = useMemo(
    () => clientItems.map((client) => ({ value: String(client.id), label: client.name })),
    [clientItems],
  );

  const resolveVenueCounterpartyDefaults = useCallback(
    (kind: "receivable" | "payable", venueId: number | null | undefined) => {
      let counterpartyId = "";
      let categoryId = "";
      if (!venueId) {
        return { counterpartyId, categoryId };
      }
      const venueRecord = venueById.get(venueId);
      if (!venueRecord) {
        return { counterpartyId, categoryId };
      }
      if (kind === "receivable") {
        const clientId = venueRecord.financeClientId;
        if (clientId) {
          counterpartyId = String(clientId);
          const defaultCategoryId = financeClientsById.get(clientId)?.defaultCategoryId;
          if (defaultCategoryId) {
            categoryId = String(defaultCategoryId);
          }
        }
      } else {
        const vendorId = venueRecord.financeVendorId;
        if (vendorId) {
          counterpartyId = String(vendorId);
          const defaultCategoryId = financeVendorsById.get(vendorId)?.defaultCategoryId;
          if (defaultCategoryId) {
            categoryId = String(defaultCategoryId);
          }
        }
      }
      return { counterpartyId, categoryId };
    },
    [venueById, financeClientsById, financeVendorsById],
  );

  const handleCounterpartyChange = useCallback(
    (value: string | null) => {
      setEntryModal((prev) => {
        const nextId = value ?? "";
        let nextCategoryId = prev.categoryId;
        if (!value) {
          nextCategoryId = "";
        } else if (prev.kind === "receivable") {
          const client = financeClientsById.get(Number(value));
          nextCategoryId = client?.defaultCategoryId ? String(client.defaultCategoryId) : "";
        } else if (prev.kind === "payable") {
          const vendor = financeVendorsById.get(Number(value));
          nextCategoryId = vendor?.defaultCategoryId ? String(vendor.defaultCategoryId) : "";
        }
        return { ...prev, counterpartyId: nextId, categoryId: nextCategoryId };
      });
    },
    [financeClientsById, financeVendorsById],
  );

  const renderLedgerBreakdown = useCallback(
    (label: string, ledger: VenueLedgerSnapshot, currency: string) => (
      <Stack gap={2}>
        <Text fw={600} size="sm">
          {label}
        </Text>
        {LEDGER_LINE_CONFIG.map((line) => (
          <Group justify="space-between" key={`${label}-${line.key}`}>
            <Text c="dimmed" size="sm">
              {line.label}
            </Text>
            <Text>{formatCurrency(ledger[line.key], currency)}</Text>
          </Group>
        ))}
      </Stack>
    ),
    [],
  );

  const resolveDefaultAccountId = useCallback(
    (currencyCode: string): string => {
      if (!accounts.data.length) {
        return "";
      }
      const normalizedCurrency = (currencyCode || DEFAULT_CURRENCY).toUpperCase();
      const currencyCashAccount = accounts.data.find(
        (account) => account.type === "cash" && account.currency?.toUpperCase() === normalizedCurrency,
      );
      if (currencyCashAccount) {
        return String(currencyCashAccount.id);
      }
      const anyCashAccount = accounts.data.find((account) => account.type === "cash");
      if (anyCashAccount) {
        return String(anyCashAccount.id);
      }
      return String(accounts.data[0].id);
    },
    [accounts.data],
  );

  const openEntryModal = useCallback(
    (kind: "receivable" | "payable", venue: VenuePayoutVenueBreakdown) => {
      if (!summary?.rangeIsCanonical) {
        setEntryMessage({
          type: "error",
          text: "Payments can only be recorded when viewing a full calendar month.",
        });
        return;
      }
      const outstanding = kind === "receivable" ? venue.receivableOutstanding : venue.payableOutstanding;
      const defaults = resolveVenueCounterpartyDefaults(kind, venue.venueId ?? null);
      const rangeLabel = summary
        ? `${dayjs(summary.range.startDate).format("MMM D, YYYY")} - ${dayjs(summary.range.endDate).format("MMM D, YYYY")}`
        : "selected period";
      const defaultAccountId = resolveDefaultAccountId(venue.currency);
      setEntryModal({
        open: true,
        kind,
        venue,
        amount: outstanding > 0 ? outstanding : 0,
        currency: venue.currency,
        date: new Date(),
        accountId: defaultAccountId,
        categoryId: defaults.categoryId,
        counterpartyId: defaults.counterpartyId,
        description:
          kind === "receivable"
            ? `Commission collection for ${venue.venueName} (${rangeLabel})`
            : `Open bar payout for ${venue.venueName} (${rangeLabel})`,
      });
      setEntryMessage(null);
    },
    [resolveDefaultAccountId, resolveVenueCounterpartyDefaults, summary],
  );

  const closeEntryModal = useCallback(() => {
    setEntryModal(createEmptyEntryModalState());
    setEntryMessage(null);
  }, []);

  const handleEntryAccountChange = useCallback(
    (value: string | null) => {
      if (!value) {
        setEntryModal((prev) => ({ ...prev, accountId: "" }));
        return;
      }
      const account = accounts.data.find((item) => item.id === Number(value));
      setEntryModal((prev) => ({
        ...prev,
        accountId: value,
        currency: account?.currency ?? prev.currency,
      }));
    },
    [accounts.data],
  );

  const handleEntrySubmit = async () => {
    setEntryMessage(null);
    if (!entryModal.kind || !entryModal.venue || !entryModal.open) {
      setEntryMessage({ type: "error", text: "Select a venue entry before submitting." });
      return;
    }
    if (
      entryModal.amount <= 0 ||
      !entryModal.accountId ||
      !entryModal.categoryId ||
      !entryModal.counterpartyId
    ) {
      setEntryMessage({
        type: "error",
        text: "Fill in the amount, account, category, and counterparty.",
      });
      return;
    }
    if (!summary) {
      setEntryMessage({ type: "error", text: "Load a summary range before recording payments." });
      return;
    }
    if (!summary.rangeIsCanonical) {
      setEntryMessage({
        type: "error",
        text: "Payments can only be recorded when viewing a full calendar month.",
      });
      return;
    }
    const venueId = entryModal.venue.venueId;
    if (!venueId) {
      setEntryMessage({
        type: "error",
        text: "This venue is not linked to the directory and cannot be reconciled.",
      });
      return;
    }
    setEntrySubmitting(true);
    try {
      const financeKind = entryModal.kind === "receivable" ? "income" : "expense";
      const counterpartyType = entryModal.kind === "receivable" ? "client" : "vendor";
      const transaction = await dispatch(
        createFinanceTransaction({
          kind: financeKind,
          date: dayjs(entryModal.date).format("YYYY-MM-DD"),
          accountId: Number(entryModal.accountId),
          currency: entryModal.currency,
          amountMinor: toMinorUnits(entryModal.amount),
          categoryId: Number(entryModal.categoryId),
          counterpartyType,
          counterpartyId: Number(entryModal.counterpartyId),
          status: "paid",
          description: entryModal.description || null,
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
          venueId,
          direction: entryModal.kind,
          currency: entryModal.currency,
          amount: entryModal.amount,
          rangeStart: summary.range.startDate,
          rangeEnd: summary.range.endDate,
          financeTransactionId: transaction.id,
          note: entryModal.description ?? null,
        },
        { withCredentials: true },
      );

      closeEntryModal();
      await fetchSummary();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to record transaction.";
      setEntryMessage({ type: "error", text: message });
    } finally {
      setEntrySubmitting(false);
    }
  };

  const modalTitle =
    entryModal.kind === "receivable"
      ? "Record commission collection"
      : entryModal.kind === "payable"
        ? "Record open bar payout"
        : "Record venue payment";

  const modalCategoryOptions =
    entryModal.kind === "receivable"
      ? incomeCategoryOptions
      : entryModal.kind === "payable"
        ? expenseCategoryOptions
        : [];

  const modalCounterpartyOptions =
    entryModal.kind === "receivable"
      ? clientOptions
      : entryModal.kind === "payable"
        ? vendorOptions
        : [];

  const modalCounterpartyLabel =
    entryModal.kind === "receivable" ? "Client" : entryModal.kind === "payable" ? "Vendor" : "Counterparty";

  const modalOutstanding =
    entryModal.kind === "receivable"
      ? entryModal.venue?.receivableOutstanding ?? 0
      : entryModal.kind === "payable"
        ? entryModal.venue?.payableOutstanding ?? 0
        : 0;
  const radarCurrencies = useMemo(
    () => summary?.totalsByCurrency.map((row) => row.currency) ?? [],
    [summary],
  );
  const radarData = useMemo(() => {
    if (!summary) {
      return [];
    }
    return RADAR_METRICS.map((metric) => {
      const entry: Record<string, number | string> = { metric: metric.label };
      summary.totalsByCurrency.forEach((row) => {
        entry[row.currency] = row[metric.key] ?? 0;
      });
      return entry;
    });
  }, [summary]);
  const chartSampleCurrency = radarCurrencies[0] ?? DEFAULT_CURRENCY;
  const radarMaxValue = useMemo(() => {
    let max = 0;
    radarData.forEach((entry) => {
      Object.entries(entry).forEach(([key, value]) => {
        if (key === "metric") {
          return;
        }
        const numeric = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(numeric)) {
          max = Math.max(max, numeric);
        }
      });
    });
    return max || 1;
  }, [radarData]);
  const currencyColors = ["#4dabf7", "#69db7c", "#ffd43b", "#ff6b6b", "#b197fc", "#ffa94d"];

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
            normalCount: 0,
            cocktailsCount: 0,
            brunchCount: 0,
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

  const handleReportPhotoClick = useCallback(
    async (day: VenuePayoutVenueDaily) => {
      if (!day.reportId) {
        return;
      }
      setReportPreviewError(null);
      setReportPreviewLoading(day.reportId);
      try {
        const response = await axiosInstance.get<ServerResponse<NightReport>>(
          `/nightReports/${day.reportId}`,
          { withCredentials: true },
        );
        const payload = response.data[0]?.data;
        let report: NightReport | undefined;
        if (Array.isArray(payload)) {
          report = payload[0] as NightReport | undefined;
        } else if (payload) {
          report = payload as unknown as NightReport;
        }
        const photo = report?.photos?.[0];
        if (!photo) {
          throw new Error("This report does not have a photo attached.");
        }
        const downloadHref = resolvePhotoDownloadUrl(photo.downloadUrl);
        const downloadResponse = await axiosInstance.get(downloadHref, {
          responseType: "blob",
          withCredentials: true,
          baseURL: undefined,
        });
        const objectUrl = URL.createObjectURL(downloadResponse.data);
        if (previewObjectUrl) {
          URL.revokeObjectURL(previewObjectUrl);
        }
        setPreviewObjectUrl(objectUrl);
        setActivePhotoPreview({
          src: objectUrl,
          name: photo.originalName,
          capturedAt: photo.capturedAt,
          downloadHref,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to open this report photo.";
        setReportPreviewError(message);
      } finally {
        setReportPreviewLoading(null);
      }
    },
    [previewObjectUrl],
  );

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
                    {dayjs(summary.range.startDate).format("MMM D, YYYY")} -{" "}
                    {dayjs(summary.range.endDate).format("MMM D, YYYY")}
                  </Text>
                </div>
              </Group>
              {!rangeIsCanonical && (
                <Alert color="yellow" variant="light">
                  This range is view-only. Collections and payouts can only be recorded for full calendar months.
                </Alert>
              )}
              {summary.totalsByCurrency.length === 0 ? (
                <Text>No payouts or commissions recorded for this range.</Text>
              ) : (
                <Grid gutter="xl" align="stretch">
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card shadow="sm" padding="md" withBorder h="100%">
                      <Stack gap="xs" h="100%">
                        <Box style={{ maxHeight: 260, overflowY: "auto" }}>
                          <Stack gap="sm">
                            {summary.totalsByCurrency.map((row) => (
                              <Card shadow="sm" padding="md" withBorder key={row.currency}>
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
                                  <Stack gap="sm" mt="sm">
                                    {renderLedgerBreakdown("Commission ledger", row.receivableLedger, row.currency)}
                                    {renderLedgerBreakdown("Open bar ledger", row.payableLedger, row.currency)}
                                  </Stack>
                                </Stack>
                              </Card>
                            ))}
                          </Stack>
                        </Box>
                      </Stack>
                    </Card>
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card shadow="sm" padding="md" withBorder h="100%">
                      <Stack gap="xs" h="100%">
                        <Group justify="space-between">
                          <div>
                            <Text fw={600}>Collections vs payouts</Text>
                            <Text size="sm" c="dimmed">
                              Outstanding vs collected amounts per currency
                            </Text>
                          </div>
                        </Group>
                        {radarData.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            Not enough data to draw the chart.
                          </Text>
                        ) : (
                          <ResponsiveContainer width="100%" height={260}>
                            <RadarChart data={radarData}>
                              <PolarGrid strokeDasharray="3 3" />
                              <PolarAngleAxis dataKey="metric" />
                              <PolarRadiusAxis
                                tickFormatter={(value) => formatCurrencyCompact(value, chartSampleCurrency)}
                                domain={[0, radarMaxValue]}
                              />
                              <RechartsTooltip
                                formatter={(value: number, name) => {
                                  const currency =
                                    name && radarCurrencies.includes(name as string)
                                      ? (name as string)
                                      : chartSampleCurrency;
                                  return [formatCurrency(value, currency), name];
                                }}
                              />
                              <Legend />
                              {radarCurrencies.map((currency, idx) => (
                                <Radar
                                  key={currency}
                                  name={currency}
                                  dataKey={currency}
                                  stroke={currencyColors[idx % currencyColors.length]}
                                  fill={currencyColors[idx % currencyColors.length]}
                                  fillOpacity={0.25}
                                />
                              ))}
                            </RadarChart>
                          </ResponsiveContainer>
                        )}
                      </Stack>
                    </Card>
                  </Grid.Col>
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
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.venues.map((venue) => {
                      const isExpanded = expandedRows.has(venue.rowKey);
                      const dailyRows = buildDailyRows(venue);
                      const receivablePeople = venue.totalPeopleReceivable ?? 0;
                      const payablePeople = venue.totalPeoplePayable ?? 0;
                      const showSplitPeople = receivablePeople > 0 && payablePeople > 0;
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
                            <Table.Td>
                              {showSplitPeople ? (
                                <Stack gap={0}>
                                  <Text size="sm">Commission: {receivablePeople}</Text>
                                  <Text size="sm">Open bar: {payablePeople}</Text>
                                </Stack>
                              ) : (
                                receivablePeople || payablePeople || 0
                              )}
                            </Table.Td>
                            <Table.Td>{formatCurrency(venue.receivable, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.receivableCollected, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.receivableOutstanding, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.payable, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.payableCollected, venue.currency)}</Table.Td>
                            <Table.Td>{formatCurrency(venue.payableOutstanding, venue.currency)}</Table.Td>
                            <Table.Td c={venue.net >= 0 ? "green" : "red"}>
                              {formatCurrency(venue.net, venue.currency)}
                            </Table.Td>
                            <Table.Td>
                              <Stack gap={4}>
                                <Button
                                  size="xs"
                                  variant="light"
                                  disabled={
                                    !canRecordPayments ||
                                    venue.venueId === null ||
                                    (venue.receivableOutstanding ?? 0) <= 0
                                  }
                                  onClick={() => {
                                    if (canRecordPayments && venue.venueId !== null) {
                                      openEntryModal("receivable", venue);
                                    }
                                  }}
                                >
                                  Collect
                                </Button>
                                <Button
                                  size="xs"
                                  variant="light"
                                  color="grape"
                                  disabled={
                                    !canRecordPayments ||
                                    venue.venueId === null ||
                                    (venue.payableOutstanding ?? 0) <= 0
                                  }
                                  onClick={() => {
                                    if (canRecordPayments && venue.venueId !== null) {
                                      openEntryModal("payable", venue);
                                    }
                                  }}
                                >
                                  Pay
                                </Button>
                                <Stack gap={0} mt="xs">
                                  <Text size="xs" c="dimmed">
                                    Commission: {formatCurrency(venue.receivableLedger.opening, venue.currency)} →{" "}
                                    {formatCurrency(venue.receivableLedger.closing, venue.currency)}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    Open bar: {formatCurrency(venue.payableLedger.opening, venue.currency)} →{" "}
                                    {formatCurrency(venue.payableLedger.closing, venue.currency)}
                                  </Text>
                                </Stack>
                              </Stack>
                            </Table.Td>
                          </Table.Tr>
                          {isExpanded && (
                            <Table.Tr>
                              <Table.Td colSpan={11}>
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
                                          <Table.Th>Normal</Table.Th>
                                          <Table.Th>Cocktail</Table.Th>
                                          <Table.Th>Brunch</Table.Th>
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
                                                {!placeholder && day.direction === "payable"
                                                  ? day.normalCount
                                                  : "—"}
                                              </Table.Td>
                                              <Table.Td>
                                                {!placeholder && day.direction === "payable"
                                                  ? day.cocktailsCount
                                                  : "—"}
                                              </Table.Td>
                                              <Table.Td>
                                                {!placeholder && day.direction === "payable"
                                                  ? day.brunchCount
                                                  : "—"}
                                              </Table.Td>
                                              <Table.Td>
                                                {placeholder ? (
                                                  "No report"
                                                ) : day.reportId ? (
                                                  <Group gap="xs" wrap="nowrap">
                                                    <Anchor
                                                      component="button"
                                                      type="button"
                                                      onClick={() => handleReportPhotoClick(day)}
                                                      size="sm"
                                                    >
                                                      Report #{day.reportId}
                                                    </Anchor>
                                                    {reportPreviewLoading === day.reportId && <Loader size="xs" />}
                                                  </Group>
                                                ) : (
                                                  "N/A"
                                                )}
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
              {reportPreviewError && <Alert color="red">{reportPreviewError}</Alert>}
            </Stack>
          </Card>

        </Stack>
      )}
      <Modal opened={entryModal.open} onClose={closeEntryModal} title={modalTitle} centered>
        <Stack gap="sm">
          {entryModal.venue && (
            <Stack gap={0}>
              <Text fw={600}>{entryModal.venue.venueName}</Text>
              <Text size="sm" c="dimmed">
                Outstanding: {formatCurrency(modalOutstanding, entryModal.currency)} (Currency: {entryModal.currency})
              </Text>
            </Stack>
          )}
          <NumberInput
            label="Amount"
            value={entryModal.amount}
            onChange={(value) =>
              setEntryModal((prev) => ({
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
            value={entryModal.accountId}
            onChange={handleEntryAccountChange}
            placeholder="Select account"
            disabled={!entryModal.kind}
          />
          <Select
            label="Category"
            data={modalCategoryOptions}
            value={entryModal.categoryId}
            onChange={(value) =>
              setEntryModal((prev) => ({ ...prev, categoryId: value ?? "" }))
            }
            placeholder="Select category"
            disabled={!entryModal.kind}
          />
          <Select
            label={modalCounterpartyLabel}
            data={modalCounterpartyOptions}
            value={entryModal.counterpartyId}
            onChange={handleCounterpartyChange}
            placeholder={`Select ${modalCounterpartyLabel.toLowerCase()}`}
            disabled={!entryModal.kind}
          />
          <DatePickerInput
            label="Date"
            value={entryModal.date}
            onChange={(value) => setEntryModal((prev) => ({ ...prev, date: value ?? new Date() }))}
          />
          <Textarea
            label="Description"
            value={entryModal.description}
            onChange={(event) =>
              setEntryModal((prev) => ({ ...prev, description: event.currentTarget.value }))
            }
            minRows={2}
          />
          {entryMessage && (
            <Alert color={entryMessage.type === "success" ? "green" : "red"}>{entryMessage.text}</Alert>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={closeEntryModal}>
              Cancel
            </Button>
            <Button
              onClick={handleEntrySubmit}
              loading={entrySubmitting}
              disabled={!entryModal.kind}
            >
              {entryModal.kind === "payable" ? "Record payout" : "Record collection"}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <NightReportPhotoPreviewDialog
        preview={activePhotoPreview}
        onClose={handleClosePhotoPreview}
      />
    </Stack>
  );
};

export default VenueNumbersSummary;







