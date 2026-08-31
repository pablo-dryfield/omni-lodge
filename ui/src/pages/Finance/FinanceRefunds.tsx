import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  ThemeIcon,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconReceiptRefund, IconRefresh } from "@tabler/icons-react";
import axiosInstance from "../../utils/axiosInstance";
import {
  FinanceEmptyState,
  FinanceErrorState,
  FinanceLoadingState,
  FinancePageHeader,
  FinancePanel,
  FinanceRecordCard,
  FinanceToolbar,
  financePageClass,
} from "../../components/finance/FinanceUi";
import {
  formatFinanceDate,
  formatFinanceMoneyMinor,
  getFinanceErrorMessage,
  humanizeFinanceValue,
} from "../../components/finance/financeFormatters";

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

const formatReason = (reason?: string | null): string =>
  reason ? humanizeFinanceValue(reason) : "—";

const FinanceRefunds = () => {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [refunds, setRefunds] = useState<StripeRefund[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

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
      setError(getFinanceErrorMessage(err, "Unable to load refunds."));
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
        createdLabel: formatFinanceDate(refund.created * 1000, true),
        source: refund.charge ?? refund.payment_intent ?? "—",
        statusLabel: humanizeFinanceValue(refund.status ?? "unknown"),
      })),
    [refunds],
  );

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(refundRows.map((refund) => refund.status ?? "unknown")))
        .sort()
        .map((status) => ({ value: status, label: humanizeFinanceValue(status) })),
    [refundRows],
  );

  const visibleRefunds = useMemo(() => {
    const query = search.trim().toLowerCase();
    return refundRows.filter((refund) => {
      if (statusFilter && (refund.status ?? "unknown") !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        refund.id,
        refund.source,
        refund.status,
        refund.reason,
        refund.currency,
        String(refund.amount),
      ].some((value) => String(value ?? "").toLowerCase().includes(query));
    });
  }, [refundRows, search, statusFilter]);

  const statusBadge = (refund: (typeof refundRows)[number]) => (
    <Badge color={getStatusColor(refund.status)} variant="light">
      {refund.statusLabel}
    </Badge>
  );

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        title="Refunds"
        description="Review Stripe refund activity, payment references, outcomes, and reasons."
        icon={<IconReceiptRefund size={24} />}
        actions={
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={() => void fetchRefunds()}
            loading={loading}
          >
            Refresh refunds
          </Button>
        }
      />

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search refund, reason, or payment reference"
      >
        <Select
          placeholder="All statuses"
          aria-label="Filter refunds by status"
          data={statusOptions}
          value={statusFilter}
          onChange={setStatusFilter}
          clearable
          style={{ flex: "1 1 180px", maxWidth: isMobile ? undefined : 220 }}
        />
      </FinanceToolbar>

      <FinancePanel
        title="Refund activity"
        description={`${visibleRefunds.length} of ${refundRows.length} refunds shown`}
        noPadding
      >
        {error ? (
          <FinanceErrorState message={error} onRetry={() => void fetchRefunds()} />
        ) : loading && refundRows.length === 0 ? (
          <FinanceLoadingState label="Loading refunds" />
        ) : visibleRefunds.length === 0 ? (
          <FinanceEmptyState
            icon={<IconReceiptRefund size={25} />}
            title={refundRows.length === 0 ? "No refunds yet" : "No matching refunds"}
            description={
              refundRows.length === 0
                ? "Stripe refund activity will appear here when a refund is created."
                : "Try clearing the status filter or using a broader search."
            }
          />
        ) : isMobile ? (
          <Stack gap={0} p="sm">
            {visibleRefunds.map((refund) => (
              <FinanceRecordCard
                key={refund.id}
                leading={
                  <ThemeIcon variant="light" color="red" radius="md">
                    <IconReceiptRefund size={17} />
                  </ThemeIcon>
                }
                title={formatFinanceMoneyMinor(refund.amount, refund.currency)}
                subtitle={refund.createdLabel}
                status={statusBadge(refund)}
                fields={[
                  { label: "Reason", value: formatReason(refund.reason) },
                  { label: "Payment reference", value: refund.source },
                  { label: "Refund ID", value: refund.id },
                ]}
              />
            ))}
          </Stack>
        ) : (
          <ScrollArea offsetScrollbars type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={920}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Created</Table.Th>
                  <Table.Th>Refund ID</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Reason</Table.Th>
                  <Table.Th>Charge / payment intent</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleRefunds.map((refund) => (
                  <Table.Tr key={refund.id}>
                    <Table.Td>{refund.createdLabel}</Table.Td>
                    <Table.Td>{refund.id}</Table.Td>
                    <Table.Td ta="right" fw={700}>
                      {formatFinanceMoneyMinor(refund.amount, refund.currency)}
                    </Table.Td>
                    <Table.Td>{statusBadge(refund)}</Table.Td>
                    <Table.Td>{formatReason(refund.reason)}</Table.Td>
                    <Table.Td>{refund.source}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </FinancePanel>

      {hasMore && (
        <Text size="sm" c="dimmed" ta={isMobile ? "center" : "left"}>
          Showing the most recent {refunds.length} refunds. Older refund history remains available in Stripe.
        </Text>
      )}
    </Stack>
  );
};

export default FinanceRefunds;
