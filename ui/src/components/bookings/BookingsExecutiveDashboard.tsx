import { type ReactNode, useMemo } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
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
  Title,
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
  currency: string | null;
  isIncluded: boolean;
};

export type BookingCounterInsights = {
  currency: string;
  cashPaymentsTotal: number;
  cashByChannel: Array<{ channelId: number | null; channelName: string; amount: number }>;
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
};

type Props = {
  orders: UnifiedOrder[];
  bookingAddons: BookingAddonDashboardRow[];
  counterInsights: BookingCounterInsights | null;
  venueCommissionTotals?: VenueCommissionCurrencyTotal[] | null;
  rangeLabel: string;
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

const formatMoney = (value: number, currency = "PLN"): string => {
  try {
    return new Intl.NumberFormat("pl-PL", { style: "currency", currency }).format(value);
  } catch (_error) {
    return `${value.toFixed(2)} ${currency}`;
  }
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
  value: string;
  accent: string;
  subtitle?: string;
}) => (
  <Paper
    withBorder
    radius="lg"
    p="md"
    shadow="sm"
    style={{
      background: `linear-gradient(135deg, ${accent}16 0%, #ffffff 100%)`,
      borderColor: `${accent}66`,
    }}
  >
    <Group justify="space-between" align="start" wrap="nowrap">
      <Stack gap={2}>
        <Group gap={4} align="center" wrap="nowrap">
          <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: 0.5 }}>
            {label}
          </Text>
          {info}
        </Group>
        <Text fw={800} size="xl">
          {value}
        </Text>
        {subtitle ? (
          <Text size="xs" c="dimmed">
            {subtitle}
          </Text>
        ) : null}
      </Stack>
      <ThemeIcon size={40} radius="md" variant="light" color="dark">
        {icon}
      </ThemeIcon>
    </Group>
  </Paper>
);

const BookingsExecutiveDashboard = ({
  orders,
  bookingAddons,
  counterInsights,
  venueCommissionTotals,
  rangeLabel,
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
      const participants = Math.max(order.menCount + order.womenCount, Number.isFinite(order.quantity) ? order.quantity : 0);

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
  const totalRevenueNoChannelCommission = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + row.netRevenueNoChannelCommission, 0)),
    [bookingFinancialRows],
  );
  const totalCashPayments = useMemo(
    () => roundMoney(counterInsights?.cashPaymentsTotal ?? 0),
    [counterInsights],
  );
  const totalRevenueCard = useMemo(
    () => roundMoney(totalRevenueNoChannelCommission + totalCashPayments),
    [totalRevenueNoChannelCommission, totalCashPayments],
  );
  const totalAddonsRevenue = useMemo(() => {
    const addonsFromBookings = bookingFinancialRows.reduce((acc, row) => acc + row.addonsRevenue, 0);
    const addonsFromRows = scopedAddonRows.reduce((acc, row) => acc + row.totalPrice, 0);
    return roundMoney(Math.max(addonsFromBookings, addonsFromRows));
  }, [bookingFinancialRows, scopedAddonRows]);

  const totalPeople = useMemo(() => bookingFinancialRows.reduce((acc, row) => acc + row.people, 0), [bookingFinancialRows]);
  const totalBookings = bookingFinancialRows.length;
  const averageBookingValue = totalBookings > 0 ? totalRevenueNoChannelCommission / totalBookings : 0;
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
  const venueCommissionOutstanding = venueCommissionSelected?.receivableOutstanding ?? 0;

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
      const key = row.addonName || row.platformAddonName || "Unknown add-on";
      const bucket = map.get(key) ?? { addonName: key, quantity: 0, revenue: 0, bookings: new Set<number>() };
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

  return (
    <Stack gap="md">
      <Paper
        radius="lg"
        p="lg"
        withBorder
        style={{
          background:
            "linear-gradient(120deg, rgba(17,38,59,0.97) 0%, rgba(33,74,102,0.95) 58%, rgba(43,122,120,0.9) 100%)",
          color: "#fff",
          borderColor: "rgba(170, 196, 214, 0.45)",
        }}
      >
        <Group justify="space-between" align="center" wrap="wrap">
          <Stack gap={3}>
            <Text size="xs" tt="uppercase" fw={700} style={{ letterSpacing: 0.8, opacity: 0.85 }}>
              Executive Dashboard
            </Text>
            <Title order={2} style={{ lineHeight: 1.2 }}>
              Bookings Performance Command Center
            </Title>
            <Text size="sm" style={{ opacity: 0.88 }}>
              Range: {rangeLabel}
            </Text>
          </Stack>
          <Group gap="xs">
            {currencies.map((currency) => (
              <Badge key={currency} variant="filled" color="gray">
                Currency: {currency}
              </Badge>
            ))}
            {currencies.length > 1 ? (
              <Badge variant="filled" color="orange">
                Mixed currencies detected
              </Badge>
            ) : null}
          </Group>
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
        <KpiCard
          icon={<IconReceipt2 size={20} />}
          label="Revenue"
          info={
            <SectionInfo
              title="Revenue"
              formula="Revenue Card = (Base Amount without Channel Commission + Tip Amount) + Cash Payments"
              variables={[
                {
                  name: "Base Amount",
                  description:
                    "Recognized booking revenue after discounts/refunds, without applying channel commission adjustment.",
                },
                { name: "Tip Amount", description: "Tip collected for the booking." },
                { name: "Cash Payments", description: "Counter cash metrics marked as cash payment." },
              ]}
              notes={[
                "If base amount is missing, the dashboard falls back to Price Net for that row.",
              ]}
            />
          }
          value={formatMoney(totalRevenueCard, defaultCurrency)}
          subtitle={`Avg booking: ${formatMoney(averageBookingValue, defaultCurrency)}`}
          accent="#214A66"
        />
        <KpiCard
          icon={<IconCreditCardRefund size={20} />}
          label="Venue Commission"
          info={
            <SectionInfo
              title="Venue Commission"
              formula="Venue Commission = Sum(venueNumbers.summary.totalsByCurrency.receivable)"
              variables={[
                { name: "receivable", description: "Commission owed by venues for the selected range." },
                {
                  name: "Data source",
                  description: "Same summary endpoint used in Venue Numbers tab (/venueNumbers?tab=summary).",
                },
              ]}
            />
          }
          value={formatMoney(venueCommissionTotal, venueCommissionCurrency)}
          subtitle={`Outstanding: ${formatMoney(venueCommissionOutstanding, venueCommissionCurrency)}`}
          accent="#2B7A78"
        />
        <KpiCard
          icon={<IconUsersGroup size={20} />}
          label="Bookings & People"
          info={
            <SectionInfo
              title="Bookings & People"
              formula="Bookings = Count(rows), People = Sum(row people)"
              variables={[
                { name: "Rows", description: "Bookings returned for the selected range and filters." },
                { name: "Row people", description: "Participant count per booking row." },
              ]}
            />
          }
          value={`${totalBookings.toLocaleString()} / ${totalPeople.toLocaleString()}`}
          subtitle={`Platforms: ${platformRevenue.length}`}
          accent="#345995"
        />
        <KpiCard
          icon={<IconCash size={20} />}
          label="Cash + Free Tickets"
          info={
            <SectionInfo
              title="Cash + Free Tickets"
              formula="Cash = Sum(counter cash metrics), Free Tickets = Sum(extracted ticket counts from notes)"
              variables={[
                { name: "Counter cash metrics", description: "Counter channel metrics marked as cash payment." },
                { name: "Free ticket counts", description: "Values parsed from counter notes using free-ticket patterns." },
              ]}
            />
          }
          value={`${formatMoney(counterInsights?.cashPaymentsTotal ?? 0, counterInsights?.currency ?? "PLN")}`}
          subtitle={`Free tickets from notes: ${(counterInsights?.freeTicketsTotal ?? 0).toLocaleString()}`}
          accent="#6B705C"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <Box style={{ gridColumn: "span 2" }}>
          <ChartShell
            title="Revenue trend (base+tip vs gross, bookings/day)"
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
                  name="Revenue (base+tip)"
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
              <RechartsTooltip formatter={(value: number) => formatMoney(Number(value), defaultCurrency)} />
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
              <RechartsTooltip formatter={(value: number) => formatMoney(Number(value), defaultCurrency)} />
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
              ? `${bestDay.date} delivered ${formatMoney(bestDay.revenue, defaultCurrency)} in revenue (base+tip).`
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
