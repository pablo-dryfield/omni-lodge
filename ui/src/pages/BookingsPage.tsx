import { Suspense, lazy, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Accordion,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  HoverCard,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  TextInput,
  Text,
  Title,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { IconArrowLeft, IconArrowRight, IconCalendar, IconRefresh } from "@tabler/icons-react";
import dayjs, { Dayjs } from "dayjs";
import { useAppDispatch } from "../store/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { BookingsGrid } from "../components/BookingsGrid";
import type {
  BookingAddonDashboardRow,
  BookingCostsSummary,
  BookingCounterInsights,
  VenueCommissionCurrencyTotal,
  VenueCommissionVenueRow,
} from "../components/bookings/BookingsExecutiveDashboard";
import BookingsSanityCheck from "../components/bookings/BookingsSanityCheck";
import axiosInstance from "../utils/axiosInstance";
import { UnifiedOrder, UnifiedProduct } from "../store/bookingPlatformsTypes";
import { prepareBookingGrid, BookingGrid } from "../utils/prepareBookingGrid";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";

const DATE_FORMAT = "YYYY-MM-DD";
const BookingsExecutiveDashboard = lazy(() => import("../components/bookings/BookingsExecutiveDashboard"));

type ViewMode = "week" | "month";

type FetchStatus = "idle" | "loading" | "error" | "success";

type BookingFilter = "all" | "active" | "cancelled";
type SummaryDateField = "experience_date" | "source_received_at";
type SummaryMetricMode = "earnings" | "revenue" | "costs";
type SummaryDatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "last_7_days"
  | "last_14_days"
  | "last_2_weeks"
  | "this_month"
  | "last_month"
  | "this_year"
  | "last_year"
  | "all_time"
  | "custom";
type BookingsTab = "calendar" | "summary" | "emails" | "sanity";
type BookingsTabOption = BookingsTab | "manifest";
type ProductTypeOption = { value: string; label: string };
type BookingTabOption = { value: BookingsTabOption; label: string };

type BookingEmailSummary = {
  id: number;
  messageId: string;
  threadId: string | null;
  fromAddress: string | null;
  toAddresses: string | null;
  ccAddresses: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string | null;
  internalDate: string | null;
  ingestionStatus: string;
  failureReason: string | null;
};

type BookingEmailPreview = BookingEmailSummary & {
  previewText: string | null;
  textBody: string | null;
  htmlBody: string | null;
  htmlText: string | null;
  gmailQuery?: string | null;
  bookings?: Array<Record<string, unknown>>;
  bookingAddons?: Array<Record<string, unknown>>;
  bookingEvents?: Array<Record<string, unknown>>;
};

const EMAIL_STATUS_COLORS: Record<string, string> = {
  processed: "teal",
  pending: "orange",
  processing: "blue",
  ignored: "yellow",
  failed: "red",
  unknown: "gray",
};

const EMAIL_PAGE_SIZES = [50, 100, 250, 500, 1000];
const EMAIL_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "processed", label: "Processed" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "ignored", label: "Ignored" },
  { value: "failed", label: "Failed" },
];

const DEFAULT_EMAIL_FILTERS = {
  search: "",
  subject: "",
  from: "",
  to: "",
  status: "all",
  messageId: "",
  threadId: "",
  platformOrderId: "",
};

const DEFAULT_EMAIL_DATE_RANGE: [Date | null, Date | null] = [null, null];
const BOOKING_TAB_OPTIONS: BookingTabOption[] = [
  { value: "calendar", label: "Calendar" },
  { value: "manifest", label: "Manifest" },
  { value: "summary", label: "Summary" },
  { value: "emails", label: "Emails" },
  { value: "sanity", label: "Sanity Check" },
];

const parseEmailDateParam = (value?: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.toDate() : null;
};

const parseEmailPageSizeParam = (value?: string | null): number => {
  if (!value) {
    return EMAIL_PAGE_SIZES[0];
  }
  const parsed = Number.parseInt(value, 10);
  return EMAIL_PAGE_SIZES.includes(parsed) ? parsed : EMAIL_PAGE_SIZES[0];
};

const parseEmailPageParam = (value?: string | null): number => {
  if (!value) {
    return 1;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const parseEmailStatusParam = (value?: string | null): string => {
  if (!value) {
    return "all";
  }
  const normalized = value.trim().toLowerCase();
  return EMAIL_STATUS_OPTIONS.some((option) => option.value === normalized) ? normalized : "all";
};

const parseTabParam = (value?: string | null): BookingsTabOption | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "calendar" ||
    normalized === "summary" ||
    normalized === "emails" ||
    normalized === "sanity" ||
    normalized === "manifest"
  ) {
    return normalized as BookingsTabOption;
  }
  return null;
};

const parseSummaryDateFieldParam = (value?: string | null): SummaryDateField => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "source_received_at") {
    return "source_received_at";
  }
  return "experience_date";
};

const parseSummaryProductTypeParam = (value?: string | null): string => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return "all";
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "all";
  }
  return String(parsed);
};

const SUMMARY_DATE_PRESET_OPTIONS: Array<{ value: SummaryDatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_14_days", label: "Last 14 Days" },
  { value: "last_2_weeks", label: "Last 2 Weeks" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_year", label: "This Year" },
  { value: "last_year", label: "Last Year" },
  { value: "all_time", label: "All Time" },
  { value: "custom", label: "Custom" },
];

const parseSummaryDatePresetParam = (value?: string | null): SummaryDatePreset => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (SUMMARY_DATE_PRESET_OPTIONS.some((option) => option.value === normalized)) {
    return normalized as SummaryDatePreset;
  }
  return "this_month";
};

const parseSummaryCustomDateParam = (value?: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.toDate() : null;
};

const parseSummaryMetricModeParam = (value?: string | null): SummaryMetricMode => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "earnings" || normalized === "costs") {
    return normalized;
  }
  return "revenue";
};

const resolveEmailStatusColor = (value?: string | null): string => {
  if (!value) {
    return EMAIL_STATUS_COLORS.unknown;
  }
  const key = value.toLowerCase();
  return EMAIL_STATUS_COLORS[key] ?? EMAIL_STATUS_COLORS.unknown;
};

const formatEmailTimestamp = (value?: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : value;
};

type EmailFieldPopoverProps = {
  field: string;
  value?: string | null;
  fullWidth?: boolean;
  children: ReactNode;
};

const EmailFieldPopover = ({ field, value, fullWidth = true, children }: EmailFieldPopoverProps) => {
  const displayValue = value && String(value).trim() ? String(value) : "-";
  return (
    <HoverCard position="bottom-start" withArrow shadow="md" width={280} openDelay={200} closeDelay={150}>
      <HoverCard.Target>
        <Box style={fullWidth ? { display: "block", width: "100%" } : { display: "inline-block" }}>
          {children}
        </Box>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {field}
          </Text>
          <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {displayValue}
          </Text>
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
};

type EmailDiagnosticCheck = {
  label: string;
  passed: boolean;
  value?: string | null;
  phase: "canParse" | "parse";
};

type EmailDiagnosticGroup = {
  parser: string;
  canParse: boolean | null;
  parseMatched: boolean | null;
  checks: EmailDiagnosticCheck[];
};

type GmailQuerySegment = {
  label: string;
  matched: boolean;
};

type GmailQueryContext = {
  subject?: string | null;
  fromAddress?: string | null;
  toAddresses?: string | null;
};

const formatBookingFieldValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return dayjs(value).format("YYYY-MM-DD HH:mm");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const resolveEventValue = (event: Record<string, unknown>, primary: string, fallback: string): unknown => {
  if (event[primary] !== undefined) {
    return event[primary];
  }
  return event[fallback];
};

const normalizeGmailQuery = (query: string): string => {
  return query.replace(/\s+/g, " ").trim();
};

const stripGmailQueryOuterParens = (value: string): string => {
  let trimmed = value.trim();
  while (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < trimmed.length; i += 1) {
      const char = trimmed[i];
      if (char === "(") {
        depth += 1;
      } else if (char === ")") {
        depth -= 1;
        if (depth === 0 && i < trimmed.length - 1) {
          wrapsAll = false;
          break;
        }
      }
    }
    if (wrapsAll && depth === 0) {
      trimmed = trimmed.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return trimmed;
};

const splitGmailQueryOnOr = (value: string): string[] => {
  const normalized = normalizeGmailQuery(value);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === "(") {
      depth += 1;
    } else if (char === ")" && depth > 0) {
      depth -= 1;
    }
    if (depth === 0 && normalized.slice(i, i + 4).toUpperCase() === " OR ") {
      parts.push(normalized.slice(start, i).trim());
      start = i + 4;
      i += 3;
    }
  }
  const tail = normalized.slice(start).trim();
  if (tail) {
    parts.push(tail);
  }
  return parts.filter(Boolean);
};

const normalizeGmailQueryToken = (token: string): string => {
  const trimmed = token.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const matchesAnyToken = (value: string | null | undefined, tokens: string[]): boolean => {
  if (!value) {
    return false;
  }
  const source = value.toLowerCase();
  return tokens.some((token) => {
    const normalized = normalizeGmailQueryToken(token);
    if (!normalized) {
      return false;
    }
    return source.includes(normalized.toLowerCase());
  });
};

const evaluateGmailQuerySection = (section: string, context: GmailQueryContext): boolean => {
  const trimmed = stripGmailQueryOuterParens(section);
  const match = trimmed.match(/^(subject|from|to):(.+)$/i);
  if (!match) {
    return false;
  }
  const field = match[1].toLowerCase();
  const rawValue = stripGmailQueryOuterParens(match[2].trim());
  const tokens = splitGmailQueryOnOr(rawValue);
  if (tokens.length === 0) {
    return false;
  }
  if (field === "subject") {
    return matchesAnyToken(context.subject ?? null, tokens);
  }
  if (field === "from") {
    return matchesAnyToken(context.fromAddress ?? null, tokens);
  }
  if (field === "to") {
    return matchesAnyToken(context.toAddresses ?? null, tokens);
  }
  return false;
};

const buildGmailQuerySegments = (query: string, context: GmailQueryContext): GmailQuerySegment[] => {
  if (!query) {
    return [];
  }
  const normalized = stripGmailQueryOuterParens(query);
  const sections = splitGmailQueryOnOr(normalized);
  if (sections.length === 0) {
    return [];
  }
  return sections.map((section) => ({
    label: section,
    matched: evaluateGmailQuerySection(section, context),
  }));
};

const parseEmailDiagnostics = (failureReason?: string | null): EmailDiagnosticGroup[] | null => {
  if (!failureReason) {
    return null;
  }
  const marker = "Parser checks:";
  const markerIndex = failureReason.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const details = failureReason.slice(markerIndex + marker.length).trim();
  if (!details) {
    return null;
  }
  return details
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) {
        return {
          parser: line,
          canParse: null,
          parseMatched: null,
          checks: [],
        };
      }
      const parser = line.slice(0, colonIndex).trim();
      const remainder = line.slice(colonIndex + 1).trim();
      const canParseMatch = remainder.match(/canParse=(yes|no)/i);
      const parseMatch = remainder.match(/parse=(matched|no match)/i);
      const canParse = canParseMatch ? canParseMatch[1].toLowerCase() === "yes" : null;
      const parseMatched = parseMatch
        ? parseMatch[1].toLowerCase() === "matched"
        : null;

      const parseChecksBlock = (block: string, phase: "canParse" | "parse") => {
        return block
          .split(";")
          .map((token) => token.trim())
          .filter(Boolean)
          .map((token) => {
            const match = token.match(/^(.*?):\s*(yes|no)(?:\s*\((.+)\))?$/i);
            if (!match) {
              return null;
            }
            return {
              label: match[1].trim(),
              passed: match[2].toLowerCase() === "yes",
              value: match[3]?.trim() ?? null,
              phase,
            } as EmailDiagnosticCheck;
          })
          .filter((entry): entry is EmailDiagnosticCheck => Boolean(entry));
      };

      const checksStart = remainder.indexOf("checks:");
      const parseChecksStart = remainder.indexOf("parseChecks:");
      const checksBlock =
        checksStart !== -1
          ? remainder.slice(
              checksStart + "checks:".length,
              parseChecksStart !== -1 ? parseChecksStart : undefined,
            ).trim()
          : "";
      const parseChecksBlockRaw =
        parseChecksStart !== -1
          ? remainder.slice(parseChecksStart + "parseChecks:".length).trim()
          : "";

      const checks = [
        ...parseChecksBlock(checksBlock, "canParse"),
        ...parseChecksBlock(parseChecksBlockRaw, "parse"),
      ];

      return {
        parser,
        canParse,
        parseMatched,
        checks,
      };
    });
};

const filterOrdersByStatus = (orders: UnifiedOrder[], filter: BookingFilter): UnifiedOrder[] => {
  if (filter === "all") {
    return orders;
  }
  if (filter === "cancelled") {
    return orders.filter((order) => order.status === "cancelled");
  }
  return orders.filter((order) => {
    const quantity = Number.isFinite(order.quantity) ? order.quantity : 0;
    return order.status !== "cancelled" && quantity > 0;
  });
};

const createDateArray = (start: Dayjs, end: Dayjs): string[] => {
  const values: string[] = [];
  let cursor = start.startOf("day");

  while (cursor.isBefore(end, "day") || cursor.isSame(end, "day")) {
    values.push(cursor.format(DATE_FORMAT));
    cursor = cursor.add(1, "day");
  }

  return values;
};

const deriveErrorMessage = (error: unknown): string => {
  if (!error) {
    return "Unknown error while loading bookings.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unable to load bookings right now.";
};

const BOOKINGS_MODULE = "booking-management";

const BookingsPage = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [activeTab, setActiveTab] = useState<BookingsTab>("calendar");
  const [mobileTabsMenuOpen, setMobileTabsMenuOpen] = useState<string | null>(null);
  const [summaryDateField, setSummaryDateField] = useState<SummaryDateField>("experience_date");
  const [summaryMetricMode, setSummaryMetricMode] = useState<SummaryMetricMode>("revenue");
  const [summaryDatePreset, setSummaryDatePreset] = useState<SummaryDatePreset>("this_month");
  const [summaryCustomDateRange, setSummaryCustomDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [summaryProductTypeFilter, setSummaryProductTypeFilter] = useState<string>("all");
  const [summaryProductTypeOptions, setSummaryProductTypeOptions] = useState<ProductTypeOption[]>([
    { value: "all", label: "All Product Types" },
  ]);
  const [rangeAnchor, setRangeAnchor] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [calendarScrollDate, setCalendarScrollDate] = useState<string | null>(null);
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [bookingAddons, setBookingAddons] = useState<BookingAddonDashboardRow[]>([]);
  const [addonCatalog, setAddonCatalog] = useState<Array<{ id: number; name: string; basePrice: number }>>([]);
  const [counterInsights, setCounterInsights] = useState<BookingCounterInsights | null>(null);
  const [venueCommissionTotals, setVenueCommissionTotals] = useState<VenueCommissionCurrencyTotal[] | null>(null);
  const [venueCommissionVenues, setVenueCommissionVenues] = useState<VenueCommissionVenueRow[] | null>(null);
  const [costsSummary, setCostsSummary] = useState<BookingCostsSummary | null>(null);
  const [calendarStatusFilter, setCalendarStatusFilter] = useState<BookingFilter>("active");
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<FetchStatus>("idle");
  const [reloadToken, setReloadToken] = useState(0);
  const [emailRecords, setEmailRecords] = useState<BookingEmailSummary[]>([]);
  const [emailStatus, setEmailStatus] = useState<FetchStatus>("idle");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailTotal, setEmailTotal] = useState<number | null>(null);
  const [emailPage, setEmailPage] = useState(1);
  const [emailPageSize, setEmailPageSize] = useState(EMAIL_PAGE_SIZES[0]);
  const [emailFilters, setEmailFilters] = useState(() => ({ ...DEFAULT_EMAIL_FILTERS }));
  const [emailDateRange, setEmailDateRange] = useState<[Date | null, Date | null]>(() => [
    ...DEFAULT_EMAIL_DATE_RANGE,
  ]);
  const [emailPreview, setEmailPreview] = useState<BookingEmailPreview | null>(null);
  const [emailPreviewOpen, setEmailPreviewOpen] = useState(false);
  const [emailPreviewLoading, setEmailPreviewLoading] = useState(false);
  const [emailPreviewError, setEmailPreviewError] = useState<string | null>(null);
  const [emailPreviewMessageId, setEmailPreviewMessageId] = useState<string | null>(null);
  const [emailReprocessId, setEmailReprocessId] = useState<string | null>(null);
  const [emailReprocessError, setEmailReprocessError] = useState<string | null>(null);
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(() => new Set());
  const [bulkReprocessMode, setBulkReprocessMode] = useState<"range" | "selected" | null>(null);
  const [bulkReprocessLoading, setBulkReprocessLoading] = useState(false);
  const [bulkReprocessError, setBulkReprocessError] = useState<string | null>(null);
  const [backfillConfirmOpen, setBackfillConfirmOpen] = useState(false);
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState(false);

  const suppressEmailUrlSyncRef = useRef(false);
  const suppressEmailPreviewSyncRef = useRef(false);
  const didInitialCalendarTodayScrollRef = useRef(false);

  const [searchParams, setSearchParams] = useSearchParams();

  const modulePermissions = useModuleAccess(BOOKINGS_MODULE);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const isTablet = useMediaQuery(`(max-width: ${theme.breakpoints.md})`);
  const [debouncedEmailFilters] = useDebouncedValue(emailFilters, 400);
  const [debouncedEmailDateRange] = useDebouncedValue(emailDateRange, 400);
  const emailOffset = (emailPage - 1) * emailPageSize;
  const emailHasDateRange = Boolean(debouncedEmailDateRange[0] || debouncedEmailDateRange[1]);
  const emailHasSearchFilters = Boolean(
    debouncedEmailFilters.search ||
      debouncedEmailFilters.subject ||
      debouncedEmailFilters.from ||
      debouncedEmailFilters.to ||
      debouncedEmailFilters.messageId ||
      debouncedEmailFilters.threadId ||
      debouncedEmailFilters.platformOrderId ||
      (debouncedEmailFilters.status && debouncedEmailFilters.status !== "all"),
  );
  const emailIncludeTotal = emailHasDateRange || emailHasSearchFilters;

  const emailPreviewParam = searchParams.get("emailPreview")?.trim() ?? "";
  const emailHasUrlPreview = Boolean(emailPreviewParam);

  const openManifestForCurrentDate = useCallback(() => {
    const params = new URLSearchParams();
    params.set("date", dayjs().format(DATE_FORMAT));
    navigate(`/bookings/manifest?${params.toString()}`);
  }, [navigate]);

  const handleBookingsTabChange = useCallback(
    (value: string | null) => {
      if (value === "manifest") {
        openManifestForCurrentDate();
        return;
      }
      setActiveTab((value as BookingsTab) ?? "calendar");
    },
    [openManifestForCurrentDate],
  );

  const handleCloseEmailPreview = useCallback(() => {
    suppressEmailPreviewSyncRef.current = true;
    setEmailPreviewOpen(false);
    setEmailPreview(null);
    setEmailPreviewError(null);
    setEmailPreviewLoading(false);
    setEmailPreviewMessageId(null);
  }, []);

  const handleOpenEmailPreview = useCallback(async (messageId: string) => {
    if (!messageId) {
      return;
    }
    setEmailPreviewOpen(true);
    setEmailPreview(null);
    setEmailPreviewError(null);
    setEmailPreviewLoading(true);
    setEmailPreviewMessageId(messageId);

    try {
      const response = await axiosInstance.get(`/bookings/emails/${encodeURIComponent(messageId)}/preview`, {
        withCredentials: true,
      });
      setEmailPreview(response.data as BookingEmailPreview);
    } catch (error) {
      setEmailPreviewError(deriveErrorMessage(error));
    } finally {
      setEmailPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    dispatch(navigateToPage(title));
  }, [dispatch, title]);

  useEffect(() => {
    const urlTab = parseTabParam(searchParams.get("tab"));
    const nextTab = emailPreviewParam && (!urlTab || urlTab === "emails") ? "emails" : urlTab;
    if (!nextTab) {
      return;
    }
    if (nextTab === "manifest") {
      openManifestForCurrentDate();
      return;
    }
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [emailPreviewParam, openManifestForCurrentDate, searchParams]);

  useEffect(() => {
    const nextDateField = parseSummaryDateFieldParam(searchParams.get("summaryDateField"));
    setSummaryDateField((prev) => (prev === nextDateField ? prev : nextDateField));
  }, [searchParams]);

  useEffect(() => {
    const nextProductType = parseSummaryProductTypeParam(searchParams.get("summaryProductType"));
    setSummaryProductTypeFilter((prev) => (prev === nextProductType ? prev : nextProductType));
  }, [searchParams]);

  useEffect(() => {
    const nextPreset = parseSummaryDatePresetParam(searchParams.get("summaryPreset"));
    setSummaryDatePreset((prev) => (prev === nextPreset ? prev : nextPreset));
  }, [searchParams]);

  useEffect(() => {
    const nextCustomRange: [Date | null, Date | null] = [
      parseSummaryCustomDateParam(searchParams.get("summaryStart")),
      parseSummaryCustomDateParam(searchParams.get("summaryEnd")),
    ];
    setSummaryCustomDateRange((prev) => {
      const sameRange =
        (prev[0]?.getTime() ?? null) === (nextCustomRange[0]?.getTime() ?? null) &&
        (prev[1]?.getTime() ?? null) === (nextCustomRange[1]?.getTime() ?? null);
      return sameRange ? prev : nextCustomRange;
    });
  }, [searchParams]);

  useEffect(() => {
    const nextMetricMode = parseSummaryMetricModeParam(searchParams.get("summaryMetric"));
    setSummaryMetricMode((prev) => (prev === nextMetricMode ? prev : nextMetricMode));
  }, [searchParams]);

  useEffect(() => {
    const nextFilters = {
      search: searchParams.get("emailSearch") ?? "",
      subject: searchParams.get("emailSubject") ?? "",
      from: searchParams.get("emailFrom") ?? "",
      to: searchParams.get("emailTo") ?? "",
      status: parseEmailStatusParam(searchParams.get("emailStatus")),
      messageId: searchParams.get("emailMessageId") ?? "",
      threadId: searchParams.get("emailThreadId") ?? "",
      platformOrderId: searchParams.get("emailPlatformOrderId") ?? "",
    };
    suppressEmailUrlSyncRef.current = true;
    setEmailFilters((prev) => {
      const filtersMatch = (Object.keys(nextFilters) as Array<keyof typeof nextFilters>).every(
        (key) => nextFilters[key] === prev[key],
      );
      return filtersMatch ? prev : nextFilters;
    });

    const nextDateRange: [Date | null, Date | null] = [
      parseEmailDateParam(searchParams.get("emailStart")),
      parseEmailDateParam(searchParams.get("emailEnd")),
    ];
    setEmailDateRange((prev) => {
      const datesMatch =
        (prev[0]?.getTime() ?? null) === (nextDateRange[0]?.getTime() ?? null) &&
        (prev[1]?.getTime() ?? null) === (nextDateRange[1]?.getTime() ?? null);
      return datesMatch ? prev : nextDateRange;
    });

    const nextPageSize = parseEmailPageSizeParam(searchParams.get("emailPageSize"));
    setEmailPageSize((prev) => (prev === nextPageSize ? prev : nextPageSize));

    const nextPage = parseEmailPageParam(searchParams.get("emailPage"));
    setEmailPage((prev) => (prev === nextPage ? prev : nextPage));
  }, [searchParams]);

  useEffect(() => {
    if (!emailHasUrlPreview && suppressEmailPreviewSyncRef.current) {
      suppressEmailPreviewSyncRef.current = false;
    }
  }, [emailHasUrlPreview]);

  useEffect(() => {
    if (suppressEmailPreviewSyncRef.current) {
      return;
    }
    if (!emailHasUrlPreview) {
      return;
    }
    if (activeTab !== "emails") {
      return;
    }
    if (emailPreviewParam && (!emailPreviewOpen || emailPreviewMessageId !== emailPreviewParam)) {
      handleOpenEmailPreview(emailPreviewParam);
    }
  }, [
    activeTab,
    emailHasUrlPreview,
    emailPreviewMessageId,
    emailPreviewOpen,
    emailPreviewParam,
    handleCloseEmailPreview,
    handleOpenEmailPreview,
  ]);

  useEffect(() => {
    if (activeTab !== "emails" && emailPreviewOpen) {
      handleCloseEmailPreview();
    }
  }, [activeTab, emailPreviewOpen, handleCloseEmailPreview]);

  useEffect(() => {
    if (suppressEmailUrlSyncRef.current) {
      suppressEmailUrlSyncRef.current = false;
      return;
    }
    const nextParams = new URLSearchParams(searchParams);

    if (activeTab === "calendar") {
      nextParams.delete("tab");
    } else {
      nextParams.set("tab", activeTab);
    }

    const setOptionalParam = (key: string, value?: string | null) => {
      if (!value) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    };

    setOptionalParam(
      "summaryDateField",
      summaryDateField !== "experience_date" ? summaryDateField : null,
    );
    setOptionalParam(
      "summaryProductType",
      summaryProductTypeFilter !== "all" ? summaryProductTypeFilter : null,
    );
    setOptionalParam(
      "summaryPreset",
      summaryDatePreset !== "this_month" ? summaryDatePreset : null,
    );
    setOptionalParam(
      "summaryMetric",
      summaryMetricMode !== "revenue" ? summaryMetricMode : null,
    );
    setOptionalParam(
      "summaryStart",
      summaryDatePreset === "custom" && summaryCustomDateRange[0]
        ? dayjs(summaryCustomDateRange[0]).format("YYYY-MM-DD")
        : null,
    );
    setOptionalParam(
      "summaryEnd",
      summaryDatePreset === "custom" && summaryCustomDateRange[1]
        ? dayjs(summaryCustomDateRange[1]).format("YYYY-MM-DD")
        : null,
    );

    setOptionalParam("emailSearch", emailFilters.search || null);
    setOptionalParam("emailSubject", emailFilters.subject || null);
    setOptionalParam("emailFrom", emailFilters.from || null);
    setOptionalParam("emailTo", emailFilters.to || null);
    setOptionalParam(
      "emailStatus",
      emailFilters.status && emailFilters.status !== "all" ? emailFilters.status : null,
    );
    setOptionalParam("emailMessageId", emailFilters.messageId || null);
    setOptionalParam("emailThreadId", emailFilters.threadId || null);
    setOptionalParam("emailPlatformOrderId", emailFilters.platformOrderId || null);

    const startValue = emailDateRange[0] ? dayjs(emailDateRange[0]).format("YYYY-MM-DD") : null;
    const endValue = emailDateRange[1] ? dayjs(emailDateRange[1]).format("YYYY-MM-DD") : null;
    setOptionalParam("emailStart", startValue);
    setOptionalParam("emailEnd", endValue);

    setOptionalParam(
      "emailPageSize",
      emailPageSize !== EMAIL_PAGE_SIZES[0] ? String(emailPageSize) : null,
    );
    setOptionalParam("emailPage", emailPage > 1 ? String(emailPage) : null);

    let nextPreviewParam: string | null = null;
    if (suppressEmailPreviewSyncRef.current) {
      nextPreviewParam = null;
    } else if (emailPreviewOpen && emailPreviewMessageId) {
      nextPreviewParam = emailPreviewMessageId;
    } else if (emailHasUrlPreview) {
      nextPreviewParam = emailPreviewParam;
    }
    setOptionalParam("emailPreview", nextPreviewParam);

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    activeTab,
    summaryDateField,
    summaryDatePreset,
    summaryMetricMode,
    summaryCustomDateRange,
    summaryProductTypeFilter,
    emailDateRange,
    emailFilters,
    emailPage,
    emailPageSize,
    emailHasUrlPreview,
    emailPreviewMessageId,
    emailPreviewOpen,
    emailPreviewParam,
    searchParams,
    setSearchParams,
  ]);

  const rangeStart = useMemo(() => {
    return viewMode === "week"
      ? rangeAnchor.startOf("day")
      : rangeAnchor.startOf("month");
  }, [rangeAnchor, viewMode]);

  const rangeEnd = useMemo(() => {
    return viewMode === "week"
      ? rangeStart.add(6, "day")
      : rangeStart.endOf("month");
  }, [rangeStart, viewMode]);

  const dateRange = useMemo(() => createDateArray(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const monthYearLabel = useMemo(() => rangeStart.format("MMMM YYYY"), [rangeStart]);
  const summaryPresetRange = useMemo(() => {
    const today = dayjs().startOf("day");
    const thisMonthStart = today.startOf("month");
    const thisMonthEnd = today.endOf("month");
    const thisWeekStart = today.startOf("week");
    const thisWeekEnd = today.endOf("week");
    switch (summaryDatePreset) {
      case "today":
        return { start: today, end: today.endOf("day") };
      case "yesterday": {
        const yesterday = today.subtract(1, "day");
        return { start: yesterday, end: yesterday.endOf("day") };
      }
      case "this_week":
        return { start: thisWeekStart, end: thisWeekEnd };
      case "last_week": {
        const lastWeekStart = thisWeekStart.subtract(1, "week").startOf("week");
        return { start: lastWeekStart, end: lastWeekStart.endOf("week") };
      }
      case "last_7_days":
        return { start: today.subtract(6, "day"), end: today.endOf("day") };
      case "last_14_days":
        return { start: today.subtract(13, "day"), end: today.endOf("day") };
      case "last_2_weeks": {
        const lastTwoWeeksEnd = thisWeekStart.subtract(1, "day").endOf("day");
        const lastTwoWeeksStart = thisWeekStart.subtract(2, "week").startOf("day");
        return { start: lastTwoWeeksStart, end: lastTwoWeeksEnd };
      }
      case "last_month": {
        const lastMonthStart = today.subtract(1, "month").startOf("month");
        return { start: lastMonthStart, end: lastMonthStart.endOf("month") };
      }
      case "this_year": {
        const thisYearStart = today.startOf("year");
        return { start: thisYearStart, end: thisYearStart.endOf("year") };
      }
      case "last_year": {
        const lastYearStart = today.subtract(1, "year").startOf("year");
        return { start: lastYearStart, end: lastYearStart.endOf("year") };
      }
      case "all_time": {
        const allTimeStart = dayjs("2000-01-01").startOf("day");
        return { start: allTimeStart, end: today.endOf("day") };
      }
      case "custom": {
        const customStart = summaryCustomDateRange[0] ? dayjs(summaryCustomDateRange[0]).startOf("day") : null;
        const customEnd = summaryCustomDateRange[1] ? dayjs(summaryCustomDateRange[1]).endOf("day") : null;
        if (customStart && customEnd && !customEnd.isBefore(customStart, "day")) {
          return { start: customStart, end: customEnd };
        }
        return { start: thisMonthStart, end: thisMonthEnd };
      }
      case "this_month":
      default:
        return { start: thisMonthStart, end: thisMonthEnd };
    }
  }, [summaryCustomDateRange, summaryDatePreset]);
  const summaryRangeStart = summaryPresetRange.start;
  const summaryRangeEnd = summaryPresetRange.end;
  const effectiveRangeStart = activeTab === "summary" ? summaryRangeStart : rangeStart;
  const effectiveRangeEnd = activeTab === "summary" ? summaryRangeEnd : rangeEnd;
  const bookingsDateField: SummaryDateField = activeTab === "summary" ? summaryDateField : "experience_date";

  const selectedDateKey = selectedDate.format(DATE_FORMAT);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);

    if (mode === "week") {
      const newAnchor = selectedDate.startOf("day");
      setRangeAnchor(newAnchor);
    } else {
      const newAnchor = selectedDate.startOf("month");
      setRangeAnchor(newAnchor);
    }
  };

  const handleShiftRange = (direction: number) => {
    if (viewMode === "week") {
      const newAnchor = rangeStart.add(direction * 7, "day");
      const newRangeEnd = newAnchor.add(6, "day");
      setRangeAnchor(newAnchor);

      if (selectedDate.isBefore(newAnchor, "day") || selectedDate.isAfter(newRangeEnd, "day")) {
        setSelectedDate(newAnchor);
      }
    } else {
      const newAnchor = rangeStart.add(direction, "month");
      setRangeAnchor(newAnchor);
      setSelectedDate((prev) => prev.add(direction, "month").startOf("day"));
    }
  };

  const handleGoToToday = useCallback(() => {
    const today = dayjs().startOf("day");
    if (!selectedDate.isSame(today, "day")) {
      setSelectedDate(today);
    }
    if (viewMode === "week") {
      if (!rangeAnchor.isSame(today, "day")) {
        setRangeAnchor(today);
      }
    } else {
      const monthAnchor = today.startOf("month");
      if (!rangeAnchor.isSame(monthAnchor, "month")) {
        setRangeAnchor(monthAnchor);
      }
    }
    setCalendarScrollDate(today.format(DATE_FORMAT));
  }, [rangeAnchor, selectedDate, viewMode]);

  useEffect(() => {
    if (didInitialCalendarTodayScrollRef.current) {
      return;
    }
    if (activeTab !== "calendar") {
      return;
    }
    didInitialCalendarTodayScrollRef.current = true;
    handleGoToToday();
  }, [activeTab, handleGoToToday]);

  const handleReload = async () => {
    if (ingestStatus === "loading") {
      return;
    }
    setIngestStatus("loading");
    setErrorMessage(null);
    try {
      await axiosInstance.post("/bookings/ingest-emails", {}, { withCredentials: true });
      setFetchStatus("loading");
      setReloadToken((token) => token + 1);
      setIngestStatus("success");
    } catch (error) {
      setIngestStatus("error");
      setErrorMessage(deriveErrorMessage(error));
    }
  };

  const handleOpenManifest = useCallback(
    (target: { productId: string; productName: string; date: string; time: string | null }, orders: UnifiedOrder[]) => {
      const params = new URLSearchParams({
        date: target.date,
        productId: target.productId,
      });
      if (target.time) {
        params.set("time", target.time);
      }
      params.set("productName", target.productName);

      navigate(`/bookings/manifest?${params.toString()}`, { state: { orders } });
    },
    [navigate],
  );

  const handleEmailFilterValue = (field: keyof typeof DEFAULT_EMAIL_FILTERS, value: string) => {
    setEmailFilters((prev) => ({ ...prev, [field]: value }));
    setEmailPage(1);
  };

  const handleClearEmailFilters = () => {
    setEmailFilters({ ...DEFAULT_EMAIL_FILTERS });
    setEmailDateRange([...DEFAULT_EMAIL_DATE_RANGE]);
    setEmailPage(1);
  };

  const handleEmailPageSizeChange = (value: string | null) => {
    const nextSize = value ? Number.parseInt(value, 10) : EMAIL_PAGE_SIZES[0];
    setEmailPageSize(Number.isFinite(nextSize) ? nextSize : EMAIL_PAGE_SIZES[0]);
    setEmailPage(1);
  };

  const handleReprocessEmail = async (messageId: string) => {
    if (!messageId || emailReprocessId) {
      return;
    }
    setEmailReprocessId(messageId);
    setEmailReprocessError(null);

    try {
      await axiosInstance.post(`/bookings/emails/${encodeURIComponent(messageId)}/reprocess`, {}, { withCredentials: true });
      setReloadToken((token) => token + 1);
    } catch (error) {
      setEmailReprocessError(deriveErrorMessage(error));
    } finally {
      setEmailReprocessId(null);
    }
  };

  const handleToggleEmailSelection = useCallback((messageId: string) => {
    setSelectedEmailIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const handleSelectAllEmailPage = useCallback(
    (checked: boolean) => {
      setSelectedEmailIds((prev) => {
        const next = new Set(prev);
        emailRecords.forEach((email) => {
          if (!email.messageId) {
            return;
          }
          if (checked) {
            next.add(email.messageId);
          } else {
            next.delete(email.messageId);
          }
        });
        return next;
      });
    },
    [emailRecords],
  );

  const handleClearEmailSelection = useCallback(() => {
    setSelectedEmailIds(new Set());
  }, []);

  const handleOpenBulkReprocess = (mode: "range" | "selected") => {
    setBulkReprocessMode(mode);
    setBulkReprocessError(null);
  };

  const handleCloseBulkReprocess = () => {
    if (bulkReprocessLoading) {
      return;
    }
    setBulkReprocessMode(null);
  };

  const handleConfirmBulkReprocess = async () => {
    if (!bulkReprocessMode || bulkReprocessLoading) {
      return;
    }
    const [startDate, endDate] = emailDateRange;
    const payload =
      bulkReprocessMode === "selected"
        ? { messageIds: Array.from(selectedEmailIds) }
        : {
            pickupFrom: startDate ? dayjs(startDate).format("YYYY-MM-DD") : undefined,
            pickupTo: endDate ? dayjs(endDate).format("YYYY-MM-DD") : undefined,
          };
    setBulkReprocessLoading(true);
    setBulkReprocessError(null);
    try {
      await axiosInstance.post("/bookings/emails/reprocess", payload, { withCredentials: true });
      setReloadToken((token) => token + 1);
      if (bulkReprocessMode === "selected") {
        setSelectedEmailIds(new Set());
      }
      setBulkReprocessMode(null);
    } catch (error) {
      setBulkReprocessError(deriveErrorMessage(error));
    } finally {
      setBulkReprocessLoading(false);
    }
  };

  const handleOpenBackfill = () => {
    setBackfillConfirmOpen(true);
    setBackfillError(null);
  };

  const handleCloseBackfill = () => {
    if (backfillLoading) {
      return;
    }
    setBackfillConfirmOpen(false);
  };

  const handleConfirmBackfill = async () => {
    if (backfillLoading) {
      return;
    }
    const [startDate, endDate] = emailDateRange;
    if (!startDate && !endDate) {
      setBackfillError("Select a received date range first.");
      return;
    }
    setBackfillLoading(true);
    setBackfillError(null);
    try {
      await axiosInstance.post(
        "/bookings/emails/backfill",
        {
          pickupFrom: startDate ? dayjs(startDate).format("YYYY-MM-DD") : undefined,
          pickupTo: endDate ? dayjs(endDate).format("YYYY-MM-DD") : undefined,
        },
        { withCredentials: true },
      );
      setBackfillConfirmOpen(false);
    } catch (error) {
      setBackfillError(deriveErrorMessage(error));
    } finally {
      setBackfillLoading(false);
    }
  };

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) {
      return;
    }
    if (activeTab !== "summary") {
      return;
    }

    const controller = new AbortController();

    const fetchProductTypes = async () => {
      try {
        const response = await axiosInstance.get("/productTypes", {
          signal: controller.signal,
          withCredentials: true,
        });
        const rows: Array<{ id?: unknown; name?: unknown }> = Array.isArray(response.data?.[0]?.data)
          ? (response.data[0].data as Array<{ id?: unknown; name?: unknown }>)
          : [];
        const options = rows
          .map((row) => {
            const id = Number(row?.id);
            const name = String(row?.name ?? "").trim();
            if (!Number.isFinite(id) || id <= 0 || !name) {
              return null;
            }
            return { value: String(id), label: name } satisfies ProductTypeOption;
          })
          .filter((row): row is ProductTypeOption => row !== null)
          .sort((a: ProductTypeOption, b: ProductTypeOption) => a.label.localeCompare(b.label));
        setSummaryProductTypeOptions([{ value: "all", label: "All Product Types" }, ...options]);
      } catch {
        if (!controller.signal.aborted) {
          setSummaryProductTypeOptions([{ value: "all", label: "All Product Types" }]);
        }
      }
    };

    fetchProductTypes();

    return () => {
      controller.abort();
    };
  }, [modulePermissions.ready, modulePermissions.canView, activeTab]);

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) {
      return;
    }
    if (activeTab !== "calendar" && activeTab !== "summary") {
      return;
    }

    const controller = new AbortController();
    const startIso = effectiveRangeStart.startOf("day").format("YYYY-MM-DD");
    const endIso = effectiveRangeEnd.endOf("day").format("YYYY-MM-DD");

    const fetchOrders = async () => {
      setFetchStatus("loading");
      setErrorMessage(null);
      setBookingAddons([]);
      setAddonCatalog([]);
      setCounterInsights(null);
      setVenueCommissionTotals(null);
      setVenueCommissionVenues(null);
      setCostsSummary(null);

      try {
        const summaryTabActive = activeTab === "summary";
        const venueSummaryPromise = summaryTabActive
          ? axiosInstance
              .get("/venueNumbers/summary", {
                params: {
                  period: "custom",
                  startDate: startIso,
                  endDate: endIso,
                },
                signal: controller.signal,
                withCredentials: true,
              })
              .catch(() => null)
          : Promise.resolve(null);
        const paysSummaryPromise = summaryTabActive
          ? axiosInstance
              .get("/reports/getCommissionByDateRange", {
                params: {
                  startDate: startIso,
                  endDate: endIso,
                  scope: "all",
                },
                signal: controller.signal,
                withCredentials: true,
              })
              .catch(() => null)
          : Promise.resolve(null);
        const response = await axiosInstance.get("/bookings", {
          params: {
            pickupFrom: startIso,
            pickupTo: endIso,
            dateField: bookingsDateField,
            productTypeId:
              activeTab === "summary" && summaryProductTypeFilter !== "all"
                ? summaryProductTypeFilter
                : undefined,
            limit: 200,
          },
          signal: controller.signal,
            withCredentials: true,
          });
        const productsPayload = Array.isArray(response.data?.products) ? response.data.products : [];
        const ordersPayload = Array.isArray(response.data?.orders) ? response.data.orders : [];
        const bookingAddonsPayload = Array.isArray(response.data?.bookingAddons) ? response.data.bookingAddons : [];
        const addonCatalogPayload = Array.isArray(response.data?.addonCatalog) ? response.data.addonCatalog : [];
        const counterInsightsPayload =
          response.data?.counterInsights && typeof response.data.counterInsights === "object"
            ? response.data.counterInsights
            : null;
        const venueSummaryResponse = await venueSummaryPromise;
        const paysSummaryResponse = await paysSummaryPromise;
        const venueSummaryRoot =
          Array.isArray(venueSummaryResponse?.data) && venueSummaryResponse?.data[0]
            ? venueSummaryResponse.data[0]
            : null;
        const venueSummaryData = venueSummaryRoot && typeof venueSummaryRoot === "object"
          ? (venueSummaryRoot as { data?: unknown }).data
          : null;
        const venueSummary =
          Array.isArray(venueSummaryData) && venueSummaryData.length > 0
            ? venueSummaryData[0]
            : venueSummaryData;
        const venueTotalsRaw =
          venueSummary && typeof venueSummary === "object"
            ? (venueSummary as { totalsByCurrency?: unknown }).totalsByCurrency
            : null;
        const venueRowsRaw =
          venueSummary && typeof venueSummary === "object"
            ? (venueSummary as { venues?: unknown }).venues
            : null;
        const venueTotalsPayload: VenueCommissionCurrencyTotal[] | null = Array.isArray(venueTotalsRaw)
          ? venueTotalsRaw.reduce<VenueCommissionCurrencyTotal[]>((acc, row) => {
              if (!row || typeof row !== "object") {
                return acc;
              }
              const raw = row as Record<string, unknown>;
              acc.push({
                currency: String(raw.currency ?? "PLN").toUpperCase(),
                receivable: Number(raw.receivable ?? 0),
                receivableCollected: Number(raw.receivableCollected ?? 0),
                receivableOutstanding: Number(raw.receivableOutstanding ?? 0),
                payable: Number(raw.payable ?? 0),
                payableCollected: Number(raw.payableCollected ?? 0),
                payableOutstanding: Number(raw.payableOutstanding ?? 0),
              });
              return acc;
            }, [])
          : null;
        const venueRowsPayload: VenueCommissionVenueRow[] | null = Array.isArray(venueRowsRaw)
          ? venueRowsRaw.reduce<VenueCommissionVenueRow[]>((acc, row) => {
              if (!row || typeof row !== "object") {
                return acc;
              }
              const raw = row as Record<string, unknown>;
              acc.push({
                venueId: raw.venueId == null ? null : Number(raw.venueId),
                venueName: String(raw.venueName ?? "").trim() || "Unknown Venue",
                currency: String(raw.currency ?? "PLN").toUpperCase(),
                receivable: Number(raw.receivable ?? 0),
                receivableCollected: Number(raw.receivableCollected ?? 0),
                receivableOutstanding: Number(raw.receivableOutstanding ?? 0),
                totalPeople: Number(raw.totalPeople ?? 0),
              });
              return acc;
            }, [])
          : null;

        const paysRowsRaw =
          Array.isArray(paysSummaryResponse?.data) && paysSummaryResponse?.data[0]
            ? (paysSummaryResponse.data[0] as { data?: unknown }).data
            : null;
        const paysRows = Array.isArray(paysRowsRaw) ? (paysRowsRaw as Array<Record<string, unknown>>) : [];
        const staffPaymentsTotal = paysRows.reduce((sum, item) => {
          const dueAmount = Number(item?.dueAmount);
          if (Number.isFinite(dueAmount)) {
            return sum + dueAmount;
          }
          const totalPayout = Number(item?.totalPayout);
          if (Number.isFinite(totalPayout)) {
            return sum + totalPayout;
          }
          const totalCommission = Number(item?.totalCommission);
          return sum + (Number.isFinite(totalCommission) ? totalCommission : 0);
        }, 0);
        const venueTotalsForCosts = venueTotalsPayload ?? [];
        const openBarPayoutsTotal = venueTotalsForCosts.reduce((sum, row) => {
          const amount = Number(row.payable ?? 0);
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0);

        setProducts(productsPayload as UnifiedProduct[]);
        setOrders(ordersPayload as UnifiedOrder[]);
        setBookingAddons(bookingAddonsPayload as BookingAddonDashboardRow[]);
        setAddonCatalog(
          addonCatalogPayload
            .map((row: unknown) => {
              const raw = row as Record<string, unknown>;
              const id = Number(raw.id);
              const name = String(raw.name ?? "").trim();
              const basePrice = Number(raw.basePrice ?? 0);
              if (!Number.isFinite(id) || id <= 0 || !name) {
                return null;
              }
              return {
                id,
                name,
                basePrice: Number.isFinite(basePrice) ? basePrice : 0,
              };
            })
            .filter(
              (row: { id: number; name: string; basePrice: number } | null): row is { id: number; name: string; basePrice: number } =>
                row !== null,
            ),
        );
        setCounterInsights(counterInsightsPayload as BookingCounterInsights | null);
        setVenueCommissionTotals(summaryTabActive ? venueTotalsPayload : null);
        setVenueCommissionVenues(summaryTabActive ? venueRowsPayload : null);
        setCostsSummary(
          summaryTabActive
            ? {
                currency: "PLN",
                openBarPayouts: openBarPayoutsTotal,
                staffPayments: staffPaymentsTotal,
                miscellaneous: 3400,
              }
            : null,
        );
        setFetchStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setFetchStatus("error");
        setErrorMessage(deriveErrorMessage(error));
        setAddonCatalog([]);
        setVenueCommissionTotals(null);
        setVenueCommissionVenues(null);
        setCostsSummary(null);
      }
    };

    fetchOrders();

    return () => {
      controller.abort();
    };
  }, [
    modulePermissions.ready,
    modulePermissions.canView,
    effectiveRangeStart,
    effectiveRangeEnd,
    bookingsDateField,
    activeTab,
    summaryProductTypeFilter,
    reloadToken,
  ]);

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) {
      return;
    }
    if (activeTab !== "emails") {
      return;
    }

    const controller = new AbortController();
    const [emailStart, emailEnd] = debouncedEmailDateRange;
    const startIso = emailStart ? dayjs(emailStart).startOf("day").format("YYYY-MM-DD") : undefined;
    const endIso = emailEnd ? dayjs(emailEnd).endOf("day").format("YYYY-MM-DD") : undefined;

    const fetchEmails = async () => {
      setEmailStatus("loading");
      setEmailError(null);
      setEmailTotal(null);

      try {
        const response = await axiosInstance.get("/bookings/emails", {
          params: {
            ...(startIso ? { pickupFrom: startIso } : {}),
            ...(endIso ? { pickupTo: endIso } : {}),
            limit: emailPageSize,
            offset: emailOffset,
            includeTotal: emailIncludeTotal,
            search: debouncedEmailFilters.search || undefined,
            subject: debouncedEmailFilters.subject || undefined,
            from: debouncedEmailFilters.from || undefined,
            to: debouncedEmailFilters.to || undefined,
            messageId: debouncedEmailFilters.messageId || undefined,
            threadId: debouncedEmailFilters.threadId || undefined,
            platformOrderId: debouncedEmailFilters.platformOrderId || undefined,
            status:
              debouncedEmailFilters.status && debouncedEmailFilters.status !== "all"
                ? debouncedEmailFilters.status
                : undefined,
          },
          signal: controller.signal,
          withCredentials: true,
        });
        const payload = Array.isArray(response.data?.emails) ? response.data.emails : [];
        setEmailRecords(payload as BookingEmailSummary[]);
        const nextTotal = typeof response.data?.total === "number" ? response.data.total : null;
        setEmailTotal(nextTotal);
        if (nextTotal !== null) {
          const totalPages = Math.max(1, Math.ceil(nextTotal / emailPageSize));
          if (emailPage > totalPages) {
            setEmailPage(totalPages);
          }
        }
        setEmailStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setEmailStatus("error");
        setEmailError(deriveErrorMessage(error));
      }
    };

    fetchEmails();

    return () => {
      controller.abort();
    };
  }, [
    modulePermissions.ready,
    modulePermissions.canView,
    activeTab,
    emailPageSize,
    emailOffset,
    emailPage,
    debouncedEmailFilters,
    debouncedEmailDateRange,
    emailIncludeTotal,
    reloadToken,
  ]);

  const activeStatusFilter: BookingFilter = activeTab === "summary" ? "all" : calendarStatusFilter;
  const activeTabLabel = useMemo(() => {
    const current = BOOKING_TAB_OPTIONS.find((tab) => tab.value === activeTab);
    return current?.label ?? "Calendar";
  }, [activeTab]);

  const filteredOrders = useMemo(() => {
    if (activeTab === "summary" && activeStatusFilter === "all") {
      return orders.filter((order) => order.status !== "cancelled");
    }
    return filterOrdersByStatus(orders, activeStatusFilter);
  }, [orders, activeStatusFilter, activeTab]);
  const filteredBookingAddons = useMemo(() => {
    const bookingIds = new Set<number>();
    filteredOrders.forEach((order) => {
      const id = Number(order.id);
      if (Number.isFinite(id) && id > 0) {
        bookingIds.add(id);
      }
    });
    return bookingAddons.filter((row) => bookingIds.has(Number(row.bookingId)));
  }, [bookingAddons, filteredOrders]);

  const filteredProducts = useMemo(() => {
    if (activeStatusFilter === "all") {
      return products;
    }
    const ids = new Set(filteredOrders.map((order) => order.productId));
    return products.filter((product) => ids.has(product.id));
  }, [products, filteredOrders, activeStatusFilter]);

  const filteredDateRange = useMemo(() => {
    if (activeStatusFilter === "all") {
      return dateRange;
    }
    const dates = new Set(filteredOrders.map((order) => order.date));
    return dateRange.filter((date) => dates.has(date));
  }, [dateRange, filteredOrders, activeStatusFilter]);

  const grid: BookingGrid = useMemo(() => {
    return prepareBookingGrid(filteredProducts, filteredOrders, filteredDateRange);
  }, [filteredProducts, filteredOrders, filteredDateRange]);

  const emailIsLoading = emailStatus === "loading" && emailRecords.length === 0;
  const isCompactEmailTable = isTablet && !isMobile;
  const selectedEmailCount = selectedEmailIds.size;
  const pageSelectedCount = emailRecords.reduce(
    (count, email) => (selectedEmailIds.has(email.messageId) ? count + 1 : count),
    0,
  );
  const allPageSelected = emailRecords.length > 0 && pageSelectedCount === emailRecords.length;
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected;
  const emailPreviewPaneHeight = isMobile ? "calc(100vh - 320px)" : "calc(100vh - 260px)";
  const emailPreviewDetailsHeight = isMobile ? 120 : 140;
  const emailTotalPages =
    emailTotal !== null ? Math.max(1, Math.ceil(emailTotal / emailPageSize)) : null;
  const emailHasMore =
    emailTotal !== null ? emailPage < (emailTotalPages ?? 1) : emailRecords.length === emailPageSize;
  const emailHasPrev = emailPage > 1;
  const emailRangeStart = emailRecords.length === 0 ? 0 : emailOffset + 1;
  const emailRangeEnd = emailOffset + emailRecords.length;
  const bulkRangeStartLabel = emailDateRange[0] ? dayjs(emailDateRange[0]).format("YYYY-MM-DD") : "Any";
  const bulkRangeEndLabel = emailDateRange[1] ? dayjs(emailDateRange[1]).format("YYYY-MM-DD") : "Any";
  const hasEmailFilters = Boolean(
    emailFilters.search ||
      emailFilters.subject ||
      emailFilters.from ||
      emailFilters.to ||
      emailFilters.messageId ||
      emailFilters.threadId ||
      emailFilters.platformOrderId ||
      (emailFilters.status && emailFilters.status !== "all") ||
      emailDateRange[0] ||
      emailDateRange[1],
  );

  const handleEmailPrevPage = () => {
    setEmailPage((prev) => Math.max(1, prev - 1));
  };

  const handleEmailNextPage = () => {
    if (!emailHasMore) {
      return;
    }
    setEmailPage((prev) => prev + 1);
  };

  const renderEmailActions = (options: {
    messageId: string;
    previewLoading: boolean;
    reprocessLoading: boolean;
    disabled: boolean;
    fullWidth?: boolean;
  }) => (
    <Group gap="xs" wrap="wrap" grow={options.fullWidth}>
      <Button
        size="xs"
        variant="light"
        loading={options.previewLoading}
        disabled={options.disabled}
        fullWidth={options.fullWidth}
        onClick={() => handleOpenEmailPreview(options.messageId)}
      >
        Preview
      </Button>
      <Button
        size="xs"
        variant="outline"
        loading={options.reprocessLoading}
        disabled={options.disabled}
        fullWidth={options.fullWidth}
        onClick={() => handleReprocessEmail(options.messageId)}
      >
        Reprocess
      </Button>
    </Group>
  );

  const emailPreviewHtml = emailPreview?.htmlBody ?? null;
  const emailPreviewBody =
    emailPreview?.previewText ?? emailPreview?.textBody ?? emailPreview?.htmlText ?? emailPreview?.snippet ?? null;
  const gmailQuerySegments = useMemo(() => {
    if (!emailPreview?.gmailQuery) {
      return [];
    }
    return buildGmailQuerySegments(emailPreview.gmailQuery, {
      subject: emailPreview.subject,
      fromAddress: emailPreview.fromAddress,
      toAddresses: emailPreview.toAddresses,
    });
  }, [emailPreview?.fromAddress, emailPreview?.gmailQuery, emailPreview?.subject, emailPreview?.toAddresses]);
  const bookingAddonsByBooking = useMemo(() => {
    const addons = Array.isArray(emailPreview?.bookingAddons) ? emailPreview?.bookingAddons ?? [] : [];
    const map = new Map<string, Array<Record<string, unknown>>>();
    addons.forEach((addon) => {
      const bookingIdValue = addon.bookingId ?? addon.booking_id ?? null;
      const key = bookingIdValue !== null && bookingIdValue !== undefined ? String(bookingIdValue) : "unknown";
      const list = map.get(key) ?? [];
      list.push(addon);
      map.set(key, list);
    });
    return map;
  }, [emailPreview?.bookingAddons]);
  const bookingEventsByBooking = useMemo(() => {
    const events = Array.isArray(emailPreview?.bookingEvents) ? emailPreview?.bookingEvents ?? [] : [];
    const map = new Map<string, Array<Record<string, unknown>>>();
    events.forEach((event) => {
      const bookingIdValue = event.bookingId ?? event.booking_id ?? null;
      const key = bookingIdValue !== null && bookingIdValue !== undefined ? String(bookingIdValue) : "unknown";
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    });
    return map;
  }, [emailPreview?.bookingEvents]);
  const emailDiagnostics = useMemo(
    () => parseEmailDiagnostics(emailPreview?.failureReason ?? null),
    [emailPreview?.failureReason],
  );
  const isLoading = fetchStatus === "loading" && orders.length === 0;

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.bookings}>
      <Stack gap="lg">
        {!modulePermissions.ready || modulePermissions.loading ? (
          <Box style={{ minHeight: 240 }}>
            <Loader variant="dots" />
          </Box>
        ) : !modulePermissions.canView ? (
          <Alert color="yellow" title="No access">
            You do not have permission to view booking information.
          </Alert>
        ) : (
          <Stack gap="md">
            <Box style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center" }}>
              <Group justify="flex-start">
                <ActionIcon
                  variant={isFilterPanelVisible ? "filled" : "subtle"}
                  size="lg"
                  aria-label={isFilterPanelVisible ? "Hide filters panel" : "Show filters panel"}
                  onClick={() => setIsFilterPanelVisible((prev) => !prev)}
                >
                  <Text fw={700}>F</Text>
                </ActionIcon>
              </Group>
              <Title order={2} ta="center">
                Bookings
              </Title>
              <Group justify="flex-end">
                <Tooltip label="Refresh bookings" withArrow>
                  <Button
                    variant="subtle"
                    size="sm"
                    aria-label="Refresh bookings"
                    onClick={handleReload}
                    loading={ingestStatus === "loading" || fetchStatus === "loading"}
                  >
                    <IconRefresh size={16} />
                  </Button>
                </Tooltip>
              </Group>
            </Box>

            {activeTab !== "summary" && (
              <Group gap="sm" justify="center" wrap="nowrap" style={{ width: "100%" }}>
                <Button
                  size="sm"
                  variant="subtle"
                  aria-label="Previous period"
                  onClick={() => handleShiftRange(-1)}
                >
                  <IconArrowLeft size={16} />
                </Button>
                <Box
                  style={{
                    minWidth: isMobile ? 180 : 240,
                    textAlign: "center",
                    border: "1px solid #ced4da",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontWeight: 600,
                    background: "#fff",
                  }}
                >
                  {monthYearLabel}
                </Box>
                <Button
                  size="sm"
                  variant="subtle"
                  aria-label="Next period"
                  onClick={() => handleShiftRange(1)}
                >
                  <IconArrowRight size={16} />
                </Button>
              </Group>
            )}
            {isFilterPanelVisible && (
              <Group gap="sm" wrap="wrap" align="center" justify="center">
                {activeTab !== "summary" && (
                  <SegmentedControl
                    value={viewMode}
                    onChange={(value) => handleViewModeChange(value as ViewMode)}
                    data={[
                      { label: "Week", value: "week" },
                      { label: "Month", value: "month" },
                    ]}
                    size="sm"
                  />
                )}
                {activeTab !== "summary" && (
                  <SegmentedControl
                    value={activeStatusFilter}
                    onChange={(value) => setCalendarStatusFilter(value as BookingFilter)}
                    data={[
                      { label: "All", value: "all" },
                      { label: "Has people", value: "active" },
                      { label: "Cancelled", value: "cancelled" },
                    ]}
                    size="sm"
                  />
                )}
                {activeTab === "summary" && (
                  <SegmentedControl
                    value={summaryDateField}
                    onChange={(value) =>
                      setSummaryDateField(parseSummaryDateFieldParam(value))
                    }
                    data={[
                      { value: "experience_date", label: "Experience Date" },
                      { value: "source_received_at", label: "Source Received At" },
                    ]}
                    size={isMobile ? "xs" : "sm"}
                  />
                )}
                {activeTab === "summary" && (
                  <Select
                    value={summaryProductTypeFilter}
                    onChange={(value) =>
                      setSummaryProductTypeFilter(parseSummaryProductTypeParam(value))
                    }
                    data={summaryProductTypeOptions}
                    placeholder="All Product Types"
                    size={isMobile ? "xs" : "sm"}
                    w={isMobile ? "100%" : 260}
                    checkIconPosition="right"
                  />
                )}
                {activeTab !== "summary" && (
                  <Button
                    size="sm"
                    variant="light"
                    leftSection={<IconCalendar size={16} />}
                    onClick={handleGoToToday}
                  >
                    Today
                  </Button>
                )}
              </Group>
            )}

            {errorMessage && (
              <Alert color="red" title="Failed to sync bookings">
                {errorMessage}
              </Alert>
            )}

            <Tabs
              value={activeTab}
              onChange={handleBookingsTabChange}
              keepMounted={false}
            >
              {isMobile ? (
                <Accordion
                  value={mobileTabsMenuOpen}
                  onChange={setMobileTabsMenuOpen}
                  variant="separated"
                  radius="md"
                >
                  <Accordion.Item value="tabs-menu">
                    <Accordion.Control
                      styles={{
                        label: { textAlign: "center", flex: 1 },
                      }}
                    >
                      {activeTabLabel}
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="xs">
                        {BOOKING_TAB_OPTIONS.map((tab) => (
                          <Button
                            key={tab.value}
                            variant={tab.value === activeTab ? "light" : "subtle"}
                            justify="center"
                            onClick={() => {
                              handleBookingsTabChange(tab.value);
                              setMobileTabsMenuOpen(null);
                            }}
                          >
                            {tab.label}
                          </Button>
                        ))}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                </Accordion>
              ) : (
                <Tabs.List>
                  <Tabs.Tab value="calendar">Calendar</Tabs.Tab>
                  <Tabs.Tab value="manifest">Manifest</Tabs.Tab>
                  <Tabs.Tab value="summary">Summary</Tabs.Tab>
                  <Tabs.Tab value="emails">Emails</Tabs.Tab>
                  <Tabs.Tab value="sanity">Sanity Check</Tabs.Tab>
                </Tabs.List>
              )}
              {activeTab === "summary" && (
                <Stack gap="sm" mt="md" mx="auto" style={{ width: "100%", maxWidth: 860 }}>
                  <Group gap="sm" wrap="wrap" align="center" justify="center">
                    <Select
                      value={summaryDatePreset}
                      onChange={(value) =>
                        setSummaryDatePreset(parseSummaryDatePresetParam(value))
                      }
                      data={SUMMARY_DATE_PRESET_OPTIONS}
                      placeholder="This Month"
                      size={isMobile ? "xs" : "sm"}
                      w={isMobile ? "100%" : 220}
                      checkIconPosition="right"
                      allowDeselect={false}
                      styles={{
                        input: { textAlign: "center", fontWeight: 700 },
                        dropdown: { textAlign: "center" },
                        options: { textAlign: "center" },
                        option: { justifyContent: "center", textAlign: "center", fontWeight: 600 },
                      }}
                    />
                    {summaryDatePreset === "custom" && (
                      <DatePickerInput
                        type="range"
                        value={summaryCustomDateRange}
                        onChange={setSummaryCustomDateRange}
                        placeholder="Select custom range"
                        size={isMobile ? "xs" : "sm"}
                        valueFormat="YYYY-MM-DD"
                        clearable
                        w={isMobile ? "100%" : 280}
                        styles={{
                          input: { textAlign: "center" },
                        }}
                      />
                    )}
                  </Group>
                  <SegmentedControl
                    value={summaryMetricMode}
                    onChange={(value) =>
                      setSummaryMetricMode(parseSummaryMetricModeParam(value))
                    }
                    data={[
                      { value: "earnings", label: "Earnings" },
                      { value: "revenue", label: "Revenue" },
                      { value: "costs", label: "Costs" },
                    ]}
                    fullWidth
                    radius="md"
                    size={isMobile ? "sm" : "md"}
                    color="blue"
                    styles={{
                      root: { backgroundColor: "#eef3f8", border: "1px solid #d7e3f0" },
                      label: { fontWeight: 600, paddingTop: 8, paddingBottom: 8 },
                      indicator: { boxShadow: "0 2px 10px rgba(24, 100, 171, 0.18)" },
                    }}
                  />
                </Stack>
              )}

              <Tabs.Panel value="calendar" pt="md">
                {isLoading ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : filteredOrders.length === 0 ? (
                  <Alert color="blue" title="No bookings">
                    No bookings match the current filters.
                  </Alert>
                ) : (
                  <BookingsGrid
                    products={filteredProducts}
                    dateRange={filteredDateRange}
                    grid={grid}
                    selectedDate={selectedDateKey}
                    onSelectDate={(nextDate) => setSelectedDate(dayjs(nextDate))}
                    onOpenManifest={handleOpenManifest}
                    viewMode={viewMode}
                    scrollToDate={calendarScrollDate}
                    onScrollComplete={() => setCalendarScrollDate(null)}
                  />
                )}
              </Tabs.Panel>

              <Tabs.Panel value="summary" pt="md">
                <Stack gap="md">
                  {fetchStatus === "loading" && orders.length === 0 ? (
                    <Box style={{ minHeight: 320 }}>
                      <Loader variant="bars" />
                    </Box>
                  ) : (
                    <Suspense fallback={<Box style={{ minHeight: 320 }}><Loader variant="bars" /></Box>}>
                      <BookingsExecutiveDashboard
                        orders={filteredOrders}
                        bookingAddons={filteredBookingAddons}
                        addonCatalog={addonCatalog}
                        counterInsights={counterInsights}
                        venueCommissionTotals={venueCommissionTotals}
                        venueCommissionVenues={venueCommissionVenues}
                        metricMode={summaryMetricMode}
                        costsSummary={costsSummary}
                      />
                    </Suspense>
                  )}
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="emails" pt="md">
                {emailIsLoading ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : (
                  <Stack gap="md">
                    {emailError && (
                      <Alert color="red" title="Failed to load booking emails">
                        {emailError}
                      </Alert>
                    )}
                    {emailReprocessError && (
                      <Alert color="red" title="Failed to reprocess booking email">
                        {emailReprocessError}
                      </Alert>
                    )}
                    {bulkReprocessError && (
                      <Alert color="red" title="Failed to reprocess booking emails">
                        {bulkReprocessError}
                      </Alert>
                    )}
                    {backfillError && (
                      <Alert color="red" title="Failed to backfill booking emails">
                        {backfillError}
                      </Alert>
                    )}
                    <Paper withBorder radius="lg" shadow="sm" p="md">
                      <Stack gap="sm">
                        <Group justify="space-between" align="center" wrap="wrap">
                          <Group gap="xs" wrap="wrap">
                            <Text fw={600}>Email filters</Text>
                            <Button
                              size="xs"
                              variant="default"
                              onClick={handleClearEmailFilters}
                              disabled={!hasEmailFilters}
                            >
                              Clear filters
                            </Button>
                          </Group>
                          <Group gap="xs" wrap="wrap">
                            {selectedEmailCount > 0 && (
                              <Text size="xs" c="dimmed">
                                {`${selectedEmailCount} selected`}
                              </Text>
                            )}
                            {selectedEmailCount > 0 && (
                              <Button size="xs" variant="subtle" onClick={handleClearEmailSelection}>
                                Clear selection
                              </Button>
                            )}
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() => handleOpenBulkReprocess("selected")}
                              disabled={selectedEmailCount === 0 || bulkReprocessLoading}
                            >
                              Reprocess selected
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() => handleOpenBulkReprocess("range")}
                              disabled={emailDateRange[0] === null && emailDateRange[1] === null}
                            >
                              Reprocess date range
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              color="orange"
                              onClick={handleOpenBackfill}
                              disabled={
                                (emailDateRange[0] === null && emailDateRange[1] === null) || backfillLoading
                              }
                            >
                              Backfill date range
                            </Button>
                          </Group>
                        </Group>
                        <SimpleGrid cols={isMobile ? 1 : isTablet ? 2 : 4} spacing="sm">
                          <DatePickerInput
                            type="range"
                            label="Received date range"
                            description="Leave empty to show all dates."
                            placeholder="All time"
                            value={emailDateRange}
                            onChange={setEmailDateRange}
                            valueFormat="YYYY-MM-DD"
                            clearable
                            size="sm"
                          />
                          <TextInput
                            size="sm"
                            label="Search"
                            placeholder="Subject, from, to, snippet..."
                            value={emailFilters.search}
                            onChange={(event) => handleEmailFilterValue("search", event.currentTarget.value)}
                          />
                          <TextInput
                            size="sm"
                            label="Subject"
                            placeholder="Subject contains..."
                            value={emailFilters.subject}
                            onChange={(event) => handleEmailFilterValue("subject", event.currentTarget.value)}
                          />
                          <TextInput
                            size="sm"
                            label="From"
                            placeholder="sender@domain.com"
                            value={emailFilters.from}
                            onChange={(event) => handleEmailFilterValue("from", event.currentTarget.value)}
                          />
                          <TextInput
                            size="sm"
                            label="To"
                            placeholder="recipient@domain.com"
                            value={emailFilters.to}
                            onChange={(event) => handleEmailFilterValue("to", event.currentTarget.value)}
                          />
                          <TextInput
                            size="sm"
                            label="Message ID"
                            placeholder="Message id..."
                            value={emailFilters.messageId}
                            onChange={(event) => handleEmailFilterValue("messageId", event.currentTarget.value)}
                          />
                          <TextInput
                            size="sm"
                            label="Thread ID"
                            placeholder="Thread id..."
                            value={emailFilters.threadId}
                            onChange={(event) => handleEmailFilterValue("threadId", event.currentTarget.value)}
                          />
                          <TextInput
                            size="sm"
                            label="Platform Order ID(s)"
                            placeholder="e.g. ABC123, XYZ789"
                            value={emailFilters.platformOrderId}
                            onChange={(event) =>
                              handleEmailFilterValue("platformOrderId", event.currentTarget.value)
                            }
                            description="Use commas for bulk search."
                          />
                          <Select
                            size="sm"
                            label="Status"
                            data={EMAIL_STATUS_OPTIONS}
                            value={emailFilters.status}
                            onChange={(value) => handleEmailFilterValue("status", value ?? "all")}
                            allowDeselect={false}
                          />
                        </SimpleGrid>
                        <Group justify="space-between" align="center" wrap="wrap">
                          <Group gap="xs" wrap="wrap">
                            <Text size="sm" c="dimmed">
                              Rows per page
                            </Text>
                            <Select
                              size="sm"
                              data={EMAIL_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
                              value={String(emailPageSize)}
                              onChange={handleEmailPageSizeChange}
                              allowDeselect={false}
                            />
                          </Group>
                          <Group gap="xs" wrap="wrap">
                            <Text size="sm" c="dimmed">
                              {emailTotal !== null
                                ? `Showing ${emailRangeStart}-${emailRangeEnd} of ${emailTotal}`
                                : `Showing ${emailRangeStart}-${emailRangeEnd}`}
                            </Text>
                            <Button
                              size="xs"
                              variant="default"
                              onClick={handleEmailPrevPage}
                              disabled={!emailHasPrev || emailIsLoading}
                            >
                              Prev
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              onClick={handleEmailNextPage}
                              disabled={!emailHasMore || emailIsLoading}
                            >
                              Next
                            </Button>
                          </Group>
                        </Group>
                      </Stack>
                    </Paper>
                    {emailRecords.length === 0 ? (
                      <Alert color="blue" title="No booking emails">
                        {hasEmailFilters
                          ? "No booking emails match the current filters."
                          : "No booking emails found for the selected range."}
                      </Alert>
                    ) : isMobile ? (
                      <Stack gap="sm">
                        {emailRecords.map((email) => {
                          const receivedLabel = formatEmailTimestamp(email.receivedAt ?? email.internalDate ?? null);
                          const receivedField = email.receivedAt ? "received_at" : "internal_date";
                          const statusLabel = email.ingestionStatus ?? "unknown";
                          const previewLoading = emailPreviewLoading && emailPreviewMessageId === email.messageId;
                          const reprocessLoading = emailReprocessId === email.messageId;
                          const disableRowActions =
                            (emailPreviewLoading && !previewLoading) ||
                            (emailReprocessId !== null && !reprocessLoading);
                          const isSelected = selectedEmailIds.has(email.messageId);
                          return (
                            <Paper key={email.messageId} withBorder radius="lg" shadow="sm" p="sm">
                              <Stack gap="sm">
                                <Group justify="space-between" align="flex-start" wrap="nowrap">
                                  <Group gap="xs" align="flex-start" wrap="nowrap">
                                    <Checkbox
                                      checked={isSelected}
                                      onChange={() => handleToggleEmailSelection(email.messageId)}
                                      aria-label={`Select email ${email.messageId}`}
                                    />
                                    <Stack gap={2}>
                                      <EmailFieldPopover field="subject" value={email.subject}>
                                        <Text fw={600} size="sm">
                                          {email.subject ?? "No subject"}
                                        </Text>
                                      </EmailFieldPopover>
                                      <EmailFieldPopover field={receivedField} value={receivedLabel}>
                                        <Text size="xs" c="dimmed">
                                          {receivedLabel}
                                        </Text>
                                      </EmailFieldPopover>
                                    </Stack>
                                  </Group>
                                  <EmailFieldPopover field="ingestion_status" value={statusLabel} fullWidth={false}>
                                    <Badge size="sm" color={resolveEmailStatusColor(statusLabel)} variant="light">
                                      {statusLabel.toUpperCase()}
                                    </Badge>
                                  </EmailFieldPopover>
                                </Group>
                                <Stack gap={4}>
                                  <EmailFieldPopover field="from_address" value={email.fromAddress}>
                                    <Text size="xs" c="dimmed">
                                      From: {email.fromAddress ?? "-"}
                                    </Text>
                                  </EmailFieldPopover>
                                  <EmailFieldPopover field="to_addresses" value={email.toAddresses}>
                                    <Text size="xs" c="dimmed">
                                      To: {email.toAddresses ?? "-"}
                                    </Text>
                                  </EmailFieldPopover>
                                  <EmailFieldPopover field="message_id" value={email.messageId}>
                                    <Text size="xs" c="dimmed">
                                      Message ID: {email.messageId}
                                    </Text>
                                  </EmailFieldPopover>
                                  {email.threadId && (
                                    <EmailFieldPopover field="thread_id" value={email.threadId}>
                                      <Text size="xs" c="dimmed">
                                        Thread ID: {email.threadId}
                                      </Text>
                                    </EmailFieldPopover>
                                  )}
                                </Stack>
                                {email.snippet && (
                                  <EmailFieldPopover field="snippet" value={email.snippet}>
                                    <Text size="sm" lineClamp={3}>
                                      {email.snippet}
                                    </Text>
                                  </EmailFieldPopover>
                                )}
                                {email.failureReason && (
                                  <EmailFieldPopover field="failure_reason" value={email.failureReason}>
                                    <Text size="xs" c="dimmed" lineClamp={2}>
                                      {email.failureReason}
                                    </Text>
                                  </EmailFieldPopover>
                                )}
                                {renderEmailActions({
                                  messageId: email.messageId,
                                  previewLoading,
                                  reprocessLoading,
                                  disabled: disableRowActions,
                                  fullWidth: true,
                                })}
                              </Stack>
                            </Paper>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Paper withBorder radius="lg" shadow="sm" p="md">
                        <ScrollArea style={{ width: "100%" }}>
                          <Table
                            striped
                            highlightOnHover
                            withColumnBorders={!isCompactEmailTable}
                            horizontalSpacing={isCompactEmailTable ? "sm" : "md"}
                            verticalSpacing="sm"
                          >
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>
                                  <Checkbox
                                    checked={allPageSelected}
                                    indeterminate={somePageSelected}
                                    onChange={(event) => handleSelectAllEmailPage(event.currentTarget.checked)}
                                    aria-label="Select all emails on page"
                                  />
                                </Table.Th>
                                <Table.Th>Received</Table.Th>
                                <Table.Th>Subject</Table.Th>
                                {!isCompactEmailTable && <Table.Th>From</Table.Th>}
                                {!isCompactEmailTable && <Table.Th>To</Table.Th>}
                                <Table.Th>Status</Table.Th>
                                {!isCompactEmailTable && <Table.Th>Snippet</Table.Th>}
                                <Table.Th>Actions</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {emailRecords.map((email) => {
                                const receivedLabel = formatEmailTimestamp(
                                  email.receivedAt ?? email.internalDate ?? null,
                                );
                                const receivedField = email.receivedAt ? "received_at" : "internal_date";
                                const statusLabel = email.ingestionStatus ?? "unknown";
                                const previewLoading =
                                  emailPreviewLoading && emailPreviewMessageId === email.messageId;
                                const reprocessLoading = emailReprocessId === email.messageId;
                                const disableRowActions =
                                  (emailPreviewLoading && !previewLoading) ||
                                  (emailReprocessId !== null && !reprocessLoading);
                                const isSelected = selectedEmailIds.has(email.messageId);
                                return (
                                  <Table.Tr key={email.messageId}>
                                    <Table.Td>
                                      <Checkbox
                                        checked={isSelected}
                                        onChange={() => handleToggleEmailSelection(email.messageId)}
                                        aria-label={`Select email ${email.messageId}`}
                                      />
                                    </Table.Td>
                                    <Table.Td>
                                      <Stack gap={2}>
                                        <EmailFieldPopover field={receivedField} value={receivedLabel}>
                                          <Text fw={600} size="sm">
                                            {receivedLabel}
                                          </Text>
                                        </EmailFieldPopover>
                                        <EmailFieldPopover field="message_id" value={email.messageId}>
                                          <Text size="xs" c="dimmed">
                                            {email.messageId}
                                          </Text>
                                        </EmailFieldPopover>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                      <Stack gap={2}>
                                        <EmailFieldPopover field="subject" value={email.subject}>
                                          <Text fw={600} size="sm">
                                            {email.subject ?? "No subject"}
                                          </Text>
                                        </EmailFieldPopover>
                                        {email.threadId && (
                                          <EmailFieldPopover field="thread_id" value={email.threadId}>
                                            <Text size="xs" c="dimmed">
                                              {email.threadId}
                                            </Text>
                                          </EmailFieldPopover>
                                        )}
                                        {isCompactEmailTable && (
                                          <Stack gap={2}>
                                            <EmailFieldPopover field="from_address" value={email.fromAddress}>
                                              <Text size="xs" c="dimmed" lineClamp={2}>
                                                {email.fromAddress ?? "-"}
                                              </Text>
                                            </EmailFieldPopover>
                                            <EmailFieldPopover field="to_addresses" value={email.toAddresses}>
                                              <Text size="xs" c="dimmed" lineClamp={2}>
                                                {email.toAddresses ?? "-"}
                                              </Text>
                                            </EmailFieldPopover>
                                            {email.snippet && (
                                              <EmailFieldPopover field="snippet" value={email.snippet}>
                                                <Text size="xs" lineClamp={2}>
                                                  {email.snippet}
                                                </Text>
                                              </EmailFieldPopover>
                                            )}
                                          </Stack>
                                        )}
                                      </Stack>
                                    </Table.Td>
                                    {!isCompactEmailTable && (
                                      <Table.Td>
                                        <EmailFieldPopover field="from_address" value={email.fromAddress}>
                                          <Text size="sm" lineClamp={2}>
                                            {email.fromAddress ?? "-"}
                                          </Text>
                                        </EmailFieldPopover>
                                      </Table.Td>
                                    )}
                                    {!isCompactEmailTable && (
                                      <Table.Td>
                                        <EmailFieldPopover field="to_addresses" value={email.toAddresses}>
                                          <Text size="sm" lineClamp={2}>
                                            {email.toAddresses ?? "-"}
                                          </Text>
                                        </EmailFieldPopover>
                                      </Table.Td>
                                    )}
                                    <Table.Td>
                                      <Stack gap={4}>
                                        <EmailFieldPopover field="ingestion_status" value={statusLabel}>
                                          <Badge size="sm" color={resolveEmailStatusColor(statusLabel)} variant="light">
                                            {statusLabel.toUpperCase()}
                                          </Badge>
                                        </EmailFieldPopover>
                                        {email.failureReason && (
                                          <EmailFieldPopover field="failure_reason" value={email.failureReason}>
                                            <Text size="xs" c="dimmed" lineClamp={2}>
                                              {email.failureReason}
                                            </Text>
                                          </EmailFieldPopover>
                                        )}
                                      </Stack>
                                    </Table.Td>
                                    {!isCompactEmailTable && (
                                      <Table.Td>
                                        <EmailFieldPopover field="snippet" value={email.snippet}>
                                          <Text size="sm" lineClamp={3}>
                                            {email.snippet ?? "-"}
                                          </Text>
                                        </EmailFieldPopover>
                                      </Table.Td>
                                    )}
                                    <Table.Td>
                                      {renderEmailActions({
                                        messageId: email.messageId,
                                        previewLoading,
                                        reprocessLoading,
                                        disabled: disableRowActions,
                                      })}
                                    </Table.Td>
                                  </Table.Tr>
                                );
                              })}
                            </Table.Tbody>
                          </Table>
                        </ScrollArea>
                      </Paper>
                    )}
                  </Stack>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="sanity" pt="md">
                <BookingsSanityCheck />
              </Tabs.Panel>
            </Tabs>
            <Modal
              opened={bulkReprocessMode !== null}
              onClose={handleCloseBulkReprocess}
              title="Confirm reprocess"
              centered
            >
              <Stack gap="sm">
                <Text size="sm">
                  {bulkReprocessMode === "selected"
                    ? `Reprocess ${selectedEmailCount} selected email${selectedEmailCount === 1 ? "" : "s"}?`
                    : `Reprocess all emails received between ${bulkRangeStartLabel} and ${bulkRangeEndLabel}?`}
                </Text>
                {bulkReprocessError && (
                  <Alert color="red" title="Bulk reprocess failed">
                    {bulkReprocessError}
                  </Alert>
                )}
                <Group justify="flex-end">
                  <Button variant="default" onClick={handleCloseBulkReprocess} disabled={bulkReprocessLoading}>
                    Cancel
                  </Button>
                  <Button
                    color="orange"
                    onClick={handleConfirmBulkReprocess}
                    loading={bulkReprocessLoading}
                    disabled={
                      bulkReprocessMode === "selected"
                        ? selectedEmailCount === 0
                        : emailDateRange[0] === null && emailDateRange[1] === null
                    }
                  >
                    Reprocess
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <Modal
              opened={backfillConfirmOpen}
              onClose={handleCloseBackfill}
              title="Confirm backfill"
              centered
            >
              <Stack gap="sm">
                <Text size="sm">
                  {`Backfill all emails received between ${bulkRangeStartLabel} and ${bulkRangeEndLabel}?`}
                </Text>
                {backfillError && (
                  <Alert color="red" title="Backfill failed">
                    {backfillError}
                  </Alert>
                )}
                <Group justify="flex-end">
                  <Button variant="default" onClick={handleCloseBackfill} disabled={backfillLoading}>
                    Cancel
                  </Button>
                  <Button
                    color="orange"
                    onClick={handleConfirmBackfill}
                    loading={backfillLoading}
                    disabled={emailDateRange[0] === null && emailDateRange[1] === null}
                  >
                    Backfill
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <Modal
              opened={emailPreviewOpen}
              onClose={handleCloseEmailPreview}
              title="Email preview"
              fullScreen
              centered
            >
              <Stack gap="sm">
                {emailPreviewError && (
                  <Alert color="red" title="Failed to load email preview">
                    {emailPreviewError}
                  </Alert>
                )}
                {emailPreviewLoading && (
                  <Box style={{ minHeight: 120 }}>
                    <Loader variant="dots" />
                  </Box>
                )}
                {emailPreview && (
                  <>
                    <Stack gap={4}>
                      <EmailFieldPopover field="subject" value={emailPreview.subject}>
                        <Text fw={600}>{emailPreview.subject ?? "No subject"}</Text>
                      </EmailFieldPopover>
                      <EmailFieldPopover field="from_address" value={emailPreview.fromAddress}>
                        <Text size="sm" c="dimmed">
                          {emailPreview.fromAddress ?? "-"}
                        </Text>
                      </EmailFieldPopover>
                      <EmailFieldPopover field="to_addresses" value={emailPreview.toAddresses}>
                        <Text size="sm" c="dimmed">
                          {emailPreview.toAddresses ?? "-"}
                        </Text>
                      </EmailFieldPopover>
                      <EmailFieldPopover
                        field={emailPreview.receivedAt ? "received_at" : "internal_date"}
                        value={formatEmailTimestamp(emailPreview.receivedAt ?? emailPreview.internalDate ?? null)}
                      >
                        <Text size="sm">
                          {formatEmailTimestamp(emailPreview.receivedAt ?? emailPreview.internalDate ?? null)}
                        </Text>
                      </EmailFieldPopover>
                      <EmailFieldPopover
                        field="ingestion_status"
                        value={emailPreview.ingestionStatus ?? "unknown"}
                      >
                        <Badge size="sm" color={resolveEmailStatusColor(emailPreview.ingestionStatus)} variant="light">
                          {(emailPreview.ingestionStatus ?? "unknown").toUpperCase()}
                        </Badge>
                      </EmailFieldPopover>
                    </Stack>

                    {emailPreview.gmailQuery && (
                      <Paper withBorder radius="md" p="sm">
                        <Stack gap="xs">
                          <Text size="sm" fw={600}>
                            Gmail query
                          </Text>
                          {gmailQuerySegments.length > 0 ? (
                            <Stack gap={6}>
                              {gmailQuerySegments.map((segment, index) => (
                                <Paper
                                  key={`gmail-query-${index}`}
                                  withBorder
                                  radius="sm"
                                  p="xs"
                                  style={{
                                    backgroundColor: segment.matched
                                      ? theme.colors.green[0]
                                      : theme.colors.red[0],
                                    borderColor: segment.matched
                                      ? theme.colors.green[3]
                                      : theme.colors.red[3],
                                  }}
                                >
                                  <Text size="sm" style={{ wordBreak: "break-word" }}>
                                    {segment.label}
                                  </Text>
                                </Paper>
                              ))}
                            </Stack>
                          ) : (
                            <Text size="sm" c="dimmed">
                              {emailPreview.gmailQuery}
                            </Text>
                          )}
                        </Stack>
                      </Paper>
                    )}

                    {emailPreview.ingestionStatus === "processed" &&
                      emailPreview.bookings &&
                      emailPreview.bookings.length > 0 && (
                        <Paper withBorder radius="md" p="sm">
                          <Stack gap="sm">
                            <Text size="sm" fw={600}>
                              Booking details
                            </Text>
                            <Accordion multiple variant="separated">
                              {emailPreview.bookings.map((booking, index) => {
                                const entries = Object.entries(booking).sort(([left], [right]) =>
                                  left.localeCompare(right),
                                );
                                const bookingId =
                                  typeof booking.id === "number" || typeof booking.id === "string"
                                    ? String(booking.id)
                                    : null;
                                const platformBookingId =
                                  typeof booking.platformBookingId === "string" ? booking.platformBookingId : null;
                                const label = bookingId || platformBookingId || `Booking ${index + 1}`;
                                return (
                                  <Accordion.Item key={`booking-${label}-${index}`} value={`booking-${index}`}>
                                    <Accordion.Control>{label}</Accordion.Control>
                                    <Accordion.Panel>
                                      <Table
                                        striped
                                        highlightOnHover
                                        withColumnBorders
                                        horizontalSpacing="sm"
                                        verticalSpacing="xs"
                                      >
                                        <Table.Thead>
                                          <Table.Tr>
                                            <Table.Th>Field</Table.Th>
                                            <Table.Th>Value</Table.Th>
                                          </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                          {entries.map(([key, value]) => (
                                            <Table.Tr key={`${label}-${key}`}>
                                              <Table.Td>
                                                <Text size="sm" fw={600}>
                                                  {key}
                                                </Text>
                                              </Table.Td>
                                              <Table.Td>
                                                <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                                                  {formatBookingFieldValue(value)}
                                                </Text>
                                              </Table.Td>
                                            </Table.Tr>
                                          ))}
                                        </Table.Tbody>
                                      </Table>
                                    </Accordion.Panel>
                                  </Accordion.Item>
                                );
                              })}
                            </Accordion>
                          </Stack>
                        </Paper>
                      )}

                    {emailPreview.ingestionStatus === "processed" &&
                      bookingAddonsByBooking.size > 0 && (
                        <Paper withBorder radius="md" p="sm">
                          <Stack gap="sm">
                            <Text size="sm" fw={600}>
                              Booking add-on details
                            </Text>
                            <Accordion multiple variant="separated">
                              {Array.from(bookingAddonsByBooking.entries()).map(([bookingId, addons]) => (
                                <Accordion.Item key={`addons-${bookingId}`} value={`addons-${bookingId}`}>
                                  <Accordion.Control>
                                    {bookingId === "unknown" ? "Unknown booking" : `Booking ${bookingId}`}
                                  </Accordion.Control>
                                  <Accordion.Panel>
                                    <Stack gap="sm">
                                      {addons.map((addon, index) => {
                                        const entries = Object.entries(addon).sort(([left], [right]) =>
                                          left.localeCompare(right),
                                        );
                                        const addonId =
                                          typeof addon.id === "number" || typeof addon.id === "string"
                                            ? String(addon.id)
                                            : `Addon ${index + 1}`;
                                        return (
                                          <Paper key={`addon-${bookingId}-${addonId}-${index}`} withBorder radius="sm" p="sm">
                                            <Stack gap="xs">
                                              <Text size="sm" fw={600}>
                                                {addonId}
                                              </Text>
                                              <Table
                                                striped
                                                highlightOnHover
                                                withColumnBorders
                                                horizontalSpacing="sm"
                                                verticalSpacing="xs"
                                              >
                                                <Table.Thead>
                                                  <Table.Tr>
                                                    <Table.Th>Field</Table.Th>
                                                    <Table.Th>Value</Table.Th>
                                                  </Table.Tr>
                                                </Table.Thead>
                                                <Table.Tbody>
                                                  {entries.map(([key, value]) => (
                                                    <Table.Tr key={`${bookingId}-${addonId}-${key}`}>
                                                      <Table.Td>
                                                        <Text size="sm" fw={600}>
                                                          {key}
                                                        </Text>
                                                      </Table.Td>
                                                      <Table.Td>
                                                        <Text
                                                          size="sm"
                                                          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                                                        >
                                                          {formatBookingFieldValue(value)}
                                                        </Text>
                                                      </Table.Td>
                                                    </Table.Tr>
                                                  ))}
                                                </Table.Tbody>
                                              </Table>
                                            </Stack>
                                          </Paper>
                                        );
                                      })}
                                    </Stack>
                                  </Accordion.Panel>
                                </Accordion.Item>
                              ))}
                            </Accordion>
                          </Stack>
                        </Paper>
                      )}

                    {emailPreview.ingestionStatus === "processed" &&
                      bookingEventsByBooking.size > 0 && (
                        <Paper withBorder radius="md" p="sm">
                          <Stack gap="sm">
                            <Text size="sm" fw={600}>
                              Booking events
                            </Text>
                            <Accordion multiple variant="separated">
                              {Array.from(bookingEventsByBooking.entries()).map(([bookingId, events]) => {
                                const sortedEvents = [...events].sort((left, right) => {
                                  const leftId = resolveEventValue(left, "id", "event_id");
                                  const rightId = resolveEventValue(right, "id", "event_id");
                                  if (typeof leftId === "number" && typeof rightId === "number") {
                                    return rightId - leftId;
                                  }
                                  return String(rightId ?? "").localeCompare(String(leftId ?? ""));
                                });
                                return (
                                  <Accordion.Item key={`events-${bookingId}`} value={`events-${bookingId}`}>
                                    <Accordion.Control>
                                      {bookingId === "unknown" ? "Unknown booking" : `Booking ${bookingId}`}
                                    </Accordion.Control>
                                    <Accordion.Panel>
                                      <ScrollArea style={{ width: "100%" }}>
                                        <Table
                                          striped
                                          highlightOnHover
                                          withColumnBorders
                                          horizontalSpacing="sm"
                                          verticalSpacing="xs"
                                        >
                                          <Table.Thead>
                                            <Table.Tr>
                                              <Table.Th>ID</Table.Th>
                                              <Table.Th>Type</Table.Th>
                                              <Table.Th>Platform</Table.Th>
                                              <Table.Th>Status</Table.Th>
                                              <Table.Th>Occurred</Table.Th>
                                              <Table.Th>Ingested</Table.Th>
                                              <Table.Th>Processed</Table.Th>
                                              <Table.Th>Email Message ID</Table.Th>
                                              <Table.Th>Email ID</Table.Th>
                                              <Table.Th>Error</Table.Th>
                                              <Table.Th>Payload</Table.Th>
                                            </Table.Tr>
                                          </Table.Thead>
                                          <Table.Tbody>
                                            {sortedEvents.map((event, index) => {
                                              const eventId = resolveEventValue(event, "id", "event_id");
                                              const type = resolveEventValue(event, "eventType", "event_type");
                                              const platform = resolveEventValue(event, "platform", "platform");
                                              const statusAfter = resolveEventValue(event, "statusAfter", "status_after");
                                              const occurredAt = resolveEventValue(event, "occurredAt", "occurred_at");
                                              const ingestedAt = resolveEventValue(event, "ingestedAt", "ingested_at");
                                              const processedAt = resolveEventValue(event, "processedAt", "processed_at");
                                              const emailMessageId = resolveEventValue(
                                                event,
                                                "emailMessageId",
                                                "email_message_id",
                                              );
                                              const emailId = resolveEventValue(event, "emailId", "email_id");
                                              const error = resolveEventValue(event, "processingError", "processing_error");
                                              const payload = resolveEventValue(event, "eventPayload", "event_payload");
                                              return (
                                                <Table.Tr key={`event-row-${bookingId}-${eventId ?? index}`}>
                                                  <Table.Td>{formatBookingFieldValue(eventId)}</Table.Td>
                                                  <Table.Td>{formatBookingFieldValue(type)}</Table.Td>
                                                  <Table.Td>{formatBookingFieldValue(platform)}</Table.Td>
                                                  <Table.Td>{formatBookingFieldValue(statusAfter)}</Table.Td>
                                                  <Table.Td>{formatBookingFieldValue(occurredAt)}</Table.Td>
                                                  <Table.Td>{formatBookingFieldValue(ingestedAt)}</Table.Td>
                                                  <Table.Td>{formatBookingFieldValue(processedAt)}</Table.Td>
                                                  <Table.Td>
                                                    <Text size="sm" lineClamp={1}>
                                                      {formatBookingFieldValue(emailMessageId)}
                                                    </Text>
                                                  </Table.Td>
                                                  <Table.Td>{formatBookingFieldValue(emailId)}</Table.Td>
                                                  <Table.Td>
                                                    <Text size="sm" lineClamp={2}>
                                                      {formatBookingFieldValue(error)}
                                                    </Text>
                                                  </Table.Td>
                                                  <Table.Td>
                                                    <Text size="sm" lineClamp={2}>
                                                      {formatBookingFieldValue(payload)}
                                                    </Text>
                                                  </Table.Td>
                                                </Table.Tr>
                                              );
                                            })}
                                          </Table.Tbody>
                                        </Table>
                                      </ScrollArea>
                                    </Accordion.Panel>
                                  </Accordion.Item>
                                );
                              })}
                            </Accordion>
                          </Stack>
                        </Paper>
                      )}

                    {emailPreview.failureReason && (
                      <Paper withBorder radius="md" p="sm">
                        <Stack gap="sm">
                          <Text size="sm" fw={600}>
                            Ingestion details
                          </Text>
                          {emailDiagnostics && emailDiagnostics.length > 0 ? (
                            <Stack gap="sm">
                              {emailDiagnostics.map((diag) => (
                                <Paper key={`diag-${diag.parser}`} withBorder radius="md" p="sm">
                                  <Stack gap="sm">
                                    <Group justify="space-between" align="center" wrap="wrap">
                                      <Text fw={600}>{diag.parser}</Text>
                                      <Group gap="xs" wrap="wrap">
                                        {diag.canParse !== null && (
                                          <Badge color={diag.canParse ? "green" : "red"} variant="light">
                                            {diag.canParse ? "Can parse" : "Cannot parse"}
                                          </Badge>
                                        )}
                                        {diag.parseMatched !== null && (
                                          <Badge color={diag.parseMatched ? "green" : "red"} variant="light">
                                            {diag.parseMatched ? "Parse matched" : "No match"}
                                          </Badge>
                                        )}
                                      </Group>
                                    </Group>
                                    {diag.checks.length > 0 ? (
                                      <Table
                                        striped
                                        highlightOnHover
                                        withColumnBorders
                                        horizontalSpacing="sm"
                                        verticalSpacing="xs"
                                      >
                                        <Table.Thead>
                                          <Table.Tr>
                                            <Table.Th>Check</Table.Th>
                                            <Table.Th>Result</Table.Th>
                                            <Table.Th>Details</Table.Th>
                                            <Table.Th>Phase</Table.Th>
                                          </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                          {diag.checks.map((check, index) => (
                                            <Table.Tr key={`${diag.parser}-${check.label}-${index}`}>
                                              <Table.Td>{check.label}</Table.Td>
                                              <Table.Td>
                                                <Badge color={check.passed ? "green" : "red"} variant="light">
                                                  {check.passed ? "Passed" : "Failed"}
                                                </Badge>
                                              </Table.Td>
                                              <Table.Td>
                                                <Text size="sm" c="dimmed" lineClamp={2}>
                                                  {check.value ?? "-"}
                                                </Text>
                                              </Table.Td>
                                              <Table.Td>
                                                <Text size="sm">
                                                  {check.phase === "canParse" ? "Can parse" : "Parse"}
                                                </Text>
                                              </Table.Td>
                                            </Table.Tr>
                                          ))}
                                        </Table.Tbody>
                                      </Table>
                                    ) : (
                                      <Text size="sm" c="dimmed">
                                        No checks recorded.
                                      </Text>
                                    )}
                                  </Stack>
                                </Paper>
                              ))}
                            </Stack>
                          ) : (
                            <ScrollArea style={{ height: emailPreviewDetailsHeight }}>
                              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                {emailPreview.failureReason}
                              </Text>
                            </ScrollArea>
                          )}
                        </Stack>
                      </Paper>
                    )}

                    <Divider my="xs" />

                    {emailPreviewHtml ? (
                      <Paper withBorder radius="md" p="sm">
                        <Box style={{ height: emailPreviewPaneHeight }}>
                          <iframe
                            title="Email HTML preview"
                            style={{ width: "100%", height: "100%", border: "none" }}
                            sandbox=""
                            srcDoc={emailPreviewHtml}
                          />
                        </Box>
                      </Paper>
                    ) : emailPreviewBody ? (
                      <Paper withBorder radius="md" p="sm">
                        <ScrollArea style={{ height: emailPreviewPaneHeight }}>
                          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                            {emailPreviewBody}
                          </Text>
                        </ScrollArea>
                      </Paper>
                    ) : (
                      <Alert color="yellow" title="No preview content">
                        No body text is available for this email.
                      </Alert>
                    )}
                  </>
                )}
              </Stack>
            </Modal>
          </Stack>
        )}
      </Stack>
    </PageAccessGuard>
  );
};

export default BookingsPage;



