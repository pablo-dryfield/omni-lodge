import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconArrowBackUp,
  IconCoins,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconShoppingCart,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import {
  useCreateVolunteerFund,
  useCreateVolunteerFundAdjustment,
  useCreateVolunteerFundSpend,
  useReverseVolunteerFundEntry,
  useUpdateVolunteerFund,
  useVolunteerFundLedger,
  useVolunteerFunds,
} from "../../api/volunteerFunds";
import {
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceVendors,
} from "../../actions/financeActions";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import type {
  VolunteerFundEntryType,
  VolunteerFundLedgerEntry,
  VolunteerFundPayload,
  VolunteerFundSummary,
} from "../../types/finance";
import FinanceInfoButton from "../../components/finance/FinanceInfoButton";

type FundDraft = {
  name: string;
  currency: string;
  description: string;
  linkedAccountId: string | null;
  expenseCategoryId: string | null;
  isActive: boolean;
};

type EntryDraft = {
  date: string;
  amount: number | "";
  description: string;
  accountId: string | null;
  categoryId: string | null;
  vendorId: string | null;
  idempotencyKey: string;
};

type ReversalDraft = {
  date: string;
  reason: string;
};

const EMPTY_FUND_DRAFT: FundDraft = {
  name: "",
  currency: "PLN",
  description: "",
  linkedAccountId: null,
  expenseCategoryId: null,
  isActive: true,
};

const createEmptyEntryDraft = (): EntryDraft => ({
  date: dayjs().format("YYYY-MM-DD"),
  amount: "",
  description: "",
  accountId: null,
  categoryId: null,
  vendorId: null,
  idempotencyKey: "",
});

const createEmptyReversalDraft = (): ReversalDraft => ({
  date: dayjs().format("YYYY-MM-DD"),
  reason: "",
});

const ENTRY_TABS: Array<{ value: "all" | VolunteerFundEntryType; label: string }> = [
  { value: "all", label: "All activity" },
  { value: "allocation", label: "Allocations" },
  { value: "spend", label: "Spend" },
  { value: "adjustment", label: "Adjustments" },
  { value: "reversal", label: "Reversals" },
];

const LEDGER_PAGE_SIZE = 100;

const KPI_HELP = {
  availableBalance: "Current balance from all entries in this fund, regardless of the From/To dates. Positive allocations and adjustments increase the fund balance; spends and negative adjustments reduce it. Reversals apply the opposite of the original entry.",
  allocatedInPeriod: "Sum of allocation entries dated within From/To, regardless of the activity tab. They come from staff settlements and increase the fund balance. Reversals remain separate and affect the balance without rewriting this total.",
  spentInPeriod: "Sum of spend entries dated within From/To, regardless of the activity tab. It is shown as a positive total here, although each spend is negative in the ledger and reduces the fund. Reversals remain separate.",
  periodAdjustments: "Net manual, non-cash corrections dated within From/To, regardless of the activity tab. A positive adjustment increases the fund balance; a negative adjustment reduces it. Reversals remain separate.",
} as const;

const LEDGER_HEADER_HELP = {
  date: "The effective ledger date used by the From/To filter and entry order. It may differ from the time the record was created.",
  type: "How the entry arose: Allocation reserves staff compensation; Spend links a paid Finance expense; Adjustment is a manual non-cash correction; Reversal offsets an earlier entry.",
  description: "The saved audit reason or note for this entry. If none was saved, the entry number is shown.",
  attribution: "The staff member and compensation component that produced an allocation. Manual spends and adjustments may have no attribution.",
  amount: "The signed change to the fund in its currency. A plus increases the fund balance; a minus reduces it. A reversal has the opposite sign of its original entry.",
  runningBalance: "The fund balance immediately after this entry, including activity before the selected From date and activity hidden by the selected tab.",
  actions: "Shows Reverse only when an entry is eligible. Reversing keeps the original audit record and adds an equal, opposite entry; reversing a spend also voids its linked Finance expense.",
} as const;

const createEntryIdempotencyKey = (kind: "spend" | "adjustment"): string => {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `manual-${kind}:${uuid}`;
};

const extractErrorMessage = (error: unknown, fallback: string): string => {
  const responseData = (error as { response?: { data?: unknown } })?.response?.data;
  const candidate = Array.isArray(responseData) ? responseData[0] : responseData;
  if (candidate && typeof candidate === "object" && "message" in candidate) {
    const message = (candidate as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return error instanceof Error && error.message.trim() ? error.message : fallback;
};

const formatMoney = (amountMinor: number | null | undefined, currency = "PLN") =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "PLN",
    minimumFractionDigits: 2,
  }).format((Number(amountMinor) || 0) / 100);

const entryMeta = (entryType: VolunteerFundEntryType) => {
  switch (entryType) {
    case "allocation":
      return { label: "Allocation", color: "teal" };
    case "spend":
      return { label: "Spend", color: "orange" };
    case "adjustment":
      return { label: "Adjustment", color: "blue" };
    case "reversal":
      return { label: "Reversal", color: "grape" };
    default:
      return { label: entryType, color: "gray" };
  }
};

const signedEntryAmount = (entry: VolunteerFundLedgerEntry): number => {
  if (Number.isFinite(entry.amountMinor)) {
    return Number(entry.amountMinor);
  }
  return Number(entry.signedAmountMinor) || 0;
};

const FinanceVolunteerFunds = () => {
  const dispatch = useAppDispatch();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const fundsQuery = useVolunteerFunds();
  const createFund = useCreateVolunteerFund();
  const updateFund = useUpdateVolunteerFund();
  const createAdjustment = useCreateVolunteerFundAdjustment();
  const createSpend = useCreateVolunteerFundSpend();
  const reverseEntry = useReverseVolunteerFundEntry();

  const [selectedFundId, setSelectedFundId] = useState<number | null>(null);
  const [entryTab, setEntryTab] = useState<"all" | VolunteerFundEntryType>("all");
  const [startDate, setStartDate] = useState(dayjs().startOf("year").format("YYYY-MM-DD"));
  const [endDate, setEndDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [ledgerPage, setLedgerPage] = useState(1);
  const ledgerFilters = useMemo(
    () => ({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      entryType: entryTab === "all" ? undefined : entryTab,
      limit: LEDGER_PAGE_SIZE,
      offset: (ledgerPage - 1) * LEDGER_PAGE_SIZE,
    }),
    [endDate, entryTab, ledgerPage, startDate],
  );
  const ledgerQuery = useVolunteerFundLedger(selectedFundId, ledgerFilters);

  const [fundModalOpen, setFundModalOpen] = useState(false);
  const [editingFund, setEditingFund] = useState<VolunteerFundSummary | null>(null);
  const [fundDraft, setFundDraft] = useState<FundDraft>(EMPTY_FUND_DRAFT);
  const [entryModal, setEntryModal] = useState<"spend" | "adjustment" | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft>(createEmptyEntryDraft);
  const [reversalTarget, setReversalTarget] = useState<VolunteerFundLedgerEntry | null>(null);
  const [reversalDraft, setReversalDraft] = useState<ReversalDraft>(createEmptyReversalDraft);
  const [actionError, setActionError] = useState<string | null>(null);

  const funds = useMemo(() => fundsQuery.data?.funds ?? [], [fundsQuery.data?.funds]);

  useEffect(() => {
    if (selectedFundId != null && funds.some((fund) => fund.id === selectedFundId)) {
      return;
    }
    setSelectedFundId(funds.find((fund) => fund.isActive)?.id ?? funds[0]?.id ?? null);
    setLedgerPage(1);
  }, [funds, selectedFundId]);

  useEffect(() => {
    if (!accounts.loading && accounts.data.length === 0) {
      void dispatch(fetchFinanceAccounts());
    }
    if (!categories.loading && categories.data.length === 0) {
      void dispatch(fetchFinanceCategories());
    }
    if (!vendors.loading && vendors.data.length === 0) {
      void dispatch(fetchFinanceVendors());
    }
  }, [accounts.data.length, accounts.loading, categories.data.length, categories.loading, dispatch, vendors.data.length, vendors.loading]);

  const selectedFund = ledgerQuery.data?.fund ?? funds.find((fund) => fund.id === selectedFundId) ?? null;
  const availableBalanceMinor = funds.find((fund) => fund.id === selectedFundId)?.balanceMinor
    ?? selectedFund?.balanceMinor
    ?? 0;
  const draftSpendMinor = typeof entryDraft.amount === "number"
    ? Math.round(entryDraft.amount * 100)
    : 0;
  const spendExceedsAvailableBalance = entryModal === "spend"
    && draftSpendMinor > availableBalanceMinor;
  const entries = ledgerQuery.data?.entries ?? [];
  const fundAccountOptions = accounts.data
    .filter((account) => (
      (account.isActive || String(account.id) === fundDraft.linkedAccountId)
      && account.currency.toUpperCase() === fundDraft.currency.toUpperCase()
    ))
    .map((account) => ({
      value: String(account.id),
      label: `${account.name} (${account.currency})`,
    }));
  const spendAccountOptions = accounts.data
    .filter((account) => (
      account.isActive
      && account.currency.toUpperCase() === (selectedFund?.currency ?? "PLN").toUpperCase()
      && (!selectedFund?.linkedAccountId || account.id === selectedFund.linkedAccountId)
    ))
    .map((account) => ({
      value: String(account.id),
      label: `${account.name} (${account.currency})`,
    }));
  const fundExpenseCategoryOptions = categories.data
    .filter((category) => (
      category.kind === "expense"
      && (category.isActive || String(category.id) === fundDraft.expenseCategoryId)
    ))
    .map((category) => ({ value: String(category.id), label: category.name }));
  const spendExpenseCategoryOptions = categories.data
    .filter((category) => category.kind === "expense" && category.isActive)
    .map((category) => ({ value: String(category.id), label: category.name }));
  const vendorOptions = vendors.data
    .filter((vendor) => vendor.isActive)
    .map((vendor) => ({ value: String(vendor.id), label: vendor.name }));

  const openNewFund = () => {
    setEditingFund(null);
    setFundDraft(EMPTY_FUND_DRAFT);
    setActionError(null);
    setFundModalOpen(true);
  };

  const openEditFund = () => {
    if (!selectedFund) {
      return;
    }
    setEditingFund(selectedFund);
    setFundDraft({
      name: selectedFund.name,
      currency: selectedFund.currency,
      description: selectedFund.description ?? "",
      linkedAccountId: selectedFund.linkedAccountId ? String(selectedFund.linkedAccountId) : null,
      expenseCategoryId: selectedFund.expenseCategoryId ? String(selectedFund.expenseCategoryId) : null,
      isActive: selectedFund.isActive,
    });
    setActionError(null);
    setFundModalOpen(true);
  };

  const handleSaveFund = async () => {
    setActionError(null);
    if (!fundDraft.name.trim()) {
      setActionError("Fund name is required.");
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(fundDraft.currency.trim())) {
      setActionError("Currency must be a three-letter code.");
      return;
    }
    const payload: VolunteerFundPayload = {
      name: fundDraft.name.trim(),
      currency: fundDraft.currency.trim().toUpperCase(),
      description: fundDraft.description.trim() || null,
      linkedAccountId: fundDraft.linkedAccountId ? Number(fundDraft.linkedAccountId) : null,
      expenseCategoryId: fundDraft.expenseCategoryId ? Number(fundDraft.expenseCategoryId) : null,
      isActive: fundDraft.isActive,
    };
    try {
      const saved = editingFund
        ? await updateFund.mutateAsync({ id: editingFund.id, changes: payload })
        : await createFund.mutateAsync(payload);
      setSelectedFundId(saved.id);
      setFundModalOpen(false);
      setEditingFund(null);
      setFundDraft(EMPTY_FUND_DRAFT);
    } catch (error) {
      setActionError(extractErrorMessage(error, "Unable to save the volunteer fund."));
    }
  };

  const openEntryModal = (kind: "spend" | "adjustment") => {
    setActionError(null);
    if (!selectedFund?.isActive) {
      setActionError("This Volunteer Fund is inactive. Spending and adjustments are disabled; existing entries may still be reversed.");
      return;
    }
    setEntryModal(kind);
    setEntryDraft({
      ...createEmptyEntryDraft(),
      accountId: kind === "spend" && selectedFund?.linkedAccountId ? String(selectedFund.linkedAccountId) : null,
      categoryId: kind === "spend" && selectedFund?.expenseCategoryId ? String(selectedFund.expenseCategoryId) : null,
      idempotencyKey: createEntryIdempotencyKey(kind),
    });
  };

  const handleSaveEntry = async () => {
    setActionError(null);
    if (!selectedFund || !entryModal) {
      return;
    }
    const amount = Number(entryDraft.amount);
    if (!Number.isFinite(amount) || amount === 0 || (entryModal === "spend" && amount < 0)) {
      setActionError(entryModal === "spend" ? "Spend amount must be greater than zero." : "Adjustment amount cannot be zero.");
      return;
    }
    if (!entryDraft.description.trim()) {
      setActionError("A description is required for the audit trail.");
      return;
    }
    if (entryModal === "spend") {
      if (Math.round(amount * 100) > availableBalanceMinor) {
        setActionError(`This spend exceeds the available balance of ${formatMoney(availableBalanceMinor, selectedFund.currency)}.`);
        return;
      }
      if (!entryDraft.accountId) {
        setActionError("Select the Finance account used for this spend.");
        return;
      }
      if (!entryDraft.categoryId) {
        setActionError("Select the Finance expense category for this spend.");
        return;
      }
      if (!entryDraft.vendorId) {
        setActionError("Select the vendor paid for this spend.");
        return;
      }
    }
    try {
      if (entryModal === "spend") {
        await createSpend.mutateAsync({
          fundId: selectedFund.id,
          payload: {
            entryDate: entryDraft.date,
            amountMinor: Math.round(amount * 100),
            description: entryDraft.description.trim(),
            vendorId: Number(entryDraft.vendorId),
            accountId: Number(entryDraft.accountId),
            categoryId: Number(entryDraft.categoryId),
            idempotencyKey: entryDraft.idempotencyKey,
          },
        });
      } else {
        await createAdjustment.mutateAsync({
          fundId: selectedFund.id,
          payload: {
            entryDate: entryDraft.date,
            amountMinor: Math.round(amount * 100),
            description: entryDraft.description.trim(),
            idempotencyKey: entryDraft.idempotencyKey,
          },
        });
      }
      setEntryModal(null);
      setEntryDraft(createEmptyEntryDraft());
    } catch (error) {
      setActionError(extractErrorMessage(error, `Unable to record this ${entryModal}.`));
    }
  };

  const handleReverse = async () => {
    setActionError(null);
    if (!selectedFund || !reversalTarget) {
      return;
    }
    if (!reversalDraft.reason.trim()) {
      setActionError("Explain why this entry is being reversed.");
      return;
    }
    try {
      await reverseEntry.mutateAsync({
        fundId: selectedFund.id,
        entryId: reversalTarget.id,
        payload: { entryDate: reversalDraft.date, reason: reversalDraft.reason.trim() },
      });
      setReversalTarget(null);
      setReversalDraft(createEmptyReversalDraft());
    } catch (error) {
      setActionError(extractErrorMessage(error, "Unable to reverse this fund entry."));
    }
  };

  const openReverse = (entry: VolunteerFundLedgerEntry) => {
    setActionError(null);
    setReversalTarget(entry);
    setReversalDraft(createEmptyReversalDraft());
  };

  const renderReverseAction = (entry: VolunteerFundLedgerEntry) => {
    const canReverse = entry.entryType !== "reversal" && !entry.isReversed && !entry.reversedByEntryId;
    return canReverse ? (
      <Tooltip label="Reverse entry">
        <ActionIcon variant="light" color="grape" onClick={() => openReverse(entry)} aria-label="Reverse fund entry">
          <IconArrowBackUp size={16} />
        </ActionIcon>
      </Tooltip>
    ) : null;
  };

  const fundBusy = createFund.isPending || updateFund.isPending;
  const entryBusy = createSpend.isPending || createAdjustment.isPending;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
        <Stack gap={3} style={{ flex: "1 1 320px" }}>
          <Group gap="xs">
            <IconCoins size={22} />
            <Title order={3}>Volunteer Funds</Title>
          </Group>
          <Text size="sm" c="dimmed">
            Track compensation allocations reserved for volunteers and every purchase, adjustment, and reversal made against them.
          </Text>
        </Stack>
        <Group gap="xs" grow={isMobile}>
          <Button variant="light" leftSection={<IconPencil size={16} />} onClick={openEditFund} disabled={!selectedFund}>
            Edit fund
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={openNewFund}>New fund</Button>
        </Group>
      </Group>

      {fundsQuery.isError && (
        <Alert color="red" title="Unable to load volunteer funds">
          {extractErrorMessage(fundsQuery.error, "The volunteer funds endpoint could not be loaded.")}
        </Alert>
      )}
      {actionError && (
        <Alert color="red" title="Action could not be completed" withCloseButton onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {fundsQuery.isLoading ? (
        <Group justify="center" py="xl"><Loader variant="dots" /></Group>
      ) : funds.length === 0 ? (
        <Card withBorder radius="md" padding="xl">
          <Stack align="center" gap="sm">
            <IconCoins size={32} color="var(--mantine-color-violet-6)" />
            <Text fw={700}>Create the first volunteer fund</Text>
            <Text size="sm" c="dimmed" ta="center">
              Use a fund ledger to earmark volunteer compensation without pretending that cash moved between real accounts.
            </Text>
            <Button leftSection={<IconPlus size={16} />} onClick={openNewFund}>Create Volunteer Fund</Button>
          </Stack>
        </Card>
      ) : (
        <>
          <Card withBorder radius="md" padding="md">
            <Group justify="space-between" align="flex-end" gap="sm" wrap="wrap">
              <Select
                label="Volunteer fund"
                data={funds.map((fund) => ({
                  value: String(fund.id),
                  label: `${fund.name}${fund.isActive ? "" : " (inactive)"}`,
                }))}
                value={selectedFundId ? String(selectedFundId) : null}
                onChange={(value) => {
                  setSelectedFundId(value ? Number(value) : null);
                  setLedgerPage(1);
                }}
                searchable
                style={{ flex: "1 1 280px" }}
              />
              <Group gap="xs" grow={isMobile}>
                {selectedFund && !selectedFund.isActive && (
                  <Badge color="gray" variant="filled">Inactive · read only</Badge>
                )}
                <Button
                  variant="light"
                  color="orange"
                  leftSection={<IconShoppingCart size={16} />}
                  onClick={() => openEntryModal("spend")}
                  disabled={!selectedFund?.isActive}
                >
                  Record spend
                </Button>
                <Button variant="light" onClick={() => openEntryModal("adjustment")} disabled={!selectedFund?.isActive}>
                  Add adjustment
                </Button>
                <Tooltip label="Refresh ledger">
                  <ActionIcon variant="light" size="lg" onClick={() => void ledgerQuery.refetch()} aria-label="Refresh fund ledger">
                    <IconRefresh size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Card>

          {selectedFund && !selectedFund.isActive && (
            <Alert color="gray" title="This Volunteer Fund is inactive">
              New spends and adjustments are disabled. You can still review the ledger and reverse an existing entry when needed.
            </Alert>
          )}

          {selectedFund && (
            <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
              <Card withBorder radius="md" padding="md" bg="var(--mantine-color-violet-0)">
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Available balance</Text>
                  <FinanceInfoButton label="Available balance" description={KPI_HELP.availableBalance} />
                </Group>
                <Text size="xl" fw={800} c={availableBalanceMinor < 0 ? "red" : "violet"}>
                  {formatMoney(availableBalanceMinor, selectedFund.currency)}
                </Text>
              </Card>
              <Card withBorder radius="md" padding="md">
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Allocated in period</Text>
                  <FinanceInfoButton label="Allocated in period" description={KPI_HELP.allocatedInPeriod} />
                </Group>
                <Text size="xl" fw={700} c="teal">
                  {formatMoney(selectedFund.allocationTotalMinor, selectedFund.currency)}
                </Text>
              </Card>
              <Card withBorder radius="md" padding="md">
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Spent in period</Text>
                  <FinanceInfoButton label="Spent in period" description={KPI_HELP.spentInPeriod} />
                </Group>
                <Text size="xl" fw={700} c="orange">
                  {formatMoney(Math.abs(selectedFund.spendTotalMinor), selectedFund.currency)}
                </Text>
              </Card>
              <Card withBorder radius="md" padding="md">
                <Group gap={4} wrap="nowrap">
                  <Text size="xs" c="dimmed" tt="uppercase" fw={700}>Period adjustments</Text>
                  <FinanceInfoButton label="Period adjustments" description={KPI_HELP.periodAdjustments} />
                </Group>
                <Text size="xl" fw={700}>
                  {formatMoney(selectedFund.adjustmentTotalMinor, selectedFund.currency)}
                </Text>
              </Card>
            </SimpleGrid>
          )}

          <Card withBorder radius="md" padding="md">
            <Stack gap="md">
              <Group justify="space-between" align="flex-end" wrap="wrap">
                <Stack gap={2}>
                  <Text fw={700}>Fund ledger</Text>
                  <Text size="xs" c="dimmed">Allocations are created by staff settlement. Manual changes remain auditable.</Text>
                </Stack>
                <SimpleGrid cols={{ base: 1, xs: 2 }} style={{ flex: "1 1 330px", maxWidth: isMobile ? undefined : 440 }}>
                  <TextInput
                    label="From"
                    type="date"
                    value={startDate}
                    onChange={(event) => {
                      setStartDate(event.currentTarget.value);
                      setLedgerPage(1);
                    }}
                  />
                  <TextInput
                    label="To"
                    type="date"
                    value={endDate}
                    onChange={(event) => {
                      setEndDate(event.currentTarget.value);
                      setLedgerPage(1);
                    }}
                  />
                </SimpleGrid>
              </Group>
              <Tabs
                value={entryTab}
                onChange={(value) => {
                  setEntryTab((value ?? "all") as typeof entryTab);
                  setLedgerPage(1);
                }}
              >
                <ScrollArea type="auto" scrollbarSize={4}>
                  <Tabs.List style={{ flexWrap: "nowrap" }}>
                    {ENTRY_TABS.map((tab) => <Tabs.Tab key={tab.value} value={tab.value}>{tab.label}</Tabs.Tab>)}
                  </Tabs.List>
                </ScrollArea>
              </Tabs>
            </Stack>
          </Card>

          {ledgerQuery.isError && (
            <Alert color="red" title="Unable to load fund activity">
              {extractErrorMessage(ledgerQuery.error, "The fund ledger could not be loaded.")}
            </Alert>
          )}
          {ledgerQuery.isLoading ? (
            <Group justify="center" py="xl"><Loader variant="dots" /></Group>
          ) : entries.length === 0 ? (
            <Card withBorder radius="md" padding="xl">
              <Text ta="center" c="dimmed">No {entryTab === "all" ? "fund activity" : entryTab} entries match this period.</Text>
            </Card>
          ) : isMobile ? (
            <Stack gap="sm">
              {entries.map((entry) => {
                const meta = entryMeta(entry.entryType);
                const amount = signedEntryAmount(entry);
                return (
                  <Card key={entry.id} withBorder radius="md" padding="md">
                    <Stack gap="xs">
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Stack gap={2} style={{ minWidth: 0 }}>
                          <Group gap="xs">
                            <Badge color={meta.color}>{meta.label}</Badge>
                            {entry.isReversed && <Badge color="gray">Reversed</Badge>}
                          </Group>
                          <Text fw={700}>{entry.description || `${meta.label} #${entry.id}`}</Text>
                          <Text size="xs" c="dimmed">{dayjs(entry.date).format("D MMM YYYY")}</Text>
                        </Stack>
                        {renderReverseAction(entry)}
                      </Group>
                      <Text ta="center" size="xl" fw={800} c={amount >= 0 ? "teal" : "orange"}>
                        {amount >= 0 ? "+" : ""}{formatMoney(amount, entry.currency || selectedFund?.currency)}
                      </Text>
                      {(entry.staffName || entry.compensationComponentName) && (
                        <Text size="sm" ta="center" c="dimmed">
                          {[entry.staffName, entry.compensationComponentName].filter(Boolean).join(" - ")}
                        </Text>
                      )}
                      {entry.runningBalanceMinor != null && (
                        <Text size="xs" ta="center" c="dimmed">
                          Balance after entry: {formatMoney(entry.runningBalanceMinor, entry.currency || selectedFund?.currency)}
                        </Text>
                      )}
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          ) : (
            <Card withBorder radius="md" padding={0}>
              <ScrollArea type="auto">
                <Table highlightOnHover verticalSpacing="sm" miw={900}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        <Group gap={4} wrap="nowrap">
                          <Text component="span" inherit>Date</Text>
                          <FinanceInfoButton label="Date" description={LEDGER_HEADER_HELP.date} />
                        </Group>
                      </Table.Th>
                      <Table.Th>
                        <Group gap={4} wrap="nowrap">
                          <Text component="span" inherit>Type</Text>
                          <FinanceInfoButton label="Type" description={LEDGER_HEADER_HELP.type} />
                        </Group>
                      </Table.Th>
                      <Table.Th>
                        <Group gap={4} wrap="nowrap">
                          <Text component="span" inherit>Description</Text>
                          <FinanceInfoButton label="Description" description={LEDGER_HEADER_HELP.description} />
                        </Group>
                      </Table.Th>
                      <Table.Th>
                        <Group gap={4} wrap="nowrap">
                          <Text component="span" inherit>Staff / component</Text>
                          <FinanceInfoButton label="Staff / component" description={LEDGER_HEADER_HELP.attribution} />
                        </Group>
                      </Table.Th>
                      <Table.Th ta="right">
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Text component="span" inherit>Amount</Text>
                          <FinanceInfoButton label="Amount" description={LEDGER_HEADER_HELP.amount} />
                        </Group>
                      </Table.Th>
                      <Table.Th ta="right">
                        <Group gap={4} wrap="nowrap" justify="flex-end">
                          <Text component="span" inherit>Running balance</Text>
                          <FinanceInfoButton label="Running balance" description={LEDGER_HEADER_HELP.runningBalance} />
                        </Group>
                      </Table.Th>
                      <Table.Th>
                        <Group gap={4} wrap="nowrap">
                          <Text component="span" inherit>Actions</Text>
                          <FinanceInfoButton label="Actions" description={LEDGER_HEADER_HELP.actions} />
                        </Group>
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {entries.map((entry) => {
                      const meta = entryMeta(entry.entryType);
                      const amount = signedEntryAmount(entry);
                      return (
                        <Table.Tr key={entry.id}>
                          <Table.Td>{dayjs(entry.date).format("YYYY-MM-DD")}</Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              <Badge color={meta.color}>{meta.label}</Badge>
                              {entry.isReversed && <Badge color="gray">Reversed</Badge>}
                            </Group>
                          </Table.Td>
                          <Table.Td>{entry.description || `Entry #${entry.id}`}</Table.Td>
                          <Table.Td>
                            <Text size="sm">{entry.staffName ?? "-"}</Text>
                            <Text size="xs" c="dimmed">{entry.compensationComponentName ?? ""}</Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Text fw={700} c={amount >= 0 ? "teal" : "orange"}>
                              {amount >= 0 ? "+" : ""}{formatMoney(amount, entry.currency || selectedFund?.currency)}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right">
                            {entry.runningBalanceMinor == null ? "-" : formatMoney(entry.runningBalanceMinor, entry.currency || selectedFund?.currency)}
                          </Table.Td>
                          <Table.Td>{renderReverseAction(entry)}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Card>
          )}
          {(ledgerQuery.data?.pagination.total ?? 0) > LEDGER_PAGE_SIZE && (
            <Group justify="center">
              <Pagination
                value={ledgerPage}
                onChange={setLedgerPage}
                total={Math.ceil((ledgerQuery.data?.pagination.total ?? 0) / LEDGER_PAGE_SIZE)}
                boundaries={isMobile ? 0 : 1}
                siblings={isMobile ? 1 : 2}
              />
            </Group>
          )}
        </>
      )}

      <Modal
        opened={fundModalOpen}
        onClose={() => !fundBusy && setFundModalOpen(false)}
        title={editingFund ? "Edit volunteer fund" : "New volunteer fund"}
        size="lg"
        fullScreen={isMobile}
        centered={!isMobile}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Fund name"
              placeholder="Volunteer Fund"
              value={fundDraft.name}
              onChange={(event) => setFundDraft((current) => ({ ...current, name: event.currentTarget.value }))}
              required
            />
            <TextInput
              label="Currency"
              value={fundDraft.currency}
              maxLength={3}
              onChange={(event) => {
                const currency = event.currentTarget.value.toUpperCase();
                setFundDraft((current) => {
                  const linkedAccount = accounts.data.find(
                    (account) => String(account.id) === current.linkedAccountId,
                  );
                  return {
                    ...current,
                    currency,
                    linkedAccountId:
                      linkedAccount?.currency.toUpperCase() === currency
                        ? current.linkedAccountId
                        : null,
                  };
                });
              }}
              required
            />
          </SimpleGrid>
          <Textarea
            label="Description"
            minRows={2}
            value={fundDraft.description}
            onChange={(event) => setFundDraft((current) => ({ ...current, description: event.currentTarget.value }))}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Optional backing account"
              description="Use only when this fund is backed by a real finance account."
              data={fundAccountOptions}
              value={fundDraft.linkedAccountId}
              onChange={(value) => setFundDraft((current) => ({ ...current, linkedAccountId: value }))}
              searchable
              clearable
            />
            <Select
              label="Default expense category"
              data={fundExpenseCategoryOptions}
              value={fundDraft.expenseCategoryId}
              onChange={(value) => setFundDraft((current) => ({ ...current, expenseCategoryId: value }))}
              searchable
              clearable
            />
          </SimpleGrid>
          <Switch
            label="Fund is active"
            checked={fundDraft.isActive}
            onChange={(event) => setFundDraft((current) => ({ ...current, isActive: event.currentTarget.checked }))}
          />
          {actionError && <Alert color="red">{actionError}</Alert>}
          <Group justify="flex-end" grow={isMobile}>
            <Button variant="default" onClick={() => setFundModalOpen(false)} disabled={fundBusy}>Cancel</Button>
            <Button onClick={() => void handleSaveFund()} loading={fundBusy}>
              {editingFund ? "Save changes" : "Create fund"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={entryModal != null}
        onClose={() => !entryBusy && setEntryModal(null)}
        title={entryModal === "spend" ? "Record volunteer fund spend" : "Add fund adjustment"}
        size="lg"
        fullScreen={isMobile}
        centered={!isMobile}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack gap="md">
          {entryModal === "adjustment" && (
            <Alert color="blue">
              Use a positive value to add to the fund or a negative value to reduce it. Adjustments require a clear audit description.
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              label="Date"
              type="date"
              value={entryDraft.date}
              onChange={(event) => setEntryDraft((current) => ({ ...current, date: event.currentTarget.value }))}
              required
            />
            <NumberInput
              label={`Amount (${selectedFund?.currency ?? "PLN"})`}
              value={entryDraft.amount}
              min={entryModal === "spend" ? 0.01 : undefined}
              decimalScale={2}
              fixedDecimalScale
              onChange={(value) => setEntryDraft((current) => ({ ...current, amount: typeof value === "number" ? value : "" }))}
              required
            />
          </SimpleGrid>
          {entryModal === "spend" && (
            <Stack gap="sm">
              <Alert
                color={spendExceedsAvailableBalance ? "red" : "teal"}
                title={`Available balance: ${formatMoney(availableBalanceMinor, selectedFund?.currency)}`}
              >
                {spendExceedsAvailableBalance
                  ? "Reduce the spend amount before recording it. The fund cannot go below zero."
                  : "The fund balance cannot go below zero."}
              </Alert>
              <Switch
                label="Record Finance expense (required)"
                description="The paid Finance expense and Volunteer Fund spend are recorded together. Use an adjustment for a non-cash correction."
                checked
                disabled
              />
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <Select
                  label="Account"
                  data={spendAccountOptions}
                  value={entryDraft.accountId}
                  onChange={(value) => setEntryDraft((current) => ({ ...current, accountId: value }))}
                  searchable
                  clearable
                  required
                />
                <Select
                  label="Expense category"
                  data={spendExpenseCategoryOptions}
                  value={entryDraft.categoryId}
                  onChange={(value) => setEntryDraft((current) => ({ ...current, categoryId: value }))}
                  searchable
                  clearable
                  required
                />
                <Select
                  label="Vendor"
                  data={vendorOptions}
                  value={entryDraft.vendorId}
                  onChange={(value) => setEntryDraft((current) => ({ ...current, vendorId: value }))}
                  searchable
                  clearable
                  required
                />
              </SimpleGrid>
            </Stack>
          )}
          <Textarea
            label="Description"
            placeholder={entryModal === "spend" ? "What was purchased for the volunteers?" : "Why is this balance changing?"}
            minRows={3}
            value={entryDraft.description}
            onChange={(event) => setEntryDraft((current) => ({ ...current, description: event.currentTarget.value }))}
            required
          />
          {actionError && <Alert color="red">{actionError}</Alert>}
          <Group justify="flex-end" grow={isMobile}>
            <Button variant="default" onClick={() => setEntryModal(null)} disabled={entryBusy}>Cancel</Button>
            <Button
              color={entryModal === "spend" ? "orange" : "blue"}
              onClick={() => void handleSaveEntry()}
              loading={entryBusy}
              disabled={spendExceedsAvailableBalance}
            >
              {entryModal === "spend" ? "Record spend & Finance expense" : "Add adjustment"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={reversalTarget != null}
        onClose={() => !reverseEntry.isPending && setReversalTarget(null)}
        title="Reverse volunteer fund entry"
        size="md"
        fullScreen={isMobile}
        centered={!isMobile}
      >
        <Stack gap="md">
          {reversalTarget && (
            <Alert color="grape" title={`Reverse ${entryMeta(reversalTarget.entryType).label.toLowerCase()} #${reversalTarget.id}`}>
              This creates an opposite ledger entry. The original remains visible for audit history.
              {reversalTarget.entryType === "spend" && reversalTarget.financeLinkMode === "created" && (
                <> Linked Finance expense #{reversalTarget.financeTransactionId} will be voided in the same operation.</>
              )}
              {reversalTarget.entryType === "spend" && reversalTarget.financeLinkMode === "existing" && (
                <> The linked Finance expense will be voided atomically when this fund spend is reversed.</>
              )}
            </Alert>
          )}
          <TextInput
            label="Reversal date"
            type="date"
            value={reversalDraft.date}
            onChange={(event) => setReversalDraft((current) => ({ ...current, date: event.currentTarget.value }))}
            required
          />
          <Textarea
            label="Reason"
            minRows={3}
            value={reversalDraft.reason}
            onChange={(event) => setReversalDraft((current) => ({ ...current, reason: event.currentTarget.value }))}
            required
          />
          {actionError && <Alert color="red">{actionError}</Alert>}
          <Group justify="flex-end" grow={isMobile}>
            <Button variant="default" onClick={() => setReversalTarget(null)} disabled={reverseEntry.isPending}>Cancel</Button>
            <Button color="grape" onClick={() => void handleReverse()} loading={reverseEntry.isPending}>Create reversal</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceVolunteerFunds;
