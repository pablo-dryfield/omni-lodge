import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Modal,
  NumberInput,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  useMantineTheme,
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
import { fetchStaffProfiles } from "../../actions/staffProfileActions";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceFiles,
  selectFinanceTransactions,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { FinanceTransaction } from "../../types/finance";
import type { StaffProfile } from "../../types/staffProfiles/StaffProfile";
import dayjs from "dayjs";
import { useMediaQuery } from "@mantine/hooks";
import { compressImageFile } from "../../utils/imageCompression";

const TRANSACTION_STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "approved", label: "Approved" },
  { value: "awaiting_reimbursement", label: "Awaiting reimbursement" },
  { value: "paid", label: "Paid" },
  { value: "reimbursed", label: "Reimbursed" },
  { value: "void", label: "Void" },
] as const;

const getStatusBadgeColor = (status: string): string => {
  switch (status) {
    case "planned":
      return "gray";
    case "approved":
      return "blue";
    case "awaiting_reimbursement":
      return "orange";
    case "paid":
      return "cyan";
    case "reimbursed":
      return "teal";
    case "void":
      return "red";
    default:
      return "blue";
  }
};

const parsePaidByUserIdFromMeta = (meta: unknown): number | null => {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  const record = meta as Record<string, unknown>;
  const candidate = record.paidByUserId ?? record.staffUserId ?? null;
  if (candidate == null) {
    return null;
  }
  const numeric = Number(candidate);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

const applyPaidByUserToMeta = (
  meta: Record<string, unknown> | null,
  userId: number | null,
): Record<string, unknown> | null => {
  const next = { ...(meta ?? {}) };
  if (!userId) {
    delete next.paidByUserId;
  } else {
    next.paidByUserId = userId;
  }
  return Object.keys(next).length > 0 ? next : null;
};

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
  meta: Record<string, unknown> | null;
};

const toFinanceTransactionChanges = (draft: TransactionDraft): Partial<FinanceTransaction> => ({
  kind: draft.kind,
  date: draft.date,
  accountId: draft.accountId ?? undefined,
  currency: draft.currency,
  amountMinor: draft.amountMinor,
  fxRate: draft.fxRate.toString(),
  categoryId: draft.categoryId,
  counterpartyType: draft.counterpartyType,
  counterpartyId: draft.counterpartyId,
  status: draft.status,
  description: draft.description,
  invoiceFileId: draft.invoiceFileId,
  meta: draft.meta ?? null,
});

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
  meta: null,
};

const FinanceTransactions = () => {
  const dispatch = useAppDispatch();
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);
  const transactions = useAppSelector(selectFinanceTransactions);
  const files = useAppSelector(selectFinanceFiles);
  const staffProfileState = useAppSelector((state) => state.staffProfiles[0]);
  const staffProfiles = useMemo(
    () =>
      ((staffProfileState.data[0]?.data as Partial<StaffProfile>[] | undefined) ?? []) as Partial<StaffProfile>[],
    [staffProfileState.data],
  );

  const [filters, setFilters] = useState<{ status?: string; kind?: string; accountId?: number | null }>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<TransactionDraft>(defaultDraft);
  const [editingTransaction, setEditingTransaction] = useState<FinanceTransaction | null>(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const isTablet = useMediaQuery(`(max-width: ${theme.breakpoints.md})`);

  useEffect(() => {
    dispatch(fetchFinanceAccounts());
    dispatch(fetchFinanceCategories());
    dispatch(fetchFinanceVendors());
    dispatch(fetchFinanceClients());
    dispatch(fetchFinanceTransactions({ limit: 100 }));
    dispatch(fetchStaffProfiles());
  }, [dispatch]);

  const staffNameById = useMemo(() => {
    const map = new Map<number, string>();
    staffProfiles.forEach((profile) => {
      if (typeof profile.userId === "number") {
        const rawName = (profile.userName ?? "").trim();
        const label = rawName.length > 0 ? rawName : `User #${profile.userId}`;
        map.set(profile.userId, label);
      }
    });
    return map;
  }, [staffProfiles]);

  const transactionRows = useMemo(() => {
    const getSignedAmount = (transaction: FinanceTransaction): number => {
      const magnitude = Math.abs(transaction.amountMinor);
      if (transaction.kind === "transfer") {
        const direction =
          typeof transaction.meta === "object" && transaction.meta && typeof transaction.meta.direction === "string"
            ? (transaction.meta.direction as string)
            : null;
        if (direction === "in") {
          return magnitude;
        }
        if (direction === "out") {
          return -magnitude;
        }
        return -magnitude;
      }
      if (transaction.kind === "income" || transaction.kind === "refund") {
        return magnitude;
      }
      return -magnitude;
    };

    return transactions.data.map((transaction) => {
      const account = accounts.data.find((item) => item.id === transaction.accountId);
      const category = categories.data.find((item) => item.id === transaction.categoryId);
      const counterparty =
        transaction.counterpartyType === "vendor"
          ? vendors.data.find((item) => item.id === transaction.counterpartyId)?.name
          : transaction.counterpartyType === "client"
            ? clients.data.find((item) => item.id === transaction.counterpartyId)?.name
            : null;
      const paidByUserId = parsePaidByUserIdFromMeta(transaction.meta);
      const paidByName = paidByUserId ? staffNameById.get(paidByUserId) ?? `User #${paidByUserId}` : "Company";
      return {
        ...transaction,
        accountName: account?.name ?? "??",
        categoryName: category?.name ?? "??",
        counterpartyName: counterparty ?? "??",
        signedAmountMinor: getSignedAmount(transaction),
        paidByName,
      };
    });
  }, [transactions.data, accounts.data, categories.data, vendors.data, clients.data, staffNameById]);

  useEffect(() => {
    if (editingTransaction) {
      const metaRecord = (editingTransaction.meta as Record<string, unknown> | null) ?? null;
      const targetAccountId =
        metaRecord && typeof metaRecord.targetAccountId === "number" ? Number(metaRecord.targetAccountId) : null;
      setDraft({
        kind: editingTransaction.kind,
        date: editingTransaction.date,
        accountId: editingTransaction.accountId,
        targetAccountId,
        currency: editingTransaction.currency,
        amountMinor: editingTransaction.amountMinor,
        fxRate: Number(editingTransaction.fxRate),
        categoryId: editingTransaction.categoryId,
        counterpartyType: editingTransaction.counterpartyType,
        counterpartyId: editingTransaction.counterpartyId,
        status: editingTransaction.status,
        description: editingTransaction.description,
        invoiceFileId: editingTransaction.invoiceFileId,
        meta: metaRecord,
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
    const commonPayload = toFinanceTransactionChanges({ ...draft, accountId: draft.accountId });

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
          changes: commonPayload,
        }),
      );
    } else {
      await dispatch(
        createFinanceTransaction(commonPayload),
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
    label: `${category.kind === "income" ? "Income" : "Expense"} - ${category.name}`,
  }));

  const accountOptions = accounts.data.map((account) => ({
    value: String(account.id),
    label: account.name,
  }));

  const paidByOptions = useMemo(
    () => [
      { value: "company", label: "Company (paid with company funds)" },
      ...staffProfiles
        .filter((profile): profile is StaffProfile => typeof profile?.userId === "number")
        .map((profile) => ({
          value: String(profile.userId),
          label:
            typeof profile.userName === "string" && profile.userName.trim().length > 0
              ? profile.userName.trim()
              : `User #${profile.userId}`,
        })),
    ],
    [staffProfiles],
  );

  const paidByValue = useMemo(() => {
    const userId = parsePaidByUserIdFromMeta(draft.meta);
    return userId ? String(userId) : "company";
  }, [draft.meta]);

  const handlePaidByChange = useCallback(
    (value: string | null) => {
      setDraft((state) => {
        const nextUserId = !value || value === "company" ? null : Number(value);
        return {
          ...state,
          meta: applyPaidByUserToMeta(state.meta, nextUserId),
        };
      });
    },
    [],
  );
  const handleFileSelect = async (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) {
      return;
    }
    setUploadError(null);
    setUploadingInvoice(true);
    setUploadProgress(0);
    let preparedFile: File = file;
    if (file.type?.startsWith("image/")) {
      try {
        preparedFile = await compressImageFile(file, {
          maxWidth: 1600,
          maxHeight: 1600,
          quality: 0.8,
          maxSizeBytes: 700 * 1024,
        });
      } catch (compressionError) {
        console.error("Failed to compress invoice before upload", compressionError);
      }
    }
    const formData = new FormData();
    formData.append("file", preparedFile);
    try {
      const result = await dispatch(
        uploadFinanceFile({
          formData,
          onUploadProgress: (percent) => {
            setUploadProgress(percent);
          },
        }),
      );
      if (uploadFinanceFile.fulfilled.match(result)) {
        setDraft((state) => ({ ...state, invoiceFileId: result.payload.id }));
      } else {
        setUploadError(result.error.message ?? "Failed to upload invoice");
      }
    } finally {
      setUploadingInvoice(false);
      setUploadProgress(0);
    }
    if (target) {
      target.value = "";
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align={isMobile ? "stretch" : "flex-end"} gap="sm" wrap="wrap">
        <Title order={3}>Transactions</Title>
        <Box style={{ flex: "1 1 320px", minWidth: 0 }}>
          <Group gap="sm" wrap="wrap" justify={isMobile ? "flex-start" : "flex-end"}>
            <Select
              placeholder="Status"
              value={filters.status ?? null}
              onChange={(value) => setFilters((state) => ({ ...state, status: value ?? undefined }))}
              data={TRANSACTION_STATUS_OPTIONS}
              allowDeselect
              w={isMobile ? "100%" : 180}
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
              w={isMobile ? "100%" : 180}
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
              w={isMobile ? "100%" : 200}
            />
            <Button variant="light" onClick={handleApplyFilters} fullWidth={isMobile}>
              Apply filters
            </Button>
          </Group>
        </Box>
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={() => {
            setEditingTransaction(null);
            setModalOpen(true);
          }}
          fullWidth={isMobile}
        >
          New Transaction
        </Button>
      </Group>

      <Card withBorder padding="0">
        <ScrollArea offsetScrollbars type="auto">
          <Table striped highlightOnHover verticalSpacing="sm" miw={900}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Kind</Table.Th>
                <Table.Th>Account</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th>Counterparty</Table.Th>
                <Table.Th>Paid by</Table.Th>
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
                    <Text fw={600} c={transaction.signedAmountMinor >= 0 ? "green" : "red"}>
                      {(transaction.signedAmountMinor >= 0 ? '+' : '-') + Math.abs(transaction.signedAmountMinor / 100).toFixed(2) + ` ${transaction.currency}`}
                    </Text>
                  </Table.Td>
                  <Table.Td>{transaction.categoryName}</Table.Td>
                  <Table.Td>{transaction.counterpartyName}</Table.Td>
                  <Table.Td>{transaction.paidByName}</Table.Td>
                  <Table.Td>
                    <Badge color={getStatusBadgeColor(transaction.status)} variant="light">
                      {TRANSACTION_STATUS_OPTIONS.find((option) => option.value === transaction.status)?.label ??
                        transaction.status.toUpperCase()}
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
        </ScrollArea>
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
        fullScreen={isTablet}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
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
                  meta: value === "expense" ? state.meta : applyPaidByUserToMeta(state.meta, null),
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
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
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
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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
              data={TRANSACTION_STATUS_OPTIONS}
              value={draft.status}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  status: (value ?? "planned") as TransactionDraft["status"],
                }))
              }
            />
            {draft.kind === "expense" && (
              <Select label="Paid by" data={paidByOptions} value={paidByValue} onChange={handlePaidByChange} />
            )}
          </SimpleGrid>
          <Textarea
            label="Description"
            minRows={3}
            value={draft.description ?? ""}
            onChange={(event) => setDraft((state) => ({ ...state, description: event.currentTarget.value || null }))}
          />
          <Stack gap="sm">
            <Group gap="xs" wrap="wrap" justify={isMobile ? "center" : "flex-start"}>
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
                disabled={uploadingInvoice}
              >
                Upload invoice
              </Button>
              {uploadingInvoice && (
                <Group gap="xs" align="center">
                  <Progress value={uploadProgress} w={isMobile ? 140 : 200} />
                  <Text size="sm" c="dimmed">
                    {uploadProgress}%
                  </Text>
                </Group>
              )}
              {draft.invoiceFileId && (
                <Badge color="green" variant="light">
                  File #{draft.invoiceFileId}
                </Badge>
              )}
              {files.latest && <Badge>Last upload: {files.latest.originalName}</Badge>}
            </Group>
            {uploadError && (
              <Text size="sm" c="red" ta="center">
                {uploadError}
              </Text>
            )}
            <Group gap="sm" wrap="wrap" justify="center">
              <Button variant="light" onClick={() => setModalOpen(false)} fullWidth={isMobile}>
                Cancel
              </Button>
              <Button leftSection={<IconArrowsLeftRight size={16} />} onClick={handleSubmit} fullWidth={isMobile}>
                {draft.kind === "transfer" ? "Create transfer" : editingTransaction ? "Save changes" : "Create transaction"}
              </Button>
            </Group>
          </Stack>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceTransactions;





