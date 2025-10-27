import { Card, Grid, Tabs, Text, Title } from "@mantine/core";

const FinanceReports = () => {
  return (
    <Tabs defaultValue="pl">
      <Tabs.List>
        <Tabs.Tab value="pl">Profit & Loss</Tabs.Tab>
        <Tabs.Tab value="cf">Cash Flow</Tabs.Tab>
        <Tabs.Tab value="bva">Budgets vs Actual</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="pl" pt="md">
        <Grid>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder padding="lg">
              <Title order={4}>Monthly summary</Title>
              <Text size="sm" c="dimmed">
                Placeholder card for future P&L report.
              </Text>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 6 }}>
            <Card withBorder padding="lg">
              <Title order={4}>Top categories</Title>
              <Text size="sm" c="dimmed">
                Static data will be replaced with live analytics.
              </Text>
            </Card>
          </Grid.Col>
        </Grid>
      </Tabs.Panel>

      <Tabs.Panel value="cf" pt="md">
        <Card withBorder padding="lg">
          <Title order={4}>Cash flow timeline</Title>
          <Text size="sm" c="dimmed">
            Cash flow reporting will be implemented in future iterations.
          </Text>
        </Card>
      </Tabs.Panel>

      <Tabs.Panel value="bva" pt="md">
        <Card withBorder padding="lg">
          <Title order={4}>Budgets vs Actual</Title>
          <Text size="sm" c="dimmed">
            Compare budget allocations with actual spend once analytics are ready.
          </Text>
        </Card>
      </Tabs.Panel>
    </Tabs>
  );
};

export default FinanceReports;

