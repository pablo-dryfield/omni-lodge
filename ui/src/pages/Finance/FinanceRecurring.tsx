import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconCalendar,
  IconPlayerPlay,
  IconPlus,
  IconRepeat,
  IconTrash,
  IconWallet,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceRecurringRule,
  deleteFinanceRecurringRule,
  executeFinanceRecurringRules,
  fetchFinanceAccounts,
  fetchFinanceCategories,
  fetchFinanceClients,
  fetchFinanceRecurringRules,
  fetchFinanceVendors,
} from "../../actions/financeActions";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceRecurringExecution,
  selectFinanceRecurringRules,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { FinanceRecurringRule } from "../../types/finance";
import {
  FinanceConfirmModal,
  FinanceEmptyState,
  FinanceErrorState,
  FinanceFormSection,
  FinanceLoadingState,
  FinanceModal,
  FinanceModalFooter,
  FinancePageHeader,
  FinancePanel,
  FinancePrimaryAction,
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

type RecurringDraft = {
  kind: "income" | "expense";
  frequency: FinanceRecurringRule["frequency"];
  interval: number;
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  timezone: string;
  accountId: number | null;
  categoryId: number | null;
  counterpartyId: number | null;
  amountMinor: number;
  currency: string;
  description: string | null;
};

type RuleTemplate = {
  amountMinor?: number;
  currency?: string;
  description?: string | null;
  accountId?: number;
  categoryId?: number;
  counterpartyType?: "vendor" | "client";
  counterpartyId?: number;
};

const createDefaultDraft = (): RecurringDraft => ({
  kind: "expense",
  frequency: "monthly",
  interval: 1,
  byMonthDay: null,
  startDate: dayjs().format("YYYY-MM-DD"),
  endDate: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Warsaw",
  accountId: null,
  categoryId: null,
  counterpartyId: null,
  amountMinor: 0,
  currency: "PLN",
  description: null,
});

const frequencyUnit = (frequency: FinanceRecurringRule["frequency"], interval: number): string => {
  if (interval !== 1) {
    return frequency === "daily"
      ? "days"
      : frequency === "weekly"
        ? "weeks"
        : frequency === "monthly"
          ? "months"
          : frequency === "quarterly"
            ? "quarters"
            : "years";
  }
  return frequency === "daily"
    ? "day"
    : frequency === "weekly"
      ? "week"
      : frequency === "monthly"
        ? "month"
        : frequency === "quarterly"
          ? "quarter"
          : "year";
};

const describeSchedule = (rule: FinanceRecurringRule): string =>
  `Every ${rule.interval === 1 ? "" : `${rule.interval} `}${frequencyUnit(rule.frequency, rule.interval)}`
  + (rule.byMonthDay ? ` on day ${rule.byMonthDay}` : "");

const FinanceRecurring = () => {
  const dispatch = useAppDispatch();
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);
  const recurring = useAppSelector(selectFinanceRecurringRules);
  const execution = useAppSelector(selectFinanceRecurringExecution);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<RecurringDraft>(createDefaultDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinanceRecurringRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [frequencyFilter, setFrequencyFilter] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchFinanceAccounts());
    void dispatch(fetchFinanceCategories());
    void dispatch(fetchFinanceVendors());
    void dispatch(fetchFinanceClients());
    void dispatch(fetchFinanceRecurringRules());
  }, [dispatch]);

  const accountOptions = useMemo(
    () =>
      accounts.data
        .filter((account) => account.isActive)
        .map((account) => ({
          value: String(account.id),
          label: `${account.name} (${account.currency})`,
        })),
    [accounts.data],
  );

  const categoryOptions = useMemo(
    () =>
      categories.data
        .filter((category) => category.isActive && category.kind === draft.kind)
        .map((category) => ({
          value: String(category.id),
          label: category.name,
        })),
    [categories.data, draft.kind],
  );

  const counterpartyOptions = useMemo(
    () => (draft.kind === "expense" ? vendors.data : clients.data)
      .filter((counterparty) => counterparty.isActive)
      .map((counterparty) => ({
        value: String(counterparty.id),
        label: counterparty.name,
      })),
    [clients.data, draft.kind, vendors.data],
  );

  const visibleRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    return recurring.data.filter((rule) => {
      if (statusFilter && rule.status !== statusFilter) {
        return false;
      }
      if (frequencyFilter && rule.frequency !== frequencyFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const template = rule.templateJson as RuleTemplate;
      const accountName = accounts.data.find((account) => account.id === template.accountId)?.name;
      const categoryName = categories.data.find((category) => category.id === template.categoryId)?.name;
      const counterpartyName = (rule.kind === "expense" ? vendors.data : clients.data)
        .find((counterparty) => counterparty.id === template.counterpartyId)?.name;
      return [rule.kind, rule.frequency, rule.status, template.description, accountName, categoryName, counterpartyName]
        .some((value) => String(value ?? "").toLowerCase().includes(query));
    });
  }, [accounts.data, categories.data, clients.data, frequencyFilter, recurring.data, search, statusFilter, vendors.data]);

  const openCreateModal = () => {
    setDraft(createDefaultDraft());
    setSaveError(null);
    setModalOpen(true);
  };

  const handleCreateRule = async () => {
    if (!draft.accountId || !draft.categoryId || !draft.counterpartyId) {
      setSaveError(
        `Select an account, category, and ${draft.kind === "expense" ? "vendor" : "client"} before creating the rule.`,
      );
      return;
    }
    const selectedAccount = accounts.data.find((account) => account.id === draft.accountId);
    if (!selectedAccount?.isActive) {
      setSaveError("Select an active account for this rule.");
      return;
    }
    const selectedCategory = categories.data.find((category) => category.id === draft.categoryId);
    if (!selectedCategory?.isActive || selectedCategory.kind !== draft.kind) {
      setSaveError(`Select an active ${draft.kind} category for this rule.`);
      return;
    }
    const selectedCounterparty = (draft.kind === "expense" ? vendors.data : clients.data)
      .find((counterparty) => counterparty.id === draft.counterpartyId);
    if (!selectedCounterparty?.isActive) {
      setSaveError(`Select an active ${draft.kind === "expense" ? "vendor" : "client"} for this rule.`);
      return;
    }
    const normalizedCurrency = draft.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setSaveError("Currency must be a three-letter code, such as PLN, EUR, or USD.");
      return;
    }
    if (selectedAccount.currency.trim().toUpperCase() !== normalizedCurrency) {
      setSaveError(`Currency must match the selected account (${selectedAccount.currency.toUpperCase()}).`);
      return;
    }
    if (!Number.isSafeInteger(draft.amountMinor) || draft.amountMinor <= 0) {
      setSaveError("Amount must be greater than zero.");
      return;
    }
    if (!Number.isSafeInteger(draft.interval) || draft.interval <= 0) {
      setSaveError("Repeat interval must be a positive whole number.");
      return;
    }
    if (!dayjs(draft.startDate).isValid()) {
      setSaveError("Select a valid start date.");
      return;
    }
    if (draft.endDate && (!dayjs(draft.endDate).isValid() || dayjs(draft.endDate).isBefore(draft.startDate, "day"))) {
      setSaveError("End date must be on or after the start date.");
      return;
    }
    if (!draft.timezone.trim()) {
      setSaveError("Timezone is required.");
      return;
    }

    const templateJson = {
      kind: draft.kind,
      accountId: draft.accountId,
      currency: normalizedCurrency,
      amountMinor: draft.amountMinor,
      categoryId: draft.categoryId,
      counterpartyType: draft.kind === "expense" ? "vendor" : "client",
      counterpartyId: draft.counterpartyId,
      status: "planned",
      description: draft.description?.trim() || null,
    };

    try {
      setSaving(true);
      setSaveError(null);
      await dispatch(
        createFinanceRecurringRule({
          kind: draft.kind,
          frequency: draft.frequency,
          interval: draft.interval,
          byMonthDay: draft.byMonthDay,
          startDate: draft.startDate,
          endDate: draft.endDate,
          timezone: draft.timezone.trim(),
          templateJson,
        }),
      ).unwrap();
      setModalOpen(false);
      setDraft(createDefaultDraft());
    } catch (error) {
      setSaveError(getFinanceErrorMessage(error, "Unable to create this recurring rule."));
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async () => {
    await dispatch(executeFinanceRecurringRules());
    await dispatch(fetchFinanceRecurringRules());
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    try {
      setDeleting(true);
      setDeleteError(null);
      await dispatch(deleteFinanceRecurringRule(deleteTarget.id)).unwrap();
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(getFinanceErrorMessage(error, "Unable to delete this recurring rule."));
    } finally {
      setDeleting(false);
    }
  };

  const renderRuleAmount = (rule: FinanceRecurringRule) => {
    const template = rule.templateJson as RuleTemplate;
    return formatFinanceMoneyMinor(template.amountMinor ?? 0, template.currency ?? "PLN");
  };

  const renderStatus = (rule: FinanceRecurringRule) => (
    <Badge color={rule.status === "active" ? "teal" : "gray"} variant="light">
      {humanizeFinanceValue(rule.status)}
    </Badge>
  );

  const renderDeleteAction = (rule: FinanceRecurringRule) => (
    <Tooltip label="Delete recurring rule">
      <ActionIcon
        variant="subtle"
        color="red"
        onClick={() => {
          setDeleteError(null);
          setDeleteTarget(rule);
        }}
        aria-label={`Delete recurring rule ${rule.id}`}
      >
        <IconTrash size={18} />
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        title="Recurring rules"
        description="Schedule planned income and expenses, then monitor the next run from one place."
        icon={<IconRepeat size={24} />}
        actions={
          <Group gap="sm" wrap="wrap">
            <Button
              variant="light"
              leftSection={<IconPlayerPlay size={16} />}
              loading={execution.loading}
              onClick={() => void handleExecute()}
            >
              Run due rules
            </Button>
            <FinancePrimaryAction leftSection={<IconPlus size={18} />} onClick={openCreateModal}>
              New rule
            </FinancePrimaryAction>
          </Group>
        }
      />

      {execution.error && (
        <FinanceErrorState title="Recurring run failed" message={execution.error} />
      )}
      {execution.result && !execution.error && (
        <Alert color="teal" variant="light" radius="md" title="Recurring run complete">
          Processed {execution.result.processed} rules: {execution.result.createdTransactions} transactions created and {execution.result.skipped} skipped.
        </Alert>
      )}

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search description, account, category, or counterparty"
      >
        <Select
          placeholder="All statuses"
          aria-label="Filter recurring rules by status"
          data={[
            { value: "active", label: "Active" },
            { value: "paused", label: "Paused" },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          clearable
          style={{ flex: "1 1 150px", maxWidth: isMobile ? undefined : 190 }}
        />
        <Select
          placeholder="All frequencies"
          aria-label="Filter recurring rules by frequency"
          data={[
            { value: "daily", label: "Daily" },
            { value: "weekly", label: "Weekly" },
            { value: "monthly", label: "Monthly" },
            { value: "quarterly", label: "Quarterly" },
            { value: "yearly", label: "Yearly" },
          ]}
          value={frequencyFilter}
          onChange={setFrequencyFilter}
          clearable
          style={{ flex: "1 1 170px", maxWidth: isMobile ? undefined : 210 }}
        />
      </FinanceToolbar>

      <FinancePanel
        title="Automation schedule"
        description={`${visibleRules.length} of ${recurring.data.length} rules shown`}
        noPadding
      >
        {recurring.error ? (
          <FinanceErrorState
            message={recurring.error}
            onRetry={() => void dispatch(fetchFinanceRecurringRules())}
          />
        ) : recurring.loading && recurring.data.length === 0 ? (
          <FinanceLoadingState label="Loading recurring rules" />
        ) : visibleRules.length === 0 ? (
          <FinanceEmptyState
            icon={<IconRepeat size={25} />}
            title={recurring.data.length === 0 ? "No recurring rules yet" : "No matching rules"}
            description={
              recurring.data.length === 0
                ? "Create a rule for costs or income that repeat on a predictable schedule."
                : "Try clearing a filter or using a broader search."
            }
            action={recurring.data.length === 0 ? <Button onClick={openCreateModal}>Create first rule</Button> : undefined}
          />
        ) : isMobile ? (
          <Stack gap={0} p="sm">
            {visibleRules.map((rule) => {
              const template = rule.templateJson as RuleTemplate;
              const account = accounts.data.find((item) => item.id === template.accountId)?.name ?? "—";
              const category = categories.data.find((item) => item.id === template.categoryId)?.name ?? "—";
              const counterparty = (rule.kind === "expense" ? vendors.data : clients.data)
                .find((item) => item.id === template.counterpartyId)?.name ?? "—";
              return (
                <FinanceRecordCard
                  key={rule.id}
                  leading={
                    <ThemeIcon variant="light" color={rule.kind === "income" ? "teal" : "orange"} radius="md">
                      <IconRepeat size={17} />
                    </ThemeIcon>
                  }
                  title={template.description || `${humanizeFinanceValue(rule.kind)} rule`}
                  subtitle={describeSchedule(rule)}
                  status={renderStatus(rule)}
                  fields={[
                    { label: "Amount", value: renderRuleAmount(rule) },
                    { label: "Next run", value: rule.nextRunDate ? formatFinanceDate(rule.nextRunDate) : "No next run" },
                    { label: "Account", value: account },
                    { label: "Category", value: category },
                    { label: rule.kind === "expense" ? "Vendor" : "Client", value: counterparty },
                  ]}
                  actions={renderDeleteAction(rule)}
                />
              );
            })}
          </Stack>
        ) : (
          <ScrollArea offsetScrollbars type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={880}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Rule</Table.Th>
                  <Table.Th>Schedule</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>Next run</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th ta="right">Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {visibleRules.map((rule) => {
                  const template = rule.templateJson as RuleTemplate;
                  const counterparty = (rule.kind === "expense" ? vendors.data : clients.data)
                    .find((item) => item.id === template.counterpartyId)?.name ?? "No counterparty";
                  return (
                    <Table.Tr key={rule.id}>
                      <Table.Td>
                        <Stack gap={1}>
                          <Text fw={700}>{template.description || `${humanizeFinanceValue(rule.kind)} rule`}</Text>
                          <Text size="xs" c="dimmed">
                            Rule #{rule.id} · {humanizeFinanceValue(rule.kind)} · {counterparty}
                          </Text>
                        </Stack>
                      </Table.Td>
                      <Table.Td>{describeSchedule(rule)}</Table.Td>
                      <Table.Td ta="right" fw={700}>{renderRuleAmount(rule)}</Table.Td>
                      <Table.Td>{rule.nextRunDate ? formatFinanceDate(rule.nextRunDate) : "No next run"}</Table.Td>
                      <Table.Td>{renderStatus(rule)}</Table.Td>
                      <Table.Td ta="right">{renderDeleteAction(rule)}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </FinancePanel>

      <FinanceModal
        opened={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title="New recurring rule"
        size="xl"
        scrollAreaComponent={ScrollArea.Autosize}
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateRule();
          }}
        >
          <Stack gap="md">
            <FinanceFormSection
              title="Schedule"
              description="Choose when this rule starts and how often it repeats."
              icon={<IconCalendar size={17} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
                <Select
                  label="Frequency"
                  data={[
                    { value: "daily", label: "Daily" },
                    { value: "weekly", label: "Weekly" },
                    { value: "monthly", label: "Monthly" },
                    { value: "quarterly", label: "Quarterly" },
                    { value: "yearly", label: "Yearly" },
                  ]}
                  value={draft.frequency}
                  onChange={(value) =>
                    setDraft((state) => ({
                      ...state,
                      frequency: (value ?? "monthly") as FinanceRecurringRule["frequency"],
                    }))
                  }
                />
                <NumberInput
                  label="Repeat every"
                  description={frequencyUnit(draft.frequency, draft.interval)}
                  value={draft.interval}
                  min={1}
                  onChange={(value) => setDraft((state) => ({ ...state, interval: Number(value) || 1 }))}
                />
                {draft.frequency !== "weekly" && (
                  <NumberInput
                    label="Day of month"
                    value={draft.byMonthDay ?? undefined}
                    onChange={(value) =>
                      setDraft((state) => ({ ...state, byMonthDay: value ? Number(value) : null }))
                    }
                    min={1}
                    max={31}
                  />
                )}
                <TextInput
                  label="Timezone"
                  value={draft.timezone}
                  onChange={(event) => setDraft((state) => ({ ...state, timezone: event.currentTarget.value }))}
                  withAsterisk
                />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <DateInput
                  label="Start date"
                  value={dayjs(draft.startDate).toDate()}
                  onChange={(value) => setDraft((state) => ({ ...state, startDate: dayjs(value).format("YYYY-MM-DD") }))}
                  withAsterisk
                />
                <DateInput
                  label="End date"
                  value={draft.endDate ? dayjs(draft.endDate).toDate() : null}
                  onChange={(value) =>
                    setDraft((state) => ({ ...state, endDate: value ? dayjs(value).format("YYYY-MM-DD") : null }))
                  }
                  clearable
                />
              </SimpleGrid>
            </FinanceFormSection>

            <FinanceFormSection
              title="Planned transaction"
              description="Define the transaction that will be created on each due date."
              icon={<IconWallet size={17} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                <Select
                  label="Kind"
                  data={[
                    { value: "expense", label: "Expense" },
                    { value: "income", label: "Income" },
                  ]}
                  value={draft.kind}
                  onChange={(value) =>
                    setDraft((state) => ({
                      ...state,
                      kind: (value ?? "expense") as RecurringDraft["kind"],
                      categoryId: null,
                      counterpartyId: null,
                    }))
                  }
                />
                <Select
                  label="Account"
                  data={accountOptions}
                  value={draft.accountId ? String(draft.accountId) : null}
                  onChange={(value) => {
                    const account = accounts.data.find((item) => String(item.id) === value);
                    setDraft((state) => ({
                      ...state,
                      accountId: account?.id ?? null,
                      currency: account?.currency.toUpperCase() ?? state.currency,
                    }));
                  }}
                  searchable
                  withAsterisk
                />
                <Select
                  label="Category"
                  data={categoryOptions}
                  value={draft.categoryId ? String(draft.categoryId) : null}
                  onChange={(value) =>
                    setDraft((state) => ({ ...state, categoryId: value ? Number(value) : null }))
                  }
                  searchable
                  withAsterisk
                />
                <Select
                  label={draft.kind === "expense" ? "Vendor" : "Client"}
                  data={counterpartyOptions}
                  value={draft.counterpartyId ? String(draft.counterpartyId) : null}
                  onChange={(value) =>
                    setDraft((state) => ({ ...state, counterpartyId: value ? Number(value) : null }))
                  }
                  searchable
                  withAsterisk
                />
                <SimpleGrid cols={2} spacing="sm">
                  <NumberInput
                    label="Amount"
                    decimalScale={2}
                    fixedDecimalScale
                    min={0.01}
                    value={draft.amountMinor / 100}
                    onValueChange={({ value }) =>
                      setDraft((state) => ({
                        ...state,
                        amountMinor: Math.round((Number(value) || 0) * 100),
                      }))
                    }
                    withAsterisk
                  />
                  <TextInput
                    label="Currency"
                    value={draft.currency}
                    onChange={(event) =>
                      setDraft((state) => ({ ...state, currency: event.currentTarget.value.toUpperCase() }))
                    }
                    maxLength={3}
                    withAsterisk
                    readOnly={Boolean(draft.accountId)}
                    description={draft.accountId ? "Uses the selected account currency" : "Three-letter currency code"}
                  />
                </SimpleGrid>
              </SimpleGrid>
            </FinanceFormSection>

            <FinanceFormSection title="Description" description="Help staff recognize the generated transaction.">
              <Textarea
                label="Transaction description"
                minRows={3}
                value={draft.description ?? ""}
                onChange={(event) =>
                  setDraft((state) => ({ ...state, description: event.currentTarget.value || null }))
                }
              />
            </FinanceFormSection>

            {saveError && <Alert color="red">{saveError}</Alert>}

            <FinanceModalFooter>
              <Button type="button" variant="default" onClick={() => setModalOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <FinancePrimaryAction
                type="submit"
                loading={saving}
                disabled={
                  !draft.accountId
                  || !draft.categoryId
                  || !draft.counterpartyId
                  || draft.amountMinor <= 0
                  || draft.currency.trim().length !== 3
                  || !draft.timezone.trim()
                  || !dayjs(draft.startDate).isValid()
                  || Boolean(draft.endDate && dayjs(draft.endDate).isBefore(draft.startDate, "day"))
                }
              >
                Create rule
              </FinancePrimaryAction>
            </FinanceModalFooter>
          </Stack>
        </form>
      </FinanceModal>

      <FinanceConfirmModal
        opened={deleteTarget != null}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void handleDelete()}
        title="Delete recurring rule?"
        description="The rule will stop creating future planned transactions. Transactions already created will remain unchanged."
        confirmLabel="Delete rule"
        loading={deleting}
      >
        {deleteTarget && (
          <Stack gap="sm">
            <Text size="sm" fw={700}>{(deleteTarget.templateJson as RuleTemplate).description || `Rule #${deleteTarget.id}`}</Text>
            {deleteError && <Alert color="red">{deleteError}</Alert>}
          </Stack>
        )}
      </FinanceConfirmModal>
    </Stack>
  );
};

export default FinanceRecurring;
