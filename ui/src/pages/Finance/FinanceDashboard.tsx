import { useEffect, useMemo } from "react";
import { Badge, Button, Group, SimpleGrid, Stack, Text, ThemeIcon } from "@mantine/core";
import {
  IconArrowDownRight,
  IconArrowUpRight,
  IconArrowsExchange,
  IconBuildingBank,
  IconChartBar,
  IconClipboardCheck,
  IconPlus,
  IconReceipt2,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  fetchFinanceAccounts,
  fetchFinanceManagementRequests,
  fetchFinanceTransactions,
} from "../../actions/financeActions";
import {
  selectFinanceAccounts,
  selectFinanceManagementRequests,
  selectFinanceTransactions,
} from "../../selectors/financeSelectors";
import { useFinanceBootstrap } from "../../hooks/useFinanceBootstrap";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import {
  FinanceEmptyState,
  FinanceErrorState,
  FinanceLoadingState,
  FinanceMetricCard,
  FinancePageHeader,
  FinancePanel,
  FinancePrimaryAction,
  FinanceRecordCard,
} from "../../components/finance/FinanceUi";
import {
  formatFinanceDate,
  formatFinanceMoneyMinor,
  humanizeFinanceValue,
} from "../../components/finance/financeFormatters";
import type { FinanceTransaction } from "../../types/finance";

const RECENT_SAMPLE_LIMIT = 10;

const transactionIcon = (transaction: FinanceTransaction) => {
  if (transaction.kind === "income" || transaction.kind === "refund") {
    return <IconArrowUpRight size={18} />;
  }
  if (transaction.kind === "expense") {
    return <IconArrowDownRight size={18} />;
  }
  return <IconArrowsExchange size={18} />;
};

const transactionColor = (transaction: FinanceTransaction) => {
  if (transaction.kind === "income" || transaction.kind === "refund") {
    return "green";
  }
  if (transaction.kind === "expense") {
    return "red";
  }
  return "blue";
};

const summariseByCurrency = (transactions: FinanceTransaction[], status: FinanceTransaction["status"]) => {
  const matching = transactions.filter((transaction) => transaction.status === status);
  const byCurrency = matching.reduce<Record<string, number>>((totals, transaction) => {
    const currency = transaction.currency.toUpperCase();
    totals[currency] = (totals[currency] ?? 0) + Number(transaction.amountMinor);
    return totals;
  }, {});
  const entries = Object.entries(byCurrency).sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return { value: "None", detail: "No matching items in this sample" };
  }
  if (entries.length === 1) {
    const [currency, amountMinor] = entries[0];
    return {
      value: formatFinanceMoneyMinor(amountMinor, currency),
      detail: `${matching.length} ${matching.length === 1 ? "transaction" : "transactions"}`,
    };
  }

  return {
    value: `${entries.length} currencies`,
    detail: entries.map(([currency, amountMinor]) => formatFinanceMoneyMinor(amountMinor, currency)).join(" · "),
  };
};

const FinanceDashboard = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  useFinanceBootstrap();

  useEffect(() => {
    dispatch(fetchFinanceTransactions({ limit: RECENT_SAMPLE_LIMIT }));
    dispatch(fetchFinanceManagementRequests());
  }, [dispatch]);

  const accounts = useAppSelector(selectFinanceAccounts);
  const transactions = useAppSelector(selectFinanceTransactions);
  const managementRequests = useAppSelector(selectFinanceManagementRequests);

  const activeAccounts = accounts.data.filter((account) => account.isActive);
  const activeCurrencies = Array.from(new Set(activeAccounts.map((account) => account.currency.toUpperCase()))).sort();
  const openRequests = managementRequests.data.filter(
    (request) => request.status === "open" || request.status === "returned",
  );
  const plannedSample = useMemo(
    () => summariseByCurrency(transactions.data, "planned"),
    [transactions.data],
  );
  const paidSample = useMemo(
    () => summariseByCurrency(transactions.data, "paid"),
    [transactions.data],
  );

  const isLoading = accounts.loading || transactions.loading || managementRequests.loading;
  const error = accounts.error || transactions.error || managementRequests.error;

  const retryDashboard = () => {
    dispatch(fetchFinanceAccounts());
    dispatch(fetchFinanceTransactions({ limit: RECENT_SAMPLE_LIMIT }));
    dispatch(fetchFinanceManagementRequests());
  };

  const openNewTransaction = () => {
    navigate("/finance/transactions", { state: { create: true } });
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.finance}>
      <Stack gap="lg">
        <FinancePageHeader
          eyebrow="Finance overview"
          title="Financial operations"
          description="Review active accounts, pending decisions, and the latest recorded activity."
          icon={<IconChartBar size={24} />}
          actions={
            <Group gap="sm" wrap="wrap">
              <Button variant="light" leftSection={<IconChartBar size={17} />} onClick={() => navigate("/finance/reports")}>
                Open reports
              </Button>
              <FinancePrimaryAction
                leftSection={<IconPlus size={17} />}
                onClick={openNewTransaction}
              >
                Record transaction
              </FinancePrimaryAction>
            </Group>
          }
        />

        {error ? <FinanceErrorState message={error} onRetry={retryDashboard} /> : null}

        <SimpleGrid cols={{ base: 1, xs: 2, xl: 4 }} spacing="md">
          <FinanceMetricCard
            label="Active accounts"
            value={isLoading && accounts.data.length === 0 ? "—" : activeAccounts.length}
            description="Cash, bank, and payment accounts currently enabled"
            icon={<IconBuildingBank size={22} />}
            accent="blue"
            detail={
              activeCurrencies.length > 0 ? (
                <Badge variant="light" color="blue">
                  {activeCurrencies.join(" · ")}
                </Badge>
              ) : null
            }
          />
          <FinanceMetricCard
            label="Open requests"
            value={isLoading && managementRequests.data.length === 0 ? "—" : openRequests.length}
            description="Open or returned management requests requiring attention"
            icon={<IconClipboardCheck size={22} />}
            accent={openRequests.length > 0 ? "orange" : "green"}
          />
          <FinanceMetricCard
            label="Planned in recent sample"
            value={isLoading && transactions.data.length === 0 ? "—" : plannedSample.value}
            description={`Only the latest ${RECENT_SAMPLE_LIMIT} loaded transactions`}
            icon={<IconReceipt2 size={22} />}
            accent="violet"
            detail={
              <Text size="xs" c="dimmed" ta="right" lineClamp={2}>
                {plannedSample.detail}
              </Text>
            }
          />
          <FinanceMetricCard
            label="Paid in recent sample"
            value={isLoading && transactions.data.length === 0 ? "—" : paidSample.value}
            description={`Only the latest ${RECENT_SAMPLE_LIMIT} loaded transactions`}
            icon={<IconReceipt2 size={22} />}
            accent="green"
            detail={
              <Text size="xs" c="dimmed" ta="right" lineClamp={2}>
                {paidSample.detail}
              </Text>
            }
          />
        </SimpleGrid>

        <FinancePanel
          title="Latest activity"
          description={`The newest ${Math.min(transactions.data.length, RECENT_SAMPLE_LIMIT)} of ${transactions.meta.count || transactions.data.length} recorded transactions`}
          icon={<IconReceipt2 size={19} />}
          actions={
            <Button variant="subtle" size="xs" onClick={() => navigate("/finance/transactions")}>
              View all
            </Button>
          }
        >
          {transactions.loading && transactions.data.length === 0 ? (
            <FinanceLoadingState label="Loading recent activity" />
          ) : transactions.data.length === 0 ? (
            <FinanceEmptyState
              title="No transactions yet"
              description="Record an expense, income, refund, or transfer to begin building your finance history."
              icon={<IconReceipt2 size={25} />}
              action={
                <FinancePrimaryAction leftSection={<IconPlus size={16} />} onClick={openNewTransaction}>
                  Record transaction
                </FinancePrimaryAction>
              }
            />
          ) : (
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
              {transactions.data.slice(0, 6).map((transaction) => {
                const sign = transaction.kind === "income" || transaction.kind === "refund"
                  ? "+"
                  : transaction.kind === "transfer"
                    ? ""
                    : "−";
                const amount = `${sign}${formatFinanceMoneyMinor(Math.abs(transaction.amountMinor), transaction.currency)}`;
                const accountName =
                  transaction.account?.name ??
                  accounts.data.find((account) => account.id === transaction.accountId)?.name ??
                  `Account #${transaction.accountId}`;

                return (
                  <FinanceRecordCard
                    key={transaction.id}
                    title={transaction.description || humanizeFinanceValue(transaction.kind)}
                    subtitle={`${humanizeFinanceValue(transaction.kind)} · ${formatFinanceDate(transaction.date)}`}
                    leading={
                      <ThemeIcon variant="light" color={transactionColor(transaction)} radius="xl" size={40}>
                        {transactionIcon(transaction)}
                      </ThemeIcon>
                    }
                    status={
                      <Badge variant="light" color={transaction.status === "void" ? "gray" : "blue"}>
                        {humanizeFinanceValue(transaction.status)}
                      </Badge>
                    }
                    fields={[
                      { label: "Amount", value: <Text fw={800}>{amount}</Text> },
                      { label: "Account", value: <Text size="sm">{accountName}</Text> },
                      {
                        label: "Category",
                        value: <Text size="sm">{transaction.category?.name ?? "Uncategorised"}</Text>,
                      },
                      { label: "Transaction", value: <Text size="sm">#{transaction.id}</Text> },
                    ]}
                  />
                );
              })}
            </SimpleGrid>
          )}
        </FinancePanel>
      </Stack>
    </PageAccessGuard>
  );
};

export default FinanceDashboard;
