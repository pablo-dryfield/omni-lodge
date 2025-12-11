import { useEffect, useMemo } from "react";
import { Card, Grid, Group, Stack, Text, Title } from "@mantine/core";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchFinanceBudgets, fetchFinanceManagementRequests, fetchFinanceTransactions } from "../../actions/financeActions";
import { selectFinanceAccounts, selectFinanceManagementRequests, selectFinanceTransactions } from "../../selectors/financeSelectors";
import { useFinanceBootstrap } from "../../hooks/useFinanceBootstrap";
import { PageAccessGuard } from "../../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

const MetricCard = ({ title, value, description }: { title: string; value: string | number; description?: string }) => (
  <Card withBorder radius="md" padding="lg">
    <Stack gap={4}>
      <Text size="xs" c="dimmed" tt="uppercase">
        {title}
      </Text>
      <Title order={3}>{value}</Title>
      {description && (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      )}
    </Stack>
  </Card>
);

const FinanceDashboard = () => {
  const dispatch = useAppDispatch();
  useFinanceBootstrap();

  useEffect(() => {
    dispatch(fetchFinanceTransactions({ limit: 10 }));
    dispatch(fetchFinanceManagementRequests());
    dispatch(fetchFinanceBudgets());
  }, [dispatch]);

  const accounts = useAppSelector(selectFinanceAccounts);
  const transactions = useAppSelector(selectFinanceTransactions);
  const managementRequests = useAppSelector(selectFinanceManagementRequests);

  const totals = useMemo(() => {
    const counts = {
      planned: 0,
      approved: 0,
      paid: 0,
      reimbursed: 0,
      void: 0,
    };
    transactions.data.forEach((transaction) => {
      counts[transaction.status as keyof typeof counts] += Number(transaction.amountMinor);
    });
    return counts;
  }, [transactions.data]);

  const openRequests = managementRequests.data.filter(
    (request) => request.status === "open" || request.status === "returned",
  );

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.finance}>
      <Stack gap="lg">
        <Title order={3}>At a glance</Title>
        <Grid>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <MetricCard
              title="Active Accounts"
              value={accounts.data.filter((account) => account.isActive).length}
              description="Includes cash, bank, and payment processors"
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <MetricCard
              title="Open Requests"
              value={openRequests.length}
              description="Management requests waiting for review"
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <MetricCard
              title="Planned Volume"
              value={(totals.planned / 100).toFixed(2)}
              description="Sum of planned transactions"
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 6, md: 3 }}>
            <MetricCard
              title="Paid Volume"
              value={(totals.paid / 100).toFixed(2)}
              description="Sum of paid transactions"
            />
          </Grid.Col>
        </Grid>
        <Stack gap="sm">
          <Title order={4}>Recent Activity</Title>
          <Stack gap="xs">
            {transactions.data.slice(0, 6).map((transaction) => (
              <Group key={transaction.id} justify="space-between" p="sm" bg="gray.0" style={{ borderRadius: 8 }}>
                <Stack gap={2}>
                  <Text fw={600}>
                    {transaction.kind.toUpperCase()} - {(transaction.amountMinor / 100).toFixed(2)} {transaction.currency}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {transaction.date} - {transaction.status.toUpperCase()}
                  </Text>
                </Stack>
                <Text size="sm" c="dimmed">
                  {transaction.description ?? "No description"}
                </Text>
              </Group>
            ))}
            {transactions.data.length === 0 && (
              <Card withBorder padding="md">
                <Text size="sm" c="dimmed">
                  No recent transactions yet. Start by recording an expense or income.
                </Text>
              </Card>
            )}
          </Stack>
        </Stack>
      </Stack>
    </PageAccessGuard>
  );
};

export default FinanceDashboard;



