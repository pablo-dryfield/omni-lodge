import { type ReactNode, useMemo } from "react";
import {
  Alert,
  Badge,
  Box,
  Group,
  Paper,
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
  addonsAmount: number;
  discountAmount: number;
  refundedAmount: number;
  priceGross: number;
  priceNet: number;
  commissionAmount: number;
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

type Props = {
  orders: UnifiedOrder[];
  bookingAddons: BookingAddonDashboardRow[];
  counterInsights: BookingCounterInsights | null;
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

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const ChartShell = ({ title, children }: { title: string; children: ReactNode }) => (
  <Paper withBorder radius="lg" p="md" shadow="sm" style={{ height: "100%" }}>
    <Stack gap="sm" style={{ height: "100%" }}>
      <Text fw={700}>{title}</Text>
      <Box style={{ flex: 1, minHeight: 240 }}>{children}</Box>
    </Stack>
  </Paper>
);

const KpiCard = ({
  icon,
  label,
  value,
  accent,
  subtitle,
}: {
  icon: ReactNode;
  label: string;
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
        <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: 0.5 }}>
          {label}
        </Text>
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

const BookingsExecutiveDashboard = ({ orders, bookingAddons, counterInsights, rangeLabel }: Props) => {
  const bookingFinancialRows = useMemo(() => {
    return orders.map((order) => {
      const raw = asRecord(order.rawData);
      const baseAmount = asNumber(raw.baseAmount);
      const addonsAmount = asNumber(raw.addonsAmount);
      const discountAmount = asNumber(raw.discountAmount);
      const refundedAmount = asNumber(raw.refundedAmount);
      const derivedGross = Math.max(baseAmount + addonsAmount - discountAmount, 0);
      const priceGross = asNumber(raw.priceGross);
      const grossRevenue = roundMoney(priceGross > 0 ? priceGross : derivedGross);
      const priceNet = asNumber(raw.priceNet);
      const commissionAmount = asNumber(raw.commissionAmount);
      const netRevenue = roundMoney(priceNet > 0 ? priceNet : Math.max(grossRevenue - refundedAmount - commissionAmount, 0));
      const participants = Math.max(order.menCount + order.womenCount, Number.isFinite(order.quantity) ? order.quantity : 0);

      const financial: BookingRawFinancial = {
        bookingId: Number(order.id) || asNumber(raw.bookingId),
        platform: String(raw.platform ?? order.platform ?? "unknown"),
        currency: String(raw.currency ?? "PLN").toUpperCase(),
        paymentStatus: String(raw.paymentStatus ?? "unknown").toLowerCase(),
        baseAmount: roundMoney(baseAmount),
        addonsAmount: roundMoney(addonsAmount),
        discountAmount: roundMoney(discountAmount),
        refundedAmount: roundMoney(refundedAmount),
        priceGross: roundMoney(grossRevenue),
        priceNet: roundMoney(netRevenue),
        commissionAmount: roundMoney(commissionAmount),
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
        netRevenue: financial.priceNet,
        refundedAmount: financial.refundedAmount,
        addonsRevenue: financial.addonsAmount,
        baseRevenue: financial.baseAmount,
        commissionAmount: financial.commissionAmount,
      };
    });
  }, [orders]);

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
  const totalNetRevenue = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + row.netRevenue, 0)),
    [bookingFinancialRows],
  );
  const totalRefunded = useMemo(
    () => roundMoney(bookingFinancialRows.reduce((acc, row) => acc + row.refundedAmount, 0)),
    [bookingFinancialRows],
  );
  const totalAddonsRevenue = useMemo(() => {
    const addonsFromBookings = bookingFinancialRows.reduce((acc, row) => acc + row.addonsRevenue, 0);
    const addonsFromRows = scopedAddonRows.reduce((acc, row) => acc + row.totalPrice, 0);
    return roundMoney(Math.max(addonsFromBookings, addonsFromRows));
  }, [bookingFinancialRows, scopedAddonRows]);

  const totalPeople = useMemo(() => bookingFinancialRows.reduce((acc, row) => acc + row.people, 0), [bookingFinancialRows]);
  const totalBookings = bookingFinancialRows.length;
  const refundRate = totalGrossRevenue > 0 ? totalRefunded / totalGrossRevenue : 0;
  const averageBookingValue = totalBookings > 0 ? totalGrossRevenue / totalBookings : 0;

  const dailyTrend = useMemo(() => {
    const map = new Map<
      string,
      { date: string; revenue: number; net: number; refunds: number; bookings: number; people: number }
    >();
    bookingFinancialRows.forEach((row) => {
      const bucket = map.get(row.date) ?? {
        date: row.date,
        revenue: 0,
        net: 0,
        refunds: 0,
        bookings: 0,
        people: 0,
      };
      bucket.revenue += row.grossRevenue;
      bucket.net += row.netRevenue;
      bucket.refunds += row.refundedAmount;
      bucket.bookings += 1;
      bucket.people += row.people;
      map.set(row.date, bucket);
    });

    return Array.from(map.values())
      .map((row) => ({
        ...row,
        revenue: roundMoney(row.revenue),
        net: roundMoney(row.net),
        refunds: roundMoney(row.refunds),
        label: row.date.slice(5),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [bookingFinancialRows]);

  const platformRevenue = useMemo(() => {
    const map = new Map<string, { platform: string; revenue: number; bookings: number; people: number; net: number }>();
    bookingFinancialRows.forEach((row) => {
      const key = row.platformLabel;
      const bucket = map.get(key) ?? { platform: key, revenue: 0, bookings: 0, people: 0, net: 0 };
      bucket.revenue += row.grossRevenue;
      bucket.net += row.netRevenue;
      bucket.bookings += 1;
      bucket.people += row.people;
      map.set(key, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({ ...row, revenue: roundMoney(row.revenue), net: roundMoney(row.net) }))
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
      bucket.revenue += row.grossRevenue;
      bucket.people += row.people;
      map.set(key, bucket);
    });
    return Array.from(map.values()).sort((a, b) => a.hour.localeCompare(b.hour));
  }, [bookingFinancialRows]);

  const productPerformance = useMemo(() => {
    const map = new Map<
      string,
      { productName: string; bookings: number; people: number; revenue: number; net: number; refunds: number }
    >();
    bookingFinancialRows.forEach((row) => {
      const key = row.productName || "Unknown";
      const bucket =
        map.get(key) ?? { productName: key, bookings: 0, people: 0, revenue: 0, net: 0, refunds: 0 };
      bucket.bookings += 1;
      bucket.people += row.people;
      bucket.revenue += row.grossRevenue;
      bucket.net += row.netRevenue;
      bucket.refunds += row.refundedAmount;
      map.set(key, bucket);
    });
    return Array.from(map.values())
      .map((row) => ({
        ...row,
        revenue: roundMoney(row.revenue),
        net: roundMoney(row.net),
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
    () => [...bookingFinancialRows].sort((a, b) => b.grossRevenue - a.grossRevenue).slice(0, 20),
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
          label="Gross Revenue"
          value={formatMoney(totalGrossRevenue, defaultCurrency)}
          subtitle={`Avg booking: ${formatMoney(averageBookingValue, defaultCurrency)}`}
          accent="#214A66"
        />
        <KpiCard
          icon={<IconCreditCardRefund size={20} />}
          label="Net Revenue"
          value={formatMoney(totalNetRevenue, defaultCurrency)}
          subtitle={`Refund rate: ${formatPercent(refundRate)}`}
          accent="#2B7A78"
        />
        <KpiCard
          icon={<IconUsersGroup size={20} />}
          label="Bookings & People"
          value={`${totalBookings.toLocaleString()} / ${totalPeople.toLocaleString()}`}
          subtitle={`Platforms: ${platformRevenue.length}`}
          accent="#345995"
        />
        <KpiCard
          icon={<IconCash size={20} />}
          label="Cash + Free Tickets"
          value={`${formatMoney(counterInsights?.cashPaymentsTotal ?? 0, counterInsights?.currency ?? "PLN")}`}
          subtitle={`Free tickets from notes: ${(counterInsights?.freeTicketsTotal ?? 0).toLocaleString()}`}
          accent="#6B705C"
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <Box style={{ gridColumn: "span 2" }}>
          <ChartShell title="Revenue trend (gross vs net, bookings/day)">
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
                <Area yAxisId="money" type="monotone" dataKey="revenue" name="Revenue" stroke="#214A66" fill="#214A6633" />
                <Area yAxisId="money" type="monotone" dataKey="net" name="Net" stroke="#2B7A78" fill="#2B7A7833" />
                <Line yAxisId="count" type="monotone" dataKey="bookings" name="bookings" stroke="#EF8354" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartShell>
        </Box>

        <ChartShell title="Platform revenue share">
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
        <ChartShell title="Platform revenue leaderboard">
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

        <ChartShell title="Booking status distribution">
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

        <ChartShell title="Payment status distribution">
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
        <ChartShell title="Add-on revenue by item (booking_addons)">
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

        <ChartShell title="Pickup-hour demand curve">
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
            <Text fw={700}>Top products by revenue</Text>
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
                  <Table.Th ta="right">Net</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {productPerformance.slice(0, 16).map((row) => (
                  <Table.Tr key={`product-row-${row.productName}`}>
                    <Table.Td>{row.productName}</Table.Td>
                    <Table.Td ta="right">{row.bookings}</Table.Td>
                    <Table.Td ta="right">{row.people}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.revenue, defaultCurrency)}</Table.Td>
                    <Table.Td ta="right">{formatMoney(row.net, defaultCurrency)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        </Paper>

        <Paper withBorder radius="lg" p="md" shadow="sm">
          <Group justify="space-between" mb="xs">
            <Text fw={700}>Cash channels & free-ticket intelligence</Text>
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
            <Text fw={700}>Bookings table (top by revenue)</Text>
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
                  <Table.Th ta="right">Gross</Table.Th>
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
                    <Table.Td ta="right">{formatMoney(row.grossRevenue, row.currency || defaultCurrency)}</Table.Td>
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
            <Text fw={700}>Booking add-ons table (booking_addons)</Text>
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
        <Text fw={700} mb="xs">
          Executive highlights
        </Text>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
          <Alert color="blue" variant="light" title="Top platform">
            {topPlatform
              ? `${topPlatform.platform} generated ${formatMoney(topPlatform.revenue, defaultCurrency)} from ${topPlatform.bookings} bookings.`
              : "No platform data available."}
          </Alert>
          <Alert color="teal" variant="light" title="Best day">
            {bestDay
              ? `${bestDay.date} delivered ${formatMoney(bestDay.revenue, defaultCurrency)} in gross bookings.`
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
