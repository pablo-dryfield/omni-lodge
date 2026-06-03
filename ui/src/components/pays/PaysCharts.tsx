import { Badge, Card, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import dayjs from "dayjs";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type BucketChartEntry = {
  bucket: string;
  amount: number;
};

type DailyTrendEntry = {
  date: string;
  commission: number;
  payout: number;
};

type ComponentChartEntry = {
  name: string;
  amount: number;
};

type PaysChartsProps = {
  aggregatedBucketData: BucketChartEntry[];
  aggregatedComponentData: ComponentChartEntry[];
  bucketChartColors: string[];
  dailyTrendData: DailyTrendEntry[];
  formatCurrency: (value: number | undefined, currencyCode?: string) => string;
  totalPayout: number;
};

const PaysCharts = ({
  aggregatedBucketData,
  aggregatedComponentData,
  bucketChartColors,
  dailyTrendData,
  formatCurrency,
  totalPayout,
}: PaysChartsProps) => (
  <SimpleGrid cols={{ base: 1, md: 2 }}>
    <Card withBorder padding="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Bucket distribution</Text>
        <Badge>{aggregatedBucketData.length} buckets</Badge>
      </Group>
      {aggregatedBucketData.length === 0 ? (
        <Text size="sm" c="dimmed">
          No bucket adjustments recorded for this range.
        </Text>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Tooltip
              formatter={(value: number, name: string) => [formatCurrency(value), name]}
              labelFormatter={(label) => label}
            />
            <Pie
              data={aggregatedBucketData}
              dataKey="amount"
              nameKey="bucket"
              outerRadius={90}
              innerRadius={40}
              labelLine={false}
              label={(entry) => `${entry.bucket} ${((entry.amount / (totalPayout || 1)) * 100).toFixed(1)}%`}
            >
              {aggregatedBucketData.map((entry, index) => (
                <Cell key={entry.bucket} fill={bucketChartColors[index] ?? "#228be6"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      )}
    </Card>

    <Card withBorder padding="md">
      <Group justify="space-between" mb="sm">
        <Text fw={600}>Daily trend</Text>
        <Badge>{dailyTrendData.length} days</Badge>
      </Group>
      {dailyTrendData.length === 0 ? (
        <Text size="sm" c="dimmed">
          No daily breakdown available for this range.
        </Text>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={dailyTrendData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={(value) => dayjs(value).format("MM/DD")} />
            <YAxis tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(value: number, name: string) => [formatCurrency(value), name]}
              labelFormatter={(value) => dayjs(value).format("MMM D, YYYY")}
            />
            <Bar dataKey="commission" name="Commission" fill="#2f9e44" />
            <Bar dataKey="payout" name="Total payout" fill="#228be6" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
    {aggregatedComponentData.length > 0 && (
      <Card withBorder padding="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Top components</Text>
          <Badge>{aggregatedComponentData.length}</Badge>
        </Group>
        <Stack gap="xs">
          {aggregatedComponentData.map((component) => (
            <Group key={component.name} justify="space-between">
              <Group gap="xs">
                <Badge variant="light" color="violet">
                  {component.name}
                </Badge>
              </Group>
              <Text fw={600}>{formatCurrency(component.amount)}</Text>
            </Group>
          ))}
        </Stack>
      </Card>
    )}
  </SimpleGrid>
);

export default PaysCharts;
