import { type ReactNode, useMemo, useState } from "react";
import {
  Accordion,
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Paper,
  Popover,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowsExchange,
  IconCash,
  IconChartBar,
  IconCreditCardRefund,
  IconInfoCircle,
  IconReceipt2,
  IconTicket,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UnifiedOrder } from "../../store/bookingPlatformsTypes";
import {
  buildBookingsRevenueTrend,
  type BookingsSummaryDateField,
} from "../../utils/bookingsSummaryDate";
import PlatformRevenueComparisonModal from "./PlatformRevenueComparisonModal";

type BookingRawFinancial = {
  bookingId: number;
  platform: string;
  currency: string;
  paymentStatus: string;
  baseAmount: number;
  tipAmount: number;
  addonsAmount: number;
  discountAmount: number;
  refundedAmount: number;
  priceGross: number;
  priceNet: number;
  commissionAmount: number;
  processingFee: number;
  processingFeeCurrency: string | null;
  channelCommissionRate: number | null;
  channelCommissionAmount: number | null;
  baseAmountAfterChannelCommission: number | null;
};

export type BookingAddonDashboardRow = {
  id: number;
  bookingId: number;
  addonId: number | null;
  addonName: string;
  platformAddonId: string | null;
  platformAddonName: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  addonBasePrice?: number | null;
  currency: string | null;
  isIncluded: boolean;
};

export type AddonCatalogPriceRow = {
  id: number;
  name: string;
  basePrice: number;
};

export type BookingCounterInsights = {
  currency: string;
  cashPaymentsTotal: number;
  cashGuestsTotal?: number;
  cashByChannel: Array<{ channelId: number | null; channelName: string; amount: number }>;
  walkInTicketBreakdown?: Array<{ ticketType: string; currency: string; guests: number; amount: number }>;
  cashEntries: Array<{
    counterId: number;
    counterDate: string;
    channelId: number | null;
    channelName: string;
    amount: number;
  }>;
  freeTicketsTotal: number;
  freeTicketEntries: Array<{ counterId: number; counterDate: string; count: number; note: string }>;
};

export type VenueCommissionCurrencyTotal = {
  currency: string;
  receivable: number;
  receivableCollected: number;
  receivableOutstanding: number;
  payable: number;
  payableCollected: number;
  payableOutstanding: number;
};

export type VenueCommissionVenueRow = {
  venueId: number | null;
  venueName: string;
  currency: string;
  receivable: number;
  receivableCollected: number;
  receivableOutstanding: number;
  totalPeople: number;
};

export type BookingCostsSummary = {
  currency: string;
  openBarPayouts: number;
  staffPayments: number;
  miscellaneous: number;
};

type Props = {
  orders: UnifiedOrder[];
  bookingAddons: BookingAddonDashboardRow[];
  addonCatalog?: AddonCatalogPriceRow[];
  counterInsights: BookingCounterInsights | null;
  venueCommissionTotals?: VenueCommissionCurrencyTotal[] | null;
  venueCommissionVenues?: VenueCommissionVenueRow[] | null;
  metricMode?: "earnings" | "revenue" | "costs";
  costsSummary?: BookingCostsSummary | null;
  dateField: BookingsSummaryDateField;
  productTypeIds?: string;
};

const CHART_COLORS = ["#214A66", "#2B7A78", "#345995", "#EF8354", "#B56576", "#6B705C", "#7D4E57", "#3D5A80"];
const EU_COUNTRY_CODES = new Set<string>([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

const normalizePlatformLabel = (value?: string | null): string => {
  const safe = String(value ?? "unknown").trim();
  if (!safe) return "Unknown";
  if (safe.toLowerCase() === "getyourguide") return "GetYourGuide";
  return safe
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
};

const asNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const formatMoneyNumber = (value: number): string => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return safeValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
    useGrouping: true,
  });
};

const formatMoney = (value: number, currency = "PLN"): string => {
  const normalizedCurrency = String(currency ?? "PLN").trim().toUpperCase();
  const displayCurrency = normalizedCurrency === "PLN" ? "z\u0142" : normalizedCurrency;
  return `${formatMoneyNumber(value)} ${displayCurrency}`;
};

const COUNTRY_DISPLAY_NAMES =
  typeof Intl !== "undefined" && typeof Intl.DisplayNames !== "undefined"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

const formatCountryDisplay = (countryCode?: string | null): string => {
  const code = String(countryCode ?? "")
    .trim()
    .toUpperCase();
  if (!code) {
    return "-";
  }
  const label = COUNTRY_DISPLAY_NAMES?.of(code) ?? code;
  return `${label} (${code})`;
};

type CanonicalAddonKey = "cocktails" | "tshirts" | "photos";

const CANONICAL_ADDON_META: Array<{ key: CanonicalAddonKey; label: string }> = [
  { key: "cocktails", label: "Cocktails" },
  { key: "tshirts", label: "T-Shirts" },
  { key: "photos", label: "Photos" },
];

const resolveCanonicalAddonKey = (value?: string | null): CanonicalAddonKey | null => {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[_\s-]+/g, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("cocktail")) {
    return "cocktails";
  }
  if (normalized.includes("tshirt") || normalized.includes("t shirt")) {
    return "tshirts";
  }
  if (normalized.includes("photo")) {
    return "photos";
  }
  return null;
};

type SectionInfoVariable = {
  name: string;
  description: string;
};

type SectionInfoProps = {
  title: string;
  formula: string;
  variables: SectionInfoVariable[];
  notes?: string[];
};

const SectionInfo = ({ title, formula, variables, notes }: SectionInfoProps) => (
  <Popover withArrow width={360} shadow="md" position="bottom-start">
    <Popover.Target>
      <ActionIcon
        size="sm"
        variant="subtle"
        color="gray"
        aria-label={`Information about ${title}`}
        title={`Information about ${title}`}
      >
        <IconInfoCircle size={16} />
      </ActionIcon>
    </Popover.Target>
    <Popover.Dropdown>
      <Stack gap={6}>
        <Text fw={700} size="sm">
          {title}
        </Text>
        <Text size="xs" c="dimmed">
          Formula
        </Text>
        <Text size="sm" ff="monospace">
          {formula}
        </Text>
        <Text size="xs" c="dimmed">
          Variables
        </Text>
        {variables.map((entry) => (
          <Text key={`${title}-${entry.name}`} size="xs">
            <Text span fw={700}>
              {entry.name}
            </Text>
            {`: ${entry.description}`}
          </Text>
        ))}
        {(notes ?? []).map((note, index) => (
          <Text key={`${title}-note-${index}`} size="xs" c="dimmed">
            {note}
          </Text>
        ))}
      </Stack>
    </Popover.Dropdown>
  </Popover>
);

const ChartShell = ({
  title,
  info,
  action,
  children,
}: {
  title: string;
  info?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <Paper withBorder radius="lg" p="md" shadow="sm" style={{ height: "100%" }}>
    <Stack gap="sm" align="center" style={{ height: "100%" }}>
      <Group
        gap="xs"
        align="center"
        justify="center"
        wrap={action ? "wrap" : "nowrap"}
        style={{ minHeight: 30, width: "100%" }}
      >
        <Group
          gap={6}
          align="center"
          justify="center"
          wrap="nowrap"
          style={{ flex: action ? "1 1 180px" : undefined }}
        >
          <Text fw={700} ta="center">
            {title}
          </Text>
          {info}
        </Group>
        {action ? <Box style={{ flex: "0 0 auto" }}>{action}</Box> : null}
      </Group>
      <Box style={{ flex: 1, minHeight: 240, width: "100%" }}>{children}</Box>
    </Stack>
  </Paper>
);

const KpiCard = ({
  icon,
  label,
  info,
  value,
  accent,
  subtitle,
}: {
  icon: ReactNode;
  label: string;
  info?: ReactNode;
  value: ReactNode;
  accent: string;
  subtitle?: ReactNode;
}) => (
  <Paper
    withBorder
    radius="lg"
    p="md"
    shadow="sm"
    style={{
      position: "relative",
      background: `linear-gradient(135deg, ${accent}16 0%, #ffffff 100%)`,
      borderColor: `${accent}66`,
    }}
  >
    <ThemeIcon
      size={40}
      radius="md"
      variant="light"
      color="dark"
      style={{ position: "absolute", top: 16, right: 16 }}
    >
      {icon}
    </ThemeIcon>
    <Stack gap={2}>
      <Group gap={4} align="center" justify="center" wrap="nowrap" style={{ width: "100%" }}>
        <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: 0.5 }}>
          {label}
        </Text>
        {info}
      </Group>
      <Group gap={6} justify="center" wrap="wrap" style={{ width: "100%" }}>
        {typeof value === "string" || typeof value === "number" ? (
          <Text fw={800} size="xl" ta="center" style={{ overflowWrap: "anywhere", lineHeight: 1.2 }}>
            {value}
          </Text>
        ) : (
          <Box style={{ width: "100%" }}>{value}</Box>
        )}
      </Group>
      {subtitle ? <Box>{subtitle}</Box> : null}
    </Stack>
  </Paper>
);

const BookingsExecutiveDashboard = ({
  orders,
  bookingAddons,
  addonCatalog = [],
  counterInsights,
  venueCommissionTotals,
  venueCommissionVenues,
  metricMode = "revenue",
  costsSummary,
  dateField,
  productTypeIds,
}: Props) => {
  const [platformComparisonOpen, setPlatformComparisonOpen] = useState(false);
  const toFinancialRow = useMemo(
    () => (order: UnifiedOrder) => {
      const raw = asRecord(order.rawData);
      const baseAmountValue = asNullableNumber(raw.baseAmount);
      const baseAmount = baseAmountValue ?? 0;
      const baseAmountAfterChannelCommissionValue = asNullableNumber(raw.baseAmountAfterChannelCommission);
      const channelCommissionRateValue = asNullableNumber(raw.channelCommissionRate);
      const channelCommissionAmountValue = asNullableNumber(raw.channelCommissionAmount);
      const tipAmount = asNumber(raw.tipAmount);
      const addonsAmount = asNumber(raw.addonsAmount);
      const discountAmount = asNumber(raw.discountAmount);
      const refundedAmount = asNumber(raw.refundedAmount);
      const derivedGross = Math.max(baseAmount + addonsAmount - discountAmount, 0);
      const priceGross = asNumber(raw.priceGross);
      const grossRevenue = roundMoney(priceGross > 0 ? priceGross : derivedGross);
      const priceNetValue = asNullableNumber(raw.priceNet);
      const priceNet = priceNetValue ?? 0;
      const recognizedBaseWithoutChannelCommission = baseAmountValue ?? priceNetValue ?? 0;
      const recognizedRevenueWithoutChannelCommission = roundMoney(
        Math.max(recognizedBaseWithoutChannelCommission + tipAmount, 0),
      );
      const recognizedBase = baseAmountAfterChannelCommissionValue ?? baseAmountValue ?? priceNetValue ?? 0;
      const recognizedRevenue = roundMoney(Math.max(recognizedBase + tipAmount, 0));
      const commissionAmount = asNumber(raw.commissionAmount);
      const processingFee = Math.max(
        0,
        asNumber(raw.processingFee ?? raw.processing_fee ?? asRecord(order).processingFee ?? asRecord(order).processing_fee),
      );
      const processingFeeCurrencyRaw = String(
        raw.processingFeeCurrency ??
          raw.processing_fee_currency ??
          asRecord(order).processingFeeCurrency ??
          asRecord(order).processing_fee_currency ??
          "",
      )
        .trim()
        .toUpperCase();
      const partySizeTotal = Number.isFinite(order.quantity) ? Math.max(0, Math.round(order.quantity)) : 0;
      const fallbackBreakdownTotal = Math.max(0, (Number(order.menCount) || 0) + (Number(order.womenCount) || 0));
      const participants = partySizeTotal > 0 ? partySizeTotal : fallbackBreakdownTotal;
      const paymentMethodCountryRaw = String(
        raw.paymentMethodCountry ??
          raw.payment_method_country ??
          asRecord(order).paymentMethodCountry ??
          asRecord(order).payment_method_country ??
          "",
      )
        .trim()
        .toUpperCase();
      const paymentMethodCountry =
        paymentMethodCountryRaw.length > 0 ? paymentMethodCountryRaw.slice(0, 5) : "UNKNOWN";

      const financial: BookingRawFinancial = {
        bookingId: Number(order.id) || asNumber(raw.bookingId),
        platform: String(raw.platform ?? order.platform ?? "unknown"),
        currency: String(raw.currency ?? "PLN").toUpperCase(),
        paymentStatus: String(raw.paymentStatus ?? "unknown").toLowerCase(),
        baseAmount: roundMoney(baseAmount),
        tipAmount: roundMoney(tipAmount),
        addonsAmount: roundMoney(addonsAmount),
        discountAmount: roundMoney(discountAmount),
        refundedAmount: roundMoney(refundedAmount),
        priceGross: roundMoney(grossRevenue),
        priceNet: roundMoney(priceNet),
        commissionAmount: roundMoney(commissionAmount),
        processingFee: roundMoney(processingFee),
        processingFeeCurrency: processingFeeCurrencyRaw || null,
        channelCommissionRate: channelCommissionRateValue,
        channelCommissionAmount: channelCommissionAmountValue,
        baseAmountAfterChannelCommission: baseAmountAfterChannelCommissionValue,
      };

      return {
        bookingId: String(financial.bookingId || order.id),
        platform: financial.platform,
        platformLabel: normalizePlatformLabel(financial.platform),
        date: order.date,
        sourceReceivedAt: order.sourceReceivedAt,
        time: order.timeslot,
        productName: order.productName,
        people: participants,
        men: order.menCount,
        women: order.womenCount,
        status: order.status,
        attendanceStatus: String(raw.attendanceStatus ?? order.attendanceStatus ?? "").toLowerCase(),
        attendedTotal: Number.isFinite(Number(raw.attendedTotal ?? order.attendedTotal))
          ? Math.max(0, Math.round(Number(raw.attendedTotal ?? order.attendedTotal)))
          : null,
        remainingTotal: Number.isFinite(Number(raw.remainingTotal ?? order.remainingTotal))
          ? Math.max(0, Math.round(Number(raw.remainingTotal ?? order.remainingTotal)))
          : null,
        paymentStatus: financial.paymentStatus,
        currency: financial.currency,
        grossRevenue: financial.priceGross,
        netRevenue: recognizedRevenue,
        netRevenueNoChannelCommission: recognizedRevenueWithoutChannelCommission,
        refundedAmount: financial.refundedAmount,
        addonsRevenue: financial.addonsAmount,
        baseRevenue: roundMoney(recognizedBase),
        baseRevenueNoChannelCommission: roundMoney(recognizedBaseWithoutChannelCommission),
        tipRevenue: financial.tipAmount,
        commissionAmount: financial.commissionAmount,
        processingFee: financial.processingFee,
        processingFeeCurrency: financial.processingFeeCurrency,
        discountAmount: financial.discountAmount,
        paymentMethodCountry,
      };
    },
    [],
  );

  const bookingFinancialRows = useMemo(() => orders.map((order) => toFinancialRow(order)), [orders, toFinancialRow]);
  const orderIdSet = useMemo(() => {
    const next = new Set<number>();
    bookingFinancialRows.forEach((row) => {
      const id = Number(row.bookingId);
      if (Number.isFinite(id) && id > 0) next.add(id);
    });
    return next;
  }, [bookingFinancialRows]);

  const scopedAddonRows = useMemo(
    () => bookingAddons.filter((row) => orderIdSet.has(Number(row.bookingId))),
    [bookingAddons, orderIdSet],
  );

  const currencies = useMemo(() => {
    const unique = new Set<string>();
    bookingFinancialRows.forEach((row) => {
      if (row.currency) unique.add(row.currency);
    });
    return Array.from(unique.values());
  }, [bookingFinancialRows]);

  const defaultCurrency = currencies[0] ?? "PLN";

  const cashTypeBreakdown = useMemo(() => {
    const walkInRaw = counterInsights?.walkInTicketBreakdown;
    const walkInRows = Array.isArray(walkInRaw) ? walkInRaw : [];
    if (walkInRows.length > 0) {
      return walkInRows
        .map((row) => ({
          name: String(row.ticketType ?? "").trim() || "Walk-in",
          currency: String(row.currency ?? "PLN").toUpperCase(),
          amount: roundMoney(Number(row.amount ?? 0)),
          guests: Math.max(0, Math.round(Number(row.guests ?? 0))),
        }))
        .filter((row) => row.amount > 0)
        .sort(
          (a, b) => b.amount - a.amount || a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency),
        );
    }

    return [...(counterInsights?.cashByChannel ?? [])]
      .map((row) => ({
        name: String(row.channelName ?? "").trim() || "Unknown",
        currency: String(counterInsights?.currency ?? "PLN").toUpperCase(),
        amount: roundMoney(Number(row.amount ?? 0)),
        guests: null as number | null,
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  }, [counterInsights]);

  const cashTotalsByCurrency = useMemo(() => {
    const map = new Map<string, { currency: string; amount: number; guests: number | null }>();
    cashTypeBreakdown.forEach((row) => {
      const currency = String(row.currency || counterInsights?.currency || "PLN").toUpperCase();
      const current = map.get(currency) ?? { currency, amount: 0, guests: 0 };
      current.amount = roundMoney(current.amount + row.amount);
      current.guests =
        current.guests === null || row.guests === null
          ? null
          : Math.max(0, current.guests + row.guests);
      map.set(currency, current);
    });

    if (map.size === 0 && (counterInsights?.cashPaymentsTotal ?? 0) > 0) {
      const currency = String(counterInsights?.currency ?? defaultCurrency).toUpperCase();
      map.set(currency, {
        currency,
        amount: roundMoney(counterInsights?.cashPaymentsTotal ?? 0),
        guests: Math.max(0, Math.round(counterInsights?.cashGuestsTotal ?? 0)),
      });
    }

    const primaryCurrency = String(counterInsights?.currency ?? defaultCurrency).toUpperCase();
    return Array.from(map.values()).sort(
      (a, b) =>
        Number(b.currency === primaryCurrency) - Number(a.currency === primaryCurrency) ||
        b.amount - a.amount ||
        a.currency.localeCompare(b.currency),
      );
  }, [cashTypeBreakdown, counterInsights, defaultCurrency]);
  const cashBreakdownGuests = cashTotalsByCurrency.reduce((acc, row) => acc + (row.guests ?? 0), 0);
  const cashGuestsForDisplay =
    (counterInsights?.cashGuestsTotal ?? 0) > 0 ? counterInsights?.cashGuestsTotal ?? 0 : cashBreakdownGuests;

  const totalRevenueAfterChannelCommission = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + row.netRevenue, 0)),
    [bookingFinancialRows],
  );
  const totalCashPayments = useMemo(
    () => roundMoney(cashTotalsByCurrency.find((row) => row.currency === defaultCurrency)?.amount ?? 0),
    [cashTotalsByCurrency, defaultCurrency],
  );
  const totalProcessingFees = useMemo(
    () =>
      roundMoney(
        bookingFinancialRows.reduce((acc, row) => {
          const fee = Number(row.processingFee ?? 0);
          return acc + (Number.isFinite(fee) ? Math.max(0, fee) : 0);
        }, 0),
      ),
    [bookingFinancialRows],
  );
  const totalTips = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + Number(row.tipRevenue ?? 0), 0)),
    [bookingFinancialRows],
  );
  const totalDiscounts = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + Number(row.discountAmount ?? 0), 0)),
    [bookingFinancialRows],
  );
  const totalRefunds = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + Number(row.refundedAmount ?? 0), 0)),
    [bookingFinancialRows],
  );
  const totalOnlineRevenue = useMemo(
    () => roundMoney(Math.max(totalRevenueAfterChannelCommission - totalProcessingFees, 0)),
    [totalRevenueAfterChannelCommission, totalProcessingFees],
  );
  const addonCatalogUnitPriceByKey = useMemo(() => {
    const map = new Map<CanonicalAddonKey, number>();
    addonCatalog.forEach((row) => {
      const key = resolveCanonicalAddonKey(row.name);
      if (!key) {
        return;
      }
      const basePrice = asNumber(row.basePrice);
      if (basePrice <= 0) {
        return;
      }
      const existing = map.get(key) ?? 0;
      if (existing <= 0) {
        map.set(key, roundMoney(basePrice));
      }
    });

    scopedAddonRows.forEach((row) => {
      const key = resolveCanonicalAddonKey(row.addonName) ?? resolveCanonicalAddonKey(row.platformAddonName);
      if (!key) {
        return;
      }
      const catalogPrice = asNumber(row.addonBasePrice);
      const unitPrice = asNumber(row.unitPrice);
      const totalPrice = asNumber(row.totalPrice);
      const quantity = Math.max(0, Number(row.quantity) || 0);
      const derivedUnitFromTotal = quantity > 0 && totalPrice > 0 ? roundMoney(totalPrice / quantity) : 0;
      const candidate = catalogPrice > 0 ? catalogPrice : unitPrice > 0 ? unitPrice : derivedUnitFromTotal > 0 ? derivedUnitFromTotal : 0;
      if (candidate <= 0) {
        return;
      }
      const existing = map.get(key) ?? 0;
      if (existing <= 0) {
        map.set(key, roundMoney(candidate));
      }
    });
    return map;
  }, [addonCatalog, scopedAddonRows]);
  const addonKpiRows = useMemo(() => {
    const buckets: Record<CanonicalAddonKey, { label: string; quantity: number; revenue: number; unitPrice: number }> = {
      cocktails: { label: "Cocktails", quantity: 0, revenue: 0, unitPrice: addonCatalogUnitPriceByKey.get("cocktails") ?? 0 },
      tshirts: { label: "T-Shirts", quantity: 0, revenue: 0, unitPrice: addonCatalogUnitPriceByKey.get("tshirts") ?? 0 },
      photos: { label: "Photos", quantity: 0, revenue: 0, unitPrice: addonCatalogUnitPriceByKey.get("photos") ?? 0 },
    };

    const rowsByBooking = new Map<string, BookingAddonDashboardRow[]>();
    scopedAddonRows.forEach((row) => {
      const key = String(row.bookingId);
      const list = rowsByBooking.get(key) ?? [];
      list.push(row);
      rowsByBooking.set(key, list);
    });

    orders.forEach((order) => {
      const snapshot = order.extras ?? { cocktails: 0, tshirts: 0, photos: 0 };
      const snapshotQty = {
        cocktails: Math.max(0, Number(snapshot.cocktails) || 0),
        tshirts: Math.max(0, Number(snapshot.tshirts) || 0),
        photos: Math.max(0, Number(snapshot.photos) || 0),
      };
      const snapshotHasValues = snapshotQty.cocktails + snapshotQty.tshirts + snapshotQty.photos > 0;
      if (snapshotHasValues) {
        const rawAddonsAmount = roundMoney(Math.max(0, asNumber(asRecord(order.rawData).addonsAmount)));
        const snapshotKeys = (Object.keys(snapshotQty) as CanonicalAddonKey[]).filter((key) => snapshotQty[key] > 0);
        const knownKeys = snapshotKeys.filter((key) => buckets[key].unitPrice > 0);
        const unknownKeys = snapshotKeys.filter((key) => buckets[key].unitPrice <= 0);

        if (rawAddonsAmount > 0 && unknownKeys.length > 0) {
          const knownAmount = knownKeys.reduce((acc, key) => acc + snapshotQty[key] * buckets[key].unitPrice, 0);
          const remainingAmount = roundMoney(Math.max(rawAddonsAmount - knownAmount, 0));
          const unknownQtyTotal = unknownKeys.reduce((acc, key) => acc + snapshotQty[key], 0);
          if (remainingAmount > 0 && unknownQtyTotal > 0) {
            const inferredUnit = roundMoney(remainingAmount / unknownQtyTotal);
            if (inferredUnit > 0) {
              unknownKeys.forEach((key) => {
                if (buckets[key].unitPrice <= 0) {
                  buckets[key].unitPrice = inferredUnit;
                }
              });
            }
          }
        }

        (Object.keys(snapshotQty) as CanonicalAddonKey[]).forEach((key) => {
          const quantity = snapshotQty[key];
          if (quantity <= 0) {
            return;
          }
          const unitPrice = buckets[key].unitPrice;
          buckets[key].quantity += quantity;
          buckets[key].revenue += quantity * unitPrice;
        });
        return;
      }

      const bookingRows = rowsByBooking.get(String(order.id)) ?? [];
      bookingRows.forEach((row) => {
        const key = resolveCanonicalAddonKey(row.addonName) ?? resolveCanonicalAddonKey(row.platformAddonName);
        if (!key) {
          return;
        }
        const quantity = Math.max(0, Number(row.quantity) || 0);
        if (quantity <= 0) {
          return;
        }
        const catalogPrice = asNumber(row.addonBasePrice);
        const rowUnitPrice = asNumber(row.unitPrice);
        const unitPrice = catalogPrice > 0 ? catalogPrice : rowUnitPrice > 0 ? rowUnitPrice : buckets[key].unitPrice;
        const explicitTotal = asNumber(row.totalPrice);
        const revenue = explicitTotal > 0 ? explicitTotal : quantity * unitPrice;
        buckets[key].unitPrice = unitPrice > 0 ? unitPrice : buckets[key].unitPrice;
        buckets[key].quantity += quantity;
        buckets[key].revenue += revenue;
      });
    });

    return CANONICAL_ADDON_META.map((meta) => ({
      key: meta.key,
      label: meta.label,
      quantity: Math.max(0, Math.round(buckets[meta.key].quantity)),
      revenue: roundMoney(buckets[meta.key].revenue),
      unitPrice: roundMoney(buckets[meta.key].unitPrice),
    }));
  }, [addonCatalogUnitPriceByKey, orders, scopedAddonRows]);
  const totalAddonsRevenue = useMemo(
    () => roundMoney(addonKpiRows.reduce((acc, row) => acc + row.revenue, 0)),
    [addonKpiRows],
  );
  const totalPeople = useMemo(() => bookingFinancialRows.reduce((acc, row) => acc + row.people, 0), [bookingFinancialRows]);
  const totalBookings = bookingFinancialRows.length;
  const noShowSummary = useMemo(() => {
    return bookingFinancialRows.reduce(
      (acc, row) => {
        const isNoShow = row.attendanceStatus === "no_show" || String(row.status).toLowerCase() === "no_show";
        if (isNoShow) {
          acc.fullBookings += 1;
          acc.fullGuests += Math.max(0, Number(row.people) || 0);
          return acc;
        }

        if (row.attendanceStatus === "checked_in_partial") {
          const people = Math.max(0, Number(row.people) || 0);
          const remaining = row.remainingTotal;
          const attended = row.attendedTotal;
          const partialMissed =
            Number.isFinite(Number(remaining)) && Number(remaining) >= 0
              ? Math.min(people, Number(remaining))
              : Number.isFinite(Number(attended))
                ? Math.max(people - Number(attended), 0)
                : 0;
          if (partialMissed > 0) {
            acc.partialBookings += 1;
            acc.partialGuests += partialMissed;
          }
        }
        return acc;
      },
      { fullBookings: 0, fullGuests: 0, partialBookings: 0, partialGuests: 0 },
    );
  }, [bookingFinancialRows]);
  const averageGuestsPerBooking = useMemo(
    () => (totalBookings > 0 ? roundMoney(totalPeople / totalBookings) : 0),
    [totalBookings, totalPeople],
  );
  const averageBookingValue = totalBookings > 0 ? roundMoney(totalOnlineRevenue / totalBookings) : 0;
  const venueCommissionByCurrency = useMemo(() => {
    return (venueCommissionTotals ?? []).map((row) => ({
      currency: String(row.currency ?? "PLN").toUpperCase(),
      receivable: roundMoney(asNumber(row.receivable)),
      receivableCollected: roundMoney(asNumber(row.receivableCollected)),
      receivableOutstanding: roundMoney(asNumber(row.receivableOutstanding)),
    }));
  }, [venueCommissionTotals]);
  const venueCommissionSelected = useMemo(() => {
    if (venueCommissionByCurrency.length === 0) {
      return null;
    }
    const byDefaultCurrency = venueCommissionByCurrency.find((row) => row.currency === defaultCurrency);
    return byDefaultCurrency ?? venueCommissionByCurrency[0];
  }, [defaultCurrency, venueCommissionByCurrency]);
  const venueCommissionTotal = venueCommissionSelected?.receivable ?? 0;
  const venueCommissionCurrency = venueCommissionSelected?.currency ?? defaultCurrency;
  const venueCommissionCollected = venueCommissionSelected?.receivableCollected ?? 0;
  const venueCommissionOutstanding = venueCommissionSelected?.receivableOutstanding ?? 0;
  const topVenueCommissionRows = useMemo(
    () =>
      (venueCommissionVenues ?? [])
        .filter((row) => String(row.currency ?? "").toUpperCase() === venueCommissionCurrency)
        .sort((a, b) => Number(b.receivable ?? 0) - Number(a.receivable ?? 0))
        .slice(0, 5),
    [venueCommissionCurrency, venueCommissionVenues],
  );
  const totalRevenueCard = useMemo(
    () => roundMoney(totalOnlineRevenue + venueCommissionTotal + totalCashPayments),
    [totalOnlineRevenue, venueCommissionTotal, totalCashPayments],
  );
  const totalRevenueMixData = useMemo(
    () => [
      { key: "online", name: "Online", value: roundMoney(totalOnlineRevenue), color: "#214A66" },
      { key: "venue", name: "Venue", value: roundMoney(venueCommissionTotal), color: "#2B7A78" },
      { key: "cash", name: "Cash", value: roundMoney(totalCashPayments), color: "#6B705C" },
    ],
    [totalOnlineRevenue, venueCommissionTotal, totalCashPayments],
  );
  const paymentCountryBreakdown = useMemo(() => {
    const map = new Map<string, { country: string; bookings: number; guests: number; revenue: number }>();
    bookingFinancialRows.forEach((row) => {
      const countryRaw = String(row.paymentMethodCountry ?? "").trim().toUpperCase();
      const country = countryRaw && countryRaw !== "NULL" ? countryRaw : "UNKNOWN";
      const bucket = map.get(country) ?? { country, bookings: 0, guests: 0, revenue: 0 };
      bucket.bookings += 1;
      bucket.guests += Math.max(0, Number(row.people) || 0);
      bucket.revenue += (Number(row.netRevenue) || 0) - (Number(row.processingFee) || 0);
      map.set(country, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        revenue: roundMoney(row.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings || b.guests - a.guests);
  }, [bookingFinancialRows]);
  const visiblePaymentCountryBreakdown = useMemo(
    () => paymentCountryBreakdown.filter((row) => row.country !== "UNKNOWN"),
    [paymentCountryBreakdown],
  );
  const paymentCountryKnownCount = visiblePaymentCountryBreakdown.length;
  const paymentCountryKnownBookings = useMemo(
    () => visiblePaymentCountryBreakdown.reduce((acc, row) => acc + row.bookings, 0),
    [visiblePaymentCountryBreakdown],
  );
  const taxationAreaBreakdown = useMemo(() => {
    const euRows = visiblePaymentCountryBreakdown.filter((row) => EU_COUNTRY_CODES.has(row.country));
    const nonEuRows = visiblePaymentCountryBreakdown.filter((row) => !EU_COUNTRY_CODES.has(row.country));
    const euRevenue = roundMoney(euRows.reduce((acc, row) => acc + (Number(row.revenue) || 0), 0));
    const nonEuRevenue = roundMoney(nonEuRows.reduce((acc, row) => acc + (Number(row.revenue) || 0), 0));
    return { euRows, nonEuRows, euRevenue, nonEuRevenue };
  }, [visiblePaymentCountryBreakdown]);

  const dailyTrend = useMemo(
    () => buildBookingsRevenueTrend(bookingFinancialRows, dateField),
    [bookingFinancialRows, dateField],
  );

  const platformRevenue = useMemo(() => {
    const map = new Map<string, { platform: string; revenue: number; bookings: number; people: number }>();
    bookingFinancialRows.forEach((row) => {
      const key = row.platformLabel;
      const bucket = map.get(key) ?? { platform: key, revenue: 0, bookings: 0, people: 0 };
      bucket.revenue += row.netRevenue - Math.max(0, Number(row.processingFee) || 0);
      bucket.bookings += 1;
      bucket.people += row.people;
      map.set(key, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({ ...row, revenue: roundMoney(row.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [bookingFinancialRows]);

  const platformRevenueTotal = totalOnlineRevenue;

  const productPerformance = useMemo(() => {
    const map = new Map<
      string,
      { productName: string; bookings: number; people: number; revenue: number; refunds: number }
    >();
    bookingFinancialRows.forEach((row) => {
      const key = row.productName || "Unknown";
      const bucket =
        map.get(key) ?? { productName: key, bookings: 0, people: 0, revenue: 0, refunds: 0 };
      bucket.bookings += 1;
      bucket.people += row.people;
      bucket.revenue += row.netRevenue - Math.max(0, Number(row.processingFee) || 0);
      bucket.refunds += row.refundedAmount;
      map.set(key, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        revenue: roundMoney(row.revenue),
        refunds: roundMoney(row.refunds),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [bookingFinancialRows]);

  const bestDay = dailyTrend.reduce<{ date: string; revenue: number } | null>((best, row) => {
    if (!best || row.revenue > best.revenue) return { date: row.date, revenue: row.revenue };
    return best;
  }, null);
  const topPlatform = platformRevenue[0] ?? null;
  const topProduct = productPerformance[0] ?? null;

  if (orders.length === 0) {
    return (
      <Alert color="blue" title="No bookings">
        No bookings found for the selected range.
      </Alert>
    );
  }

  const summaryCurrency = costsSummary?.currency ?? defaultCurrency;
  const openBarPayouts = roundMoney(costsSummary?.openBarPayouts ?? 0);
  const staffPayments = roundMoney(costsSummary?.staffPayments ?? 0);
  const miscellaneous = roundMoney(costsSummary?.miscellaneous ?? 3400);
  const totalCosts = roundMoney(openBarPayouts + staffPayments + miscellaneous);
  const totalEarnings = roundMoney(totalRevenueCard - totalCosts);

  if (metricMode === "earnings") {
    return (
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 1, lg: 1 }} spacing="md">
          <KpiCard
            icon={<IconReceipt2 size={20} />}
            label="Total Earnings"
            value={formatMoney(totalEarnings, summaryCurrency)}
            subtitle="Total Revenue - Total Costs"
            accent="#214A66"
          />
        </SimpleGrid>
      </Stack>
    );
  }

  if (metricMode === "costs") {
    
    return (
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          <KpiCard
            icon={<IconReceipt2 size={20} />}
            label="Total Costs"
            value={formatMoney(totalCosts, summaryCurrency)}
            subtitle="Open bar + Staff payments + Miscellaneous"
            accent="#214A66"
          />
          <KpiCard
            icon={<IconTicket size={20} />}
            label="Open bar"
            value={formatMoney(openBarPayouts, summaryCurrency)}
            subtitle="Venue Numbers open bar payouts"
            accent="#2B7A78"
          />
          <KpiCard
            icon={<IconUsersGroup size={20} />}
            label="Staff Payments"
            value={formatMoney(staffPayments, summaryCurrency)}
            subtitle="Pays: New earnings"
            accent="#345995"
          />
          <KpiCard
            icon={<IconCash size={20} />}
            label="Miscellaneous"
            value={formatMoney(miscellaneous, summaryCurrency)}
            subtitle="Flat value (temporary)"
            accent="#6B705C"
          />
        </SimpleGrid>
      </Stack>
    );
  }

  if (metricMode !== "revenue") {
    return (
      <Alert color="blue" title={`${metricMode === "earnings" ? "Earnings" : "Costs"} view`}>
        Current KPI cards and charts are revenue-based.
      </Alert>
    );
  }

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <KpiCard
          icon={<IconReceipt2 size={20} />}
          label="Total Revenue"
          info={
            <SectionInfo
              title="Total Revenue"
              formula="Total Revenue = Online Revenue + Venue Commission + Cash Payments"
              variables={[
                {
                  name: "Online Revenue",
                  description: "Base Amount after Channel Commission + Tip Amount - Processing Fees.",
                },
                { name: "Venue Commission", description: "Commission owed by venues for the selected range." },
                { name: "Cash Payments", description: "Counter cash metrics marked as cash payment." },
              ]}
            />
          }
          value={formatMoney(totalRevenueCard, defaultCurrency)}
          subtitle={
            <Stack gap={6}>
              <Box h={90}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={totalRevenueMixData} dataKey="value" nameKey="name" innerRadius={20} outerRadius={34}>
                      {totalRevenueMixData.map((entry) => (
                        <Cell key={`total-revenue-mix-${entry.key}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: number) => formatMoney(Number(value), defaultCurrency)}
                      labelFormatter={(label: string) => label}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
              <Group gap="xs" wrap="wrap" justify="center">
                {totalRevenueMixData.map((entry) => (
                  <Group key={`total-revenue-legend-${entry.key}`} gap={4} wrap="nowrap">
                    <Box
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: entry.color,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="xs" c="dimmed">
                      <Text span fw={800}>{entry.name}</Text>
                      {`: ${formatMoney(entry.value, defaultCurrency)}`}
                    </Text>
                  </Group>
                ))}
              </Group>
            </Stack>
          }
          accent="#214A66"
        />
        <KpiCard
          icon={<IconChartBar size={20} />}
          label="Online Revenue"
          info={
            <SectionInfo
              title="Online Revenue"
              formula="Online Revenue = Base Amount + Tip Amount - Processing Fees"
              variables={[
                {
                  name: "Base Amount",
                  description:
                    "Website Price - Discounts - Platform Commission - Partial Refunds",
                },
                { name: "Tip Amount", description: "Tip collected for the booking." },
                { name: "Processing Fees", description: "Payment processing fees captured per booking." },
              ]}
              notes={[
                "If base amount is missing, the dashboard falls back to Price Net for that row.",
              ]}
            />
          }
          value={formatMoney(totalOnlineRevenue, defaultCurrency)}
          subtitle={
            <Stack gap={4}>
              <Text size="xs" c="dimmed" ta="center">
                {`Avg booking: ${formatMoney(averageBookingValue, defaultCurrency)}`}
              </Text>
              <Text size="xs" fw={700} mt={8} ta="center" td="underline">
                Breakdown
              </Text>
              <Stack gap={2}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Discounts
                  </Text>
                  <Text size="xs" fw={700}>
                    {formatMoney(totalDiscounts, defaultCurrency)}
                  </Text>
                </Group>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Tips
                  </Text>
                  <Text size="xs" fw={700}>
                    {formatMoney(totalTips, defaultCurrency)}
                  </Text>
                </Group>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Refunds
                  </Text>
                  <Text size="xs" fw={700}>
                    {formatMoney(totalRefunds, defaultCurrency)}
                  </Text>
                </Group>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Processing Fees (Stripe)
                  </Text>
                  <Text size="xs" fw={700}>
                    {formatMoney(totalProcessingFees, defaultCurrency)}
                  </Text>
                </Group>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Platform Commission
                  </Text>
                  <Group gap={4} wrap="nowrap">
                    <Text size="xs" fw={700}>
                      No data available
                    </Text>
                    <Popover withArrow width={250} shadow="md" position="bottom-end">
                      <Popover.Target>
                        <ActionIcon variant="subtle" size="xs" color="gray" aria-label="Platform commission note">
                          <IconInfoCircle size={12} />
                        </ActionIcon>
                      </Popover.Target>
                      <Popover.Dropdown>
                        <Text size="xs">Commission removed before Omni-Lodge ingestion</Text>
                      </Popover.Dropdown>
                    </Popover>
                  </Group>
                </Group>
              </Stack>
            </Stack>
          }
          accent="#214A66"
        />
        <KpiCard
          icon={<IconCreditCardRefund size={20} />}
          label="Venue Commission"
          value={formatMoney(venueCommissionTotal, venueCommissionCurrency)}
          subtitle={
            <SimpleGrid cols={2} spacing={6} mt={8}>
              <Stack gap={4} pr="xs" style={{ borderRight: "1px solid rgba(0,0,0,0.08)" }}>
                <Text size="xs" fw={700} ta="center" td="underline">
                  Top 5 Venues
                </Text>
                {topVenueCommissionRows.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    No venue commission data
                  </Text>
                ) : (
                  topVenueCommissionRows.map((row) => (
                    <Group key={`venue-commission-top-${row.venueId ?? row.venueName}`} justify="space-between" gap="xs" wrap="nowrap">
                      <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
                        <Text size="xs" c="dimmed" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.venueName}
                        </Text>
                        <Popover withArrow width={170} shadow="md" position="bottom-start">
                          <Popover.Target>
                            <ActionIcon variant="subtle" size="xs" color="gray" aria-label={`Guests for ${row.venueName}`}>
                              <IconInfoCircle size={12} />
                            </ActionIcon>
                          </Popover.Target>
                          <Popover.Dropdown>
                            <Text size="xs" ta="center" fw={700}>
                              {`${Math.max(0, Number(row.totalPeople ?? 0)).toLocaleString()} Guests`}
                            </Text>
                          </Popover.Dropdown>
                        </Popover>
                      </Group>
                      <Text size="xs" fw={700}>
                        {formatMoney(row.receivable, venueCommissionCurrency)}
                      </Text>
                    </Group>
                  ))
                )}
              </Stack>
              <Stack gap={6} pl="xs">
                <Text size="xs" fw={700} ta="center" td="underline">
                  Status
                </Text>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Collected
                  </Text>
                  <Text size="xs" fw={700} style={{ whiteSpace: "nowrap" }}>
                    {formatMoney(venueCommissionCollected, venueCommissionCurrency)}
                  </Text>
                </Group>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Outstanding
                  </Text>
                  <Text size="xs" fw={700} style={{ whiteSpace: "nowrap" }}>
                    {formatMoney(venueCommissionOutstanding, venueCommissionCurrency)}
                  </Text>
                </Group>
              </Stack>
            </SimpleGrid>
          }
          accent="#2B7A78"
        />
        <KpiCard
          icon={<IconCash size={20} />}
          label="Cash Tickets"
          value={
            <Stack gap={4} align="center" style={{ width: "100%" }}>
              <Text fw={800} size="xl" ta="center" style={{ lineHeight: 1.15 }}>
                {`${cashGuestsForDisplay.toLocaleString()} Guests`}
              </Text>
              {cashTotalsByCurrency.length > 0 ? (
                cashTotalsByCurrency.map((row) => (
                  <Group key={`cash-total-${row.currency}`} gap={6} justify="center" wrap="nowrap">
                    <Text size="xs" c="dimmed" fw={800} tt="uppercase">
                      {row.currency}
                    </Text>
                    <Text fw={800} size="md" ta="center" style={{ lineHeight: 1.15 }}>
                      {formatMoney(row.amount, row.currency)}
                    </Text>
                  </Group>
                ))
              ) : (
                <Group gap={6} justify="center" wrap="nowrap">
                  <Text size="xs" c="dimmed" fw={800} tt="uppercase">
                    {counterInsights?.currency ?? defaultCurrency}
                  </Text>
                  <Text fw={800} size="md" ta="center" style={{ lineHeight: 1.15 }}>
                    {formatMoney(0, counterInsights?.currency ?? defaultCurrency)}
                  </Text>
                </Group>
              )}
            </Stack>
          }
          subtitle={
            <Stack gap={6} mt={4}>
              <Text size="xs" fw={700} td="underline" ta="center">
                Breakdown
              </Text>
              {cashTypeBreakdown.length === 0 ? (
                <Text size="xs" c="dimmed">
                  No cash ticket breakdown available
                </Text>
              ) : (
                cashTypeBreakdown.map((row) => (
                  <Group key={`cash-breakdown-${row.name}`} justify="space-between" gap="xs" wrap="nowrap">
                    <Text size="xs" c="dimmed" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.guests !== null
                        ? `${row.name} (${row.currency}): ${row.guests.toLocaleString()} Guests`
                        : row.name}
                    </Text>
                    <Text size="xs" fw={700}>
                      {formatMoney(row.amount, row.currency)}
                    </Text>
                  </Group>
                ))
              )}
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {`Free Tickets: ${(counterInsights?.freeTicketsTotal ?? 0).toLocaleString()} Guests`}
                </Text>
                <Text size="xs" fw={700}>
                  {formatMoney(0, counterInsights?.currency ?? "PLN")}
                </Text>
              </Group>
            </Stack>
          }
          accent="#6B705C"
        />
        <KpiCard
          icon={<IconUsersGroup size={20} />}
          label="Bookings & Guests"
          value={
            <Group gap={4} justify="center" wrap="nowrap">
              <Text span fw={800} size="xl">
                {`${totalPeople.toLocaleString()} Guests`}
              </Text>
              <Popover withArrow width={210} shadow="md" position="bottom">
                <Popover.Target>
                  <ActionIcon variant="subtle" size="sm" color="gray" aria-label="Guests including cash walk-ins">
                    <IconInfoCircle size={14} />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown>
                  <Text size="xs" ta="center" fw={700}>
                    {`${(totalPeople + (counterInsights?.cashGuestsTotal ?? 0)).toLocaleString()} guests if we include cash walk-ins`}
                  </Text>
                </Popover.Dropdown>
              </Popover>
            </Group>
          }
          subtitle={
            <Stack gap={6} mt={2}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  Bookings
                </Text>
                <Text size="xs" fw={700}>
                  {totalBookings.toLocaleString()}
                </Text>
              </Group>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  Avg. Guests per Booking
                </Text>
                <Text size="xs" fw={700}>
                  {averageGuestsPerBooking.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </Group>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Full No-Show
                  </Text>
                  <Popover withArrow width={220} shadow="md" position="bottom-start">
                    <Popover.Target>
                      <ActionIcon variant="subtle" size="xs" color="gray" aria-label="Full no-show definition">
                        <IconInfoCircle size={12} />
                      </ActionIcon>
                    </Popover.Target>
                    <Popover.Dropdown>
                      <Text size="xs" ta="center" fw={700}>
                        The full booking didn't show up
                      </Text>
                    </Popover.Dropdown>
                  </Popover>
                </Group>
                <Text size="xs" fw={700}>
                  {`${noShowSummary.fullGuests.toLocaleString()} Guests (${noShowSummary.fullBookings.toLocaleString()} bookings)`}
                </Text>
              </Group>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    Partial No-Show
                  </Text>
                  <Popover withArrow width={260} shadow="md" position="bottom-start">
                    <Popover.Target>
                      <ActionIcon variant="subtle" size="xs" color="gray" aria-label="Partial no-show definition">
                        <IconInfoCircle size={12} />
                      </ActionIcon>
                    </Popover.Target>
                    <Popover.Dropdown>
                      <Text size="xs" ta="center" fw={700}>
                        The booking showed up with some of the participants, not all of them.
                      </Text>
                    </Popover.Dropdown>
                  </Popover>
                </Group>
                <Text size="xs" fw={700}>
                  {`${noShowSummary.partialGuests.toLocaleString()} Guests (${noShowSummary.partialBookings.toLocaleString()} bookings)`}
                </Text>
              </Group>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  Total No-Show
                </Text>
                <Text size="xs" fw={700}>
                  {`${(noShowSummary.fullGuests + noShowSummary.partialGuests).toLocaleString()} Guests (${(noShowSummary.fullBookings + noShowSummary.partialBookings).toLocaleString()} bookings)`}
                </Text>
              </Group>
            </Stack>
          }
          accent="#345995"
        />
        <KpiCard
          icon={<IconTicket size={20} />}
          label="Add-Ons"
          value={formatMoney(totalAddonsRevenue, defaultCurrency)}
          subtitle={
            <Stack gap={4}>
              <Text size="xs" fw={700} td="underline" ta="center">
                Breakdown
              </Text>
              {addonKpiRows.every((row) => row.quantity <= 0) ? (
                <Text size="xs" c="dimmed">
                  No add-ons sold
                </Text>
              ) : (
                addonKpiRows.map((row) => (
                  <Group key={`addon-kpi-${row.key}`} justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="xs" c="dimmed" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.label}
                    </Text>
                    <Text size="xs" fw={700}>
                      {`${row.quantity.toLocaleString()} qty - ${formatMoney(row.revenue, defaultCurrency)}`}
                    </Text>
                  </Group>
                ))
              )}
            </Stack>
          }
          accent="#B56576"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <Box style={{ gridColumn: "span 2" }}>
          <ChartShell
            title={`Revenue trend by ${
              dateField === "source_received_at" ? "Source Received At" : "Experience Date"
            } (online revenue, bookings/day)`}
            info={
              <SectionInfo
                title="Revenue Trend"
                formula="Daily Revenue = Sum(Base + Tip - Processing Fees)"
                variables={[
                  { name: "Base", description: "Per-booking base amount." },
                  { name: "Tip", description: "Per-booking tip amount." },
                  { name: "Processing Fees", description: "Payment processing fees captured per booking." },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis yAxisId="money" />
                <YAxis yAxisId="count" orientation="right" />
                <RechartsTooltip
                  formatter={(value: number, name: string) =>
                    name === "bookings" ? [value, "Bookings"] : [formatMoney(Number(value), defaultCurrency), name]
                  }
                />
                <Legend />
                <Area
                  yAxisId="money"
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#214A66"
                  fill="#214A6633"
                />
                <Line yAxisId="count" type="monotone" dataKey="bookings" name="bookings" stroke="#EF8354" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartShell>
        </Box>

        <ChartShell
          title="Platform Revenue Share"
          action={
            <Button
              size="xs"
              variant="light"
              leftSection={<IconArrowsExchange size={15} />}
              onClick={() => setPlatformComparisonOpen(true)}
            >
              Compare
            </Button>
          }
          info={
            <SectionInfo
              title="Platform Revenue Share"
              formula="Platform Revenue = Sum(Base + Tip - Processing Fees) grouped by platform"
              variables={[
                { name: "Platform", description: "Normalized booking platform label." },
                { name: "Revenue", description: "Base plus tip minus processing fees summed per platform." },
              ]}
            />
          }
        >
          <Stack gap="sm" h="100%" align="center">
            <Stack gap={4} align="center" style={{ width: "100%" }}>
              <Stack gap={0} align="center">
                <Text size="xs" c="dimmed" tt="uppercase" fw={800}>
                  TOTAL
                </Text>
                <Text fw={900} fz="xl" ta="center">
                  {formatMoney(platformRevenueTotal, defaultCurrency)}
                </Text>
              </Stack>
            </Stack>
            <ScrollArea h={230} w="100%">
              <Stack gap="xs" align="center">
                {platformRevenue.map((row, index) => {
                  const share = platformRevenueTotal > 0 ? (row.revenue / platformRevenueTotal) * 100 : 0;
                  const color = CHART_COLORS[index % CHART_COLORS.length];
                  return (
                    <Paper key={`platform-share-${row.platform}`} withBorder radius="md" p="sm" style={{ width: "100%" }}>
                      <Stack gap={6} align="center">
                        <Stack gap={4} align="center" style={{ width: "100%" }}>
                          <Group gap="xs" justify="center" wrap="nowrap">
                            <Box
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: 999,
                                background: color,
                                flexShrink: 0,
                              }}
                            />
                            <Text fw={800} ta="center" lineClamp={1}>
                              {row.platform}
                            </Text>
                          </Group>
                          <Stack gap={0} align="center">
                            <Text fw={900} ta="center">
                              {formatMoney(row.revenue, defaultCurrency)}
                            </Text>
                            <Text size="xs" c="dimmed" fw={800}>
                              {`${share.toFixed(1)}%`}
                            </Text>
                          </Stack>
                        </Stack>
                        <Box
                          aria-hidden
                          style={{
                            height: 8,
                            width: "100%",
                            borderRadius: 999,
                            overflow: "hidden",
                            background: "#edf2f7",
                          }}
                        >
                          <Box
                            style={{
                              width: `${Math.min(100, Math.max(0, share))}%`,
                              height: "100%",
                              borderRadius: 999,
                              background: color,
                            }}
                          />
                        </Box>
                        <Group justify="center" gap="lg" wrap="wrap">
                          <Text size="xs" c="dimmed">
                            {`${row.bookings.toLocaleString()} Bookings`}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {`${row.people.toLocaleString()} Guests`}
                          </Text>
                        </Group>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            </ScrollArea>
          </Stack>
        </ChartShell>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder radius="lg" p="md" shadow="sm" style={{ position: "relative" }}>
          <ThemeIcon variant="light" color="dark" style={{ position: "absolute", top: 16, right: 16 }}>
            <IconChartBar size={18} />
          </ThemeIcon>
          <Stack gap="xs" align="center" mb="xs" style={{ paddingRight: 40, paddingLeft: 40 }}>
            <Group gap={6} align="center" justify="center" wrap="nowrap">
              <Text fw={700} ta="center">
                Top Products By Revenue
              </Text>
              <SectionInfo
                title="Top Products by Revenue"
                formula="Product Revenue = Sum(Base + Tip - Processing Fees) grouped by product"
                variables={[
                  { name: "Product", description: "Booking product name." },
                  { name: "Revenue", description: "Base plus tip minus processing fees total for product." },
                ]}
              />
            </Group>
          </Stack>
          <ScrollArea h={320}>
            <Table striped highlightOnHover withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th ta="center">Product</Table.Th>
                  <Table.Th ta="center">Bookings</Table.Th>
                  <Table.Th ta="center">People</Table.Th>
                  <Table.Th ta="center">Revenue</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {productPerformance.slice(0, 16).map((row) => (
                  <Table.Tr key={`product-row-${row.productName}`}>
                    <Table.Td ta="center">{row.productName}</Table.Td>
                    <Table.Td ta="center">{row.bookings}</Table.Td>
                    <Table.Td ta="center">{row.people}</Table.Td>
                    <Table.Td ta="center">{formatMoney(row.revenue, defaultCurrency)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>

        <Paper withBorder radius="lg" p="md" shadow="sm" style={{ position: "relative" }}>
          <ThemeIcon variant="light" color="dark" style={{ position: "absolute", top: 16, right: 16 }}>
            <IconUsersGroup size={18} />
          </ThemeIcon>
          <Stack gap="xs" align="center" mb="xs" style={{ paddingRight: 40, paddingLeft: 40 }}>
            <Group gap={6} align="center" justify="center" wrap="nowrap">
              <Text fw={700} ta="center">
                Ecwid Demography
              </Text>
              <SectionInfo
                title="Ecwid Demography"
                formula="Payment Country Metrics = Count(bookings), Sum(guests), Sum(revenue) grouped by payment_method_country"
                variables={[
                  { name: "payment_method_country", description: "Country code from payment method data." },
                  { name: "Bookings", description: "Number of bookings for each country." },
                  { name: "Guests", description: "Total guests from party_size_total grouping." },
                  { name: "Revenue", description: "Sum of booking revenue (base + tip minus processing fees)." },
                ]}
              />
            </Group>
          </Stack>
          <Stack gap="xs" align="center" mb="sm">
            <Text size="sm" ta="center">
              Countries tracked:{" "}
              <Text span fw={700}>
                {paymentCountryKnownCount.toLocaleString()}
              </Text>
            </Text>
            <Text size="sm" ta="center">
              Bookings with known country:{" "}
              <Text span fw={700}>
                {paymentCountryKnownBookings.toLocaleString()}
              </Text>
            </Text>
          </Stack>
          <ScrollArea h={220}>
            <Table striped highlightOnHover withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th ta="center">Country</Table.Th>
                  <Table.Th ta="center">Bookings</Table.Th>
                  <Table.Th ta="center">Guests</Table.Th>
                  <Table.Th ta="center">Revenue</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visiblePaymentCountryBreakdown.map((row) => (
                  <Table.Tr key={`payment-country-${row.country}`}>
                    <Table.Td ta="center">{formatCountryDisplay(row.country)}</Table.Td>
                    <Table.Td ta="center">{row.bookings.toLocaleString()}</Table.Td>
                    <Table.Td ta="center">{row.guests.toLocaleString()}</Table.Td>
                    <Table.Td ta="center">{formatMoney(row.revenue, defaultCurrency)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          <Stack gap={4} mt="sm">
            <Text size="xs" fw={700} ta="center">
              Revenue by Taxation area
            </Text>
            <Accordion variant="separated" radius="sm">
              <Accordion.Item value="eu">
                <Accordion.Control>
                  <Stack gap={2} align="center">
                    <Text size="xs" fw={700} ta="center">
                      EU
                    </Text>
                    <Text size="xs" fw={700} ta="center">
                      {formatMoney(taxationAreaBreakdown.euRevenue, defaultCurrency)}
                    </Text>
                  </Stack>
                </Accordion.Control>
                <Accordion.Panel>
                  {taxationAreaBreakdown.euRows.length === 0 ? (
                    <Text size="xs" c="dimmed" ta="center">
                      No EU country revenue
                    </Text>
                  ) : (
                    <Stack gap={4} align="center">
                      {taxationAreaBreakdown.euRows.map((row) => (
                        <Stack key={`taxation-eu-${row.country}`} gap={0} align="center">
                          <Text size="xs" c="dimmed" ta="center">
                            {formatCountryDisplay(row.country)}
                          </Text>
                          <Text size="xs" fw={700} ta="center">
                            {formatMoney(row.revenue, defaultCurrency)}
                          </Text>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="non_eu">
                <Accordion.Control>
                  <Stack gap={2} align="center">
                    <Text size="xs" fw={700} ta="center">
                      Non-EU
                    </Text>
                    <Text size="xs" fw={700} ta="center">
                      {formatMoney(taxationAreaBreakdown.nonEuRevenue, defaultCurrency)}
                    </Text>
                  </Stack>
                </Accordion.Control>
                <Accordion.Panel>
                  {taxationAreaBreakdown.nonEuRows.length === 0 ? (
                    <Text size="xs" c="dimmed" ta="center">
                      No Non-EU country revenue
                    </Text>
                  ) : (
                    <Stack gap={4} align="center">
                      {taxationAreaBreakdown.nonEuRows.map((row) => (
                        <Stack key={`taxation-noneu-${row.country}`} gap={0} align="center">
                          <Text size="xs" c="dimmed" ta="center">
                            {formatCountryDisplay(row.country)}
                          </Text>
                          <Text size="xs" fw={700} ta="center">
                            {formatMoney(row.revenue, defaultCurrency)}
                          </Text>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </Stack>
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="lg" p="md" shadow="sm">
        <Group gap={6} align="center" justify="center" mb="xs">
          <Text fw={700} ta="center">
            Executive highlights
          </Text>
          <SectionInfo
            title="Executive Highlights"
            formula="Highlights are derived from previously aggregated sections"
            variables={[
              { name: "Top platform", description: "Highest platform revenue (base + tip)." },
              { name: "Best day", description: "Highest daily revenue (base + tip minus processing fees)." },
              { name: "Top product", description: "Highest product revenue (base + tip minus processing fees)." },
            ]}
          />
        </Group>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
          <Alert color="blue" variant="light">
            <Stack gap={6} align="center">
              <Text fw={800} c="blue" ta="center">
                Top platform
              </Text>
              <Text ta="center">
                {topPlatform
                  ? `${topPlatform.platform} generated ${formatMoney(topPlatform.revenue, defaultCurrency)} from ${topPlatform.bookings} bookings.`
                  : "No platform data available."}
              </Text>
            </Stack>
          </Alert>
          <Alert color="teal" variant="light">
            <Stack gap={6} align="center">
              <Text fw={800} c="teal" ta="center">
                Best day
              </Text>
              <Text ta="center">
                {bestDay
                  ? `${bestDay.date} delivered ${formatMoney(bestDay.revenue, defaultCurrency)} in revenue after processing fees.`
                  : "No daily trend data available."}
              </Text>
            </Stack>
          </Alert>
          <Alert color="grape" variant="light">
            <Stack gap={6} align="center">
              <Text fw={800} c="grape" ta="center">
                Top product
              </Text>
              <Text ta="center">
                {topProduct
                  ? `${topProduct.productName} generated ${formatMoney(topProduct.revenue, defaultCurrency)} from ${topProduct.bookings} bookings and ${topProduct.people} people.`
                  : "No product data available."}
              </Text>
            </Stack>
          </Alert>
        </SimpleGrid>
      </Paper>
      <PlatformRevenueComparisonModal
        opened={platformComparisonOpen}
        onClose={() => setPlatformComparisonOpen(false)}
        dateField={dateField}
        productTypeIds={productTypeIds}
        defaultCurrency={defaultCurrency}
        mapOrder={toFinancialRow}
      />
    </Stack>
  );
};

export default BookingsExecutiveDashboard;
