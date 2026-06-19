import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
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
} from "../../types/nightReports/VenuePayoutSummary";
import { useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { createFinanceTransaction } from "../../actions/financeActions";
import NightReportPhotoPreviewDialog from "./NightReportPhotoPreviewDialog";
import { resolvePhotoDownloadUrl, type NightReportPhotoPreview } from "../../utils/nightReportPhotoUtils";
import { setFinanceBasics } from "../../reducers/financeReducer";
import { setVenuesData } from "../../reducers/venueReducer";
import type { Venue } from "../../types/venues/Venue";
import type { FinanceAccount } from "../../types/finance/Account";
import type { FinanceCategory } from "../../types/finance/Category";
import type { FinanceClient } from "../../types/finance/Client";
import type { FinanceVendor } from "../../types/finance/Vendor";
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
  { label: "This Week", value: "this_week" },
  { label: "Last Week", value: "last_week" },
  { label: "This Year", value: "this_year" },
  { label: "All Time", value: "all_time" },
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

const formatDateRangeLabel = (startDate: string, endDate: string) =>
  `${dayjs(startDate).format("MMMM D, YYYY")} — ${dayjs(endDate).format("MMMM D, YYYY")}`;

dayjs.extend(isSameOrBefore);

const renderHeaderLabel = (label: string) => {
  const words = label.split(" ").filter(Boolean);
  if (words.length <= 1) return label;

  return (
    <Box style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1.05 }}>
      {words.map((word) => (
        <span key={word}>{word}</span>
      ))}
    </Box>
  );
};

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

const VenueNumbersSummary = ({ active = true }: { active?: boolean }) => {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);
  const venuesState = useAppSelector((state) => state.venues[0]);
  const clientItems = clients.data;
  const vendorItems = vendors.data;

  const [period, setPeriod] = useState<string>("this_month");
  const [customRange, setCustomRange] = useState<[Date | null, Date | null]>([null, null]);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<VenuePayoutSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entryModal, setEntryModal] = useState<EntryModalState>(() => createEmptyEntryModalState());
  const [entryMessage, setEntryMessage] = useState<MessageState>(null);
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [undoCollectionLogId, setUndoCollectionLogId] = useState<number | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [reportPreviewLoading, setReportPreviewLoading] = useState<number | null>(null);
  const [reportPreviewError, setReportPreviewError] = useState<string | null>(null);
  const [activePhotoPreview, setActivePhotoPreview] = useState<NightReportPhotoPreview | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const rangeIsCanonical = summary?.rangeIsCanonical ?? false;
  const canRecordPayments = rangeIsCanonical;
  const summaryLoading = loading || bootstrapLoading;

  const venueRecords = useMemo(
    () => (venuesState?.data?.[0]?.data as Venue[] | undefined) ?? [],
    [venuesState?.data],
  );
  const bootstrapRequestedRef = useRef(false);
  const lastSummaryKeyRef = useRef<string | null>(null);

  const parseSummaryPeriod = useCallback((value: string | null): string => {
    if (
      value === "last_month" ||
      value === "custom" ||
      value === "this_month" ||
      value === "this_week" ||
      value === "last_week" ||
      value === "this_year" ||
      value === "all_time"
    ) {
      return value;
    }
    return "this_month";
  }, []);

  const summaryPeriodParam = useMemo(
    () => parseSummaryPeriod(searchParams.get("summaryPeriod")),
    [parseSummaryPeriod, searchParams],
  );
  const summaryStartParam = useMemo(() => searchParams.get("summaryStart"), [searchParams]);
  const summaryEndParam = useMemo(() => searchParams.get("summaryEnd"), [searchParams]);
  const summaryStartDate = useMemo(() => {
    if (!summaryStartParam) {
      return null;
    }
    const parsed = dayjs(summaryStartParam);
    return parsed.isValid() ? parsed.toDate() : null;
  }, [summaryStartParam]);
  const summaryEndDate = useMemo(() => {
    if (!summaryEndParam) {
      return null;
    }
    const parsed = dayjs(summaryEndParam);
    return parsed.isValid() ? parsed.toDate() : null;
  }, [summaryEndParam]);

  const resolveRangeForPeriod = useCallback(
    (periodValue: string, range: [Date | null, Date | null]) => {
      if (periodValue === "custom") {
        const start = range[0] ? dayjs(range[0]).startOf("day") : null;
        const end = range[1] ? dayjs(range[1]).endOf("day") : null;
        return { start, end };
      }
      if (periodValue === "last_month") {
        const start = dayjs().subtract(1, "month").startOf("month");
        return { start, end: start.endOf("month") };
      }
      if (periodValue === "this_week") {
        const start = dayjs().startOf("week");
        return { start, end: start.endOf("week") };
      }
      if (periodValue === "last_week") {
        const start = dayjs().subtract(1, "week").startOf("week");
        return { start, end: start.endOf("week") };
      }
      if (periodValue === "this_year") {
        const start = dayjs().startOf("year");
        return { start, end: start.endOf("year") };
      }
      if (periodValue === "all_time") {
        return { start: null, end: null };
      }
      const start = dayjs().startOf("month");
      return { start, end: start.endOf("month") };
    },
    [],
  );

  const updateSummaryParams = useCallback(
    (periodValue: string, range: [Date | null, Date | null]) => {
      const { start, end } = resolveRangeForPeriod(periodValue, range);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", "summary");
          next.set("summaryPeriod", periodValue);
          if (periodValue === "custom" && start && end) {
            next.set("summaryStart", start.format("YYYY-MM-DD"));
            next.set("summaryEnd", end.format("YYYY-MM-DD"));
          } else {
            next.delete("summaryStart");
            next.delete("summaryEnd");
          }
          return next;
        },
        { replace: true },
      );
    },
    [resolveRangeForPeriod, setSearchParams],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    if (period !== summaryPeriodParam) {
      setPeriod(summaryPeriodParam);
    }
    if (summaryPeriodParam === "custom" && (summaryStartDate || summaryEndDate)) {
      setCustomRange([summaryStartDate, summaryEndDate]);
    }
  }, [active, period, summaryEndDate, summaryPeriodParam, summaryStartDate]);

  const handlePeriodChange = useCallback(
    (value: string) => {
      setPeriod(value);
      if (value === "custom") {
        updateSummaryParams(value, customRange);
        return;
      }
      const nextRange: [Date | null, Date | null] =
        value === "last_month"
          ? [
              dayjs().subtract(1, "month").startOf("month").toDate(),
              dayjs().subtract(1, "month").endOf("month").toDate(),
            ]
          : [dayjs().startOf("month").toDate(), dayjs().endOf("month").toDate()];
      setCustomRange(nextRange);
      updateSummaryParams(value, nextRange);
    },
    [customRange, updateSummaryParams],
  );

  const handleCustomRangeChange = useCallback(
    (range: [Date | null, Date | null]) => {
      setCustomRange(range);
      updateSummaryParams(period, range);
    },
    [period, updateSummaryParams],
  );

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
  const summaryKey = useMemo(() => {
    const { start, end } = resolveRangeForPeriod(period, customRange);
    const startKey = start ? start.format("YYYY-MM-DD") : "";
    const endKey = end ? end.format("YYYY-MM-DD") : "";
    return `${period}|${startKey}|${endKey}`;
  }, [customRange, period, resolveRangeForPeriod]);

  const fetchSummary = useCallback(async () => {
    if (!canFetch) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { start, end } = resolveRangeForPeriod(period, customRange);
      const params: Record<string, string> = { period };
      if (start && end) {
        params.startDate = start.format("YYYY-MM-DD");
        params.endDate = end.format("YYYY-MM-DD");
      }
      const response = await axiosInstance.get<ServerResponse<VenuePayoutSummary>>(
        "/venueNumbers/summary",
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
  }, [canFetch, customRange, period, resolveRangeForPeriod]);

  const loadSummaryBootstrap = useCallback(async () => {
    if (!canFetch) {
      return;
    }
    setBootstrapLoading(true);
    setBootstrapError(null);
    try {
      const { start, end } = resolveRangeForPeriod(period, customRange);
      const params: Record<string, string> = { tab: "summary", period };
      if (start && end) {
        params.startDate = start.format("YYYY-MM-DD");
        params.endDate = end.format("YYYY-MM-DD");
      }
      const response = await axiosInstance.get<{
        venues: ServerResponse<Partial<Venue>>;
        finance: {
          accounts: FinanceAccount[];
          categories: FinanceCategory[];
          vendors: FinanceVendor[];
          clients: FinanceClient[];
        };
        summary: ServerResponse<VenuePayoutSummary>;
      }>("/venueNumbers/bootstrap", {
        params,
        withCredentials: true,
      });
      const payload = response.data;
      if (payload?.venues) {
        dispatch(setVenuesData(payload.venues));
      }
      if (payload?.finance) {
        dispatch(
          setFinanceBasics({
            accounts: payload.finance.accounts ?? [],
            categories: payload.finance.categories ?? [],
            vendors: payload.finance.vendors ?? [],
            clients: payload.finance.clients ?? [],
          }),
        );
      }
      const summaryPayload = payload?.summary?.[0]?.data;
      if (Array.isArray(summaryPayload)) {
        setSummary((summaryPayload[0] as VenuePayoutSummary) ?? null);
      } else {
        setSummary((summaryPayload as unknown as VenuePayoutSummary) ?? null);
      }
      lastSummaryKeyRef.current = summaryKey;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load summary";
      setBootstrapError(message);
      setSummary(null);
    } finally {
      setBootstrapLoading(false);
    }
  }, [canFetch, customRange, dispatch, period, resolveRangeForPeriod, summaryKey]);

  useEffect(() => {
    if (!active || !canFetch) {
      return;
    }
    if (!bootstrapRequestedRef.current) {
      bootstrapRequestedRef.current = true;
      lastSummaryKeyRef.current = summaryKey;
      updateSummaryParams(period, customRange);
      loadSummaryBootstrap();
      return;
    }
    if (bootstrapLoading) {
      return;
    }
    if (lastSummaryKeyRef.current === summaryKey) {
      return;
    }
    lastSummaryKeyRef.current = summaryKey;
    updateSummaryParams(period, customRange);
    fetchSummary();
  }, [
    active,
    bootstrapLoading,
    canFetch,
    customRange,
    fetchSummary,
    loadSummaryBootstrap,
    period,
    summaryKey,
    updateSummaryParams,
  ]);

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
          if (client?.defaultCategoryId) {
            nextCategoryId = String(client.defaultCategoryId);
          }
        } else if (prev.kind === "payable") {
          const vendor = financeVendorsById.get(Number(value));
          if (vendor?.defaultCategoryId) {
            nextCategoryId = String(vendor.defaultCategoryId);
          }
        }
        return { ...prev, counterpartyId: nextId, categoryId: nextCategoryId };
      });
    },
    [financeClientsById, financeVendorsById],
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

  const handleUndoCollection = useCallback(
    async (collectionLogId: number | null) => {
      if (!collectionLogId) {
        return;
      }
      const confirmed = window.confirm(
        "This will delete the recorded payment transaction and the venue collection entry. Continue?",
      );
      if (!confirmed) {
        return;
      }
      setUndoCollectionLogId(collectionLogId);
      try {
        await axiosInstance.delete(`/nightReports/venue-collections/${collectionLogId}`, {
          withCredentials: true,
        });
        setEntryMessage({ type: "success", text: "Payment undone." });
        await fetchSummary();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to undo payment.";
        setEntryMessage({ type: "error", text: message });
      } finally {
        setUndoCollectionLogId((current) => (current === collectionLogId ? null : current));
      }
    },
    [fetchSummary],
  );

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
        const response = await axiosInstance.get<NightReport[]>(`/nightReports/${day.reportId}`, {
          withCredentials: true,
        });
        const report = response.data?.[0];
        const photo = report?.photos?.[0];
        if (!photo) {
          setReportPreviewError("This report does not have a photo attached.");
          return;
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
    <Stack gap="xs">
      <Card withBorder padding="md">
        <Stack gap="md">
          <Stack gap={4} align="center" style={{ maxWidth: 320, marginInline: "auto" }}>
            <Select
              data={PERIOD_OPTIONS}
              value={period}
              onChange={(value) => handlePeriodChange(value ?? "this_month")}
              searchable={false}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
              size="sm"
              styles={{
                input: { textAlign: "center", fontWeight: 600 },
                option: { textAlign: "center", justifyContent: "center" },
              }}
            />
            <Text size="sm" c="dimmed" ta="center" fw={500}>
              {summary
                ? formatDateRangeLabel(summary.range.startDate, summary.range.endDate)
                : period === "custom" && customRange[0] && customRange[1]
                  ? formatDateRangeLabel(customRange[0].toISOString(), customRange[1].toISOString())
                  : period === "all_time"
                    ? "All time"
                    : "Current period"}
            </Text>
          </Stack>
          {period === "custom" && (
            <DatePickerInput
              type="range"
              label="Custom date range"
              value={customRange}
              onChange={handleCustomRangeChange}
              allowSingleDateInRange
            />
          )}
          {bootstrapError && <Alert color="red">{bootstrapError}</Alert>}
          {error && <Alert color="red">{error}</Alert>}
          {!canFetch && period === "custom" && (
            <Alert color="yellow">Select both start and end dates to load the summary.</Alert>
          )}
        </Stack>
      </Card>

      {summaryLoading && (
        <Card withBorder padding="xl">
          <Group justify="center">
            <Loader />
            <Text>Loading summary...</Text>
          </Group>
        </Card>
      )}

      {!summaryLoading && summary && (
        <Stack gap="xs">
          <Card withBorder padding="lg">
            <Stack gap="sm">
              {!rangeIsCanonical && (
                <Alert color="yellow" variant="light">
                  This range is view-only. Collections and payouts can only be recorded for full calendar months.
                </Alert>
              )}
              {summary.totalsByCurrency.length === 0 ? (
                <Text>No payouts or commissions recorded for this range.</Text>
              ) : (
                <Grid gutter="xl" align="stretch">
                  <Grid.Col span={12}>
                    <Stack gap="md">
                      {summary.totalsByCurrency.map((row) => (
                        <Card shadow="sm" padding="md" withBorder key={row.currency}>
                          <Stack gap="md">
                            <Stack gap={2} align="center">
                              <Text fw={700} size="lg" ta="center">
                                Net Earnings:{" "}
                                <Text span c={row.net >= 0 ? "green" : "red"} fw={700}>
                                  {formatCurrency(row.net, row.currency)}
                                </Text>
                              </Text>
                            </Stack>

                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                              <Card withBorder padding="sm" radius="md">
                                <Stack gap={6}>
                                  <Text fw={600} size="sm">
                                    Commission
                                  </Text>
                                  <Group justify="space-between">
                                    <Text c="dimmed" size="sm">
                                      Owed
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
                              </Card>

                              <Card withBorder padding="sm" radius="md">
                                <Stack gap={6}>
                                  <Text fw={600} size="sm">
                                    Open bar
                                  </Text>
                                  <Group justify="space-between">
                                    <Text c="dimmed" size="sm">
                                      Owed
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
                              </Card>
                            </SimpleGrid>
                          </Stack>
                        </Card>
                      ))}
                    </Stack>
                  </Grid.Col>
                </Grid>
              )}
            </Stack>
          </Card>
          <Card withBorder padding={0}>
            <Stack gap={0}>
              {summary.venues.length === 0 ? (
                <Text>No venue data for this range.</Text>
              ) : (
                <Box
                  style={{
                    width: "100%",
                    maxHeight: "calc(100vh - 280px)",
                    overflow: "auto",
                    scrollbarWidth: "none",
                    msOverflowStyle: "none",
                  }}
                >
                  <style>{`
                    .venue-numbers-summary-scroll::-webkit-scrollbar {
                      display: none;
                    }
                    .venue-numbers-summary-scroll {
                      scrollbar-width: none;
                      -ms-overflow-style: none;
                    }
                  `}</style>
                <Box style={{ minWidth: 900 }} className="venue-numbers-summary-scroll">
                  <style>{`
                    .venue-numbers-sticky-cell {
                      position: sticky;
                      background: var(--mantine-color-body) !important;
                      background-color: var(--mantine-color-body) !important;
                      background-clip: padding-box;
                      isolation: isolate;
                    }
                    .venue-numbers-sticky-cell::after {
                      content: "";
                      position: absolute;
                      top: 0;
                      right: -1px;
                      width: 18px;
                      height: 100%;
                      background: var(--mantine-color-body);
                      pointer-events: none;
                    }
                  `}</style>
                  <Table
                    w="100%"
                    highlightOnHover
                      withColumnBorders
                      miw={1240}
                      styles={{
                        table: { borderTop: "none", tableLayout: "auto" },
                        thead: { borderTop: "none" },
                        th: {
                          borderTop: "none",
                          position: "sticky",
                          top: 0,
                          zIndex: 8,
                          background: "var(--mantine-color-body)",
                          textAlign: "center",
                          verticalAlign: "middle",
                          whiteSpace: "normal",
                          overflowWrap: "break-word",
                          wordBreak: "normal",
                          lineHeight: 1.15,
                        },
                        td: {
                          textAlign: "center",
                          verticalAlign: "middle",
                        },
                      }}
                    >
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th
                            className="venue-numbers-sticky-cell"
                            style={{
                              position: "sticky",
                              top: 0,
                              left: 0,
                              zIndex: 20,
                              background: "var(--mantine-color-body)",
                              backgroundColor: "var(--mantine-color-body)",
                              width: 48,
                              minWidth: 48,
                              maxWidth: 48,
                              paddingInline: 0,
                              overflow: "hidden",
                              textAlign: "center",
                              verticalAlign: "middle",
                            }}
                          />
                          <Table.Th
                            className="venue-numbers-sticky-cell"
                            style={{
                              position: "sticky",
                              top: 0,
                              left: 48,
                              zIndex: 19,
                              background: "var(--mantine-color-body)",
                              backgroundColor: "var(--mantine-color-body)",
                              width: 120,
                              minWidth: 120,
                              maxWidth: 120,
                              paddingInline: 0,
                              overflow: "hidden",
                              whiteSpace: "normal",
                              overflowWrap: "break-word",
                              wordBreak: "normal",
                              lineHeight: 1.15,
                              borderRight: "1px solid var(--mantine-color-gray-3)",
                              textAlign: "center",
                              verticalAlign: "middle",
                            }}
                          >
                            {renderHeaderLabel("Venue")}
                          </Table.Th>
                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle", minWidth: 110, width: 110, maxWidth: 110, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>
                              {renderHeaderLabel("Total People")}
                            </Table.Th>
                          <Table.Th style={{ minWidth: 150, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Commission Owed")}</Table.Th>
                          <Table.Th style={{ minWidth: 160, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Commission Collected")}</Table.Th>
                          <Table.Th style={{ minWidth: 170, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Commission Outstanding")}</Table.Th>
                          <Table.Th style={{ minWidth: 130, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Payout Owed")}</Table.Th>
                          <Table.Th style={{ minWidth: 140, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Payout Paid")}</Table.Th>
                          <Table.Th style={{ minWidth: 160, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Payout Outstanding")}</Table.Th>
                          <Table.Th style={{ minWidth: 110, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Net")}</Table.Th>
                          <Table.Th style={{ minWidth: 120, whiteSpace: "normal", overflowWrap: "break-word", wordBreak: "normal", lineHeight: 1.15 }}>{renderHeaderLabel("Actions")}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {summary.venues.map((venue) => {
                      const isExpanded = expandedRows.has(venue.rowKey);
                      const dailyRows = buildDailyRows(venue);
                      const receivablePeople = venue.totalPeopleReceivable ?? 0;
                      const payablePeople = venue.totalPeoplePayable ?? 0;
                      const showSplitPeople = receivablePeople > 0 && payablePeople > 0;
                      const receivableOutstanding = venue.receivableOutstanding ?? 0;
                      const receivableCollected = venue.receivableCollected ?? 0;
                      const payableOutstanding = venue.payableOutstanding ?? 0;
                      const payableCollected = venue.payableCollected ?? 0;
                      const showCollectButton =
                        receivableOutstanding > 0 || receivableCollected > 0;
                      const collectDisabled =
                        !canRecordPayments || venue.venueId === null || receivableOutstanding <= 0;
                      const showPayButton =
                        venue.allowsOpenBar === true && (payableOutstanding > 0 || payableCollected > 0);
                      const payDisabled =
                        !canRecordPayments || venue.venueId === null || payableOutstanding <= 0;
                      const undoCollectDisabled =
                        !canRecordPayments ||
                        venue.venueId === null ||
                        !venue.latestReceivableCollectionLogId ||
                        undoCollectionLogId === venue.latestReceivableCollectionLogId;
                      const undoPayDisabled =
                        !canRecordPayments ||
                        venue.venueId === null ||
                        !venue.latestPayableCollectionLogId ||
                        undoCollectionLogId === venue.latestPayableCollectionLogId;
                      return (
                        <Fragment key={venue.rowKey}>
                          <Table.Tr>
                          <Table.Td
                              className="venue-numbers-sticky-cell"
                              w={44}
                              style={{
                                position: "sticky",
                                left: 0,
                                zIndex: 10,
                                background: "var(--mantine-color-body)",
                                backgroundColor: "var(--mantine-color-body)",
                                minWidth: 48,
                                maxWidth: 48,
                                paddingInline: 0,
                                overflow: "hidden",
                              }}
                            >
                              <ActionIcon
                                variant="subtle"
                                onClick={() => toggleRow(venue.rowKey)}
                                aria-label={isExpanded ? "Collapse venue details" : "Expand venue details"}
                              >
                                {isExpanded ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
                              </ActionIcon>
                            </Table.Td>
                          <Table.Td
                              className="venue-numbers-sticky-cell"
                              style={{
                                position: "sticky",
                                left: 48,
                                zIndex: 9,
                                background: "var(--mantine-color-body)",
                                backgroundColor: "var(--mantine-color-body)",
                                width: 120,
                                minWidth: 120,
                                maxWidth: 120,
                                paddingInline: 8,
                                overflow: "hidden",
                                whiteSpace: "normal",
                                overflowWrap: "break-word",
                                wordBreak: "normal",
                                borderRight: "1px solid var(--mantine-color-gray-3)",
                                textAlign: "center",
                                verticalAlign: "middle",
                              }}
                            >
                              {(() => {
                                const parts = venue.venueName.trim().split(/\s+/).filter(Boolean);
                                const lines =
                                  parts.length <= 1
                                    ? [venue.venueName]
                                    : parts.length === 2
                                      ? parts
                                      : [
                                          parts.slice(0, Math.max(1, Math.floor(parts.length / 2))).join(" "),
                                          parts.slice(Math.max(1, Math.floor(parts.length / 2))).join(" "),
                                        ].filter(Boolean);

                                return (
                                  <Box
                                    style={{
                                      width: "100%",
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      gap: 0,
                                      whiteSpace: "normal",
                                      overflowWrap: "break-word",
                                      wordBreak: "normal",
                                      lineHeight: 1.15,
                                    }}
                                  >
                                    {lines.map((line) => (
                                      <Text key={line} fw={600} style={{ lineHeight: 1.15, whiteSpace: "normal" }}>
                                        {line}
                                      </Text>
                                    ))}
                                  </Box>
                                );
                              })()}
                            </Table.Td>
                            <Table.Td
                              style={{
                                textAlign: "center",
                                verticalAlign: "middle",
                                minWidth: 110,
                                width: 110,
                                maxWidth: 110,
                              }}
                            >
                              {showSplitPeople ? (
                                <Stack gap={2} align="center">
                                  <Stack gap={0} align="center">
                                    <Text size="xs" fw={700} style={{ lineHeight: 1.05 }}><strong>Commission:</strong></Text>
                                    <Text size="sm" fw={700} style={{ lineHeight: 1.05 }}>
                                      {receivablePeople}
                                    </Text>
                                  </Stack>
                                  <Stack gap={0} align="center">
                                    <Text size="xs" fw={700} style={{ lineHeight: 1.05 }}><strong>Open Bar:</strong></Text>
                                    <Text size="sm" fw={700} style={{ lineHeight: 1.05 }}>
                                      {payablePeople}
                                    </Text>
                                  </Stack>
                                </Stack>
                              ) : (
                                <Text fw={700}>{receivablePeople || payablePeople || 0}</Text>
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
                            <Table.Td style={{ textAlign: "center", verticalAlign: "middle" }}>
                              <Stack gap={4} align="center">
                                {showCollectButton && (
                                  <Button
                                    size="xs"
                                    variant="light"
                                    disabled={collectDisabled}
                                    onClick={() => {
                                      if (!collectDisabled && venue.venueId !== null) {
                                        openEntryModal("receivable", venue);
                                      }
                                    }}
                                  >
                                    Collect
                                  </Button>
                                )}
                                {venue.latestReceivableCollectionLogId && receivableCollected > 0 && (
                                  <Button
                                    size="xs"
                                    variant="light"
                                    color="red"
                                    loading={undoCollectionLogId === venue.latestReceivableCollectionLogId}
                                    disabled={undoCollectDisabled}
                                    onClick={() => {
                                      void handleUndoCollection(
                                        venue.latestReceivableCollectionLogId ?? null,
                                      );
                                    }}
                                  >
                                    Undo Collect
                                  </Button>
                                )}
                                {showPayButton && (
                                  <Button
                                    size="xs"
                                    variant="light"
                                    color="grape"
                                    disabled={payDisabled}
                                    onClick={() => {
                                      if (!payDisabled && venue.venueId !== null) {
                                        openEntryModal("payable", venue);
                                      }
                                    }}
                                  >
                                    Pay
                                  </Button>
                                )}
                                {venue.latestPayableCollectionLogId && payableCollected > 0 && (
                                  <Button
                                    size="xs"
                                    variant="light"
                                    color="red"
                                    loading={undoCollectionLogId === venue.latestPayableCollectionLogId}
                                    disabled={undoPayDisabled}
                                    onClick={() => {
                                      void handleUndoCollection(venue.latestPayableCollectionLogId ?? null);
                                    }}
                                  >
                                    Undo Pay
                                  </Button>
                                )}
                              </Stack>
                            </Table.Td>
                          </Table.Tr>
                          {isExpanded && (
                            <Table.Tr>
                              <Table.Td colSpan={11}>
                                <Stack gap="xs">
                                  {dailyRows.length === 0 ? (
                                    <Text size="sm" c="dimmed">
                                      No submitted reports match this venue during the selected period.
                                    </Text>
                                  ) : (
                                    <ScrollArea offsetScrollbars type="auto">
                                      <Table striped withColumnBorders miw={720} stickyHeader>
                                        <Table.Thead>
                                          <Table.Tr>
                                            <Table.Th
                                              style={{
                                                position: "sticky",
                                                left: 0,
                                                zIndex: 4,
                                                background: "var(--mantine-color-body)",
                                                minWidth: 120,
                                                textAlign: "center",
                                              }}
                                            >
                                              Date
                                            </Table.Th>
                                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle" }}>Total People</Table.Th>
                                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle" }}>Normal</Table.Th>
                                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle" }}>Cocktail</Table.Th>
                                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle" }}>Brunch</Table.Th>
                                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle" }}>Report</Table.Th>
                                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle" }}>Type</Table.Th>
                                            <Table.Th style={{ textAlign: "center", verticalAlign: "middle" }}>Amount</Table.Th>
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
                                              <Table.Td
                                                style={{
                                                  position: "sticky",
                                                  left: 0,
                                                  zIndex: 3,
                                                  background: "var(--mantine-color-body)",
                                                  minWidth: 120,
                                                  textAlign: "center",
                                                }}
                                              >
                                                {dayjs(day.date).format("MMM D, YYYY")}
                                              </Table.Td>
                                              <Table.Td style={{ textAlign: "center", verticalAlign: "middle" }}>{day.totalPeople}</Table.Td>
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
                                              <Table.Td style={{ textAlign: "center", verticalAlign: "middle" }}>
                                                {placeholder ? (
                                                  "No report"
                                                ) : day.reportId ? (
                                                  <Group gap="xs" wrap="nowrap" justify="center">
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
                                              <Table.Td c={amountColor} style={{ textAlign: "center", verticalAlign: "middle" }}>
                                                {formatCurrency(day.amount, venue.currency)}
                                              </Table.Td>
                                            </Table.Tr>
                                          );
                                        })}
                                        </Table.Tbody>
                                      </Table>
                                    </ScrollArea>
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
                  </Box>
                </Box>
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










