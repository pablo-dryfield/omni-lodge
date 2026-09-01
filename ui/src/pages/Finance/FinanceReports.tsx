import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Box,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
} from "@mantine/core";
import { MonthPickerInput } from "@mantine/dates";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconBuildingBank,
  IconChartBar,
  IconReportMoney,
  IconScale,
  IconSitemap,
  IconUsersGroup,
  IconWallet,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { isAxiosError } from "axios";
import axiosInstance from "../../utils/axiosInstance";
import {
  FinanceEmptyState,
  FinanceErrorState,
  FinanceLoadingState,
  FinanceMetricCard,
  FinancePageHeader,
  FinancePanel,
  FinanceToolbar,
} from "../../components/finance/FinanceUi";
import {
  formatFinanceDate,
  formatFinanceMoneyMajor,
} from "../../components/finance/financeFormatters";

const FinanceReportsChart = lazy(() => import("../../components/finance/FinanceReportsChart"));

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
  forecast?: number;
  projected?: number;
  variance: number;
  projectedVariance?: number;
};

type AccountSummaryRow = {
  accountId: number;
  name: string;
  currency: string;
  openingBalance: number;
  inflow: number;
  outflow: number;
  net: number;
  closingBalance: number;
  forecastInflow?: number;
  forecastOutflow?: number;
  forecastNet?: number;
  projectedClosingBalance?: number;
  outstanding: number;
  isActive: boolean;
};

type CategorySummaryRow = {
  categoryId: number | null;
  categoryName: string;
  amount: number;
};

type VendorSummaryRow = {
  vendorId: number;
  vendorName: string;
  total: number;
  settled: number;
  outstanding: number;
  awaitingReimbursement?: number;
  forecast?: number;
  projectedTotal?: number;
  lastActivity: string | null;
};

type ClientSummaryRow = {
  clientId: number;
  clientName: string;
  total: number;
  settled: number;
  outstanding: number;
  awaitingReimbursement?: number;
  forecast?: number;
  projectedTotal?: number;
  lastActivity: string | null;
};

type FinanceReportsResponse = {
  period: { start: string; end: string };
  currency: string;
  profitAndLoss: {
    totals: { income: number; expense: number; net: number };
    monthly: ProfitLossMonthlyPoint[];
    topCategories: TopCategory[];
    forecast?: {
      totals: { income: number; expense: number; net: number };
      monthly: ProfitLossMonthlyPoint[];
      topCategories: TopCategory[];
    };
  };
  cashFlow: {
    totals: { inflow: number; outflow: number; net: number };
    timeline: CashFlowTimelinePoint[];
    forecast?: {
      totals: { inflow: number; outflow: number; net: number };
      timeline: CashFlowTimelinePoint[];
    };
  };
  budgetsVsActual: {
    rows: BudgetRow[];
    totals: {
      budget: number;
      actual: number;
      forecast?: number;
      projected?: number;
      variance: number;
      projectedVariance?: number;
    };
  };
  accountSummary: AccountSummaryRow[];
  categorySummary: {
    income: CategorySummaryRow[];
    expense: CategorySummaryRow[];
    forecast?: {
      income: CategorySummaryRow[];
      expense: CategorySummaryRow[];
    };
  };
  vendorSummary: VendorSummaryRow[];
  clientSummary: ClientSummaryRow[];
};

type DatePreset = "six_months" | "ytd" | "custom";

const ChartFallback = () => (
  <Group justify="center" my="xl" aria-label="Loading report chart">
    <Loader size="sm" />
  </Group>
);

const FinanceReports = () => {
  const [activeTab, setActiveTab] = useState("pl");
  const [preset, setPreset] = useState<DatePreset>("six_months");
  const [customRange, setCustomRange] = useState<[Date | null, Date | null]>([null, null]);
  const [data, setData] = useState<FinanceReportsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const customRangeComplete = Boolean(customRange[0] && customRange[1]);

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
    if (preset === "custom" && !customRangeComplete) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchReports = async () => {
      try {
        setLoading(true);
        setError(null);
        setData(null);
        const response = await axiosInstance.get<FinanceReportsResponse>("/finance/reports", {
          params: {
            startDate: startDate.format("YYYY-MM-DD"),
            endDate: endDate.format("YYYY-MM-DD"),
          },
        });
        if (!cancelled) {
          setData(response.data);
        }
      } catch (err: unknown) {
        const message = isAxiosError(err)
          ? err.response?.data?.message ?? err.message
          : "Unable to load finance reports";
        if (!cancelled) {
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void fetchReports();

    return () => {
      cancelled = true;
    };
  }, [customRangeComplete, endDate, preset, reloadKey, startDate]);

  const currency = data?.currency ?? "PLN";
  const formatCurrency = (value: number) => formatFinanceMoneyMajor(value, currency);
  const formatCurrencyWithCode = (value: number, code?: string) =>
    formatFinanceMoneyMajor(value, code ?? currency);

  const renderSummaryCard = (
    title: string,
    value: number,
    description: string,
    accent: "blue" | "green" | "orange" | "violet" | "rose" | "slate",
    icon: ReactNode,
  ) => (
    <FinanceMetricCard
      label={title}
      value={formatCurrency(value)}
      description={description}
      accent={accent}
      icon={icon}
    />
  );

  const monthlyPnL = data?.profitAndLoss.monthly ?? [];
  const cashFlowTimeline = data?.cashFlow.timeline ?? [];
  const budgetRows = data?.budgetsVsActual.rows ?? [];
  const accountSummary = data?.accountSummary ?? [];
  const incomeCategorySummary = data?.categorySummary?.income ?? [];
  const expenseCategorySummary = data?.categorySummary?.expense ?? [];
  const vendorSummary = data?.vendorSummary ?? [];
  const clientSummary = data?.clientSummary ?? [];
  const pnlForecastTotals = data?.profitAndLoss.forecast?.totals ?? {
    income: 0,
    expense: 0,
    net: 0,
  };
  const cashForecastTotals = data?.cashFlow.forecast?.totals ?? {
    inflow: 0,
    outflow: 0,
    net: 0,
  };
  const forecastIncomeCategorySummary = data?.categorySummary?.forecast?.income ?? [];
  const forecastExpenseCategorySummary = data?.categorySummary?.forecast?.expense ?? [];
  const monthlyForecastPnL = data?.profitAndLoss.forecast?.monthly ?? [];
  const forecastCashFlowTimeline = data?.cashFlow.forecast?.timeline ?? [];
  const hasPnlForecast = monthlyForecastPnL.some(
    (point) => point.income !== 0 || point.expense !== 0 || point.net !== 0,
  );
  const hasCashForecast = forecastCashFlowTimeline.some(
    (point) => point.inflow !== 0 || point.outflow !== 0,
  );

  return (
    <Stack gap="lg">
      <FinancePageHeader
        eyebrow="Analysis"
        title="Finance reports"
        description={
          preset === "custom" && !customRangeComplete
            ? "Choose a starting and ending month to prepare the report."
            : `Performance from ${startDate.format("MMM YYYY")} to ${endDate.format("MMM YYYY")}, reported in ${currency}.`
        }
        icon={<IconReportMoney size={24} />}
      />

      <FinanceToolbar>
        <Box style={{ flex: "1 1 360px", minWidth: 0 }}>
          <SegmentedControl
            fullWidth
            value={preset}
            onChange={(value) => setPreset(value as DatePreset)}
            data={[
              { label: "Last 6 months", value: "six_months" },
              { label: "Year to date", value: "ytd" },
              { label: "Custom", value: "custom" },
            ]}
            aria-label="Report period"
          />
        </Box>
        {preset === "custom" ? (
          <MonthPickerInput
            type="range"
            value={customRange}
            onChange={(value) => setCustomRange(value ?? [null, null])}
            allowSingleDateInRange
            label="Custom month range"
            placeholder="Choose start and end months"
            valueFormat="MMM YYYY"
            style={{ flex: "1 1 280px" }}
            clearable
          />
        ) : null}
      </FinanceToolbar>

      {error ? (
        <FinanceErrorState message={error} onRetry={() => setReloadKey((current) => current + 1)} />
      ) : null}

      {loading ? <FinanceLoadingState label="Preparing finance reports" /> : null}

      {!loading && !data && !error ? (
        <FinancePanel>
          <FinanceEmptyState
            title="No report data available"
            description="Choose a reporting period to load financial performance and balance information."
            icon={<IconReportMoney size={25} />}
          />
        </FinancePanel>
      ) : null}

      {!loading && data ? (
        <Tabs value={activeTab} onChange={(value) => setActiveTab(value ?? "pl")} keepMounted={false}>
          <ScrollArea type="auto" offsetScrollbars scrollbarSize={6}>
            <Tabs.List style={{ flexWrap: "nowrap", minWidth: "max-content" }} aria-label="Finance report sections">
              <Tabs.Tab value="pl">Profit &amp; Loss</Tabs.Tab>
              <Tabs.Tab value="cf">Cash Flow</Tabs.Tab>
              <Tabs.Tab value="bva">Budgets vs Actual</Tabs.Tab>
              <Tabs.Tab value="accounts">Accounts</Tabs.Tab>
              <Tabs.Tab value="categories">Categories</Tabs.Tab>
              <Tabs.Tab value="counterparties">Counterparties</Tabs.Tab>
            </Tabs.List>
          </ScrollArea>

          <Tabs.Panel value="pl" pt="md">
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                {renderSummaryCard(
                  "Actual income",
                  data.profitAndLoss.totals.income,
                  "Recognised income, excluding planned and approved entries",
                  "green",
                  <IconArrowUpRight size={22} />,
                )}
                {renderSummaryCard(
                  "Actual expenses",
                  data.profitAndLoss.totals.expense,
                  "Recognised expenses in the selected range",
                  "rose",
                  <IconArrowDownRight size={22} />,
                )}
                {renderSummaryCard(
                  "Actual net result",
                  data.profitAndLoss.totals.net,
                  "Income less expenses",
                  data.profitAndLoss.totals.net >= 0 ? "blue" : "orange",
                  <IconScale size={22} />,
                )}
              </SimpleGrid>
              <FinancePanel
                title="Forecast and projected result"
                description="Planned and approved entries remain separate from actual performance"
                icon={<IconChartBar size={19} />}
              >
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                  {renderSummaryCard(
                    "Forecast income",
                    pnlForecastTotals.income,
                    "Planned and approved income",
                    "violet",
                    <IconArrowUpRight size={22} />,
                  )}
                  {renderSummaryCard(
                    "Forecast expenses",
                    pnlForecastTotals.expense,
                    "Planned and approved expenses",
                    "orange",
                    <IconArrowDownRight size={22} />,
                  )}
                  {renderSummaryCard(
                    "Projected net result",
                    data.profitAndLoss.totals.net + pnlForecastTotals.net,
                    "Actual net plus forecast net",
                    data.profitAndLoss.totals.net + pnlForecastTotals.net >= 0 ? "blue" : "rose",
                    <IconScale size={22} />,
                  )}
                </SimpleGrid>
              </FinancePanel>
              <FinancePanel
                title="Monthly performance"
                description="Income, expenses, and net result by month"
                icon={<IconChartBar size={19} />}
              >
                {monthlyPnL.length === 0 ? (
                  <FinanceEmptyState
                    title="No monthly activity"
                    description="No transactions were recorded in this reporting range."
                    icon={<IconChartBar size={25} />}
                  />
                ) : (
                  <Suspense fallback={<ChartFallback />}>
                    <FinanceReportsChart variant="profitLoss" data={monthlyPnL} formatCurrency={formatCurrency} />
                  </Suspense>
                )}
              </FinancePanel>
              {hasPnlForecast ? (
                <FinancePanel
                  title="Monthly forecast"
                  description="Planned and approved income, expenses, and net result by month"
                  icon={<IconChartBar size={19} />}
                >
                  <Suspense fallback={<ChartFallback />}>
                    <FinanceReportsChart
                      variant="profitLoss"
                      data={monthlyForecastPnL}
                      formatCurrency={formatCurrency}
                    />
                  </Suspense>
                </FinancePanel>
              ) : null}
              <FinancePanel
                title="Top expense categories"
                description="Largest expense totals in the selected period"
                icon={<IconSitemap size={19} />}
              >
                {data.profitAndLoss.topCategories.length === 0 ? (
                  <FinanceEmptyState
                    title="No categorised expenses"
                    description="Categorised expenses will appear here once they are recorded."
                    icon={<IconSitemap size={25} />}
                  />
                ) : (
                  <Stack gap={0}>
                    {data.profitAndLoss.topCategories.map((category, index) => (
                      <Group
                        justify="space-between"
                        gap="md"
                        py="sm"
                        wrap="nowrap"
                        key={`${category.categoryId ?? "uncat"}`}
                        style={index > 0 ? { borderTop: "1px solid var(--mantine-color-gray-2)" } : undefined}
                      >
                        <Text size="sm" fw={600} lineClamp={1}>
                          {category.categoryName}
                        </Text>
                        <Text size="sm" fw={800} style={{ whiteSpace: "nowrap" }}>
                          {formatCurrency(category.total)}
                        </Text>
                      </Group>
                    ))}
                  </Stack>
                )}
              </FinancePanel>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="cf" pt="md">
            <Stack gap="lg">
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                {renderSummaryCard(
                  "Actual cash inflow",
                  data.cashFlow.totals.inflow,
                  "Money received in the selected range",
                  "green",
                  <IconArrowUpRight size={22} />,
                )}
                {renderSummaryCard(
                  "Actual cash outflow",
                  data.cashFlow.totals.outflow,
                  "Money paid in the selected range",
                  "rose",
                  <IconArrowDownRight size={22} />,
                )}
                {renderSummaryCard(
                  "Actual net cash flow",
                  data.cashFlow.totals.net,
                  "Inflow less outflow",
                  data.cashFlow.totals.net >= 0 ? "blue" : "orange",
                  <IconWallet size={22} />,
                )}
              </SimpleGrid>
              <FinancePanel
                title="Forecast cash movement"
                description="Expected movement from planned and approved entries"
                icon={<IconWallet size={19} />}
              >
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                  {renderSummaryCard(
                    "Forecast inflow",
                    cashForecastTotals.inflow,
                    "Expected incoming cash",
                    "violet",
                    <IconArrowUpRight size={22} />,
                  )}
                  {renderSummaryCard(
                    "Forecast outflow",
                    cashForecastTotals.outflow,
                    "Expected outgoing cash",
                    "orange",
                    <IconArrowDownRight size={22} />,
                  )}
                  {renderSummaryCard(
                    "Projected net cash",
                    data.cashFlow.totals.net + cashForecastTotals.net,
                    "Actual cash flow plus forecast",
                    data.cashFlow.totals.net + cashForecastTotals.net >= 0 ? "blue" : "rose",
                    <IconWallet size={22} />,
                  )}
                </SimpleGrid>
              </FinancePanel>
              <FinancePanel
                title="Cash flow timeline"
                description="Cash movements across the selected months"
                icon={<IconWallet size={19} />}
              >
                {cashFlowTimeline.length === 0 ? (
                  <FinanceEmptyState
                    title="No cash movements"
                    description="There are no cash movements in this reporting range."
                    icon={<IconWallet size={25} />}
                  />
                ) : (
                  <Suspense fallback={<ChartFallback />}>
                    <FinanceReportsChart variant="cashFlow" data={cashFlowTimeline} formatCurrency={formatCurrency} />
                  </Suspense>
                )}
              </FinancePanel>
              {hasCashForecast ? (
                <FinancePanel
                  title="Forecast cash timeline"
                  description="Expected inflows and outflows from planned and approved entries"
                  icon={<IconWallet size={19} />}
                >
                  <Suspense fallback={<ChartFallback />}>
                    <FinanceReportsChart
                      variant="cashFlow"
                      data={forecastCashFlowTimeline}
                      formatCurrency={formatCurrency}
                    />
                  </Suspense>
                </FinancePanel>
              ) : null}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="bva" pt="md">
            <Stack gap="lg">
              <FinancePanel
                title="Budgets vs actual"
                description="Compare category targets with recorded spending"
                icon={<IconScale size={19} />}
              >
                {budgetRows.length === 0 ? (
                  <FinanceEmptyState
                    title="No budget comparison"
                    description="No budgets or actuals were recorded in this reporting range."
                    icon={<IconScale size={25} />}
                  />
                ) : (
                  <Suspense fallback={<ChartFallback />}>
                    <FinanceReportsChart variant="budgetVsActual" data={budgetRows} formatCurrency={formatCurrency} />
                  </Suspense>
                )}
              </FinancePanel>
              {budgetRows.length > 0 ? (
                <FinancePanel title="Category detail" description="Budget utilisation by category" noPadding>
                  <ScrollArea type="auto" offsetScrollbars>
                    <Table withColumnBorders highlightOnHover miw={940} verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Category</Table.Th>
                          <Table.Th>Budget</Table.Th>
                          <Table.Th>Actual</Table.Th>
                          <Table.Th>Forecast</Table.Th>
                          <Table.Th>Projected</Table.Th>
                          <Table.Th>Actual variance</Table.Th>
                          <Table.Th>Projected variance</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {budgetRows.map((row) => (
                          <Table.Tr key={`${row.categoryId ?? "uncat"}-${row.categoryName}`}>
                            <Table.Td>{row.categoryName}</Table.Td>
                            <Table.Td>{formatCurrency(row.budget)}</Table.Td>
                            <Table.Td>{formatCurrency(row.actual)}</Table.Td>
                            <Table.Td>{formatCurrency(row.forecast ?? 0)}</Table.Td>
                            <Table.Td fw={700}>{formatCurrency(row.projected ?? row.actual)}</Table.Td>
                            <Table.Td c={row.variance <= 0 ? "green" : "red"} fw={700}>
                              {formatCurrency(row.variance)}
                            </Table.Td>
                            <Table.Td c={(row.projectedVariance ?? row.variance) <= 0 ? "green" : "red"} fw={700}>
                              {formatCurrency(row.projectedVariance ?? row.variance)}
                            </Table.Td>
                          </Table.Tr>
                        ))}
                        <Table.Tr>
                          <Table.Td fw={800}>Totals</Table.Td>
                          <Table.Td fw={800}>{formatCurrency(data.budgetsVsActual.totals.budget)}</Table.Td>
                          <Table.Td fw={800}>{formatCurrency(data.budgetsVsActual.totals.actual)}</Table.Td>
                          <Table.Td fw={800}>{formatCurrency(data.budgetsVsActual.totals.forecast ?? 0)}</Table.Td>
                          <Table.Td fw={800}>
                            {formatCurrency(data.budgetsVsActual.totals.projected ?? data.budgetsVsActual.totals.actual)}
                          </Table.Td>
                          <Table.Td c={data.budgetsVsActual.totals.variance <= 0 ? "green" : "red"} fw={800}>
                            {formatCurrency(data.budgetsVsActual.totals.variance)}
                          </Table.Td>
                          <Table.Td
                            c={(data.budgetsVsActual.totals.projectedVariance ?? data.budgetsVsActual.totals.variance) <= 0 ? "green" : "red"}
                            fw={800}
                          >
                            {formatCurrency(
                              data.budgetsVsActual.totals.projectedVariance ?? data.budgetsVsActual.totals.variance,
                            )}
                          </Table.Td>
                        </Table.Tr>
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </FinancePanel>
              ) : null}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="accounts" pt="md">
            <FinancePanel
              title="Account balances"
              description="Opening, movement, and closing balances by account currency"
              icon={<IconBuildingBank size={19} />}
              noPadding
            >
              {accountSummary.length === 0 ? (
                <FinanceEmptyState
                  title="No account activity"
                  description="No account activity was recorded in this reporting range."
                  icon={<IconBuildingBank size={25} />}
                />
              ) : (
                <ScrollArea type="auto" offsetScrollbars>
                  <Table withColumnBorders highlightOnHover miw={1380} verticalSpacing="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Account</Table.Th>
                        <Table.Th>Currency</Table.Th>
                        <Table.Th>Opening</Table.Th>
                        <Table.Th>Inflow</Table.Th>
                        <Table.Th>Outflow</Table.Th>
                        <Table.Th>Net</Table.Th>
                        <Table.Th>Closing</Table.Th>
                        <Table.Th>Forecast in</Table.Th>
                        <Table.Th>Forecast out</Table.Th>
                        <Table.Th>Forecast net</Table.Th>
                        <Table.Th>Projected closing</Table.Th>
                        <Table.Th>Status</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {accountSummary.map((row) => (
                        <Table.Tr key={row.accountId}>
                          <Table.Td fw={700}>{row.name}</Table.Td>
                          <Table.Td>{row.currency}</Table.Td>
                          <Table.Td>{formatCurrencyWithCode(row.openingBalance, row.currency)}</Table.Td>
                          <Table.Td>{formatCurrencyWithCode(row.inflow, row.currency)}</Table.Td>
                          <Table.Td>{formatCurrencyWithCode(row.outflow, row.currency)}</Table.Td>
                          <Table.Td c={row.net >= 0 ? "green" : "red"} fw={700}>
                            {formatCurrencyWithCode(row.net, row.currency)}
                          </Table.Td>
                          <Table.Td>{formatCurrencyWithCode(row.closingBalance, row.currency)}</Table.Td>
                          <Table.Td>{formatCurrencyWithCode(row.forecastInflow ?? 0, row.currency)}</Table.Td>
                          <Table.Td>{formatCurrencyWithCode(row.forecastOutflow ?? 0, row.currency)}</Table.Td>
                          <Table.Td c={(row.forecastNet ?? row.outstanding) >= 0 ? "green" : "red"}>
                            {formatCurrencyWithCode(row.forecastNet ?? row.outstanding, row.currency)}
                          </Table.Td>
                          <Table.Td fw={700}>
                            {formatCurrencyWithCode(row.projectedClosingBalance ?? row.closingBalance, row.currency)}
                          </Table.Td>
                          <Table.Td>{row.isActive ? "Active" : "Archived"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              )}
            </FinancePanel>
          </Tabs.Panel>

          <Tabs.Panel value="categories" pt="md">
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
              <FinancePanel
                title="Income categories"
                description="Income grouped by finance category"
                icon={<IconArrowUpRight size={19} />}
                noPadding
              >
                {incomeCategorySummary.length === 0 ? (
                  <FinanceEmptyState
                    title="No income categories"
                    description="No income categories were found for this reporting period."
                    icon={<IconSitemap size={25} />}
                  />
                ) : (
                  <ScrollArea type="auto" offsetScrollbars>
                    <Table withColumnBorders highlightOnHover miw={420} verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Category</Table.Th>
                          <Table.Th ta="right">Amount</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {incomeCategorySummary.map((row) => (
                          <Table.Tr key={`${row.categoryId ?? "uncat"}-income`}>
                            <Table.Td fw={600}>{row.categoryName}</Table.Td>
                            <Table.Td ta="right">{formatCurrency(row.amount)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </FinancePanel>
              <FinancePanel
                title="Expense categories"
                description="Expenses grouped by finance category"
                icon={<IconArrowDownRight size={19} />}
                noPadding
              >
                {expenseCategorySummary.length === 0 ? (
                  <FinanceEmptyState
                    title="No expense categories"
                    description="No expenses were recorded in this reporting period."
                    icon={<IconSitemap size={25} />}
                  />
                ) : (
                  <ScrollArea type="auto" offsetScrollbars>
                    <Table withColumnBorders highlightOnHover miw={420} verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Category</Table.Th>
                          <Table.Th ta="right">Amount</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {expenseCategorySummary.map((row) => (
                          <Table.Tr key={`${row.categoryId ?? "uncat"}-expense`}>
                            <Table.Td fw={600}>{row.categoryName}</Table.Td>
                            <Table.Td ta="right">{formatCurrency(row.amount)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </FinancePanel>
            </SimpleGrid>
            {forecastIncomeCategorySummary.length > 0 || forecastExpenseCategorySummary.length > 0 ? (
              <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg" mt="lg">
                <FinancePanel
                  title="Forecast income categories"
                  description="Planned and approved income grouped by category"
                  icon={<IconArrowUpRight size={19} />}
                  noPadding
                >
                  {forecastIncomeCategorySummary.length === 0 ? (
                    <FinanceEmptyState
                      title="No forecast income"
                      description="No planned or approved income was found in this period."
                      icon={<IconSitemap size={25} />}
                    />
                  ) : (
                    <ScrollArea type="auto" offsetScrollbars>
                      <Table withColumnBorders highlightOnHover miw={420} verticalSpacing="sm">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Category</Table.Th>
                            <Table.Th ta="right">Forecast</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {forecastIncomeCategorySummary.map((row) => (
                            <Table.Tr key={`${row.categoryId ?? "uncat"}-forecast-income`}>
                              <Table.Td fw={600}>{row.categoryName}</Table.Td>
                              <Table.Td ta="right">{formatCurrency(row.amount)}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  )}
                </FinancePanel>
                <FinancePanel
                  title="Forecast expense categories"
                  description="Planned and approved expenses grouped by category"
                  icon={<IconArrowDownRight size={19} />}
                  noPadding
                >
                  {forecastExpenseCategorySummary.length === 0 ? (
                    <FinanceEmptyState
                      title="No forecast expenses"
                      description="No planned or approved expenses were found in this period."
                      icon={<IconSitemap size={25} />}
                    />
                  ) : (
                    <ScrollArea type="auto" offsetScrollbars>
                      <Table withColumnBorders highlightOnHover miw={420} verticalSpacing="sm">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>Category</Table.Th>
                            <Table.Th ta="right">Forecast</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {forecastExpenseCategorySummary.map((row) => (
                            <Table.Tr key={`${row.categoryId ?? "uncat"}-forecast-expense`}>
                              <Table.Td fw={600}>{row.categoryName}</Table.Td>
                              <Table.Td ta="right">{formatCurrency(row.amount)}</Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                  )}
                </FinancePanel>
              </SimpleGrid>
            ) : null}
          </Tabs.Panel>

          <Tabs.Panel value="counterparties" pt="md">
            <Stack gap="lg">
              <FinancePanel
                title="Vendors"
                description="Settled and outstanding vendor activity"
                icon={<IconUsersGroup size={19} />}
                noPadding
              >
                {vendorSummary.length === 0 ? (
                  <FinanceEmptyState
                    title="No vendor activity"
                    description="No vendor activity was recorded in this reporting period."
                    icon={<IconUsersGroup size={25} />}
                  />
                ) : (
                  <ScrollArea type="auto" offsetScrollbars>
                    <Table withColumnBorders highlightOnHover miw={1080} verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Vendor</Table.Th>
                          <Table.Th>Actual total</Table.Th>
                          <Table.Th>Settled</Table.Th>
                          <Table.Th>Awaiting staff reimbursement</Table.Th>
                          <Table.Th>Forecast</Table.Th>
                          <Table.Th>Projected total</Table.Th>
                          <Table.Th>Outstanding</Table.Th>
                          <Table.Th>Last activity</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {vendorSummary.map((row) => (
                          <Table.Tr key={row.vendorId}>
                            <Table.Td fw={700}>{row.vendorName}</Table.Td>
                            <Table.Td>{formatCurrency(row.total)}</Table.Td>
                            <Table.Td>{formatCurrency(row.settled)}</Table.Td>
                            <Table.Td>{formatCurrency(row.awaitingReimbursement ?? 0)}</Table.Td>
                            <Table.Td>{formatCurrency(row.forecast ?? 0)}</Table.Td>
                            <Table.Td fw={700}>{formatCurrency(row.projectedTotal ?? row.total)}</Table.Td>
                            <Table.Td c={row.outstanding >= 0 ? "red" : "green"} fw={700}>
                              {formatCurrency(row.outstanding)}
                            </Table.Td>
                            <Table.Td>{formatFinanceDate(row.lastActivity)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </FinancePanel>
              <FinancePanel
                title="Clients"
                description="Settled and outstanding client activity"
                icon={<IconUsersGroup size={19} />}
                noPadding
              >
                {clientSummary.length === 0 ? (
                  <FinanceEmptyState
                    title="No client activity"
                    description="No client transactions were recorded in this reporting period."
                    icon={<IconUsersGroup size={25} />}
                  />
                ) : (
                  <ScrollArea type="auto" offsetScrollbars>
                    <Table withColumnBorders highlightOnHover miw={1080} verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Client</Table.Th>
                          <Table.Th>Actual total</Table.Th>
                          <Table.Th>Settled</Table.Th>
                          <Table.Th>Awaiting staff reimbursement</Table.Th>
                          <Table.Th>Forecast</Table.Th>
                          <Table.Th>Projected total</Table.Th>
                          <Table.Th>Outstanding</Table.Th>
                          <Table.Th>Last activity</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {clientSummary.map((row) => (
                          <Table.Tr key={row.clientId}>
                            <Table.Td fw={700}>{row.clientName}</Table.Td>
                            <Table.Td>{formatCurrency(row.total)}</Table.Td>
                            <Table.Td>{formatCurrency(row.settled)}</Table.Td>
                            <Table.Td>{formatCurrency(row.awaitingReimbursement ?? 0)}</Table.Td>
                            <Table.Td>{formatCurrency(row.forecast ?? 0)}</Table.Td>
                            <Table.Td fw={700}>{formatCurrency(row.projectedTotal ?? row.total)}</Table.Td>
                            <Table.Td c={row.outstanding >= 0 ? "green" : "red"} fw={700}>
                              {formatCurrency(row.outstanding)}
                            </Table.Td>
                            <Table.Td>{formatFinanceDate(row.lastActivity)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                )}
              </FinancePanel>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      ) : null}
    </Stack>
  );
};

export default FinanceReports;
