import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Group, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import dayjs from "dayjs";
import axiosInstance from "../../utils/axiosInstance";

type StripeRefund = {
  id: string;
  amount: number;
  currency: string;
  status?: string | null;
  reason?: string | null;
  created: number;
  charge?: string | null;
  payment_intent?: string | null;
};

type RefundListResponse = {
  data: StripeRefund[];
  has_more?: boolean;
};

const getStatusColor = (status: string | null | undefined): string => {
  switch (status) {
    case "succeeded":
      return "green";
    case "pending":
      return "yellow";
    case "failed":
      return "red";
    default:
      return "gray";
  }
};

const formatAmount = (amount: number, currency: string): string => {
  const major = (amount / 100).toFixed(2);
  return `${major} ${currency.toUpperCase()}`;
};

const formatReason = (reason?: string | null): string => {
  if (!reason) {
    return "—";
  }
  return reason.replace(/_/g, " ");
};

const FinanceRefunds = () => {
  const [refunds, setRefunds] = useState<StripeRefund[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRefunds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axiosInstance.get<RefundListResponse>("/finance/refunds", {
        withCredentials: true,
      });
      const data = Array.isArray(response.data.data) ? response.data.data : [];
      setRefunds(data);
      setHasMore(Boolean(response.data.has_more));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load refunds.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRefunds();
  }, [fetchRefunds]);

  const refundRows = useMemo(
    () =>
      refunds.map((refund) => ({
        ...refund,
        createdLabel: dayjs.unix(refund.created).format("YYYY-MM-DD HH:mm"),
        source: refund.charge ?? refund.payment_intent ?? "—",
      })),
    [refunds],
  );

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>Refunds</Title>
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={() => fetchRefunds()}
          loading={loading}
        >
          Refresh
        </Button>
      </Group>

      <ScrollArea offsetScrollbars type="auto">
        <Table striped highlightOnHover withColumnBorders miw={900}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Created</Table.Th>
              <Table.Th>Refund</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Reason</Table.Th>
              <Table.Th>Charge / PI</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {refundRows.map((refund) => (
              <Table.Tr key={refund.id}>
                <Table.Td>{refund.createdLabel}</Table.Td>
                <Table.Td>{refund.id}</Table.Td>
                <Table.Td>{formatAmount(refund.amount, refund.currency)}</Table.Td>
                <Table.Td>
                  <Badge color={getStatusColor(refund.status)} variant="light">
                    {(refund.status ?? "unknown").toUpperCase()}
                  </Badge>
                </Table.Td>
                <Table.Td>{formatReason(refund.reason)}</Table.Td>
                <Table.Td>{refund.source}</Table.Td>
              </Table.Tr>
            ))}
            {refundRows.length === 0 && !loading && (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text size="sm" c="dimmed">
                    No refunds available.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {error && (
        <Text size="sm" c="red">
          {error}
        </Text>
      )}
      {hasMore && (
        <Text size="sm" c="dimmed">
          Showing the first {refunds.length} refunds. Update the API query to load more.
        </Text>
      )}
    </Stack>
  );
};

export default FinanceRefunds;
