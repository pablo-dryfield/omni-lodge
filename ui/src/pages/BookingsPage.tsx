import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Textarea,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconFilter,
  IconInbox,
  IconMail,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
} from "@tabler/icons-react";
import dayjs, { Dayjs } from "dayjs";
import { useAppDispatch } from "../store/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { BookingsGrid } from "../components/BookingsGrid";
import BookingsSanityCheck from "../components/bookings/BookingsSanityCheck";
import BookingsSummaryWorkspace from "../components/bookings/BookingsSummaryWorkspace";
import axiosInstance from "../utils/axiosInstance";
import { UnifiedOrder, UnifiedProduct } from "../store/bookingPlatformsTypes";
import { prepareBookingGrid, BookingGrid } from "../utils/prepareBookingGrid";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";
import {
  serializeProductTypeSelection,
} from "../utils/productTypeQuery";
import {
  parseBookingsSummaryDate,
  parseBookingsSummaryDateField,
  parseBookingsSummaryMetric,
  parseBookingsSummaryPreset,
  parseBookingsSummaryProductTypes,
  type BookingsSummaryDateField,
  type BookingsSummaryFilters,
  type BookingsSummaryMetric,
  type BookingsSummaryPreset,
} from "../utils/bookingsSummaryQuery";

const DATE_FORMAT = "YYYY-MM-DD";

type ViewMode = "week" | "month";

type FetchStatus = "idle" | "loading" | "error" | "success";

type BookingFilter = "all" | "active" | "cancelled";
type SummaryDateField = BookingsSummaryDateField;
type SummaryMetricMode = BookingsSummaryMetric;
type SummaryDatePreset = BookingsSummaryPreset;
type BookingsTab = "calendar" | "summary" | "emails" | "sanity";
type BookingsTabOption = BookingsTab | "manifest" | "payment-links";
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

type CreateEmailForm = {
  to: string;
  subject: string;
  body: string;
};

type EmailTemplateType = "plain_text" | "react_email";

type EmailTemplate = {
  id: number;
  name: string;
  description: string | null;
  templateType: EmailTemplateType;
  subjectTemplate: string;
  bodyTemplate: string;
  isActive: boolean;
};

type EmailTemplateListResponse = {
  templates: EmailTemplate[];
};

type CreateEmailTemplateState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  templates: EmailTemplate[];
  selectedTemplateId: string | null;
  name: string;
  description: string;
  templateType: EmailTemplateType;
};

const DEFAULT_EMAIL_DATE_RANGE: [Date | null, Date | null] = [null, null];
const DEFAULT_CREATE_EMAIL_FORM: CreateEmailForm = {
  to: "",
  subject: "",
  body: "",
};
const createDefaultEmailTemplateState = (): CreateEmailTemplateState => ({
  loading: false,
  saving: false,
  error: null,
  success: null,
  templates: [],
  selectedTemplateId: null,
  name: "",
  description: "",
  templateType: "plain_text",
});
const BOOKING_TAB_OPTIONS: BookingTabOption[] = [
  { value: "calendar", label: "Calendar" },
  { value: "manifest", label: "Manifest" },
  { value: "payment-links", label: "Payment Links" },
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
    normalized === "manifest" ||
    normalized === "payment-links"
  ) {
    return normalized as BookingsTabOption;
  }
  return null;
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
    const extras = order.extras ?? { tshirts: 0, cocktails: 0, photos: 0 };
    const extrasQuantity =
      (Number.isFinite(extras.tshirts) ? extras.tshirts : 0) +
      (Number.isFinite(extras.cocktails) ? extras.cocktails : 0) +
      (Number.isFinite(extras.photos) ? extras.photos : 0);
    return order.status !== "cancelled" && (quantity > 0 || extrasQuantity > 0);
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
  const [summaryProductTypeFilters, setSummaryProductTypeFilters] = useState<string[]>([]);
  const [rangeAnchor, setRangeAnchor] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [calendarScrollDate, setCalendarScrollDate] = useState<string | null>(null);
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
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
  const [backfillMailbox, setBackfillMailbox] = useState<"primary" | "backup">("primary");
  const [emailAdvancedFiltersOpen, setEmailAdvancedFiltersOpen] = useState(false);
  const [createEmailOpen, setCreateEmailOpen] = useState(false);
  const [createEmailForm, setCreateEmailForm] = useState<CreateEmailForm>(() => ({
    ...DEFAULT_CREATE_EMAIL_FORM,
  }));
  const [createEmailSending, setCreateEmailSending] = useState(false);
  const [createEmailError, setCreateEmailError] = useState<string | null>(null);
  const [createEmailSuccess, setCreateEmailSuccess] = useState<string | null>(null);
  const [createEmailTemplateState, setCreateEmailTemplateState] = useState<CreateEmailTemplateState>(
    createDefaultEmailTemplateState,
  );
  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState(false);

  const suppressUrlStateSyncRef = useRef(false);
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

  const summaryProductTypesParam = searchParams.get("summaryProductTypes");
  const summaryProductTypeParam = searchParams.get("summaryProductType");
  const emailPreviewParam = searchParams.get("emailPreview")?.trim() ?? "";
  const emailHasUrlPreview = Boolean(emailPreviewParam);

  const summaryProductTypeIdsParam = useMemo(
    () =>
      serializeProductTypeSelection(
        summaryProductTypeFilters,
        [],
        { omitWhenAllSelected: false },
      ),
    [summaryProductTypeFilters],
  );
  const summaryFilters = useMemo<BookingsSummaryFilters>(
    () => ({
      summaryDateField,
      summaryProductTypes: summaryProductTypeFilters,
      summaryPreset: summaryDatePreset,
      summaryMetric: summaryMetricMode,
      summaryStart: summaryCustomDateRange[0]
        ? dayjs(summaryCustomDateRange[0]).format(DATE_FORMAT)
        : null,
      summaryEnd: summaryCustomDateRange[1]
        ? dayjs(summaryCustomDateRange[1]).format(DATE_FORMAT)
        : null,
    }),
    [
      summaryCustomDateRange,
      summaryDateField,
      summaryDatePreset,
      summaryMetricMode,
      summaryProductTypeFilters,
    ],
  );
  const handleSummaryFiltersChange = useCallback((next: BookingsSummaryFilters) => {
    setSummaryDateField(next.summaryDateField);
    setSummaryProductTypeFilters(next.summaryProductTypes);
    setSummaryDatePreset(next.summaryPreset);
    setSummaryMetricMode(next.summaryMetric);
    setSummaryCustomDateRange([
      next.summaryStart ? dayjs(next.summaryStart).toDate() : null,
      next.summaryEnd ? dayjs(next.summaryEnd).toDate() : null,
    ]);
  }, []);

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
      if (value === "payment-links") {
        navigate("/bookings/payment-links");
        return;
      }
      setActiveTab((value as BookingsTab) ?? "calendar");
    },
    [navigate, openManifestForCurrentDate],
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
    // Hydrate component state from the new location before any state-to-URL writer runs.
    suppressUrlStateSyncRef.current = true;
  }, [searchParams]);

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
    if (nextTab === "payment-links") {
      navigate("/bookings/payment-links");
      return;
    }
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [emailPreviewParam, navigate, openManifestForCurrentDate, searchParams]);

  useEffect(() => {
    const nextDateField = parseBookingsSummaryDateField(searchParams.get("summaryDateField"));
    setSummaryDateField((prev) => (prev === nextDateField ? prev : nextDateField));
  }, [searchParams]);

  useEffect(() => {
    const nextProductTypes = parseBookingsSummaryProductTypes(
      summaryProductTypesParam,
      summaryProductTypeParam,
    );
    setSummaryProductTypeFilters((prev) => {
      const prevKey = [...prev].sort().join(",");
      const nextKey = [...nextProductTypes].sort().join(",");
      return prevKey === nextKey ? prev : nextProductTypes;
    });
  }, [summaryProductTypeParam, summaryProductTypesParam]);

  useEffect(() => {
    const nextPreset = parseBookingsSummaryPreset(searchParams.get("summaryPreset"));
    setSummaryDatePreset((prev) => (prev === nextPreset ? prev : nextPreset));
  }, [searchParams]);

  useEffect(() => {
    const summaryStartParam = parseBookingsSummaryDate(searchParams.get("summaryStart"));
    const summaryEndParam = parseBookingsSummaryDate(searchParams.get("summaryEnd"));
    const nextCustomRange: [Date | null, Date | null] = [
      summaryStartParam ? dayjs(summaryStartParam).toDate() : null,
      summaryEndParam ? dayjs(summaryEndParam).toDate() : null,
    ];
    setSummaryCustomDateRange((prev) => {
      const sameRange =
        (prev[0]?.getTime() ?? null) === (nextCustomRange[0]?.getTime() ?? null) &&
        (prev[1]?.getTime() ?? null) === (nextCustomRange[1]?.getTime() ?? null);
      return sameRange ? prev : nextCustomRange;
    });
  }, [searchParams]);

  useEffect(() => {
    const nextMetricMode = parseBookingsSummaryMetric(searchParams.get("summaryMetric"));
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
    if (suppressUrlStateSyncRef.current) {
      suppressUrlStateSyncRef.current = false;
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
    nextParams.delete("summaryProductType");
    setOptionalParam("summaryProductTypes", summaryProductTypeIdsParam ?? null);
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
    summaryProductTypeIdsParam,
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
      if (activeTab === "calendar") {
        setFetchStatus("loading");
      }
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

  const loadCreateEmailTemplates = async () => {
    setCreateEmailTemplateState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await axiosInstance.get<EmailTemplateListResponse>("/email-templates", {
        withCredentials: true,
      });
      const templates = Array.isArray(response.data?.templates) ? response.data.templates : [];
      setCreateEmailTemplateState((prev) => {
        const selectedTemplate = prev.selectedTemplateId
          ? templates.find((template) => String(template.id) === prev.selectedTemplateId) ?? null
          : null;
        return {
          ...prev,
          loading: false,
          templates,
          selectedTemplateId: selectedTemplate ? String(selectedTemplate.id) : null,
          name: selectedTemplate?.name ?? "",
          description: selectedTemplate?.description ?? "",
          templateType: selectedTemplate?.templateType ?? "plain_text",
        };
      });
    } catch (error) {
      setCreateEmailTemplateState((prev) => ({
        ...prev,
        loading: false,
        error: deriveErrorMessage(error),
      }));
    }
  };

  const handleOpenCreateEmail = () => {
    setCreateEmailForm({ ...DEFAULT_CREATE_EMAIL_FORM });
    setCreateEmailError(null);
    setCreateEmailSuccess(null);
    setCreateEmailTemplateState(createDefaultEmailTemplateState());
    setCreateEmailOpen(true);
    void loadCreateEmailTemplates();
  };

  const handleCloseCreateEmail = () => {
    if (createEmailSending) {
      return;
    }
    setCreateEmailOpen(false);
  };

  const handleCreateEmailField = (field: keyof CreateEmailForm, value: string) => {
    setCreateEmailForm((prev) => ({ ...prev, [field]: value }));
    setCreateEmailError(null);
    setCreateEmailSuccess(null);
  };

  const handleCreateEmailTemplateSelection = (value: string | null) => {
    if (!value) {
      setCreateEmailTemplateState((prev) => ({
        ...prev,
        selectedTemplateId: null,
        name: "",
        description: "",
        templateType: "plain_text",
        error: null,
        success: null,
      }));
      return;
    }

    const template = createEmailTemplateState.templates.find((entry) => String(entry.id) === value);
    if (!template) {
      return;
    }
    setCreateEmailForm((prev) => ({
      ...prev,
      subject: template.subjectTemplate,
      body: template.bodyTemplate,
    }));
    setCreateEmailTemplateState((prev) => ({
      ...prev,
      selectedTemplateId: String(template.id),
      name: template.name,
      description: template.description ?? "",
      templateType: template.templateType,
      error: null,
      success: null,
    }));
    setCreateEmailError(null);
  };

  const handleCreateEmailTemplateMetadata = (
    field: "name" | "description",
    value: string,
  ) => {
    setCreateEmailTemplateState((prev) => ({
      ...prev,
      [field]: value,
      error: null,
      success: null,
    }));
  };

  const handleCreateEmailTemplateType = (value: string | null) => {
    if (value !== "plain_text" && value !== "react_email") {
      return;
    }
    setCreateEmailTemplateState((prev) => ({
      ...prev,
      templateType: value,
      error: null,
      success: null,
    }));
  };

  const validateCreateEmailTemplate = (): {
    name: string;
    description: string | null;
    subjectTemplate: string;
    bodyTemplate: string;
  } | null => {
    const name = createEmailTemplateState.name.trim();
    const subjectTemplate = createEmailForm.subject.trim();
    const bodyTemplate = createEmailForm.body.trim();
    if (!name) {
      setCreateEmailTemplateState((prev) => ({ ...prev, error: "Template name is required." }));
      return null;
    }
    if (!subjectTemplate) {
      setCreateEmailTemplateState((prev) => ({ ...prev, error: "Subject is required to save a template." }));
      return null;
    }
    if (!bodyTemplate) {
      setCreateEmailTemplateState((prev) => ({ ...prev, error: "Message content is required to save a template." }));
      return null;
    }
    return {
      name,
      description: createEmailTemplateState.description.trim() || null,
      subjectTemplate,
      bodyTemplate,
    };
  };

  const handleSaveCreateEmailTemplate = async () => {
    if (createEmailTemplateState.saving) {
      return;
    }
    const fields = validateCreateEmailTemplate();
    if (!fields) {
      return;
    }
    setCreateEmailTemplateState((prev) => ({ ...prev, saving: true, error: null, success: null }));
    try {
      const response = await axiosInstance.post<EmailTemplate>(
        "/email-templates",
        {
          ...fields,
          templateType: createEmailTemplateState.templateType,
          isActive: true,
        },
        { withCredentials: true },
      );
      const created = response.data;
      setCreateEmailTemplateState((prev) => ({
        ...prev,
        saving: false,
        templates: [created, ...prev.templates.filter((template) => template.id !== created.id)],
        selectedTemplateId: String(created.id),
        name: created.name,
        description: created.description ?? "",
        templateType: created.templateType,
        success: `Template "${created.name}" saved.`,
      }));
    } catch (error) {
      setCreateEmailTemplateState((prev) => ({
        ...prev,
        saving: false,
        error: deriveErrorMessage(error),
      }));
    }
  };

  const handleUpdateCreateEmailTemplate = async () => {
    if (!createEmailTemplateState.selectedTemplateId || createEmailTemplateState.saving) {
      return;
    }
    const fields = validateCreateEmailTemplate();
    if (!fields) {
      return;
    }
    setCreateEmailTemplateState((prev) => ({ ...prev, saving: true, error: null, success: null }));
    try {
      const response = await axiosInstance.patch<EmailTemplate>(
        `/email-templates/${encodeURIComponent(createEmailTemplateState.selectedTemplateId)}`,
        {
          ...fields,
          templateType: createEmailTemplateState.templateType,
          isActive: true,
        },
        { withCredentials: true },
      );
      const updated = response.data;
      setCreateEmailTemplateState((prev) => ({
        ...prev,
        saving: false,
        templates: prev.templates.map((template) => template.id === updated.id ? updated : template),
        name: updated.name,
        description: updated.description ?? "",
        templateType: updated.templateType,
        success: `Template "${updated.name}" updated.`,
      }));
    } catch (error) {
      setCreateEmailTemplateState((prev) => ({
        ...prev,
        saving: false,
        error: deriveErrorMessage(error),
      }));
    }
  };

  const handleSendCreatedEmail = async () => {
    if (createEmailSending) {
      return;
    }

    const to = createEmailForm.to.trim();
    const subject = createEmailForm.subject.trim();
    const body = createEmailForm.body.trim();
    if (!to) {
      setCreateEmailError("Enter the customer's email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setCreateEmailError("Enter a valid email address.");
      return;
    }
    if (!subject) {
      setCreateEmailError("Enter a subject.");
      return;
    }
    if (!body) {
      setCreateEmailError("Write a message before sending.");
      return;
    }

    setCreateEmailSending(true);
    setCreateEmailError(null);
    setCreateEmailSuccess(null);
    try {
      const selectedTemplateId = createEmailTemplateState.selectedTemplateId
        ? Number.parseInt(createEmailTemplateState.selectedTemplateId, 10)
        : Number.NaN;
      await axiosInstance.post(
        "/bookings/emails/send",
        {
          to,
          subject,
          body,
          templateId: Number.isFinite(selectedTemplateId) ? selectedTemplateId : undefined,
          templateContext: {
            customerEmail: to,
            recipientEmail: to,
            email: to,
          },
        },
        { withCredentials: true },
      );
      setCreateEmailSuccess(`Email sent to ${to}.`);
      setCreateEmailForm({ ...DEFAULT_CREATE_EMAIL_FORM });
      window.dispatchEvent(new CustomEvent("customer-email-actions-changed"));
    } catch (error) {
      setCreateEmailError(deriveErrorMessage(error));
    } finally {
      setCreateEmailSending(false);
    }
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
    setBackfillMailbox("primary");
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
    if (
      backfillMailbox === "backup"
      && !window.confirm(
        "Use the backup Gmail mailbox for this backfill? Only messages that already exist in the backup mailbox can be recovered.",
      )
    ) {
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
          mailbox: backfillMailbox,
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
    if (!modulePermissions.ready || !modulePermissions.canView || activeTab !== "calendar") {
      return;
    }

    const controller = new AbortController();
    const startIso = rangeStart.startOf("day").format(DATE_FORMAT);
    const endIso = rangeEnd.endOf("day").format(DATE_FORMAT);

    const fetchOrders = async () => {
      setFetchStatus("loading");
      setErrorMessage(null);
      try {
        const response = await axiosInstance.get("/bookings", {
          params: {
            pickupFrom: startIso,
            pickupTo: endIso,
            dateField: "experience_date",
            limit: 200,
          },
          signal: controller.signal,
          withCredentials: true,
        });
        setProducts(Array.isArray(response.data?.products) ? response.data.products : []);
        setOrders(Array.isArray(response.data?.orders) ? response.data.orders : []);
        setFetchStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setFetchStatus("error");
        setErrorMessage(deriveErrorMessage(error));
      }
    };

    fetchOrders();

    return () => {
      controller.abort();
    };
  }, [
    activeTab,
    modulePermissions.canView,
    modulePermissions.ready,
    rangeEnd,
    rangeStart,
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
  const emailAdvancedFilterCount = [
    emailFilters.subject,
    emailFilters.from,
    emailFilters.to,
    emailFilters.messageId,
    emailFilters.threadId,
    emailFilters.platformOrderId,
    emailDateRange[0] || emailDateRange[1],
  ].filter(Boolean).length;
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
                {(activeTab === "calendar" || activeTab === "summary") && (
                  <ActionIcon
                    variant={isFilterPanelVisible ? "filled" : "subtle"}
                    size="lg"
                    aria-label={isFilterPanelVisible ? "Hide filters panel" : "Show filters panel"}
                    onClick={() => setIsFilterPanelVisible((prev) => !prev)}
                  >
                    <IconFilter size={18} />
                  </ActionIcon>
                )}
              </Group>
              <Title order={2} ta="center">
                Bookings
              </Title>
              <Group justify="flex-end">
                {activeTab !== "emails" && (
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
                )}
              </Group>
            </Box>

            {activeTab === "calendar" && (
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
            {isFilterPanelVisible && (activeTab === "calendar" || activeTab === "summary") && (
              <Group gap="sm" wrap="wrap" align="center" justify="center">
                {activeTab === "calendar" && (
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
                {activeTab === "calendar" && (
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
                {activeTab === "calendar" && (
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
                  <Tabs.Tab value="payment-links">Payment Links</Tabs.Tab>
                  <Tabs.Tab value="summary">Summary</Tabs.Tab>
                  <Tabs.Tab value="emails">Emails</Tabs.Tab>
                  <Tabs.Tab value="sanity">Sanity Check</Tabs.Tab>
                </Tabs.List>
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
                <BookingsSummaryWorkspace
                  filters={summaryFilters}
                  onFiltersChange={handleSummaryFiltersChange}
                  productTypesExplicit={
                    summaryProductTypesParam !== null || summaryProductTypeParam !== null
                  }
                  filtersVisible={isFilterPanelVisible}
                  onFiltersVisibleChange={setIsFilterPanelVisible}
                  refreshToken={reloadToken}
                />
              </Tabs.Panel>

              <Tabs.Panel value="emails" pt="md">
                <Stack gap="md">
                  <Group justify="flex-end" gap="sm" wrap="wrap" grow={isMobile}>
                    <Button
                      variant="default"
                      leftSection={<IconRefresh size={17} />}
                      onClick={handleReload}
                      loading={ingestStatus === "loading"}
                    >
                      Sync inbox
                    </Button>
                    <Button leftSection={<IconPlus size={17} />} onClick={handleOpenCreateEmail}>
                      Create email
                    </Button>
                  </Group>

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

                  <Paper withBorder radius="lg" p="md">
                    <Stack gap="md">
                      <Group align="flex-end" gap="sm" wrap="wrap">
                        <TextInput
                          label="Search inbox"
                          placeholder="Customer, subject, message or booking..."
                          leftSection={<IconSearch size={17} />}
                          value={emailFilters.search}
                          onChange={(event) => handleEmailFilterValue("search", event.currentTarget.value)}
                          style={{ flex: "1 1 360px" }}
                        />
                        <Select
                          label="Status"
                          data={EMAIL_STATUS_OPTIONS}
                          value={emailFilters.status}
                          onChange={(value) => handleEmailFilterValue("status", value ?? "all")}
                          allowDeselect={false}
                          w={isMobile ? "100%" : 190}
                        />
                        <Button
                          variant="default"
                          leftSection={<IconFilter size={17} />}
                          rightSection={emailAdvancedFiltersOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                          onClick={() => setEmailAdvancedFiltersOpen((prev) => !prev)}
                        >
                          Advanced filters
                          {emailAdvancedFilterCount > 0 && (
                            <Badge ml="xs" size="sm" variant="filled">{emailAdvancedFilterCount}</Badge>
                          )}
                        </Button>
                        {hasEmailFilters && (
                          <Button variant="subtle" color="gray" onClick={handleClearEmailFilters}>
                            Clear all
                          </Button>
                        )}
                      </Group>

                      {emailAdvancedFiltersOpen && (
                        <>
                          <Divider />
                          <SimpleGrid cols={isMobile ? 1 : isTablet ? 2 : 4} spacing="sm">
                            <DatePickerInput
                              type="range"
                              label="Received date"
                              placeholder="All time"
                              value={emailDateRange}
                              onChange={(value) => {
                                setEmailDateRange(value);
                                setEmailPage(1);
                              }}
                              valueFormat="YYYY-MM-DD"
                              clearable
                            />
                            <TextInput
                              label="Subject"
                              placeholder="Subject contains..."
                              value={emailFilters.subject}
                              onChange={(event) => handleEmailFilterValue("subject", event.currentTarget.value)}
                            />
                            <TextInput
                              label="From"
                              placeholder="sender@domain.com"
                              value={emailFilters.from}
                              onChange={(event) => handleEmailFilterValue("from", event.currentTarget.value)}
                            />
                            <TextInput
                              label="To"
                              placeholder="recipient@domain.com"
                              value={emailFilters.to}
                              onChange={(event) => handleEmailFilterValue("to", event.currentTarget.value)}
                            />
                            <TextInput
                              label="Booking / order ID"
                              placeholder="ABC123, XYZ789"
                              value={emailFilters.platformOrderId}
                              onChange={(event) => handleEmailFilterValue("platformOrderId", event.currentTarget.value)}
                            />
                            <TextInput
                              label="Message ID"
                              placeholder="Gmail message ID"
                              value={emailFilters.messageId}
                              onChange={(event) => handleEmailFilterValue("messageId", event.currentTarget.value)}
                            />
                            <TextInput
                              label="Thread ID"
                              placeholder="Gmail thread ID"
                              value={emailFilters.threadId}
                              onChange={(event) => handleEmailFilterValue("threadId", event.currentTarget.value)}
                            />
                          </SimpleGrid>
                          <Group justify="space-between" align="center" wrap="wrap">
                            <Text size="xs" c="dimmed">
                              Reprocessing and backfill are administrative recovery tools.
                            </Text>
                            <Group gap="xs" wrap="wrap">
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
                                disabled={(emailDateRange[0] === null && emailDateRange[1] === null) || backfillLoading}
                              >
                                Backfill date range
                              </Button>
                            </Group>
                          </Group>
                        </>
                      )}
                    </Stack>
                  </Paper>

                  {selectedEmailCount > 0 && (
                    <Paper withBorder radius="lg" p="sm" bg="blue.0">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Group gap="xs">
                          <Checkbox checked readOnly aria-label={`${selectedEmailCount} emails selected`} />
                          <Text size="sm" fw={600}>{selectedEmailCount} selected</Text>
                          <Button size="xs" variant="subtle" onClick={handleClearEmailSelection}>Clear</Button>
                        </Group>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => handleOpenBulkReprocess("selected")}
                          disabled={bulkReprocessLoading}
                        >
                          Reprocess selected
                        </Button>
                      </Group>
                    </Paper>
                  )}

                  <Group justify="space-between" align="center" wrap="wrap">
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" c="dimmed">Rows</Text>
                      <Select
                        size="xs"
                        data={EMAIL_PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
                        value={String(emailPageSize)}
                        onChange={handleEmailPageSizeChange}
                        allowDeselect={false}
                        w={90}
                      />
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" c="dimmed">
                        {emailTotal !== null
                          ? `${emailRangeStart}-${emailRangeEnd} of ${emailTotal}`
                          : `${emailRangeStart}-${emailRangeEnd}`}
                      </Text>
                      <ActionIcon variant="default" onClick={handleEmailPrevPage} disabled={!emailHasPrev || emailIsLoading} aria-label="Previous email page">
                        <IconArrowLeft size={16} />
                      </ActionIcon>
                      <ActionIcon variant="default" onClick={handleEmailNextPage} disabled={!emailHasMore || emailIsLoading} aria-label="Next email page">
                        <IconArrowRight size={16} />
                      </ActionIcon>
                    </Group>
                  </Group>

                  {emailIsLoading ? (
                    <Paper withBorder radius="lg" p="xl">
                      <Group justify="center" mih={220}><Loader variant="bars" /></Group>
                    </Paper>
                  ) : emailRecords.length === 0 ? (
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
              </Tabs.Panel>

              <Tabs.Panel value="sanity" pt="md">
                <BookingsSanityCheck />
              </Tabs.Panel>
            </Tabs>
            <Modal
              opened={createEmailOpen}
              onClose={handleCloseCreateEmail}
              title={
                <Group gap="sm">
                  <ThemeIcon variant="light" radius="xl"><IconMail size={18} /></ThemeIcon>
                  <Box>
                    <Text fw={700}>Create email</Text>
                    <Text size="xs" c="dimmed">Start a new customer conversation</Text>
                  </Box>
                </Group>
              }
              size="xl"
              centered
              closeOnClickOutside={!createEmailSending}
              closeOnEscape={!createEmailSending}
            >
              {createEmailSuccess ? (
                <Stack gap="lg" align="center" py="xl">
                  <ThemeIcon size={64} radius="xl" color="teal" variant="light">
                    <IconCheck size={32} />
                  </ThemeIcon>
                  <Box ta="center">
                    <Title order={3}>Email sent</Title>
                    <Text c="dimmed" mt={4}>{createEmailSuccess}</Text>
                  </Box>
                  <Group>
                    <Button variant="default" onClick={handleCloseCreateEmail}>Close</Button>
                    <Button
                      leftSection={<IconPlus size={16} />}
                      onClick={() => {
                        setCreateEmailSuccess(null);
                        setCreateEmailForm({ ...DEFAULT_CREATE_EMAIL_FORM });
                        setCreateEmailTemplateState(createDefaultEmailTemplateState());
                        void loadCreateEmailTemplates();
                      }}
                    >
                      Write another
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <Stack gap="md">
                  <Alert color="blue" variant="light" icon={<IconInbox size={18} />}>
                    This starts a new email thread. Continue an existing customer conversation from its pending email request so the reply stays in the same thread.
                  </Alert>
                  {createEmailError && (
                    <Alert color="red" title="Email could not be sent">
                      {createEmailError}
                    </Alert>
                  )}
                  {createEmailTemplateState.error && (
                    <Alert color="red" title="Template error">
                      {createEmailTemplateState.error}
                    </Alert>
                  )}
                  {createEmailTemplateState.success && (
                    <Alert color="teal" title="Template saved">
                      {createEmailTemplateState.success}
                    </Alert>
                  )}

                  <Paper withBorder radius="lg" p="md">
                    <Stack gap="sm">
                      <Group align="flex-end" gap="sm" wrap="wrap">
                        <Select
                          label="Email template (optional)"
                          placeholder={
                            createEmailTemplateState.loading
                              ? "Loading templates..."
                              : "Write without a template"
                          }
                          data={createEmailTemplateState.templates.map((template) => ({
                            value: String(template.id),
                            label: `${template.name}${template.isActive ? "" : " (inactive)"}`,
                            disabled: !template.isActive,
                          }))}
                          value={createEmailTemplateState.selectedTemplateId}
                          onChange={handleCreateEmailTemplateSelection}
                          clearable
                          searchable
                          disabled={
                            createEmailTemplateState.loading ||
                            createEmailTemplateState.saving ||
                            createEmailSending
                          }
                          style={{ flex: "1 1 320px" }}
                        />
                        <Button
                          variant="default"
                          leftSection={<IconRefresh size={16} />}
                          onClick={() => void loadCreateEmailTemplates()}
                          loading={createEmailTemplateState.loading}
                          disabled={createEmailTemplateState.saving || createEmailSending}
                        >
                          Reload
                        </Button>
                      </Group>
                      {createEmailTemplateState.selectedTemplateId && createEmailTemplateState.description && (
                        <Text size="xs" c="dimmed">
                          {createEmailTemplateState.description}
                        </Text>
                      )}

                      <Accordion variant="contained" radius="md">
                        <Accordion.Item value="template-manager">
                          <Accordion.Control>Save or update a template</Accordion.Control>
                          <Accordion.Panel>
                            <Stack gap="sm">
                              <SimpleGrid cols={isMobile ? 1 : 2} spacing="sm">
                                <TextInput
                                  label="Template name"
                                  placeholder="Example: Customer follow-up"
                                  value={createEmailTemplateState.name}
                                  onChange={(event) =>
                                    handleCreateEmailTemplateMetadata("name", event.currentTarget.value)
                                  }
                                  disabled={createEmailTemplateState.saving || createEmailSending}
                                />
                                <Select
                                  label="Template format"
                                  data={[
                                    { value: "plain_text", label: "Plain text" },
                                    { value: "react_email", label: "React Email" },
                                  ]}
                                  value={createEmailTemplateState.templateType}
                                  onChange={handleCreateEmailTemplateType}
                                  allowDeselect={false}
                                  disabled={createEmailTemplateState.saving || createEmailSending}
                                />
                              </SimpleGrid>
                              <TextInput
                                label="Template description"
                                placeholder="Optional description"
                                value={createEmailTemplateState.description}
                                onChange={(event) =>
                                  handleCreateEmailTemplateMetadata("description", event.currentTarget.value)
                                }
                                disabled={createEmailTemplateState.saving || createEmailSending}
                              />
                              <Text size="xs" c="dimmed">
                                The current subject and message below will be saved as the template content.
                              </Text>
                              <Group justify="flex-end" wrap="wrap">
                                <Button
                                  variant="default"
                                  onClick={() => void handleSaveCreateEmailTemplate()}
                                  loading={createEmailTemplateState.saving}
                                  disabled={createEmailSending}
                                >
                                  Save as new template
                                </Button>
                                <Button
                                  variant="light"
                                  onClick={() => void handleUpdateCreateEmailTemplate()}
                                  loading={createEmailTemplateState.saving}
                                  disabled={
                                    !createEmailTemplateState.selectedTemplateId || createEmailSending
                                  }
                                >
                                  Update selected template
                                </Button>
                              </Group>
                            </Stack>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    </Stack>
                  </Paper>

                  <SimpleGrid cols={isMobile ? 1 : 2} spacing="lg">
                    <Stack gap="md">
                      <TextInput
                        label="To"
                        placeholder="customer@example.com"
                        leftSection={<IconMail size={16} />}
                        value={createEmailForm.to}
                        onChange={(event) => handleCreateEmailField("to", event.currentTarget.value)}
                        required
                        autoFocus
                      />
                      <TextInput
                        label="Subject"
                        placeholder="What is this email about?"
                        value={createEmailForm.subject}
                        onChange={(event) => handleCreateEmailField("subject", event.currentTarget.value)}
                        required
                      />
                      <Textarea
                        label={
                          createEmailTemplateState.templateType === "react_email"
                            ? "React Email source"
                            : "Message"
                        }
                        placeholder={
                          createEmailTemplateState.templateType === "react_email"
                            ? "Paste or edit the React Email template source..."
                            : "Write a clear, helpful message to the customer..."
                        }
                        value={createEmailForm.body}
                        onChange={(event) => handleCreateEmailField("body", event.currentTarget.value)}
                        minRows={10}
                        autosize
                        required
                      />
                    </Stack>
                    <Paper withBorder radius="lg" p="md" bg="gray.0" mih={330}>
                      <Stack gap="sm">
                        <Group gap="xs">
                          <IconMail size={16} />
                          <Text size="sm" fw={700}>Preview</Text>
                        </Group>
                        <Divider />
                        <Box>
                          <Text size="xs" c="dimmed">To</Text>
                          <Text size="sm" fw={500} style={{ wordBreak: "break-word" }}>
                            {createEmailForm.to.trim() || "Customer email"}
                          </Text>
                        </Box>
                        <Box>
                          <Text size="xs" c="dimmed">Subject</Text>
                          <Text fw={700} style={{ wordBreak: "break-word" }}>
                            {createEmailForm.subject.trim() || "Email subject"}
                          </Text>
                        </Box>
                        <Divider />
                        {createEmailTemplateState.templateType === "react_email" ? (
                          <Alert color="blue" variant="light">
                            The React Email template will be rendered by the email service when it is sent.
                          </Alert>
                        ) : (
                          <Text
                            size="sm"
                            c={createEmailForm.body.trim() ? undefined : "dimmed"}
                            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                          >
                            {createEmailForm.body.trim() || "Your message will appear here as you type."}
                          </Text>
                        )}
                      </Stack>
                    </Paper>
                  </SimpleGrid>
                  <Group justify="flex-end">
                    <Button variant="default" onClick={handleCloseCreateEmail} disabled={createEmailSending}>
                      Cancel
                    </Button>
                    <Button
                      leftSection={<IconSend size={17} />}
                      onClick={handleSendCreatedEmail}
                      loading={createEmailSending}
                      disabled={
                        !createEmailForm.to.trim() ||
                        !createEmailForm.subject.trim() ||
                        !createEmailForm.body.trim()
                      }
                    >
                      Send email
                    </Button>
                  </Group>
                </Stack>
              )}
            </Modal>
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
                  {`Backfill booking emails received between ${bulkRangeStartLabel} and ${bulkRangeEndLabel}?`}
                </Text>
                <Select
                  label="Gmail mailbox"
                  data={[
                    { value: "primary", label: "Primary mailbox" },
                    { value: "backup", label: "Backup mailbox" },
                  ]}
                  value={backfillMailbox}
                  onChange={(value) => setBackfillMailbox(value === "backup" ? "backup" : "primary")}
                  allowDeselect={false}
                />
                {backfillMailbox === "backup" ? (
                  <Alert color="orange" title="Backup mailbox selected">
                    This queries the backup Gmail account and can recover only messages already present there.
                    You will be asked to confirm again before it starts.
                  </Alert>
                ) : null}
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



