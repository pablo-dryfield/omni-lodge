import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  Pagination,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAdjustments,
  IconArrowDownRight,
  IconArrowBackUp,
  IconArrowUpRight,
  IconCoins,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconShoppingCart,
  IconWallet,
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
import {
  FinanceEmptyState,
  FinanceFormSection,
  FinanceLoadingState,
  FinanceMetricCard,
  FinanceModal,
  FinanceModalFooter,
  FinancePageHeader,
  FinancePanel,
} from "../../components/finance/FinanceUi";
import { getFinanceErrorMessage } from "../../components/finance/financeFormatters";

type FundDraft = {
  name: string;
  currency: string;
  description: string;
  fundingSourceAccountId: string | null;
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
  fundingSourceAccountId: null,
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
  allocatedInPeriod: "Original sum of allocation entries dated within From/To, regardless of the activity tab. Staff settlements transfer and reserve this compensation in the linked fund account. Later spends and reversals stay separate, so they never rewrite the original allocation amount.",
  spentInPeriod: "Sum of spend entries dated within From/To, regardless of the activity tab. It is shown as a positive total here, although each spend is negative in the ledger and reduces the fund. Reversals remain separate.",
  periodAdjustments: "Net manual, non-cash corrections dated within From/To, regardless of the activity tab. A positive adjustment increases the fund balance; a negative adjustment reduces it. Reversals remain separate.",
} as const;

const LEDGER_HEADER_HELP = {
  date: "The effective ledger date used by the From/To filter and entry order. It may differ from the time the record was created.",
  type: "How the entry arose: Allocation transfers and reserves staff compensation; Spend links a paid Finance expense and reduces the available balance; Adjustment is a manual non-cash correction; Reversal offsets an earlier entry.",
  description: "The saved audit reason or note for this entry. If none was saved, the entry number is shown.",
  attribution: "The staff member and compensation component that produced an allocation. Manual spends and adjustments may have no attribution.",
  amount: "The signed change to the fund in its currency. A plus increases the fund balance; a minus reduces it. A reversal has the opposite sign of its original entry.",
  runningBalance: "The fund balance immediately after this entry, including activity before the selected From date and activity hidden by the selected tab.",
  actions: "Shows Reverse only when an entry is eligible. Reversing keeps the original audit record and adds an equal, opposite entry; a spend reversal voids its linked expense, while an allocation reversal voids both sides of its linked transfer.",
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
  return getFinanceErrorMessage(error, fallback);
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
  const fundingSourceAccountName = selectedFund
    ? selectedFund.fundingSourceAccountName
      ?? accounts.data.find((account) => account.id === selectedFund.fundingSourceAccountId)?.name
      ?? (selectedFund.fundingSourceAccountId ? `Account #${selectedFund.fundingSourceAccountId}` : "Not configured")
    : null;
  const linkedFundAccountName = selectedFund
    ? selectedFund.linkedAccountName
      ?? accounts.data.find((account) => account.id === selectedFund.linkedAccountId)?.name
      ?? (selectedFund.linkedAccountId ? `Account #${selectedFund.linkedAccountId}` : "Not configured")
    : null;
  const availableBalanceMinor = funds.find((fund) => fund.id === selectedFundId)?.balanceMinor
    ?? selectedFund?.balanceMinor
    ?? 0;
  const draftSpendMinor = typeof entryDraft.amount === "number"
    ? Math.round(entryDraft.amount * 100)
    : 0;
  const spendExceedsAvailableBalance = entryModal === "spend"
    && draftSpendMinor > availableBalanceMinor;
  const entries = ledgerQuery.data?.entries ?? [];
  const draftCurrency = fundDraft.currency.trim().toUpperCase();
  const eligibleFundAccounts = accounts.data.filter((account) => (
    account.isActive && account.currency.trim().toUpperCase() === draftCurrency
  ));
  const fundingSourceAccountOptions = eligibleFundAccounts.map((account) => ({
    value: String(account.id),
    label: `${account.name} (${account.currency})`,
    disabled: String(account.id) === fundDraft.linkedAccountId,
  }));
  const linkedFundAccountOptions = eligibleFundAccounts.map((account) => ({
    value: String(account.id),
    label: `${account.name} (${account.currency})`,
    disabled: String(account.id) === fundDraft.fundingSourceAccountId,
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
      fundingSourceAccountId: selectedFund.fundingSourceAccountId
        ? String(selectedFund.fundingSourceAccountId)
        : null,
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
    const normalizedCurrency = fundDraft.currency.trim().toUpperCase();
    const fundingSourceAccount = fundDraft.fundingSourceAccountId
      ? accounts.data.find((account) => String(account.id) === fundDraft.fundingSourceAccountId)
      : null;
    const linkedFundAccount = fundDraft.linkedAccountId
      ? accounts.data.find((account) => String(account.id) === fundDraft.linkedAccountId)
      : null;
    if (fundDraft.fundingSourceAccountId && (
      !fundingSourceAccount?.isActive
      || fundingSourceAccount.currency.trim().toUpperCase() !== normalizedCurrency
    )) {
      setActionError("Select an active funding source account in the fund currency.");
      return;
    }
    if (fundDraft.linkedAccountId && (
      !linkedFundAccount?.isActive
      || linkedFundAccount.currency.trim().toUpperCase() !== normalizedCurrency
    )) {
      setActionError("Select an active linked fund account in the fund currency.");
      return;
    }
    if (fundDraft.fundingSourceAccountId && fundDraft.fundingSourceAccountId === fundDraft.linkedAccountId) {
      setActionError("Funding source and linked fund account must be different accounts.");
      return;
    }
    const payload: VolunteerFundPayload = {
      name: fundDraft.name.trim(),
      currency: normalizedCurrency,
      description: fundDraft.description.trim() || null,
      fundingSourceAccountId: fundDraft.fundingSourceAccountId
        ? Number(fundDraft.fundingSourceAccountId)
        : null,
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
        <ActionIcon
          variant="light"
          color="grape"
          size={36}
          onClick={() => openReverse(entry)}
          aria-label={`Reverse fund entry ${entry.id}`}
        >
          <IconArrowBackUp size={17} />
        </ActionIcon>
      </Tooltip>
    ) : null;
  };

  const fundBusy = createFund.isPending || updateFund.isPending;
  const entryBusy = createSpend.isPending || createAdjustment.isPending;

  return (
    <Stack gap="lg">
      <FinancePageHeader
        eyebrow="Planning"
        title="Volunteer funds"
        description="Keep volunteer compensation allocations, purchases, adjustments and reversals in a complete auditable ledger."
        icon={<IconWallet size={22} />}
        actions={
          <Group gap="xs" grow={isMobile}>
            <Button variant="default" leftSection={<IconPencil size={16} />} onClick={openEditFund} disabled={!selectedFund}>
              Edit fund
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={openNewFund}>New fund</Button>
          </Group>
        }
      />

      {fundsQuery.isError && (
        <Alert color="red" title="Unable to load volunteer funds">
          {extractErrorMessage(fundsQuery.error, "The volunteer funds endpoint could not be loaded.")}
        </Alert>
      )}
      {actionError && (
        <Alert
          color="red"
          title="Action could not be completed"
          withCloseButton
          closeButtonLabel="Dismiss action error"
          onClose={() => setActionError(null)}
        >
          {actionError}
        </Alert>
      )}

      {fundsQuery.isLoading ? (
        <FinancePanel noPadding>
          <FinanceLoadingState label="Loading volunteer funds" />
        </FinancePanel>
      ) : funds.length === 0 ? (
        <FinancePanel noPadding>
          <FinanceEmptyState
            title="Create the first volunteer fund"
            description="Transfer volunteer compensation from its source account into a linked fund account. Original allocations stay visible, while later spending is recorded separately and reduces the available balance."
            icon={<IconCoins size={27} />}
            action={<Button leftSection={<IconPlus size={16} />} onClick={openNewFund}>Create volunteer fund</Button>}
          />
        </FinancePanel>
      ) : (
        <>
          <Card withBorder radius="md" padding="md">
            <Stack gap="sm">
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
                    <Badge color="gray" variant="filled">Inactive - read only</Badge>
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
              {selectedFund && (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">Source account - compensation is taken from</Text>
                    <Text size="sm" fw={600}>{fundingSourceAccountName}</Text>
                  </Stack>
                  <Stack gap={0}>
                    <Text size="xs" c="dimmed">Linked fund account - compensation is reserved here</Text>
                    <Text size="sm" fw={600}>{linkedFundAccountName}</Text>
                  </Stack>
                </SimpleGrid>
              )}
            </Stack>
          </Card>

          {selectedFund && !selectedFund.isActive && (
            <Alert color="gray" title="This Volunteer Fund is inactive">
              New spends and adjustments are disabled. You can still review the ledger and reverse an existing entry when needed.
            </Alert>
          )}

          {selectedFund?.isActive
            && (!selectedFund.fundingSourceAccountId || !selectedFund.linkedAccountId) && (
            <Alert color="orange" title="Account routing is incomplete">
              Staff compensation cannot be allocated to this fund until both a funding source account and a linked fund account are configured.
            </Alert>
          )}

          {selectedFund && (
            <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }}>
              <FinanceMetricCard
                label="Available balance"
                value={formatMoney(availableBalanceMinor, selectedFund.currency)}
                description="Current amount available to spend"
                icon={<IconWallet size={20} />}
                accent={availableBalanceMinor < 0 ? "rose" : "violet"}
                detail={<FinanceInfoButton label="Available balance" description={KPI_HELP.availableBalance} />}
              />
              <FinanceMetricCard
                label="Allocated in period"
                value={formatMoney(selectedFund.allocationTotalMinor, selectedFund.currency)}
                description="Compensation routed into this fund"
                icon={<IconArrowUpRight size={20} />}
                accent="green"
                detail={<FinanceInfoButton label="Allocated in period" description={KPI_HELP.allocatedInPeriod} />}
              />
              <FinanceMetricCard
                label="Spent in period"
                value={formatMoney(Math.abs(selectedFund.spendTotalMinor), selectedFund.currency)}
                description="Purchases recorded against the fund"
                icon={<IconArrowDownRight size={20} />}
                accent="orange"
                detail={<FinanceInfoButton label="Spent in period" description={KPI_HELP.spentInPeriod} />}
              />
              <FinanceMetricCard
                label="Period adjustments"
                value={formatMoney(selectedFund.adjustmentTotalMinor, selectedFund.currency)}
                description="Audited non-cash corrections"
                icon={<IconAdjustments size={20} />}
                accent="slate"
                detail={<FinanceInfoButton label="Period adjustments" description={KPI_HELP.periodAdjustments} />}
              />
            </SimpleGrid>
          )}

          <Card withBorder radius="md" padding="md">
            <Stack gap="md">
              <Group justify="space-between" align="flex-end" wrap="wrap">
                <Stack gap={2}>
                  <Text fw={700}>Fund ledger</Text>
                  <Text size="xs" c="dimmed">Settlement allocations retain their original amount. Spends, adjustments and reversals are recorded as separate auditable entries.</Text>
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
              <ScrollArea type="auto" scrollbarSize={4}>
                <SegmentedControl
                  aria-label="Filter volunteer fund activity"
                  value={entryTab}
                  data={ENTRY_TABS}
                  fullWidth={!isMobile}
                  onChange={(value) => {
                    setEntryTab(value as typeof entryTab);
                    setLedgerPage(1);
                  }}
                  styles={{ root: { minWidth: isMobile ? 520 : undefined } }}
                />
              </ScrollArea>
            </Stack>
          </Card>

          {ledgerQuery.isError && (
            <Alert color="red" title="Unable to load fund activity">
              {extractErrorMessage(ledgerQuery.error, "The fund ledger could not be loaded.")}
            </Alert>
          )}
          {ledgerQuery.isLoading ? (
            <FinanceLoadingState label="Loading fund activity" />
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

      <FinanceModal
        opened={fundModalOpen}
        onClose={() => !fundBusy && setFundModalOpen(false)}
        title={editingFund ? "Edit volunteer fund" : "New volunteer fund"}
        size="lg"
        fullScreen={isMobile}
        centered={!isMobile}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack
          component="form"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveFund();
          }}
        >
          <FinanceFormSection title="Fund identity" description="Name the restricted ledger and choose its reporting currency." icon={<IconWallet size={18} />}>
            <Stack gap="sm">
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
                      const fundingSourceAccount = accounts.data.find(
                        (account) => String(account.id) === current.fundingSourceAccountId,
                      );
                      const linkedAccount = accounts.data.find(
                        (account) => String(account.id) === current.linkedAccountId,
                      );
                      return {
                        ...current,
                        currency,
                        fundingSourceAccountId:
                          fundingSourceAccount?.currency.trim().toUpperCase() === currency
                            ? current.fundingSourceAccountId
                            : null,
                        linkedAccountId:
                          linkedAccount?.currency.trim().toUpperCase() === currency
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
            </Stack>
          </FinanceFormSection>
          <FinanceFormSection
            title="Account routing"
            description="Choose where compensation is taken from and where the fund keeps it reserved."
            icon={<IconCoins size={18} />}
          >
            <Stack gap="sm">
              <Alert color="blue" variant="light" radius="md">
                The source account is where volunteer compensation is taken from. The linked fund account is where
                that amount is reserved and later used for fund expenses. Use two different active
                {` ${draftCurrency || "fund-currency"}`} accounts.
              </Alert>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <Select
                  label="Funding source account"
                  description="Where volunteer compensation is taken from."
                  leftSection={<IconArrowDownRight size={16} />}
                  data={fundingSourceAccountOptions}
                  value={fundDraft.fundingSourceAccountId}
                  onChange={(value) =>
                    setFundDraft((current) => ({
                      ...current,
                      fundingSourceAccountId: value,
                      linkedAccountId: value && value === current.linkedAccountId ? null : current.linkedAccountId,
                    }))
                  }
                  searchable
                  clearable
                  nothingFoundMessage={`No active ${draftCurrency || "matching"} accounts`}
                />
                <Select
                  label="Linked fund account"
                  description="Where compensation is reserved and fund expenses are paid."
                  leftSection={<IconWallet size={16} />}
                  data={linkedFundAccountOptions}
                  value={fundDraft.linkedAccountId}
                  onChange={(value) =>
                    setFundDraft((current) => ({
                      ...current,
                      linkedAccountId: value,
                      fundingSourceAccountId:
                        value && value === current.fundingSourceAccountId
                          ? null
                          : current.fundingSourceAccountId,
                    }))
                  }
                  searchable
                  clearable
                  nothingFoundMessage={`No active ${draftCurrency || "matching"} accounts`}
                />
              </SimpleGrid>
              <Select
                label="Default expense category"
                description="Preselected when recording a purchase from the fund."
                data={fundExpenseCategoryOptions}
                value={fundDraft.expenseCategoryId}
                onChange={(value) => setFundDraft((current) => ({ ...current, expenseCategoryId: value }))}
                searchable
                clearable
              />
            </Stack>
          </FinanceFormSection>
          <Switch
            label="Fund is active"
            checked={fundDraft.isActive}
            onChange={(event) => setFundDraft((current) => ({ ...current, isActive: event.currentTarget.checked }))}
          />
          {actionError && <Alert color="red">{actionError}</Alert>}
          <FinanceModalFooter>
            <Button type="button" variant="default" onClick={() => setFundModalOpen(false)} disabled={fundBusy}>Cancel</Button>
            <Button type="submit" loading={fundBusy}>
              {editingFund ? "Save changes" : "Create fund"}
            </Button>
          </FinanceModalFooter>
        </Stack>
      </FinanceModal>

      <FinanceModal
        opened={entryModal != null}
        onClose={() => !entryBusy && setEntryModal(null)}
        title={entryModal === "spend" ? "Record volunteer fund spend" : "Add fund adjustment"}
        size="lg"
        fullScreen={isMobile}
        centered={!isMobile}
        scrollAreaComponent={ScrollArea.Autosize}
      >
        <Stack
          component="form"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveEntry();
          }}
        >
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
          <FinanceModalFooter>
            <Button type="button" variant="default" onClick={() => setEntryModal(null)} disabled={entryBusy}>Cancel</Button>
            <Button
              type="submit"
              color={entryModal === "spend" ? "orange" : "blue"}
              loading={entryBusy}
              disabled={spendExceedsAvailableBalance}
            >
              {entryModal === "spend" ? "Record spend & Finance expense" : "Add adjustment"}
            </Button>
          </FinanceModalFooter>
        </Stack>
      </FinanceModal>

      <FinanceModal
        opened={reversalTarget != null}
        onClose={() => !reverseEntry.isPending && setReversalTarget(null)}
        title="Reverse volunteer fund entry"
        size="md"
        fullScreen={isMobile}
        centered={!isMobile}
      >
        <Stack
          component="form"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            void handleReverse();
          }}
        >
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
          <FinanceModalFooter>
            <Button type="button" variant="default" onClick={() => setReversalTarget(null)} disabled={reverseEntry.isPending}>Cancel</Button>
            <Button type="submit" color="grape" loading={reverseEntry.isPending}>Create reversal</Button>
          </FinanceModalFooter>
        </Stack>
      </FinanceModal>
    </Stack>
  );
};

export default FinanceVolunteerFunds;
