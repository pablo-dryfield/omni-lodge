import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Select,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  TextInput,
} from "@mantine/core";

import { DatePickerInput, TimeInput } from "@mantine/dates";
import { useMediaQuery } from '@mantine/hooks';

import { IconArrowLeft, IconArrowRight, IconCalendar, IconRefresh, IconSearch } from "@tabler/icons-react";

import dayjs, { Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";

dayjs.extend(customParseFormat);

import { useSearchParams } from "react-router-dom";

import { useAppDispatch } from "../store/hooks";

import { navigateToPage } from "../actions/navigationActions";

import { GenericPageProps } from "../types/general/GenericPageProps";

import { PageAccessGuard } from "../components/access/PageAccessGuard";

import { PAGE_SLUGS } from "../constants/pageSlugs";

import { useModuleAccess } from "../hooks/useModuleAccess";

import axiosInstance from "../utils/axiosInstance";

import {
  UnifiedOrder,
  OrderExtras,
  ManifestGroup,
  ManifestSummary,
  PlatformBreakdownEntry,
  BookingStatus,
} from "../store/bookingPlatformsTypes";



const DATE_FORMAT = "YYYY-MM-DD";

const MANIFEST_MODULE = "booking-manifest";

const toWhatsAppLink = (raw?: string) => {
  if (!raw) return null;

  // Keep digits and '+' only
  let s = raw.trim().replace(/[^\d+]/g, '');

  // Convert '00' prefix to '+'
  if (s.startsWith('00')) s = '+' + s.slice(2);

  // Handle UK numbers that start with 07 -> +44 (drop the 0)
  if (s.startsWith('07')) {
    s = '+44' + s.slice(1);
  } else if (s.startsWith('44')) {
    // If someone typed '44...' without '+'
    s = '+44' + s.slice(2);
  } else if (!s.startsWith('+')) {
    // If no '+' is present at all, add it (user requirement)
    s = '+' + s;
  }

  // wa.me requires digits only (no '+', no symbols)
  const href = `https://wa.me/${s.replace(/^\+/, '')}`;
  return { display: s, href };
};

type ManifestResponse = {
  date: string;
  manifest: ManifestGroup[];
  orders: UnifiedOrder[];
  summary?: ManifestSummary;
};

type StripeTransactionPreview = {
  id: string;
  type: "charge" | "payment_intent";
  amount: number;
  amountRefunded: number;
  currency: string;
  status: string | null;
  created: number;
  receiptEmail?: string | null;
  description?: string | null;
  fullyRefunded: boolean;
};

type RefundPreviewResponse = {
  bookingId: number;
  orderId: string;
  externalTransactionId: string;
  stripe: StripeTransactionPreview;
};



type FetchStatus = "idle" | "loading" | "success" | "error";

type BookingFilter = "all" | "active" | "cancelled";



type SelectOption = {

  value: string;

  label: string;

};



const deriveDate = (value: string | null): Dayjs => {

  if (!value) {

    return dayjs().startOf("day");

  }



  const parsed = dayjs(value);

  return parsed.isValid() ? parsed.startOf("day") : dayjs().startOf("day");

};



const deriveGroupKey = (productId: string | null, time: string | null): string => {

  if (productId && time) {

    return `${productId}|${time}`;

  }

  return "all";

};



const manifestToOptions = (groups: ManifestGroup[]): SelectOption[] => {
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  groups.forEach((group) => {
    const value = `${group.productId}|${group.time}`;
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    options.push({
      value,
      label: `${group.productName} @ ${group.time}`,
    });
  });
  return options;
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

const BOOKING_STATUSES: BookingStatus[] = [
  "pending",
  "confirmed",
  "amended",
  "rebooked",
  "cancelled",
  "completed",
  "no_show",
  "unknown",
];

const STATUS_COLORS: Record<BookingStatus, string> = {
  pending: "gray",
  confirmed: "green",
  amended: "yellow",
  rebooked: "orange",
  cancelled: "red",
  completed: "teal",
  no_show: "grape",
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

const PLATFORM_BOOKING_LINKS: Record<string, (bookingId: string) => string> = {
  ecwid: (id: string) => `https://my.ecwid.com/store/100323031#order:id=${encodeURIComponent(id)}`,
  viator: (id: string) =>
    `https://supplier.viator.com/bookings/search?bookingRef=${encodeURIComponent(id)}&sortBy=NEW_BOOKINGS&pageNumber=1&pageSize=10`,
  getyourguide: (id: string) => `https://supplier.getyourguide.com/bookings/${encodeURIComponent(id)}?from=/bookings`,
  airbnb: (id: string) => `https://www.airbnb.com/hosting/reservations/details/${encodeURIComponent(id)}`,
};

const getPlatformBookingLink = (platform?: string | null, bookingId?: string | null): string | null => {
  if (!platform || !bookingId) {
    return null;
  }
  const key = platform.toLowerCase();
  const builder = PLATFORM_BOOKING_LINKS[key];
  if (!builder) {
    return null;
  }
  try {
    return builder(bookingId);
  } catch {
    return null;
  }
};

const normalizeManifestBookingId = (order: UnifiedOrder): string | null => {
  const bookingId = order.platformBookingId ?? null;
  if (!bookingId) {
    return null;
  }
  if (order.platform?.toLowerCase() === "ecwid") {
    const match = bookingId.match(/^(.+)-\d+$/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return bookingId;
};

const formatStatusLabel = (value?: BookingStatus | null): string => {
  const status = value ?? "unknown";
  if (status === "no_show") {
    return "No show";
  }
  if (status === "rebooked") {
    return "Rebooked";
  }
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
};

const createEmptyStatusCounts = (): Record<BookingStatus, number> => {
  return BOOKING_STATUSES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {} as Record<BookingStatus, number>);
};

const resolveStatusColor = (value?: BookingStatus | null): string => {
  const key = value ?? "unknown";
  return STATUS_COLORS[key] ?? STATUS_COLORS.unknown;
};

const StatusBadge = ({ status }: { status?: BookingStatus | null }) => {
  const safeStatus = status ?? "unknown";
  return (
    <Badge color={resolveStatusColor(safeStatus)} variant="light">
      {formatStatusLabel(safeStatus)}
    </Badge>
  );
};

const buildPlatformBreakdown = (groups: ManifestGroup[]): PlatformBreakdownEntry[] => {
  const map = new Map<string, PlatformBreakdownEntry>();
  groups.forEach((group) => {
    (group.platformBreakdown ?? []).forEach((entry) => {
      const key = entry.platform || "unknown";
      const existing = map.get(key);
      if (existing) {
        existing.totalPeople += entry.totalPeople;
        existing.men += entry.men;
        existing.women += entry.women;
        existing.orderCount += entry.orderCount;
        return;
      }
      map.set(key, { ...entry, platform: key });
    });
  });
  return Array.from(map.values()).sort((a, b) => a.platform.localeCompare(b.platform));
};

const createSummaryFromGroups = (groups: ManifestGroup[]): ManifestSummary => ({
  totalPeople: groups.reduce((acc, group) => acc + group.totalPeople, 0),
  men: groups.reduce((acc, group) => acc + group.men, 0),
  women: groups.reduce((acc, group) => acc + group.women, 0),
  totalOrders: groups.reduce((acc, group) => acc + group.orders.length, 0),
  extras: {
    tshirts: groups.reduce((acc, group) => acc + (group.extras?.tshirts ?? 0), 0),
    cocktails: groups.reduce((acc, group) => acc + (group.extras?.cocktails ?? 0), 0),
    photos: groups.reduce((acc, group) => acc + (group.extras?.photos ?? 0), 0),
  },
  platformBreakdown: buildPlatformBreakdown(groups),
  statusCounts: groups.reduce((acc, group) => {
    group.orders.forEach((order) => {
      const status = order.status ?? "unknown";
      acc[status] = (acc[status] ?? 0) + 1;
    });
    return acc;
  }, createEmptyStatusCounts()),
});

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

const getOrderCounts = (order: UnifiedOrder) => {
  const men = Number.isFinite(order.menCount) ? order.menCount : 0;
  const women = Number.isFinite(order.womenCount) ? order.womenCount : 0;
  const fallback = Number.isFinite(order.quantity) ? order.quantity : 0;
  const total = men + women > 0 ? men + women : fallback;
  return { men, women, total };
};

const getUndefinedGenreCount = (total: number, men: number, women: number): number => {
  const diff = total - men - women;
  return diff > 0 ? diff : 0;
};

const buildPlatformBreakdownFromOrders = (orders: UnifiedOrder[]): PlatformBreakdownEntry[] => {
  const map = new Map<string, PlatformBreakdownEntry>();
  orders.forEach((order) => {
    const { men, women, total } = getOrderCounts(order);
    const key = order.platform ?? "unknown";
    const existing = map.get(key);
    if (existing) {
      existing.totalPeople += total;
      existing.men += men;
      existing.women += women;
      existing.orderCount += 1;
      return;
    }
    map.set(key, {
      platform: key,
      totalPeople: total,
      men,
      women,
      orderCount: 1,
    });
  });
  return Array.from(map.values()).sort((a, b) => a.platform.localeCompare(b.platform));
};

const buildGroupTotalsFromOrders = (orders: UnifiedOrder[]) => {
  const extras: OrderExtras = { tshirts: 0, cocktails: 0, photos: 0 };
  let men = 0;
  let women = 0;
  let totalPeople = 0;

  orders.forEach((order) => {
    const counts = getOrderCounts(order);
    men += counts.men;
    women += counts.women;
    totalPeople += counts.total;
    extras.tshirts += order.extras?.tshirts ?? 0;
    extras.cocktails += order.extras?.cocktails ?? 0;
    extras.photos += order.extras?.photos ?? 0;
  });

  return {
    totalPeople,
    men,
    women,
    extras,
    platformBreakdown: buildPlatformBreakdownFromOrders(orders),
  };
};

const applyBookingFilterToManifest = (groups: ManifestGroup[], filter: BookingFilter): ManifestGroup[] => {
  if (filter === "all") {
    return groups;
  }
  return groups
    .map((group) => {
      const filteredOrders = filterOrdersByStatus(group.orders, filter);
      if (filteredOrders.length === 0) {
        return null;
      }
      const totals = buildGroupTotalsFromOrders(filteredOrders);
      return {
        ...group,
        ...totals,
        orders: filteredOrders,
      };
    })
    .filter((group): group is ManifestGroup => Boolean(group));
};

const OrderPlatformBadge = ({ platform }: { platform?: string }) => {
  if (!platform) {
    return null;
  }
  return (
    <Badge size="sm" variant="light" color={resolvePlatformColor(platform)}>
      {formatPlatformLabel(platform)}
    </Badge>
  );
};

const PlatformBadges = ({
  entries,
  prefix,
  withMargin = true,
}: {
  entries?: PlatformBreakdownEntry[];
  prefix: string;
  withMargin?: boolean;
}) => {
  if (!entries || entries.length === 0) {
    return null;
  }
  return (
    <Group gap="xs" wrap="wrap" mt={withMargin ? 4 : 0}>
      {entries.map((entry) => (
        <Badge
          key={`${prefix}-${entry.platform}`}
          variant="light"
          color={resolvePlatformColor(entry.platform)}
        >
          {`${formatPlatformLabel(entry.platform)}: ${entry.totalPeople} (${entry.orderCount} ${
            entry.orderCount === 1 ? "order" : "orders"
          })`}
        </Badge>
      ))}
    </Group>
  );
};

const formatAddonValue = (value?: number): string => {
  return value && value > 0 ? String(value) : '';
};

const normalizeExtrasSnapshot = (extras?: OrderExtras): OrderExtras => ({
  tshirts: extras?.tshirts ?? 0,
  cocktails: extras?.cocktails ?? 0,
  photos: extras?.photos ?? 0,
});

const mergePlatformBreakdownEntries = (
  base: PlatformBreakdownEntry[] = [],
  incoming?: PlatformBreakdownEntry[],
): PlatformBreakdownEntry[] => {
  const map = new Map<string, PlatformBreakdownEntry>();
  const consume = (entries?: PlatformBreakdownEntry[]) => {
    entries?.forEach((entry) => {
      if (!entry) {
        return;
      }
      const key = entry.platform || "unknown";
      const existing = map.get(key);
      if (existing) {
        existing.totalPeople += entry.totalPeople;
        existing.men += entry.men;
        existing.women += entry.women;
        existing.orderCount += entry.orderCount;
        return;
      }
      map.set(key, {
        platform: key,
        totalPeople: entry.totalPeople,
        men: entry.men,
        women: entry.women,
        orderCount: entry.orderCount,
      });
    });
  };
  consume(base);
  consume(incoming);
  return Array.from(map.values()).sort((a, b) => a.platform.localeCompare(b.platform));
};

const mergeManifestGroups = (groups: ManifestGroup[]): ManifestGroup[] => {
  const map = new Map<string, ManifestGroup>();
  const order: string[] = [];

  groups.forEach((group) => {
    const key = `${group.productId}|${group.date}|${group.time}`;
    const normalizedExtras = normalizeExtrasSnapshot(group.extras);
    const normalizedBreakdown = group.platformBreakdown ?? [];

    if (!map.has(key)) {
      map.set(key, {
        ...group,
        extras: { ...normalizedExtras },
        orders: [...group.orders],
        platformBreakdown: [...normalizedBreakdown],
      });
      order.push(key);
      return;
    }

    const existing = map.get(key)!;
    existing.totalPeople += group.totalPeople;
    existing.men += group.men;
    existing.women += group.women;
    existing.extras.tshirts += normalizedExtras.tshirts;
    existing.extras.cocktails += normalizedExtras.cocktails;
    existing.extras.photos += normalizedExtras.photos;
    existing.orders = existing.orders.concat(group.orders);
    existing.platformBreakdown = mergePlatformBreakdownEntries(existing.platformBreakdown, normalizedBreakdown);
  });

  return order.map((key) => {
    const merged = map.get(key)!;
    merged.platformBreakdown = mergePlatformBreakdownEntries(merged.platformBreakdown);
    return merged;
  });
};

const isEcwidOrder = (order: UnifiedOrder): boolean => {
  return (order.platform ?? '').toLowerCase() === 'ecwid';
};

const getBookingIdFromOrder = (order: UnifiedOrder): number | null => {
  if (!order || !order.rawData) {
    return null;
  }
  const candidate = (order.rawData as { bookingId?: unknown }).bookingId;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    const parsed = Number.parseInt(candidate.trim(), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};

const normalizeTimeInput = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const formats = ['HH:mm', 'H:mm'];
  for (const format of formats) {
    const parsed = dayjs(trimmed, format, true);
    if (parsed.isValid()) {
      return parsed.format('HH:mm');
    }
  }
  const fallback = dayjs(`1970-01-01 ${trimmed}`);
  return fallback.isValid() ? fallback.format('HH:mm') : null;
};

const extractErrorMessage = (error: unknown): string => {
  if (!error) {
    return 'Something went wrong';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object') {
    const withMessage = error as { message?: string };
    if ('response' in error && error.response) {
      const responseData = (error as { response: { data?: unknown } }).response.data;
      if (typeof responseData === 'string') {
        return responseData;
      }
      if (responseData && typeof responseData === 'object' && 'message' in responseData) {
        const nested = responseData as { message?: string };
        if (nested.message) {
          return nested.message;
        }
      }
    }
    if (withMessage.message) {
      return withMessage.message;
    }
  }
  return 'Something went wrong';
};

const formatStripeAmount = (amount: number, currency: string): string => {
  const value = (amount / 100).toFixed(2);
  return `${value} ${currency.toUpperCase()}`;
};

const parseMoney = (value?: string | null): number => {
  if (!value) {
    return 0;
  }
  const normalized = value.replace(/\s+/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const computeAddonRefundTotal = (addons: PartialRefundAddon[], quantities: Record<number, number>): number => {
  return addons.reduce((total, addon) => {
    const qty = quantities[addon.id] ?? 0;
    if (qty <= 0) {
      return total;
    }
    const unitPrice = addon.unitPrice ? parseMoney(addon.unitPrice) : 0;
    if (unitPrice > 0) {
      return total + unitPrice * qty;
    }
    const totalPrice = addon.totalPrice ? parseMoney(addon.totalPrice) : 0;
    if (totalPrice > 0 && addon.quantity > 0) {
      return total + (totalPrice / addon.quantity) * qty;
    }
    return total;
  }, 0);
};

const formatDateTime = (value?: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : String(value);
};

const getStripeStatusColor = (status?: string | null): string => {
  switch (status) {
    case "succeeded":
      return "green";
    case "pending":
      return "yellow";
    case "failed":
      return "red";
    case "canceled":
      return "gray";
    default:
      return "blue";
  }
};

type AmendModalState = {
  opened: boolean;
  order: UnifiedOrder | null;
  bookingId: number | null;
  formDate: Date | null;
  formTime: string;
  submitting: boolean;
  error: string | null;
};

type EcwidAmendPreview = {
  status: "matched" | "order_missing" | "product_missing";
  message?: string | null;
  orderId?: string | null;
  booking?: {
    id: number;
    platformBookingId?: string | null;
    platformOrderId?: string | null;
    productId?: number | null;
    productName?: string | null;
    productVariant?: string | null;
  };
  bookingItems?: Array<{
    id?: number;
    name?: string | null;
    productId?: number | null;
    matched?: boolean;
    matchedIndex?: number | null;
  }>;
  missingItems?: string[];
  ecwid?: {
    id?: string | number | null;
    pickupTime?: string | null;
    items?: Array<{
      name?: string | null;
      quantity?: number | null;
      pickupTime?: string | null;
      options?: string[];
      matched?: boolean;
      matchedBookingNames?: string[];
    }>;
  };
};

type ReconcileState = {
  itemIndex: string | null;
  loading: boolean;
  error: string | null;
  success: string | null;
};

type BookingDetailsEmail = {
  id: number;
  messageId: string;
  fromAddress?: string | null;
  toAddresses?: string | null;
  ccAddresses?: string | null;
  subject?: string | null;
  snippet?: string | null;
  receivedAt?: string | null;
  internalDate?: string | null;
  ingestionStatus?: string | null;
  failureReason?: string | null;
};

type BookingDetailsEvent = {
  id: number;
  eventType?: string | null;
  statusAfter?: string | null;
  emailMessageId?: string | null;
  occurredAt?: string | null;
  ingestedAt?: string | null;
  processedAt?: string | null;
  processingError?: string | null;
  eventPayload?: Record<string, unknown> | null;
};

type BookingEmailPreview = BookingDetailsEmail & {
  previewText: string | null;
  textBody: string | null;
  htmlBody: string | null;
  htmlText: string | null;
  gmailQuery?: string | null;
};

type BookingDetailsResponse = {
  booking: UnifiedOrder & {
    id: number;
    platformOrderId?: string | null;
    lastEmailMessageId?: string | null;
  };
  events: BookingDetailsEvent[];
  emails: BookingDetailsEmail[];
  stripe: {
    id: string;
    type: string;
    amount: number;
    amountRefunded: number;
    currency: string;
    status: string | null;
    created: number;
    receiptEmail?: string | null;
    description?: string | null;
    fullyRefunded: boolean;
  } | null;
  stripeError?: string | null;
  ecwidOrderId?: string | null;
};

type BookingDetailsState = {
  opened: boolean;
  loading: boolean;
  error: string | null;
  data: BookingDetailsResponse | null;
  activeTab: string;
  previewMessageId: string | null;
  previewLoading: boolean;
  previewError: string | null;
  previewData: BookingEmailPreview | null;
  previewOpen: boolean;
};

type PartialRefundAddon = {
  id: number;
  platformAddonName: string | null;
  quantity: number;
  unitPrice: string | null;
  totalPrice: string | null;
  currency: string | null;
};

type PartialRefundPreview = {
  bookingId: number;
  orderId: string;
  externalTransactionId: string;
  stripe: {
    id: string;
    type: string;
    amount: number;
    amountRefunded: number;
    currency: string;
    status: string | null;
    created: number;
    receiptEmail?: string | null;
    description?: string | null;
    fullyRefunded: boolean;
  };
  remainingAmount: number;
  addons: PartialRefundAddon[];
};

type PartialRefundState = {
  opened: boolean;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  success: string | null;
  bookingId: number | null;
  preview: PartialRefundPreview | null;
  amount: number | null;
  addonQuantities: Record<number, number>;
};

type EcwidAmendPreviewState = {
  status: "idle" | "loading" | "error" | "matched" | "order_missing" | "product_missing";
  data: EcwidAmendPreview | null;
  error: string | null;
};

const createDefaultAmendState = (): AmendModalState => ({
  opened: false,
  order: null,
  bookingId: null,
  formDate: null,
  formTime: '',
  submitting: false,
  error: null,
});

const createDefaultAmendPreview = (): EcwidAmendPreviewState => ({
  status: "idle",
  data: null,
  error: null,
});

type CancelRefundState = {
  opened: boolean;
  order: UnifiedOrder | null;
  bookingId: number | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  preview: RefundPreviewResponse | null;
};

const createDefaultCancelState = (): CancelRefundState => ({
  opened: false,
  order: null,
  bookingId: null,
  loading: false,
  submitting: false,
  error: null,
  preview: null,
});

const BookingsManifestPage = ({ title }: GenericPageProps) => {

  const dispatch = useAppDispatch();

  const [searchParams, setSearchParams] = useSearchParams();

  const modulePermissions = useModuleAccess(MANIFEST_MODULE);

  const isMobile = useMediaQuery("(max-width: 900px)");

  const dateParam = searchParams.get("date");

  const productIdParam = searchParams.get("productId");

  const timeParam = searchParams.get("time");

  const searchParamValue = searchParams.get("search");
  const searchParam = searchParamValue ? searchParamValue.trim() : "";
  const hasSearchParam = searchParam.length > 0;



  const effectiveDate = useMemo(() => deriveDate(dateParam), [dateParam]);

  const effectiveGroupKey = useMemo(
    () => (hasSearchParam ? "all" : deriveGroupKey(productIdParam, timeParam)),
    [hasSearchParam, productIdParam, timeParam],
  );



  const [selectedDate, setSelectedDate] = useState<Dayjs>(effectiveDate);

  const [selectedGroupKey, setSelectedGroupKey] = useState<string>(effectiveGroupKey);

  const [manifest, setManifest] = useState<ManifestGroup[]>([]);

  const [summary, setSummary] = useState<ManifestSummary>({
    totalPeople: 0,
    men: 0,
    women: 0,
    totalOrders: 0,
    extras: { tshirts: 0, cocktails: 0, photos: 0 },
    platformBreakdown: [],
    statusCounts: createEmptyStatusCounts(),
  });

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [ingestStatus, setIngestStatus] = useState<FetchStatus>("idle");

  const [reloadToken, setReloadToken] = useState(0);
  const [statusFilter, setStatusFilter] = useState<BookingFilter>("active");
  const [searchInput, setSearchInput] = useState(searchParam);
  const [amendState, setAmendState] = useState<AmendModalState>(createDefaultAmendState());
  const [amendPreview, setAmendPreview] = useState<EcwidAmendPreviewState>(createDefaultAmendPreview());
  const [reconcileState, setReconcileState] = useState<ReconcileState>({
    itemIndex: null,
    loading: false,
    error: null,
    success: null,
  });
  const [detailsState, setDetailsState] = useState<BookingDetailsState>({
    opened: false,
    loading: false,
    error: null,
    data: null,
    activeTab: "emails",
    previewMessageId: null,
    previewLoading: false,
    previewError: null,
    previewData: null,
    previewOpen: false,
  });
  const [partialRefundState, setPartialRefundState] = useState<PartialRefundState>({
    opened: false,
    loading: false,
    submitting: false,
    error: null,
    success: null,
    bookingId: null,
    preview: null,
    amount: null,
    addonQuantities: {},
  });
  const [cancelState, setCancelState] = useState<CancelRefundState>(createDefaultCancelState());

  useEffect(() => {
    setSearchInput(searchParam);
  }, [searchParam]);



  useEffect(() => {

    if (!selectedDate.isSame(effectiveDate, "day")) {

      setSelectedDate(effectiveDate);

    }

  }, [effectiveDate, selectedDate]);



  useEffect(() => {

    if (selectedGroupKey !== effectiveGroupKey) {

      setSelectedGroupKey(effectiveGroupKey);

    }

  }, [effectiveGroupKey, selectedGroupKey]);



  useEffect(() => {

    dispatch(navigateToPage(title));

  }, [dispatch, title]);



  const updateSearchParamDate = (next: Dayjs) => {

    const formatted = next.format(DATE_FORMAT);

    if (formatted === dateParam) {

      return;

    }

    const params = new URLSearchParams(searchParams);

    params.set("date", formatted);

    setSearchParams(params);

  };



  const updateSearchParamGroup = (groupKey: string, groupLabel?: string) => {
    const params = new URLSearchParams(searchParams);
    if (groupKey === "all") {
      params.delete("productId");
      params.delete("time");
      params.delete("productName");
    } else {
      const [productId, time] = groupKey.split("|");
      params.set("productId", productId);
      params.set("time", time);
      if (groupLabel) {
        params.set("productName", groupLabel);
      }
    }
    setSearchParams(params);
  };

  const applySearchParamValue = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("search", value);
    } else {
      params.delete("search");
    }
    setSearchParams(params);
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applySearchParamValue(searchInput.trim());
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearchInput(event.currentTarget.value);
  };

  const handleSearchClear = () => {
    setSearchInput("");
    applySearchParamValue("");
  };

  const openAmendModal = (order: UnifiedOrder) => {
    const baseState = createDefaultAmendState();
    baseState.opened = true;
    baseState.order = order;
    baseState.bookingId = getBookingIdFromOrder(order);
    baseState.formDate = order.date && dayjs(order.date, DATE_FORMAT, true).isValid()
      ? dayjs(order.date, DATE_FORMAT).toDate()
      : null;
    baseState.formTime = order.timeslot && /^\d{1,2}:\d{2}$/.test(order.timeslot) ? order.timeslot : '';
    if (!baseState.bookingId) {
      baseState.error = "Unable to locate OmniLodge booking reference for this order.";
    }
    setAmendState(baseState);
    if (baseState.bookingId) {
      setAmendPreview({ status: "loading", data: null, error: null });
      setReconcileState((prev) => ({
        ...prev,
        itemIndex: null,
        loading: false,
        error: null,
        success: null,
      }));
      axiosInstance
        .get<EcwidAmendPreview>(`/bookings/${baseState.bookingId}/amend-ecwid-preview`)
        .then((response) => {
          const data = response.data;
          const currentBookingMatch = data.bookingItems?.find((entry) => entry.id === baseState.bookingId);
          const defaultIndex =
            currentBookingMatch?.matchedIndex !== undefined && currentBookingMatch?.matchedIndex !== null
              ? String(currentBookingMatch.matchedIndex)
              : data.ecwid?.items && data.ecwid.items.length > 0
                ? "0"
                : null;
          setAmendPreview({
            status: response.data?.status ?? "matched",
            data: response.data,
            error: null,
          });
          setReconcileState((prev) => ({ ...prev, itemIndex: defaultIndex }));
        })
        .catch((error) => {
          setAmendPreview({
            status: "error",
            data: null,
            error: extractErrorMessage(error),
          });
        });
    } else {
      setAmendPreview(createDefaultAmendPreview());
      setReconcileState((prev) => ({
        ...prev,
        itemIndex: null,
        loading: false,
        error: null,
        success: null,
      }));
    }
  };

  const closeAmendModal = () => {
    setAmendState(createDefaultAmendState());
    setAmendPreview(createDefaultAmendPreview());
    setReconcileState((prev) => ({
      ...prev,
      itemIndex: null,
      loading: false,
      error: null,
      success: null,
    }));
  };

  const handleAmendDateChange = (value: Date | null) => {
    setAmendState((prev) => ({ ...prev, formDate: value }));
  };

  const handleAmendTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setAmendState((prev) => ({ ...prev, formTime: event.currentTarget.value }));
  };

  const handleAmendSubmit = async () => {
    if (!amendState.bookingId) {
      setAmendState((prev) => ({ ...prev, error: "Missing OmniLodge booking reference." }));
      return;
    }
    if (!amendState.formDate || !amendState.formTime) {
      setAmendState((prev) => ({ ...prev, error: "Pickup date and time are required." }));
      return;
    }
    const normalizedTime = normalizeTimeInput(amendState.formTime);
    if (!normalizedTime) {
      setAmendState((prev) => ({ ...prev, error: "Please provide a valid pickup time (HH:mm)." }));
      return;
    }
    setAmendState((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await axiosInstance.post(`/bookings/${amendState.bookingId}/amend-ecwid`, {
        pickupDate: dayjs(amendState.formDate).format(DATE_FORMAT),
        pickupTime: normalizedTime,
      });
      setAmendState(createDefaultAmendState());
      setReloadToken((token) => token + 1);
    } catch (error) {
      const message = extractErrorMessage(error);
      setAmendState((prev) => ({ ...prev, submitting: false, error: message }));
    }
  };

  const handleReconcileSubmit = async () => {
    if (!amendState.bookingId) {
      setReconcileState((prev) => ({ ...prev, error: "Missing OmniLodge booking reference." }));
      return;
    }
    if (reconcileState.itemIndex === null) {
      setReconcileState((prev) => ({ ...prev, error: "Select an Ecwid item to sync." }));
      return;
    }
    setReconcileState((prev) => ({ ...prev, loading: true, error: null, success: null }));
    try {
      await axiosInstance.post(`/bookings/${amendState.bookingId}/reconcile-ecwid`, {
        itemIndex: Number.parseInt(reconcileState.itemIndex, 10),
      });
      setReconcileState((prev) => ({
        ...prev,
        loading: false,
        success: "OmniLodge booking updated to match Ecwid.",
      }));
      setReloadToken((token) => token + 1);
      if (amendState.bookingId) {
        const response = await axiosInstance.get<EcwidAmendPreview>(`/bookings/${amendState.bookingId}/amend-ecwid-preview`);
        setAmendPreview({
          status: response.data?.status ?? "matched",
          data: response.data,
          error: null,
        });
      }
    } catch (error) {
      setReconcileState((prev) => ({
        ...prev,
        loading: false,
        error: extractErrorMessage(error),
      }));
    }
  };

  const openDetailsModal = (order: UnifiedOrder) => {
    const bookingId = getBookingIdFromOrder(order);
    if (!bookingId) {
      setDetailsState((prev) => ({
        ...prev,
        opened: true,
        loading: false,
        error: "Unable to locate OmniLodge booking reference for this order.",
        data: null,
      }));
      return;
    }
    setDetailsState({
      opened: true,
      loading: true,
      error: null,
      data: null,
      activeTab: "emails",
      previewMessageId: null,
      previewLoading: false,
      previewError: null,
      previewData: null,
      previewOpen: false,
    });
    axiosInstance
      .get<BookingDetailsResponse>(`/bookings/${bookingId}/details`)
      .then((response) => {
        setDetailsState((prev) => ({
          ...prev,
          loading: false,
          data: response.data,
          error: null,
        }));
      })
      .catch((error) => {
        setDetailsState((prev) => ({
          ...prev,
          loading: false,
          error: extractErrorMessage(error),
        }));
      });
  };

  const closeDetailsModal = () => {
    setDetailsState({
      opened: false,
      loading: false,
      error: null,
      data: null,
      activeTab: "emails",
      previewMessageId: null,
      previewLoading: false,
      previewError: null,
      previewData: null,
      previewOpen: false,
    });
  };

  const handleDetailsPreview = async (messageId: string) => {
    setDetailsState((prev) => ({
      ...prev,
      previewMessageId: messageId,
      previewLoading: true,
      previewError: null,
      previewData: null,
      previewOpen: true,
    }));
    try {
      const response = await axiosInstance.get(`/bookings/emails/${encodeURIComponent(messageId)}/preview`);
      setDetailsState((prev) => ({
        ...prev,
        previewLoading: false,
        previewData: response.data as BookingEmailPreview,
        previewError: null,
      }));
    } catch (error) {
      setDetailsState((prev) => ({
        ...prev,
        previewLoading: false,
        previewError: extractErrorMessage(error),
      }));
    }
  };

  const closeDetailsPreview = () => {
    setDetailsState((prev) => ({
      ...prev,
      previewOpen: false,
      previewLoading: false,
      previewError: null,
      previewData: null,
      previewMessageId: null,
    }));
  };

  const openPartialRefundModal = (order: UnifiedOrder) => {
    const bookingId = getBookingIdFromOrder(order);
    if (!bookingId) {
      setPartialRefundState((prev) => ({
        ...prev,
        opened: true,
        loading: false,
        error: "Unable to locate OmniLodge booking reference for this order.",
      }));
      return;
    }
    setPartialRefundState({
      opened: true,
      loading: true,
      submitting: false,
      error: null,
      success: null,
      bookingId,
      preview: null,
      amount: null,
      addonQuantities: {},
    });
    axiosInstance
      .get<PartialRefundPreview>(`/bookings/${bookingId}/partial-refund-preview`)
      .then((response) => {
        const preview = response.data;
        const addonQuantities: Record<number, number> = {};
        preview.addons.forEach((addon) => {
          addonQuantities[addon.id] = 0;
        });
        const computedAmount = computeAddonRefundTotal(preview.addons, addonQuantities);
        const maxAmount = Math.max((preview.remainingAmount - 1) / 100, 0);
        const nextAmount = Math.min(computedAmount, maxAmount);
        setPartialRefundState((prev) => ({
          ...prev,
          loading: false,
          preview,
          addonQuantities,
          amount: nextAmount > 0 ? Number(nextAmount.toFixed(2)) : null,
        }));
      })
      .catch((error) => {
        setPartialRefundState((prev) => ({
          ...prev,
          loading: false,
          error: extractErrorMessage(error),
        }));
      });
  };

  const closePartialRefundModal = () => {
    setPartialRefundState({
      opened: false,
      loading: false,
      submitting: false,
      error: null,
      success: null,
      bookingId: null,
      preview: null,
      amount: null,
      addonQuantities: {},
    });
  };

  const handlePartialRefundAddonChange = (addonId: number, value: number | string) => {
    const nextValue = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    setPartialRefundState((prev) => {
      if (!prev.preview) {
        return prev;
      }
      const updated = {
        ...prev.addonQuantities,
        [addonId]: Number.isFinite(nextValue) && nextValue >= 0 ? nextValue : 0,
      };
      const computedAmount = computeAddonRefundTotal(prev.preview.addons, updated);
      const maxAmount = Math.max((prev.preview.remainingAmount - 1) / 100, 0);
      const nextAmount = Math.min(computedAmount, maxAmount);
      return {
        ...prev,
        addonQuantities: updated,
        amount: Number(nextAmount.toFixed(2)),
        success: null,
        error: null,
      };
    });
  };

  const handlePartialRefundAmountChange = (value: number | string) => {
    const nextValue = typeof value === "number" ? value : Number.parseFloat(String(value));
    setPartialRefundState((prev) => ({
      ...prev,
      amount: Number.isFinite(nextValue) ? nextValue : null,
      success: null,
      error: null,
    }));
  };

  const handleSubmitPartialRefund = async () => {
    if (!partialRefundState.bookingId || !partialRefundState.preview) {
      setPartialRefundState((prev) => ({ ...prev, error: "Missing booking reference." }));
      return;
    }
    if (!partialRefundState.amount || partialRefundState.amount <= 0) {
      setPartialRefundState((prev) => ({ ...prev, error: "Enter a refund amount." }));
      return;
    }
    const remainingMajor = (partialRefundState.preview.remainingAmount - 1) / 100;
    if (partialRefundState.amount >= remainingMajor) {
      setPartialRefundState((prev) => ({
        ...prev,
        error: "Amount must be less than the remaining paid amount. Use Cancel for a full refund.",
      }));
      return;
    }
    setPartialRefundState((prev) => ({ ...prev, submitting: true, error: null, success: null }));
    try {
      await axiosInstance.post(`/bookings/${partialRefundState.bookingId}/partial-refund`, {
        amount: partialRefundState.amount,
      });
      setPartialRefundState((prev) => ({
        ...prev,
        submitting: false,
        success: "Partial refund submitted.",
      }));
      setReloadToken((token) => token + 1);
    } catch (error) {
      setPartialRefundState((prev) => ({
        ...prev,
        submitting: false,
        error: extractErrorMessage(error),
      }));
    }
  };

  const openCancelModal = async (order: UnifiedOrder) => {
    const bookingId = getBookingIdFromOrder(order);
    const baseState = createDefaultCancelState();
    baseState.opened = true;
    baseState.order = order;
    baseState.bookingId = bookingId;
    baseState.loading = Boolean(bookingId);
    if (!bookingId) {
      baseState.error = "Unable to locate OmniLodge booking reference for this order.";
      baseState.loading = false;
    }
    setCancelState(baseState);
    if (!bookingId) {
      return;
    }
    try {
      const response = await axiosInstance.get<RefundPreviewResponse>(`/bookings/${bookingId}/refund-preview`);
      setCancelState((prev) => {
        if (!prev.opened) {
          return prev;
        }
        return {
          ...prev,
          loading: false,
          preview: response.data,
          error: null,
        };
      });
    } catch (error) {
      const message = extractErrorMessage(error);
      setCancelState((prev) => ({ ...prev, loading: false, error: message }));
    }
  };

  const closeCancelModal = () => {
    if (cancelState.submitting) {
      return;
    }
    setCancelState(createDefaultCancelState());
  };

  const handleConfirmRefund = async () => {
    if (!cancelState.bookingId) {
      setCancelState((prev) => ({ ...prev, error: "Missing OmniLodge booking reference." }));
      return;
    }
    setCancelState((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await axiosInstance.post(`/bookings/${cancelState.bookingId}/cancel-ecwid`);
      setCancelState(createDefaultCancelState());
      setReloadToken((token) => token + 1);
    } catch (error) {
      const message = extractErrorMessage(error);
      setCancelState((prev) => ({ ...prev, submitting: false, error: message }));
    }
  };



  useEffect(() => {

    if (!modulePermissions.ready || !modulePermissions.canView) {

      return;

    }



    const controller = new AbortController();



    const fetchManifest = async () => {

      setFetchStatus("loading");

      setErrorMessage(null);



      try {

        const response = await axiosInstance.get<ManifestResponse>("/bookings/manifest", {
          params: {
            date: selectedDate.format(DATE_FORMAT),
            productId: hasSearchParam ? undefined : productIdParam ?? undefined,
            time: hasSearchParam ? undefined : timeParam ?? undefined,
            search: searchParam || undefined,
          },
          signal: controller.signal,
          withCredentials: true,
        });



        const payload = response.data;

        const groups = Array.isArray(payload?.manifest) ? payload.manifest : [];
        const mergedGroups = mergeManifestGroups(groups);

        setManifest(mergedGroups);

        const serverSummary = payload?.summary;
        const computedSummary = serverSummary
          ? {
              ...serverSummary,
              platformBreakdown: serverSummary.platformBreakdown ?? buildPlatformBreakdown(mergedGroups),
              statusCounts: (() => {
                const normalized = createEmptyStatusCounts();
                BOOKING_STATUSES.forEach((status) => {
                  normalized[status] = serverSummary.statusCounts?.[status] ?? 0;
                });
                return normalized;
              })(),
            }
          : createSummaryFromGroups(mergedGroups);

        setSummary(computedSummary);

        setFetchStatus("success");

      } catch (error) {

        if (controller.signal.aborted) {

          return;

        }

        setFetchStatus("error");

        setErrorMessage(error instanceof Error ? error.message : "Failed to load manifest data.");

      }

    };



    fetchManifest();



    return () => {

      controller.abort();

    };

  }, [
    modulePermissions.ready,
    modulePermissions.canView,
    selectedDate,
    productIdParam,
    timeParam,
    searchParam,
    hasSearchParam,
    reloadToken,
  ]);



  const filteredManifest = useMemo(
    () => applyBookingFilterToManifest(manifest, statusFilter),
    [manifest, statusFilter],
  );

  const filteredSummary = useMemo(() => {
    if (statusFilter === "all") {
      return summary;
    }
    return createSummaryFromGroups(filteredManifest);
  }, [filteredManifest, statusFilter, summary]);

  const summaryUndefinedCount = getUndefinedGenreCount(
    filteredSummary.totalPeople,
    filteredSummary.men,
    filteredSummary.women,
  );
  const showAddonColumns =
    filteredSummary.extras.tshirts > 0 ||
    filteredSummary.extras.cocktails > 0 ||
    filteredSummary.extras.photos > 0;
  const detailsPreviewHtml = detailsState.previewData?.htmlBody ?? null;
  const detailsPreviewBody =
    detailsState.previewData?.previewText ??
    detailsState.previewData?.textBody ??
    detailsState.previewData?.htmlText ??
    detailsState.previewData?.snippet ??
    null;

  const groupOptions = useMemo(() => {

    const options = manifestToOptions(filteredManifest);

    if (options.length === 0) {

      return [{ value: "all", label: "All events" }];

    }

    return [{ value: "all", label: "All events" }, ...options];

  }, [filteredManifest]);



  const activeGroups = useMemo(() => {
    if (hasSearchParam || selectedGroupKey === "all") {
      return filteredManifest;
    }

    return filteredManifest.filter((group) => `${group.productId}|${group.time}` === selectedGroupKey);
  }, [hasSearchParam, filteredManifest, selectedGroupKey]);



  const handleShiftDate = (delta: number) => {

    const next = selectedDate.add(delta, "day");

    setSelectedDate(next);

    updateSearchParamDate(next);

  };



  const handleGoToToday = () => {

    const today = dayjs().startOf("day");

    setSelectedDate(today);

    updateSearchParamDate(today);

  };



  const handleDateInputChange = (event: ChangeEvent<HTMLInputElement>) => {

    const value = event.currentTarget.value;

    if (!value) {

      return;

    }

    const parsed = dayjs(value);

    if (parsed.isValid()) {

      const normalized = parsed.startOf("day");

      setSelectedDate(normalized);

      updateSearchParamDate(normalized);

    }

  };



  const handleGroupChange = (value: string | null) => {

    const nextValue = value ?? "all";

    setSelectedGroupKey(nextValue);

    const label = groupOptions.find((option) => option.value === nextValue)?.label;

    updateSearchParamGroup(nextValue, label);

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
      setErrorMessage(extractErrorMessage(error));
    }
  };



  const isLoading = fetchStatus === "loading" && manifest.length === 0;



  return (

    <PageAccessGuard pageSlug={PAGE_SLUGS.bookingsManifest}>

      <Stack gap="lg">

        <Title order={2}>{title}</Title>



        {!modulePermissions.ready || modulePermissions.loading ? (

          <Box style={{ minHeight: 240 }}>

            <Loader variant="dots" />

          </Box>

        ) : !modulePermissions.canView ? (

          <Alert color="yellow" title="No access">

            You do not have permission to view manifest information.

          </Alert>

        ) : (

          <Stack gap="md">

            <Flex justify="space-between" align="center" wrap="wrap" gap="sm">

              <Group gap="sm" wrap="wrap">

                <Button size="sm" variant="light" leftSection={<IconCalendar size={16} />} onClick={handleGoToToday}>

                  Today

                </Button>

                <Button size="sm" variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => handleShiftDate(-1)}>

                  Prev day

                </Button>

                <Button size="sm" variant="subtle" rightSection={<IconArrowRight size={16} />} onClick={() => handleShiftDate(1)}>

                  Next day

                </Button>

                <input

                  type="date"

                  value={selectedDate.format(DATE_FORMAT)}

                  onChange={handleDateInputChange}

                  style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ced4da" }}

                />

              </Group>



              <Group gap="xs" wrap="wrap" align="center">

                <Select
                  data={groupOptions}
                  value={selectedGroupKey}
                  onChange={handleGroupChange}
                  size="sm"
                  allowDeselect={false}
                  style={{ minWidth: 220 }}
                  label="Event"
                  disabled={hasSearchParam}
                />

                <Button

                  variant="subtle"

                  size="sm"

                  onClick={handleReload}

                  leftSection={<IconRefresh size={16} />}

                  loading={ingestStatus === "loading" || fetchStatus === "loading"}

                >

                  Refresh

                </Button>

              </Group>

            </Flex>

            <form onSubmit={handleSearchSubmit}>
              <Stack gap={4}>
                <Group gap="xs" wrap="wrap" align="flex-end">
                  <TextInput
                    value={searchInput}
                    onChange={handleSearchChange}
                    placeholder="Search booking id, name, or phone"
                    leftSection={<IconSearch size={16} />}
                    size="sm"
                    w={isMobile ? "100%" : 320}
                  />
                  <Button type="submit" size="sm">
                    Search
                  </Button>
                  {hasSearchParam && (
                    <Button variant="subtle" color="gray" size="sm" onClick={handleSearchClear}>
                      Clear
                    </Button>
                  )}
                </Group>
                {hasSearchParam && (
                  <Text size="sm" c="dimmed">
                    Showing results for &ldquo;{searchParam}&rdquo;. Date and event filters are ignored while
                    search is active.
                  </Text>
                )}
              </Stack>
            </form>

            <Group gap="sm" wrap="wrap" align="center">
              <Text size="sm" fw={600}>
                Filters
              </Text>
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
            </Group>



            <Group gap="md" wrap="wrap">
              {hasSearchParam ? (
                <Badge size="lg" color="gray" variant="light">
                  {`Search: ${searchParam}`}
                </Badge>
              ) : (
                <Badge size="lg" color="blue" variant="light">
                  {selectedDate.format("dddd, MMM D")}
                </Badge>
              )}

              <Badge size="lg" color="green" variant="light">

                {`Total: ${filteredSummary.totalPeople} people`}

              </Badge>

              <Badge size="lg" color="teal" variant="light">

                {`Men: ${filteredSummary.men}`}

              </Badge>

              <Badge size="lg" color="pink" variant="light">

                {`Women: ${filteredSummary.women}`}

              </Badge>

              {summaryUndefinedCount > 0 && (
                <Badge size="lg" color="gray" variant="light">
                  {`Undefined Genre: ${summaryUndefinedCount}`}
                </Badge>
              )}

              {filteredSummary.extras.tshirts > 0 && (
                <Badge size="lg" color="blue" variant="light">

                  {`T-Shirts: ${filteredSummary.extras.tshirts}`}

                </Badge>
              )}

              {filteredSummary.extras.cocktails > 0 && (
                <Badge size="lg" color="violet" variant="light">

                  {`Cocktails: ${filteredSummary.extras.cocktails}`}

                </Badge>
              )}

              {filteredSummary.extras.photos > 0 && (
                <Badge size="lg" color="grape" variant="light">

                  {`Photos: ${filteredSummary.extras.photos}`}

                </Badge>
              )}

              <Badge size="lg" color="gray" variant="light">

                {`Bookings: ${filteredSummary.totalOrders}`}

              </Badge>

              <PlatformBadges entries={filteredSummary.platformBreakdown} prefix="summary" />

              <Stack gap={4} w="100%">
                <Text fw={600} size="sm">
                  Booking statuses
                </Text>
                <Group gap="xs" wrap="wrap">
                  {BOOKING_STATUSES.map((status) => (
                    <Badge
                      key={`summary-status-${status}`}
                      color={STATUS_COLORS[status]}
                      variant="light"
                    >
                      {`${formatStatusLabel(status)}: ${filteredSummary.statusCounts?.[status] ?? 0}`}
                    </Badge>
                  ))}
                </Group>
              </Stack>

            </Group>



            {errorMessage && (

              <Alert color="red" title="Failed to load manifest">

                {errorMessage}

              </Alert>

            )}



            {isLoading ? (

              <Box style={{ minHeight: 320 }}>

                <Loader variant="bars" />

              </Box>

            ) : activeGroups.length === 0 ? (
              <Alert color="blue" title="No data">
                {hasSearchParam
                  ? `No bookings matched “${searchParam}”.`
                  : statusFilter === "cancelled"
                    ? "No cancelled bookings found for the selected date."
                    : statusFilter === "active"
                      ? "No active bookings found for the selected date."
                      : "No bookings found for the selected date."}
              </Alert>

            ) : (

              <Stack gap="lg">
                {activeGroups.map((group) => {
                  const readableDate = dayjs(group.date).format("dddd, MMM D");
                  const bookingsLabel = `${group.orders.length} booking${group.orders.length === 1 ? "" : "s"}`;
                  const undefinedGroupCount = getUndefinedGenreCount(group.totalPeople, group.men, group.women);
                  const sortedOrders = [...group.orders].sort((a, b) => {
                    const platformA = (a.platform ?? "").toLowerCase();
                    const platformB = (b.platform ?? "").toLowerCase();
                    if (platformA !== platformB) {
                      return platformA.localeCompare(platformB);
                    }
                    return (a.customerName ?? "").localeCompare(b.customerName ?? "");
                  });

                  if (isMobile) {
                    return (
                      <Paper
                        key={`${group.productId}-${group.date}-${group.time}`}
                        withBorder
                        radius="lg"
                        shadow="sm"
                        p="md"
                      >
                        <Stack gap="sm">
                          <Stack gap={4}>
                            <Text fw={700} size="lg">
                              {group.productName}
                            </Text>
                            <Group gap="xs" align="center">
                              <Badge color="orange" variant="filled" radius="sm">
                                {group.time}
                              </Badge>
                              <Text size="sm" c="dimmed">
                                {readableDate}
                              </Text>
                            </Group>
                          </Stack>
                          <Group gap="xs" wrap="wrap">
                            <Badge color="green" variant="light">
                              {`${group.totalPeople} people`}
                            </Badge>
                              <Badge color="teal" variant="light">
                                {`Men: ${group.men}`}
                              </Badge>
                              <Badge color="pink" variant="light">
                                {`Women: ${group.women}`}
                              </Badge>
                              {undefinedGroupCount > 0 && (
                                <Badge color="gray" variant="light">
                                  {`Undefined Genre: ${undefinedGroupCount}`}
                                </Badge>
                              )}
                              {group.extras.tshirts > 0 && (
                                <Badge color="blue" variant="light">
                                  {`T-Shirts: ${group.extras.tshirts}`}
                                </Badge>
                            )}
                            {group.extras.cocktails > 0 && (
                              <Badge color="violet" variant="light">
                                {`Cocktails: ${group.extras.cocktails}`}
                              </Badge>
                            )}
                          {group.extras.photos > 0 && (
                            <Badge color="grape" variant="light">
                              {`Photos: ${group.extras.photos}`}
                            </Badge>
                          )}
                          <Badge color="gray" variant="light">
                            {bookingsLabel}
                          </Badge>
                          <PlatformBadges
                            entries={group.platformBreakdown}
                            prefix={`group-desktop-${group.productId}-${group.time}`}
                          />
                        </Group>
                          <Divider />
                          <Stack gap="sm">
                            {sortedOrders.map((order) => {
                              const normalizedBookingId = normalizeManifestBookingId(order);
                              const bookingDisplay = normalizedBookingId ?? order.platformBookingId ?? order.id;
                              const bookingLink =
                                order.platformBookingUrl ?? getPlatformBookingLink(order.platform, normalizedBookingId ?? order.platformBookingId);
                              const bookingId = getBookingIdFromOrder(order);
                              const canAmend = isEcwidOrder(order) && Boolean(bookingId);
                              const canCancel = canAmend && order.status !== "cancelled";
                              const canPartialRefund = canAmend && order.status !== "cancelled";
                              const undefinedOrderCount = getUndefinedGenreCount(
                                order.quantity,
                                order.menCount,
                                order.womenCount,
                              );
                              return (
                                <Paper
                                  key={order.id}
                                  withBorder
                                  radius="md"
                                  shadow="xs"
                                  p="sm"
                                  style={{ background: "#f8fafc" }}
                                >
                                  <Stack gap={8}>
                                    <Group justify="space-between" align="flex-start">
                                      <Stack gap={2}>
                                        <Text fw={600}>{order.customerName || "Unnamed guest"}</Text>
                                        <Text size="xs" c="dimmed">
                                          {bookingLink ? (
                                            <Anchor
                                              href={bookingLink}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              size="xs"
                                            >
                                              {bookingDisplay}
                                            </Anchor>
                                          ) : (
                                            bookingDisplay
                                          )}
                                        </Text>
                                      </Stack>
                                    <Badge color="orange" variant="light">
                                      {`${order.quantity} people`}
                                    </Badge>
                                  </Group>
                                  <Group gap="xs" wrap="wrap">
                                      <Badge color="teal" variant="light">
                                        {`Men: ${order.menCount}`}
                                      </Badge>
                                      <Badge color="pink" variant="light">
                                        {`Women: ${order.womenCount}`}
                                      </Badge>
                                      {undefinedOrderCount > 0 && (
                                        <Badge color="gray" variant="light">
                                          {`Undefined Genre: ${undefinedOrderCount}`}
                                        </Badge>
                                      )}
                                      <OrderPlatformBadge platform={order.platform} />
                                      <StatusBadge status={order.status} />
                                    {order.extras && (order.extras.tshirts ?? 0) > 0 ? (
                                      <Badge color="blue" variant="light">
                                        {`T-Shirts: ${order.extras.tshirts}`}
                                      </Badge>
                                    ) : null}
                                    {order.extras && (order.extras.cocktails ?? 0) > 0 ? (
                                      <Badge color="violet" variant="light">
                                        {`Cocktails: ${order.extras.cocktails}`}
                                      </Badge>
                                    ) : null}
                                    {order.extras && (order.extras.photos ?? 0) > 0 ? (
                                      <Badge color="grape" variant="light">
                                        {`Photos: ${order.extras.photos}`}
                                      </Badge>
                                    ) : null}
                                  </Group>
                                  <Stack gap={4}>
                                    <Text size="sm" c="dimmed">
                                      Activity Time: {order.timeslot}
                                    </Text>
                                    {(() => {
                                      const link = toWhatsAppLink(order.customerPhone);
                                      return (
                                        <Text size="sm" c="dimmed">
                                          Phone:{' '}
                                          {link ? (
                                            <Text
                                              component="a"
                                              href={link.href}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              fw={600}
                                              c="blue"
                                              style={{ textDecoration: 'none' }}
                                              title="Open in WhatsApp"
                                            >
                                              {link.display}
                                            </Text>
                                          ) : (
                                            order.customerPhone || "Not provided"
                                          )}
                                        </Text>
                                      );
                                    })()}
                                    <Group gap="xs">
                                      {canAmend && (
                                        <Button
                                          size="xs"
                                          variant="light"
                                          onClick={() => openAmendModal(order)}
                                        >
                                          Amend
                                        </Button>
                                      )}
                                      <Button size="xs" variant="default" onClick={() => openDetailsModal(order)}>
                                        Details
                                      </Button>
                                      {canPartialRefund && (
                                        <Button
                                          size="xs"
                                          color="orange"
                                          variant="outline"
                                          onClick={() => openPartialRefundModal(order)}
                                        >
                                          Partial Refund
                                        </Button>
                                      )}
                                      {canCancel && (
                                        <Button
                                          size="xs"
                                          color="red"
                                          variant="outline"
                                          onClick={() => openCancelModal(order)}
                                        >
                                          Cancel
                                        </Button>
                                      )}
                                    </Group>
                                  </Stack>
                                </Stack>
                              </Paper>
                            );
                          })}
                          </Stack>
                        </Stack>
                      </Paper>
                    );
                  }
                  return (
                    <Box
                      key={`${group.productId}-${group.date}-${group.time}`}
                      style={{
                        background: "#fff",
                        borderRadius: 10,
                        boxShadow: "0 18px 36px rgba(15, 23, 42, 0.08)",
                        border: "1px solid #e2e8f0",
                        padding: 24,
                      }}
                    >
                      <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
                        <Stack gap={4}>
                          <Text fw={700} size="lg">
                            {group.productName}
                          </Text>
                          <Group gap="xs" align="center">
                            <Badge color="orange" variant="filled" radius="sm">
                              {group.time}
                            </Badge>
                            <Text size="sm" c="dimmed">
                              {readableDate}
                            </Text>
                          </Group>
                        </Stack>
                        <Group gap="xs" wrap="wrap">
                          <Badge color="green" variant="light">
                            {`${group.totalPeople} people`}
                          </Badge>
                          <Badge color="teal" variant="light">
                            {`Men: ${group.men}`}
                          </Badge>
                          <Badge color="pink" variant="light">
                            {`Women: ${group.women}`}
                          </Badge>
                          {undefinedGroupCount > 0 && (
                            <Badge color="gray" variant="light">
                              {`Undefined Genre: ${undefinedGroupCount}`}
                            </Badge>
                          )}
                          {group.extras.tshirts > 0 && (
                            <Badge color="blue" variant="light">
                              {`T-Shirts: ${group.extras.tshirts}`}
                            </Badge>
                          )}
                          {group.extras.cocktails > 0 && (
                            <Badge color="violet" variant="light">
                              {`Cocktails: ${group.extras.cocktails}`}
                            </Badge>
                          )}
                          {group.extras.photos > 0 && (
                            <Badge color="grape" variant="light">
                              {`Photos: ${group.extras.photos}`}
                            </Badge>
                          )}
                          <Badge color="gray" variant="light">
                            {bookingsLabel}
                          </Badge>
                          <PlatformBadges
                            entries={group.platformBreakdown}
                            prefix={`group-mobile-${group.productId}-${group.time}`}
                          />
                        </Group>
                      </Flex>

                      <Table striped highlightOnHover withColumnBorders mt="md" horizontalSpacing="md" verticalSpacing="sm">
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Booking #</Table.Th>
                              <Table.Th>Contact</Table.Th>
                              <Table.Th>Platform</Table.Th>
                              <Table.Th>Status</Table.Th>
                              <Table.Th>Phone</Table.Th>
                              <Table.Th align="right">People</Table.Th>
                          <Table.Th align="right">Men</Table.Th>
                          <Table.Th align="right">Women</Table.Th>
                          <Table.Th align="right">Undefined Genre</Table.Th>
                          {showAddonColumns && (
                            <>
                              <Table.Th align="right">T-Shirts</Table.Th>
                              <Table.Th align="right">Cocktails</Table.Th>
                              <Table.Th align="right">Photos</Table.Th>
                            </>
                          )}
                          <Table.Th>Activity Time</Table.Th>
                          <Table.Th>Actions</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                        <Table.Tbody>
                          <Table.Tr style={{ background: "#fff7e6" }}>
                            <Table.Td fw={600} c="#475569">Summary</Table.Td>
                              <Table.Td fw={600}>{bookingsLabel}</Table.Td>
                              <Table.Td>
                                <PlatformBadges
                                  entries={group.platformBreakdown}
                                  prefix={`table-summary-${group.productId}-${group.time}`}
                                  withMargin={false}
                                />
                              </Table.Td>
                              <Table.Td />
                              <Table.Td />
                              <Table.Td align="right" fw={600}>
                                {group.totalPeople}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {group.men}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {group.women}
                            </Table.Td>
                            <Table.Td align="right" fw={600}>
                              {undefinedGroupCount}
                            </Table.Td>
                            {showAddonColumns && (
                              <>
                                <Table.Td align="right" fw={600}>
                                  {formatAddonValue(group.extras.tshirts)}
                                </Table.Td>
                                <Table.Td align="right" fw={600}>
                                  {formatAddonValue(group.extras.cocktails)}
                                </Table.Td>
                                <Table.Td align="right" fw={600}>
                                  {formatAddonValue(group.extras.photos)}
                                </Table.Td>
                              </>
                            )}
                            <Table.Td fw={600}>{group.time}</Table.Td>
                            <Table.Td />
                          </Table.Tr>
                          {sortedOrders.map((order) => {
                            const normalizedBookingId = normalizeManifestBookingId(order);
                            const bookingDisplay = normalizedBookingId ?? order.platformBookingId ?? order.id;
                            const bookingLink =
                              order.platformBookingUrl ?? getPlatformBookingLink(order.platform, normalizedBookingId ?? order.platformBookingId);
                            const bookingId = getBookingIdFromOrder(order);
                            const canAmend = isEcwidOrder(order) && Boolean(bookingId);
                            const canCancel = canAmend && order.status !== "cancelled";
                            const canPartialRefund = canAmend && order.status !== "cancelled";
                            const undefinedOrderCount = getUndefinedGenreCount(
                              order.quantity,
                              order.menCount,
                              order.womenCount,
                            );
                            return (
                              <Table.Tr key={order.id}>
                                <Table.Td>
                                  {bookingLink ? (
                                    <Anchor
                                      href={bookingLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      size="sm"
                                    >
                                      {bookingDisplay}
                                    </Anchor>
                                  ) : (
                                    bookingDisplay
                                  )}
                                </Table.Td>
                              <Table.Td>{order.customerName || "-"}</Table.Td>
                              <Table.Td>
                                <OrderPlatformBadge platform={order.platform} />
                              </Table.Td>
                              <Table.Td>
                                <StatusBadge status={order.status} />
                              </Table.Td>
                              <Table.Td>
                                {(() => {
                                  const link = toWhatsAppLink(order.customerPhone);
                                  return link ? (
                                    <a
                                      href={link.href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ fontWeight: 600, textDecoration: 'none', color: 'var(--mantine-color-blue-7)' }}
                                      title="Open in WhatsApp"
                                    >
                                      {link.display}
                                    </a>
                                  ) : (order.customerPhone || "-");
                                })()}
                              </Table.Td>
                              <Table.Td align="right">{order.quantity}</Table.Td>
                              <Table.Td align="right">{order.menCount}</Table.Td>
                              <Table.Td align="right">{order.womenCount}</Table.Td>
                              <Table.Td align="right">{undefinedOrderCount}</Table.Td>
                              {showAddonColumns && (
                                <>
                                  <Table.Td align="right">{formatAddonValue(order.extras?.tshirts)}</Table.Td>
                                  <Table.Td align="right">{formatAddonValue(order.extras?.cocktails)}</Table.Td>
                                  <Table.Td align="right">{formatAddonValue(order.extras?.photos)}</Table.Td>
                                </>
                              )}
                              <Table.Td>{order.timeslot}</Table.Td>
                              <Table.Td>
                                <Group gap="xs">
                                  {canAmend && (
                                    <Button size="xs" variant="light" onClick={() => openAmendModal(order)}>
                                      Amend
                                    </Button>
                                  )}
                                  <Button size="xs" variant="default" onClick={() => openDetailsModal(order)}>
                                    Details
                                  </Button>
                                  {canPartialRefund && (
                                    <Button
                                      size="xs"
                                      color="orange"
                                      variant="outline"
                                      onClick={() => openPartialRefundModal(order)}
                                    >
                                      Partial Refund
                                    </Button>
                                  )}
                                  {canCancel && (
                                    <Button
                                      size="xs"
                                      color="red"
                                      variant="outline"
                                      onClick={() => openCancelModal(order)}
                                    >
                                      Cancel
                                    </Button>
                                  )}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                        </Table.Tbody>
                      </Table>
                    </Box>
                  );
                })}

              </Stack>

            )}

          </Stack>

        )}

      </Stack>

      <Modal
        opened={amendState.opened}
        onClose={closeAmendModal}
        title={
          amendState.order
            ? `Amend booking ${amendState.order.platformBookingId ?? amendState.order.id}`
            : "Amend Ecwid booking"
        }
        size="md"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Updating the pickup details will sync the change to Ecwid first and then to OmniLodge.
          </Text>
          {amendPreview.status === "loading" && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">Loading Ecwid order details...</Text>
            </Group>
          )}
          {amendPreview.status === "error" && (
            <Alert color="red" title="Unable to load Ecwid details">
              {amendPreview.error || "Failed to load Ecwid details."}
            </Alert>
          )}
          {amendPreview.data && amendPreview.status !== "loading" && amendPreview.status !== "error" && (
            <Stack gap="sm">
              {amendPreview.status === "order_missing" && (
                <Alert color="red" title="Ecwid order not found">
                  {amendPreview.data.message || "No matching Ecwid order was found."}
                </Alert>
              )}
              {amendPreview.status === "product_missing" && (
                <Alert color="yellow" title="Product not found in Ecwid order">
                  <Stack gap={4}>
                    <Text size="sm">
                      {amendPreview.data.message || "The Ecwid order exists, but the product is not listed."}
                    </Text>
                    {amendPreview.data.missingItems && amendPreview.data.missingItems.length > 0 && (
                      <Text size="sm" fw={600}>
                        {`Missing items: ${amendPreview.data.missingItems.join(", ")}`}
                      </Text>
                    )}
                  </Stack>
                </Alert>
              )}
              {amendPreview.status === "matched" && (
                <Alert color="green" title="Ecwid match confirmed">
                  {amendPreview.data.message || "Ecwid order and product match found."}
                </Alert>
              )}
          {amendPreview.data.ecwid && (
            <Stack gap="xs">
              <Paper withBorder radius="md" p="sm" bg="#fff7ed">
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Sync OmniLodge to Ecwid
                  </Text>
                  <Text size="xs" c="dimmed">
                    Use this if Ecwid is the source of truth and OmniLodge needs to match the current Ecwid order item.
                  </Text>
                  <Select
                    label="Ecwid item"
                    placeholder="Select an item"
                    data={
                      amendPreview.data.ecwid.items?.map((item, index) => ({
                        value: String(index),
                        label: item.name ? `${item.name} (${item.quantity ?? "-"})` : `Item ${index + 1}`,
                      })) ?? []
                    }
                    value={reconcileState.itemIndex}
                    onChange={(value) =>
                      setReconcileState((prev) => ({ ...prev, itemIndex: value, error: null, success: null }))
                    }
                  />
                  {reconcileState.error && (
                    <Alert color="red" title="Unable to sync">
                      {reconcileState.error}
                    </Alert>
                  )}
                  {reconcileState.success && (
                    <Alert color="green" title="Synced">
                      {reconcileState.success}
                    </Alert>
                  )}
                  <Group justify="flex-end">
                    <Button
                      size="xs"
                      variant="light"
                      onClick={handleReconcileSubmit}
                      loading={reconcileState.loading}
                      disabled={!reconcileState.itemIndex || reconcileState.loading}
                    >
                      Update OmniLodge to Ecwid
                    </Button>
                  </Group>
                </Stack>
              </Paper>
              <Table withColumnBorders>
                <Table.Tbody>
                      <Table.Tr>
                        <Table.Th>Ecwid Order</Table.Th>
                        <Table.Td>{amendPreview.data.ecwid.id ?? amendPreview.data.orderId ?? "-"}</Table.Td>
                      </Table.Tr>
                      <Table.Tr>
                        <Table.Th>Order Pickup Time</Table.Th>
                        <Table.Td>{amendPreview.data.ecwid.pickupTime ?? "-"}</Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                  {amendPreview.data.bookingItems && amendPreview.data.bookingItems.length > 0 && (
                    <Table withColumnBorders striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>OmniLodge Item</Table.Th>
                          <Table.Th>Match</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {amendPreview.data.bookingItems.map((item, index) => (
                          <Table.Tr key={`omnilodge-item-${index}`}>
                            <Table.Td>{item.name ?? "-"}</Table.Td>
                            <Table.Td>
                              <Badge color={item.matched ? "green" : "red"} variant="light">
                                {item.matched ? "Found" : "Missing"}
                              </Badge>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                  {amendPreview.data.ecwid.items && amendPreview.data.ecwid.items.length > 0 && (
                    <Table withColumnBorders striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Item</Table.Th>
                          <Table.Th align="right">Qty</Table.Th>
                          <Table.Th>Pickup Time</Table.Th>
                          <Table.Th>Options</Table.Th>
                          <Table.Th>Match</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {amendPreview.data.ecwid.items.map((item, index) => {
                          const isMatch = Boolean(item.matched);
                          return (
                            <Table.Tr key={`ecwid-item-${index}`} style={isMatch ? { background: "#ecfdf3" } : undefined}>
                              <Table.Td>{item.name ?? "-"}</Table.Td>
                              <Table.Td align="right">{item.quantity ?? "-"}</Table.Td>
                              <Table.Td>{item.pickupTime ?? "-"}</Table.Td>
                              <Table.Td>{item.options && item.options.length > 0 ? item.options.join(", ") : "-"}</Table.Td>
                              <Table.Td>
                                <Badge color={isMatch ? "green" : "gray"} variant="light">
                                  {isMatch ? "Matched" : "Other"}
                                </Badge>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  )}
                </Stack>
              )}
            </Stack>
          )}
          {amendState.order && (
            <Stack gap={2}>
              <Text fw={600}>{amendState.order.customerName || "Unnamed guest"}</Text>
              <Text size="sm" c="dimmed">
                Current pickup: {amendState.order.date} @ {amendState.order.timeslot}
              </Text>
            </Stack>
          )}
          <DatePickerInput
            label="Pickup date"
            value={amendState.formDate}
            onChange={handleAmendDateChange}
            required
            placeholder="Select new pickup date"
          />
          <TimeInput
            label="Pickup time"
            value={amendState.formTime}
            onChange={handleAmendTimeChange}
            required
            placeholder="HH:mm"
          />
          {amendState.error && (
            <Alert color="red" title="Unable to update booking">
              {amendState.error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeAmendModal}>
              Cancel
            </Button>
            <Button
              onClick={handleAmendSubmit}
              loading={amendState.submitting}
              disabled={!amendState.formDate || !amendState.formTime || amendState.submitting}
            >
              Save changes
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={partialRefundState.opened}
        onClose={closePartialRefundModal}
        title="Partial Refund"
        size="md"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Partial refunds must be less than the remaining paid amount. Use Cancel for a full refund.
          </Text>
          {partialRefundState.loading && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">Loading refund details...</Text>
            </Group>
          )}
          {partialRefundState.error && (
            <Alert color="red" title="Unable to load refund details">
              {partialRefundState.error}
            </Alert>
          )}
          {partialRefundState.preview && (
            <Stack gap="sm">
              <Table withColumnBorders>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th>Order</Table.Th>
                    <Table.Td>{partialRefundState.preview.orderId}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Paid</Table.Th>
                    <Table.Td>
                      {formatStripeAmount(
                        partialRefundState.preview.stripe.amount,
                        partialRefundState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Refunded</Table.Th>
                    <Table.Td>
                      {formatStripeAmount(
                        partialRefundState.preview.stripe.amountRefunded,
                        partialRefundState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Remaining</Table.Th>
                    <Table.Td>
                      {formatStripeAmount(
                        partialRefundState.preview.remainingAmount,
                        partialRefundState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              {partialRefundState.preview.addons.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    Add-ons refund
                  </Text>
                  <Table withColumnBorders striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Addon</Table.Th>
                        <Table.Th align="right">Qty</Table.Th>
                        <Table.Th align="right">Unit Price</Table.Th>
                        <Table.Th align="right">Refund Qty</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {partialRefundState.preview.addons.map((addon) => {
                        const unitPrice = addon.unitPrice
                          ? parseMoney(addon.unitPrice)
                          : addon.totalPrice && addon.quantity
                            ? parseMoney(addon.totalPrice) / addon.quantity
                            : 0;
                        return (
                          <Table.Tr key={addon.id}>
                            <Table.Td>{addon.platformAddonName ?? `Addon ${addon.id}`}</Table.Td>
                            <Table.Td align="right">{addon.quantity}</Table.Td>
                            <Table.Td align="right">
                              {unitPrice > 0
                                ? `${unitPrice.toFixed(2)} ${(addon.currency ?? partialRefundState.preview?.stripe.currency ?? "").toUpperCase()}`
                                : "-"}
                            </Table.Td>
                            <Table.Td align="right">
                              <NumberInput
                                value={partialRefundState.addonQuantities[addon.id] ?? 0}
                                min={0}
                                max={addon.quantity}
                                step={1}
                                allowDecimal={false}
                                onChange={(value) => handlePartialRefundAddonChange(addon.id, value)}
                              />
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Stack>
              )}

              <NumberInput
                label="Refund amount"
                value={partialRefundState.amount ?? 0}
                min={0}
                max={Math.max((partialRefundState.preview.remainingAmount - 1) / 100, 0)}
                step={1}
                decimalScale={2}
                fixedDecimalScale
                onChange={handlePartialRefundAmountChange}
                description="Amount is auto-calculated from selected add-ons. You can override it."
                rightSection={
                  <Text size="xs" c="dimmed">
                    {partialRefundState.preview.stripe.currency?.toUpperCase() ?? ""}
                  </Text>
                }
                rightSectionWidth={64}
              />

              {partialRefundState.success && (
                <Alert color="green" title="Refund submitted">
                  {partialRefundState.success}
                </Alert>
              )}
            </Stack>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={closePartialRefundModal} disabled={partialRefundState.submitting}>
              Close
            </Button>
            <Button
              color="orange"
              onClick={handleSubmitPartialRefund}
              loading={partialRefundState.submitting}
              disabled={!partialRefundState.preview || partialRefundState.submitting}
            >
              Issue Partial Refund
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={cancelState.opened}
        onClose={closeCancelModal}
        title={
          cancelState.order
            ? `Cancel booking ${cancelState.order.platformBookingId ?? cancelState.order.id}`
            : "Cancel Ecwid booking"
        }
        size="md"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            We will verify the Stripe transaction before issuing the refund and cancelling the booking.
          </Text>
          {cancelState.loading && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">Loading Stripe transaction details...</Text>
            </Group>
          )}
          {cancelState.preview && (
            <Stack gap="sm">
              <Table withColumnBorders>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th>Order</Table.Th>
                    <Table.Td>{cancelState.preview.orderId}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Transaction</Table.Th>
                    <Table.Td>
                      {cancelState.preview.stripe.id} (
                      {cancelState.preview.stripe.type === "payment_intent" ? "Payment intent" : "Charge"})
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Amount</Table.Th>
                    <Table.Td>
                      {formatStripeAmount(
                        cancelState.preview.stripe.amount,
                        cancelState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Refunded</Table.Th>
                    <Table.Td>
                      {formatStripeAmount(
                        cancelState.preview.stripe.amountRefunded,
                        cancelState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Status</Table.Th>
                    <Table.Td>
                      <Badge color={getStripeStatusColor(cancelState.preview.stripe.status)} variant="light">
                        {(cancelState.preview.stripe.status ?? "unknown").toUpperCase()}
                      </Badge>
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Created</Table.Th>
                    <Table.Td>{dayjs.unix(cancelState.preview.stripe.created).format("YYYY-MM-DD HH:mm")}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>External ID</Table.Th>
                    <Table.Td>{cancelState.preview.externalTransactionId}</Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>
              {cancelState.preview.stripe.fullyRefunded && (
                <Alert color="yellow" title="Already refunded">
                  This Stripe transaction is already fully refunded. Confirming will only cancel the booking in OmniLodge.
                </Alert>
              )}
            </Stack>
          )}
          {cancelState.error && (
            <Alert color="red" title="Unable to load refund details">
              {cancelState.error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeCancelModal} disabled={cancelState.submitting}>
              Close
            </Button>
            <Button
              color="red"
              onClick={handleConfirmRefund}
              loading={cancelState.submitting}
              disabled={cancelState.loading || !cancelState.preview || cancelState.submitting}
            >
              {cancelState.preview?.stripe.fullyRefunded ? "Confirm Cancel" : "Confirm Refund"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={detailsState.opened}
        onClose={closeDetailsModal}
        title="Booking Details"
        size="lg"
        centered
      >
        <Stack gap="md">
          {detailsState.loading && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">Loading booking details...</Text>
            </Group>
          )}
          {detailsState.error && (
            <Alert color="red" title="Unable to load booking details">
              {detailsState.error}
            </Alert>
          )}
          {!detailsState.loading && !detailsState.error && detailsState.data && (
            <>
              <Stack gap={4}>
                <Text fw={600}>
                  {detailsState.data.booking.platformBookingId ?? detailsState.data.booking.id}
                </Text>
                <Text size="sm" c="dimmed">
                  {detailsState.data.booking.productName} · {detailsState.data.booking.date}{" "}
                  {detailsState.data.booking.timeslot ? `@ ${detailsState.data.booking.timeslot}` : ""}
                </Text>
              </Stack>
              <Tabs
                value={detailsState.activeTab}
                onChange={(value) =>
                  setDetailsState((prev) => ({ ...prev, activeTab: value ?? "emails" }))
                }
              >
                <Tabs.List>
                  <Tabs.Tab value="emails">Emails</Tabs.Tab>
                  <Tabs.Tab value="events">Events</Tabs.Tab>
                  <Tabs.Tab value="stripe">Stripe</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="emails" pt="md">
                  {detailsState.data.emails.length === 0 ? (
                    <Alert color="blue" title="No emails">
                      No related emails were found for this booking.
                    </Alert>
                  ) : (
                    <Stack gap="sm">
                      <Table withColumnBorders striped highlightOnHover>
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Subject</Table.Th>
                            <Table.Th>Received</Table.Th>
                            <Table.Th>Status</Table.Th>
                            <Table.Th>Actions</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {detailsState.data.emails.map((email) => (
                            <Table.Tr key={email.messageId}>
                              <Table.Td>{email.subject ?? email.messageId}</Table.Td>
                              <Table.Td>{formatDateTime(email.receivedAt ?? email.internalDate ?? null)}</Table.Td>
                              <Table.Td>{email.ingestionStatus ?? "-"}</Table.Td>
                              <Table.Td>
                                <Button
                                  size="xs"
                                  variant="light"
                                  onClick={() => handleDetailsPreview(email.messageId)}
                                >
                                  Preview
                                </Button>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                      {detailsState.previewError && (
                        <Alert color="red" title="Unable to load email preview">
                          {detailsState.previewError}
                        </Alert>
                      )}
                    </Stack>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="events" pt="md">
                  {detailsState.data.events.length === 0 ? (
                    <Alert color="blue" title="No events">
                      No booking events were found.
                    </Alert>
                  ) : (
                    <Table withColumnBorders striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Type</Table.Th>
                          <Table.Th>Status</Table.Th>
                          <Table.Th>Occurred</Table.Th>
                          <Table.Th>Processed</Table.Th>
                          <Table.Th>Message ID</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {detailsState.data.events.map((event) => (
                          <Table.Tr key={event.id}>
                            <Table.Td>{event.eventType ?? "-"}</Table.Td>
                            <Table.Td>{event.statusAfter ?? "-"}</Table.Td>
                            <Table.Td>{formatDateTime(event.occurredAt ?? null)}</Table.Td>
                            <Table.Td>{formatDateTime(event.processedAt ?? null)}</Table.Td>
                            <Table.Td>{event.emailMessageId ?? "-"}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="stripe" pt="md">
                  {detailsState.data.stripe ? (
                    <Table withColumnBorders>
                      <Table.Tbody>
                        <Table.Tr>
                          <Table.Th>Transaction</Table.Th>
                          <Table.Td>{detailsState.data.stripe.id}</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Th>Type</Table.Th>
                          <Table.Td>{detailsState.data.stripe.type}</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Th>Status</Table.Th>
                          <Table.Td>{detailsState.data.stripe.status ?? "-"}</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Th>Amount</Table.Th>
                          <Table.Td>
                            {formatStripeAmount(detailsState.data.stripe.amount, detailsState.data.stripe.currency)}
                          </Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Th>Refunded</Table.Th>
                          <Table.Td>
                            {formatStripeAmount(
                              detailsState.data.stripe.amountRefunded,
                              detailsState.data.stripe.currency,
                            )}
                          </Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Th>Receipt Email</Table.Th>
                          <Table.Td>{detailsState.data.stripe.receiptEmail ?? "-"}</Table.Td>
                        </Table.Tr>
                        <Table.Tr>
                          <Table.Th>Created</Table.Th>
                          <Table.Td>{detailsState.data.stripe.created ? formatDateTime(new Date(detailsState.data.stripe.created * 1000).toISOString()) : "-"}</Table.Td>
                        </Table.Tr>
                      </Table.Tbody>
                    </Table>
                  ) : (
                    <Alert color="blue" title="No Stripe data">
                      {detailsState.data.stripeError ?? "No Stripe transaction was found for this booking."}
                    </Alert>
                  )}
                </Tabs.Panel>
              </Tabs>
            </>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={detailsState.previewOpen}
        onClose={closeDetailsPreview}
        title="Email preview"
        fullScreen
        centered
      >
        <Stack gap="sm">
          {detailsState.previewError && (
            <Alert color="red" title="Failed to load email preview">
              {detailsState.previewError}
            </Alert>
          )}
          {detailsState.previewLoading && (
            <Box style={{ minHeight: 120 }}>
              <Loader variant="dots" />
            </Box>
          )}
          {detailsState.previewData && (
            <>
              <Stack gap={4}>
                <Text fw={600}>{detailsState.previewData.subject ?? "No subject"}</Text>
                <Text size="sm" c="dimmed">
                  {detailsState.previewData.fromAddress ?? "-"}
                </Text>
                <Text size="sm" c="dimmed">
                  {detailsState.previewData.toAddresses ?? "-"}
                </Text>
                <Text size="sm">
                  {formatDateTime(detailsState.previewData.receivedAt ?? detailsState.previewData.internalDate ?? null)}
                </Text>
                <Badge size="sm" variant="light">
                  {(detailsState.previewData.ingestionStatus ?? "unknown").toUpperCase()}
                </Badge>
              </Stack>
              {detailsPreviewHtml ? (
                <Box style={{ height: "calc(100vh - 240px)" }}>
                  <iframe
                    title="Email HTML preview"
                    srcDoc={detailsPreviewHtml}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                    }}
                  />
                </Box>
              ) : detailsPreviewBody ? (
                <Paper withBorder radius="md" p="sm" bg="#f8fafc">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {detailsPreviewBody}
                  </Text>
                </Paper>
              ) : (
                <Alert color="yellow" title="No preview content">
                  No email preview content available.
                </Alert>
              )}
            </>
          )}
        </Stack>
      </Modal>

    </PageAccessGuard>

  );

};



export default BookingsManifestPage;
