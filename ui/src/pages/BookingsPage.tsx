import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Accordion,
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Flex,
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
import { IconArrowLeft, IconArrowRight, IconCalendar, IconPlus, IconRefresh } from "@tabler/icons-react";
import dayjs, { Dayjs } from "dayjs";
import { useAppDispatch } from "../store/hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import { BookingsGrid } from "../components/BookingsGrid";
import axiosInstance from "../utils/axiosInstance";
import { OrderExtras, PlatformBreakdownEntry, UnifiedOrder, UnifiedProduct } from "../store/bookingPlatformsTypes";
import { prepareBookingGrid, BookingGrid } from "../utils/prepareBookingGrid";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import { useModuleAccess } from "../hooks/useModuleAccess";

const DATE_FORMAT = "YYYY-MM-DD";

type ViewMode = "week" | "month";

type FetchStatus = "idle" | "loading" | "error" | "success";

type BookingFilter = "all" | "active" | "cancelled";

type PendingGroup = {
  platformBookingId: string;
  date: string;
  timeslot: string;
  pickupLabel: string;
  customerName: string;
  customerPhone?: string;
  productNames: string[];
  totalPeople: number;
  menCount: number;
  womenCount: number;
};

type PendingDiff = {
  platformBookingId: string;
  ecwid: PendingGroup;
  db: PendingGroup;
  differences: Array<{ field: string; ecwid: string; db: string }>;
  hasDateMismatch: boolean;
};

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

const PLATFORM_COLORS: Record<string, string> = {
  ecwid: "orange",
  fareharbor: "blue",
  viator: "teal",
  getyourguide: "grape",
  freetour: "gray",
  xperiencepoland: "red",
  airbnb: "pink",
  unknown: "dark",
};

const normalizePlatformKey = (value?: string | null): string => {
  if (!value) {
    return "unknown";
  }
  const key = value.toLowerCase().trim();
  return PLATFORM_COLORS[key] ? key : "unknown";
};

const formatPlatformLabel = (value?: string | null): string => {
  const safe = value ?? "Unknown";
  return safe
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
};

const resolvePlatformColor = (value?: string | null): string => {
  const key = normalizePlatformKey(value);
  return PLATFORM_COLORS[key] ?? PLATFORM_COLORS.unknown;
};

const PlatformBadge = ({ platform }: { platform?: string }) => {
  if (!platform) {
    return null;
  }
  return (
    <Badge variant="light" color={resolvePlatformColor(platform)} size="sm">
      {formatPlatformLabel(platform)}
    </Badge>
  );
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
};

const DEFAULT_EMAIL_DATE_RANGE: [Date | null, Date | null] = [null, null];

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

const parseTabParam = (value?: string | null): "calendar" | "summary" | "pending" | "emails" | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "calendar" || normalized === "summary" || normalized === "pending" || normalized === "emails") {
    return normalized as "calendar" | "summary" | "pending" | "emails";
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

type BookingSummaryStats = {
  totalOrders: number;
  totalPeople: number;
  men: number;
  women: number;
  extras: OrderExtras;
  platformBreakdown: PlatformBreakdownEntry[];
};

const emptyExtras = (): OrderExtras => ({ tshirts: 0, cocktails: 0, photos: 0 });

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

const computeSummaryStats = (orders: UnifiedOrder[]): BookingSummaryStats => {
  const extras = emptyExtras();
  const platformMap = new Map<string, PlatformBreakdownEntry>();

  let men = 0;
  let women = 0;
  let totalPeople = 0;

  orders.forEach((order) => {
    const menCount = Number.isFinite(order.menCount) ? order.menCount : 0;
    const womenCount = Number.isFinite(order.womenCount) ? order.womenCount : 0;
    const fallback = Number.isFinite(order.quantity) ? order.quantity : 0;
    const participants = menCount + womenCount > 0 ? menCount + womenCount : fallback;

    men += menCount;
    women += womenCount;
    totalPeople += participants;

    extras.tshirts += order.extras?.tshirts ?? 0;
    extras.cocktails += order.extras?.cocktails ?? 0;
    extras.photos += order.extras?.photos ?? 0;

    const platformKey = order.platform ?? "unknown";
    const bucket =
      platformMap.get(platformKey) ??
      {
        platform: platformKey,
        totalPeople: 0,
        men: 0,
        women: 0,
        orderCount: 0,
      };

    bucket.totalPeople += participants;
    bucket.men += menCount;
    bucket.women += womenCount;
    bucket.orderCount += 1;
    platformMap.set(platformKey, bucket);
  });

  const platformBreakdown = Array.from(platformMap.values()).sort((a, b) =>
    a.platform.localeCompare(b.platform),
  );

  return {
    totalOrders: orders.length,
    totalPeople,
    men,
    women,
    extras,
    platformBreakdown,
  };
};

const formatExtrasSummary = (extras: OrderExtras): string => {
  const tokens: string[] = [];
  if (extras.tshirts > 0) tokens.push(`T-Shirts: ${extras.tshirts}`);
  if (extras.cocktails > 0) tokens.push(`Cocktails: ${extras.cocktails}`);
  if (extras.photos > 0) tokens.push(`Photos: ${extras.photos}`);
  return tokens.join(" • ");
};

const formatOrderExtras = (extras?: OrderExtras): string => {
  if (!extras) {
    return "—";
  }
  const parts: string[] = [];
  if (extras.tshirts > 0) parts.push(`${extras.tshirts} tee${extras.tshirts === 1 ? "" : "s"}`);
  if (extras.cocktails > 0) parts.push(`${extras.cocktails} cocktail${extras.cocktails === 1 ? "" : "s"}`);
  if (extras.photos > 0) parts.push(`${extras.photos} photo${extras.photos === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : "—";
};

const derivePickupMoment = (order: UnifiedOrder) => {
  const candidate = dayjs(`${order.date} ${order.timeslot}`, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD H:mm"], true);
  if (candidate.isValid()) {
    return candidate;
  }
  if (order.pickupDateTime) {
    const parsed = dayjs(order.pickupDateTime);
    if (parsed.isValid()) {
      return parsed;
    }
  }
  return null;
};

const formatPickupLabel = (order: UnifiedOrder): string => {
  const moment = derivePickupMoment(order);
  if (moment) {
    return moment.format("ddd, MMM D • HH:mm");
  }
  return `${order.date} ${order.timeslot}`;
};
const formatPendingCounts = (order: UnifiedOrder) => {
  const men = Number.isFinite(order.menCount) ? order.menCount : 0;
  const women = Number.isFinite(order.womenCount) ? order.womenCount : 0;
  const fallback = Number.isFinite(order.quantity) ? order.quantity : 0;
  const total = men + women > 0 ? men + women : fallback;
  return { men, women, total };
};

const groupOrdersByBookingId = (orders: UnifiedOrder[]): PendingGroup[] => {
  const groups = new Map<
    string,
    {
      group: PendingGroup;
      pickupMoment: Dayjs | null;
      products: Set<string>;
    }
  >();

  orders.forEach((order) => {
    if (!order.platformBookingId) {
      return;
    }
    const pickupMoment = derivePickupMoment(order);
    const displayLabel = formatPickupLabel(order);
    const { men, women, total } = formatPendingCounts(order);
    const existing = groups.get(order.platformBookingId);

    if (!existing) {
      const products = new Set<string>();
      if (order.productName) {
        products.add(order.productName);
      }
      groups.set(order.platformBookingId, {
        products,
        pickupMoment,
        group: {
          platformBookingId: order.platformBookingId,
          date: order.date,
          timeslot: order.timeslot,
          pickupLabel: displayLabel,
          customerName: order.customerName || "Unknown",
          customerPhone: order.customerPhone,
          productNames: order.productName ? [order.productName] : [],
          totalPeople: total,
          menCount: men,
          womenCount: women,
        },
      });
      return;
    }

    if (order.productName) {
      existing.products.add(order.productName);
    }
    existing.group.totalPeople += total;
    existing.group.menCount += men;
    existing.group.womenCount += women;
    if (!existing.group.customerName && order.customerName) {
      existing.group.customerName = order.customerName;
    }
    if (!existing.group.customerPhone && order.customerPhone) {
      existing.group.customerPhone = order.customerPhone;
    }

    if (!existing.pickupMoment || (pickupMoment && pickupMoment.isBefore(existing.pickupMoment))) {
      existing.pickupMoment = pickupMoment;
      existing.group.date = order.date;
      existing.group.timeslot = order.timeslot;
      existing.group.pickupLabel = displayLabel;
    }
  });

  return Array.from(groups.values())
    .map(({ group, products, pickupMoment }) => ({
      ...group,
      productNames: Array.from(products.values()),
      pickupMoment,
    }))
    .sort((a, b) => {
      const momentA = dayjs(`${a.date} ${a.timeslot}`, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD H:mm"], true);
      const momentB = dayjs(`${b.date} ${b.timeslot}`, ["YYYY-MM-DD HH:mm", "YYYY-MM-DD H:mm"], true);
      if (momentA.isValid() && momentB.isValid()) {
        if (momentA.isBefore(momentB)) return -1;
        if (momentA.isAfter(momentB)) return 1;
      }
      return a.platformBookingId.localeCompare(b.platformBookingId);
    })
    .map(({ pickupMoment, ...rest }) => rest);
};

const formatPendingProducts = (products: string[]): string => {
  const unique = Array.from(new Set(products.filter(Boolean)));
  if (unique.length === 0) {
    return "Unknown product";
  }
  return unique.sort((a, b) => a.localeCompare(b)).join(", ");
};

const normalizePendingText = (value?: string | null): string => (value ?? "").trim().toLowerCase();

const normalizePendingPhone = (value?: string | null): string =>
  (value ?? "").trim().replace(/[^\d+]/g, "");

const buildPendingDiffs = (ecwidGroups: PendingGroup[], dbGroups: PendingGroup[]): PendingDiff[] => {
  const dbMap = new Map(dbGroups.map((group) => [group.platformBookingId, group]));
  const diffs: PendingDiff[] = [];

  ecwidGroups.forEach((ecwid) => {
    const db = dbMap.get(ecwid.platformBookingId);
    if (!db) {
      return;
    }

    const differences: Array<{ field: string; ecwid: string; db: string }> = [];
    const ecwidPickup = `${ecwid.date} ${ecwid.timeslot}`;
    const dbPickup = `${db.date} ${db.timeslot}`;
    const hasDateMismatch = ecwidPickup !== dbPickup;
    if (hasDateMismatch) {
      differences.push({
        field: "Pickup",
        ecwid: ecwid.pickupLabel,
        db: db.pickupLabel,
      });
    }

    const ecwidProducts = formatPendingProducts(ecwid.productNames);
    const dbProducts = formatPendingProducts(db.productNames);
    if (normalizePendingText(ecwidProducts) !== normalizePendingText(dbProducts)) {
      differences.push({
        field: "Product",
        ecwid: ecwidProducts,
        db: dbProducts,
      });
    }

    if (ecwid.totalPeople !== db.totalPeople) {
      differences.push({
        field: "People",
        ecwid: String(ecwid.totalPeople),
        db: String(db.totalPeople),
      });
    }

    if (ecwid.menCount !== db.menCount) {
      differences.push({
        field: "Men",
        ecwid: String(ecwid.menCount),
        db: String(db.menCount),
      });
    }

    if (ecwid.womenCount !== db.womenCount) {
      differences.push({
        field: "Women",
        ecwid: String(ecwid.womenCount),
        db: String(db.womenCount),
      });
    }

    if (normalizePendingText(ecwid.customerName) !== normalizePendingText(db.customerName)) {
      differences.push({
        field: "Customer",
        ecwid: ecwid.customerName,
        db: db.customerName,
      });
    }

    if (normalizePendingPhone(ecwid.customerPhone) !== normalizePendingPhone(db.customerPhone)) {
      differences.push({
        field: "Phone",
        ecwid: ecwid.customerPhone ?? "-",
        db: db.customerPhone ?? "-",
      });
    }

    if (differences.length > 0) {
      diffs.push({
        platformBookingId: ecwid.platformBookingId,
        ecwid,
        db,
        differences,
        hasDateMismatch,
      });
    }
  });

  return diffs.sort((a, b) => a.platformBookingId.localeCompare(b.platformBookingId));
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

const formatRangeLabel = (start: Dayjs, end: Dayjs, mode: ViewMode): string => {
  if (mode === "month") {
    return start.format("MMMM YYYY");
  }

  if (start.isSame(end, "day")) {
    return start.format("D MMM YYYY");
  }

  return `${start.format("D MMM")} - ${end.format("D MMM YYYY")}`;
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
  const [activeTab, setActiveTab] = useState<"calendar" | "summary" | "pending" | "emails">("calendar");
  const [rangeAnchor, setRangeAnchor] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().startOf("day"));
  const [calendarScrollDate, setCalendarScrollDate] = useState<string | null>(null);
  const [products, setProducts] = useState<UnifiedProduct[]>([]);
  const [orders, setOrders] = useState<UnifiedOrder[]>([]);
  const [pendingOrders, setPendingOrders] = useState<UnifiedOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<BookingFilter>("active");
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<FetchStatus>("idle");
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingCreateId, setPendingCreateId] = useState<string | null>(null);
  const [pendingCreateError, setPendingCreateError] = useState<string | null>(null);
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

  const suppressEmailUrlSyncRef = useRef(false);
  const suppressEmailPreviewSyncRef = useRef(false);

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
      (debouncedEmailFilters.status && debouncedEmailFilters.status !== "all"),
  );
  const emailIncludeTotal = emailHasDateRange || emailHasSearchFilters;

  const emailPreviewParam = searchParams.get("emailPreview")?.trim() ?? "";
  const emailHasUrlPreview = Boolean(emailPreviewParam);

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
    setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [emailPreviewParam, searchParams]);

  useEffect(() => {
    const nextFilters = {
      search: searchParams.get("emailSearch") ?? "",
      subject: searchParams.get("emailSubject") ?? "",
      from: searchParams.get("emailFrom") ?? "",
      to: searchParams.get("emailTo") ?? "",
      status: parseEmailStatusParam(searchParams.get("emailStatus")),
      messageId: searchParams.get("emailMessageId") ?? "",
      threadId: searchParams.get("emailThreadId") ?? "",
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

  const rangeLabel = useMemo(() => formatRangeLabel(rangeStart, rangeEnd, viewMode), [rangeStart, rangeEnd, viewMode]);

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

  const handleGoToToday = () => {
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
  };

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

  const handleCreateEcwidBooking = async (orderId: string) => {
    if (!orderId || pendingCreateId) {
      return;
    }
    setPendingCreateId(orderId);
    setPendingCreateError(null);
    try {
      await axiosInstance.post(
        "/bookings/import-ecwid",
        { orderId },
        { withCredentials: true },
      );
      setReloadToken((token) => token + 1);
    } catch (error) {
      setPendingCreateError(deriveErrorMessage(error));
    } finally {
      setPendingCreateId(null);
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

    const controller = new AbortController();
    const startIso = rangeStart.startOf("day").format('YYYY-MM-DD');
    const endIso = rangeEnd.endOf("day").format('YYYY-MM-DD');

    const fetchOrders = async () => {
      setFetchStatus("loading");
      setErrorMessage(null);

      try {
        const response = await axiosInstance.get("/bookings", {
          params: {
            pickupFrom: startIso,
            pickupTo: endIso,
            limit: 200,
          },
          signal: controller.signal,
          withCredentials: true,
        });
        const productsPayload = Array.isArray(response.data?.products) ? response.data.products : [];
        const ordersPayload = Array.isArray(response.data?.orders) ? response.data.orders : [];

        setProducts(productsPayload as UnifiedProduct[]);
        setOrders(ordersPayload as UnifiedOrder[]);
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
  }, [modulePermissions.ready, modulePermissions.canView, rangeStart, rangeEnd, reloadToken]);

  useEffect(() => {
    if (!modulePermissions.ready || !modulePermissions.canView) {
      return;
    }
    if (activeTab !== "pending") {
      return;
    }

    const controller = new AbortController();
    const startIso = rangeStart.startOf("day").format("YYYY-MM-DD");
    const endIso = rangeEnd.endOf("day").format("YYYY-MM-DD");

    const fetchPendingOrders = async () => {
      setPendingStatus("loading");
      setPendingError(null);

      try {
        const aggregated: UnifiedOrder[] = [];
        let offset = 0;
        const limit = 200;

        while (true) {
          const response = await axiosInstance.get("/ecwid/orders", {
            params: {
              pickupFrom: startIso,
              pickupTo: endIso,
              limit: String(limit),
              offset: String(offset),
            },
            signal: controller.signal,
            withCredentials: true,
          });
          const batch = Array.isArray(response.data?.orders) ? response.data.orders : [];
          const count = Number(response.data?.count ?? batch.length);
          const total = Number(response.data?.total ?? 0);

          aggregated.push(...(batch as UnifiedOrder[]));

          if (!count || count < limit) {
            break;
          }
          offset += count;
          if (total && offset >= total) {
            break;
          }
        }

        setPendingOrders(aggregated);
        setPendingStatus("success");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setPendingStatus("error");
        setPendingError(deriveErrorMessage(error));
      }
    };

    fetchPendingOrders();

    return () => {
      controller.abort();
    };
  }, [
    modulePermissions.ready,
    modulePermissions.canView,
    activeTab,
    rangeStart,
    rangeEnd,
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

  const filteredOrders = useMemo(
    () => filterOrdersByStatus(orders, statusFilter),
    [orders, statusFilter],
  );

  const filteredProducts = useMemo(() => {
    if (statusFilter === "all") {
      return products;
    }
    const ids = new Set(filteredOrders.map((order) => order.productId));
    return products.filter((product) => ids.has(product.id));
  }, [products, filteredOrders, statusFilter]);

  const filteredDateRange = useMemo(() => {
    if (statusFilter === "all") {
      return dateRange;
    }
    const dates = new Set(filteredOrders.map((order) => order.date));
    return dateRange.filter((date) => dates.has(date));
  }, [dateRange, filteredOrders, statusFilter]);

  const grid: BookingGrid = useMemo(() => {
    return prepareBookingGrid(filteredProducts, filteredOrders, filteredDateRange);
  }, [filteredProducts, filteredOrders, filteredDateRange]);

  const summaryStats = useMemo(() => computeSummaryStats(filteredOrders), [filteredOrders]);

  const sortedOrders = useMemo(() => {
    const copy = [...filteredOrders];
    return copy.sort((a, b) => {
      const momentA = derivePickupMoment(a);
      const momentB = derivePickupMoment(b);
      if (momentA && momentB) {
        if (momentA.isBefore(momentB)) return -1;
        if (momentA.isAfter(momentB)) return 1;
      } else if (momentA && !momentB) {
        return -1;
      } else if (!momentA && momentB) {
        return 1;
      }
      if (a.productName !== b.productName) {
        return a.productName.localeCompare(b.productName);
      }
      return a.id.localeCompare(b.id);
    });
  }, [filteredOrders]);

  const dbEcwidOrders = useMemo(
    () => orders.filter((order) => (order.platform ?? "").toLowerCase() === "ecwid"),
    [orders],
  );

  const pendingGroupedEcwid = useMemo(
    () => groupOrdersByBookingId(pendingOrders),
    [pendingOrders],
  );

  const pendingGroupedDb = useMemo(
    () => groupOrdersByBookingId(dbEcwidOrders),
    [dbEcwidOrders],
  );

  const pendingMissingInDb = useMemo(() => {
    const dbIds = new Set(pendingGroupedDb.map((group) => group.platformBookingId));
    return pendingGroupedEcwid.filter((group) => !dbIds.has(group.platformBookingId));
  }, [pendingGroupedDb, pendingGroupedEcwid]);

  const pendingMissingInEcwid = useMemo(() => {
    const ecwidIds = new Set(pendingGroupedEcwid.map((group) => group.platformBookingId));
    return pendingGroupedDb.filter((group) => !ecwidIds.has(group.platformBookingId));
  }, [pendingGroupedDb, pendingGroupedEcwid]);

  const pendingMismatches = useMemo(
    () => buildPendingDiffs(pendingGroupedEcwid, pendingGroupedDb),
    [pendingGroupedEcwid, pendingGroupedDb],
  );

  const pendingDateMismatches = useMemo(
    () => pendingMismatches.filter((entry) => entry.hasDateMismatch),
    [pendingMismatches],
  );

  const pendingIsLoading = pendingStatus === "loading" && pendingOrders.length === 0;
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

  const renderPendingTable = (
    groups: PendingGroup[],
    options?: { showActions?: boolean; onAdd?: (id: string) => void },
  ) => (
    <Paper withBorder radius="lg" shadow="sm" p="md">
      <ScrollArea style={{ width: "100%" }}>
        <Table striped highlightOnHover withColumnBorders horizontalSpacing="md" verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Booking</Table.Th>
              <Table.Th>Pickup</Table.Th>
              <Table.Th>Customer</Table.Th>
              <Table.Th>Products</Table.Th>
              <Table.Th align="right">People</Table.Th>
              <Table.Th align="right">Men</Table.Th>
              <Table.Th align="right">Women</Table.Th>
              <Table.Th>Phone</Table.Th>
              {options?.showActions && <Table.Th>Actions</Table.Th>}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {groups.map((group) => (
              <Table.Tr key={group.platformBookingId}>
                <Table.Td>
                  <Text fw={600}>{group.platformBookingId}</Text>
                </Table.Td>
                <Table.Td>{group.pickupLabel}</Table.Td>
                <Table.Td>{group.customerName || "-"}</Table.Td>
                <Table.Td>{formatPendingProducts(group.productNames)}</Table.Td>
                <Table.Td align="right">{group.totalPeople}</Table.Td>
                <Table.Td align="right">{group.menCount}</Table.Td>
                <Table.Td align="right">{group.womenCount}</Table.Td>
                <Table.Td>{group.customerPhone ?? "-"}</Table.Td>
                {options?.showActions && (
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconPlus size={14} />}
                      loading={pendingCreateId === group.platformBookingId}
                      disabled={Boolean(pendingCreateId)}
                      onClick={() => options?.onAdd?.(group.platformBookingId)}
                    >
                      Add booking
                    </Button>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
  );

  const renderMismatchTable = (rows: PendingDiff[]) => (
    <Paper withBorder radius="lg" shadow="sm" p="md">
      <ScrollArea style={{ width: "100%" }}>
        <Table striped highlightOnHover withColumnBorders horizontalSpacing="md" verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Booking</Table.Th>
              <Table.Th>OmniLodge</Table.Th>
              <Table.Th>Ecwid</Table.Th>
              <Table.Th>Differences</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={row.platformBookingId}>
                <Table.Td>
                  <Text fw={600}>{row.platformBookingId}</Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="sm">{row.db.pickupLabel}</Text>
                    <Text size="sm">{formatPendingProducts(row.db.productNames)}</Text>
                    <Text size="sm">{`People: ${row.db.totalPeople} (M ${row.db.menCount} / W ${row.db.womenCount})`}</Text>
                    <Text size="sm">{row.db.customerName || "-"}</Text>
                    <Text size="sm" c="dimmed">
                      {row.db.customerPhone ?? "-"}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="sm">{row.ecwid.pickupLabel}</Text>
                    <Text size="sm">{formatPendingProducts(row.ecwid.productNames)}</Text>
                    <Text size="sm">{`People: ${row.ecwid.totalPeople} (M ${row.ecwid.menCount} / W ${row.ecwid.womenCount})`}</Text>
                    <Text size="sm">{row.ecwid.customerName || "-"}</Text>
                    <Text size="sm" c="dimmed">
                      {row.ecwid.customerPhone ?? "-"}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Stack gap={4}>
                    {row.differences.map((diff) => (
                      <Text key={`${row.platformBookingId}-${diff.field}`} size="sm">
                        {`${diff.field}: ${diff.db} → ${diff.ecwid}`}
                      </Text>
                    ))}
                  </Stack>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Paper>
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
        <Title order={2}>Bookings</Title>

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
            <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
              <Group gap="sm" wrap="wrap">
                <SegmentedControl
                  value={viewMode}
                  onChange={(value) => handleViewModeChange(value as ViewMode)}
                  data={[
                    { label: "Week", value: "week" },
                    { label: "Month", value: "month" },
                  ]}
                  size="sm"
                />
                <SegmentedControl
                  value={statusFilter}
                  onChange={(value) => setStatusFilter(value as BookingFilter)}
                  data={[
                    { label: "All", value: "all" },
                    { label: "Has people", value: "active" },
                    { label: "Cancelled", value: "cancelled" },
                  ]}
                  size="sm"
                />
                <Button
                  size="sm"
                  variant="light"
                  leftSection={<IconCalendar size={16} />}
                  onClick={handleGoToToday}
                >
                  Today
                </Button>
              </Group>

              <Group gap="xs" wrap="wrap" align="center">
                <Tooltip label="Previous" withArrow>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => handleShiftRange(-1)}
                    leftSection={<IconArrowLeft size={16} />}
                  >
                    Prev
                  </Button>
                </Tooltip>
                <Text fw={600}>{rangeLabel}</Text>
                <Tooltip label="Next" withArrow>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => handleShiftRange(1)}
                    rightSection={<IconArrowRight size={16} />}
                  >
                    Next
                  </Button>
                </Tooltip>
                <Tooltip label="Refresh" withArrow>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={handleReload}
                    leftSection={<IconRefresh size={16} />}
                    loading={ingestStatus === "loading" || fetchStatus === "loading"}
                  >
                    Refresh
                  </Button>
                </Tooltip>
              </Group>
            </Flex>

            {errorMessage && (
              <Alert color="red" title="Failed to sync bookings">
                {errorMessage}
              </Alert>
            )}

            <Tabs
              value={activeTab}
              onChange={(value) =>
                setActiveTab((value as "calendar" | "summary" | "pending" | "emails") ?? "calendar")
              }
              keepMounted={false}
            >
              <Tabs.List>
                <Tabs.Tab value="calendar">Calendar</Tabs.Tab>
                <Tabs.Tab value="summary">Summary</Tabs.Tab>
                <Tabs.Tab value="pending">Pending Bookings</Tabs.Tab>
                <Tabs.Tab value="emails">Emails</Tabs.Tab>
              </Tabs.List>

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
                {fetchStatus === "loading" && orders.length === 0 ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : (
                  <Stack gap="md">
                    <Title order={3}>Bookings summary</Title>
                    {filteredOrders.length === 0 ? (
                      <Alert color="blue" title="No bookings">
                        No bookings found for the selected range.
                      </Alert>
                    ) : (
                      <>
                        <Group gap="sm" wrap="wrap">
                          <Badge size="lg" color="blue" variant="light">
                            {`Bookings: ${summaryStats.totalOrders}`}
                          </Badge>
                          <Badge size="lg" color="green" variant="light">
                            {`Total people: ${summaryStats.totalPeople}`}
                          </Badge>
                          <Badge size="lg" color="teal" variant="light">
                            {`Men: ${summaryStats.men}`}
                          </Badge>
                          <Badge size="lg" color="pink" variant="light">
                            {`Women: ${summaryStats.women}`}
                          </Badge>
                          {summaryStats.extras.tshirts > 0 ||
                          summaryStats.extras.cocktails > 0 ||
                          summaryStats.extras.photos > 0 ? (
                            <Badge size="lg" color="violet" variant="light">
                              {formatExtrasSummary(summaryStats.extras)}
                            </Badge>
                          ) : null}
                        </Group>

                        {summaryStats.platformBreakdown.length > 0 && (
                          <Group gap="xs" wrap="wrap">
                            {summaryStats.platformBreakdown.map((entry) => (
                              <Badge
                                key={`platform-${entry.platform}`}
                                color={resolvePlatformColor(entry.platform)}
                                variant="outline"
                              >
                                {`${formatPlatformLabel(entry.platform)}: ${entry.totalPeople} (${entry.orderCount} ${
                                  entry.orderCount === 1 ? "booking" : "bookings"
                                })`}
                              </Badge>
                            ))}
                          </Group>
                        )}

                        <Paper withBorder radius="lg" shadow="sm" p="md">
                          <ScrollArea style={{ width: "100%" }}>
                            <Table striped highlightOnHover withColumnBorders horizontalSpacing="md" verticalSpacing="sm">
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>Booking</Table.Th>
                                  <Table.Th>Product</Table.Th>
                                  <Table.Th>Platform</Table.Th>
                                  <Table.Th>Pickup</Table.Th>
                                  <Table.Th align="right">People</Table.Th>
                                  <Table.Th align="right">Men</Table.Th>
                                  <Table.Th align="right">Women</Table.Th>
                                  <Table.Th>Contact</Table.Th>
                                  <Table.Th>Phone</Table.Th>
                                  <Table.Th>Extras</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {sortedOrders.map((order) => (
                                  <Table.Tr key={`${order.id}-${order.productId}`}>
                                    <Table.Td>
                                      <Stack gap={2} style={{ minWidth: 140 }}>
                                        <Text fw={600}>{order.id}</Text>
                                        <Text size="xs" c="dimmed">
                                          {formatPlatformLabel(order.platform)}
                                        </Text>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                      <Stack gap={2}>
                                        <Text fw={600}>{order.productName}</Text>
                                        <Text size="xs" c="dimmed">
                                          {order.productId}
                                        </Text>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                      <PlatformBadge platform={order.platform} />
                                    </Table.Td>
                                    <Table.Td>{formatPickupLabel(order)}</Table.Td>
                                    <Table.Td align="right">{order.quantity}</Table.Td>
                                    <Table.Td align="right">{order.menCount}</Table.Td>
                                    <Table.Td align="right">{order.womenCount}</Table.Td>
                                    <Table.Td>
                                      <Stack gap={2}>
                                        <Text fw={600}>{order.customerName || "—"}</Text>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>{order.customerPhone ?? "—"}</Table.Td>
                                    <Table.Td>{formatOrderExtras(order.extras)}</Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                        </Paper>
                      </>
                    )}
                  </Stack>
                )}
              </Tabs.Panel>

              <Tabs.Panel value="pending" pt="md">
                {pendingIsLoading ? (
                  <Box style={{ minHeight: 320 }}>
                    <Loader variant="bars" />
                  </Box>
                ) : (
                  <Stack gap="md">
                    {pendingError && (
                      <Alert color="red" title="Failed to load Ecwid orders">
                        {pendingError}
                      </Alert>
                    )}
                    {pendingCreateError && (
                      <Alert color="red" title="Failed to add booking">
                        {pendingCreateError}
                      </Alert>
                    )}
                    <Group gap="sm" wrap="wrap">
                      <Badge size="lg" color="orange" variant="light">
                        {`Missing in OmniLodge: ${pendingMissingInDb.length}`}
                      </Badge>
                      <Badge size="lg" color="grape" variant="light">
                        {`Mismatched: ${pendingMismatches.length}`}
                      </Badge>
                      <Badge size="lg" color="yellow" variant="light">
                        {`Date mismatches: ${pendingDateMismatches.length}`}
                      </Badge>
                      <Badge size="lg" color="gray" variant="light">
                        {`Missing in Ecwid: ${pendingMissingInEcwid.length}`}
                      </Badge>
                    </Group>
                    {pendingMissingInDb.length === 0 &&
                    pendingMissingInEcwid.length === 0 &&
                    pendingMismatches.length === 0 ? (
                      <Alert color="blue" title="No discrepancies">
                        Ecwid orders match the bookings stored in OmniLodge for this range.
                      </Alert>
                    ) : (
                      <>
                        <Accordion variant="separated" chevronPosition="right">
                          {pendingMismatches.length > 0 && (
                            <Accordion.Item value="mismatches">
                              <Accordion.Control>
                                {`Mismatched bookings (${pendingMismatches.length})`}
                              </Accordion.Control>
                              <Accordion.Panel>{renderMismatchTable(pendingMismatches)}</Accordion.Panel>
                            </Accordion.Item>
                          )}
                          {pendingMissingInDb.length > 0 && (
                            <Accordion.Item value="missing-omnilodge">
                              <Accordion.Control>
                                {`Missing in OmniLodge (${pendingMissingInDb.length})`}
                              </Accordion.Control>
                              <Accordion.Panel>
                                {renderPendingTable(pendingMissingInDb, {
                                  showActions: true,
                                  onAdd: handleCreateEcwidBooking,
                                })}
                              </Accordion.Panel>
                            </Accordion.Item>
                          )}
                          {pendingMissingInEcwid.length > 0 && (
                            <Accordion.Item value="missing-ecwid">
                              <Accordion.Control>
                                {`Missing in Ecwid (${pendingMissingInEcwid.length})`}
                              </Accordion.Control>
                              <Accordion.Panel>{renderPendingTable(pendingMissingInEcwid)}</Accordion.Panel>
                            </Accordion.Item>
                          )}
                        </Accordion>
                      </>
                    )}
                  </Stack>
                )}
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
                              disabled={emailDateRange[0] === null && emailDateRange[1] === null || backfillLoading}
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



