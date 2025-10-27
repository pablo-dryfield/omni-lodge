import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { IconArrowsLeftRight, IconEdit, IconFileUpload, IconPlus } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceTransaction,
  createFinanceTransfer,
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceClients,
  fetchFinanceTransactions,
  fetchFinanceVendors,
  updateFinanceTransaction,
  uploadFinanceFile,
} from "../../actions/financeActions";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceFiles,
  selectFinanceTransactions,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { FinanceTransaction } from "../../types/finance";
import dayjs from "dayjs";

type TransactionDraft = {
  kind: FinanceTransaction["kind"];
  date: string;
  accountId: number | null;
  targetAccountId?: number | null;
  currency: string;
  amountMinor: number;
  fxRate: number;
  categoryId: number | null;
  counterpartyType: FinanceTransaction["counterpartyType"];
  counterpartyId: number | null;
  status: FinanceTransaction["status"];
  description: string | null;
  invoiceFileId: number | null;
};

const defaultDraft: TransactionDraft = {
  kind: "expense",
  date: dayjs().format("YYYY-MM-DD"),
  accountId: null,
  targetAccountId: null,
  currency: "PLN",
  amountMinor: 0,
  fxRate: 1,
  categoryId: null,
  counterpartyType: "vendor",
  counterpartyId: null,
  status: "planned",
  description: null,
  invoiceFileId: null,
};

const FinanceTransactions = () => {
  const dispatch = useAppDispatch();
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);
  const transactions = useAppSelector(selectFinanceTransactions);
  const files = useAppSelector(selectFinanceFiles);

  const [filters, setFilters] = useState<{ status?: string; kind?: string; accountId?: number | null }>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<TransactionDraft>(defaultDraft);
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | null>(null);

  useEffect(() => {
    dispatch(fetchFinanceAccounts());
    dispatch(fetchFinanceCategories());
    dispatch(fetchFinanceVendors());
    dispatch(fetchFinanceClients());
    dispatch(fetchFinanceTransactions({ limit: 100 }));
  }, [dispatch]);

  const transactionRows = useMemo(() => {
    return transactions.data.map((transaction) => {
      const account = accounts.data.find((item) => item.id === transaction.accountId);
      const category = categories.data.find((item) => item.id === transaction.categoryId);
      const counterparty =
        transaction.counterpartyType === "vendor"
          ? vendors.data.find((item) => item.id === transaction.counterpartyId)?.name
          : transaction.counterpartyType === "client"
            ? clients.data.find((item) => item.id === transaction.counterpartyId)?.name
            : null;
      return {
        ...transaction,
        accountName: account?.name ?? "—",
        categoryName: category?.name ?? "—",
        counterpartyName: counterparty ?? "—",
      };
    });
  }, [transactions.data, accounts.data, categories.data, vendors.data, clients.data]);

  useEffect(() => {
    if (editingTransaction) {
      setDraft({
        kind: editingTransaction.kind,
        date: editingTransaction.date,
        accountId: editingTransaction.accountId,
        currency: editingTransaction.currency,
        amountMinor: editingTransaction.amountMinor,
        fxRate: Number(editingTransaction.fxRate),
        categoryId: editingTransaction.categoryId,
        counterpartyType: editingTransaction.counterpartyType,
        counterpartyId: editingTransaction.counterpartyId,
        status: editingTransaction.status,
        description: editingTransaction.description,
        invoiceFileId: editingTransaction.invoiceFileId,
      });
    } else {
      setDraft(defaultDraft);
    }
  }, [editingTransaction]);

  const handleApplyFilters = () => {
    dispatch(
      fetchFinanceTransactions({
        status: filters.status,
        kind: filters.kind,
        accountId: filters.accountId ?? undefined,
        limit: 100,
      }),
    );
  };

  const handleSubmit = async () => {
    if (!draft.accountId || !draft.date || !draft.currency) {
      return;
    }

    if (draft.kind === "transfer" && draft.targetAccountId && draft.accountId) {
      await dispatch(
        createFinanceTransfer({
          fromAccountId: draft.accountId,
          toAccountId: draft.targetAccountId,
          amountMinor: draft.amountMinor,
          currency: draft.currency,
          fxRate: draft.fxRate,
          description: draft.description ?? undefined,
          status: draft.status,
          date: draft.date,
        }),
      );
    } else if (editingTransaction) {
      await dispatch(
        updateFinanceTransaction({
          id: editingTransaction.id,
          changes: {
            ...editingTransaction,
            ...draft,
            fxRate: draft.fxRate,
          },
        }),
      );
    } else {
      await dispatch(
        createFinanceTransaction({
          ...draft,
        }),
      );
    }

    setModalOpen(false);
    setEditingTransaction(null);
    setDraft(defaultDraft);
  };

  const counterpartyOptions =
    draft.kind === "expense"
      ? vendors.data.map((vendor) => ({ value: String(vendor.id), label: vendor.name }))
      : draft.kind === "income"
        ? clients.data.map((client) => ({ value: String(client.id), label: client.name }))
        : [];

  const categoryOptions = categories.data.map((category) => ({
    value: String(category.id),
    label: `${category.kind === "income" ? "Income" : "Expense"} �- ${category.name}`,
  }));

  const accountOptions = accounts.data.map((account) => ({
    value: String(account.id),
    label: account.name,
  }));

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    const result = await dispatch(uploadFinanceFile(formData));
    if (uploadFinanceFile.fulfilled.match(result)) {
      setDraft((state) => ({ ...state, invoiceFileId: result.payload.id }));
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Title order={3}>Transactions</Title>
        <Group>
          <Select
            placeholder="Status"
            value={filters.status ?? null}
            onChange={(value) => setFilters((state) => ({ ...state, status: value ?? undefined }))}
            data={[
              { value: "planned", label: "Planned" },
              { value: "approved", label: "Approved" },
              { value: "paid", label: "Paid" },
              { value: "reimbursed", label: "Reimbursed" },
              { value: "void", label: "Void" },
            ]}
            allowDeselect
          />
          <Select
            placeholder="Kind"
            value={filters.kind ?? null}
            onChange={(value) => setFilters((state) => ({ ...state, kind: value ?? undefined }))}
            data={[
              { value: "income", label: "Income" },
              { value: "expense", label: "Expense" },
              { value: "transfer", label: "Transfer" },
              { value: "refund", label: "Refund" },
            ]}
            allowDeselect
          />
          <Select
            placeholder="Account"
            data={accountOptions}
            value={filters.accountId ? String(filters.accountId) : null}
            onChange={(value) =>
              setFilters((state) => ({
                ...state,
                accountId: value ? Number(value) : null,
              }))
            }
            searchable
            allowDeselect
          />
          <Button variant="light" onClick={handleApplyFilters}>
            Apply filters
          </Button>
        </Group>
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={() => {
            setEditingTransaction(null);
            setModalOpen(true);
          }}
        >
          New Transaction
        </Button>
      </Group>

      <Card withBorder padding="0">
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Kind</Table.Th>
              <Table.Th>Account</Table.Th>
              <Table.Th>Amount</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th>Counterparty</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {transactionRows.map((transaction) => (
              <Table.Tr key={transaction.id}>
                <Table.Td>{transaction.date}</Table.Td>
                <Table.Td>{transaction.kind.toUpperCase()}</Table.Td>
                <Table.Td>{transaction.accountName}</Table.Td>
                <Table.Td>
                  {(transaction.amountMinor / 100).toFixed(2)} {transaction.currency}
                </Table.Td>
                <Table.Td>{transaction.categoryName}</Table.Td>
                <Table.Td>{transaction.counterpartyName}</Table.Td>
                <Table.Td>
                  <Badge color="blue" variant="light">
                    {transaction.status.toUpperCase()}
                  </Badge>
                </Table.Td>
                <Table.Td width={60}>
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      setEditingTransaction(transaction);
                      setModalOpen(true);
                    }}
                  >
                    <IconEdit size={18} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTransaction(null);
        }}
        title={editingTransaction ? "Edit Transaction" : "New Transaction"}
        size="xl"
        centered
      >
        <Stack gap="md">
          <Group grow>
            <Select
              label="Kind"
              data={[
                { value: "income", label: "Income" },
                { value: "expense", label: "Expense" },
                { value: "transfer", label: "Transfer" },
                { value: "refund", label: "Refund" },
              ]}
              value={draft.kind}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  kind: (value ?? "expense") as TransactionDraft["kind"],
                  counterpartyType: value === "income" ? "client" : value === "expense" ? "vendor" : "none",
                }))
              }
            />
            <DateInput
              label="Date"
              value={dayjs(draft.date).toDate()}
              onChange={(value) => setDraft((state) => ({ ...state, date: dayjs(value).format("YYYY-MM-DD") }))}
              valueFormat="YYYY-MM-DD"
            />
            <Select
              label="Account"
              data={accountOptions}
              value={draft.accountId ? String(draft.accountId) : null}
              onChange={(value) => setDraft((state) => ({ ...state, accountId: value ? Number(value) : null }))}
              withAsterisk
              searchable
            />
            {draft.kind === "transfer" && (
              <Select
                label="Target Account"
                data={accountOptions}
                value={draft.targetAccountId ? String(draft.targetAccountId) : null}
                onChange={(value) =>
                  setDraft((state) => ({
                    ...state,
                    targetAccountId: value ? Number(value) : null,
                  }))
                }
                withAsterisk
                searchable
              />
            )}
          </Group>
          <Group grow>
            <NumberInput
              label="Amount"
              decimalScale={2}
              value={draft.amountMinor / 100}
              onValueChange={({ value }) =>
                setDraft((state) => ({
                  ...state,
                  amountMinor: Math.round((Number(value) || 0) * 100),
                }))
              }
            />
            <TextInput
              label="Currency"
              value={draft.currency}
              onChange={(event) => setDraft((state) => ({ ...state, currency: event.currentTarget.value.toUpperCase() }))}
              maxLength={3}
            />
            <NumberInput
              label="FX Rate"
              decimalScale={4}
              value={draft.fxRate}
              onValueChange={({ value }) =>
                setDraft((state) => ({
                  ...state,
                  fxRate: Number(value) || 1,
                }))
              }
            />
          </Group>
          <Group grow>
            <Select
              label="Category"
              data={categoryOptions}
              value={draft.categoryId ? String(draft.categoryId) : null}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  categoryId: value ? Number(value) : null,
                }))
              }
              searchable
              allowDeselect
            />
            {(draft.kind === "income" || draft.kind === "expense") && (
              <Select
                label={draft.kind === "expense" ? "Vendor" : "Client"}
                data={counterpartyOptions}
                value={draft.counterpartyId ? String(draft.counterpartyId) : null}
                onChange={(value) =>
                  setDraft((state) => ({
                    ...state,
                    counterpartyId: value ? Number(value) : null,
                  }))
                }
                searchable
                withAsterisk
              />
            )}
            <Select
              label="Status"
              data={[
                { value: "planned", label: "Planned" },
                { value: "approved", label: "Approved" },
                { value: "paid", label: "Paid" },
                { value: "reimbursed", label: "Reimbursed" },
                { value: "void", label: "Void" },
              ]}
              value={draft.status}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  status: (value ?? "planned") as TransactionDraft["status"],
                }))
              }
            />
          </Group>
          <Textarea
            label="Description"
            minRows={3}
            value={draft.description ?? ""}
            onChange={(event) => setDraft((state) => ({ ...state, description: event.currentTarget.value || null }))}
          />
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Button
                variant="light"
                leftSection={<IconFileUpload size={16} />}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*,application/pdf";
                  input.onchange = handleFileSelect;
                  input.click();
                }}
              >
                Upload invoice
              </Button>
              {draft.invoiceFileId && (
                <Badge color="green" variant="light">
                  File #{draft.invoiceFileId}
                </Badge>
              )}
              {files.latest && <Badge>Last upload: {files.latest.originalName}</Badge>}
            </Group>
            <Group>
              <Button variant="light" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button leftSection={<IconArrowsLeftRight size={16} />} onClick={handleSubmit}>
                {draft.kind === "transfer" ? "Create transfer" : editingTransaction ? "Save changes" : "Create transaction"}
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceTransactions;

