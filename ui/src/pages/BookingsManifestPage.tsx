import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

import {
  ActionIcon,
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
  Popover,
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

import { DatePicker, DatePickerInput, TimeInput } from "@mantine/dates";
import { useMediaQuery } from '@mantine/hooks';
import { Checkroom, LocalBar, MailOutline, PhotoCamera, WhatsApp } from "@mui/icons-material";

import { IconArrowLeft, IconArrowRight, IconEye, IconEyeOff, IconRefresh, IconSearch } from "@tabler/icons-react";

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

const PHONE_NATIONALITY_PREFIXES: Array<{ prefix: string; nationality: string }> = [
  { prefix: "+48", nationality: "Poland" },
  { prefix: "+44", nationality: "United Kingdom" },
  { prefix: "+1", nationality: "United States / Canada" },
  { prefix: "+34", nationality: "Spain" },
  { prefix: "+33", nationality: "France" },
  { prefix: "+49", nationality: "Germany" },
  { prefix: "+39", nationality: "Italy" },
  { prefix: "+351", nationality: "Portugal" },
  { prefix: "+353", nationality: "Ireland" },
  { prefix: "+31", nationality: "Netherlands" },
  { prefix: "+32", nationality: "Belgium" },
  { prefix: "+46", nationality: "Sweden" },
  { prefix: "+47", nationality: "Norway" },
  { prefix: "+45", nationality: "Denmark" },
  { prefix: "+358", nationality: "Finland" },
  { prefix: "+420", nationality: "Czech Republic" },
  { prefix: "+421", nationality: "Slovakia" },
  { prefix: "+36", nationality: "Hungary" },
  { prefix: "+43", nationality: "Austria" },
  { prefix: "+41", nationality: "Switzerland" },
  { prefix: "+40", nationality: "Romania" },
  { prefix: "+30", nationality: "Greece" },
  { prefix: "+370", nationality: "Lithuania" },
  { prefix: "+371", nationality: "Latvia" },
  { prefix: "+372", nationality: "Estonia" },
  { prefix: "+380", nationality: "Ukraine" },
  { prefix: "+61", nationality: "Australia" },
  { prefix: "+64", nationality: "New Zealand" },
  { prefix: "+52", nationality: "Mexico" },
  { prefix: "+55", nationality: "Brazil" },
  { prefix: "+54", nationality: "Argentina" },
  { prefix: "+57", nationality: "Colombia" },
];

const guessNationalityFromPhone = (raw?: string): string => {
  const source = String(raw ?? "").trim().replace(/[^\d+]/g, "");
  if (!source) {
    return "Unknown";
  }

  let normalized = source;
  if (normalized.startsWith("00")) {
    normalized = `+${normalized.slice(2)}`;
  } else if (normalized.startsWith("07")) {
    normalized = `+44${normalized.slice(1)}`;
  } else if (normalized.startsWith("44")) {
    normalized = `+${normalized}`;
  } else if (!normalized.startsWith("+")) {
    return "Unknown";
  }

  if (!normalized) {
    return "Unknown";
  }
  const match = PHONE_NATIONALITY_PREFIXES.find((entry) => normalized.startsWith(entry.prefix));
  return match?.nationality ?? "Unknown";
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

const PLATFORM_LABELS: Record<string, string> = {
  ecwid: "Ecwid",
  fareharbor: "FareHarbor",
  viator: "Viator",
  getyourguide: "GetYourGuide",
  freetour: "FreeTour",
  xperiencepoland: "XperiencePoland",
  airbnb: "Airbnb",
  unknown: "Unknown",
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

const BOOKING_BREAKDOWN_BADGE_BASE_STYLE = {
  width: "100%",
  justifyContent: "center",
  whiteSpace: "nowrap" as const,
  border: "1px solid transparent",
  fontSize: 11,
};

const BOOKING_BREAKDOWN_BADGE_STYLES = {
  men: { backgroundColor: "#e5eef8", color: "#1f3f63", borderColor: "#bfd2e8" },
  women: { backgroundColor: "#f4e7ee", color: "#6b2f4a", borderColor: "#ddc1cf" },
  undefined: { backgroundColor: "#eceff4", color: "#3f4b5a", borderColor: "#cdd5df" },
};

const normalizePlatformKey = (value?: string | null): string => {
  if (!value) {
    return "unknown";
  }
  const key = value.toLowerCase().trim();
  return PLATFORM_COLORS[key] ? key : "unknown";
};

const formatPlatformLabel = (value?: string | null): string => {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if (key && PLATFORM_LABELS[key]) {
    return PLATFORM_LABELS[key];
  }
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

const ATTENDANCE_TRACKED_BOOKING_STATUSES = new Set<BookingStatus>([
  "confirmed",
  "amended",
  "rebooked",
]);

const createStatusCountsFromOrders = (orders: UnifiedOrder[]): Record<BookingStatus, number> => {
  return orders.reduce((acc, order) => {
    const rawStatus = order.status ?? "unknown";
    if (rawStatus !== "completed" && rawStatus !== "no_show") {
      acc[rawStatus] = (acc[rawStatus] ?? 0) + 1;
    }

    if (!ATTENDANCE_TRACKED_BOOKING_STATUSES.has(rawStatus)) {
      return acc;
    }

    const attendanceStatus = String(order.attendanceStatus ?? "")
      .trim()
      .toLowerCase();

    if (attendanceStatus === "checked_in_full" || attendanceStatus === "checked_in_partial") {
      acc.completed = (acc.completed ?? 0) + 1;
      return acc;
    }

    if (attendanceStatus === "no_show") {
      acc.no_show = (acc.no_show ?? 0) + 1;
    }

    return acc;
  }, createEmptyStatusCounts());
};

const createStatusCountsFromGroups = (groups: ManifestGroup[]): Record<BookingStatus, number> => {
  return createStatusCountsFromOrders(groups.flatMap((group) => group.orders));
};

type OrderStatusDisplayKey =
  | "pending"
  | "confirmed"
  | "amended"
  | "rebooked"
  | "cancelled"
  | "completed"
  | "partial"
  | "no_show"
  | "unknown";

const ORDER_STATUS_APPEARANCE: Record<
  OrderStatusDisplayKey,
  { label: string; backgroundColor: string; textColor: string }
> = {
  pending: { label: "Pending", backgroundColor: "#2563eb", textColor: "#ffffff" },
  confirmed: { label: "Confirmed", backgroundColor: "#16a34a", textColor: "#ffffff" },
  amended: { label: "Amended", backgroundColor: "#6b7280", textColor: "#ffffff" },
  rebooked: { label: "Rebooked", backgroundColor: "#6b7280", textColor: "#ffffff" },
  cancelled: { label: "Cancelled", backgroundColor: "#ec4899", textColor: "#ffffff" },
  completed: { label: "Completed", backgroundColor: "#16a34a", textColor: "#ffffff" },
  partial: { label: "Partial", backgroundColor: "#dc2626", textColor: "#ffffff" },
  no_show: { label: "No Show", backgroundColor: "#111827", textColor: "#ffffff" },
  unknown: { label: "Unknown", backgroundColor: "#111827", textColor: "#ffffff" },
};

const resolveOrderStatusDisplayKey = (
  status?: BookingStatus | null,
  attendanceStatus?: string | null,
): OrderStatusDisplayKey => {
  const safeStatus = status ?? "unknown";
  const normalizedAttendanceStatus = String(attendanceStatus ?? "")
    .trim()
    .toLowerCase();

  if (ATTENDANCE_TRACKED_BOOKING_STATUSES.has(safeStatus)) {
    if (normalizedAttendanceStatus === "checked_in_full") {
      return "completed";
    }
    if (normalizedAttendanceStatus === "checked_in_partial") {
      return "partial";
    }
    if (normalizedAttendanceStatus === "no_show") {
      return "no_show";
    }
  }

  if (safeStatus === "pending") return "pending";
  if (safeStatus === "confirmed") return "confirmed";
  if (safeStatus === "amended") return "amended";
  if (safeStatus === "rebooked") return "rebooked";
  if (safeStatus === "cancelled") return "cancelled";
  if (safeStatus === "completed") return "completed";
  if (safeStatus === "no_show") return "no_show";
  return "unknown";
};

const normalizeAttendanceCount = (value?: number | null): number => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.round(parsed));
};

const PARTIAL_ATTENDANCE_ADDON_LABELS: Array<{ key: keyof OrderExtras; label: string }> = [
  { key: "tshirts", label: "T-Shirts attended" },
  { key: "cocktails", label: "Cocktails attended" },
  { key: "photos", label: "Photos attended" },
];

const PartialStatusPopoverContent = ({ order }: { order: UnifiedOrder }) => {
  const bookedPeople = normalizeAttendanceCount(order.quantity);
  const attendedPeople = Math.min(bookedPeople, normalizeAttendanceCount(order.attendedTotal));
  const bookedExtras: OrderExtras = {
    tshirts: normalizeAttendanceCount(order.extras?.tshirts),
    cocktails: normalizeAttendanceCount(order.extras?.cocktails),
    photos: normalizeAttendanceCount(order.extras?.photos),
  };
  const attendedExtras: OrderExtras = {
    tshirts: Math.min(bookedExtras.tshirts, normalizeAttendanceCount(order.attendedExtras?.tshirts)),
    cocktails: Math.min(bookedExtras.cocktails, normalizeAttendanceCount(order.attendedExtras?.cocktails)),
    photos: Math.min(bookedExtras.photos, normalizeAttendanceCount(order.attendedExtras?.photos)),
  };
  const addonLines = PARTIAL_ATTENDANCE_ADDON_LABELS
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      booked: bookedExtras[entry.key],
      attended: attendedExtras[entry.key],
    }))
    .filter((entry) => entry.booked > 0 || entry.attended > 0);

  return (
    <Stack gap={4}>
      <Text size="xs" fw={700} c="dark.7">
        {`Attended people: ${attendedPeople}/${bookedPeople}`}
      </Text>
      {addonLines.length > 0 ? (
        <Stack gap={2}>
          {addonLines.map((entry) => (
            <Text key={`partial-addon-${entry.key}`} size="xs" c="dark.6">
              {`${entry.label}: ${entry.attended}/${entry.booked}`}
            </Text>
          ))}
        </Stack>
      ) : (
        <Text size="xs" c="dimmed">
          No add-on attendance
        </Text>
      )}
    </Stack>
  );
};

const StatusBadge = ({
  status,
  attendanceStatus,
  order,
}: {
  status?: BookingStatus | null;
  attendanceStatus?: string | null;
  order?: UnifiedOrder;
}) => {
  const statusDisplayKey = resolveOrderStatusDisplayKey(status, attendanceStatus);
  const presentation = ORDER_STATUS_APPEARANCE[statusDisplayKey];
  const badgeNode = (
    <Badge
      variant="filled"
      style={{
        backgroundColor: presentation.backgroundColor,
        color: presentation.textColor,
      }}
    >
      {presentation.label}
    </Badge>
  );

  if (statusDisplayKey !== "partial" || !order) {
    return badgeNode;
  }

  return (
    <Popover withArrow position="top" shadow="md" width={220}>
      <Popover.Target>
        <Box
          component="button"
          type="button"
          style={{
            padding: 0,
            border: 0,
            background: "transparent",
            cursor: "pointer",
          }}
          aria-label="Show partial attendance details"
        >
          {badgeNode}
        </Box>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <PartialStatusPopoverContent order={order} />
      </Popover.Dropdown>
    </Popover>
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
  statusCounts: createStatusCountsFromGroups(groups),
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

const SUMMARY_CHIP_TONES = {
  overview: { bg: "#d6eceb", border: "#7faeac", text: "#173f3d" },
  breakdown: { bg: "#f1d3e2", border: "#c389aa", text: "#5b1f3f" },
  extras: { bg: "#d4eadf", border: "#8ebaa2", text: "#1f4a36" },
  platforms: { bg: "#d8dee8", border: "#8e9aae", text: "#243347" },
} as const;

type SummaryChipTone = keyof typeof SUMMARY_CHIP_TONES;

const SUMMARY_SECTION_TONES: Record<SummaryChipTone, { bg: string; border: string }> = {
  overview: { bg: "#edf5f5", border: "#c5dddd" },
  breakdown: { bg: "#f8edf3", border: "#e6cdd9" },
  extras: { bg: "#eef6eb", border: "#ccddc5" },
  platforms: { bg: "#eef1f5", border: "#cfd7e1" },
};

const SummaryChip = ({
  children,
  tone = "overview",
  noWrap = false,
  textSize = "sm",
}: {
  children: ReactNode;
  tone?: SummaryChipTone;
  noWrap?: boolean;
  textSize?: "sm" | "xs";
}) => {
  const palette = SUMMARY_CHIP_TONES[tone];
  return (
    <Paper
      withBorder
      radius="md"
      py={5}
      px="sm"
      style={{
        width: "100%",
        minWidth: 0,
        textAlign: "center",
        backgroundColor: palette.bg,
        borderColor: palette.border,
        minHeight: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        size={textSize}
        fw={600}
        c={palette.text}
        style={{
          whiteSpace: noWrap ? "nowrap" : "normal",
          overflow: "visible",
          textOverflow: "clip",
          wordBreak: noWrap ? "normal" : "break-word",
          lineHeight: 1.2,
          width: "100%",
        }}
      >
        {children}
      </Text>
    </Paper>
  );
};

const SummaryChipGridRow = ({
  children,
  columns,
}: {
  children: ReactNode;
  columns: number;
}) => (
  <Box
    w="100%"
    style={{
      display: "grid",
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap: 8,
    }}
  >
    {children}
  </Box>
);

const SummarySection = ({
  children,
  tone,
}: {
  children: ReactNode;
  tone: SummaryChipTone;
}) => {
  const palette = SUMMARY_SECTION_TONES[tone];
  return (
    <Paper
      withBorder
      radius="md"
      p={8}
      style={{
        backgroundColor: palette.bg,
        borderColor: palette.border,
      }}
    >
      {children}
    </Paper>
  );
};

type SummaryPanelView = "totals" | "statuses";

const SummaryPanelSwitcher = ({
  totalsContent,
  statusesContent,
  buttonSize = "sm",
}: {
  totalsContent: ReactNode;
  statusesContent: ReactNode;
  buttonSize?: "xs" | "sm";
}) => {
  const [activeView, setActiveView] = useState<SummaryPanelView | null>(null);

  return (
    <Stack gap="sm" w="100%">
      <Group gap="xs" wrap="nowrap" grow>
        <Button
          size={buttonSize}
          variant={activeView === "totals" ? "filled" : "light"}
          onClick={() => setActiveView((prev) => (prev === "totals" ? null : "totals"))}
        >
          Totals
        </Button>
        <Button
          size={buttonSize}
          variant={activeView === "statuses" ? "filled" : "light"}
          onClick={() => setActiveView((prev) => (prev === "statuses" ? null : "statuses"))}
        >
          Statuses
        </Button>
      </Group>
      {activeView === "totals" ? totalsContent : null}
      {activeView === "statuses" ? statusesContent : null}
    </Stack>
  );
};

const ProductSummaryPanels = ({
  group,
  undefinedGroupCount,
}: {
  group: ManifestGroup;
  undefinedGroupCount: number;
}) => {
  const groupStatusCounts = createStatusCountsFromOrders(group.orders);
  const platformEntries = (group.platformBreakdown ?? []).filter((entry) => entry.totalPeople > 0);
  const overviewChips = [
    { key: "people", value: group.totalPeople, label: `People: ${group.totalPeople}` },
    { key: "bookings", value: group.orders.length, label: `Bookings: ${group.orders.length}` },
  ].filter((chip) => chip.value > 0);
  const breakdownChips = [
    { key: "men", value: group.men, label: `Men: ${group.men}` },
    { key: "women", value: group.women, label: `Women: ${group.women}` },
    { key: "undefined", value: undefinedGroupCount, label: `Undefined: ${undefinedGroupCount}` },
  ].filter((chip) => chip.value > 0);
  const extrasChips = [
    { key: "tshirts", value: group.extras.tshirts, label: `T-Shirts: ${group.extras.tshirts}`, textSize: "xs" as const },
    { key: "cocktails", value: group.extras.cocktails, label: `Cocktails: ${group.extras.cocktails}`, textSize: "xs" as const },
    { key: "photos", value: group.extras.photos, label: `Photos: ${group.extras.photos}`, textSize: "xs" as const },
  ].filter((chip) => chip.value > 0);
  const statusChips = BOOKING_STATUSES.map((status) => ({
    status,
    count: groupStatusCounts?.[status] ?? 0,
  })).filter((chip) => chip.count > 0);

  return (
    <SummaryPanelSwitcher
      buttonSize="xs"
      totalsContent={
        <Stack gap="sm" w="100%">
          {overviewChips.length > 0 && (
            <SummarySection tone="overview">
              <SummaryChipGridRow columns={Math.min(2, overviewChips.length)}>
                {overviewChips.map((chip) => (
                  <SummaryChip key={`product-summary-overview-${group.productId}-${group.time}-${chip.key}`} tone="overview">
                    {chip.label}
                  </SummaryChip>
                ))}
              </SummaryChipGridRow>
            </SummarySection>
          )}

          {breakdownChips.length > 0 && (
            <SummarySection tone="breakdown">
              <SummaryChipGridRow columns={Math.min(3, breakdownChips.length)}>
                {breakdownChips.map((chip) => (
                  <SummaryChip
                    key={`product-summary-breakdown-${group.productId}-${group.time}-${chip.key}`}
                    tone="breakdown"
                    noWrap
                    textSize="xs"
                  >
                    {chip.key === "undefined" ? <span style={{ fontSize: 10 }}>{chip.label}</span> : chip.label}
                  </SummaryChip>
                ))}
              </SummaryChipGridRow>
            </SummarySection>
          )}

          {extrasChips.length > 0 && (
            <SummarySection tone="extras">
              <SummaryChipGridRow columns={Math.min(3, extrasChips.length)}>
                {extrasChips.map((chip) => (
                  <SummaryChip
                    key={`product-summary-extras-${group.productId}-${group.time}-${chip.key}`}
                    tone="extras"
                    noWrap
                    textSize={chip.textSize}
                  >
                    {chip.key === "cocktails" ? <span style={{ fontSize: 11 }}>{chip.label}</span> : chip.label}
                  </SummaryChip>
                ))}
              </SummaryChipGridRow>
            </SummarySection>
          )}

          {platformEntries.length > 0 && (
            <SummarySection tone="platforms">
              <SummaryChipGridRow columns={Math.min(2, platformEntries.length)}>
                {platformEntries.map((entry) => (
                  <SummaryChip key={`product-summary-platform-${group.productId}-${group.time}-${entry.platform}`} tone="platforms">
                    {`${formatPlatformLabel(entry.platform)}: ${entry.totalPeople}`}
                    <wbr />
                    <span style={{ whiteSpace: "nowrap" }}>
                      {` (${entry.orderCount} ${entry.orderCount === 1 ? "order" : "orders"})`}
                    </span>
                  </SummaryChip>
                ))}
              </SummaryChipGridRow>
            </SummarySection>
          )}
        </Stack>
      }
      statusesContent={
        <Stack gap="sm" w="100%">
          {statusChips.length > 0 && (
            <SummarySection tone="platforms">
              <SummaryChipGridRow columns={Math.min(2, statusChips.length)}>
                {statusChips.map((chip) => (
                  <SummaryChip
                    key={`product-summary-status-${group.productId}-${group.time}-${chip.status}`}
                    tone="platforms"
                    noWrap
                    textSize="xs"
                  >
                    {`${formatStatusLabel(chip.status)}: ${chip.count}`}
                  </SummaryChip>
                ))}
              </SummaryChipGridRow>
            </SummarySection>
          )}
        </Stack>
      }
    />
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

const isXperiencePolandOrder = (order: UnifiedOrder): boolean => {
  return (order.platform ?? '').toLowerCase() === 'xperiencepoland';
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
  mode: "ecwid" | "xperience" | null;
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
  reprocessMessageId: string | null;
  reprocessError: string | null;
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
  mode: null,
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
  mode: "ecwid_refund" | "xperience_cancel" | null;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  preview: RefundPreviewResponse | null;
};

const createDefaultCancelState = (): CancelRefundState => ({
  opened: false,
  order: null,
  bookingId: null,
  mode: null,
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
  const [dateModalOpened, setDateModalOpened] = useState(false);

  const [ingestStatus, setIngestStatus] = useState<FetchStatus>("idle");

  const [reloadToken, setReloadToken] = useState(0);
  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState(false);
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
    reprocessMessageId: null,
    reprocessError: null,
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
  const [mobileActionsOrder, setMobileActionsOrder] = useState<UnifiedOrder | null>(null);
  const [expandedMobileCustomerDetails, setExpandedMobileCustomerDetails] = useState<Record<string, boolean>>({});

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
    const ecwidOrder = isEcwidOrder(order);
    const xperienceOrder = isXperiencePolandOrder(order);
    baseState.opened = true;
    baseState.order = order;
    baseState.bookingId = getBookingIdFromOrder(order);
    baseState.mode = ecwidOrder ? "ecwid" : xperienceOrder ? "xperience" : null;
    baseState.formDate = order.date && dayjs(order.date, DATE_FORMAT, true).isValid()
      ? dayjs(order.date, DATE_FORMAT).toDate()
      : null;
    baseState.formTime = order.timeslot && /^\d{1,2}:\d{2}$/.test(order.timeslot) ? order.timeslot : '';
    if (!baseState.bookingId) {
      baseState.error = "Unable to locate OmniLodge booking reference for this order.";
    } else if (!baseState.mode) {
      baseState.error = "Amend is not supported for this platform from the manifest.";
    }
    setAmendState(baseState);
    if (baseState.bookingId && baseState.mode === "ecwid") {
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
    if (!amendState.mode) {
      setAmendState((prev) => ({ ...prev, error: "Amend is not supported for this platform." }));
      return;
    }
    const normalizedTime = normalizeTimeInput(amendState.formTime);
    if (!normalizedTime) {
      setAmendState((prev) => ({ ...prev, error: "Please provide a valid pickup time (HH:mm)." }));
      return;
    }
    setAmendState((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      const endpoint =
        amendState.mode === "ecwid"
          ? `/bookings/${amendState.bookingId}/amend-ecwid`
          : `/bookings/${amendState.bookingId}/amend-xperience`;
      await axiosInstance.post(endpoint, {
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
      setDetailsState({
        opened: true,
        loading: false,
        error: "Unable to locate OmniLodge booking reference for this order.",
        data: null,
        activeTab: "emails",
        previewMessageId: null,
        previewLoading: false,
        previewError: null,
        reprocessMessageId: null,
        reprocessError: null,
        previewData: null,
        previewOpen: false,
      });
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
      reprocessMessageId: null,
      reprocessError: null,
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
      reprocessMessageId: null,
      reprocessError: null,
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

  const handleDetailsReprocess = async (messageId: string) => {
    if (!messageId || detailsState.reprocessMessageId) {
      return;
    }
    const bookingId = detailsState.data?.booking?.id ?? null;
    setDetailsState((prev) => ({
      ...prev,
      reprocessMessageId: messageId,
      reprocessError: null,
    }));
    try {
      await axiosInstance.post(`/bookings/emails/${encodeURIComponent(messageId)}/reprocess`, {}, { withCredentials: true });
      setReloadToken((token) => token + 1);
      if (bookingId) {
        const response = await axiosInstance.get<BookingDetailsResponse>(`/bookings/${bookingId}/details`);
        setDetailsState((prev) => ({
          ...prev,
          data: response.data,
          error: null,
        }));
      }
    } catch (error) {
      setDetailsState((prev) => ({
        ...prev,
        reprocessError: extractErrorMessage(error),
      }));
    } finally {
      setDetailsState((prev) => ({
        ...prev,
        reprocessMessageId: null,
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
    const ecwidOrder = isEcwidOrder(order);
    const xperienceOrder = isXperiencePolandOrder(order);
    const baseState = createDefaultCancelState();
    baseState.opened = true;
    baseState.order = order;
    baseState.bookingId = bookingId;
    baseState.mode = ecwidOrder ? "ecwid_refund" : xperienceOrder ? "xperience_cancel" : null;
    baseState.loading = Boolean(bookingId && ecwidOrder);
    if (!bookingId) {
      baseState.error = "Unable to locate OmniLodge booking reference for this order.";
      baseState.loading = false;
    } else if (!ecwidOrder && !xperienceOrder) {
      baseState.error = "Cancellation is not supported for this platform from the manifest.";
      baseState.loading = false;
    }
    setCancelState(baseState);
    if (!bookingId || !ecwidOrder) {
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
      if (cancelState.mode === "ecwid_refund") {
        await axiosInstance.post(`/bookings/${cancelState.bookingId}/cancel-ecwid`);
      } else if (cancelState.mode === "xperience_cancel") {
        await axiosInstance.post(`/bookings/${cancelState.bookingId}/cancel-xperience`);
      } else {
        throw new Error("Cancellation mode is not supported.");
      }
      setCancelState(createDefaultCancelState());
      setReloadToken((token) => token + 1);
    } catch (error) {
      const message = extractErrorMessage(error);
      setCancelState((prev) => ({ ...prev, submitting: false, error: message }));
    }
  };

  const closeMobileActionsModal = () => {
    setMobileActionsOrder(null);
  };

  const handleMobileActionsDetails = () => {
    if (!mobileActionsOrder) {
      return;
    }
    const order = mobileActionsOrder;
    closeMobileActionsModal();
    openDetailsModal(order);
  };

  const handleMobileActionsAmend = () => {
    if (!mobileActionsOrder) {
      return;
    }
    const order = mobileActionsOrder;
    closeMobileActionsModal();
    openAmendModal(order);
  };

  const handleMobileActionsPartialRefund = () => {
    if (!mobileActionsOrder) {
      return;
    }
    const order = mobileActionsOrder;
    closeMobileActionsModal();
    openPartialRefundModal(order);
  };

  const handleMobileActionsCancel = async () => {
    if (!mobileActionsOrder) {
      return;
    }
    const order = mobileActionsOrder;
    closeMobileActionsModal();
    await openCancelModal(order);
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
              statusCounts: createStatusCountsFromGroups(mergedGroups),
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
  const platformSummaryEntries = filteredSummary.platformBreakdown ?? [];
  const detailsPreviewHtml = detailsState.previewData?.htmlBody ?? null;
  const detailsPreviewBody =
    detailsState.previewData?.previewText ??
    detailsState.previewData?.textBody ??
    detailsState.previewData?.htmlText ??
    detailsState.previewData?.snippet ??
    null;
  const mobileActionsBookingId = mobileActionsOrder ? getBookingIdFromOrder(mobileActionsOrder) : null;
  const mobileActionsCanAmend = Boolean(
    mobileActionsOrder &&
      (isEcwidOrder(mobileActionsOrder) || isXperiencePolandOrder(mobileActionsOrder)) &&
      mobileActionsBookingId,
  );
  const mobileActionsCanCancel = Boolean(
    mobileActionsOrder &&
      (isEcwidOrder(mobileActionsOrder) || isXperiencePolandOrder(mobileActionsOrder)) &&
      mobileActionsBookingId &&
      mobileActionsOrder.status !== "cancelled",
  );
  const mobileActionsCanPartialRefund = Boolean(
    mobileActionsOrder &&
      isEcwidOrder(mobileActionsOrder) &&
      mobileActionsBookingId &&
      mobileActionsOrder.status !== "cancelled",
  );

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



  const handleDatePickerChange = (value: Date | null) => {
    if (!value) {
      return;
    }
    const parsed = dayjs(value);
    if (!parsed.isValid()) {
      return;
    }
    const normalized = parsed.startOf("day");
    setSelectedDate(normalized);
    updateSearchParamDate(normalized);
    setDateModalOpened(false);
  };

  const handlePickToday = () => {
    const today = dayjs().startOf("day");
    setSelectedDate(today);
    updateSearchParamDate(today);
    setDateModalOpened(false);
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
          <Title order={2} ta="center">{title}</Title>
          <Group justify="flex-end">
            {modulePermissions.ready && !modulePermissions.loading && modulePermissions.canView && (
              <Button
                variant="subtle"
                size="sm"
                aria-label="Refresh manifest"
                onClick={handleReload}
                loading={ingestStatus === "loading" || fetchStatus === "loading"}
              >
                <IconRefresh size={16} />
              </Button>
            )}
          </Group>
        </Box>

        <Modal
          opened={dateModalOpened}
          onClose={() => setDateModalOpened(false)}
          withCloseButton={false}
          centered
          size="auto"
          styles={{ content: { width: "fit-content" } }}
        >
          <Stack gap="md" align="center">
            <Box style={{ width: "max-content" }}>
              <DatePicker value={selectedDate.toDate()} onChange={handleDatePickerChange} />
            </Box>
            <Group justify="center" w="100%">
              <Button onClick={handlePickToday} w={200}>
                Today
              </Button>
            </Group>
          </Stack>
        </Modal>



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

            <Stack gap="sm">
              <Group gap="sm" justify="center" wrap="nowrap" style={{ width: "100%" }}>
                <Button
                  size="sm"
                  variant="subtle"
                  aria-label="Previous day"
                  onClick={() => handleShiftDate(-1)}
                >
                  <IconArrowLeft size={16} />
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => setDateModalOpened(true)}
                  style={{ width: 260 }}
                >
                  {selectedDate.format("ddd, MMMM D YYYY")}
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  aria-label="Next day"
                  onClick={() => handleShiftDate(1)}
                >
                  <IconArrowRight size={16} />
                </Button>
              </Group>

            </Stack>

            <form onSubmit={handleSearchSubmit}>
              <Stack gap={4} align="center" w="100%" px={8}>
                <TextInput
                  value={searchInput}
                  onChange={handleSearchChange}
                  placeholder="Search booking id, name, or phone"
                  leftSection={<IconSearch size={16} />}
                  rightSection={
                    <Button
                      type="submit"
                      size="xs"
                      variant="light"
                      style={{
                        width: "100%",
                        height: "100%",
                        borderTopLeftRadius: 0,
                        borderBottomLeftRadius: 0,
                      }}
                    >
                      Search
                    </Button>
                  }
                  rightSectionWidth={88}
                  rightSectionPointerEvents="all"
                  styles={{
                    section: {
                      padding: 0,
                    },
                  }}
                  size="sm"
                  w="100%"
                />
                {hasSearchParam && (
                  <Button variant="subtle" color="gray" size="sm" onClick={handleSearchClear}>
                    Clear
                  </Button>
                )}
                {hasSearchParam && (
                  <Text size="sm" c="dimmed" ta="center">
                    Showing results for &ldquo;{searchParam}&rdquo;. Date and event filters are ignored while
                    search is active.
                  </Text>
                )}
              </Stack>
            </form>

            {isFilterPanelVisible && (
              <Group gap="xs" wrap="wrap" align="center" justify="center">
                <Select
                  data={groupOptions}
                  value={selectedGroupKey}
                  onChange={handleGroupChange}
                  size="sm"
                  allowDeselect={false}
                  style={{ minWidth: 320 }}
                  styles={{
                    input: { textAlign: "center" },
                    option: { textAlign: "center", justifyContent: "center" },
                    dropdown: { textAlign: "center" },
                  }}
                  disabled={hasSearchParam}
                />
              </Group>
            )}

            {isFilterPanelVisible && (
              <Group gap="sm" wrap="wrap" align="center" justify="center">
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
            )}

            {isFilterPanelVisible && (
              <SummaryPanelSwitcher
                totalsContent={
                  <Stack gap="sm" w="100%">
                    <SummarySection tone="overview">
                      <SummaryChipGridRow columns={2}>
                        <SummaryChip tone="overview">{`People: ${filteredSummary.totalPeople}`}</SummaryChip>
                        <SummaryChip tone="overview">{`Bookings: ${filteredSummary.totalOrders}`}</SummaryChip>
                      </SummaryChipGridRow>
                    </SummarySection>

                    <SummarySection tone="breakdown">
                      <SummaryChipGridRow columns={3}>
                        <SummaryChip tone="breakdown" noWrap>{`Men: ${filteredSummary.men}`}</SummaryChip>
                        <SummaryChip tone="breakdown" noWrap>{`Women: ${filteredSummary.women}`}</SummaryChip>
                        <SummaryChip tone="breakdown" noWrap textSize="xs">{`Undefined: ${summaryUndefinedCount}`}</SummaryChip>
                      </SummaryChipGridRow>
                    </SummarySection>

                    <SummarySection tone="extras">
                      <SummaryChipGridRow columns={3}>
                        <SummaryChip tone="extras" noWrap>{`T-Shirts: ${filteredSummary.extras.tshirts}`}</SummaryChip>
                        <SummaryChip tone="extras" noWrap textSize="xs">{`Cocktails: ${filteredSummary.extras.cocktails}`}</SummaryChip>
                        <SummaryChip tone="extras" noWrap>{`Photos: ${filteredSummary.extras.photos}`}</SummaryChip>
                      </SummaryChipGridRow>
                    </SummarySection>

                    <SummarySection tone="platforms">
                      <SummaryChipGridRow columns={2}>
                        {platformSummaryEntries.length === 0 ? (
                          <SummaryChip tone="platforms">Platforms: -</SummaryChip>
                        ) : (
                          platformSummaryEntries.map((entry) => (
                            <SummaryChip key={`summary-platform-${entry.platform}`} tone="platforms">
                              {`${formatPlatformLabel(entry.platform)}: ${entry.totalPeople}`}
                              <wbr />
                              <span style={{ whiteSpace: "nowrap" }}>
                                {` (${entry.orderCount} ${entry.orderCount === 1 ? "order" : "orders"})`}
                              </span>
                            </SummaryChip>
                          ))
                        )}
                      </SummaryChipGridRow>
                    </SummarySection>
                  </Stack>
                }
                statusesContent={
                  <Stack gap="sm" w="100%">
                    <SummarySection tone="platforms">
                      <SummaryChipGridRow columns={2}>
                        {BOOKING_STATUSES.map((status) => (
                          <SummaryChip key={`summary-status-${status}`} tone="platforms" noWrap textSize="xs">
                            {`${formatStatusLabel(status)}: ${filteredSummary.statusCounts?.[status] ?? 0}`}
                          </SummaryChip>
                        ))}
                      </SummaryChipGridRow>
                    </SummarySection>
                  </Stack>
                }
              />
            )}



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
                          <Box
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                              alignItems: "center",
                              columnGap: 8,
                            }}
                          >
                            <Text
                              fw={700}
                              size="lg"
                              style={{
                                minWidth: 0,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                textAlign: "center",
                              }}
                            >
                              {group.productName}
                            </Text>
                            <Box style={{ display: "flex", justifyContent: "center" }}>
                              <Badge
                                color="orange"
                                variant="filled"
                                radius="sm"
                                style={{ minWidth: 68, justifyContent: "center" }}
                              >
                                {group.time}
                              </Badge>
                            </Box>
                          </Box>
                          <ProductSummaryPanels group={group} undefinedGroupCount={undefinedGroupCount} />
                          <Divider />
                          <Stack gap="sm">
                            {sortedOrders.map((order) => {
                              const normalizedBookingId = normalizeManifestBookingId(order);
                              const bookingDisplay = normalizedBookingId ?? order.platformBookingId ?? order.id;
                              const bookingLink =
                                order.platformBookingUrl ?? getPlatformBookingLink(order.platform, normalizedBookingId ?? order.platformBookingId);
                              const isCustomerDetailsExpanded = Boolean(expandedMobileCustomerDetails[order.id]);
                              const undefinedOrderCount = getUndefinedGenreCount(
                                order.quantity,
                                order.menCount,
                                order.womenCount,
                              );
                              const whatsappLink = toWhatsAppLink(order.customerPhone);
                              const guessedNationality = guessNationalityFromPhone(order.customerPhone);
                              const isUnknownNationality = guessedNationality.trim().toLowerCase() === "unknown";
                              const orderStatusDisplayKey = resolveOrderStatusDisplayKey(
                                order.status,
                                order.attendanceStatus,
                              );
                              const orderStatusPresentation = ORDER_STATUS_APPEARANCE[orderStatusDisplayKey];
                              const bookingBreakdownChips = [
                                order.menCount > 0
                                  ? {
                                      key: "men",
                                      color: "teal",
                                      label: `Men: ${order.menCount}`,
                                      style: BOOKING_BREAKDOWN_BADGE_STYLES.men,
                                    }
                                  : null,
                                order.womenCount > 0
                                  ? {
                                      key: "women",
                                      color: "pink",
                                      label: `Women: ${order.womenCount}`,
                                      style: BOOKING_BREAKDOWN_BADGE_STYLES.women,
                                    }
                                  : null,
                                undefinedOrderCount > 0
                                  ? {
                                      key: "undefined",
                                      color: "gray",
                                      label: `Undefined: ${undefinedOrderCount}`,
                                      style: BOOKING_BREAKDOWN_BADGE_STYLES.undefined,
                                    }
                                  : null,
                              ].filter((chip): chip is {
                                key: "men" | "women" | "undefined";
                                color: "teal" | "pink" | "gray";
                                label: string;
                                style: { backgroundColor: string; color: string; borderColor: string };
                              } => Boolean(chip));
                              const bookingExtrasChips = [
                                (order.extras?.cocktails ?? 0) > 0
                                  ? {
                                      key: "cocktails",
                                      value: order.extras?.cocktails ?? 0,
                                      icon: <LocalBar fontSize="small" sx={{ color: "text.secondary", fontSize: 16 }} />,
                                    }
                                  : null,
                                (order.extras?.tshirts ?? 0) > 0
                                  ? {
                                      key: "tshirts",
                                      value: order.extras?.tshirts ?? 0,
                                      icon: <Checkroom fontSize="small" sx={{ color: "text.secondary", fontSize: 16 }} />,
                                    }
                                  : null,
                                (order.extras?.photos ?? 0) > 0
                                  ? {
                                      key: "photos",
                                      value: order.extras?.photos ?? 0,
                                      icon: <PhotoCamera fontSize="small" sx={{ color: "text.secondary", fontSize: 16 }} />,
                                    }
                                  : null,
                              ].filter((chip): chip is NonNullable<typeof chip> => chip !== null);
                              return (
                                <Paper
                                  key={order.id}
                                  withBorder
                                  radius="md"
                                  shadow="xs"
                                  p="sm"
                                  style={{
                                    background: "#6b63692a",
                                    boxShadow: "4px 4px 10px rgba(15, 23, 42, 0.18)",
                                    border: "0.5px solid #8f9bad",
                                  }}
                                >
                                  <Stack gap={8}>
                                    <Box
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "minmax(0, 1fr) auto",
                                        alignItems: "center",
                                        columnGap: 8,
                                      }}
                                    >
                                      <Box
                                        style={{
                                          minWidth: 0,
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 6,
                                        }}
                                      >
                                        <Box
                                          component="button"
                                          type="button"
                                          onClick={() =>
                                            setExpandedMobileCustomerDetails((prev) => ({
                                              ...prev,
                                              [order.id]: !prev[order.id],
                                            }))
                                          }
                                          aria-label={
                                            isCustomerDetailsExpanded
                                              ? "Hide customer contact details"
                                              : "Show customer contact details"
                                          }
                                          style={{
                                            minWidth: 0,
                                            maxWidth: "100%",
                                            border: "none",
                                            background: "transparent",
                                            padding: 0,
                                            margin: 0,
                                            textAlign: "left",
                                            cursor: "pointer",
                                            color: "inherit",
                                          }}
                                        >
                                          <Text
                                            fw={600}
                                            style={{
                                              minWidth: 0,
                                              whiteSpace: "nowrap",
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                            }}
                                          >
                                            {order.customerName || "Unnamed guest"}
                                          </Text>
                                        </Box>
                                        <Box
                                          component="button"
                                          type="button"
                                          onClick={() =>
                                            setExpandedMobileCustomerDetails((prev) => ({
                                              ...prev,
                                              [order.id]: !prev[order.id],
                                            }))
                                          }
                                          aria-label={
                                            isCustomerDetailsExpanded
                                              ? "Hide customer contact details"
                                              : "Show customer contact details"
                                          }
                                          style={{
                                            border: "none",
                                            background: "transparent",
                                            padding: 0,
                                            margin: 0,
                                            cursor: "pointer",
                                            color: "inherit",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            flexShrink: 0,
                                          }}
                                        >
                                          {isCustomerDetailsExpanded ? (
                                            <IconEyeOff size={14} />
                                          ) : (
                                            <IconEye size={14} />
                                          )}
                                        </Box>
                                      </Box>
                                      <Badge
                                        color="orange"
                                        variant="light"
                                        style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                                      >
                                        {`${order.quantity} people`}
                                      </Badge>
                                    </Box>
                                    {isCustomerDetailsExpanded && (
                                      <Paper
                                        withBorder
                                        radius="sm"
                                        py={6}
                                        px={8}
                                        style={{
                                          backgroundColor: "#f8fafc",
                                          borderColor: "#e2e8f0",
                                        }}
                                      >
                                        <Stack gap={2}>
                                          <Text size="xs" c="dimmed" style={{ lineHeight: 1.2 }}>
                                            {`Phone: ${whatsappLink?.display ?? order.customerPhone ?? "-"}`}
                                          </Text>
                                          <Text size="xs" c="dimmed" style={{ lineHeight: 1.2 }}>
                                            {`Email: ${order.customerEmail || "-"}`}
                                          </Text>
                                        </Stack>
                                      </Paper>
                                    )}
                                    {bookingBreakdownChips.length > 0 && (
                                      <Box
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: `repeat(${bookingBreakdownChips.length}, minmax(0, 1fr))`,
                                          gap: 8,
                                        }}
                                      >
                                        {bookingBreakdownChips.map((chip) => (
                                          <Badge
                                            key={`${order.id}-${chip.key}`}
                                            color={chip.color}
                                            variant="light"
                                            size="xs"
                                            style={{
                                              ...BOOKING_BREAKDOWN_BADGE_BASE_STYLE,
                                              ...chip.style,
                                            }}
                                          >
                                            {chip.label}
                                          </Badge>
                                        ))}
                                      </Box>
                                    )}
                                    {bookingExtrasChips.length > 0 && (
                                      <Box
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: `repeat(${bookingExtrasChips.length}, minmax(0, 1fr))`,
                                          gap: 8,
                                        }}
                                      >
                                        {bookingExtrasChips.map((chip) => (
                                          <Paper
                                            key={`${order.id}-extra-${chip.key}`}
                                            withBorder
                                            radius="xl"
                                            py={4}
                                            px={8}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              gap: 6,
                                              backgroundColor: "#f4f7fa",
                                              borderColor: "#d9e1ea",
                                            }}
                                          >
                                            {chip.icon}
                                            <Text size="xs" fw={700} c="dark.6" style={{ lineHeight: 1 }}>
                                              {chip.value}
                                            </Text>
                                          </Paper>
                                        ))}
                                      </Box>
                                    )}
                                    <Box
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 0.85fr) minmax(0, 1.3fr)",
                                        gap: 8,
                                      }}
                                    >
                                      {whatsappLink ? (
                                        <Anchor
                                          href={whatsappLink.href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          size="xs"
                                          title={whatsappLink.display}
                                          aria-label={`Open WhatsApp ${whatsappLink.display}`}
                                          style={{
                                            display: "block",
                                            width: "100%",
                                            color: "inherit",
                                            textDecoration: "none",
                                          }}
                                        >
                                          <Paper
                                            withBorder
                                            radius="xl"
                                            py={4}
                                            px={8}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              backgroundColor: "#f4f7fa",
                                              borderColor: "#d9e1ea",
                                              minWidth: 0,
                                              cursor: "pointer",
                                            }}
                                          >
                                            <WhatsApp fontSize="small" style={{ color: "#25D366" }} />
                                          </Paper>
                                        </Anchor>
                                      ) : (
                                        <Paper
                                          withBorder
                                          radius="xl"
                                          py={4}
                                          px={8}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            backgroundColor: "#f4f7fa",
                                            borderColor: "#d9e1ea",
                                            minWidth: 0,
                                            position: "relative",
                                            overflow: "hidden",
                                          }}
                                        >
                                          <WhatsApp fontSize="small" style={{ color: "#25D366", opacity: 0.35 }} />
                                          <Box
                                            style={{
                                              position: "absolute",
                                              left: 6,
                                              right: 6,
                                              top: "50%",
                                              height: 1.5,
                                              backgroundColor: "#8fa0b3",
                                              transform: "rotate(-26deg)",
                                              transformOrigin: "center",
                                              pointerEvents: "none",
                                            }}
                                          />
                                        </Paper>
                                      )}
                                      {order.customerEmail ? (
                                        <Anchor
                                          href={`mailto:${order.customerEmail}`}
                                          size="xs"
                                          title={order.customerEmail}
                                          aria-label={`Send email to ${order.customerEmail}`}
                                          style={{
                                            display: "block",
                                            width: "100%",
                                            color: "inherit",
                                            textDecoration: "none",
                                          }}
                                        >
                                          <Paper
                                            withBorder
                                            radius="xl"
                                            py={4}
                                            px={8}
                                            style={{
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              backgroundColor: "#f4f7fa",
                                              borderColor: "#d9e1ea",
                                              minWidth: 0,
                                              cursor: "pointer",
                                            }}
                                          >
                                            <MailOutline fontSize="small" />
                                          </Paper>
                                        </Anchor>
                                      ) : (
                                        <Paper
                                          withBorder
                                          radius="xl"
                                          py={4}
                                          px={8}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            backgroundColor: "#f4f7fa",
                                            borderColor: "#d9e1ea",
                                            minWidth: 0,
                                            position: "relative",
                                            overflow: "hidden",
                                          }}
                                        >
                                          <MailOutline fontSize="small" style={{ opacity: 0.35 }} />
                                          <Box
                                            style={{
                                              position: "absolute",
                                              left: 6,
                                              right: 6,
                                              top: "50%",
                                              height: 1.5,
                                              backgroundColor: "#8fa0b3",
                                              transform: "rotate(-26deg)",
                                              transformOrigin: "center",
                                              pointerEvents: "none",
                                            }}
                                          />
                                        </Paper>
                                      )}
                                      <Paper
                                        withBorder
                                        radius="xl"
                                        py={4}
                                        px={8}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          backgroundColor: isUnknownNationality ? "#ffffff" : "#334155",
                                          borderColor: "#334155",
                                          borderWidth: isUnknownNationality ? 2 : 1,
                                          minWidth: 0,
                                        }}
                                      >
                                        <Text
                                          size="xs"
                                          fw={700}
                                          c={isUnknownNationality ? "#334155" : "white"}
                                          style={{
                                            width: "100%",
                                            textAlign: "center",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                          }}
                                        >
                                          {guessedNationality}
                                        </Text>
                                      </Paper>
                                    </Box>
                                  <Stack gap={4}>
                                    <Button
                                      size="xs"
                                      variant="light"
                                      fullWidth
                                      styles={{ label: { color: "#3a3a3a" } }}
                                      onClick={() => setMobileActionsOrder(order)}
                                    >
                                      Actions
                                    </Button>
                                    <Box
                                      mt={2}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                                        gap: 8,
                                      }}
                                    >
                                      <Paper
                                        withBorder
                                        radius="xl"
                                        py={4}
                                        px={8}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          backgroundColor: "#f4f7fa",
                                          borderColor: "#d9e1ea",
                                          minWidth: 0,
                                        }}
                                      >
                                        <Text
                                          size="xs"
                                          fw={700}
                                          c="dark.6"
                                          style={{
                                            width: "100%",
                                            textAlign: "center",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                          }}
                                        >
                                          {formatPlatformLabel(order.platform)}
                                        </Text>
                                      </Paper>
                                      <Paper
                                        withBorder
                                        radius="xl"
                                        py={4}
                                        px={8}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          backgroundColor: "#f4f7fa",
                                          borderColor: "#d9e1ea",
                                          minWidth: 0,
                                        }}
                                      >
                                        {bookingLink ? (
                                          <Anchor
                                            href={bookingLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            size="xs"
                                            style={{
                                              width: "100%",
                                              textAlign: "center",
                                              whiteSpace: "nowrap",
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              color: "inherit",
                                              fontWeight: 700,
                                              textDecoration: "none",
                                            }}
                                          >
                                            {bookingDisplay}
                                          </Anchor>
                                        ) : (
                                          <Text
                                            size="xs"
                                            fw={700}
                                            c="dark.6"
                                            style={{
                                              width: "100%",
                                              textAlign: "center",
                                              whiteSpace: "nowrap",
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                            }}
                                          >
                                            {bookingDisplay}
                                          </Text>
                                        )}
                                      </Paper>
                                      {orderStatusDisplayKey === "partial" ? (
                                        <Popover withArrow position="top" shadow="md" width={220}>
                                          <Popover.Target>
                                            <Box
                                              component="button"
                                              type="button"
                                              style={{
                                                padding: 0,
                                                border: 0,
                                                background: "transparent",
                                                minWidth: 0,
                                                cursor: "pointer",
                                              }}
                                              aria-label="Show partial attendance details"
                                            >
                                              <Paper
                                                withBorder
                                                radius="xl"
                                                py={4}
                                                px={8}
                                                style={{
                                                  display: "flex",
                                                  alignItems: "center",
                                                  justifyContent: "center",
                                                  backgroundColor: orderStatusPresentation.backgroundColor,
                                                  borderColor: orderStatusPresentation.backgroundColor,
                                                  minWidth: 0,
                                                }}
                                              >
                                                <Text
                                                  size="xs"
                                                  fw={700}
                                                  style={{
                                                    color: orderStatusPresentation.textColor,
                                                    width: "100%",
                                                    textAlign: "center",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                  }}
                                                >
                                                  {orderStatusPresentation.label}
                                                </Text>
                                              </Paper>
                                            </Box>
                                          </Popover.Target>
                                          <Popover.Dropdown p="xs">
                                            <PartialStatusPopoverContent order={order} />
                                          </Popover.Dropdown>
                                        </Popover>
                                      ) : (
                                        <Paper
                                          withBorder
                                          radius="xl"
                                          py={4}
                                          px={8}
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            backgroundColor: orderStatusPresentation.backgroundColor,
                                            borderColor: orderStatusPresentation.backgroundColor,
                                            minWidth: 0,
                                          }}
                                        >
                                          <Text
                                            size="xs"
                                            fw={700}
                                            style={{
                                              color: orderStatusPresentation.textColor,
                                              width: "100%",
                                              textAlign: "center",
                                              whiteSpace: "nowrap",
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                            }}
                                          >
                                            {orderStatusPresentation.label}
                                          </Text>
                                        </Paper>
                                      )}
                                    </Box>
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
                        border: "0.5px solid #c4cfdd",
                        padding: 24,
                      }}
                    >
                      <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
                        <Box
                          style={{
                            minWidth: 0,
                            flex: "1 1 auto",
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                            alignItems: "center",
                            columnGap: 8,
                          }}
                        >
                          <Text
                            fw={700}
                            size="lg"
                            style={{
                              minWidth: 0,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              textAlign: "center",
                            }}
                          >
                            {group.productName}
                          </Text>
                          <Box style={{ display: "flex", justifyContent: "center" }}>
                            <Badge
                              color="orange"
                              variant="filled"
                              radius="sm"
                              style={{ minWidth: 68, justifyContent: "center" }}
                            >
                              {group.time}
                            </Badge>
                          </Box>
                        </Box>
                      </Flex>
                      <Box mt="sm">
                        <ProductSummaryPanels group={group} undefinedGroupCount={undefinedGroupCount} />
                      </Box>

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
                            const canAmend = (isEcwidOrder(order) || isXperiencePolandOrder(order)) && Boolean(bookingId);
                            const canCancel = (isEcwidOrder(order) || isXperiencePolandOrder(order)) && Boolean(bookingId) && order.status !== "cancelled";
                            const canPartialRefund = isEcwidOrder(order) && Boolean(bookingId) && order.status !== "cancelled";
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
                                <StatusBadge status={order.status} attendanceStatus={order.attendanceStatus} order={order} />
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
        opened={Boolean(mobileActionsOrder)}
        onClose={closeMobileActionsModal}
        title={
          mobileActionsOrder
            ? `Actions - ${mobileActionsOrder.customerName || mobileActionsOrder.platformBookingId || mobileActionsOrder.id}`
            : "Actions"
        }
        size="sm"
        centered
      >
        <Stack gap="xs">
          <Button variant="default" fullWidth onClick={handleMobileActionsDetails}>
            Details
          </Button>
          {mobileActionsCanAmend && (
            <Button variant="light" fullWidth onClick={handleMobileActionsAmend}>
              Amend
            </Button>
          )}
          {mobileActionsCanPartialRefund && (
            <Button color="orange" variant="outline" fullWidth onClick={handleMobileActionsPartialRefund}>
              Partial Refund
            </Button>
          )}
          {mobileActionsCanCancel && (
            <Button
              color="red"
              variant="outline"
              fullWidth
              onClick={() => {
                void handleMobileActionsCancel();
              }}
            >
              Cancel
            </Button>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={amendState.opened}
        onClose={closeAmendModal}
        title={
          amendState.order
            ? `Amend booking ${amendState.order.platformBookingId ?? amendState.order.id}`
            : amendState.mode === "xperience"
              ? "Amend XperiencePoland booking"
              : amendState.mode === "ecwid"
                ? "Amend Ecwid booking"
                : "Amend booking"
        }
        size="md"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {amendState.mode === "ecwid"
              ? "Updating the pickup details will sync the change to Ecwid first and then to OmniLodge."
              : amendState.mode === "xperience"
                ? "Updating the pickup details will update this XperiencePoland booking in OmniLodge."
                : "Updating the pickup details will update this booking in OmniLodge."}
          </Text>
          {amendState.mode === "ecwid" && amendPreview.status === "loading" && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">Loading Ecwid order details...</Text>
            </Group>
          )}
          {amendState.mode === "ecwid" && amendPreview.status === "error" && (
            <Alert color="red" title="Unable to load Ecwid details">
              {amendPreview.error || "Failed to load Ecwid details."}
            </Alert>
          )}
          {amendState.mode === "ecwid" && amendPreview.data && amendPreview.status !== "loading" && amendPreview.status !== "error" && (
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
            : "Cancel booking"
        }
        size="md"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {cancelState.mode === "ecwid_refund"
              ? "We will verify the Stripe transaction before issuing the refund and cancelling the booking."
              : "This will cancel the booking in OmniLodge and record a cancellation event."}
          </Text>
          {cancelState.loading && cancelState.mode === "ecwid_refund" && (
            <Group gap="sm">
              <Loader size="sm" />
              <Text size="sm">Loading Stripe transaction details...</Text>
            </Group>
          )}
          {cancelState.preview && cancelState.mode === "ecwid_refund" && (
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
          {cancelState.mode === "xperience_cancel" && (
            <Alert color="blue" title="Direct cancellation">
              No Stripe refund will be issued from this action.
            </Alert>
          )}
          {cancelState.error && (
            <Alert
              color="red"
              title={cancelState.mode === "ecwid_refund" ? "Unable to load refund details" : "Unable to cancel booking"}
            >
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
              disabled={
                cancelState.loading ||
                cancelState.submitting ||
                !cancelState.mode ||
                (cancelState.mode === "ecwid_refund" && !cancelState.preview)
              }
            >
              {cancelState.mode === "ecwid_refund"
                ? cancelState.preview?.stripe.fullyRefunded
                  ? "Confirm Cancel"
                  : "Confirm Refund"
                : "Confirm Cancel"}
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
                          {detailsState.data.emails.map((email) => {
                            const reprocessLoading = detailsState.reprocessMessageId === email.messageId;
                            const reprocessDisabled =
                              detailsState.reprocessMessageId !== null && !reprocessLoading;
                            return (
                              <Table.Tr key={email.messageId}>
                                <Table.Td>{email.subject ?? email.messageId}</Table.Td>
                                <Table.Td>{formatDateTime(email.receivedAt ?? email.internalDate ?? null)}</Table.Td>
                                <Table.Td>{email.ingestionStatus ?? "-"}</Table.Td>
                                <Table.Td>
                                  <Group gap="xs">
                                    <Button
                                      size="xs"
                                      variant="light"
                                      onClick={() => handleDetailsPreview(email.messageId)}
                                    >
                                      Preview
                                    </Button>
                                    <Button
                                      size="xs"
                                      color="orange"
                                      variant="light"
                                      loading={reprocessLoading}
                                      disabled={reprocessDisabled}
                                      onClick={() => handleDetailsReprocess(email.messageId)}
                                    >
                                      Reprocess
                                    </Button>
                                  </Group>
                                </Table.Td>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </Table>
                      {detailsState.reprocessError && (
                        <Alert color="red" title="Unable to reprocess email">
                          {detailsState.reprocessError}
                        </Alert>
                      )}
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
