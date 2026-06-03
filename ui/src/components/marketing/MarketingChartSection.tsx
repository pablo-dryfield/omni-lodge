import { type ReactElement, type ReactNode, useState } from "react";
import { Group, Paper, Stack, Text } from "@mantine/core";
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
import type { MarketingDailySeriesPoint, MarketingTabData } from "../../api/marketing";

type MarketingChartSectionProps = {
  costCurrency?: string | null;
  costValue?: number;
  data: MarketingTabData;
  formatCompactNumber: (value: number) => string;
  formatCount: (value: number) => string;
  formatMoney: (value: number, currency?: string | null) => string;
  isMobile: boolean;
  sectionCard: (children: ReactNode) => ReactElement;
};

const MarketingChartSection = ({
  costCurrency,
  costValue,
  data,
  formatCompactNumber,
  formatCount,
  formatMoney,
  isMobile,
  sectionCard,
}: MarketingChartSectionProps) => {
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
  const rangeHasClicks = data.dailySeries.some((point) => typeof point.clicks === "number");

  return sectionCard(
    isSingleDay ? (
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
                  <Text size="xs" c="dimmed" fw={600}>
                    Clicks: {data.clickTotal == null ? "-" : formatCount(data.clickTotal)}
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
            {rangeHasClicks ? <YAxis yAxisId="clicks" hide domain={[0, "dataMax"]} /> : null}
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
                          Clicks:
                        </Text>{" "}
                        {point.clicks == null ? "-" : formatCount(point.clicks)}
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
            {rangeHasClicks ? (
              <Line
                type="monotone"
                yAxisId="clicks"
                dataKey="clicks"
                stroke="#5f3dc4"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    ),
  );
};

export default MarketingChartSection;
