import { type ReactElement, type ReactNode } from "react";
import { Group, Paper, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AffiliateDailySeriesPoint } from "../../api/affiliates";

type AffiliateChartSectionProps = {
  data: AffiliateDailySeriesPoint[];
  formatCount: (value: number) => string;
  formatMoney: (value: number, currency?: string | null) => string;
  revenueCurrency?: string | null;
  isMobile: boolean;
  sectionCard: (children: ReactNode) => ReactElement;
};

const AffiliateChartSection = ({
  data,
  formatCount,
  formatMoney,
  revenueCurrency,
  isMobile,
  sectionCard,
}: AffiliateChartSectionProps) => {
  return sectionCard(
    <div style={{ width: "100%", height: isMobile ? 300 : 360 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: -6, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(value) => dayjs(value).format("DD MMM")} />
          <YAxis yAxisId="left" tick={{ fontSize: 12 }} width={44} tickFormatter={(value: number) => formatCount(Number(value))} />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 12 }}
            width={64}
            tickFormatter={(value: number) => formatCount(Number(value))}
          />
          <RechartsTooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || payload.length === 0 || typeof label !== "string") {
                return null;
              }
              const point = payload[0]?.payload as AffiliateDailySeriesPoint | undefined;
              if (!point) {
                return null;
              }
              return (
                <Paper withBorder radius="md" p="sm" shadow="sm">
                  <Stack gap={6}>
                    <Text fw={800} size="md">
                      {dayjs(label).format("DD MMM YYYY")}
                    </Text>
                    <Text size="sm">
                      <Text span fw={700}>
                        Revenue:
                      </Text>{" "}
                      {formatMoney(point.revenue, revenueCurrency)}
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
            yAxisId="left"
            type="monotone"
            dataKey="revenue"
            stroke="#228be6"
            fill="#228be6"
            fillOpacity={0.18}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
          <Bar yAxisId="right" dataKey="bookingCount" fill="#495057" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>,
  );
};

export default AffiliateChartSection;
