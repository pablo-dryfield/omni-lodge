import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Menu,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconCalendar,
  IconChartPie,
  IconClockExclamation,
  IconDotsVertical,
  IconEdit,
  IconHistory,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRepeat,
  IconTrash,
  IconWallet,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import {
  createFinanceRecurringRule,
  deleteFinanceRecurringRule,
  executeFinanceRecurringRules,
  fetchFinanceRecurringBootstrap,
  fetchFinanceRecurringRules,
  updateFinanceRecurringRule,
} from "../../actions/financeActions";
import {
  FinanceConfirmModal,
  FinanceEmptyState,
  FinanceErrorState,
  FinanceFormSection,
  FinanceLoadingState,
  FinanceMetricCard,
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
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { InlineVendorSelect } from "../../components/finance/InlineVendorSelect";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import {
  selectFinanceAccounts,
  selectFinanceCategories,
  selectFinanceClients,
  selectFinanceRecurringExecution,
  selectFinanceRecurringRules,
  selectFinanceVendors,
} from "../../selectors/financeSelectors";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setFinanceBasics } from "../../reducers/financeReducer";
import type {
  FinanceRecurringFrequency,
  FinanceRecurringRule,
} from "../../types/finance";
import FinanceRecurringOccurrences from "./FinanceRecurringOccurrences";
import InlineCategorySelect from "./InlineCategorySelect";
import { getInlineParentCategoryOptions } from "./inlineCategoryCreate";
import {
  buildRecurringRulePayload,
  canToggleRecurringRuleStatus,
  changeDraftFrequency,
  changeDraftStartDate,
  countRecurringLifecycle,
  createRecurringRuleDraft,
  describeRecurringSchedule,
  getRecurringRuleLifecycle,
  getRecurringExecutionPresentation,
  projectRecurringRulesMonthly,
  recurringFrequencyUnit,
  type RecurringRuleDraft,
  usesMonthDay,
  validateRecurringRuleDraft,
} from "./financeRecurringRules";
import classes from "./FinanceRecurring.module.css";

const FREQUENCY_OPTIONS: { value: FinanceRecurringFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const templateOf = (rule: FinanceRecurringRule): Record<string, unknown> =>
  rule.templateJson as Record<string, unknown>;

const ruleTitle = (rule: FinanceRecurringRule): string => {
  const description = templateOf(rule).description;
  return typeof description === "string" && description.trim()
    ? description
    : `Recurring ${rule.kind} #${rule.id}`;
};

const findCashPlnAccount = <T extends { id: number; name: string; currency: string; isActive: boolean }>(
  accounts: T[],
): T | undefined => accounts.find((account) => {
  const name = account.name.trim().toLowerCase();
  return account.isActive
    && account.currency.trim().toUpperCase() === "PLN"
    && (name.includes("cash register") || name === "cash pln" || name.includes("cash in pln"));
});

const FinanceRecurring = () => {
  const dispatch = useAppDispatch();
  const recurringAccess = useModuleAccess(PAGE_SLUGS.financeRecurring);
  const transactionAccess = useModuleAccess(PAGE_SLUGS.financeTransactions);
  const accounts = useAppSelector(selectFinanceAccounts);
  const categories = useAppSelector(selectFinanceCategories);
  const vendors = useAppSelector(selectFinanceVendors);
  const clients = useAppSelector(selectFinanceClients);
  const recurring = useAppSelector(selectFinanceRecurringRules);
  const execution = useAppSelector(selectFinanceRecurringExecution);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FinanceRecurringRule | null>(null);
  const [draft, setDraft] = useState<RecurringRuleDraft>(() => createRecurringRuleDraft());
  const [saving, setSaving] = useState(false);
  const [inlineCreateOpen, setInlineCreateOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [mutatingRuleId, setMutatingRuleId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinanceRecurringRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedRuleId, setSelectedRuleId] = useState<number | null>(null);
  const [occurrenceReloadToken, setOccurrenceReloadToken] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [frequencyFilter, setFrequencyFilter] = useState<string | null>(null);
  const bootstrapRequestedRef = useRef(false);

  const loadBootstrap = useCallback(async () => {
    try {
      const response = await dispatch(fetchFinanceRecurringBootstrap()).unwrap();
      dispatch(setFinanceBasics({
        accounts: response.accounts,
        categories: response.categories,
        vendors: response.vendors,
        clients: response.clients,
      }));
      return true;
    } catch {
      return false;
    }
  }, [dispatch]);

  useEffect(() => {
    if (!recurringAccess.ready || !recurringAccess.canView || bootstrapRequestedRef.current) return;
    bootstrapRequestedRef.current = true;
    void loadBootstrap().then((loaded) => {
      if (!loaded) bootstrapRequestedRef.current = false;
    });
  }, [loadBootstrap, recurringAccess.canView, recurringAccess.ready]);

  const defaultCashPlnAccount = useMemo(() => findCashPlnAccount(accounts.data), [accounts.data]);
  const canRun = recurringAccess.canUpdate && transactionAccess.ready && transactionAccess.canCreate;
  const canViewTransactions = transactionAccess.ready && transactionAccess.canView;
  const canManageOccurrences = recurringAccess.canUpdate
    && transactionAccess.ready
    && transactionAccess.canUpdate;

  const accountOptions = useMemo(
    () => accounts.data
      .filter((account) => account.isActive)
      .map((account) => ({ value: String(account.id), label: `${account.name} (${account.currency})` })),
    [accounts.data],
  );
  const counterpartyOptions = useMemo(
    () => (draft.kind === "expense" ? vendors.data : clients.data)
      .filter((counterparty) => counterparty.isActive)
      .map((counterparty) => ({ value: String(counterparty.id), label: counterparty.name })),
    [clients.data, draft.kind, vendors.data],
  );
  const vendorDefaultCategoryOptions = useMemo(
    () => getInlineParentCategoryOptions(categories.data, "expense").map(({ value, label }) => ({ value, label })),
    [categories.data],
  );

  const visibleRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    return recurring.data
      .filter((rule) => {
        const lifecycle = getRecurringRuleLifecycle(rule);
        if (statusFilter && lifecycle.label.toLowerCase().replace(" ", "_") !== statusFilter) return false;
        if (frequencyFilter && rule.frequency !== frequencyFilter) return false;
        if (!query) return true;
        const template = templateOf(rule);
        const accountName = accounts.data.find((account) => account.id === Number(template.accountId))?.name;
        const categoryName = categories.data.find((category) => category.id === Number(template.categoryId))?.name;
        const counterpartyName = (rule.kind === "expense" ? vendors.data : clients.data)
          .find((counterparty) => counterparty.id === Number(template.counterpartyId))?.name;
        return [
          ruleTitle(rule),
          rule.kind,
          rule.frequency,
          lifecycle.label,
          accountName,
          categoryName,
          counterpartyName,
          rule.lastError,
        ].some((value) => String(value ?? "").toLowerCase().includes(query));
      })
      .sort((left, right) => {
        const leftLifecycle = getRecurringRuleLifecycle(left).label;
        const rightLifecycle = getRecurringRuleLifecycle(right).label;
        const priority: Record<string, number> = { "Needs attention": 0, Due: 1, Active: 2, Paused: 3, Ended: 4 };
        const stateDifference = priority[leftLifecycle] - priority[rightLifecycle];
        if (stateDifference !== 0) return stateDifference;
        return dayjs(left.nextRunDate ?? "9999-12-31").valueOf() - dayjs(right.nextRunDate ?? "9999-12-31").valueOf();
      });
  }, [accounts.data, categories.data, clients.data, frequencyFilter, recurring.data, search, statusFilter, vendors.data]);

  const lifecycleCounts = useMemo(() => countRecurringLifecycle(recurring.data), [recurring.data]);
  const activeCount = useMemo(
    () => recurring.data.filter((rule) => rule.status === "active" && !(rule.endDate && dayjs(rule.endDate).isBefore(dayjs(), "day"))).length,
    [recurring.data],
  );
  const overdueCount = useMemo(
    () => recurring.data.filter((rule) => (
      rule.status === "active"
      && Boolean(rule.nextRunDate)
      && !dayjs(rule.nextRunDate).isAfter(dayjs())
      && !(rule.endDate && dayjs(rule.endDate).isBefore(dayjs(), "day"))
    )).length,
    [recurring.data],
  );
  const monthlyProjection = useMemo(() => projectRecurringRulesMonthly(recurring.data), [recurring.data]);
  const selectedRule = canViewTransactions
    ? recurring.data.find((rule) => rule.id === selectedRuleId) ?? null
    : null;

  const openCreateModal = () => {
    if (!recurringAccess.canCreate) return;
    const nextDraft = createRecurringRuleDraft();
    if (defaultCashPlnAccount) {
      nextDraft.accountId = defaultCashPlnAccount.id;
      nextDraft.currency = defaultCashPlnAccount.currency.toUpperCase();
    }
    setEditingRule(null);
    setDraft(nextDraft);
    setSaveError(null);
    setModalOpen(true);
  };

  const openEditModal = (rule: FinanceRecurringRule) => {
    if (!recurringAccess.canUpdate) return;
    setEditingRule(rule);
    setDraft(createRecurringRuleDraft(rule));
    setSaveError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving || inlineCreateOpen) return;
    setModalOpen(false);
    setEditingRule(null);
    setSaveError(null);
  };

  const validateReferences = (): string | null => {
    const selectedAccount = accounts.data.find((account) => account.id === draft.accountId);
    if (!selectedAccount?.isActive) return "Select an active account.";
    if (selectedAccount.currency.trim().toUpperCase() !== draft.currency.trim().toUpperCase()) {
      return `Currency must match the selected account (${selectedAccount.currency.toUpperCase()}).`;
    }
    const selectedCategory = categories.data.find((category) => category.id === draft.categoryId);
    if (!selectedCategory?.isActive || selectedCategory.kind !== draft.kind) {
      return `Select an active ${draft.kind} category.`;
    }
    const selectedCounterparty = (draft.kind === "expense" ? vendors.data : clients.data)
      .find((counterparty) => counterparty.id === draft.counterpartyId);
    if (!selectedCounterparty?.isActive) {
      return `Select an active ${draft.kind === "expense" ? "vendor" : "client"}.`;
    }
    return null;
  };

  const handleSave = async () => {
    if (editingRule ? !recurringAccess.canUpdate : !recurringAccess.canCreate) {
      setSaveError("You do not have permission to save recurring rules.");
      return;
    }
    const validationError = validateRecurringRuleDraft(draft) ?? validateReferences();
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    const payload = buildRecurringRulePayload(draft, editingRule ? templateOf(editingRule) : {});
    const scheduleChanged = Boolean(editingRule) && (
      editingRule!.frequency !== draft.frequency
      || editingRule!.interval !== draft.interval
      || editingRule!.byMonthDay !== payload.byMonthDay
      || editingRule!.startDate !== draft.startDate
      || editingRule!.endDate !== draft.endDate
      || editingRule!.timezone !== draft.timezone.trim()
    );
    const shouldReactivateCompleted = editingRule?.status === "completed"
      && scheduleChanged
      && (!draft.endDate || !dayjs(draft.endDate).isBefore(dayjs(), "day"));
    const changes = shouldReactivateCompleted ? { ...payload, status: "active" as const } : payload;
    try {
      setSaving(true);
      setSaveError(null);
      if (editingRule) {
        await dispatch(updateFinanceRecurringRule({ id: editingRule.id, changes })).unwrap();
      } else {
        await dispatch(createFinanceRecurringRule(payload)).unwrap();
      }
      closeModal();
    } catch (error) {
      setSaveError(getFinanceErrorMessage(error, `Unable to ${editingRule ? "update" : "create"} this recurring rule.`));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (rule: FinanceRecurringRule) => {
    if (!recurringAccess.canUpdate || !canToggleRecurringRuleStatus(rule.status)) return;
    try {
      setMutatingRuleId(rule.id);
      setOperationError(null);
      await dispatch(updateFinanceRecurringRule({
        id: rule.id,
        changes: { status: rule.status === "active" ? "paused" : "active" },
      })).unwrap();
    } catch (error) {
      setOperationError(getFinanceErrorMessage(error, `Unable to ${rule.status === "active" ? "pause" : "resume"} this rule.`));
    } finally {
      setMutatingRuleId(null);
    }
  };

  const handleExecute = async () => {
    if (!canRun) return;
    try {
      setOperationError(null);
      await dispatch(executeFinanceRecurringRules()).unwrap();
      await dispatch(fetchFinanceRecurringRules()).unwrap();
      setOccurrenceReloadToken((value) => value + 1);
    } catch (error) {
      setOperationError(getFinanceErrorMessage(error, "Unable to run due recurring rules."));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !recurringAccess.canDelete) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      await dispatch(deleteFinanceRecurringRule(deleteTarget.id)).unwrap();
      if (selectedRuleId === deleteTarget.id) setSelectedRuleId(null);
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(getFinanceErrorMessage(error, "Unable to delete this recurring rule."));
    } finally {
      setDeleting(false);
    }
  };

  const renderAmount = (rule: FinanceRecurringRule) => {
    const template = templateOf(rule);
    return formatFinanceMoneyMinor(Number(template.amountMinor) || 0, String(template.currency ?? "PLN"));
  };

  const renderStatus = (rule: FinanceRecurringRule) => {
    const lifecycle = getRecurringRuleLifecycle(rule);
    return <Badge color={lifecycle.color} variant="light">{lifecycle.label}</Badge>;
  };

  const renderActions = (rule: FinanceRecurringRule) => {
    const hasMenu = recurringAccess.canUpdate || recurringAccess.canDelete;
    return (
      <Group gap="xs" justify="flex-end" wrap="nowrap">
        {canViewTransactions && (
          <Tooltip label={selectedRuleId === rule.id ? "Hide occurrence history" : "Review generated transactions"}>
            <ActionIcon
              variant={selectedRuleId === rule.id ? "filled" : "light"}
              onClick={() => setSelectedRuleId((current) => current === rule.id ? null : rule.id)}
              aria-label={`Review occurrences for ${ruleTitle(rule)}`}
            >
              <IconHistory size={17} />
            </ActionIcon>
          </Tooltip>
        )}
        {hasMenu && (
          <Menu position="bottom-end" withinPortal shadow="md">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`Actions for ${ruleTitle(rule)}`} loading={mutatingRuleId === rule.id}>
                <IconDotsVertical size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {recurringAccess.canUpdate && (
                <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => openEditModal(rule)}>
                  Edit rule
                </Menu.Item>
              )}
              {recurringAccess.canUpdate && canToggleRecurringRuleStatus(rule.status) && (
                <Menu.Item
                  leftSection={rule.status === "active" ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
                  onClick={() => void handleToggleStatus(rule)}
                >
                  {rule.status === "active" ? "Pause" : "Resume"}
                </Menu.Item>
              )}
              {recurringAccess.canDelete && <Menu.Divider />}
              {recurringAccess.canDelete && (
                <Menu.Item
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={() => {
                    setDeleteError(null);
                    setDeleteTarget(rule);
                  }}
                >
                  Delete
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    );
  };

  if (!recurringAccess.ready) {
    return <FinanceLoadingState label="Loading recurring-rule access" />;
  }
  if (!recurringAccess.canView) {
    return <Alert color="yellow">You do not have permission to view recurring finance rules.</Alert>;
  }

  const schedulePreview = describeRecurringSchedule({
    frequency: draft.frequency,
    interval: draft.interval,
    byMonthDay: draft.byMonthDay,
    startDate: draft.startDate,
  });
  const editScheduleChanged = Boolean(editingRule) && (
    editingRule!.frequency !== draft.frequency
    || editingRule!.interval !== draft.interval
    || editingRule!.byMonthDay !== (usesMonthDay(draft.frequency) ? draft.byMonthDay : null)
    || editingRule!.startDate !== draft.startDate
    || editingRule!.endDate !== draft.endDate
    || editingRule!.timezone !== draft.timezone.trim()
  );
  const willReactivateCompleted = editingRule?.status === "completed"
    && editScheduleChanged
    && (!draft.endDate || !dayjs(draft.endDate).isBefore(dayjs(), "day"));
  const projectedCurrencies = Object.entries(monthlyProjection).sort(([left], [right]) => left.localeCompare(right));
  const executionPresentation = execution.result
    ? getRecurringExecutionPresentation(execution.result)
    : null;

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        title="Recurring rules"
        description="Plan repeating transactions and review each occurrence before it moves cash."
        icon={<IconRepeat size={24} />}
        actions={
          <Group gap="sm" wrap="wrap">
            {canRun && (
              <Button
                variant="light"
                leftSection={<IconPlayerPlay size={16} />}
                loading={execution.loading}
                onClick={() => void handleExecute()}
              >
                Run due rules
              </Button>
            )}
            {recurringAccess.canCreate && (
              <FinancePrimaryAction leftSection={<IconPlus size={18} />} onClick={openCreateModal}>
                New rule
              </FinancePrimaryAction>
            )}
          </Group>
        }
      />

      {(operationError || execution.error) && (
        <FinanceErrorState title="Recurring action failed" message={operationError ?? execution.error ?? "Unknown error"} />
      )}
      {execution.result && !execution.error && !operationError && (
        <Alert
          color={executionPresentation?.color ?? "teal"}
          variant="light"
          radius="md"
          title={executionPresentation?.title ?? "Recurring run complete"}
        >
          <Stack gap={4}>
            <Text size="sm">
              {execution.result.processed} processed | {execution.result.createdTransactions} forecast{execution.result.createdTransactions === 1 ? "" : "s"} created | {execution.result.skipped} skipped | {execution.result.completed} completed | {execution.result.deferred} deferred | {execution.result.failed} failed
            </Text>
            {execution.result.failures.slice(0, 3).map((failure) => (
              <Text size="xs" key={`${failure.ruleId}-${failure.message}`}>
                Rule #{failure.ruleId}: {failure.message}
              </Text>
            ))}
            {execution.result.failures.length > 3 && (
              <Text size="xs">Plus {execution.result.failures.length - 3} more failures.</Text>
            )}
          </Stack>
        </Alert>
      )}

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <FinanceMetricCard
          label="Active rules"
          value={activeCount}
          description="Currently generating forecasts"
          icon={<IconRepeat size={20} />}
          accent="green"
        />
        <FinanceMetricCard
          label="Paused"
          value={lifecycleCounts.paused}
          description="No new occurrences"
          icon={<IconPlayerPause size={20} />}
          accent="slate"
        />
        <FinanceMetricCard
          label="Overdue"
          value={overdueCount}
          description={lifecycleCounts.needsAttention > 0 ? `${lifecycleCounts.needsAttention} rule${lifecycleCounts.needsAttention === 1 ? "" : "s"} need attention` : "Ready for the next run"}
          icon={<IconClockExclamation size={20} />}
          accent={lifecycleCounts.needsAttention > 0 ? "rose" : "orange"}
        />
        <FinanceMetricCard
          label="Monthly forecast"
          value={projectedCurrencies.length === 0
            ? "—"
            : (
              <span className={classes.forecastInline}>
                {projectedCurrencies.slice(0, 2).map(([currency, projection]) => (
                  <span key={currency}>
                    {formatFinanceMoneyMinor(projection.expenseMinor, currency)} out / {formatFinanceMoneyMinor(projection.incomeMinor, currency)} in
                  </span>
                ))}
              </span>
            )}
          description={projectedCurrencies.length > 2 ? `Plus ${projectedCurrencies.length - 2} more currencies` : "Active-rule estimate"}
          icon={<IconChartPie size={20} />}
          accent="violet"
        />
      </SimpleGrid>

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search rule, account, category, or counterparty"
      >
        <Select
          placeholder="All statuses"
          aria-label="Filter recurring rules by status"
          data={[
            { value: "active", label: "Active" },
            { value: "due", label: "Due" },
            { value: "needs_attention", label: "Needs attention" },
            { value: "paused", label: "Paused" },
            { value: "ended", label: "Ended" },
          ]}
          value={statusFilter}
          onChange={setStatusFilter}
          clearable
          style={{ flex: "1 1 160px", maxWidth: isMobile ? undefined : 200 }}
        />
        <Select
          placeholder="All frequencies"
          aria-label="Filter recurring rules by frequency"
          data={FREQUENCY_OPTIONS}
          value={frequencyFilter}
          onChange={setFrequencyFilter}
          clearable
          style={{ flex: "1 1 170px", maxWidth: isMobile ? undefined : 210 }}
        />
      </FinanceToolbar>

      <FinancePanel
        title="Automation schedule"
        description={`${visibleRules.length} of ${recurring.data.length} rules`}
        noPadding
      >
        <Box className={classes.forecastNotice} m="sm">
          <Text size="xs" fw={650} c="dimmed">
            Rules create planned forecasts only. Review an occurrence and mark it paid or received to record cash movement.
          </Text>
        </Box>
        {recurring.error ? (
          <FinanceErrorState message={recurring.error} onRetry={() => void loadBootstrap()} />
        ) : recurring.loading && recurring.data.length === 0 ? (
          <FinanceLoadingState label="Loading recurring rules" />
        ) : visibleRules.length === 0 ? (
          <FinanceEmptyState
            icon={<IconRepeat size={25} />}
            title={recurring.data.length === 0 ? "No recurring rules yet" : "No matching rules"}
            description={recurring.data.length === 0 ? "Create the first repeating forecast." : "Clear a filter or broaden your search."}
            action={recurring.data.length === 0 && recurringAccess.canCreate ? <Button onClick={openCreateModal}>Create first rule</Button> : undefined}
          />
        ) : isMobile ? (
          <Stack gap={0} p="sm">
            {visibleRules.map((rule) => {
              const template = templateOf(rule);
              const account = accounts.data.find((item) => item.id === Number(template.accountId))?.name ?? "—";
              const category = categories.data.find((item) => item.id === Number(template.categoryId))?.name ?? "—";
              const counterparty = (rule.kind === "expense" ? vendors.data : clients.data)
                .find((item) => item.id === Number(template.counterpartyId))?.name ?? "—";
              return (
                <FinanceRecordCard
                  key={rule.id}
                  leading={
                    <ThemeIcon variant="light" color={rule.kind === "income" ? "teal" : "orange"} radius="md">
                      <IconRepeat size={17} />
                    </ThemeIcon>
                  }
                  title={ruleTitle(rule)}
                  subtitle={describeRecurringSchedule(rule)}
                  status={renderStatus(rule)}
                  fields={[
                    { label: "Amount", value: renderAmount(rule) },
                    { label: "Next", value: rule.nextRunDate ? formatFinanceDate(rule.nextRunDate) : "No next run" },
                    { label: "Account", value: account },
                    { label: "Category", value: category },
                    { label: rule.kind === "expense" ? "Vendor" : "Client", value: counterparty },
                  ]}
                  actions={
                    <Stack gap="xs" w="100%">
                      {rule.lastError && (
                        <Box className={classes.attentionBox}>
                          <Text size="xs" fw={800}>Last run failed</Text>
                          <Text size="xs" lineClamp={2}>{rule.lastError}</Text>
                          <Text size="xs" mt={3}>
                            {rule.consecutiveFailures ?? 1} consecutive failure{(rule.consecutiveFailures ?? 1) === 1 ? "" : "s"}
                            {rule.lastErrorAt ? ` · ${formatFinanceDate(rule.lastErrorAt, true)}` : ""}
                            {canRun ? " · Run due rules to retry" : ""}
                          </Text>
                        </Box>
                      )}
                      {renderActions(rule)}
                    </Stack>
                  }
                />
              );
            })}
          </Stack>
        ) : (
          <ScrollArea offsetScrollbars type="auto">
            <Table highlightOnHover verticalSpacing="sm" miw={940}>
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
                  const template = templateOf(rule);
                  const counterparty = (rule.kind === "expense" ? vendors.data : clients.data)
                    .find((item) => item.id === Number(template.counterpartyId))?.name ?? "No counterparty";
                  return (
                    <Table.Tr key={rule.id} className={selectedRuleId === rule.id ? classes.ruleSelected : undefined}>
                      <Table.Td className={classes.ruleCell}>
                        <Stack gap={2}>
                          {canViewTransactions ? (
                            <button
                              type="button"
                              className={classes.ruleTitleButton}
                              onClick={() => setSelectedRuleId((current) => current === rule.id ? null : rule.id)}
                            >
                              <Text component="span" lineClamp={1}>{ruleTitle(rule)}</Text>
                            </button>
                          ) : (
                            <Text fw={750} lineClamp={1}>{ruleTitle(rule)}</Text>
                          )}
                          <Text size="xs" c="dimmed">#{rule.id} · {humanizeFinanceValue(rule.kind)} · {counterparty}</Text>
                          {rule.lastError && (
                            <Stack gap={1}>
                              <Group gap={4} wrap="nowrap">
                                <IconAlertTriangle size={13} color="var(--mantine-color-red-7)" />
                                <Text size="xs" c="red" lineClamp={1}>{rule.lastError}</Text>
                              </Group>
                              <Text size="xs" c="red">
                                {rule.consecutiveFailures ?? 1} failed attempt{(rule.consecutiveFailures ?? 1) === 1 ? "" : "s"}
                                {rule.lastErrorAt ? ` · ${formatFinanceDate(rule.lastErrorAt, true)}` : ""}
                              </Text>
                            </Stack>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>{describeRecurringSchedule(rule)}</Table.Td>
                      <Table.Td ta="right" fw={750}>{renderAmount(rule)}</Table.Td>
                      <Table.Td>
                        <Stack gap={1}>
                          <Text size="sm">{rule.nextRunDate ? formatFinanceDate(rule.nextRunDate) : "No next run"}</Text>
                          {rule.lastRunAt && <Text size="xs" c="dimmed">Last {formatFinanceDate(rule.lastRunAt, true)}</Text>}
                        </Stack>
                      </Table.Td>
                      <Table.Td>{renderStatus(rule)}</Table.Td>
                      <Table.Td ta="right">{renderActions(rule)}</Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </FinancePanel>

      {selectedRule && (
        <FinanceRecurringOccurrences
          rule={selectedRule}
          canPostOccurrence={canManageOccurrences}
          canOpenTransaction={canViewTransactions}
          reloadToken={occurrenceReloadToken}
          onClose={() => setSelectedRuleId(null)}
        />
      )}

      <FinanceModal
        opened={modalOpen}
        onClose={closeModal}
        title={editingRule ? "Edit recurring rule" : "New recurring rule"}
        size="xl"
        scrollAreaComponent={ScrollArea.Autosize}
        closeOnClickOutside={!saving && !inlineCreateOpen}
        closeOnEscape={!saving && !inlineCreateOpen}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <Stack gap="md">
            <FinanceFormSection title="Transaction" icon={<IconWallet size={17} />}>
              <SegmentedControl
                className={classes.modalKind}
                fullWidth
                data={[
                  { value: "expense", label: "Expense" },
                  { value: "income", label: "Income" },
                ]}
                value={draft.kind}
                onChange={(value) => setDraft((state) => ({
                  ...state,
                  kind: value as RecurringRuleDraft["kind"],
                  categoryId: null,
                  counterpartyId: null,
                }))}
              />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
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
                <Group align="flex-end" gap="sm" grow wrap="nowrap">
                  <NumberInput
                    label="Amount"
                    decimalScale={2}
                    fixedDecimalScale
                    min={0.01}
                    value={draft.amountMinor / 100}
                    onValueChange={({ value }) => setDraft((state) => ({
                      ...state,
                      amountMinor: Math.round((Number(value) || 0) * 100),
                    }))}
                    withAsterisk
                  />
                  <TextInput label="Currency" value={draft.currency} readOnly w={95} />
                </Group>
                <InlineCategorySelect
                  categories={categories.data}
                  transactionKind={draft.kind}
                  value={draft.categoryId}
                  onChange={(value) => setDraft((state) => ({ ...state, categoryId: value }))}
                  onCreateModalOpenChange={setInlineCreateOpen}
                />
                {draft.kind === "expense" ? (
                  <InlineVendorSelect
                    options={counterpartyOptions}
                    value={draft.counterpartyId ? String(draft.counterpartyId) : null}
                    onChange={(value) => setDraft((state) => ({ ...state, counterpartyId: value ? Number(value) : null }))}
                    onCreateModalOpenChange={setInlineCreateOpen}
                    defaultCategoryId={draft.categoryId}
                    defaultCategoryOptions={vendorDefaultCategoryOptions}
                  />
                ) : (
                  <Select
                    label="Client"
                    data={counterpartyOptions}
                    value={draft.counterpartyId ? String(draft.counterpartyId) : null}
                    onChange={(value) => setDraft((state) => ({ ...state, counterpartyId: value ? Number(value) : null }))}
                    searchable
                    withAsterisk
                  />
                )}
              </SimpleGrid>
              <TextInput
                label="Description"
                placeholder={draft.kind === "expense" ? "e.g. Office rent" : "e.g. Monthly partner payment"}
                value={draft.description}
                onChange={(event) => setDraft((state) => ({ ...state, description: event.currentTarget.value }))}
              />
            </FinanceFormSection>

            <FinanceFormSection title="Schedule" icon={<IconCalendar size={17} />}>
              <SimpleGrid cols={{ base: 1, sm: usesMonthDay(draft.frequency) ? 3 : 2 }} spacing="sm">
                <Select
                  label="Frequency"
                  data={FREQUENCY_OPTIONS}
                  value={draft.frequency}
                  onChange={(value) => setDraft((state) => changeDraftFrequency(
                    state,
                    (value ?? "monthly") as FinanceRecurringFrequency,
                  ))}
                />
                <NumberInput
                  label="Repeat every"
                  rightSection={<Text size="xs" c="dimmed" pr={6}>{recurringFrequencyUnit(draft.frequency, draft.interval)}</Text>}
                  rightSectionWidth={draft.frequency === "quarterly" ? 70 : 58}
                  value={draft.interval}
                  min={1}
                  allowDecimal={false}
                  onChange={(value) => setDraft((state) => ({ ...state, interval: Number(value) || 1 }))}
                />
                {usesMonthDay(draft.frequency) && (
                  <NumberInput
                    label="Month day"
                    value={draft.byMonthDay ?? undefined}
                    onChange={(value) => setDraft((state) => ({ ...state, byMonthDay: value ? Number(value) : null }))}
                    min={1}
                    max={31}
                    allowDecimal={false}
                    withAsterisk
                  />
                )}
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                <DateInput
                  label="Start"
                  value={dayjs(draft.startDate).toDate()}
                  onChange={(value) => value && setDraft((state) => changeDraftStartDate(state, dayjs(value).format("YYYY-MM-DD")))}
                  valueFormat="DD MMM YYYY"
                  withAsterisk
                />
                <DateInput
                  label="End"
                  value={draft.endDate ? dayjs(draft.endDate).toDate() : null}
                  onChange={(value) => setDraft((state) => ({ ...state, endDate: value ? dayjs(value).format("YYYY-MM-DD") : null }))}
                  valueFormat="DD MMM YYYY"
                  minDate={dayjs(draft.startDate).toDate()}
                  clearable
                />
                <TextInput
                  label="Timezone"
                  value={draft.timezone}
                  onChange={(event) => setDraft((state) => ({ ...state, timezone: event.currentTarget.value }))}
                  withAsterisk
                />
              </SimpleGrid>
              <Box className={classes.scheduleHint}>
                <IconRepeat size={15} />
                <Text size="xs">
                  Starts {formatFinanceDate(draft.startDate)} · {schedulePreview}
                  {draft.endDate ? ` · ends ${formatFinanceDate(draft.endDate)}` : " · no end date"}.
                  {draft.frequency === "weekly" ? " The start date sets the weekday." : ""}
                  {usesMonthDay(draft.frequency) && (draft.byMonthDay ?? 0) > 28 ? " Shorter months use their last day." : ""}
                </Text>
              </Box>
            </FinanceFormSection>

            <Alert color="blue" variant="light">
              Each due date creates a planned forecast. It does not move cash until reviewed and posted.
            </Alert>
            {willReactivateCompleted && (
              <Alert color="teal" variant="light">
                This updated schedule has future dates, so saving will reactivate the completed rule.
              </Alert>
            )}
            {saveError && <Alert color="red">{saveError}</Alert>}

            <FinanceModalFooter>
              <Button type="button" variant="default" onClick={closeModal} disabled={saving}>Cancel</Button>
              <FinancePrimaryAction type="submit" loading={saving}>
                {editingRule ? "Save changes" : "Create rule"}
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
        description="Future forecasts will stop. Existing transactions and history will remain."
        confirmLabel="Delete rule"
        loading={deleting}
      >
        {deleteTarget && (
          <Stack gap="sm">
            <Text size="sm" fw={750}>{ruleTitle(deleteTarget)}</Text>
            {deleteError && <Alert color="red">{deleteError}</Alert>}
          </Stack>
        )}
      </FinanceConfirmModal>
    </Stack>
  );
};

export default FinanceRecurring;
