import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Paper,
  Popover,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  useMantineTheme,
} from "@mantine/core";
import { DatePicker, DatePickerInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBrandGoogle,
  IconBrandMeta,
  IconCalendarEvent,
  IconChartBar,
  IconChevronDown,
  IconReceipt2,
  IconTargetArrow,
} from "@tabler/icons-react";
import { isAxiosError } from "axios";
import dayjs from "dayjs";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { navigateToPage } from "../actions/navigationActions";
import { useAppDispatch } from "../store/hooks";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import {
  fetchMarketingOverview,
  type MarketingDailySeriesPoint,
  type GoogleCostRow,
  type MarketingBooking,
  type MarketingBreakdownRow,
  type MarketingOverviewResponse,
  type MarketingTabData,
} from "../api/marketing";

const PAGE_SLUG = PAGE_SLUGS.marketing;

type MarketingDatePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_7_days"
  | "last_14_days"
  | "this_month"
  | "last_30_days"
  | "last_month"
  | "custom";

type DateRangeValue = [Date | null, Date | null];

const DATE_PRESET_OPTIONS: Array<{ value: MarketingDatePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_14_days", label: "Last 14 days" },
  { value: "this_month", label: "This month" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom" },
];

const formatMoney = (value: number, currency?: string | null): string => {
  if (currency === "PLN") {
    return `${new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)} z\u0142`;
  }
  if (currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatDateTime = (value: string | null): string => {
  if (!value) {
    return "-";
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format("HH:mm") : "-";
};

const formatDisplayRange = (range: DateRangeValue): string => {
  const [start, end] = range;
  if (!start || !end) {
    return "Select a range";
  }
  const startLabel = dayjs(start).format("MMM D, YYYY");
  const endLabel = dayjs(end).format("MMM D, YYYY");
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
};

const formatSeriesDate = (value: string): string => dayjs(value).format("DD MMM");

const formatCompactNumber = (value: number): string => {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
};

const getPresetRange = (preset: Exclude<MarketingDatePreset, "custom">, reference: dayjs.Dayjs = dayjs()): [Date, Date] => {
  const today = reference.startOf("day");
  switch (preset) {
    case "today":
      return [today.toDate(), today.toDate()];
    case "yesterday": {
      const yesterday = today.subtract(1, "day");
      return [yesterday.toDate(), yesterday.toDate()];
    }
    case "this_week":
      return [today.startOf("week").toDate(), today.toDate()];
    case "last_7_days":
      return [today.subtract(6, "day").toDate(), today.toDate()];
    case "last_14_days":
      return [today.subtract(13, "day").toDate(), today.toDate()];
    case "this_month":
      return [today.startOf("month").toDate(), today.toDate()];
    case "last_30_days":
      return [today.subtract(29, "day").toDate(), today.toDate()];
    case "last_month": {
      const lastMonthEnd = today.startOf("month").subtract(1, "day");
      return [lastMonthEnd.startOf("month").toDate(), lastMonthEnd.toDate()];
    }
  }
};

const InfoPair = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) => (
  <Stack gap={2} align="center" style={{ minWidth: 0 }}>
    <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
      {label}
    </Text>
    <Text size="xs" fw={700} c={accent} ta="center" style={{ whiteSpace: "nowrap" }}>
      {value}
    </Text>
  </Stack>
);

const MetricCard = ({
  label,
  value,
  description,
  accent,
}: {
  label: string;
  value: string;
  description: string;
  accent: string;
}) => (
  <Paper
    withBorder
    radius="lg"
    p="md"
    style={{
      background: "linear-gradient(180deg, var(--mantine-color-body) 0%, var(--mantine-color-gray-0) 100%)",
      borderColor: "var(--mantine-color-gray-3)",
    }}
  >
    <Stack gap={6} align="center" justify="center">
      <Group gap={8} justify="center" wrap="nowrap">
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "999px",
            backgroundColor: `var(--mantine-color-${accent}-6)`,
            display: "inline-block",
          }}
        />
        <Text
          size="10px"
          fw={700}
          tt="uppercase"
          c="dimmed"
          style={{ letterSpacing: "0.12em", textAlign: "center", lineHeight: 1.2 }}
        >
          {label}
        </Text>
      </Group>
      <Text
        fw={800}
        ta="center"
        c="dark"
        style={{
          fontSize: "clamp(1.1rem, 2vw, 1.8rem)",
          lineHeight: 1.1,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </Text>
      <Text size="xs" c="dimmed" ta="center" style={{ lineHeight: 1.35, maxWidth: 120 }}>
        {description}
      </Text>
    </Stack>
  </Paper>
);

const SectionCard = ({
  title,
  badge,
  icon,
  children,
}: {
  title?: string;
  badge?: string | number;
  icon?: ReactNode;
  children: ReactNode;
}) => (
  <Paper withBorder radius="xl" p="md" shadow="xs">
    <Stack gap="md">
      {title || icon || badge != null ? (
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            {icon ? (
              <ThemeIcon variant="light" radius="xl" size="lg">
                {icon}
              </ThemeIcon>
            ) : null}
            {title ? <Title order={5}>{title}</Title> : null}
          </Group>
          {badge != null ? <Badge variant="light">{badge}</Badge> : null}
        </Group>
      ) : null}
      {children}
    </Stack>
  </Paper>
);

const BreakdownSection = ({
  title,
  rows,
  revenueCurrency,
  costCurrency,
  isMobile,
}: {
  title: string;
  rows: MarketingBreakdownRow[];
  revenueCurrency: string | null;
  costCurrency?: string | null;
  isMobile: boolean;
}) => (
  <SectionCard title={title} badge={rows.length} icon={<IconChartBar size={18} />}>
    {rows.length === 0 ? (
      <Text size="sm" c="dimmed">
        No data for this dimension.
      </Text>
    ) : isMobile ? (
      <Stack gap="sm">
        {rows.map((row) => (
          <Card key={`${title}-${row.label}`} withBorder radius="lg" p="md" style={{ background: "var(--mantine-color-gray-0)" }}>
            <Stack gap="sm">
              <Text
                fw={700}
                size="sm"
                ta="center"
                style={{ minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.3 }}
              >
                {row.label}
              </Text>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  alignItems: "start",
                  gap: 12,
                }}
              >
                <InfoPair label="Bookings" value={String(row.bookingCount)} />
                <InfoPair label="Revenue" value={formatMoney(row.revenue, revenueCurrency)} accent="blue" />
                <InfoPair label="Cost" value={row.cost == null ? "-" : formatMoney(row.cost, costCurrency)} accent="red" />
              </div>
            </Stack>
          </Card>
        ))}
      </Stack>
    ) : (
      <ScrollArea offsetScrollbars>
        <Table highlightOnHover stickyHeader horizontalSpacing="md" verticalSpacing="sm" miw={560}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Value</Table.Th>
              <Table.Th>Bookings</Table.Th>
              <Table.Th>Revenue</Table.Th>
              <Table.Th>Cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={`${title}-${row.label}`}>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{row.label}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{row.bookingCount}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{formatMoney(row.revenue, revenueCurrency)}</Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{row.cost == null ? "-" : formatMoney(row.cost, costCurrency)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    )}
  </SectionCard>
);

const BookingSection = ({ bookings, isMobile }: { bookings: MarketingBooking[]; isMobile: boolean }) => (
  <SectionCard title="Bookings" badge={bookings.length} icon={<IconReceipt2 size={18} />}>
    {bookings.length === 0 ? (
      <Text size="sm" c="dimmed">
        No tagged bookings for the selected range.
      </Text>
    ) : isMobile ? (
      <Stack gap="sm">
        {bookings.map((booking) => (
          <Card
            key={booking.id}
            withBorder
            radius="lg"
            p="md"
            style={{ background: "linear-gradient(180deg, var(--mantine-color-gray-0) 0%, var(--mantine-color-body) 100%)" }}
          >
            <Stack gap="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Stack gap={2} style={{ minWidth: 0 }}>
                  <Text fw={700}>{booking.platformBookingId}</Text>
                  <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                    {booking.productName ?? "-"}
                  </Text>
                </Stack>
                <Badge radius="xl" variant="light" color="gray">
                  {formatDateTime(booking.sourceReceivedAt)}
                </Badge>
              </Group>
              <SimpleGrid cols={2} spacing="sm" verticalSpacing="md">
                <InfoPair label="Guest" value={booking.guestName || "-"} />
                <InfoPair label="Revenue" value={formatMoney(booking.baseAmount, booking.currency)} accent="blue" />
                <InfoPair label="Source" value={booking.utmSource ?? "-"} />
                <InfoPair label="Medium" value={booking.utmMedium ?? "-"} />
              </SimpleGrid>
              <Stack gap={2}>
                <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: "0.06em" }}>
                  Campaign
                </Text>
                <Text size="sm">{booking.utmCampaign ?? "-"}</Text>
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    ) : (
      <ScrollArea offsetScrollbars>
        <Table highlightOnHover stickyHeader horizontalSpacing="md" verticalSpacing="sm" miw={980}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Source Received At</Table.Th>
              <Table.Th>Booking</Table.Th>
              <Table.Th>Product</Table.Th>
              <Table.Th>Guest</Table.Th>
              <Table.Th>Revenue</Table.Th>
              <Table.Th>Source</Table.Th>
              <Table.Th>Medium</Table.Th>
              <Table.Th>Campaign</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {bookings.map((booking) => (
              <Table.Tr key={booking.id}>
                <Table.Td>{formatDateTime(booking.sourceReceivedAt)}</Table.Td>
                <Table.Td>{booking.platformBookingId}</Table.Td>
                <Table.Td>{booking.productName ?? "-"}</Table.Td>
                <Table.Td>{booking.guestName || "-"}</Table.Td>
                <Table.Td>{formatMoney(booking.baseAmount, booking.currency)}</Table.Td>
                <Table.Td>{booking.utmSource ?? "-"}</Table.Td>
                <Table.Td>{booking.utmMedium ?? "-"}</Table.Td>
                <Table.Td>{booking.utmCampaign ?? "-"}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    )}
  </SectionCard>
);

const GoogleSpendSection = ({
  rows,
  currency,
  isMobile,
}: {
  rows: GoogleCostRow[];
  currency: string | null;
  isMobile: boolean;
}) => (
  <SectionCard title="Google Ads Spend" badge={rows.length} icon={<IconBrandGoogle size={18} />}>
    {rows.length === 0 ? (
      <Text size="sm" c="dimmed">
        No Google Ads spend was returned for the selected range.
      </Text>
    ) : isMobile ? (
      <Stack gap="sm">
        {rows.map((row) => (
          <Card key={`${row.campaign}-${row.medium}`} withBorder radius="lg" p="md" style={{ background: "var(--mantine-color-gray-0)" }}>
            <Stack gap="md">
              <Stack gap={2}>
                <Text size="10px" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: "0.06em" }}>
                  Campaign
                </Text>
                <Text size="sm" style={{ overflowWrap: "anywhere" }}>{row.campaign}</Text>
              </Stack>
              <SimpleGrid cols={2} spacing="sm" verticalSpacing="sm">
                <InfoPair label="Ad Group" value={row.medium} />
                <InfoPair label="Cost" value={formatMoney(row.cost, currency)} accent="red" />
              </SimpleGrid>
            </Stack>
          </Card>
        ))}
      </Stack>
    ) : (
      <ScrollArea offsetScrollbars>
        <Table highlightOnHover stickyHeader horizontalSpacing="md" verticalSpacing="sm" miw={620}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Campaign</Table.Th>
              <Table.Th>Ad Group</Table.Th>
              <Table.Th>Cost</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => (
              <Table.Tr key={`${row.campaign}-${row.medium}`}>
                <Table.Td>{row.campaign}</Table.Td>
                <Table.Td>{row.medium}</Table.Td>
                <Table.Td>{formatMoney(row.cost, currency)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    )}
  </SectionCard>
);

const MarketingChartSection = ({
  data,
  costValue,
  costCurrency,
  isMobile,
}: {
  data: MarketingTabData;
  costValue?: number;
  costCurrency?: string | null;
  isMobile: boolean;
}) => {
  const [hoveredPieSlice, setHoveredPieSlice] = useState<{ name: string; value: number } | null>(null);
  const [pieTooltipPosition, setPieTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const isSingleDay = data.dailySeries.length <= 1;
  const hasCost = typeof costValue === "number";
  const pieData = [
    { name: "Revenue", value: data.revenueTotal, color: "#228be6" },
    ...(hasCost ? [{ name: "Cost", value: costValue, color: "#e03131" }] : []),
  ].filter((entry) => entry.value > 0);
  const roas = hasCost && costValue > 0 ? data.revenueTotal / costValue : null;
  const rangeHasCost = data.dailySeries.some((point) => typeof point.cost === "number");
  const rangeHasRoas = data.dailySeries.some((point) => typeof point.roas === "number");

  return (
    <SectionCard>
      {isSingleDay ? (
        <div
          style={{ width: "100%", height: isMobile ? 280 : 320, position: "relative", outline: "none", overflow: "visible" }}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={(event) => {
            if (!hoveredPieSlice) {
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            setPieTooltipPosition({
              x: Math.min(Math.max(event.clientX - rect.left, 16), rect.width - 16),
              y: Math.min(Math.max(event.clientY - rect.top, 16), rect.height - 16),
            });
          }}
          onMouseLeave={() => {
            setPieTooltipPosition(null);
            setHoveredPieSlice(null);
          }}
        >
          {hoveredPieSlice && pieTooltipPosition ? (
            <Paper
              withBorder
              radius="md"
              p="sm"
              shadow="sm"
              style={{
                position: "absolute",
                top: pieTooltipPosition.y,
                left: pieTooltipPosition.x,
                transform:
                  pieTooltipPosition.x > (isMobile ? 170 : 210)
                    ? "translate(calc(-100% - 12px), calc(-100% - 12px))"
                    : "translate(12px, calc(-100% - 12px))",
                zIndex: 10000,
                minWidth: isMobile ? 180 : 220,
                pointerEvents: "none",
              }}
            >
              <Group justify="space-between" wrap="nowrap">
                <Text fw={700}>{hoveredPieSlice.name}:</Text>
                <Text fw={400}>
                  {formatMoney(
                    hoveredPieSlice.value,
                    hoveredPieSlice.name === "Cost" ? costCurrency : data.revenueCurrency,
                  )}
                </Text>
              </Group>
            </Paper>
          ) : null}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
            }}
          >
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="58%"
                    outerRadius="82%"
                    paddingAngle={3}
                    onMouseEnter={(_, index) => setHoveredPieSlice(pieData[index] ?? null)}
                    onMouseLeave={() => {
                      setHoveredPieSlice(null);
                      setPieTooltipPosition(null);
                    }}
                  >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                  }}
                >
                  <Stack gap={2} align="center">
                    <Text size="10px" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                      ROAS
                    </Text>
                    <Text fw={800} size="xl">
                      {roas == null ? "-" : `${roas.toFixed(2)}x`}
                    </Text>
                  </Stack>
                </div>
              </>
            ) : (
              <Group justify="center" h="100%">
                <Text c="dimmed" size="sm">
                  No chart data for the selected day.
                </Text>
              </Group>
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{ width: "100%", height: isMobile ? 280 : 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.dailySeries}
                margin={{ top: 12, right: 0, left: -4, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis tickFormatter={formatCompactNumber} tick={{ fontSize: 12 }} width={42} />
                {rangeHasRoas ? (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={isMobile ? false : { fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={isMobile ? 8 : 24}
                  />
                ) : null}
                <RechartsTooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0 || typeof label !== "string") {
                      return null;
                    }
                    const point = payload[0]?.payload as MarketingDailySeriesPoint | undefined;
                    if (!point) {
                      return null;
                    }

                    return (
                      <Paper withBorder radius="md" p="sm" shadow="sm">
                        <Stack gap={6}>
                          <Text
                            size="lg"
                            c="dark.9"
                            style={{
                              fontWeight: 900,
                              textShadow:
                                "0.55px 0 currentColor, -0.55px 0 currentColor, 0 0.35px currentColor, 0 -0.35px currentColor, 0.4px 0.4px currentColor, -0.4px -0.4px currentColor",
                              letterSpacing: "-0.02em",
                              lineHeight: 1.05,
                            }}
                          >
                            {dayjs(label).format("DD MMM YYYY")}
                          </Text>
                          <Text size="sm">
                            <Text span fw={700}>
                              Revenue:
                            </Text>{" "}
                            {formatMoney(point.revenue, data.revenueCurrency)}
                          </Text>
                          <Text size="sm">
                            <Text span fw={700}>
                              Cost:
                            </Text>{" "}
                            {point.cost == null ? "-" : formatMoney(point.cost, costCurrency)}
                          </Text>
                          <Text size="sm">
                            <Text span fw={700}>
                              ROAS:
                            </Text>{" "}
                            {point.roas == null ? "-" : `${point.roas.toFixed(2)}x`}
                          </Text>
                          <Text size="sm">
                            <Text span fw={700}>
                              Bookings:
                            </Text>{" "}
                            {point.bookingCount}
                          </Text>
                        </Stack>
                      </Paper>
                    );
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#228be6"
                  fill="#228be6"
                  fillOpacity={0.18}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                {rangeHasCost ? (
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="#e03131"
                  fill="#e03131"
                  fillOpacity={0.14}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ) : null}
                {rangeHasRoas ? (
                  <Line
                    type="monotone"
                    yAxisId="right"
                    dataKey="roas"
                    stroke="#f08c00"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ) : null}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </SectionCard>
  );
};

const TabContent = ({
  data,
  costValue,
  costCurrency,
  costLabel,
  costError,
  googleCostRows,
  isMobile,
  accent,
}: {
  data: MarketingTabData;
  costValue?: number;
  costCurrency?: string | null;
  costLabel?: string;
  costError?: string | null;
  googleCostRows?: GoogleCostRow[];
  isMobile: boolean;
  accent: string;
}) => {
  const roas =
    typeof costValue === "number" && costValue > 0 ? (data.revenueTotal > 0 ? data.revenueTotal / costValue : 0) : null;

  const breakdowns = (
    <SimpleGrid cols={{ base: 1, xl: 3 }} spacing="lg" verticalSpacing="lg">
      <BreakdownSection
        title="Source Totals"
        rows={data.sourceBreakdown}
        revenueCurrency={data.revenueCurrency}
        costCurrency={costCurrency}
        isMobile={isMobile}
      />
      <BreakdownSection
        title="Medium Totals"
        rows={data.mediumBreakdown}
        revenueCurrency={data.revenueCurrency}
        costCurrency={costCurrency}
        isMobile={isMobile}
      />
      <BreakdownSection
        title="Campaign Totals"
        rows={data.campaignBreakdown}
        revenueCurrency={data.revenueCurrency}
        costCurrency={costCurrency}
        isMobile={isMobile}
      />
    </SimpleGrid>
  );

  return (
    <Stack gap="lg">
      {costError ? (
        <Alert color="yellow" radius="lg" title="Google Ads cost unavailable">
          {costError}
        </Alert>
      ) : null}

      <Group grow wrap="nowrap" align="stretch">
        <div style={{ flex: 1, minWidth: 0 }}>
          <MetricCard
            label="Revenue"
            value={formatMoney(data.revenueTotal, data.revenueCurrency)}
            description={`${data.bookingCount} booking${data.bookingCount === 1 ? "" : "s"}`}
            accent="blue"
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MetricCard
            label={costLabel ?? "Cost"}
            value={typeof costValue === "number" ? formatMoney(costValue, costCurrency) : "-"}
            description={typeof costValue === "number" ? "Spent" : "Cost is not available for this source"}
            accent={accent}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <MetricCard
            label="ROAS"
            value={roas == null ? "-" : `${roas.toFixed(2)}x`}
            description={roas == null ? "Revenue only" : "Revenue/Cost"}
            accent="orange"
          />
        </div>
      </Group>

      <MarketingChartSection data={data} costValue={costValue} costCurrency={costCurrency} isMobile={isMobile} />

      {isMobile ? (
        <Accordion variant="separated" radius="lg">
          <Accordion.Item value="breakdowns">
            <Accordion.Control>
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon variant="light" radius="xl" size="lg" color={accent}>
                  <IconChartBar size={18} />
                </ThemeIcon>
                <Text fw={600}>Breakdowns</Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>{breakdowns}</Accordion.Panel>
          </Accordion.Item>

          {googleCostRows ? (
            <Accordion.Item value="spend">
              <Accordion.Control>
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon variant="light" radius="xl" size="lg" color={accent}>
                    <IconBrandGoogle size={18} />
                  </ThemeIcon>
                  <Text fw={600}>Spend Details</Text>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <GoogleSpendSection rows={googleCostRows} currency={costCurrency ?? null} isMobile={isMobile} />
              </Accordion.Panel>
            </Accordion.Item>
          ) : null}

          <Accordion.Item value="bookings">
            <Accordion.Control>
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon variant="light" radius="xl" size="lg" color="gray">
                  <IconReceipt2 size={18} />
                </ThemeIcon>
                <Text fw={600}>Bookings</Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              <BookingSection bookings={data.bookings} isMobile={isMobile} />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      ) : (
        <>
          {breakdowns}
          <SimpleGrid cols={{ base: 1, xl: googleCostRows ? 2 : 1 }} spacing="lg" verticalSpacing="lg">
            {googleCostRows ? <GoogleSpendSection rows={googleCostRows} currency={costCurrency ?? null} isMobile={isMobile} /> : null}
            <BookingSection bookings={data.bookings} isMobile={isMobile} />
          </SimpleGrid>
        </>
      )}
    </Stack>
  );
};

const MarketingPage = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [preset, setPreset] = useState<MarketingDatePreset>("today");
  const [appliedRange, setAppliedRange] = useState<DateRangeValue>(() => getPresetRange("today"));
  const [draftRange, setDraftRange] = useState<DateRangeValue>(() => getPresetRange("today"));
  const [pickerOpened, setPickerOpened] = useState(false);
  const [data, setData] = useState<MarketingOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dispatch(navigateToPage("Marketing"));
  }, [dispatch, title]);

  const startDate = useMemo(() => dayjs(appliedRange[0] ?? new Date()).format("YYYY-MM-DD"), [appliedRange]);
  const endDate = useMemo(() => dayjs(appliedRange[1] ?? appliedRange[0] ?? new Date()).format("YYYY-MM-DD"), [appliedRange]);
  const activePresetLabel = DATE_PRESET_OPTIONS.find((option) => option.value === preset)?.label ?? "Custom";

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const next = await fetchMarketingOverview(startDate, endDate);
        if (!active) {
          return;
        }
        setData(next);
      } catch (err: unknown) {
        if (!active) {
          return;
        }
        const message = isAxiosError(err)
          ? err.response?.data?.message ?? err.message
          : "Unable to load marketing overview";
        setError(message);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [startDate, endDate]);

  const applyPreset = (value: Exclude<MarketingDatePreset, "custom">) => {
    const nextRange = getPresetRange(value);
    setPreset(value);
    setAppliedRange(nextRange);
    setDraftRange(nextRange);
    setPickerOpened(false);
  };

  const openCustomRange = () => {
    setPreset("custom");
    setDraftRange(appliedRange);
  };

  const applyCustomRange = () => {
    if (!draftRange[0] || !draftRange[1]) {
      return;
    }
    setPreset("custom");
    setAppliedRange(draftRange);
    setPickerOpened(false);
  };

  const updateDraftStart = (value: Date | null) => {
    setPreset("custom");
    setDraftRange(([_, end]) => [value, end]);
  };

  const updateDraftEnd = (value: Date | null) => {
    setPreset("custom");
    setDraftRange(([start]) => [start, value]);
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="lg">
        <Paper
          withBorder
          radius="xl"
          p={isMobile ? "md" : "lg"}
          style={{
            background: "linear-gradient(135deg, var(--mantine-color-gray-0) 0%, var(--mantine-color-blue-0) 100%)",
          }}
        >
          <Stack gap="md">
            <Group justify="center" align="center">
              <Group gap="sm" wrap="nowrap" justify="center">
                <ThemeIcon size={isMobile ? 42 : 48} radius="xl" variant="filled" color="dark">
                  <IconTargetArrow size={isMobile ? 22 : 26} />
                </ThemeIcon>
                <Stack gap={0} align="center">
                  <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: "0.08em" }}>
                    Performance
                  </Text>
                  <Title order={isMobile ? 2 : 1}>{title}</Title>
                </Stack>
              </Group>
            </Group>

            <Popover
              opened={pickerOpened}
              onChange={setPickerOpened}
              width={isMobile ? "target" : 760}
              position="bottom"
              shadow="md"
              withArrow
              trapFocus
            >
              <Popover.Target>
                <Paper
                  component="button"
                  type="button"
                  withBorder
                  radius="xl"
                  p={isMobile ? "md" : "lg"}
                  onClick={() => setPickerOpened((current) => !current)}
                  style={{
                    width: "100%",
                    cursor: "pointer",
                    background: "var(--mantine-color-body)",
                    borderColor: "var(--mantine-color-gray-3)",
                  }}
                >
                  <Stack gap={4} align="center">
                    <Text size="10px" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: "0.12em" }}>
                      {activePresetLabel}
                    </Text>
                    <Group gap="xs" wrap="nowrap" justify="center">
                      <IconCalendarEvent size={16} />
                      <Text fw={600} ta="center">
                        {formatDisplayRange(appliedRange)}
                      </Text>
                      <IconChevronDown size={16} />
                    </Group>
                  </Stack>
                </Paper>
              </Popover.Target>

              <Popover.Dropdown p={isMobile ? "sm" : "md"}>
                <SimpleGrid cols={{ base: 1, md: preset === "custom" ? 2 : 1 }} spacing="md">
                  <Stack gap={6}>
                    {DATE_PRESET_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        variant={preset === option.value ? "filled" : "subtle"}
                        color={preset === option.value ? "dark" : "gray"}
                        styles={{ inner: { justifyContent: "flex-start" } }}
                        onClick={() => {
                          if (option.value === "custom") {
                            openCustomRange();
                            return;
                          }
                          applyPreset(option.value);
                        }}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </Stack>

                  {preset === "custom" && (
                    <Stack gap="sm">
                      <Group grow>
                        <div style={{ position: "relative", width: "100%" }}>
                          <Text
                            size="10px"
                            fw={700}
                            c="dimmed"
                            style={{
                              position: "absolute",
                              top: -5,
                              left: 10,
                              zIndex: 1,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              background: "var(--mantine-color-body)",
                              paddingInline: 4,
                              lineHeight: 1,
                              pointerEvents: "none",
                            }}
                          >
                            Start
                          </Text>
                          <DatePickerInput
                            value={draftRange[0]}
                            onChange={updateDraftStart}
                            valueFormat="DD/MM/YYYY"
                            maxDate={draftRange[1] ?? undefined}
                            clearable={false}
                            styles={{ input: { paddingTop: 14, paddingBottom: 8, textAlign: "center" } }}
                          />
                        </div>
                        <div style={{ position: "relative", width: "100%" }}>
                          <Text
                            size="10px"
                            fw={700}
                            c="dimmed"
                            style={{
                              position: "absolute",
                              top: -5,
                              left: 10,
                              zIndex: 1,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              background: "var(--mantine-color-body)",
                              paddingInline: 4,
                              lineHeight: 1,
                              pointerEvents: "none",
                            }}
                          >
                            End
                          </Text>
                          <DatePickerInput
                            value={draftRange[1]}
                            onChange={updateDraftEnd}
                            valueFormat="DD/MM/YYYY"
                            minDate={draftRange[0] ?? undefined}
                            maxDate={new Date()}
                            clearable={false}
                            styles={{ input: { paddingTop: 14, paddingBottom: 8, textAlign: "center" } }}
                          />
                        </div>
                      </Group>
                      <DatePicker
                        type="range"
                        value={draftRange}
                        onChange={(value) => {
                          setPreset("custom");
                          setDraftRange(value);
                        }}
                        numberOfColumns={isMobile ? 1 : 2}
                        maxDate={new Date()}
                        allowSingleDateInRange
                      />
                      <Group justify="flex-end">
                        <Button
                          variant="default"
                          onClick={() => {
                            setDraftRange(appliedRange);
                            setPickerOpened(false);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button color="dark" onClick={applyCustomRange} disabled={!draftRange[0] || !draftRange[1]}>
                          Apply
                        </Button>
                      </Group>
                    </Stack>
                  )}
                </SimpleGrid>
              </Popover.Dropdown>
            </Popover>
          </Stack>
        </Paper>

        {error ? (
          <Alert color="red" radius="lg" title="Failed to load marketing data">
            {error}
          </Alert>
        ) : null}

        {loading && !data ? (
          <Paper withBorder radius="xl" p="xl">
            <Group justify="center">
              <Loader />
            </Group>
          </Paper>
        ) : null}

        {data ? (
          <Tabs defaultValue="overall" keepMounted={false} variant="pills" radius="xl" color="dark">
            <Tabs.List grow style={{ gap: isMobile ? 6 : 12 }}>
              <Tabs.Tab
                value="overall"
                leftSection={isMobile ? undefined : <IconChartBar size={16} />}
                style={{ minWidth: 0, paddingInline: isMobile ? 8 : 16, minHeight: isMobile ? 38 : 42, fontSize: isMobile ? "0.85rem" : undefined }}
              >
                Overall
              </Tabs.Tab>
              <Tabs.Tab
                value="google"
                leftSection={isMobile ? undefined : <IconBrandGoogle size={16} />}
                style={{ minWidth: 0, paddingInline: isMobile ? 8 : 16, minHeight: isMobile ? 38 : 42, fontSize: isMobile ? "0.85rem" : undefined }}
              >
                Google Ads
              </Tabs.Tab>
              <Tabs.Tab
                value="meta"
                leftSection={isMobile ? undefined : <IconBrandMeta size={16} />}
                style={{ minWidth: 0, paddingInline: isMobile ? 8 : 16, minHeight: isMobile ? 38 : 42, fontSize: isMobile ? "0.85rem" : undefined }}
              >
                Meta Ads
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="overall" pt="lg">
              <TabContent
                data={data.overall}
                costValue={data.overall.googleAdsCost}
                costCurrency={data.overall.googleCostCurrency}
                costLabel="Cost"
                isMobile={Boolean(isMobile)}
                accent="red"
              />
            </Tabs.Panel>

            <Tabs.Panel value="google" pt="lg">
              <TabContent
                data={data.googleAds}
                costValue={data.googleAds.googleAdsCost}
                costCurrency={data.googleAds.costCurrency}
                costLabel="Cost"
                costError={data.googleAds.costError}
                googleCostRows={data.googleAds.googleCostRows}
                isMobile={Boolean(isMobile)}
                accent="red"
              />
            </Tabs.Panel>

            <Tabs.Panel value="meta" pt="lg">
              <TabContent data={data.metaAds} isMobile={Boolean(isMobile)} accent="pink" />
            </Tabs.Panel>
          </Tabs>
        ) : null}
      </Stack>
    </PageAccessGuard>
  );
};

export default MarketingPage;
