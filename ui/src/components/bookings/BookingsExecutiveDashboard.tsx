import { type ReactNode, useMemo } from "react";
import {
  ActionIcon,
  Alert,
  Box,
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
  IconCash,
  IconChartBar,
  IconChartPie,
  IconClockHour4,
  IconCreditCardRefund,
  IconInfoCircle,
  IconReceipt2,
  IconTicket,
  IconUsersGroup,
} from "@tabler/icons-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UnifiedOrder } from "../../store/bookingPlatformsTypes";

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
};

const CHART_COLORS = ["#214A66", "#2B7A78", "#345995", "#EF8354", "#B56576", "#6B705C", "#7D4E57", "#3D5A80"];

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

const ChartShell = ({ title, info, children }: { title: string; info?: ReactNode; children: ReactNode }) => (
  <Paper withBorder radius="lg" p="md" shadow="sm" style={{ height: "100%" }}>
    <Stack gap="sm" style={{ height: "100%" }}>
      <Group gap={6} align="center" wrap="nowrap">
        <Text fw={700}>{title}</Text>
        {info}
      </Group>
      <Box style={{ flex: 1, minHeight: 240 }}>{children}</Box>
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
      <Group gap={6} justify="center" wrap="nowrap" style={{ width: "100%" }}>
        <Text fw={800} size="xl" ta="center">
          {value}
        </Text>
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
}: Props) => {
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

  const totalGrossRevenue = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + row.grossRevenue, 0)),
    [bookingFinancialRows],
  );
  const totalRevenueAfterChannelCommission = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + row.netRevenue, 0)),
    [bookingFinancialRows],
  );
  const totalCashPayments = useMemo(
    () => roundMoney(counterInsights?.cashPaymentsTotal ?? 0),
    [counterInsights],
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
  const totalAddonUnits = useMemo(
    () => addonKpiRows.reduce((acc, row) => acc + row.quantity, 0),
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
        currency: counterInsights?.currency ?? "PLN",
        amount: roundMoney(Number(row.amount ?? 0)),
        guests: null as number | null,
      }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  }, [counterInsights]);
  const totalRevenueMixData = useMemo(
    () => [
      { key: "online", name: "Online", value: roundMoney(totalOnlineRevenue), color: "#214A66" },
      { key: "venue", name: "Venue", value: roundMoney(venueCommissionTotal), color: "#2B7A78" },
      { key: "cash", name: "Cash", value: roundMoney(totalCashPayments), color: "#6B705C" },
    ],
    [totalOnlineRevenue, venueCommissionTotal, totalCashPayments],
  );

  const dailyTrend = useMemo(() => {
    const map = new Map<
      string,
      { date: string; revenue: number; gross: number; refunds: number; bookings: number; people: number }
    >();
    bookingFinancialRows.forEach((row) => {
      const bucket = map.get(row.date) ?? {
        date: row.date,
        revenue: 0,
        gross: 0,
        refunds: 0,
        bookings: 0,
        people: 0,
      };
      bucket.revenue += row.netRevenue;
      bucket.gross += row.grossRevenue;
      bucket.refunds += row.refundedAmount;
      bucket.bookings += 1;
      bucket.people += row.people;
      map.set(row.date, bucket);
    });

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        revenue: roundMoney(row.revenue),
        gross: roundMoney(row.gross),
        refunds: roundMoney(row.refunds),
        label: row.date.slice(5),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [bookingFinancialRows]);

  const platformRevenue = useMemo(() => {
    const map = new Map<string, { platform: string; revenue: number; bookings: number; people: number; gross: number }>();
    bookingFinancialRows.forEach((row) => {
      const key = row.platformLabel;
      const bucket = map.get(key) ?? { platform: key, revenue: 0, bookings: 0, people: 0, gross: 0 };
      bucket.revenue += row.netRevenue;
      bucket.gross += row.grossRevenue;
      bucket.bookings += 1;
      bucket.people += row.people;
      map.set(key, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({ ...row, revenue: roundMoney(row.revenue), gross: roundMoney(row.gross) }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [bookingFinancialRows]);

  const statusDistribution = useMemo(() => {
    const map = new Map<string, number>();
    bookingFinancialRows.forEach((row) => map.set(row.status, (map.get(row.status) ?? 0) + 1));
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [bookingFinancialRows]);

  const paymentDistribution = useMemo(() => {
    const map = new Map<string, number>();
    bookingFinancialRows.forEach((row) => map.set(row.paymentStatus, (map.get(row.paymentStatus) ?? 0) + 1));
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [bookingFinancialRows]);

  const hourlyBookings = useMemo(() => {
    const map = new Map<string, { hour: string; bookings: number; revenue: number; people: number }>();
    bookingFinancialRows.forEach((row) => {
      const hour = String(row.time ?? "--:--").slice(0, 2).padStart(2, "0");
      const key = `${hour}:00`;
      const bucket = map.get(key) ?? { hour: key, bookings: 0, revenue: 0, people: 0 };
      bucket.bookings += 1;
      bucket.revenue += row.netRevenue;
      bucket.people += row.people;
      map.set(key, bucket);
    });
    return Array.from(map.values()).sort((a, b) => a.hour.localeCompare(b.hour));
  }, [bookingFinancialRows]);

  const productPerformance = useMemo(() => {
    const map = new Map<
      string,
      { productName: string; bookings: number; people: number; revenue: number; gross: number; refunds: number }
    >();
    bookingFinancialRows.forEach((row) => {
      const key = row.productName || "Unknown";
      const bucket =
        map.get(key) ?? { productName: key, bookings: 0, people: 0, revenue: 0, gross: 0, refunds: 0 };
      bucket.bookings += 1;
      bucket.people += row.people;
      bucket.revenue += row.netRevenue;
      bucket.gross += row.grossRevenue;
      bucket.refunds += row.refundedAmount;
      map.set(key, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        revenue: roundMoney(row.revenue),
        gross: roundMoney(row.gross),
        refunds: roundMoney(row.refunds),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [bookingFinancialRows]);

  const addonPerformance = useMemo(() => {
    const map = new Map<string, { addonName: string; quantity: number; revenue: number; bookings: Set<number> }>();
    scopedAddonRows.forEach((row) => {
      const addonId = Number(row.addonId);
      const hasMappedAddon = Number.isFinite(addonId) && addonId > 0;
      const normalizedAddonName = String(row.addonName ?? "").trim();
      const addonName = hasMappedAddon ? normalizedAddonName || `Add-on #${addonId}` : "Unmapped add-on";
      const key = hasMappedAddon ? `addon:${addonId}` : `unmapped:${normalizedAddonName || "unknown"}`;
      const bucket = map.get(key) ?? { addonName, quantity: 0, revenue: 0, bookings: new Set<number>() };
      bucket.quantity += Math.max(0, Number(row.quantity) || 0);
      bucket.revenue += Math.max(0, Number(row.totalPrice) || 0);
      bucket.bookings.add(Number(row.bookingId));
      map.set(key, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({
        addonName: row.addonName,
        quantity: row.quantity,
        revenue: roundMoney(row.revenue),
        bookings: row.bookings.size,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity);
  }, [scopedAddonRows]);

  const topBookingsTable = useMemo(
    () => [...bookingFinancialRows].sort((a, b) => b.netRevenue - a.netRevenue).slice(0, 20),
    [bookingFinancialRows],
  );

  const topAddonsTable = useMemo(
    () => [...scopedAddonRows].sort((a, b) => b.totalPrice - a.totalPrice).slice(0, 24),
    [scopedAddonRows],
  );

  const topPlatform = platformRevenue[0] ?? null;
  const bestDay = dailyTrend.reduce<{ date: string; revenue: number } | null>((best, row) => {
    if (!best || row.revenue > best.revenue) return { date: row.date, revenue: row.revenue };
    return best;
  }, null);

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
                              {`${Math.max(0, Number(row.totalPeople ?? 0)).toLocaleString()} guests`}
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
          value={`${(counterInsights?.cashGuestsTotal ?? 0).toLocaleString()} guests: ${formatMoney(counterInsights?.cashPaymentsTotal ?? 0, counterInsights?.currency ?? "PLN")}`}
          subtitle={
            <Stack gap={4}>
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
                        ? `${row.name} (${row.currency}): ${row.guests.toLocaleString()} guests`
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
                  {`Free Tickets: ${(counterInsights?.freeTicketsTotal ?? 0).toLocaleString()} guests`}
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
                {`${totalPeople.toLocaleString()} guests`}
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
                  {`${noShowSummary.fullGuests.toLocaleString()} guests (${noShowSummary.fullBookings.toLocaleString()} bookings)`}
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
                  {`${noShowSummary.partialGuests.toLocaleString()} guests (${noShowSummary.partialBookings.toLocaleString()} bookings)`}
                </Text>
              </Group>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="xs" c="dimmed">
                  Total No-Show
                </Text>
                <Text size="xs" fw={700}>
                  {`${(noShowSummary.fullGuests + noShowSummary.partialGuests).toLocaleString()} guests (${(noShowSummary.fullBookings + noShowSummary.partialBookings).toLocaleString()} bookings)`}
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
            title="Revenue trend (after commission + tip vs gross, bookings/day)"
            info={
              <SectionInfo
                title="Revenue Trend"
                formula="Daily Revenue = Sum(Base + Tip), Daily Gross = Sum(Price Gross)"
                variables={[
                  { name: "Base", description: "Per-booking base amount." },
                  { name: "Tip", description: "Per-booking tip amount." },
                  { name: "Price Gross", description: "Per-booking gross booked value." },
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
                  name="Revenue (after commission + tip)"
                  stroke="#214A66"
                  fill="#214A6633"
                />
                <Area
                  yAxisId="money"
                  type="monotone"
                  dataKey="gross"
                  name="Gross booked"
                  stroke="#2B7A78"
                  fill="#2B7A7833"
                />
                <Line yAxisId="count" type="monotone" dataKey="bookings" name="bookings" stroke="#EF8354" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartShell>
        </Box>

        <ChartShell
          title="Platform revenue share"
          info={
            <SectionInfo
              title="Platform Revenue Share"
              formula="Platform Revenue = Sum(Base + Tip) grouped by platform"
              variables={[
                { name: "Platform", description: "Normalized booking platform label." },
                { name: "Revenue", description: "Base plus tip summed per platform." },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={platformRevenue} dataKey="revenue" nameKey="platform" outerRadius={82} label>
                {platformRevenue.map((entry, index) => (
                  <Cell key={`platform-pie-${entry.platform}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip
                formatter={(_value: number, _name: string, item: { payload?: { gross?: number; revenue?: number } }) => [
                  formatMoney(Number(item?.payload?.revenue ?? 0), defaultCurrency),
                  "Revenue (after channel commission)",
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartShell>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md">
        <ChartShell
          title="Platform revenue leaderboard"
          info={
            <SectionInfo
              title="Platform Revenue Leaderboard"
              formula="Platform Revenue = Sum(Base + Tip) grouped by platform"
              variables={[
                { name: "Platform", description: "Normalized platform name." },
                { name: "Revenue", description: "Base plus tip total for that platform." },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={platformRevenue.slice(0, 8)} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="platform" width={110} />
              <RechartsTooltip
                formatter={(_value: number, _name: string, item: { payload?: { gross?: number; revenue?: number } }) => [
                  formatMoney(Number(item?.payload?.revenue ?? 0), defaultCurrency),
                  "Revenue (after channel commission)",
                ]}
              />
              <Bar dataKey="revenue" fill="#214A66" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell
          title="Booking status distribution"
          info={
            <SectionInfo
              title="Booking Status Distribution"
              formula="Status Count = Count(bookings) grouped by booking status"
              variables={[
                { name: "Booking status", description: "Current booking lifecycle status." },
                { name: "Count", description: "Number of bookings in each status." },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={statusDistribution} dataKey="value" nameKey="name" outerRadius={80} label>
                {statusDistribution.map((entry, index) => (
                  <Cell key={`status-pie-${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <RechartsTooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell
          title="Payment status distribution"
          info={
            <SectionInfo
              title="Payment Status Distribution"
              formula="Payment Status Count = Count(bookings) grouped by payment status"
              variables={[
                { name: "Payment status", description: "Current payment state for booking." },
                { name: "Count", description: "Number of bookings in each payment state." },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={paymentDistribution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <RechartsTooltip />
              <Bar dataKey="value" fill="#345995" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <ChartShell
          title="Add-on revenue by item (booking_addons)"
          info={
            <SectionInfo
              title="Add-on Revenue"
              formula="Add-on Revenue = Sum(booking_addons.total_price) grouped by add-on name"
              variables={[
                { name: "total_price", description: "Stored monetary value for each add-on row." },
                { name: "Add-on name", description: "Resolved name from addon or platform addon fields." },
              ]}
            />
          }
        >
          {addonPerformance.length === 0 ? (
            <Alert color="gray" variant="light">
              No add-on records found in booking_addons for this range.
            </Alert>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={addonPerformance.slice(0, 10)} layout="vertical" margin={{ left: 28 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="addonName" width={130} />
                <RechartsTooltip formatter={(value: number) => formatMoney(Number(value), defaultCurrency)} />
                <Bar dataKey="revenue" fill="#B56576" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartShell>

        <ChartShell
          title="Pickup-hour demand curve"
          info={
            <SectionInfo
              title="Pickup-Hour Demand"
              formula="Bookings/People per hour = Sum(bookings/people) grouped by booking hour"
              variables={[
                { name: "Booking hour", description: "Hour derived from booking time (HH:00 buckets)." },
                { name: "Bookings", description: "Booking count in the hour bucket." },
                { name: "People", description: "Participant total in the hour bucket." },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hourlyBookings}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis />
              <RechartsTooltip />
              <Legend />
              <Line type="monotone" dataKey="bookings" stroke="#2B7A78" name="Bookings" strokeWidth={2} />
              <Line type="monotone" dataKey="people" stroke="#EF8354" name="People" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartShell>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder radius="lg" p="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Group gap={6} align="center" wrap="nowrap">
              <Text fw={700}>Top products by revenue</Text>
              <SectionInfo
                title="Top Products by Revenue"
                formula="Product Revenue = Sum(Base + Tip) grouped by product"
                variables={[
                  { name: "Product", description: "Booking product name." },
                  { name: "Revenue", description: "Base plus tip total for product." },
                  { name: "Gross", description: "Gross booked value total for product." },
                ]}
              />
            </Group>
            <ThemeIcon variant="light" color="dark">
              <IconChartBar size={18} />
            </ThemeIcon>
          </Group>
          <ScrollArea h={320}>
            <Table striped highlightOnHover withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Product</Table.Th>
                  <Table.Th ta="right">Bookings</Table.Th>
                  <Table.Th ta="right">People</Table.Th>
                  <Table.Th ta="right">Revenue</Table.Th>
                  <Table.Th ta="right">Gross</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {productPerformance.slice(0, 16).map((row) => (
                  <Table.Tr key={`product-row-${row.productName}`}>
                    <Table.Td>{row.productName}</Table.Td>
                    <Table.Td ta="right">{row.bookings}</Table.Td>
                    <Table.Td ta="right">{row.people}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.revenue, defaultCurrency)}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.gross, defaultCurrency)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>

        <Paper withBorder radius="lg" p="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Group gap={6} align="center" wrap="nowrap">
              <Text fw={700}>Cash channels & free-ticket intelligence</Text>
              <SectionInfo
                title="Cash Channels & Free Tickets"
                formula="Cash by Channel = Sum(counter cash metrics by channel), Free Tickets = Sum(extracted note values)"
                variables={[
                  { name: "Counter cash metrics", description: "Counter entries tagged as cash payment." },
                  { name: "Channel", description: "Channel associated to counter metric row." },
                  { name: "Free tickets", description: "Counts parsed from notes with free-ticket expressions." },
                ]}
              />
            </Group>
            <ThemeIcon variant="light" color="dark">
              <IconTicket size={18} />
            </ThemeIcon>
          </Group>
          <Stack gap="xs" mb="sm">
            <Text size="sm">
              Cash recorded:{" "}
              <Text span fw={700}>
                {formatMoney(counterInsights?.cashPaymentsTotal ?? 0, counterInsights?.currency ?? "PLN")}
              </Text>
            </Text>
            <Text size="sm">
              Free tickets in notes:{" "}
              <Text span fw={700}>
                {(counterInsights?.freeTicketsTotal ?? 0).toLocaleString()}
              </Text>
            </Text>
          </Stack>
          <ScrollArea h={280}>
            <Table striped highlightOnHover withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Channel</Table.Th>
                  <Table.Th ta="right">Cash</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(counterInsights?.cashByChannel ?? []).map((row) => (
                  <Table.Tr key={`cash-channel-${row.channelId ?? row.channelName}`}>
                    <Table.Td>{row.channelName}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.amount, counterInsights?.currency ?? "PLN")}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
        <Paper withBorder radius="lg" p="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Group gap={6} align="center" wrap="nowrap">
              <Text fw={700}>Bookings table (top by revenue)</Text>
              <SectionInfo
                title="Top Bookings by Revenue"
                formula="Row Revenue = Base + Tip, then sorted descending"
                variables={[
                  { name: "Base", description: "Recognized base amount per booking." },
                  { name: "Tip", description: "Tip amount per booking." },
                  { name: "Refund", description: "Stored refunded amount for context." },
                ]}
              />
            </Group>
            <ThemeIcon variant="light" color="dark">
              <IconChartPie size={18} />
            </ThemeIcon>
          </Group>
          <ScrollArea h={360}>
            <Table striped highlightOnHover withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Booking</Table.Th>
                  <Table.Th>Platform</Table.Th>
                  <Table.Th>Date</Table.Th>
                  <Table.Th ta="right">People</Table.Th>
                  <Table.Th ta="right">Revenue</Table.Th>
                  <Table.Th ta="right">Refund</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {topBookingsTable.map((row) => (
                  <Table.Tr key={`booking-fin-${row.bookingId}-${row.productName}-${row.date}-${row.time}`}>
                    <Table.Td>
                      <Text fw={600}>{row.bookingId}</Text>
                      <Text size="xs" c="dimmed">
                        {row.productName}
                      </Text>
                    </Table.Td>
                    <Table.Td>{row.platformLabel}</Table.Td>
                    <Table.Td>{`${row.date} ${row.time}`}</Table.Td>
                    <Table.Td ta="right">{row.people}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.netRevenue, row.currency || defaultCurrency)}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.refundedAmount, row.currency || defaultCurrency)}</Table.Td>
                    <Table.Td>{row.status}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>

        <Paper withBorder radius="lg" p="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Group gap={6} align="center" wrap="nowrap">
              <Text fw={700}>Booking add-ons table (booking_addons)</Text>
              <SectionInfo
                title="Booking Add-ons Table"
                formula="Rows sorted by add-on total price descending"
                variables={[
                  { name: "Qty", description: "Add-on quantity on booking_addons row." },
                  { name: "Unit", description: "Unit price on booking_addons row." },
                  { name: "Total", description: "Total price on booking_addons row." },
                ]}
              />
            </Group>
            <ThemeIcon variant="light" color="dark">
              <IconClockHour4 size={18} />
            </ThemeIcon>
          </Group>
          <ScrollArea h={360}>
            <Table striped highlightOnHover withColumnBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Booking</Table.Th>
                  <Table.Th>Add-on</Table.Th>
                  <Table.Th ta="right">Qty</Table.Th>
                  <Table.Th ta="right">Unit</Table.Th>
                  <Table.Th ta="right">Total</Table.Th>
                  <Table.Th>Included</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {topAddonsTable.map((row) => (
                  <Table.Tr key={`addon-row-${row.id}`}>
                    <Table.Td>{row.bookingId}</Table.Td>
                    <Table.Td>{row.addonName}</Table.Td>
                    <Table.Td ta="right">{row.quantity}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.unitPrice, row.currency ?? defaultCurrency)}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.totalPrice, row.currency ?? defaultCurrency)}</Table.Td>
                    <Table.Td>{row.isIncluded ? "Yes" : "No"}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="lg" p="md" shadow="sm">
        <Group gap={6} align="center" mb="xs">
          <Text fw={700}>Executive highlights</Text>
          <SectionInfo
            title="Executive Highlights"
            formula="Highlights are derived from previously aggregated sections"
            variables={[
              { name: "Top platform", description: "Highest platform revenue (base + tip)." },
              { name: "Best day", description: "Highest daily revenue (base + tip)." },
              { name: "Add-ons impact", description: "Total add-on revenue from booking_addons rows." },
            ]}
          />
        </Group>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
          <Alert color="blue" variant="light" title="Top platform">
            {topPlatform
              ? `${topPlatform.platform} generated ${formatMoney(topPlatform.revenue, defaultCurrency)} from ${topPlatform.bookings} bookings.`
              : "No platform data available."}
          </Alert>
          <Alert color="teal" variant="light" title="Best day">
            {bestDay
              ? `${bestDay.date} delivered ${formatMoney(bestDay.revenue, defaultCurrency)} in revenue (after commission + tip).`
              : "No daily trend data available."}
          </Alert>
          <Alert color="grape" variant="light" title="Add-ons impact">
            Add-ons generated {formatMoney(totalAddonsRevenue, defaultCurrency)} across {scopedAddonRows.length} rows.
          </Alert>
        </SimpleGrid>
      </Paper>
    </Stack>
  );
};

export default BookingsExecutiveDashboard;
