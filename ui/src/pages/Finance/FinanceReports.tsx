import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Card,
  Grid,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";
import { isAxiosError } from "axios";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ProfitLossMonthlyPoint = {
  month: string;
  label: string;
  income: number;
  expense: number;
  net: number;
};

type CashFlowTimelinePoint = {
  month: string;
  label: string;
  inflow: number;
  outflow: number;
};

type TopCategory = {
  categoryId: number | null;
  categoryName: string;
  total: number;
};

type BudgetRow = {
  categoryId: number | null;
  categoryName: string;
  budget: number;
  actual: number;
  variance: number;
};

type FinanceReportsResponse = {
  period: { start: string; end: string };
  currency: string;
  profitAndLoss: {
    totals: { income: number; expense: number; net: number };
    monthly: ProfitLossMonthlyPoint[];
    topCategories: TopCategory[];
  };
  cashFlow: {
    totals: { inflow: number; outflow: number; net: number };
    timeline: CashFlowTimelinePoint[];
  };
  budgetsVsActual: {
    rows: BudgetRow[];
    totals: { budget: number; actual: number; variance: number };
  };
};

type DatePreset = "six_months" | "ytd" | "custom";

const FinanceReports = () => {
  const [preset, setPreset] = useState<DatePreset>("six_months");
  const [customRange, setCustomRange] = useState<[Date | null, Date | null]>([null, null]);
  const [data, setData] = useState<FinanceReportsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = useMemo(() => {
    if (preset === "custom" && customRange[0] && customRange[1]) {
      return {
        startDate: dayjs(customRange[0]).startOf("month"),
        endDate: dayjs(customRange[1]).endOf("month"),
      };
    }
    const end = dayjs().endOf("month");
    if (preset === "ytd") {
      return {
        startDate: end.startOf("year"),
        endDate: end,
      };
    }
    return {
      startDate: end.startOf("month").subtract(6 - 1, "month"),
      endDate: end,
    };
  }, [preset, customRange]);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await axiosInstance.get<FinanceReportsResponse>("/finance/reports", {
          params: {
            startDate: startDate.format("YYYY-MM-DD"),
            endDate: endDate.format("YYYY-MM-DD"),
          },
        });
        setData(response.data);
      } catch (err: unknown) {
        const message = isAxiosError(err)
          ? err.response?.data?.message ?? err.message
          : "Unable to load finance reports";
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    void fetchReports();
  }, [startDate, endDate]);

  const currency = data?.currency ?? "PLN";
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(value);

  const renderSummaryCard = (title: string, value: number, description?: string, color?: string) => (
    <Card withBorder padding="lg">
      <Stack gap={4}>
        <Text size="sm" c="dimmed">
          {title}
        </Text>
        <Title order={3} c={color}>
          {formatCurrency(value)}
        </Title>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
    </Card>
  );

  const monthlyPnL = data?.profitAndLoss.monthly ?? [];
  const cashFlowTimeline = data?.cashFlow.timeline ?? [];
  const budgetRows = data?.budgetsVsActual.rows ?? [];

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <Stack gap={4}>
          <Title order={3}>Finance reports</Title>
          <Text size="sm" c="dimmed">
            Showing {startDate.format("MMM YYYY")} – {endDate.format("MMM YYYY")}
          </Text>
        </Stack>
        <Group wrap="wrap" gap="sm">
          <SegmentedControl
            value={preset}
            onChange={(value) => setPreset(value as DatePreset)}
            data={[
              { label: "Last 6 months", value: "six_months" },
              { label: "YTD", value: "ytd" },
              { label: "Custom", value: "custom" },
            ]}
          />
          {preset === "custom" && (
            <DatePickerInput
              type="range"
              value={customRange}
              onChange={(value) => setCustomRange(value ?? [null, null])}
              allowSingleDateInRange={false}
              label="Custom range"
              valueFormat="MMM YYYY"
            />
          )}
        </Group>
      </Group>

      {error && (
        <Alert color="red" title="Unable to load finance reports">
          {error}
        </Alert>
      )}

      {loading && (
        <Group justify="center" my="lg">
          <Loader />
        </Group>
      )}

      {!loading && data && (
        <Tabs defaultValue="pl">
          <Tabs.List>
            <Tabs.Tab value="pl">Profit &amp; Loss</Tabs.Tab>
            <Tabs.Tab value="cf">Cash Flow</Tabs.Tab>
            <Tabs.Tab value="bva">Budgets vs Actual</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="pl" pt="md">
            <Stack gap="lg">
              <Grid>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  {renderSummaryCard("Income", data.profitAndLoss.totals.income)}
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  {renderSummaryCard("Expenses", data.profitAndLoss.totals.expense)}
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  {renderSummaryCard(
                    "Net",
                    data.profitAndLoss.totals.net,
                    undefined,
                    data.profitAndLoss.totals.net >= 0 ? "green" : "red"
                  )}
                </Grid.Col>
              </Grid>
              <Card withBorder padding="lg">
                <Title order={4} mb="sm">
                  Monthly performance
                </Title>
                {monthlyPnL.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No transactions recorded in this range.
                  </Text>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={monthlyPnL}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(label) => label}
                      />
                      <Legend />
                      <Bar dataKey="income" name="Income" fill="#2f9e44" />
                      <Bar dataKey="expense" name="Expenses" fill="#f03e3e" />
                      <Line
                        type="monotone"
                        dataKey="net"
                        name="Net"
                        stroke="#1c7ed6"
                        strokeWidth={2}
                        dot={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
              <Card withBorder padding="lg">
                <Title order={4} mb="sm">
                  Top expense categories
                </Title>
                {data.profitAndLoss.topCategories.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No categorized expenses in this range.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {data.profitAndLoss.topCategories.map((category) => (
                      <Group justify="space-between" key={`${category.categoryId ?? "uncat"}`}>
                        <Text>{category.categoryName}</Text>
                        <Text fw={600}>{formatCurrency(category.total)}</Text>
                      </Group>
                    ))}
                  </Stack>
                )}
              </Card>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="cf" pt="md">
            <Stack gap="lg">
              <Grid>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  {renderSummaryCard("Inflow", data.cashFlow.totals.inflow)}
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  {renderSummaryCard("Outflow", data.cashFlow.totals.outflow)}
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 4 }}>
                  {renderSummaryCard(
                    "Net",
                    data.cashFlow.totals.net,
                    undefined,
                    data.cashFlow.totals.net >= 0 ? "green" : "red"
                  )}
                </Grid.Col>
              </Grid>
              <Card withBorder padding="lg">
                <Title order={4} mb="sm">
                  Cash flow timeline
                </Title>
                {cashFlowTimeline.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No cash movements in this range.
                  </Text>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={cashFlowTimeline}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        labelFormatter={(label) => label}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="inflow"
                        name="Inflow"
                        stroke="#2f9e44"
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="outflow"
                        name="Outflow"
                        stroke="#f03e3e"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="bva" pt="md">
            <Stack gap="lg">
              <Card withBorder padding="lg">
                <Title order={4} mb="sm">
                  Budgets vs actual
                </Title>
                {budgetRows.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No budgets or actuals recorded in this range.
                  </Text>
                ) : (
                  <ResponsiveContainer width="100%" height={320}>
                    <BarChart data={budgetRows}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="categoryName" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => formatCurrency(value)} />
                      <Legend />
                      <Bar dataKey="budget" name="Budget" fill="#1c7ed6" />
                      <Bar dataKey="actual" name="Actual" fill="#f59f00" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
              {budgetRows.length > 0 && (
                <Card withBorder padding="lg">
                  <Title order={5} mb="sm">
                    Category detail
                  </Title>
                  <Table withColumnBorders highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Category</Table.Th>
                        <Table.Th>Budget</Table.Th>
                        <Table.Th>Actual</Table.Th>
                        <Table.Th>Variance</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {budgetRows.map((row) => (
                        <Table.Tr key={`${row.categoryId ?? "uncat"}-${row.categoryName}`}>
                          <Table.Td>{row.categoryName}</Table.Td>
                          <Table.Td>{formatCurrency(row.budget)}</Table.Td>
                          <Table.Td>{formatCurrency(row.actual)}</Table.Td>
                          <Table.Td c={row.variance >= 0 ? "green" : "red"}>
                            {formatCurrency(row.variance)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      <Table.Tr>
                        <Table.Td>
                          <Text fw={600}>Totals</Text>
                        </Table.Td>
                        <Table.Td>{formatCurrency(data.budgetsVsActual.totals.budget)}</Table.Td>
                        <Table.Td>{formatCurrency(data.budgetsVsActual.totals.actual)}</Table.Td>
                        <Table.Td c={data.budgetsVsActual.totals.variance >= 0 ? "green" : "red"}>
                          {formatCurrency(data.budgetsVsActual.totals.variance)}
                        </Table.Td>
                      </Table.Tr>
                    </Table.Tbody>
                  </Table>
                </Card>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
};

export default FinanceReports;
