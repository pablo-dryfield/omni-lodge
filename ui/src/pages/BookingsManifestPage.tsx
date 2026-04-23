import { ChangeEvent, FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  Textarea,
  Title,
  TextInput,
} from "@mantine/core";

import { DatePicker, DatePickerInput, TimeInput } from "@mantine/dates";
import { useMediaQuery } from '@mantine/hooks';
import { Checkroom, LocalBar, MailOutline, PhotoCamera, WhatsApp } from "@mui/icons-material";

import { IconArrowLeft, IconArrowRight, IconEye, IconEyeOff, IconKey, IconRefresh, IconSearch } from "@tabler/icons-react";

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
const REACT_EMAIL_SOURCE_MARKER = "/* @react-email-template-source */";

type MailVariableScope = "base" | "refund" | "supply" | "react";

type MailVariableDefinition = {
  key: string;
  scope: MailVariableScope;
  description: string;
};

type MailVariableField = "subject" | "body" | "react";

type MailVariableDropdownState = {
  field: MailVariableField | null;
  tokenStart: number;
  tokenEnd: number;
  query: string;
};

const BASE_MAIL_VARIABLES: MailVariableDefinition[] = [
  { key: "customerName", scope: "base", description: "Customer full name" },
  { key: "customerEmail", scope: "base", description: "Customer email address" },
  { key: "customerPhone", scope: "base", description: "Customer phone number" },
  { key: "productName", scope: "base", description: "Product/experience name" },
  { key: "bookingDate", scope: "base", description: "Raw booking date (YYYY-MM-DD)" },
  { key: "bookingDateDisplay", scope: "base", description: "Formatted booking date label" },
  { key: "bookingTime", scope: "base", description: "Booking/activity time" },
  { key: "bookingId", scope: "base", description: "Booking ID alias" },
  { key: "bookingReference", scope: "base", description: "Primary booking reference" },
  { key: "reservationId", scope: "base", description: "Reservation ID alias" },
  { key: "platformBookingId", scope: "base", description: "Platform booking ID" },
  { key: "platform", scope: "base", description: "Booking platform name" },
  { key: "quantity", scope: "base", description: "People quantity" },
  { key: "peopleCount", scope: "base", description: "People quantity alias" },
  { key: "menCount", scope: "base", description: "Men count" },
  { key: "womenCount", scope: "base", description: "Women count" },
  { key: "currency", scope: "base", description: "Currency code" },
];

const REFUND_MAIL_VARIABLES: MailVariableDefinition[] = [
  { key: "refundedAmount", scope: "refund", description: "Refunded amount value" },
  { key: "totalPaidAmount", scope: "refund", description: "Original paid amount" },
  { key: "alreadyRefundedAmount", scope: "refund", description: "Previously refunded amount value" },
  { key: "isFullRefund", scope: "refund", description: "Full refund boolean flag" },
  { key: "partialReason", scope: "refund", description: "Partial refund reason text" },
  { key: "refundReason", scope: "refund", description: "Refund reason text alias" },
  { key: "experienceDate", scope: "refund", description: "Experience date value" },
  { key: "transactionId", scope: "refund", description: "External transaction ID alias" },
  { key: "externalTransactionId", scope: "refund", description: "External transaction ID" },
  { key: "stripeTransactionId", scope: "refund", description: "Stripe transaction ID" },
  { key: "stripeTransactionType", scope: "refund", description: "Stripe transaction type" },
  { key: "stripeTransactionStatus", scope: "refund", description: "Stripe transaction status" },
  { key: "stripeTransactionCreatedAt", scope: "refund", description: "Stripe transaction created at" },
  { key: "peopleChange", scope: "refund", description: "People change object ({from,to,amount})" },
  { key: "refundedAddons", scope: "refund", description: "Refunded add-ons array" },
];

const SUPPLY_MAIL_VARIABLES: MailVariableDefinition[] = [
  { key: "supplierName", scope: "supply", description: "Supplier display name" },
  { key: "requestedBy", scope: "supply", description: "Who requested the order" },
  { key: "deliveryDate", scope: "supply", description: "Expected delivery date" },
  { key: "location", scope: "supply", description: "Delivery location" },
  { key: "notes", scope: "supply", description: "General notes" },
  { key: "items", scope: "supply", description: "Supply line items array" },
];

const REACT_MAIL_VARIABLES: MailVariableDefinition[] = [
  { key: "templateKey", scope: "react", description: "Forces React renderer variant key" },
  { key: "reactPlainText", scope: "react", description: "Text fallback for rendered HTML" },
];

const resolveMailVariableTokenContext = (
  value: string,
  cursorPosition: number,
): { tokenStart: number; tokenEnd: number; query: string } | null => {
  const source = String(value ?? "");
  const safeCursor = Math.max(0, Math.min(cursorPosition, source.length));
  const beforeCursor = source.slice(0, safeCursor);
  const tokenStart = beforeCursor.lastIndexOf("{{");

  if (tokenStart < 0) {
    return null;
  }

  const between = source.slice(tokenStart + 2, safeCursor);
  if (between.includes("{") || between.includes("}") || /\s/.test(between)) {
    return null;
  }

  const closingIndex = source.indexOf("}}", tokenStart + 2);
  if (closingIndex !== -1 && closingIndex < safeCursor) {
    return null;
  }

  return {
    tokenStart,
    tokenEnd: safeCursor,
    query: between.trim(),
  };
};

const isReactEmailSource = (value: string): boolean =>
  value.includes(REACT_EMAIL_SOURCE_MARKER);

const createDefaultReactEmailSource = (message: string): string => {
  const safeMessage = message.trim().length > 0 ? message.trim() : "Write your message here.";
  return `${REACT_EMAIL_SOURCE_MARKER}
const {
  Section,
  Heading,
  Text,
  Hr,
  Button,
  Row,
  Column
} = components;

return (
  <Section style={{ backgroundColor: "#ffffff", padding: "24px", borderRadius: "12px", border: "1px solid #dbe3f4" }}>
    <Heading style={{ fontSize: "24px", margin: "0 0 12px", color: "#0f172a" }}>{subject}</Heading>
    <Hr style={{ borderColor: "#dbe3f4", margin: "0 0 16px" }} />
    <Text style={{ fontSize: "15px", lineHeight: "24px", color: "#1e293b" }}>${JSON.stringify(safeMessage)}</Text>
  </Section>
);
`;
};

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

const getOrderPeopleCount = (order: UnifiedOrder): number => {
  const men = Number.isFinite(order.menCount) ? order.menCount : 0;
  const women = Number.isFinite(order.womenCount) ? order.womenCount : 0;
  const fallback = Number.isFinite(order.quantity) ? order.quantity : 0;
  const total = men + women > 0 ? men + women : fallback;
  return total > 0 ? total : 0;
};

const createStatusCountsFromOrdersByPeople = (orders: UnifiedOrder[]): Record<BookingStatus, number> => {
  return orders.reduce((acc, order) => {
    const rawStatus = order.status ?? "unknown";
    const peopleCount = getOrderPeopleCount(order);

    if (rawStatus !== "completed" && rawStatus !== "no_show") {
      acc[rawStatus] = (acc[rawStatus] ?? 0) + peopleCount;
    }

    if (!ATTENDANCE_TRACKED_BOOKING_STATUSES.has(rawStatus)) {
      return acc;
    }

    const attendanceStatus = String(order.attendanceStatus ?? "")
      .trim()
      .toLowerCase();

    if (attendanceStatus === "checked_in_full" || attendanceStatus === "checked_in_partial") {
      acc.completed = (acc.completed ?? 0) + peopleCount;
      return acc;
    }

    if (attendanceStatus === "no_show") {
      acc.no_show = (acc.no_show ?? 0) + peopleCount;
    }

    return acc;
  }, createEmptyStatusCounts());
};

const createStatusCountsFromGroups = (groups: ManifestGroup[]): Record<BookingStatus, number> => {
  return createStatusCountsFromOrdersByPeople(groups.flatMap((group) => group.orders));
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
  const groupStatusCounts = createStatusCountsFromOrdersByPeople(group.orders);
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

const computePeopleRefundTotal = (
  people: { unitPrice: string | null } | null | undefined,
  quantity: number,
): number => {
  if (!people || quantity <= 0) {
    return 0;
  }
  const unitPrice = people.unitPrice ? parseMoney(people.unitPrice) : 0;
  if (unitPrice <= 0) {
    return 0;
  }
  return unitPrice * quantity;
};

const getPartialRefundRemainingAmountMajor = (preview: PartialRefundPreview | null | undefined): number => {
  if (!preview) {
    return 0;
  }
  return Math.max(Number((preview.remainingAmount / 100).toFixed(2)), 0);
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
  people: {
    quantity: number;
    unitPrice: string | null;
    totalPrice: string | null;
    currency: string | null;
  };
  addons: PartialRefundAddon[];
};

const normalizePartialRefundPreview = (preview: PartialRefundPreview): PartialRefundPreview => {
  const fallbackCurrency = preview?.stripe?.currency ?? null;
  const safePeople = preview?.people;
  const safeAddons: PartialRefundAddon[] = Array.isArray(preview?.addons)
    ? preview.addons
        .map<PartialRefundAddon | null>((addon) => {
          const rawAddon = addon as PartialRefundAddon & {
            bookingAddonId?: unknown;
            booking_addon_id?: unknown;
            addonId?: unknown;
          };
          const idCandidate =
            rawAddon.id ??
            rawAddon.bookingAddonId ??
            rawAddon.booking_addon_id ??
            rawAddon.addonId;
          const parsedId = Number.parseInt(String(idCandidate ?? ""), 10);
          if (!Number.isFinite(parsedId) || parsedId <= 0) {
            return null;
          }
          const parsedQty = Number(rawAddon.quantity ?? 0);
          return {
            id: parsedId,
            platformAddonName: rawAddon.platformAddonName ?? null,
            quantity: Number.isFinite(parsedQty) ? Math.max(0, Math.round(parsedQty)) : 0,
            unitPrice: rawAddon.unitPrice ?? null,
            totalPrice: rawAddon.totalPrice ?? null,
            currency: rawAddon.currency ?? fallbackCurrency,
          };
        })
        .filter((addon): addon is PartialRefundAddon => addon !== null)
    : [];
  return {
    ...preview,
    people: {
      quantity: Number.isFinite(safePeople?.quantity) ? Math.max(0, Math.round(safePeople.quantity)) : 0,
      unitPrice: safePeople?.unitPrice ?? null,
      totalPrice: safePeople?.totalPrice ?? null,
      currency: safePeople?.currency ?? fallbackCurrency,
    },
    addons: safeAddons,
  };
};

type PartialRefundState = {
  opened: boolean;
  loading: boolean;
  submitting: boolean;
  manualAmountUnlocked: boolean;
  error: string | null;
  success: string | null;
  order: UnifiedOrder | null;
  bookingId: number | null;
  preview: PartialRefundPreview | null;
  amount: number | null;
  peopleQuantity: number;
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

type MailComposerState = {
  opened: boolean;
  sourceOrder: UnifiedOrder | null;
  to: string;
  subject: string;
  body: string;
  reactLiveSource: string;
  sending: boolean;
  error: string | null;
  success: string | null;
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
  createdAt?: string;
  updatedAt?: string;
};

type EmailTemplateListResponse = {
  count: number;
  templates: EmailTemplate[];
};

type MailTemplateState = {
  loading: boolean;
  saving: boolean;
  error: string | null;
  templates: EmailTemplate[];
  selectedTemplateId: string | null;
  editorName: string;
  editorDescription: string;
  editorType: EmailTemplateType;
};

type MailComposerPreviewResponse = {
  templateId: number | null;
  templateType: EmailTemplateType | null;
  subject: string;
  textBody: string;
  htmlBody: string | null;
};

type EmailTemplateRenderRequestPayload = {
  to?: string;
  subject?: string;
  body?: string;
  templateId?: number;
  templateContext: Record<string, unknown>;
};

type MailComposerPreviewState = {
  opened: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  data: MailComposerPreviewResponse | null;
};

type CancelRefundEmailPreviewState = {
  opened: boolean;
  loading: boolean;
  error: string | null;
  data: MailComposerPreviewResponse | null;
  templateName: string | null;
};

type PartialRefundEmailPreviewState = {
  opened: boolean;
  loading: boolean;
  error: string | null;
  data: MailComposerPreviewResponse | null;
  templateName: string | null;
};

const createDefaultMailComposerState = (): MailComposerState => ({
  opened: false,
  sourceOrder: null,
  to: "",
  subject: "",
  body: "",
  reactLiveSource: "",
  sending: false,
  error: null,
  success: null,
});

const createDefaultMailTemplateState = (): MailTemplateState => ({
  loading: false,
  saving: false,
  error: null,
  templates: [],
  selectedTemplateId: null,
  editorName: "",
  editorDescription: "",
  editorType: "plain_text",
});

const createDefaultMailComposerPreviewState = (): MailComposerPreviewState => ({
  opened: false,
  loading: false,
  refreshing: false,
  error: null,
  data: null,
});

const createDefaultCancelRefundEmailPreviewState = (): CancelRefundEmailPreviewState => ({
  opened: false,
  loading: false,
  error: null,
  data: null,
  templateName: null,
});

const createDefaultPartialRefundEmailPreviewState = (): PartialRefundEmailPreviewState => ({
  opened: false,
  loading: false,
  error: null,
  data: null,
  templateName: null,
});

type MailboxMessageDirection = "sent" | "received";

type MailboxMessage = {
  messageId: string;
  threadId?: string | null;
  fromAddress?: string | null;
  toAddresses?: string | null;
  subject?: string | null;
  snippet?: string | null;
  internalDate?: string | null;
  labelIds?: string[];
  direction: MailboxMessageDirection;
};

type MailboxResponse = {
  email: string;
  count: number;
  nextPageToken: string | null;
  messages: MailboxMessage[];
};

type MailboxState = {
  opened: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  customerEmail: string;
  customerName: string;
  sourceOrder: UnifiedOrder | null;
  messages: MailboxMessage[];
  filter: "all" | "received" | "sent";
  nextPageToken: string | null;
  previewOpen: boolean;
  previewLoading: boolean;
  previewError: string | null;
  previewData: BookingEmailPreview | null;
};

const createDefaultMailboxState = (): MailboxState => ({
  opened: false,
  loading: false,
  loadingMore: false,
  error: null,
  customerEmail: "",
  customerName: "",
  sourceOrder: null,
  messages: [],
  filter: "all",
  nextPageToken: null,
  previewOpen: false,
  previewLoading: false,
  previewError: null,
  previewData: null,
});

const pickRefundTemplate = (templates: EmailTemplate[]): EmailTemplate | null => {
  if (!Array.isArray(templates) || templates.length === 0) {
    return null;
  }
  const activeTemplates = templates.filter((template) => template.isActive);
  const source = activeTemplates.length > 0 ? activeTemplates : templates;
  const scored = source
    .map((template) => {
      const haystack = `${template.name} ${template.description ?? ""} ${template.subjectTemplate}`.toLowerCase();
      let score = 0;
      if (haystack.includes("refund")) {
        score += 10;
      }
      if (haystack.includes("booking")) {
        score += 2;
      }
      if (template.templateType === "react_email") {
        score += 1;
      }
      return { template, score };
    })
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0 || scored[0].score <= 0) {
    return null;
  }
  return scored[0].template;
};

const pickPartialRefundTemplate = (templates: EmailTemplate[]): EmailTemplate | null => {
  if (!Array.isArray(templates) || templates.length === 0) {
    return null;
  }
  const activeTemplates = templates.filter((template) => template.isActive);
  const source = activeTemplates.length > 0 ? activeTemplates : templates;
  const scored = source
    .map((template) => {
      const haystack = `${template.name} ${template.description ?? ""} ${template.subjectTemplate}`.toLowerCase();
      let score = 0;
      if (haystack.includes("partial") && haystack.includes("refund")) {
        score += 20;
      } else if (haystack.includes("partial")) {
        score += 12;
      } else if (haystack.includes("refund")) {
        score += 8;
      }
      if (template.templateType === "react_email") {
        score += 1;
      }
      return { template, score };
    })
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0 || scored[0].score <= 0) {
    return null;
  }
  return scored[0].template;
};

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
    manualAmountUnlocked: false,
    error: null,
    success: null,
    order: null,
    bookingId: null,
    preview: null,
    amount: null,
    peopleQuantity: 0,
    addonQuantities: {},
  });
  const [cancelState, setCancelState] = useState<CancelRefundState>(createDefaultCancelState());
  const [mobileActionsOrder, setMobileActionsOrder] = useState<UnifiedOrder | null>(null);
  const [expandedMobileCustomerDetails, setExpandedMobileCustomerDetails] = useState<Record<string, boolean>>({});
  const [mailboxState, setMailboxState] = useState<MailboxState>(createDefaultMailboxState());
  const [mailComposerState, setMailComposerState] = useState<MailComposerState>(createDefaultMailComposerState());
  const [mailTemplateState, setMailTemplateState] = useState<MailTemplateState>(createDefaultMailTemplateState());
  const [mailComposerPreviewState, setMailComposerPreviewState] =
    useState<MailComposerPreviewState>(createDefaultMailComposerPreviewState());
  const [cancelRefundEmailPreviewState, setCancelRefundEmailPreviewState] =
    useState<CancelRefundEmailPreviewState>(createDefaultCancelRefundEmailPreviewState());
  const [partialRefundEmailPreviewState, setPartialRefundEmailPreviewState] =
    useState<PartialRefundEmailPreviewState>(createDefaultPartialRefundEmailPreviewState());
  const [mailVariableDropdown, setMailVariableDropdown] = useState<MailVariableDropdownState>({
    field: null,
    tokenStart: -1,
    tokenEnd: -1,
    query: "",
  });
  const mailSubjectInputRef = useRef<HTMLInputElement | null>(null);
  const mailBodyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const mailReactSourceInputRef = useRef<HTMLTextAreaElement | null>(null);

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
    const nextValue = event.currentTarget.value;
    setAmendState((prev) => ({ ...prev, formTime: nextValue }));
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
    setPartialRefundEmailPreviewState(createDefaultPartialRefundEmailPreviewState());
    const bookingId = getBookingIdFromOrder(order);
    if (!bookingId) {
      setPartialRefundState((prev) => ({
        ...prev,
        opened: true,
        loading: false,
        manualAmountUnlocked: false,
        order,
        error: "Unable to locate OmniLodge booking reference for this order.",
      }));
      return;
    }
    setPartialRefundState({
      opened: true,
      loading: true,
      submitting: false,
      manualAmountUnlocked: false,
      error: null,
      success: null,
      order,
      bookingId,
      preview: null,
      amount: null,
      peopleQuantity: 0,
      addonQuantities: {},
    });
    axiosInstance
      .get<PartialRefundPreview>(`/bookings/${bookingId}/partial-refund-preview`)
      .then((response) => {
        const preview = normalizePartialRefundPreview(response.data);
        const addonQuantities: Record<number, number> = {};
        preview.addons.forEach((addon) => {
          addonQuantities[addon.id] = 0;
        });
        const computedAmount = computeAddonRefundTotal(preview.addons, addonQuantities);
        const maxAmount = getPartialRefundRemainingAmountMajor(preview);
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
      manualAmountUnlocked: false,
      error: null,
      success: null,
      order: null,
      bookingId: null,
      preview: null,
      amount: null,
      peopleQuantity: 0,
      addonQuantities: {},
    });
    setPartialRefundEmailPreviewState(createDefaultPartialRefundEmailPreviewState());
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
      if (prev.manualAmountUnlocked) {
        return prev;
      }
      const computedAmount =
        computePeopleRefundTotal(prev.preview.people, prev.peopleQuantity) +
        computeAddonRefundTotal(prev.preview.addons, updated);
      const maxAmount = getPartialRefundRemainingAmountMajor(prev.preview);
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

  const handlePartialRefundPeopleChange = (value: number | string) => {
    const nextValue = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    setPartialRefundState((prev) => {
      if (!prev.preview) {
        return prev;
      }
      const maxPeople = Math.max(0, Math.round(prev.preview.people?.quantity || 0));
      const normalizedQuantity = Number.isFinite(nextValue)
        ? Math.max(0, Math.min(Math.round(nextValue), maxPeople))
        : 0;
      if (prev.manualAmountUnlocked) {
        return prev;
      }
      const computedAmount =
        computePeopleRefundTotal(prev.preview.people, normalizedQuantity) +
        computeAddonRefundTotal(prev.preview.addons, prev.addonQuantities);
      const maxAmount = getPartialRefundRemainingAmountMajor(prev.preview);
      const nextAmount = Math.min(computedAmount, maxAmount);
      return {
        ...prev,
        peopleQuantity: normalizedQuantity,
        amount: Number(nextAmount.toFixed(2)),
        success: null,
        error: null,
      };
    });
  };

  const handlePartialRefundAmountChange = (value: number | string) => {
    const nextValue = typeof value === "number" ? value : Number.parseFloat(String(value));
    setPartialRefundState((prev) => {
      if (!prev.manualAmountUnlocked) {
        return prev;
      }
      return {
        ...prev,
        amount: Number.isFinite(nextValue) ? nextValue : null,
        success: null,
        error: null,
      };
    });
  };

  const handleTogglePartialRefundManualAmount = () => {
    setPartialRefundState((prev) => {
      if (!prev.preview) {
        return prev;
      }
      const nextUnlocked = !prev.manualAmountUnlocked;
      if (nextUnlocked) {
        return {
          ...prev,
          manualAmountUnlocked: true,
          success: null,
          error: null,
        };
      }
      const computedAmount =
        computePeopleRefundTotal(prev.preview.people, prev.peopleQuantity) +
        computeAddonRefundTotal(prev.preview.addons, prev.addonQuantities);
      const maxAmount = getPartialRefundRemainingAmountMajor(prev.preview);
      const nextAmount = Math.min(computedAmount, maxAmount);
      return {
        ...prev,
        manualAmountUnlocked: false,
        amount: Number(nextAmount.toFixed(2)),
        success: null,
        error: null,
      };
    });
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
    const remainingMajor = getPartialRefundRemainingAmountMajor(partialRefundState.preview);
    const shouldProceedToCancel = remainingMajor > 0 && partialRefundState.amount + 0.0001 >= remainingMajor;
    if (shouldProceedToCancel) {
      if (!partialRefundState.order) {
        setPartialRefundState((prev) => ({ ...prev, error: "Missing booking details for cancellation." }));
        return;
      }
      closePartialRefundModal();
      await openCancelModal(partialRefundState.order);
      return;
    }

    const addonQuantitiesPayload = (partialRefundState.preview?.addons ?? []).reduce<Record<number, number>>(
      (acc, addon) => {
        const rawQty = partialRefundState.addonQuantities[addon.id] ?? 0;
        const normalizedQty = Number.isFinite(rawQty) ? Math.max(0, Math.round(rawQty)) : 0;
        acc[addon.id] = normalizedQty;
        return acc;
      },
      {},
    );
    const selectedAddonQty = Object.values(addonQuantitiesPayload).reduce(
      (sum, value) => sum + (Number.isFinite(value) ? value : 0),
      0,
    );
    if ((partialRefundState.peopleQuantity ?? 0) <= 0 && selectedAddonQty <= 0) {
      setPartialRefundState((prev) => ({
        ...prev,
        error: "Select refunded people quantity or add-on quantities.",
      }));
      return;
    }

    let preparedEmail: { payload: EmailTemplateRenderRequestPayload; templateName: string | null } | null = null;
    try {
      preparedEmail = await buildPartialRefundEmailPayload();
    } catch (error) {
      setPartialRefundState((prev) => ({
        ...prev,
        error: extractErrorMessage(error),
      }));
      return;
    }

    setPartialRefundState((prev) => ({ ...prev, submitting: true, error: null, success: null }));
    try {
      await axiosInstance.post(`/bookings/${partialRefundState.bookingId}/partial-refund`, {
        amount: partialRefundState.amount,
        peopleQuantity: partialRefundState.peopleQuantity,
        addonQuantities: addonQuantitiesPayload,
      });
      let successMessage = "Partial refund submitted and email sent.";
      if (preparedEmail) {
        try {
          await axiosInstance.post("/bookings/emails/send", preparedEmail.payload, {
            withCredentials: true,
          });
        } catch (emailError) {
          successMessage = "Partial refund submitted, but sending the email failed.";
          setPartialRefundState((prev) => ({
            ...prev,
            error: extractErrorMessage(emailError),
          }));
        }
      }
      setPartialRefundState((prev) => ({
        ...prev,
        submitting: false,
        success: successMessage,
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
    setCancelRefundEmailPreviewState(createDefaultCancelRefundEmailPreviewState());
  };

  const closeCancelRefundEmailPreview = () => {
    if (cancelRefundEmailPreviewState.loading) {
      return;
    }
    setCancelRefundEmailPreviewState(createDefaultCancelRefundEmailPreviewState());
  };

  const resolveRefundTemplateForCancelPreview = async (): Promise<EmailTemplate | null> => {
    const existingTemplate = pickRefundTemplate(mailTemplateState.templates);
    if (existingTemplate) {
      return existingTemplate;
    }
    const response = await axiosInstance.get<EmailTemplateListResponse>("/email-templates", {
      withCredentials: true,
    });
    const templates = Array.isArray(response.data?.templates) ? response.data.templates : [];
    return pickRefundTemplate(templates);
  };

  const closePartialRefundEmailPreview = () => {
    if (partialRefundEmailPreviewState.loading) {
      return;
    }
    setPartialRefundEmailPreviewState(createDefaultPartialRefundEmailPreviewState());
  };

  const resolvePartialRefundTemplateForPreview = async (): Promise<EmailTemplate | null> => {
    const existingTemplate = pickPartialRefundTemplate(mailTemplateState.templates);
    if (existingTemplate) {
      return existingTemplate;
    }
    const response = await axiosInstance.get<EmailTemplateListResponse>("/email-templates", {
      withCredentials: true,
    });
    const templates = Array.isArray(response.data?.templates) ? response.data.templates : [];
    return pickPartialRefundTemplate(templates);
  };

  const buildPartialRefundEmailPayload = async (): Promise<{
    payload: EmailTemplateRenderRequestPayload;
    templateName: string | null;
  }> => {
    if (!partialRefundState.order || !partialRefundState.preview) {
      throw new Error("Partial refund email requires an open partial refund preview.");
    }

    const customerEmail = String(partialRefundState.order.customerEmail ?? "").trim();
    if (!customerEmail) {
      throw new Error("Customer email is required to send the partial refund confirmation.");
    }

    const preview = partialRefundState.preview;
    const baseContext = buildMailTemplateContextFromOrder(partialRefundState.order, customerEmail);
    const bookingReference = String(baseContext.bookingReference ?? "").trim() || "booking";
    const toAmount = (value: number): number => Number(value.toFixed(2));

    const peopleQty = Math.max(0, Math.round(preview.people?.quantity ?? 0));
    const peopleRefundQty = Math.max(0, Math.min(Math.round(partialRefundState.peopleQuantity ?? 0), peopleQty));
    const peopleUnitPrice = preview.people?.unitPrice ? parseMoney(preview.people.unitPrice) : 0;
    const peopleRefundAmount = toAmount(Math.max(peopleRefundQty * peopleUnitPrice, 0));
    const peopleAfterRefund = Math.max(peopleQty - peopleRefundQty, 0);

    const selectedAddonBreakdown = preview.addons
      .map((addon) => {
        const refundQty = Math.max(
          0,
          Math.min(Math.round(partialRefundState.addonQuantities[addon.id] ?? 0), Math.round(addon.quantity ?? 0)),
        );
        if (refundQty <= 0) {
          return null;
        }
        const unitPrice =
          addon.unitPrice
            ? parseMoney(addon.unitPrice)
            : addon.totalPrice && addon.quantity > 0
              ? parseMoney(addon.totalPrice) / addon.quantity
              : 0;
        if (unitPrice <= 0) {
          return null;
        }
        return {
          bookingAddonId: addon.id,
          name: addon.platformAddonName ?? `Addon ${addon.id}`,
          qty: Math.max(0, Math.round(addon.quantity ?? 0)),
          unitPrice: toAmount(unitPrice),
          refundQty,
          amount: toAmount(refundQty * unitPrice),
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          bookingAddonId: number;
          name: string;
          qty: number;
          unitPrice: number;
          refundQty: number;
          amount: number;
        } => entry !== null,
      );

    const addonsRefundAmount = toAmount(
      selectedAddonBreakdown.reduce((sum, entry) => sum + entry.amount, 0),
    );
    const totalRefundAmount = toAmount(
      partialRefundState.amount && partialRefundState.amount > 0
        ? partialRefundState.amount
        : peopleRefundAmount + addonsRefundAmount,
    );
    if (totalRefundAmount <= 0) {
      throw new Error("Select refunded people quantity or add-on quantities before previewing email.");
    }

    const transactionAmount = preview.stripe ? preview.stripe.amount / 100 : 0;
    const alreadyRefundedAmount = preview.stripe ? preview.stripe.amountRefunded / 100 : 0;
    const refundedAddonRows = selectedAddonBreakdown.map((entry) => ({
      name: entry.name,
      qty: entry.qty,
      quantity: entry.refundQty,
      bookedQty: entry.qty,
      unitPrice: entry.unitPrice,
      refundQty: entry.refundQty,
      amount: entry.amount,
    }));
    const normalizeAddonKey = (value: string): string => value.toLowerCase().replace(/[^a-z]/g, "");
    const hasAddonMatch = (
      rows: Array<{ name: string }>,
      tokens: string[],
    ): boolean =>
      rows.some((row) => {
        const key = normalizeAddonKey(String(row.name ?? ""));
        return tokens.some((token) => key.includes(token));
      });
    const createFallbackAddon = (name: string) => ({
      name,
      qty: 0,
      quantity: 0,
      bookedQty: 0,
      unitPrice: 0,
      refundQty: 0,
      amount: 0,
    });
    const safeRefundedAddons = [...refundedAddonRows];
    if (!hasAddonMatch(safeRefundedAddons, ["cocktail", "drink"])) {
      safeRefundedAddons.push(createFallbackAddon("Cocktails Add-On"));
    }
    if (!hasAddonMatch(safeRefundedAddons, ["tshirt", "shirt"])) {
      safeRefundedAddons.push(createFallbackAddon("T-Shirts Add-On"));
    }
    if (!hasAddonMatch(safeRefundedAddons, ["photo", "picture", "instantpic"])) {
      safeRefundedAddons.push(createFallbackAddon("Photos Add-On"));
    }
    const resolveAddonByKeywords = (tokens: string[], fallbackLabel: string) =>
      safeRefundedAddons.find((addon) => {
        const key = normalizeAddonKey(String(addon.name ?? ""));
        return tokens.some((token) => key.includes(token));
      }) ?? createFallbackAddon(fallbackLabel);
    const cocktailsRefund = resolveAddonByKeywords(["cocktail", "drink"], "Cocktails Add-On");
    const tshirtsRefund = resolveAddonByKeywords(["tshirt", "shirt"], "T-Shirts Add-On");
    const photosRefund = resolveAddonByKeywords(["photo", "picture", "instantpic"], "Photos Add-On");
    const peopleRefund = {
      name: "People",
      qty: peopleQty,
      quantity: peopleRefundQty,
      bookedQty: peopleQty,
      refundQty: peopleRefundQty,
      unitPrice: toAmount(peopleUnitPrice),
      amount: peopleRefundAmount,
    };
    const partialReason =
      peopleRefundQty > 0 && selectedAddonBreakdown.length > 0
        ? "People quantity and add-ons adjustment"
        : peopleRefundQty > 0
          ? "People quantity adjustment"
          : selectedAddonBreakdown.length > 0
            ? "Add-ons adjustment"
            : "Manual partial refund";
    const context: Record<string, unknown> = {
      ...baseContext,
      templateKey: "partial_refund",
      refundedAmount: totalRefundAmount,
      totalPaidAmount: toAmount(transactionAmount),
      alreadyRefundedAmount: toAmount(alreadyRefundedAmount),
      isFullRefund: false,
      partialReason,
      refundReason: partialReason,
      experienceDate: String(baseContext.bookingDateDisplay ?? baseContext.bookingDate ?? "").trim(),
      peopleChange: {
        from: peopleQty,
        to: peopleAfterRefund,
        amount: peopleRefundAmount,
      },
      peopleRefundDetails: {
        qty: peopleQty,
        quantity: peopleRefundQty,
        bookedQty: peopleQty,
        unitPrice: toAmount(peopleUnitPrice),
        refundQty: peopleRefundQty,
        amount: peopleRefundAmount,
      },
      peopleRefund,
      refundedAddons: safeRefundedAddons,
      addons: safeRefundedAddons,
      addonsBreakdown: safeRefundedAddons,
      cocktailsRefund,
      tshirtsRefund,
      photosRefund,
      refundedAddonsByType: {
        cocktails: cocktailsRefund,
        tshirts: tshirtsRefund,
        photos: photosRefund,
      },
      transactionId: preview.externalTransactionId ?? "",
      externalTransactionId: preview.externalTransactionId ?? "",
      stripeTransactionId: preview.stripe?.id ?? "",
      stripeTransactionType: preview.stripe?.type ?? "",
      stripeTransactionStatus: preview.stripe?.status ?? "",
      stripeTransactionCreatedAt:
        preview.stripe && Number.isFinite(preview.stripe.created)
          ? dayjs.unix(preview.stripe.created).format("YYYY-MM-DD HH:mm")
          : "",
    };

    const partialTemplate = await resolvePartialRefundTemplateForPreview();
    const templateContextForRequest: Record<string, unknown> = { ...context };
    if (
      partialTemplate &&
      partialTemplate.templateType === "react_email" &&
      isReactEmailSource(partialTemplate.bodyTemplate)
    ) {
      templateContextForRequest.reactTemplateSource = partialTemplate.bodyTemplate;
    }

    const payload: EmailTemplateRenderRequestPayload = {
      to: customerEmail,
      templateContext: templateContextForRequest,
    };
    if (partialTemplate) {
      payload.templateId = partialTemplate.id;
    } else {
      payload.subject = `Partial refund update - Booking ${bookingReference}`;
      payload.body = `Refunded amount: ${totalRefundAmount} ${context.currency ?? "EUR"} for booking ${bookingReference}.`;
    }

    return {
      payload,
      templateName: partialTemplate?.name ?? null,
    };
  };

  const handlePreviewPartialRefundEmail = async () => {
    if (!partialRefundState.preview || partialRefundState.loading) {
      return;
    }
    setPartialRefundEmailPreviewState((prev) => ({
      ...prev,
      opened: true,
      loading: true,
      error: null,
      data: null,
      templateName: null,
    }));

    try {
      const preparedEmail = await buildPartialRefundEmailPayload();
      const response = await axiosInstance.post<MailComposerPreviewResponse>(
        "/bookings/emails/render-preview",
        preparedEmail.payload,
        { withCredentials: true },
      );
      setPartialRefundEmailPreviewState({
        opened: true,
        loading: false,
        error: null,
        data: response.data,
        templateName: preparedEmail.templateName,
      });
    } catch (error) {
      setPartialRefundEmailPreviewState({
        opened: true,
        loading: false,
        error: extractErrorMessage(error),
        data: null,
        templateName: null,
      });
    }
  };

  const buildCancelRefundEmailPayload = async (): Promise<{
    payload: EmailTemplateRenderRequestPayload;
    templateName: string | null;
  }> => {
    if (!cancelState.order || cancelState.mode !== "ecwid_refund" || !cancelState.preview) {
      throw new Error("Refund email is available only for Ecwid refund cancellations.");
    }

    const customerEmail = String(cancelState.order.customerEmail ?? "").trim();
    if (!customerEmail) {
      throw new Error("Customer email is required to send the refund confirmation.");
    }

    const baseContext = buildMailTemplateContextFromOrder(cancelState.order, customerEmail);
    const stripePreview = cancelState.preview.stripe ?? null;
    const transactionAmount = stripePreview ? stripePreview.amount / 100 : 0;
    const alreadyRefundedAmount = stripePreview ? stripePreview.amountRefunded / 100 : 0;
    const currentRefundAmount = stripePreview
      ? stripePreview.fullyRefunded
        ? alreadyRefundedAmount || transactionAmount
        : Math.max(0, (stripePreview.amount - stripePreview.amountRefunded) / 100)
      : 0;
    const bookingReference = String(baseContext.bookingReference ?? "").trim() || "booking";
    const context: Record<string, unknown> = {
      ...baseContext,
      refundedAmount: Number(currentRefundAmount.toFixed(2)),
      totalPaidAmount: Number(transactionAmount.toFixed(2)),
      alreadyRefundedAmount: Number(alreadyRefundedAmount.toFixed(2)),
      isFullRefund: true,
      experienceDate: String(baseContext.bookingDateDisplay ?? baseContext.bookingDate ?? "").trim(),
      transactionId: cancelState.preview.externalTransactionId ?? "",
      externalTransactionId: cancelState.preview.externalTransactionId ?? "",
      stripeTransactionId: stripePreview?.id ?? "",
      stripeTransactionType: stripePreview?.type ?? "",
      stripeTransactionStatus: stripePreview?.status ?? "",
      stripeTransactionCreatedAt:
        stripePreview && Number.isFinite(stripePreview.created)
          ? dayjs.unix(stripePreview.created).format("YYYY-MM-DD HH:mm")
          : "",
      refundedAddons: [],
      peopleChange: null,
    };

    const refundTemplate = await resolveRefundTemplateForCancelPreview();
    const templateContextForRequest: Record<string, unknown> = { ...context };
    if (
      refundTemplate &&
      refundTemplate.templateType === "react_email" &&
      isReactEmailSource(refundTemplate.bodyTemplate)
    ) {
      templateContextForRequest.reactTemplateSource = refundTemplate.bodyTemplate;
    }
    const fallbackSubject = `Refund Information - Booking ${bookingReference}`;
    const fallbackBody = `Refunded amount: ${context.refundedAmount ?? ""} ${context.currency ?? "EUR"} for booking ${bookingReference}.`;
    const payload: EmailTemplateRenderRequestPayload = {
      to: customerEmail,
      templateContext: templateContextForRequest,
    };
    if (refundTemplate) {
      payload.templateId = refundTemplate.id;
    } else {
      payload.subject = fallbackSubject;
      payload.body = fallbackBody;
    }

    return {
      payload,
      templateName: refundTemplate?.name ?? null,
    };
  };

  const handlePreviewCancelRefundEmail = async () => {
    if (cancelState.mode !== "ecwid_refund" || cancelState.loading) {
      return;
    }

    setCancelRefundEmailPreviewState((prev) => ({
      ...prev,
      opened: true,
      loading: true,
      error: null,
      data: null,
      templateName: null,
    }));

    try {
      const preparedEmail = await buildCancelRefundEmailPayload();
      const response = await axiosInstance.post<MailComposerPreviewResponse>(
        "/bookings/emails/render-preview",
        preparedEmail.payload,
        { withCredentials: true },
      );
      setCancelRefundEmailPreviewState({
        opened: true,
        loading: false,
        error: null,
        data: response.data,
        templateName: preparedEmail.templateName,
      });
    } catch (error) {
      setCancelRefundEmailPreviewState({
        opened: true,
        loading: false,
        error: extractErrorMessage(error),
        data: null,
        templateName: null,
      });
    }
  };

  const handleConfirmRefund = async () => {
    if (!cancelState.bookingId) {
      setCancelState((prev) => ({ ...prev, error: "Missing OmniLodge booking reference." }));
      return;
    }

    let preparedEmail: { payload: EmailTemplateRenderRequestPayload; templateName: string | null } | null = null;
    if (cancelState.mode === "ecwid_refund") {
      try {
        preparedEmail = await buildCancelRefundEmailPayload();
      } catch (error) {
        setCancelState((prev) => ({
          ...prev,
          error: extractErrorMessage(error),
        }));
        return;
      }
    }

    setCancelState((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      if (cancelState.mode === "ecwid_refund") {
        await axiosInstance.post(`/bookings/${cancelState.bookingId}/cancel-ecwid`);
        if (preparedEmail) {
          await axiosInstance.post("/bookings/emails/send", preparedEmail.payload, {
            withCredentials: true,
          });
        }
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

  const buildMailDraftFromOrder = (order: UnifiedOrder) => {
    const to = String(order.customerEmail ?? "").trim();
    const productName = String(order.productName ?? "Booking").trim() || "Booking";
    const displayDate = dayjs(order.date).isValid() ? dayjs(order.date).format("ddd, MMM D YYYY") : order.date;
    const timeslot = order.timeslot && order.timeslot !== "--:--" ? order.timeslot : "";
    const bookingId = normalizeManifestBookingId(order);
    const subjectParts = [productName, displayDate, timeslot].filter((part) => Boolean(part && String(part).trim()));
    const subject = bookingId
      ? `Booking Information - ${subjectParts.join(" @ ")} (${bookingId})`
      : `Booking Information - ${subjectParts.join(" @ ")}`;
    const customerName = String(order.customerName ?? "").trim() || "Guest";
    const body = `Hi ${customerName},\n\n\n\nBest regards,`;
    return { to, subject, body };
  };

  const interpolateTemplateText = (
    template: string,
    context: Record<string, string | number | boolean | null | undefined>,
  ): string =>
    template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, rawKey: string) => {
      const key = String(rawKey ?? "").trim();
      if (!key) {
        return "";
      }
      if (!(key in context)) {
        return `{{${key}}}`;
      }
      const value = context[key];
      if (value === null || value === undefined) {
        return "";
      }
      return String(value);
    });

  const buildMailTemplateContextFromOrder = useCallback(
    (
      order: UnifiedOrder | null,
      toEmail: string,
    ): Record<string, string | number | boolean | null | undefined> => {
      const customerName = String(order?.customerName ?? "").trim();
      const productName = String(order?.productName ?? "").trim();
      const dateRaw = String(order?.date ?? "").trim();
      const dateDisplay = dayjs(dateRaw).isValid() ? dayjs(dateRaw).format("ddd, MMM D YYYY") : dateRaw;
      const timeslot = String(order?.timeslot ?? "").trim();
      const bookingId = order ? normalizeManifestBookingId(order) : null;
      const platformBookingId = String(order?.platformBookingId ?? "").trim();
      const bookingReference = bookingId || platformBookingId || String(order?.id ?? "").trim();
      const quantity = Number.isFinite(order?.quantity) ? order?.quantity : 0;
      const extrasTshirts = Number.isFinite(order?.extras?.tshirts) ? Number(order?.extras?.tshirts) : 0;
      const extrasCocktails = Number.isFinite(order?.extras?.cocktails) ? Number(order?.extras?.cocktails) : 0;
      const extrasPhotos = Number.isFinite(order?.extras?.photos) ? Number(order?.extras?.photos) : 0;
      return {
        customerName: customerName || "Guest",
        customerEmail: toEmail || "",
        customerPhone: String(order?.customerPhone ?? "").trim(),
        productName: productName || "Booking",
        bookingDate: dateRaw,
        bookingDateDisplay: dateDisplay,
        bookingTime: timeslot,
        bookingId: bookingId || "",
        bookingReference,
        reservationId: bookingReference,
        platformBookingId,
        platform: String(order?.platform ?? "").trim(),
        quantity,
        peopleCount: quantity,
        menCount: Number.isFinite(order?.menCount) ? order?.menCount : 0,
        womenCount: Number.isFinite(order?.womenCount) ? order?.womenCount : 0,
        extrasTshirts,
        extrasCocktails,
        extrasPhotos,
        tshirtsCount: extrasTshirts,
        cocktailsCount: extrasCocktails,
        photosCount: extrasPhotos,
        currency: "EUR",
      };
    },
    [],
  );

  const mergeMailboxMessages = (current: MailboxMessage[], incoming: MailboxMessage[]): MailboxMessage[] => {
    const map = new Map<string, MailboxMessage>();
    current.forEach((message) => {
      map.set(message.messageId, message);
    });
    incoming.forEach((message) => {
      map.set(message.messageId, message);
    });
    return Array.from(map.values());
  };

  const closeMailboxModal = () => {
    setMailboxState(createDefaultMailboxState());
  };

  const closeMailboxPreview = () => {
    setMailboxState((prev) => ({
      ...prev,
      previewOpen: false,
      previewLoading: false,
      previewError: null,
      previewData: null,
    }));
  };

  const handleMailboxPreview = async (messageId: string) => {
    setMailboxState((prev) => ({
      ...prev,
      previewOpen: true,
      previewLoading: true,
      previewError: null,
      previewData: null,
    }));

    try {
      const response = await axiosInstance.get(`/bookings/emails/gmail/${encodeURIComponent(messageId)}/preview`, {
        withCredentials: true,
      });
      setMailboxState((prev) => ({
        ...prev,
        previewLoading: false,
        previewError: null,
        previewData: response.data as BookingEmailPreview,
      }));
    } catch (error) {
      setMailboxState((prev) => ({
        ...prev,
        previewLoading: false,
        previewError: extractErrorMessage(error),
      }));
    }
  };

  const fetchMailboxMessages = async (
    email: string,
    options?: {
      pageToken?: string | null;
      append?: boolean;
    },
  ) => {
    const append = options?.append === true;
    const pageToken = options?.pageToken ?? null;
    if (!append) {
      setMailboxState((prev) => ({
        ...prev,
        loading: true,
        loadingMore: false,
        error: null,
      }));
    } else {
      setMailboxState((prev) => ({
        ...prev,
        loadingMore: true,
        error: null,
      }));
    }
    try {
      const response = await axiosInstance.get<MailboxResponse>("/bookings/emails/mailbox", {
        params: {
          email,
          limit: 25,
          pageToken: pageToken || undefined,
        },
        withCredentials: true,
      });
      const payload = response.data;
      const incoming = Array.isArray(payload.messages) ? payload.messages : [];
      setMailboxState((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: null,
        messages: append ? mergeMailboxMessages(prev.messages, incoming) : incoming,
        nextPageToken: payload.nextPageToken ?? null,
      }));
    } catch (error) {
      setMailboxState((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: extractErrorMessage(error),
      }));
    }
  };

  const openMailboxModal = (order: UnifiedOrder) => {
    const to = String(order.customerEmail ?? "").trim();
    if (!to) {
      return;
    }
    setMailboxState({
      opened: true,
      loading: true,
      loadingMore: false,
      error: null,
      customerEmail: to,
      customerName: String(order.customerName ?? "").trim(),
      sourceOrder: order,
      messages: [],
      filter: "all",
      nextPageToken: null,
      previewOpen: false,
      previewLoading: false,
      previewError: null,
      previewData: null,
    });
    void fetchMailboxMessages(to);
  };

  const handleMailboxFilterChange = (value: string) => {
    if (value !== "all" && value !== "received" && value !== "sent") {
      return;
    }
    setMailboxState((prev) => ({ ...prev, filter: value }));
  };

  const handleMailboxLoadMore = async () => {
    const email = mailboxState.customerEmail;
    const token = mailboxState.nextPageToken;
    if (!email || !token || mailboxState.loadingMore || mailboxState.loading) {
      return;
    }
    await fetchMailboxMessages(email, { pageToken: token, append: true });
  };

  const handleMailboxRefresh = async () => {
    const email = mailboxState.customerEmail;
    if (!email || mailboxState.loading || mailboxState.loadingMore) {
      return;
    }
    await fetchMailboxMessages(email, { append: false });
  };

  const handleMailboxCreateNewEmail = () => {
    const sourceOrder = mailboxState.sourceOrder;
    if (!sourceOrder) {
      return;
    }
    setMailboxState(createDefaultMailboxState());
    openMailComposerModal(sourceOrder);
  };

  const loadMailTemplates = async () => {
    setMailTemplateState((prev) => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      const response = await axiosInstance.get<EmailTemplateListResponse>("/email-templates", {
        withCredentials: true,
      });
      const templates = Array.isArray(response.data?.templates) ? response.data.templates : [];
      setMailTemplateState((prev) => {
        const selectedTemplateId =
          prev.selectedTemplateId && templates.some((template) => String(template.id) === prev.selectedTemplateId)
            ? prev.selectedTemplateId
            : null;
        return {
          ...prev,
          loading: false,
          error: null,
          templates,
          selectedTemplateId,
          editorName: selectedTemplateId
            ? templates.find((template) => String(template.id) === selectedTemplateId)?.name ?? ""
            : "",
          editorDescription: selectedTemplateId
            ? templates.find((template) => String(template.id) === selectedTemplateId)?.description ?? ""
            : "",
          editorType: selectedTemplateId
            ? templates.find((template) => String(template.id) === selectedTemplateId)?.templateType ?? "plain_text"
            : "plain_text",
        };
      });
    } catch (error) {
      setMailTemplateState((prev) => ({
        ...prev,
        loading: false,
        error: extractErrorMessage(error),
      }));
    }
  };

  const applyTemplateToComposer = (template: EmailTemplate) => {
    setMailComposerState((prev) => {
      const subject = template.subjectTemplate ?? "";
      const body = template.bodyTemplate ?? "";
      const reactLiveSource =
        template.templateType === "react_email"
          ? isReactEmailSource(template.bodyTemplate)
            ? template.bodyTemplate
            : createDefaultReactEmailSource(body)
          : "";
      return {
        ...prev,
        subject,
        body,
        reactLiveSource,
        error: null,
        success: null,
      };
    });

    setMailTemplateState((prev) => ({
      ...prev,
      selectedTemplateId: String(template.id),
      editorName: template.name,
      editorDescription: template.description ?? "",
      editorType: template.templateType,
      error: null,
    }));
  };

  const openMailComposerModal = (order: UnifiedOrder) => {
    const { to, subject, body } = buildMailDraftFromOrder(order);
    if (!to) {
      return;
    }

    setMailTemplateState(createDefaultMailTemplateState());
    setMailComposerState({
      opened: true,
      sourceOrder: order,
      to,
      subject,
      body,
      reactLiveSource: "",
      sending: false,
      error: null,
      success: null,
    });
    setMailVariableDropdown({ field: null, tokenStart: -1, tokenEnd: -1, query: "" });

    void loadMailTemplates();
  };

  const closeMailComposerModal = () => {
    if (mailComposerState.sending) {
      return;
    }
    setMailComposerState(createDefaultMailComposerState());
    setMailTemplateState(createDefaultMailTemplateState());
    setMailComposerPreviewState(createDefaultMailComposerPreviewState());
    setMailVariableDropdown({ field: null, tokenStart: -1, tokenEnd: -1, query: "" });
  };

  const handleMailToChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value;
    setMailComposerState((prev) => ({
      ...prev,
      to: nextValue,
      error: null,
      success: null,
    }));
    closeMailVariableDropdown();
  };

  const handleMailSubjectChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value;
    const cursorPosition = event.currentTarget.selectionStart ?? nextValue.length;
    setMailComposerState((prev) => ({
      ...prev,
      subject: nextValue,
      error: null,
      success: null,
    }));
    updateMailVariableDropdownForField("subject", nextValue, cursorPosition);
  };

  const handleMailBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.currentTarget.value;
    const cursorPosition = event.currentTarget.selectionStart ?? nextValue.length;
    setMailComposerState((prev) => ({
      ...prev,
      body: nextValue,
      error: null,
      success: null,
    }));
    updateMailVariableDropdownForField("body", nextValue, cursorPosition);
  };

  const handleMailPreviewBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.currentTarget.value;
    const cursorPosition = event.currentTarget.selectionStart ?? nextValue.length;
    setMailComposerState((prev) => ({
      ...prev,
      reactLiveSource: nextValue,
      error: null,
      success: null,
    }));
    updateMailVariableDropdownForField("react", nextValue, cursorPosition);
    setMailComposerPreviewState((prev) => ({
      ...prev,
      error: null,
    }));
  };

  const handleMailTemplateSelection = (value: string | null) => {
    if (!value) {
      setMailTemplateState((prev) => ({
        ...prev,
        selectedTemplateId: null,
        editorName: "",
        editorDescription: "",
        editorType: "plain_text",
        error: null,
      }));
      return;
    }

    const template = mailTemplateState.templates.find((entry) => String(entry.id) === value);
    if (!template) {
      return;
    }
    applyTemplateToComposer(template);
  };

  const handleTemplateNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value;
    setMailTemplateState((prev) => ({
      ...prev,
      editorName: nextValue,
      error: null,
    }));
  };

  const handleTemplateDescriptionChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value;
    setMailTemplateState((prev) => ({
      ...prev,
      editorDescription: nextValue,
      error: null,
    }));
  };

  const handleTemplateTypeChange = (value: string | null) => {
    if (value !== "plain_text" && value !== "react_email") {
      return;
    }
    setMailTemplateState((prev) => ({
      ...prev,
      editorType: value,
      error: null,
    }));
    if (value === "react_email") {
      setMailComposerState((prev) => ({
        ...prev,
        reactLiveSource:
          prev.reactLiveSource.trim().length > 0
            ? prev.reactLiveSource
            : createDefaultReactEmailSource(prev.body),
      }));
    }
  };

  const resolveTemplateFieldsForPersistence = useCallback(
    (editorType: EmailTemplateType): { subjectTemplate: string; bodyTemplate: string } => {
      const currentSubject = mailComposerState.subject.trim();
      const currentPlainBody = mailComposerState.body.trim();
      const currentReactBody = mailComposerState.reactLiveSource.trim();
      const context = buildMailTemplateContextFromOrder(
        mailComposerState.sourceOrder,
        mailComposerState.to.trim(),
      );
      const selectedTemplate =
        mailTemplateState.selectedTemplateId
          ? mailTemplateState.templates.find(
              (template) => String(template.id) === mailTemplateState.selectedTemplateId,
            ) ?? null
          : null;

      let subjectTemplate = currentSubject;
      let bodyTemplate = editorType === "react_email" ? currentReactBody : currentPlainBody;

      if (selectedTemplate) {
        const renderedSelectedSubject = interpolateTemplateText(selectedTemplate.subjectTemplate, context).trim();
        if (currentSubject === renderedSelectedSubject) {
          subjectTemplate = selectedTemplate.subjectTemplate.trim();
        }

        if (editorType !== "react_email") {
          const renderedSelectedBody = interpolateTemplateText(selectedTemplate.bodyTemplate, context).trim();
          if (currentPlainBody === renderedSelectedBody) {
            bodyTemplate = selectedTemplate.bodyTemplate;
          }
        }
      }

      return {
        subjectTemplate,
        bodyTemplate,
      };
    },
    [
      mailComposerState.subject,
      mailComposerState.body,
      mailComposerState.reactLiveSource,
      mailComposerState.sourceOrder,
      mailComposerState.to,
      buildMailTemplateContextFromOrder,
      mailTemplateState.selectedTemplateId,
      mailTemplateState.templates,
    ],
  );

  const handleCreateTemplate = async () => {
    const name = mailTemplateState.editorName.trim();
    const description = mailTemplateState.editorDescription.trim();
    const { subjectTemplate, bodyTemplate } = resolveTemplateFieldsForPersistence(mailTemplateState.editorType);

    if (!name) {
      setMailTemplateState((prev) => ({ ...prev, error: "Template name is required." }));
      return;
    }
    if (!subjectTemplate) {
      setMailTemplateState((prev) => ({ ...prev, error: "Subject is required to save a template." }));
      return;
    }
    if (!bodyTemplate) {
      setMailTemplateState((prev) => ({
        ...prev,
        error:
          mailTemplateState.editorType === "react_email"
            ? "React template source is required to save a template."
            : "Body is required to save a template.",
      }));
      return;
    }

    setMailTemplateState((prev) => ({
      ...prev,
      saving: true,
      error: null,
    }));

    try {
      const response = await axiosInstance.post<EmailTemplate>(
        "/email-templates",
        {
          name,
          description: description || null,
          templateType: mailTemplateState.editorType,
          subjectTemplate,
          bodyTemplate,
          isActive: true,
        },
        { withCredentials: true },
      );
      const createdTemplate = response.data;
      setMailTemplateState((prev) => ({
        ...prev,
        saving: false,
        error: null,
        selectedTemplateId: String(createdTemplate.id),
        editorName: createdTemplate.name,
        editorDescription: createdTemplate.description ?? "",
        editorType: createdTemplate.templateType,
        templates: [createdTemplate, ...prev.templates.filter((template) => template.id !== createdTemplate.id)],
      }));
      setMailComposerState((prev) => ({
        ...prev,
        error: null,
        success: `Template "${createdTemplate.name}" saved.`,
      }));
    } catch (error) {
      setMailTemplateState((prev) => ({
        ...prev,
        saving: false,
        error: extractErrorMessage(error),
      }));
    }
  };

  const handleUpdateTemplate = async () => {
    const selectedTemplateId = mailTemplateState.selectedTemplateId;
    if (!selectedTemplateId) {
      setMailTemplateState((prev) => ({ ...prev, error: "Select a template to update." }));
      return;
    }
    const name = mailTemplateState.editorName.trim();
    const description = mailTemplateState.editorDescription.trim();
    const { subjectTemplate, bodyTemplate } = resolveTemplateFieldsForPersistence(mailTemplateState.editorType);

    if (!name) {
      setMailTemplateState((prev) => ({ ...prev, error: "Template name is required." }));
      return;
    }
    if (!subjectTemplate) {
      setMailTemplateState((prev) => ({ ...prev, error: "Subject is required to update a template." }));
      return;
    }
    if (!bodyTemplate) {
      setMailTemplateState((prev) => ({
        ...prev,
        error:
          mailTemplateState.editorType === "react_email"
            ? "React template source is required to update a template."
            : "Body is required to update a template.",
      }));
      return;
    }

    setMailTemplateState((prev) => ({
      ...prev,
      saving: true,
      error: null,
    }));

    try {
      const response = await axiosInstance.patch<EmailTemplate>(
        `/email-templates/${encodeURIComponent(selectedTemplateId)}`,
        {
          name,
          description: description || null,
          templateType: mailTemplateState.editorType,
          subjectTemplate,
          bodyTemplate,
          isActive: true,
        },
        { withCredentials: true },
      );
      const updatedTemplate = response.data;
      setMailTemplateState((prev) => ({
        ...prev,
        saving: false,
        error: null,
        templates: prev.templates.map((template) =>
          template.id === updatedTemplate.id ? updatedTemplate : template,
        ),
      }));
      setMailComposerState((prev) => ({
        ...prev,
        error: null,
        success: `Template "${updatedTemplate.name}" updated.`,
      }));
    } catch (error) {
      setMailTemplateState((prev) => ({
        ...prev,
        saving: false,
        error: extractErrorMessage(error),
      }));
    }
  };

  const selectedMailTemplate = useMemo(
    () =>
      mailTemplateState.selectedTemplateId
        ? mailTemplateState.templates.find(
            (template) => String(template.id) === mailTemplateState.selectedTemplateId,
          ) ?? null
        : null,
    [mailTemplateState.selectedTemplateId, mailTemplateState.templates],
  );
  const isReactTemplateSelected =
    (selectedMailTemplate?.templateType ?? mailTemplateState.editorType) === "react_email";

  const mailTemplateVariableDefinitions = useMemo(() => {
    const normalizedTemplateHint = `${selectedMailTemplate?.name ?? ""} ${mailTemplateState.editorName ?? ""}`
      .toLowerCase()
      .trim();
    const isRefundTemplate = normalizedTemplateHint.includes("refund");
    const isSupplyTemplate = normalizedTemplateHint.includes("supply");

    const definitions: MailVariableDefinition[] = [...BASE_MAIL_VARIABLES];
    if (isRefundTemplate) {
      definitions.push(...REFUND_MAIL_VARIABLES);
    }
    if (isSupplyTemplate) {
      definitions.push(...SUPPLY_MAIL_VARIABLES);
    }
    if (isReactTemplateSelected) {
      definitions.push(...REACT_MAIL_VARIABLES);
    }

    const unique = new Map<string, MailVariableDefinition>();
    definitions.forEach((definition) => {
      if (!unique.has(definition.key)) {
        unique.set(definition.key, definition);
      }
    });
    return Array.from(unique.values());
  }, [selectedMailTemplate?.name, mailTemplateState.editorName, isReactTemplateSelected]);

  const activeMailVariableOptions = useMemo(() => {
    if (!mailVariableDropdown.field) {
      return [] as MailVariableDefinition[];
    }
    return mailTemplateVariableDefinitions;
  }, [mailTemplateVariableDefinitions, mailVariableDropdown.field]);

  const closeMailVariableDropdown = useCallback((): void => {
    setMailVariableDropdown({ field: null, tokenStart: -1, tokenEnd: -1, query: "" });
  }, []);

  function updateMailVariableDropdownForField(field: MailVariableField, value: string, cursorPosition: number): void {
    const tokenContext = resolveMailVariableTokenContext(value, cursorPosition);
    if (!tokenContext) {
      setMailVariableDropdown((prev) =>
        prev.field === field ? { field: null, tokenStart: -1, tokenEnd: -1, query: "" } : prev,
      );
      return;
    }
    setMailVariableDropdown({
      field,
      tokenStart: tokenContext.tokenStart,
      tokenEnd: tokenContext.tokenEnd,
      query: tokenContext.query,
    });
  }

  const handleSelectMailVariableFromDropdown = useCallback(
    (definition: MailVariableDefinition) => {
      if (!mailVariableDropdown.field || mailVariableDropdown.tokenStart < 0 || mailVariableDropdown.tokenEnd < 0) {
        return;
      }
      const token = `{{${definition.key}}}`;
      const replaceTokenRange = (source: string): { nextValue: string; nextCursor: number } => {
        const nextValue =
          source.slice(0, mailVariableDropdown.tokenStart) +
          token +
          source.slice(mailVariableDropdown.tokenEnd);
        const nextCursor = mailVariableDropdown.tokenStart + token.length;
        return { nextValue, nextCursor };
      };

      const field = mailVariableDropdown.field;
      let nextCursor = 0;
      if (field === "subject") {
        setMailComposerState((prev) => {
          const replaced = replaceTokenRange(prev.subject);
          nextCursor = replaced.nextCursor;
          return { ...prev, subject: replaced.nextValue, error: null, success: null };
        });
      } else if (field === "body") {
        setMailComposerState((prev) => {
          const replaced = replaceTokenRange(prev.body);
          nextCursor = replaced.nextCursor;
          return { ...prev, body: replaced.nextValue, error: null, success: null };
        });
      } else {
        setMailComposerState((prev) => {
          const replaced = replaceTokenRange(prev.reactLiveSource);
          nextCursor = replaced.nextCursor;
          return { ...prev, reactLiveSource: replaced.nextValue, error: null, success: null };
        });
      }

      window.requestAnimationFrame(() => {
        const targetInput =
          field === "subject"
            ? mailSubjectInputRef.current
            : field === "body"
              ? mailBodyInputRef.current
              : mailReactSourceInputRef.current;
        if (targetInput) {
          targetInput.focus();
          targetInput.setSelectionRange(nextCursor, nextCursor);
        }
      });

      closeMailVariableDropdown();
      setMailComposerPreviewState((prev) => ({ ...prev, error: null }));
    },
    [closeMailVariableDropdown, mailVariableDropdown.field, mailVariableDropdown.tokenEnd, mailVariableDropdown.tokenStart],
  );

  const renderMailVariableDropdown = (field: MailVariableField): ReactNode => {
    if (mailVariableDropdown.field !== field) {
      return null;
    }

    if (activeMailVariableOptions.length === 0) {
      return (
        <Paper withBorder radius="md" p="xs">
          <Text size="xs" c="dimmed">
            No variables found for this query.
          </Text>
        </Paper>
      );
    }

    return (
      <Paper withBorder radius="md" p="xs">
        <Stack gap={4} style={{ maxHeight: 220, overflowY: "auto" }}>
          {activeMailVariableOptions.map((entry) => (
            <Box
              key={`mail-variable-option-${field}-${entry.key}`}
              component="button"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                handleSelectMailVariableFromDropdown(entry);
              }}
              style={{
                width: "100%",
                textAlign: "left",
                border: "none",
                background: "transparent",
                padding: "6px 8px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <Text size="sm" fw={600}>
                {`{{${entry.key}}}`}
              </Text>
              <Text size="xs" c="dimmed">
                {entry.description}
              </Text>
            </Box>
          ))}
        </Stack>
      </Paper>
    );
  };

  const resolveSelectedTemplateId = useCallback((): number | null => {
    const selectedTemplateId = mailTemplateState.selectedTemplateId;
    const parsedTemplateId =
      selectedTemplateId !== null ? Number.parseInt(selectedTemplateId, 10) : Number.NaN;
    return Number.isFinite(parsedTemplateId) && parsedTemplateId > 0 ? parsedTemplateId : null;
  }, [mailTemplateState.selectedTemplateId]);

  const withSafeRefundTemplateContext = useCallback(
    (baseContext: Record<string, unknown>): Record<string, unknown> => {
      const quantityRaw = Number(baseContext.quantity ?? baseContext.peopleCount ?? 0);
      const quantity = Number.isFinite(quantityRaw) ? Math.max(0, Math.round(quantityRaw)) : 0;
      const createAddonFallback = (name: string) => ({
        name,
        qty: 0,
        quantity: 0,
        bookedQty: 0,
        unitPrice: 0,
        refundQty: 0,
        amount: 0,
      });
      const addonFallbacks = [
        createAddonFallback("Cocktails Add-On"),
        createAddonFallback("T-Shirts Add-On"),
        createAddonFallback("Photos Add-On"),
      ];
      const existingRefundedAddons = Array.isArray(baseContext.refundedAddons)
        ? (baseContext.refundedAddons as Array<Record<string, unknown>>)
        : [];
      const refundedAddons =
        existingRefundedAddons.length > 0
          ? existingRefundedAddons.map((addon) => ({
              ...addon,
              name: String(addon.name ?? ""),
              qty: Number.isFinite(Number(addon.qty)) ? Number(addon.qty) : Number(addon.quantity ?? 0) || 0,
              quantity: Number.isFinite(Number(addon.quantity))
                ? Number(addon.quantity)
                : Number(addon.refundQty ?? addon.qty ?? 0) || 0,
              bookedQty: Number.isFinite(Number(addon.bookedQty))
                ? Number(addon.bookedQty)
                : Number(addon.qty ?? 0) || 0,
              unitPrice: Number.isFinite(Number(addon.unitPrice)) ? Number(addon.unitPrice) : 0,
              refundQty: Number.isFinite(Number(addon.refundQty))
                ? Number(addon.refundQty)
                : Number(addon.quantity ?? addon.qty ?? 0) || 0,
              amount: Number.isFinite(Number(addon.amount)) ? Number(addon.amount) : 0,
            }))
          : addonFallbacks;
      const peopleRefund =
        baseContext.peopleRefund && typeof baseContext.peopleRefund === "object"
          ? (baseContext.peopleRefund as Record<string, unknown>)
          : {
              name: "People",
              qty: quantity,
              quantity: 0,
              bookedQty: quantity,
              refundQty: 0,
              unitPrice: 0,
              amount: 0,
            };

      return {
        ...baseContext,
        refundedAmount: Number(baseContext.refundedAmount ?? 0) || 0,
        totalPaidAmount: Number(baseContext.totalPaidAmount ?? 0) || 0,
        alreadyRefundedAmount: Number(baseContext.alreadyRefundedAmount ?? 0) || 0,
        isFullRefund: Boolean(baseContext.isFullRefund ?? false),
        partialReason: String(baseContext.partialReason ?? ""),
        refundReason: String(baseContext.refundReason ?? ""),
        experienceDate:
          String(baseContext.experienceDate ?? baseContext.bookingDateDisplay ?? baseContext.bookingDate ?? "").trim(),
        peopleChange:
          baseContext.peopleChange && typeof baseContext.peopleChange === "object"
            ? baseContext.peopleChange
            : { from: quantity, to: quantity, amount: 0 },
        peopleRefundDetails:
          baseContext.peopleRefundDetails && typeof baseContext.peopleRefundDetails === "object"
            ? baseContext.peopleRefundDetails
            : peopleRefund,
        peopleRefund,
        refundedAddons,
        addons: Array.isArray(baseContext.addons) ? baseContext.addons : refundedAddons,
        addonsBreakdown: Array.isArray(baseContext.addonsBreakdown)
          ? baseContext.addonsBreakdown
          : refundedAddons,
        cocktailsRefund:
          baseContext.cocktailsRefund && typeof baseContext.cocktailsRefund === "object"
            ? baseContext.cocktailsRefund
            : refundedAddons[0],
        tshirtsRefund:
          baseContext.tshirtsRefund && typeof baseContext.tshirtsRefund === "object"
            ? baseContext.tshirtsRefund
            : refundedAddons[1] ?? refundedAddons[0],
        photosRefund:
          baseContext.photosRefund && typeof baseContext.photosRefund === "object"
            ? baseContext.photosRefund
            : refundedAddons[2] ?? refundedAddons[0],
      };
    },
    [],
  );

  const buildMailTemplateContextForRequest = useCallback(
    (recipientEmail: string): Record<string, unknown> | undefined => {
      const templateId = resolveSelectedTemplateId();
      const baseContext = buildMailTemplateContextFromOrder(mailComposerState.sourceOrder, recipientEmail);
      const templateHint = `${selectedMailTemplate?.name ?? ""} ${mailTemplateState.editorName ?? ""}`
        .toLowerCase()
        .trim();
      const shouldIncludeRefundContext = templateHint.includes("refund");
      const contextWithDefaults = shouldIncludeRefundContext
        ? withSafeRefundTemplateContext(baseContext as Record<string, unknown>)
        : (baseContext as Record<string, unknown>);
      if (isReactTemplateSelected) {
        return {
          ...contextWithDefaults,
          reactTemplateSource: mailComposerState.reactLiveSource,
        };
      }
      if (!templateId) {
        return undefined;
      }
      return contextWithDefaults;
    },
    [
      resolveSelectedTemplateId,
      buildMailTemplateContextFromOrder,
      selectedMailTemplate?.name,
      mailTemplateState.editorName,
      withSafeRefundTemplateContext,
      mailComposerState.sourceOrder,
      mailComposerState.reactLiveSource,
      isReactTemplateSelected,
    ],
  );

  const closeMailComposerPreview = () => {
    if (mailComposerPreviewState.loading) {
      return;
    }
    closeMailVariableDropdown();
    setMailComposerPreviewState(createDefaultMailComposerPreviewState());
  };

  const handlePreviewMail = useCallback(async (options?: { silentValidation?: boolean; background?: boolean }) => {
    const silentValidation = options?.silentValidation === true;
    const background = options?.background === true;
    const to = mailComposerState.to.trim();
    const subject = mailComposerState.subject.trim();
    const body = mailComposerState.body.trim();
    const templateId = resolveSelectedTemplateId();

    if (!subject) {
      if (!silentValidation) {
        setMailComposerState((prev) => ({ ...prev, error: "Subject is required." }));
      }
      return;
    }
    if (!isReactTemplateSelected && !body) {
      if (!silentValidation) {
        setMailComposerState((prev) => ({ ...prev, error: "Body is required." }));
      }
      return;
    }
    if (isReactTemplateSelected && !mailComposerState.reactLiveSource.trim()) {
      if (!silentValidation) {
        setMailComposerState((prev) => ({ ...prev, error: "React template source is required." }));
      }
      return;
    }

    if (!silentValidation) {
      setMailComposerState((prev) => ({
        ...prev,
        error: null,
        success: null,
      }));
    }
    setMailComposerPreviewState((prev) => {
      const blockingLoading = !background && prev.data === null;
      return {
        ...prev,
        opened: true,
        loading: blockingLoading,
        refreshing: !blockingLoading,
        error: null,
      };
    });

    try {
      const response = await axiosInstance.post<MailComposerPreviewResponse>(
        "/bookings/emails/render-preview",
        {
          to: to || undefined,
          subject,
          body: isReactTemplateSelected ? undefined : body,
          templateId: templateId ?? undefined,
          templateContext: buildMailTemplateContextForRequest(to),
        },
        { withCredentials: true },
      );
      setMailComposerPreviewState((prev) => ({
        ...prev,
        opened: true,
        loading: false,
        refreshing: false,
        error: null,
        data: response.data,
      }));
    } catch (error) {
      setMailComposerPreviewState((prev) => ({
        ...prev,
        opened: true,
        loading: false,
        refreshing: false,
        error: extractErrorMessage(error),
      }));
    }
  }, [
    mailComposerState.to,
    mailComposerState.subject,
    mailComposerState.body,
    mailComposerState.reactLiveSource,
    isReactTemplateSelected,
    resolveSelectedTemplateId,
    buildMailTemplateContextForRequest,
  ]);

  const handleSendMail = async () => {
    const to = mailComposerState.to.trim();
    const subject = mailComposerState.subject.trim();
    const body = mailComposerState.body.trim();
    const templateId = resolveSelectedTemplateId();

    if (!mailComposerPreviewState.data || mailComposerPreviewState.loading || mailComposerPreviewState.refreshing) {
      setMailComposerState((prev) => ({
        ...prev,
        error: "Open and load the email preview before sending.",
      }));
      return;
    }

    if (!to) {
      setMailComposerState((prev) => ({ ...prev, error: "Recipient email is required." }));
      return;
    }
    if (!subject) {
      setMailComposerState((prev) => ({ ...prev, error: "Subject is required." }));
      return;
    }
    if (!isReactTemplateSelected && !body) {
      setMailComposerState((prev) => ({ ...prev, error: "Body is required." }));
      return;
    }
    if (isReactTemplateSelected && !mailComposerState.reactLiveSource.trim()) {
      setMailComposerState((prev) => ({ ...prev, error: "React template source is required." }));
      return;
    }

    setMailComposerState((prev) => ({
      ...prev,
      sending: true,
      error: null,
      success: null,
    }));

    try {
      await axiosInstance.post(
        "/bookings/emails/send",
        {
          to,
          subject,
          body: isReactTemplateSelected ? undefined : body,
          templateId: templateId ?? undefined,
          templateContext: buildMailTemplateContextForRequest(to),
        },
        { withCredentials: true },
      );
      setMailComposerState((prev) => ({
        ...prev,
        sending: false,
        success: "Email sent successfully.",
      }));
    } catch (error) {
      setMailComposerState((prev) => ({
        ...prev,
        sending: false,
        error: extractErrorMessage(error),
      }));
    }
  };

  useEffect(() => {
    const isReactSelected =
      (
        mailTemplateState.selectedTemplateId
          ? mailTemplateState.templates.find(
              (template) => String(template.id) === mailTemplateState.selectedTemplateId,
            )?.templateType
          : mailTemplateState.editorType
      ) === "react_email";

    if (!mailComposerPreviewState.opened || !isReactSelected) {
      return;
    }
    const source = mailComposerState.reactLiveSource.trim();
    if (!source) {
      return;
    }

    const timer = window.setTimeout(() => {
      void handlePreviewMail({ silentValidation: true, background: true });
    }, 350);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    mailComposerPreviewState.opened,
    mailTemplateState.selectedTemplateId,
    mailTemplateState.templates,
    mailTemplateState.editorType,
    mailComposerState.reactLiveSource,
    handlePreviewMail,
  ]);

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
  const mailboxMessages = useMemo(
    () =>
      mailboxState.filter === "all"
        ? mailboxState.messages
        : mailboxState.messages.filter((message) => message.direction === mailboxState.filter),
    [mailboxState.filter, mailboxState.messages],
  );
  const mailboxPreviewHtml = mailboxState.previewData?.htmlBody ?? null;
  const mailboxPreviewBody =
    mailboxState.previewData?.previewText ??
    mailboxState.previewData?.textBody ??
    mailboxState.previewData?.htmlText ??
    mailboxState.previewData?.snippet ??
    null;
  const mailComposerPreviewHtml = mailComposerPreviewState.data?.htmlBody ?? null;
  const mailComposerDisplayHtml = mailComposerPreviewHtml;
  const mailComposerPreviewBody = mailComposerPreviewState.data?.textBody ?? null;
  const cancelRefundPreviewHtml = cancelRefundEmailPreviewState.data?.htmlBody ?? null;
  const cancelRefundPreviewBody = cancelRefundEmailPreviewState.data?.textBody ?? null;
  const partialRefundPreviewHtml = partialRefundEmailPreviewState.data?.htmlBody ?? null;
  const partialRefundPreviewBody = partialRefundEmailPreviewState.data?.textBody ?? null;
  const partialRefundAmountValue = Number(partialRefundState.amount ?? 0);
  const partialRefundRemainingMajor = getPartialRefundRemainingAmountMajor(partialRefundState.preview);
  const partialRefundHasPositiveAmount = partialRefundAmountValue > 0;
  const partialRefundShouldProceedToCancel =
    Boolean(partialRefundState.preview) &&
    partialRefundRemainingMajor > 0 &&
    partialRefundHasPositiveAmount &&
    partialRefundAmountValue + 0.0001 >= partialRefundRemainingMajor;
  const partialRefundHasCustomerEmail = Boolean(String(partialRefundState.order?.customerEmail ?? "").trim());
  const partialRefundCanPreviewEmail =
    Boolean(partialRefundState.preview) &&
    !partialRefundState.submitting &&
    !partialRefundState.loading &&
    partialRefundHasCustomerEmail &&
    partialRefundHasPositiveAmount &&
    !partialRefundShouldProceedToCancel;
  const partialRefundCanSubmit =
    Boolean(partialRefundState.preview) &&
    !partialRefundState.submitting &&
    partialRefundHasPositiveAmount &&
    (partialRefundShouldProceedToCancel || partialRefundHasCustomerEmail);
  const mailTemplateOptions = useMemo(
    () =>
      mailTemplateState.templates.map((template) => ({
        value: String(template.id),
        label: template.name,
      })),
    [mailTemplateState.templates],
  );
  const hasSelectedMailTemplate = Boolean(selectedMailTemplate);
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

                  const renderGroupCards = () => (
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
                          <Box
                            style={{
                              display: "grid",
                              gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(420px, 1fr))",
                              gap: 12,
                            }}
                          >
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
                                        <Box
                                          component="button"
                                          type="button"
                                          onClick={() => openMailboxModal(order)}
                                          title={order.customerEmail}
                                          aria-label={`Open mailbox for ${order.customerEmail}`}
                                          style={{
                                            display: "block",
                                            width: "100%",
                                            padding: 0,
                                            border: 0,
                                            background: "transparent",
                                            color: "inherit",
                                            textDecoration: "none",
                                            cursor: "pointer",
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
                                        </Box>
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
                          </Box>
                        </Stack>
                      </Paper>
                    );
                  return renderGroupCards();
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
        styles={{
          header: { position: "relative" },
          title: { width: "100%", textAlign: "center", fontWeight: 700 },
          close: { position: "absolute", right: 12 },
        }}
        fullScreen
      >
        <Stack gap="md" align="center">
          {partialRefundState.loading && (
            <Group gap="sm" justify="center">
              <Loader size="sm" />
              <Text size="sm">Loading refund details...</Text>
            </Group>
          )}
          {partialRefundState.error && (
            <Alert color="red" title="Unable to load refund details" style={{ width: "100%", textAlign: "center" }}>
              {partialRefundState.error}
            </Alert>
          )}
          {partialRefundState.preview && !partialRefundHasCustomerEmail && !partialRefundShouldProceedToCancel && (
            <Alert color="yellow" title="Missing customer email" style={{ width: "100%", textAlign: "center" }}>
              Partial refund confirmation email cannot be sent because this booking has no customer email.
            </Alert>
          )}
          {partialRefundState.preview && (
            <Stack gap="sm" align="center" style={{ width: "100%" }}>
              <Table withColumnBorders>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th style={{ textAlign: "center", width: "40%" }}>Order</Table.Th>
                    <Table.Td align="center">{partialRefundState.preview.orderId}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th style={{ textAlign: "center", width: "40%" }}>Paid</Table.Th>
                    <Table.Td align="center">
                      {formatStripeAmount(
                        partialRefundState.preview.stripe.amount,
                        partialRefundState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th style={{ textAlign: "center", width: "40%" }}>Refunded</Table.Th>
                    <Table.Td align="center">
                      {formatStripeAmount(
                        partialRefundState.preview.stripe.amountRefunded,
                        partialRefundState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th style={{ textAlign: "center", width: "40%" }}>Remaining</Table.Th>
                    <Table.Td align="center">
                      {formatStripeAmount(
                        partialRefundState.preview.remainingAmount,
                        partialRefundState.preview.stripe.currency,
                      )}
                    </Table.Td>
                  </Table.Tr>
                </Table.Tbody>
              </Table>

              <Stack gap="xs">
                <Text size="sm" fw={600} ta="center">
                  People refund
                </Text>
                <Table withColumnBorders striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th align="center">Item</Table.Th>
                      <Table.Th align="center">Qty</Table.Th>
                      <Table.Th align="center">Unit</Table.Th>
                      <Table.Th align="center">Total</Table.Th>
                      <Table.Th align="center">Refund</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    <Table.Tr>
                      <Table.Td align="center">People</Table.Td>
                      <Table.Td align="center">{partialRefundState.preview.people?.quantity ?? 0}</Table.Td>
                      <Table.Td align="center">
                        {partialRefundState.preview.people?.unitPrice
                          ? `${parseMoney(partialRefundState.preview.people.unitPrice).toFixed(2)} ${(partialRefundState.preview.people?.currency ?? partialRefundState.preview?.stripe.currency ?? "").toUpperCase()}`
                          : "-"}
                      </Table.Td>
                      <Table.Td align="center">
                        {partialRefundState.preview.people?.totalPrice
                          ? `${parseMoney(partialRefundState.preview.people.totalPrice).toFixed(2)} ${(partialRefundState.preview.people?.currency ?? partialRefundState.preview?.stripe.currency ?? "").toUpperCase()}`
                          : "-"}
                      </Table.Td>
                      <Table.Td align="center">
                        <NumberInput
                          value={partialRefundState.peopleQuantity}
                          min={0}
                          max={partialRefundState.preview.people?.quantity ?? 0}
                          step={1}
                          allowDecimal={false}
                          disabled={partialRefundState.manualAmountUnlocked}
                          onChange={handlePartialRefundPeopleChange}
                        />
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </Stack>

              {partialRefundState.preview.addons.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={600} ta="center">
                    Add-ons refund
                  </Text>
                  <Table withColumnBorders striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th align="center">Item</Table.Th>
                        <Table.Th align="center">Qty</Table.Th>
                        <Table.Th align="center">Unit</Table.Th>
                        <Table.Th align="center">Total</Table.Th>
                        <Table.Th align="center">Refund</Table.Th>
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
                            <Table.Td align="center">{addon.platformAddonName ?? `Addon ${addon.id}`}</Table.Td>
                            <Table.Td align="center">{addon.quantity}</Table.Td>
                            <Table.Td align="center">
                              {unitPrice > 0
                                ? `${unitPrice.toFixed(2)} ${(addon.currency ?? partialRefundState.preview?.stripe.currency ?? "").toUpperCase()}`
                                : "-"}
                            </Table.Td>
                            <Table.Td align="center">
                              {addon.totalPrice
                                ? `${parseMoney(addon.totalPrice).toFixed(2)} ${(addon.currency ?? partialRefundState.preview?.stripe.currency ?? "").toUpperCase()}`
                                : unitPrice > 0
                                  ? `${(unitPrice * addon.quantity).toFixed(2)} ${(addon.currency ?? partialRefundState.preview?.stripe.currency ?? "").toUpperCase()}`
                                  : "-"}
                            </Table.Td>
                            <Table.Td align="center">
                              <NumberInput
                                value={partialRefundState.addonQuantities[addon.id] ?? 0}
                                min={0}
                                max={addon.quantity}
                                step={1}
                                allowDecimal={false}
                                disabled={partialRefundState.manualAmountUnlocked}
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
                label={
                  <Group gap={6} justify="center" wrap="nowrap">
                    <Text fw={700}>Refund amount</Text>
                    <ActionIcon
                      size="xs"
                      variant={partialRefundState.manualAmountUnlocked ? "filled" : "light"}
                      color={partialRefundState.manualAmountUnlocked ? "orange" : "gray"}
                      onClick={handleTogglePartialRefundManualAmount}
                      aria-label={
                        partialRefundState.manualAmountUnlocked
                          ? "Lock refund amount editing"
                          : "Unlock refund amount editing"
                      }
                    >
                      <IconKey size={12} />
                    </ActionIcon>
                  </Group>
                }
                style={{ width: "100%" }}
                value={partialRefundState.amount ?? 0}
                min={0}
                max={partialRefundRemainingMajor}
                step={1}
                decimalScale={2}
                fixedDecimalScale
                onChange={handlePartialRefundAmountChange}
                readOnly={!partialRefundState.manualAmountUnlocked}
                styles={{
                  label: { width: "100%", textAlign: "center" },
                  input: { textAlign: "center" },
                }}
                rightSection={
                  <Text size="xs" c="dimmed">
                    {partialRefundState.preview.stripe.currency?.toUpperCase() ?? ""}
                  </Text>
                }
                rightSectionWidth={64}
              />

              {partialRefundState.success && (
                <Alert color="green" title="Refund submitted" style={{ width: "100%", textAlign: "center" }}>
                  {partialRefundState.success}
                </Alert>
              )}
            </Stack>
          )}

          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                void handlePreviewPartialRefundEmail();
              }}
              loading={partialRefundEmailPreviewState.loading}
              disabled={!partialRefundCanPreviewEmail}
            >
              Preview Email
            </Button>
            <Button
              size="xs"
              color={partialRefundShouldProceedToCancel ? "red" : "orange"}
              onClick={handleSubmitPartialRefund}
              loading={partialRefundState.submitting}
              disabled={!partialRefundCanSubmit}
            >
              {partialRefundShouldProceedToCancel ? "Proceed to Cancel" : "Issue Partial Refund"}
            </Button>
          </Box>
        </Stack>
      </Modal>

      <Modal
        opened={partialRefundEmailPreviewState.opened}
        onClose={closePartialRefundEmailPreview}
        title="Partial refund email preview"
        fullScreen
        centered
      >
        <Stack gap="sm">
          {partialRefundEmailPreviewState.error ? (
            <Alert color="red" title="Failed to render partial refund email preview">
              {partialRefundEmailPreviewState.error}
            </Alert>
          ) : null}
          {partialRefundEmailPreviewState.loading ? (
            <Box style={{ minHeight: 120 }}>
              <Loader variant="dots" />
            </Box>
          ) : null}
          {partialRefundEmailPreviewState.data ? (
            <>
              <Stack gap={4}>
                <Text fw={600}>{partialRefundEmailPreviewState.data.subject || "No subject"}</Text>
                <Text size="sm" c="dimmed">
                  {partialRefundEmailPreviewState.templateName
                    ? `Template: ${partialRefundEmailPreviewState.templateName}`
                    : "Template: Inline fallback"}
                </Text>
              </Stack>
              {partialRefundPreviewHtml ? (
                <Box style={{ height: "calc(100vh - 240px)" }}>
                  <iframe
                    title="Partial refund email preview"
                    srcDoc={partialRefundPreviewHtml}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                    }}
                  />
                </Box>
              ) : partialRefundPreviewBody ? (
                <Paper withBorder radius="md" p="sm" bg="#f8fafc">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {partialRefundPreviewBody}
                  </Text>
                </Paper>
              ) : (
                <Alert color="yellow" title="No preview content">
                  No email preview content available.
                </Alert>
              )}
            </>
          ) : null}
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
        fullScreen
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
          {cancelState.mode === "ecwid_refund" && !String(cancelState.order?.customerEmail ?? "").trim() && (
            <Alert color="yellow" title="Missing customer email">
              Refund confirmation email cannot be sent because this booking has no customer email.
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
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            <Button
              size="xs"
              variant="light"
              onClick={() => {
                void handlePreviewCancelRefundEmail();
              }}
              loading={cancelRefundEmailPreviewState.loading}
              disabled={
                cancelState.loading ||
                cancelState.submitting ||
                cancelState.mode !== "ecwid_refund" ||
                !cancelState.preview
              }
            >
              Preview Email
            </Button>
            <Button
              size="xs"
              color="red"
              onClick={handleConfirmRefund}
              loading={cancelState.submitting}
              disabled={
                cancelState.loading ||
                cancelState.submitting ||
                !cancelState.mode ||
                (cancelState.mode === "ecwid_refund" &&
                  (!cancelState.preview || !String(cancelState.order?.customerEmail ?? "").trim()))
              }
            >
              {cancelState.mode === "ecwid_refund"
                ? cancelState.preview?.stripe.fullyRefunded
                  ? "Confirm Cancel"
                  : "Confirm Refund"
                : "Confirm Cancel"}
            </Button>
          </Box>
        </Stack>
      </Modal>

      <Modal
        opened={cancelRefundEmailPreviewState.opened}
        onClose={closeCancelRefundEmailPreview}
        title="Refund email preview"
        fullScreen
        centered
      >
        <Stack gap="sm">
          {cancelRefundEmailPreviewState.error ? (
            <Alert color="red" title="Failed to render refund email preview">
              {cancelRefundEmailPreviewState.error}
            </Alert>
          ) : null}
          {cancelRefundEmailPreviewState.loading ? (
            <Box style={{ minHeight: 120 }}>
              <Loader variant="dots" />
            </Box>
          ) : null}
          {cancelRefundEmailPreviewState.data ? (
            <>
              <Stack gap={4}>
                <Text fw={600}>{cancelRefundEmailPreviewState.data.subject || "No subject"}</Text>
                <Text size="sm" c="dimmed">
                  {cancelRefundEmailPreviewState.templateName
                    ? `Template: ${cancelRefundEmailPreviewState.templateName}`
                    : "Template: Inline fallback"}
                </Text>
              </Stack>
              {cancelRefundPreviewHtml ? (
                <Box style={{ height: "calc(100vh - 240px)" }}>
                  <iframe
                    title="Cancel refund email preview"
                    srcDoc={cancelRefundPreviewHtml}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                    }}
                  />
                </Box>
              ) : cancelRefundPreviewBody ? (
                <Paper withBorder radius="md" p="sm" bg="#f8fafc">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {cancelRefundPreviewBody}
                  </Text>
                </Paper>
              ) : (
                <Alert color="yellow" title="No preview content">
                  No email preview content available.
                </Alert>
              )}
            </>
          ) : null}
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

      <Modal
        opened={mailboxState.opened}
        onClose={closeMailboxModal}
        title={`Mailbox${mailboxState.customerEmail ? ` - ${mailboxState.customerEmail}` : ""}`}
        fullScreen
        centered
      >
        <Stack gap="md" style={{ minHeight: "calc(100vh - 120px)" }}>
          <Group justify="space-between" align="center">
            <Stack gap={2}>
              <Text fw={600}>{mailboxState.customerName || "Customer mailbox"}</Text>
              <Text size="sm" c="dimmed">
                {mailboxState.customerEmail || "-"}
              </Text>
            </Stack>
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                onClick={handleMailboxRefresh}
                loading={mailboxState.loading && mailboxState.messages.length > 0}
                disabled={!mailboxState.customerEmail || mailboxState.loadingMore}
              >
                Refresh
              </Button>
              <Button
                size="xs"
                onClick={handleMailboxCreateNewEmail}
                disabled={!mailboxState.sourceOrder}
              >
                Create new email
              </Button>
            </Group>
          </Group>

          <SegmentedControl
            value={mailboxState.filter}
            onChange={handleMailboxFilterChange}
            data={[
              { label: "All", value: "all" },
              { label: "Received", value: "received" },
              { label: "Sent", value: "sent" },
            ]}
            size="sm"
          />

          {mailboxState.error ? (
            <Alert color="red" title="Failed to load mailbox">
              {mailboxState.error}
            </Alert>
          ) : null}

          {mailboxState.loading && mailboxState.messages.length === 0 ? (
            <Box style={{ minHeight: 160 }}>
              <Loader variant="dots" />
            </Box>
          ) : mailboxMessages.length === 0 ? (
            <Alert color="blue" title="No emails">
              No matching emails were found for this customer.
            </Alert>
          ) : (
            <Stack gap="xs">
              {mailboxMessages.map((message) => (
                <Paper key={`mailbox-message-${message.messageId}`} withBorder radius="md" p="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={6}>
                        <Badge
                          size="xs"
                          color={message.direction === "sent" ? "blue" : "teal"}
                          variant="light"
                        >
                          {message.direction === "sent" ? "Sent" : "Received"}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {formatDateTime(message.internalDate ?? null)}
                        </Text>
                      </Group>
                      <Text fw={600} size="sm" lineClamp={1}>
                        {message.subject?.trim() || "(No subject)"}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {message.fromAddress || "-"}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {message.toAddresses || "-"}
                      </Text>
                      <Text size="xs" lineClamp={2}>
                        {message.snippet || "No snippet available."}
                      </Text>
                    </Stack>
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => handleMailboxPreview(message.messageId)}
                    >
                      Preview
                    </Button>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}

          {mailboxState.nextPageToken ? (
            <Group justify="center" mt="sm">
              <Button
                variant="default"
                onClick={handleMailboxLoadMore}
                loading={mailboxState.loadingMore}
                disabled={mailboxState.loading}
              >
                Load more
              </Button>
            </Group>
          ) : null}
        </Stack>
      </Modal>

      <Modal
        opened={mailboxState.previewOpen}
        onClose={closeMailboxPreview}
        title="Mailbox email preview"
        fullScreen
        centered
      >
        <Stack gap="sm">
          {mailboxState.previewError ? (
            <Alert color="red" title="Failed to load mailbox email preview">
              {mailboxState.previewError}
            </Alert>
          ) : null}
          {mailboxState.previewLoading ? (
            <Box style={{ minHeight: 120 }}>
              <Loader variant="dots" />
            </Box>
          ) : null}
          {mailboxState.previewData ? (
            <>
              <Stack gap={4}>
                <Text fw={600}>{mailboxState.previewData.subject ?? "No subject"}</Text>
                <Text size="sm" c="dimmed">
                  {mailboxState.previewData.fromAddress ?? "-"}
                </Text>
                <Text size="sm" c="dimmed">
                  {mailboxState.previewData.toAddresses ?? "-"}
                </Text>
                <Text size="sm">
                  {formatDateTime(mailboxState.previewData.receivedAt ?? mailboxState.previewData.internalDate ?? null)}
                </Text>
                <Badge size="sm" variant="light">
                  {(mailboxState.previewData.ingestionStatus ?? "unknown").toUpperCase()}
                </Badge>
              </Stack>
              {mailboxPreviewHtml ? (
                <Box style={{ height: "calc(100vh - 240px)" }}>
                  <iframe
                    title="Mailbox email HTML preview"
                    srcDoc={mailboxPreviewHtml}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                    }}
                  />
                </Box>
              ) : mailboxPreviewBody ? (
                <Paper withBorder radius="md" p="sm" bg="#f8fafc">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {mailboxPreviewBody}
                  </Text>
                </Paper>
              ) : (
                <Alert color="yellow" title="No preview content">
                  No email preview content available.
                </Alert>
              )}
            </>
          ) : null}
        </Stack>
      </Modal>

      <Modal
        opened={mailComposerState.opened}
        onClose={closeMailComposerModal}
        title="Mail sender"
        fullScreen
        centered
      >
        <Stack gap="md" style={{ minHeight: "calc(100vh - 120px)" }}>
          {mailTemplateState.error ? (
            <Alert color="red" title="Template error">
              {mailTemplateState.error}
            </Alert>
          ) : null}
          {mailComposerState.error ? (
            <Alert color="red" title="Failed to send email">
              {mailComposerState.error}
            </Alert>
          ) : null}
          {mailComposerState.success ? (
            <Alert color="green" title="Success">
              {mailComposerState.success}
            </Alert>
          ) : null}

          <Group align="flex-end">
            <Select
              label="Email template"
              placeholder={mailTemplateState.loading ? "Loading templates..." : "Select a template"}
              data={mailTemplateOptions}
              value={mailTemplateState.selectedTemplateId}
              onChange={handleMailTemplateSelection}
              clearable
              searchable
              style={{ flex: 1 }}
              disabled={mailTemplateState.loading || mailComposerState.sending || mailTemplateState.saving}
            />
            <Button
              variant="default"
              onClick={loadMailTemplates}
              loading={mailTemplateState.loading}
              disabled={mailComposerState.sending || mailTemplateState.saving}
            >
              Reload templates
            </Button>
          </Group>

          <Group grow>
            <TextInput
              label="Template name"
              value={mailTemplateState.editorName}
              onChange={handleTemplateNameChange}
              placeholder="Example: Supply order follow-up"
              disabled={mailComposerState.sending || mailTemplateState.loading || mailTemplateState.saving}
            />
            <Select
              label="Template format"
              data={[
                { value: "plain_text", label: "Plain text" },
                { value: "react_email", label: "React Email" },
              ]}
              value={mailTemplateState.editorType}
              onChange={handleTemplateTypeChange}
              disabled={mailComposerState.sending || mailTemplateState.loading || mailTemplateState.saving}
            />
          </Group>

          <TextInput
            label="Template description"
            value={mailTemplateState.editorDescription}
            onChange={handleTemplateDescriptionChange}
            placeholder="Optional description for this template"
            disabled={mailComposerState.sending || mailTemplateState.loading || mailTemplateState.saving}
          />

          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={handleCreateTemplate}
              loading={mailTemplateState.saving}
              disabled={mailComposerState.sending || mailTemplateState.loading}
            >
              Save as new template
            </Button>
            <Button
              variant="light"
              onClick={handleUpdateTemplate}
              loading={mailTemplateState.saving}
              disabled={!hasSelectedMailTemplate || mailComposerState.sending || mailTemplateState.loading}
            >
              Update template
            </Button>
          </Group>

          <Text size="xs" c="dimmed">
            Type {"{{"} in Subject, Body, or React source to open variable suggestions.
          </Text>

          <Divider />

          <TextInput
            label="To"
            value={mailComposerState.to}
            onChange={handleMailToChange}
            onClick={closeMailVariableDropdown}
            placeholder="recipient@example.com"
            required
          />
          <TextInput
            ref={mailSubjectInputRef}
            label="Subject"
            value={mailComposerState.subject}
            onChange={handleMailSubjectChange}
            onClick={(event) => {
              const target = event.currentTarget;
              updateMailVariableDropdownForField("subject", target.value, target.selectionStart ?? target.value.length);
            }}
            onKeyUp={(event) => {
              const target = event.currentTarget;
              updateMailVariableDropdownForField("subject", target.value, target.selectionStart ?? target.value.length);
            }}
            placeholder="Email subject"
            required
          />
          {renderMailVariableDropdown("subject")}
          {isReactTemplateSelected ? (
            <Alert color="blue" title="React Email Live Editor">
              Use the Preview modal to live edit the React Email source and components.
            </Alert>
          ) : (
            <Textarea
              ref={mailBodyInputRef}
              label="Body"
              value={mailComposerState.body}
              onChange={handleMailBodyChange}
              onClick={(event) => {
                const target = event.currentTarget;
                updateMailVariableDropdownForField("body", target.value, target.selectionStart ?? target.value.length);
              }}
              onKeyUp={(event) => {
                const target = event.currentTarget;
                updateMailVariableDropdownForField("body", target.value, target.selectionStart ?? target.value.length);
              }}
              placeholder="Write your message..."
              autosize
              minRows={14}
              maxRows={24}
              required
            />
          )}
          {!isReactTemplateSelected ? renderMailVariableDropdown("body") : null}

          <Group justify="flex-end" mt="auto">
            <Button
              variant="default"
              onClick={closeMailComposerModal}
              disabled={mailComposerState.sending}
            >
              Cancel
            </Button>
            <Button
              variant="light"
              onClick={() => {
                void handlePreviewMail();
              }}
              loading={mailComposerPreviewState.loading}
              disabled={mailComposerState.sending}
            >
              Preview email
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={mailComposerPreviewState.opened}
        onClose={closeMailComposerPreview}
        title="Email preview"
        fullScreen
        centered
      >
        <Stack gap="sm">
          {mailComposerState.error ? (
            <Alert color="red" title="Failed to send email">
              {mailComposerState.error}
            </Alert>
          ) : null}
          {mailComposerState.success ? (
            <Alert color="green" title="Success">
              {mailComposerState.success}
            </Alert>
          ) : null}
          {mailComposerPreviewState.error ? (
            <Alert color="red" title="Failed to render email preview">
              {mailComposerPreviewState.error}
            </Alert>
          ) : null}
          {mailComposerPreviewState.loading ? (
            <Box style={{ minHeight: 120 }}>
              <Loader variant="dots" />
            </Box>
          ) : null}
          {mailComposerPreviewState.refreshing && mailComposerPreviewState.data ? (
            <Text size="xs" c="dimmed">
              Updating preview...
            </Text>
          ) : null}
          {mailComposerPreviewState.data ? (
            <>
              <Stack gap={4}>
                <Text fw={600}>{mailComposerPreviewState.data.subject || "No subject"}</Text>
                <Text size="sm" c="dimmed">
                  {mailComposerPreviewState.data.templateType
                    ? `Template type: ${mailComposerPreviewState.data.templateType}`
                    : "Template type: plain_text"}
                </Text>
              </Stack>
              {isReactTemplateSelected ? (
                <Stack gap="xs">
                  <Textarea
                    ref={mailReactSourceInputRef}
                    label="React Email source (live)"
                    value={mailComposerState.reactLiveSource}
                    onChange={handleMailPreviewBodyChange}
                    onClick={(event) => {
                      const target = event.currentTarget;
                      updateMailVariableDropdownForField("react", target.value, target.selectionStart ?? target.value.length);
                    }}
                    onKeyUp={(event) => {
                      const target = event.currentTarget;
                      updateMailVariableDropdownForField("react", target.value, target.selectionStart ?? target.value.length);
                    }}
                    autosize
                    minRows={16}
                    maxRows={28}
                    disabled={mailComposerState.sending || mailTemplateState.saving}
                  />
                  {renderMailVariableDropdown("react")}
                  <Text size="xs" c="dimmed">
                    You can use React Email components directly (for example `Section`, `Text`, `Button`, `Row`, `Column`, `Img`, `Link`).
                    The source should return JSX.
                  </Text>
                  <Group justify="flex-end">
                    {hasSelectedMailTemplate ? (
                      <Button
                        variant="default"
                        onClick={handleUpdateTemplate}
                        loading={mailTemplateState.saving}
                        disabled={mailComposerPreviewState.loading || mailComposerState.sending}
                      >
                        Save template changes
                      </Button>
                    ) : null}
                    <Button
                      variant="light"
                      onClick={() => {
                        void handlePreviewMail();
                      }}
                      loading={mailComposerPreviewState.loading}
                      disabled={mailComposerState.sending || mailTemplateState.saving}
                    >
                      Refresh now
                    </Button>
                    <Button
                      color="blue"
                      onClick={handleSendMail}
                      loading={mailComposerState.sending}
                      disabled={mailComposerPreviewState.loading || mailComposerPreviewState.refreshing}
                    >
                      Send email
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <Group justify="flex-end">
                  <Button
                    color="blue"
                    onClick={handleSendMail}
                    loading={mailComposerState.sending}
                    disabled={mailComposerPreviewState.loading || mailComposerPreviewState.refreshing}
                  >
                    Send email
                  </Button>
                </Group>
              )}
              {mailComposerDisplayHtml ? (
                <Box style={{ height: "calc(100vh - 240px)" }}>
                  <iframe
                    title="Mail composer preview"
                    srcDoc={mailComposerDisplayHtml}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                    }}
                  />
                </Box>
              ) : mailComposerPreviewBody ? (
                <Paper withBorder radius="md" p="sm" bg="#f8fafc">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {mailComposerPreviewBody}
                  </Text>
                </Paper>
              ) : (
                <Alert color="yellow" title="No preview content">
                  No email preview content available.
                </Alert>
              )}
            </>
          ) : null}
        </Stack>
      </Modal>

    </PageAccessGuard>

  );

};



export default BookingsManifestPage;
