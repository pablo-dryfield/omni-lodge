import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Pagination,
  ScrollArea,
  Stack,
  Table,
  Text,
  ThemeIcon,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBan,
  IconCircleCheck,
  IconExternalLink,
  IconReceipt,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import {
  getFinanceRecurringOccurrences,
  postFinanceRecurringOccurrence,
  voidFinanceRecurringOccurrence,
} from "../../api/financeRecurring";
import {
  FinanceConfirmModal,
  FinanceEmptyState,
  FinanceErrorState,
  FinanceLoadingState,
  FinancePanel,
  FinanceRecordCard,
} from "../../components/finance/FinanceUi";
import {
  formatFinanceDate,
  formatFinanceMoneyMinor,
  getFinanceErrorMessage,
  humanizeFinanceValue,
} from "../../components/finance/financeFormatters";
import type { FinanceRecurringRule, FinanceTransaction } from "../../types/finance";
import { isEditableOccurrenceStatus } from "./financeRecurringRules";
import classes from "./FinanceRecurring.module.css";

const PAGE_SIZE = 10;

type OccurrenceAction = {
  mode: "post" | "void";
  transaction: FinanceTransaction;
};

type FinanceRecurringOccurrencesProps = {
  rule: FinanceRecurringRule;
  canPostOccurrence: boolean;
  canOpenTransaction: boolean;
  reloadToken: number;
  onClose: () => void;
};

const statusColor = (status: FinanceTransaction["status"]): string => {
  if (status === "paid" || status === "reimbursed") return "teal";
  if (status === "void") return "gray";
  if (status === "awaiting_reimbursement") return "orange";
  return "blue";
};

const scheduledDate = (transaction: FinanceTransaction): string => {
  const scheduled = transaction.meta?.recurring_scheduled_for;
  return typeof scheduled === "string" ? scheduled : transaction.date;
};

const FinanceRecurringOccurrences = ({
  rule,
  canPostOccurrence,
  canOpenTransaction,
  reloadToken,
  onClose,
}: FinanceRecurringOccurrencesProps) => {
  const navigate = useNavigate();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [page, setPage] = useState(1);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [action, setAction] = useState<OccurrenceAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [rule.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getFinanceRecurringOccurrences(rule.id, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      .then((response) => {
        if (!active) return;
        setTransactions(response.data);
        setTotal(response.meta.count);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(getFinanceErrorMessage(requestError, "Unable to load generated transactions."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, refreshToken, reloadToken, rule.id]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const actionLabel = action?.mode === "post"
    ? action.transaction.kind === "income" ? "Mark received" : "Mark paid"
    : "Void occurrence";

  const performAction = async () => {
    if (!action || !canPostOccurrence) return;
    try {
      setActionLoading(true);
      setActionError(null);
      const updated = action.mode === "post"
        ? await postFinanceRecurringOccurrence(rule.id, action.transaction.id)
        : await voidFinanceRecurringOccurrence(rule.id, action.transaction.id);
      setTransactions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setAction(null);
    } catch (requestError) {
      setActionError(getFinanceErrorMessage(requestError, `Unable to ${actionLabel.toLowerCase()}.`));
    } finally {
      setActionLoading(false);
    }
  };

  const renderStatus = (transaction: FinanceTransaction) => (
    <Badge color={statusColor(transaction.status)} variant="light">
      {humanizeFinanceValue(transaction.status)}
    </Badge>
  );

  const renderActions = (transaction: FinanceTransaction) => {
    const editable = isEditableOccurrenceStatus(transaction.status);
    return (
      <Group gap="xs" justify="flex-end" wrap="wrap" className={classes.occurrenceActions}>
        {canPostOccurrence && editable && (
          <Button
            size="xs"
            variant="light"
            color="teal"
            leftSection={<IconCircleCheck size={15} />}
            onClick={() => {
              setActionError(null);
              setAction({ mode: "post", transaction });
            }}
          >
            {transaction.kind === "income" ? "Mark received" : "Mark paid"}
          </Button>
        )}
        {canPostOccurrence && editable && (
          <Button
            size="xs"
            variant="subtle"
            color="red"
            leftSection={<IconBan size={15} />}
            onClick={() => {
              setActionError(null);
              setAction({ mode: "void", transaction });
            }}
          >
            Void
          </Button>
        )}
        {canOpenTransaction && (
          <Button
            size="xs"
            variant="default"
            leftSection={<IconExternalLink size={15} />}
            onClick={() => navigate(`/finance/transactions?transactionModal=edit&transactionId=${transaction.id}`)}
          >
            Open
          </Button>
        )}
      </Group>
    );
  };

  const title = useMemo(() => {
    const description = (rule.templateJson as Record<string, unknown>).description;
    return typeof description === "string" && description.trim()
      ? description
      : `Recurring ${rule.kind} #${rule.id}`;
  }, [rule]);

  return (
    <>
      <FinancePanel
        className={classes.occurrencePanel}
        title={`Occurrence review · ${title}`}
        description={`${total} generated transaction${total === 1 ? "" : "s"} · newest first`}
        icon={<IconReceipt size={18} />}
        actions={
          <Group gap="xs">
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRefresh size={15} />}
              loading={loading}
              onClick={() => setRefreshToken((value) => value + 1)}
            >
              Refresh
            </Button>
            <Button size="xs" variant="default" leftSection={<IconX size={15} />} onClick={onClose}>
              Close
            </Button>
          </Group>
        }
        noPadding
      >
        <Alert color="blue" variant="light" radius={0}>
          Generated items are forecasts. They affect cash only after you mark them paid or received.
        </Alert>
        {error ? (
          <FinanceErrorState message={error} onRetry={() => setRefreshToken((value) => value + 1)} />
        ) : loading && transactions.length === 0 ? (
          <FinanceLoadingState label="Loading occurrence history" />
        ) : transactions.length === 0 ? (
          <FinanceEmptyState
            icon={<IconReceipt size={24} />}
            title="No occurrences yet"
            description="The first planned transaction will appear here after this rule becomes due."
          />
        ) : isMobile ? (
          <Stack gap={0} p="sm">
            {transactions.map((transaction) => (
              <FinanceRecordCard
                key={transaction.id}
                leading={
                  <ThemeIcon color={transaction.kind === "income" ? "teal" : "orange"} variant="light" radius="md">
                    <IconReceipt size={17} />
                  </ThemeIcon>
                }
                title={transaction.description || `Transaction #${transaction.id}`}
                subtitle={`Scheduled ${formatFinanceDate(scheduledDate(transaction))}`}
                status={renderStatus(transaction)}
                fields={[
                  { label: "Amount", value: formatFinanceMoneyMinor(transaction.amountMinor, transaction.currency) },
                  { label: "Created", value: formatFinanceDate(transaction.createdAt, true) },
                  { label: "Transaction", value: `#${transaction.id}` },
                ]}
                actions={renderActions(transaction)}
              />
            ))}
          </Stack>
        ) : (
          <ScrollArea offsetScrollbars type="auto">
            <Table verticalSpacing="sm" highlightOnHover miw={830}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Scheduled</Table.Th>
                  <Table.Th>Transaction</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {transactions.map((transaction) => (
                  <Table.Tr key={transaction.id}>
                    <Table.Td>{formatFinanceDate(scheduledDate(transaction))}</Table.Td>
                    <Table.Td>
                      <Stack gap={1}>
                        <Text fw={700}>{transaction.description || `Transaction #${transaction.id}`}</Text>
                        <Text size="xs" c="dimmed">#{transaction.id} · created {formatFinanceDate(transaction.createdAt, true)}</Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td ta="right" fw={750}>
                      {formatFinanceMoneyMinor(transaction.amountMinor, transaction.currency)}
                    </Table.Td>
                    <Table.Td className={classes.occurrenceStatusCell}>{renderStatus(transaction)}</Table.Td>
                    <Table.Td ta="right">{renderActions(transaction)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
        {pageCount > 1 && (
          <Group justify="center" p="md">
            <Pagination value={page} onChange={setPage} total={pageCount} size="sm" />
          </Group>
        )}
      </FinancePanel>

      <FinanceConfirmModal
        opened={action != null}
        onClose={() => {
          if (!actionLoading) {
            setAction(null);
            setActionError(null);
          }
        }}
        onConfirm={() => void performAction()}
        title={`${actionLabel}?`}
        description={
          action?.mode === "post"
            ? "This records the forecast as actual cash movement."
            : "This cancels the unposted occurrence. It will remain visible in history."
        }
        confirmLabel={actionLabel}
        confirmColor={action?.mode === "post" ? "teal" : "red"}
        loading={actionLoading}
      >
        {action && (
          <Stack gap="xs">
            <Text size="sm" fw={750}>
              {formatFinanceMoneyMinor(action.transaction.amountMinor, action.transaction.currency)} · {formatFinanceDate(scheduledDate(action.transaction))}
            </Text>
            {actionError && <Alert color="red">{actionError}</Alert>}
          </Stack>
        )}
      </FinanceConfirmModal>
    </>
  );
};

export default FinanceRecurringOccurrences;
