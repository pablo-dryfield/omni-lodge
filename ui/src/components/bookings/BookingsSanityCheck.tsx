import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Badge,
  Box,
  Button,
  Checkbox,
  FileInput,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import axios from "axios";

import axiosInstance from "../../utils/axiosInstance";

dayjs.extend(customParseFormat);

const DATE_FORMAT = "YYYY-MM-DD";

type SanityDateField = "experience_date" | "source_received_at";
type SanityPlatform =
  | "ecwid"
  | "viator"
  | "getyourguide"
  | "civitatis"
  | "airbnb"
  | "fareharbor"
  | "freetour"
  | "xperiencepoland"
  | "manual"
  | "unknown";

type OmniTotals = {
  bookings: number;
  orderGroups: number;
  people: number;
  revenue: number;
  baseAmount: number;
  tipAmount: number;
  priceGross: number;
  priceNet: number;
  refundedAmount: number;
};

type OmniOrderAggregate = {
  orderKey: string;
  platformOrderId: string | null;
  bookingIds: number[];
  platformBookingIds: string[];
  bookings: number;
  people: number;
  revenue: number;
  baseAmount: number;
  tipAmount: number;
  priceGross: number;
  priceNet: number;
  refundedAmount: number;
  firstDate: string | null;
  lastDate: string | null;
  firstSourceReceivedAt: string | null;
  lastSourceReceivedAt: string | null;
  statuses: string[];
};

type OmniSummaryResponse = {
  window: {
    startDate: string;
    endDate: string;
    dateField: SanityDateField;
  };
  platform?: string;
  includeCancelled: boolean;
  totals?: OmniTotals;
  orders?: OmniOrderAggregate[];
  platforms?: Array<{ platform: string; totals: OmniTotals }>;
};

type EcwidCauseKey = "tip" | "coupon" | "refund";

type EcwidMismatchDiagnosis = {
  checkOrder: EcwidCauseKey[];
  checkHints: EcwidCauseKey[];
  likelyCauses: string[];
  tipImpact: number;
  couponImpact: number;
  refundAdjustment: number;
  deltaAfterTip: number;
  deltaAfterCoupon: number;
  deltaAfterRefund: number;
};

type EcwidMismatch = {
  reason: "only_omni" | "only_external" | "mismatch";
  orderId: string;
  omniRevenue: number;
  externalRevenue: number;
  deltaRevenue: number;
  omniPeople: number;
  externalPeople: number;
  deltaPeople: number;
  omniBookings: number;
  externalBookings: number;
  omniFirstDate: string | null;
  omniLastDate: string | null;
  externalDate: string | null;
  externalPaymentStatus: string | null;
  externalMatchSource: string | null;
  diagnosis: EcwidMismatchDiagnosis;
};

type EcwidDiagnosticsSummary = {
  checkOrder: EcwidCauseKey[];
  hintCounts: Record<EcwidCauseKey, number>;
  likelyCauseCounts: Record<string, number>;
  topLikelyCauses: Array<{ cause: string; count: number }>;
};

type EcwidComparisonResponse = {
  window: {
    startDate: string;
    endDate: string;
    dateField: SanityDateField;
  };
  includeCancelled: boolean;
  tolerance: number;
  omniTotals: OmniTotals;
  externalTotals: OmniTotals;
  totals: {
    gapRevenue: number;
    gapPeople: number;
    gapBookings: number;
  };
  mismatchCounts: {
    only_omni: number;
    only_external: number;
    mismatch: number;
  };
  diagnostics: EcwidDiagnosticsSummary;
  passed: boolean;
  mismatches: EcwidMismatch[];
};

type EcwidScopedReprocessResponse = {
  ordersRequested: number;
  ordersMissing: number;
  messageCount: number;
  results: Record<string, number>;
};

type EcwidFixOrderResponse = {
  orderId: string;
  message: string;
  totals: {
    ecwidGross: number;
    ecwidNet: number;
    ecwidDiscount: number;
    ecwidTip: number;
  };
  updatedBookingIds: number[];
  createdBookingIds: number[];
  cancelledBookingIds: number[];
};

type EcwidFixOrdersResponse = {
  requested: number;
  fixed: number;
  failed: number;
  results: Array<{
    orderId: string;
    status: "ok" | "failed";
    error?: string;
  }>;
};

type ViatorCsvSummary = {
  bookings: number;
  people: number;
  revenue: number;
  skippedCancelled: number;
  skippedOutOfRange: number;
  dateColumn: string | null;
  revenueColumn: string | null;
  peopleColumn: string | null;
};

const PLATFORM_OPTIONS: Array<{ value: SanityPlatform; label: string }> = [
  { value: "ecwid", label: "Ecwid (Automatic)" },
  { value: "viator", label: "Viator (CSV upload/manual)" },
  { value: "getyourguide", label: "GetYourGuide (Manual)" },
  { value: "civitatis", label: "Civitatis (Manual)" },
  { value: "airbnb", label: "Airbnb (Manual)" },
  { value: "fareharbor", label: "FareHarbor (Manual)" },
  { value: "freetour", label: "FreeTour (Manual)" },
  { value: "xperiencepoland", label: "XperiencePoland (Manual)" },
  { value: "manual", label: "Manual" },
  { value: "unknown", label: "Unknown" },
];

const formatMoney = (value: number): string => {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatCauseLabel = (value: string): string => {
  if (!value) {
    return "Unknown";
  }
  return value
    .split("+")
    .map((token) =>
      token
        .split("_")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join(" "),
    )
    .join(" + ");
};

const parseMoney = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }
  const cleaned = raw.replace(/\s+/g, "").replace(/[^\d,.-]/g, "");
  if (!cleaned) {
    return 0;
  }

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;

  if (hasComma && hasDot) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(/,/g, ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(/,/g, ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseInteger = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const extractErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const fromPayload = error.response?.data?.message;
    if (typeof fromPayload === "string" && fromPayload.trim()) {
      return fromPayload;
    }
    if (typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Request failed";
};

const parseCsv = (content: string): { headers: string[]; rows: string[][] } => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      cell = "";
      const hasValues = row.some((entry) => entry.trim().length > 0);
      if (hasValues) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    const hasValues = row.some((entry) => entry.trim().length > 0);
    if (hasValues) {
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rows[0].map((entry) => entry.trim());
  const dataRows = rows.slice(1);
  return { headers, rows: dataRows };
};

const normalizeHeader = (header: string): string => {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const findHeaderIndex = (headers: string[], candidates: string[]): number => {
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate);
    const exactIndex = normalizedHeaders.findIndex((value) => value === normalizedCandidate);
    if (exactIndex >= 0) {
      return exactIndex;
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate);
    const containsIndex = normalizedHeaders.findIndex((value) => value.includes(normalizedCandidate));
    if (containsIndex >= 0) {
      return containsIndex;
    }
  }

  return -1;
};

const parseFlexibleDate = (value: string): string | null => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const formats = [
    "YYYY-MM-DD",
    "YYYY/MM/DD",
    "DD/MM/YYYY",
    "DD-MM-YYYY",
    "MM/DD/YYYY",
    "MMM D, YYYY",
    "MMMM D, YYYY",
    "ddd, MMM D, YYYY",
    "ddd, MMMM D, YYYY",
  ];

  for (const format of formats) {
    const parsed = dayjs(trimmed, format, true);
    if (parsed.isValid()) {
      return parsed.format(DATE_FORMAT);
    }
  }

  const fallback = dayjs(trimmed);
  if (fallback.isValid()) {
    return fallback.format(DATE_FORMAT);
  }

  return null;
};

const parseViatorCsvSummary = (
  content: string,
  rangeStart: string,
  rangeEnd: string,
  dateField: SanityDateField,
): ViatorCsvSummary => {
  const { headers, rows } = parseCsv(content);
  if (headers.length === 0) {
    throw new Error("CSV has no headers.");
  }

  const experienceDateColumns = ["travel date", "activity date", "experience date", "tour date", "service date"];
  const sourceDateColumns = ["booking date", "booked date", "creation date", "order date", "reservation date"];
  const revenueColumns = ["net amount", "net price", "net", "revenue", "amount", "total"];
  const peopleColumns = ["travelers", "travellers", "pax", "party size", "participants", "guests", "people"];
  const statusColumns = ["status", "booking status", "reservation status"];

  const dateIndex = findHeaderIndex(headers, dateField === "experience_date" ? experienceDateColumns : sourceDateColumns);
  const fallbackDateIndex =
    dateIndex >= 0
      ? dateIndex
      : findHeaderIndex(headers, dateField === "experience_date" ? sourceDateColumns : experienceDateColumns);
  const revenueIndex = findHeaderIndex(headers, revenueColumns);
  const peopleIndex = findHeaderIndex(headers, peopleColumns);
  const statusIndex = findHeaderIndex(headers, statusColumns);

  let bookings = 0;
  let people = 0;
  let revenue = 0;
  let skippedCancelled = 0;
  let skippedOutOfRange = 0;

  rows.forEach((row) => {
    const statusRaw = statusIndex >= 0 ? String(row[statusIndex] ?? "") : "";
    if (/cancel/i.test(statusRaw)) {
      skippedCancelled += 1;
      return;
    }

    if (fallbackDateIndex >= 0) {
      const parsedDate = parseFlexibleDate(String(row[fallbackDateIndex] ?? ""));
      if (!parsedDate || parsedDate < rangeStart || parsedDate > rangeEnd) {
        skippedOutOfRange += 1;
        return;
      }
    }

    const peopleValue = peopleIndex >= 0 ? parseInteger(row[peopleIndex]) : 1;
    const revenueValue = revenueIndex >= 0 ? parseMoney(row[revenueIndex]) : 0;

    bookings += 1;
    people += peopleValue > 0 ? peopleValue : 0;
    revenue += revenueValue;
  });

  return {
    bookings,
    people,
    revenue: Math.round((revenue + Number.EPSILON) * 100) / 100,
    skippedCancelled,
    skippedOutOfRange,
    dateColumn: fallbackDateIndex >= 0 ? headers[fallbackDateIndex] : null,
    revenueColumn: revenueIndex >= 0 ? headers[revenueIndex] : null,
    peopleColumn: peopleIndex >= 0 ? headers[peopleIndex] : null,
  };
};

const BookingsSanityCheck = () => {
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>(() => [
    dayjs().startOf("month").toDate(),
    dayjs().endOf("month").toDate(),
  ]);
  const [dateField, setDateField] = useState<SanityDateField>("experience_date");
  const [platform, setPlatform] = useState<SanityPlatform>("ecwid");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [tolerance, setTolerance] = useState<number>(0.01);

  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OmniSummaryResponse | null>(null);

  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformError, setPlatformError] = useState<string | null>(null);
  const [platformResult, setPlatformResult] = useState<OmniSummaryResponse | null>(null);

  const [ecwidLoading, setEcwidLoading] = useState(false);
  const [ecwidError, setEcwidError] = useState<string | null>(null);
  const [ecwidResult, setEcwidResult] = useState<EcwidComparisonResponse | null>(null);
  const [ecwidReprocessLoading, setEcwidReprocessLoading] = useState(false);
  const [ecwidReprocessInfo, setEcwidReprocessInfo] = useState<string | null>(null);
  const [ecwidReprocessError, setEcwidReprocessError] = useState<string | null>(null);
  const [ecwidFixLoadingOrderId, setEcwidFixLoadingOrderId] = useState<string | null>(null);
  const [ecwidFixBulkLoading, setEcwidFixBulkLoading] = useState(false);
  const [ecwidFixInfo, setEcwidFixInfo] = useState<string | null>(null);
  const [ecwidFixError, setEcwidFixError] = useState<string | null>(null);
  const [selectedEcwidOrderIds, setSelectedEcwidOrderIds] = useState<string[]>([]);

  const [expectedBookings, setExpectedBookings] = useState<number | "">("");
  const [expectedPeople, setExpectedPeople] = useState<number | "">("");
  const [expectedRevenue, setExpectedRevenue] = useState<number | "">("");
  const [viatorFile, setViatorFile] = useState<File | null>(null);
  const [viatorInfo, setViatorInfo] = useState<string | null>(null);
  const [viatorError, setViatorError] = useState<string | null>(null);

  const rangeStart = useMemo(() => {
    const source = dateRange[0] ?? dateRange[1] ?? dayjs().startOf("month").toDate();
    return dayjs(source).format(DATE_FORMAT);
  }, [dateRange]);

  const rangeEnd = useMemo(() => {
    const source = dateRange[1] ?? dateRange[0] ?? dayjs().endOf("month").toDate();
    return dayjs(source).format(DATE_FORMAT);
  }, [dateRange]);

  const manualComparison = useMemo(() => {
    if (!platformResult?.totals) {
      return null;
    }

    const expectedReady =
      typeof expectedBookings === "number" &&
      typeof expectedPeople === "number" &&
      typeof expectedRevenue === "number";

    if (!expectedReady) {
      return {
        ready: false,
        passed: false,
        deltaBookings: 0,
        deltaPeople: 0,
        deltaRevenue: 0,
      };
    }

    const deltaBookings = platformResult.totals.bookings - expectedBookings;
    const deltaPeople = platformResult.totals.people - expectedPeople;
    const deltaRevenue = Math.round((platformResult.totals.revenue - expectedRevenue + Number.EPSILON) * 100) / 100;

    return {
      ready: true,
      passed: deltaBookings === 0 && deltaPeople === 0 && Math.abs(deltaRevenue) <= tolerance,
      deltaBookings,
      deltaPeople,
      deltaRevenue,
    };
  }, [expectedBookings, expectedPeople, expectedRevenue, platformResult, tolerance]);

  const visibleEcwidMismatches = useMemo(() => {
    return ecwidResult?.mismatches.slice(0, 300) ?? [];
  }, [ecwidResult]);

  const visibleEcwidOrderIds = useMemo(() => {
    return Array.from(
      new Set(
        visibleEcwidMismatches
          .map((row) => String(row.orderId ?? "").trim())
          .filter((orderId) => orderId.length > 0),
      ),
    );
  }, [visibleEcwidMismatches]);

  const allVisibleEcwidOrdersSelected =
    visibleEcwidOrderIds.length > 0 && visibleEcwidOrderIds.every((orderId) => selectedEcwidOrderIds.includes(orderId));

  useEffect(() => {
    setSelectedEcwidOrderIds((current) =>
      current.filter((orderId) => visibleEcwidOrderIds.includes(orderId)),
    );
  }, [visibleEcwidOrderIds]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const response = await axiosInstance.get<OmniSummaryResponse>("/bookings/sanity-check/omni", {
        params: {
          startDate: rangeStart,
          endDate: rangeEnd,
          dateField,
          includeCancelled,
        },
        withCredentials: true,
      });
      setOverview(response.data);
    } catch (error) {
      setOverviewError(extractErrorMessage(error));
    } finally {
      setOverviewLoading(false);
    }
  }, [dateField, includeCancelled, rangeEnd, rangeStart]);

  const runPlatformCheck = useCallback(async () => {
    if (platform === "ecwid") {
      setEcwidLoading(true);
      setEcwidError(null);
      setEcwidResult(null);
      setEcwidReprocessInfo(null);
      setEcwidReprocessError(null);
      setEcwidFixInfo(null);
      setEcwidFixError(null);
      try {
        const response = await axiosInstance.get<EcwidComparisonResponse>("/bookings/sanity-check/ecwid", {
          params: {
            startDate: rangeStart,
            endDate: rangeEnd,
            dateField,
            includeCancelled,
            tolerance,
          },
          withCredentials: true,
        });
        setEcwidResult(response.data);
      } catch (error) {
        setEcwidError(extractErrorMessage(error));
      } finally {
        setEcwidLoading(false);
      }
      return;
    }

    setPlatformLoading(true);
    setPlatformError(null);
    setPlatformResult(null);
    try {
      const response = await axiosInstance.get<OmniSummaryResponse>("/bookings/sanity-check/omni", {
        params: {
          startDate: rangeStart,
          endDate: rangeEnd,
          dateField,
          platform,
          includeCancelled,
          includeBreakdown: true,
        },
        withCredentials: true,
      });
      setPlatformResult(response.data);
    } catch (error) {
      setPlatformError(extractErrorMessage(error));
    } finally {
      setPlatformLoading(false);
    }
  }, [dateField, includeCancelled, platform, rangeEnd, rangeStart, tolerance]);

  const runScopedHintReprocess = useCallback(async () => {
    if (!ecwidResult || ecwidResult.mismatches.length === 0) {
      return;
    }
    setEcwidReprocessLoading(true);
    setEcwidReprocessInfo(null);
    setEcwidReprocessError(null);
    try {
      const rows = ecwidResult.mismatches.map((row) => ({
        orderId: row.orderId,
        hints: row.diagnosis.checkHints.length > 0 ? row.diagnosis.checkHints : row.diagnosis.checkOrder,
      }));
      const response = await axiosInstance.post<EcwidScopedReprocessResponse>(
        "/bookings/sanity-check/ecwid/reprocess-hints",
        { rows },
        { withCredentials: true },
      );
      const resultsSummary = Object.entries(response.data.results ?? {})
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      setEcwidReprocessInfo(
        `Scoped reprocess completed. Orders=${response.data.ordersRequested}, missing=${response.data.ordersMissing}, emails=${response.data.messageCount}${resultsSummary ? `, ${resultsSummary}` : ""}.`,
      );
      await runPlatformCheck();
    } catch (error) {
      setEcwidReprocessError(extractErrorMessage(error));
    } finally {
      setEcwidReprocessLoading(false);
    }
  }, [ecwidResult, runPlatformCheck]);

  const runFixOrderFromEcwid = useCallback(
    async (orderId: string) => {
      const trimmedOrderId = String(orderId ?? "").trim();
      if (!trimmedOrderId) {
        return;
      }
      const confirmed = window.confirm(
        `Fix order ${trimmedOrderId} from live Ecwid data? This overwrites the Omni bookings under this order.`,
      );
      if (!confirmed) {
        return;
      }
      setEcwidFixLoadingOrderId(trimmedOrderId);
      setEcwidFixInfo(null);
      setEcwidFixError(null);
      try {
        const response = await axiosInstance.post<EcwidFixOrderResponse>(
          "/bookings/sanity-check/ecwid/fix-order",
          { orderId: trimmedOrderId },
          { withCredentials: true },
        );
        const createdCount = Array.isArray(response.data.createdBookingIds) ? response.data.createdBookingIds.length : 0;
        const updatedCount = Array.isArray(response.data.updatedBookingIds) ? response.data.updatedBookingIds.length : 0;
        const cancelledCount = Array.isArray(response.data.cancelledBookingIds)
          ? response.data.cancelledBookingIds.length
          : 0;
        setEcwidFixInfo(
          `Order ${response.data.orderId} synced. Updated=${updatedCount}, created=${createdCount}, cancelled=${cancelledCount}.`,
        );
        await runPlatformCheck();
      } catch (error) {
        setEcwidFixError(extractErrorMessage(error));
      } finally {
        setEcwidFixLoadingOrderId(null);
      }
    },
    [runPlatformCheck],
  );

  const toggleVisibleEcwidSelection = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedEcwidOrderIds((current) => Array.from(new Set([...current, ...visibleEcwidOrderIds])));
        return;
      }
      setSelectedEcwidOrderIds((current) =>
        current.filter((orderId) => !visibleEcwidOrderIds.includes(orderId)),
      );
    },
    [visibleEcwidOrderIds],
  );

  const toggleEcwidOrderSelection = useCallback((orderId: string, checked: boolean) => {
    const normalizedOrderId = String(orderId ?? "").trim();
    if (!normalizedOrderId) {
      return;
    }
    setSelectedEcwidOrderIds((current) => {
      if (checked) {
        return current.includes(normalizedOrderId) ? current : [...current, normalizedOrderId];
      }
      return current.filter((id) => id !== normalizedOrderId);
    });
  }, []);

  const runBulkFixOrdersFromEcwid = useCallback(async () => {
    const orderIds = selectedEcwidOrderIds
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0);
    if (orderIds.length === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Fix ${orderIds.length} selected order(s) from live Ecwid data? This overwrites Omni bookings under those orders.`,
    );
    if (!confirmed) {
      return;
    }
    setEcwidFixBulkLoading(true);
    setEcwidFixInfo(null);
    setEcwidFixError(null);
    try {
      const response = await axiosInstance.post<EcwidFixOrdersResponse>(
        "/bookings/sanity-check/ecwid/fix-orders",
        { orderIds },
        { withCredentials: true },
      );
      setEcwidFixInfo(
        `Bulk sync completed. Requested=${response.data.requested}, fixed=${response.data.fixed}, failed=${response.data.failed}.`,
      );
      setSelectedEcwidOrderIds([]);
      await runPlatformCheck();
    } catch (error) {
      setEcwidFixError(extractErrorMessage(error));
    } finally {
      setEcwidFixBulkLoading(false);
    }
  }, [runPlatformCheck, selectedEcwidOrderIds]);

  const applyViatorCsv = useCallback(async () => {
    if (!viatorFile) {
      setViatorError("Select a CSV file first.");
      return;
    }

    try {
      setViatorError(null);
      const text = await viatorFile.text();
      const summary = parseViatorCsvSummary(text, rangeStart, rangeEnd, dateField);
      setExpectedBookings(summary.bookings);
      setExpectedPeople(summary.people);
      setExpectedRevenue(summary.revenue);
      setViatorInfo(
        `CSV parsed. Bookings=${summary.bookings}, People=${summary.people}, Revenue=${formatMoney(summary.revenue)}. ` +
          `Skipped cancelled=${summary.skippedCancelled}, out-of-range=${summary.skippedOutOfRange}.`,
      );
    } catch (error) {
      setViatorError(extractErrorMessage(error));
    }
  }, [dateField, rangeEnd, rangeStart, viatorFile]);

  return (
    <Stack gap="md">
      <Paper withBorder radius="lg" shadow="sm" p="md">
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="wrap">
            <Title order={4}>Sanity Check</Title>
            <Badge color="blue" variant="light">
              {`${rangeStart} -> ${rangeEnd}`}
            </Badge>
          </Group>

          <Group gap="sm" wrap="wrap" align="end">
            <DatePickerInput
              type="range"
              label="Date Range"
              value={dateRange}
              onChange={setDateRange}
              valueFormat="YYYY-MM-DD"
              clearable
              style={{ minWidth: 280 }}
            />
            <Select
              label="Platform"
              data={PLATFORM_OPTIONS}
              value={platform}
              onChange={(value) => setPlatform((value as SanityPlatform) ?? "ecwid")}
              allowDeselect={false}
              style={{ minWidth: 260 }}
            />
            <SegmentedControl
              value={dateField}
              onChange={(value) => setDateField(value as SanityDateField)}
              data={[
                { value: "experience_date", label: "Experience Date" },
                { value: "source_received_at", label: "Source Received At" },
              ]}
            />
            <SegmentedControl
              value={includeCancelled ? "include" : "exclude"}
              onChange={(value) => setIncludeCancelled(value === "include")}
              data={[
                { value: "exclude", label: "Exclude Cancelled" },
                { value: "include", label: "Include Cancelled" },
              ]}
            />
            <NumberInput
              label="Tolerance"
              value={tolerance}
              onChange={(value) =>
                setTolerance(typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0.01)
              }
              decimalScale={2}
              min={0}
              step={0.01}
              style={{ width: 120 }}
            />
          </Group>

          <Group gap="sm" wrap="wrap">
            <Button onClick={loadOverview} loading={overviewLoading} variant="light">
              Load Omni Snapshot (All Platforms)
            </Button>
            <Button onClick={runPlatformCheck} loading={platform === "ecwid" ? ecwidLoading : platformLoading}>
              Run Platform Check
            </Button>
          </Group>
        </Stack>
      </Paper>

      {overviewError && (
        <Alert color="red" title="Snapshot error">
          {overviewError}
        </Alert>
      )}

      {overview && Array.isArray(overview.platforms) && (
        <Paper withBorder radius="lg" shadow="sm" p="md">
          <Stack gap="sm">
            <Text fw={600}>Omni Snapshot by platform</Text>
            <Table striped highlightOnHover withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Platform</Table.Th>
                  <Table.Th ta="right">Revenue</Table.Th>
                  <Table.Th ta="right">Bookings</Table.Th>
                  <Table.Th ta="right">Order IDs</Table.Th>
                  <Table.Th ta="right">People</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {overview.platforms.map((entry) => (
                  <Table.Tr key={entry.platform}>
                    <Table.Td>{entry.platform}</Table.Td>
                    <Table.Td ta="right">{formatMoney(entry.totals.revenue)}</Table.Td>
                    <Table.Td ta="right">{entry.totals.bookings}</Table.Td>
                    <Table.Td ta="right">{entry.totals.orderGroups}</Table.Td>
                    <Table.Td ta="right">{entry.totals.people}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Paper>
      )}

      {platform === "viator" && (
        <Paper withBorder radius="lg" shadow="sm" p="md">
          <Stack gap="sm">
            <Text fw={600}>Viator CSV</Text>
            <Group gap="sm" wrap="wrap" align="end">
              <FileInput
                label="Upload Viator CSV"
                value={viatorFile}
                onChange={setViatorFile}
                accept=".csv,text/csv"
                style={{ minWidth: 320 }}
              />
              <Button variant="light" onClick={applyViatorCsv} disabled={!viatorFile}>
                Use CSV as Expected
              </Button>
            </Group>
            {viatorInfo && (
              <Alert color="blue" title="CSV result">
                {viatorInfo}
              </Alert>
            )}
            {viatorError && (
              <Alert color="red" title="CSV error">
                {viatorError}
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      {platform !== "ecwid" && (
        <Paper withBorder radius="lg" shadow="sm" p="md">
          <Stack gap="sm">
            <Text fw={600}>Expected values (external source)</Text>
            <Group gap="sm" wrap="wrap">
              <NumberInput
                label="Expected bookings"
                value={expectedBookings}
                onChange={(value) =>
                  setExpectedBookings(typeof value === "number" && Number.isFinite(value) ? value : "")
                }
                min={0}
                style={{ width: 180 }}
              />
              <NumberInput
                label="Expected people"
                value={expectedPeople}
                onChange={(value) => setExpectedPeople(typeof value === "number" && Number.isFinite(value) ? value : "")}
                min={0}
                style={{ width: 180 }}
              />
              <NumberInput
                label="Expected revenue"
                value={expectedRevenue}
                onChange={(value) =>
                  setExpectedRevenue(typeof value === "number" && Number.isFinite(value) ? value : "")
                }
                decimalScale={2}
                min={0}
                style={{ width: 200 }}
              />
            </Group>
          </Stack>
        </Paper>
      )}

      {platformError && (
        <Alert color="red" title="Platform check error">
          {platformError}
        </Alert>
      )}

      {platformResult?.totals && platform !== "ecwid" && (
        <Paper withBorder radius="lg" shadow="sm" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text fw={600}>{`Omni totals for ${platform}`}</Text>
              <Badge color={manualComparison?.ready && manualComparison.passed ? "teal" : "yellow"} variant="light">
                {manualComparison?.ready ? (manualComparison.passed ? "PASS" : "MISMATCH") : "Expected missing"}
              </Badge>
            </Group>
            <Group gap="md" wrap="wrap">
              <Text>{`Revenue: ${formatMoney(platformResult.totals.revenue)}`}</Text>
              <Text>{`Bookings: ${platformResult.totals.bookings}`}</Text>
              <Text>{`Order IDs: ${platformResult.totals.orderGroups}`}</Text>
              <Text>{`People: ${platformResult.totals.people}`}</Text>
            </Group>
            {manualComparison?.ready && (
              <Group gap="md" wrap="wrap">
                <Text>{`Delta revenue: ${formatMoney(manualComparison.deltaRevenue)}`}</Text>
                <Text>{`Delta bookings: ${manualComparison.deltaBookings}`}</Text>
                <Text>{`Delta people: ${manualComparison.deltaPeople}`}</Text>
              </Group>
            )}
            {Array.isArray(platformResult.orders) && platformResult.orders.length > 0 && (
              <Box>
                <Text fw={600} size="sm" mb={6}>
                  Order breakdown
                </Text>
                <Table striped highlightOnHover withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Order key</Table.Th>
                      <Table.Th ta="right">Revenue</Table.Th>
                      <Table.Th ta="right">Bookings</Table.Th>
                      <Table.Th ta="right">People</Table.Th>
                      <Table.Th>Date</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {platformResult.orders.slice(0, 200).map((row) => (
                      <Table.Tr key={row.orderKey}>
                        <Table.Td>{row.orderKey}</Table.Td>
                        <Table.Td ta="right">{formatMoney(row.revenue)}</Table.Td>
                        <Table.Td ta="right">{row.bookings}</Table.Td>
                        <Table.Td ta="right">{row.people}</Table.Td>
                        <Table.Td>{row.firstDate ?? "-"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Box>
            )}
          </Stack>
        </Paper>
      )}

      {ecwidError && (
        <Alert color="red" title="Ecwid check error">
          {ecwidError}
        </Alert>
      )}

      {ecwidLoading && (
        <Paper withBorder radius="lg" shadow="sm" p="md">
          <Loader variant="bars" />
        </Paper>
      )}

      {ecwidResult && (
        <Paper withBorder radius="lg" shadow="sm" p="md">
          <Stack gap="sm">
            <Group justify="space-between" align="center" wrap="wrap">
              <Text fw={600}>Ecwid automatic comparison</Text>
              <Badge color={ecwidResult.passed ? "teal" : "red"} variant="light">
                {ecwidResult.passed ? "PASS" : "MISMATCH"}
              </Badge>
            </Group>
            <Group gap="md" wrap="wrap">
              <Text>{`Omni revenue: ${formatMoney(ecwidResult.omniTotals.revenue)}`}</Text>
              <Text>{`Ecwid revenue: ${formatMoney(ecwidResult.externalTotals.revenue)}`}</Text>
              <Text>{`Gap: ${formatMoney(ecwidResult.totals.gapRevenue)}`}</Text>
            </Group>
            <Group gap="md" wrap="wrap">
              <Text>{`Only Omni: ${ecwidResult.mismatchCounts.only_omni}`}</Text>
              <Text>{`Only Ecwid: ${ecwidResult.mismatchCounts.only_external}`}</Text>
              <Text>{`Data mismatch: ${ecwidResult.mismatchCounts.mismatch}`}</Text>
            </Group>

            <Group gap="sm" wrap="wrap">
              <Button
                variant="light"
                loading={ecwidReprocessLoading}
                disabled={ecwidResult.mismatches.length === 0 || ecwidFixBulkLoading}
                onClick={runScopedHintReprocess}
              >
                Reprocess Hint Fields
              </Button>
              <Button
                variant="light"
                loading={ecwidFixBulkLoading}
                disabled={
                  selectedEcwidOrderIds.length === 0 || ecwidReprocessLoading || ecwidFixLoadingOrderId !== null
                }
                onClick={runBulkFixOrdersFromEcwid}
              >
                Fix Selected From Ecwid
              </Button>
              <Text size="sm" c="dimmed">{`Selected: ${selectedEcwidOrderIds.length}`}</Text>
            </Group>

            {ecwidReprocessInfo && (
              <Alert color="blue" title="Scoped reprocess">
                {ecwidReprocessInfo}
              </Alert>
            )}
            {ecwidReprocessError && (
              <Alert color="red" title="Scoped reprocess failed">
                {ecwidReprocessError}
              </Alert>
            )}
            {ecwidFixInfo && (
              <Alert color="blue" title="Fix from Ecwid">
                {ecwidFixInfo}
              </Alert>
            )}
            {ecwidFixError && (
              <Alert color="red" title="Fix from Ecwid failed">
                {ecwidFixError}
              </Alert>
            )}

            {!ecwidResult.passed && (
              <Alert color="yellow" title="Mismatch detected">
                <Stack gap={6}>
                  <Text size="sm">
                    {`Check in this order: ${ecwidResult.diagnostics.checkOrder
                      .map((item) => formatCauseLabel(item))
                      .join(" -> ")}`}
                  </Text>
                  <Group gap="xs" wrap="wrap">
                    <Badge variant="light" color="orange">
                      {`Tip hints: ${ecwidResult.diagnostics.hintCounts.tip}`}
                    </Badge>
                    <Badge variant="light" color="grape">
                      {`Coupon hints: ${ecwidResult.diagnostics.hintCounts.coupon}`}
                    </Badge>
                    <Badge variant="light" color="blue">
                      {`Refund hints: ${ecwidResult.diagnostics.hintCounts.refund}`}
                    </Badge>
                  </Group>
                  {ecwidResult.diagnostics.topLikelyCauses.length > 0 && (
                    <Group gap="xs" wrap="wrap">
                      {ecwidResult.diagnostics.topLikelyCauses.map((entry) => (
                        <Badge key={entry.cause} variant="outline" color="gray">
                          {`${formatCauseLabel(entry.cause)}: ${entry.count}`}
                        </Badge>
                      ))}
                    </Group>
                  )}
                </Stack>
              </Alert>
            )}

            {ecwidResult.mismatches.length === 0 ? (
              <Alert color="teal" title="No mismatches">
                All Ecwid checks passed for this date range.
              </Alert>
            ) : (
              <Table striped highlightOnHover withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>
                      <Checkbox
                        checked={allVisibleEcwidOrdersSelected}
                        indeterminate={
                          selectedEcwidOrderIds.length > 0 && !allVisibleEcwidOrdersSelected
                        }
                        onChange={(event) => toggleVisibleEcwidSelection(event.currentTarget.checked)}
                        disabled={visibleEcwidOrderIds.length === 0 || ecwidFixBulkLoading}
                      />
                    </Table.Th>
                    <Table.Th>Reason</Table.Th>
                    <Table.Th>Order ID</Table.Th>
                    <Table.Th ta="right">Omni revenue</Table.Th>
                    <Table.Th ta="right">Ecwid revenue</Table.Th>
                    <Table.Th ta="right">Delta</Table.Th>
                    <Table.Th ta="right">Omni people</Table.Th>
                    <Table.Th ta="right">Ecwid people</Table.Th>
                    <Table.Th>Checker Hints</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visibleEcwidMismatches.map((row) => (
                    <Table.Tr key={`${row.reason}-${row.orderId}`}>
                      <Table.Td>
                        <Checkbox
                          checked={selectedEcwidOrderIds.includes(row.orderId)}
                          onChange={(event) =>
                            toggleEcwidOrderSelection(row.orderId, event.currentTarget.checked)
                          }
                          disabled={ecwidFixBulkLoading}
                        />
                      </Table.Td>
                      <Table.Td>{row.reason}</Table.Td>
                      <Table.Td>{row.orderId}</Table.Td>
                      <Table.Td ta="right">{formatMoney(row.omniRevenue)}</Table.Td>
                      <Table.Td ta="right">{formatMoney(row.externalRevenue)}</Table.Td>
                      <Table.Td ta="right">{formatMoney(row.deltaRevenue)}</Table.Td>
                      <Table.Td ta="right">{row.omniPeople}</Table.Td>
                      <Table.Td ta="right">{row.externalPeople}</Table.Td>
                      <Table.Td>
                        <Stack gap={4}>
                          <Group gap={4} wrap="wrap">
                            {row.diagnosis.checkHints.length > 0 ? (
                              row.diagnosis.checkHints.map((hint) => (
                                <Badge key={`${row.orderId}-${hint}`} size="xs" variant="light">
                                  {formatCauseLabel(hint)}
                                </Badge>
                              ))
                            ) : (
                              <Text size="xs" c="dimmed">
                                -
                              </Text>
                            )}
                          </Group>
                          <Text size="xs" c="dimmed">
                            {`Likely: ${row.diagnosis.likelyCauses.map((cause) => formatCauseLabel(cause)).join(", ")}`}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>{row.externalDate ?? row.omniFirstDate ?? "-"}</Table.Td>
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="light"
                          loading={ecwidFixLoadingOrderId === row.orderId}
                          disabled={
                            ecwidFixBulkLoading ||
                            (ecwidFixLoadingOrderId !== null && ecwidFixLoadingOrderId !== row.orderId) ||
                            !row.orderId
                          }
                          onClick={() => runFixOrderFromEcwid(row.orderId)}
                        >
                          Fix From Ecwid
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
};

export default BookingsSanityCheck;
