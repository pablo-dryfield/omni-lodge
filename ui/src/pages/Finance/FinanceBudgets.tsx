import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  NumberInput,
  ScrollArea,
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
import { MonthPickerInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import { IconCalendarDollar, IconChartBar, IconEdit, IconPlus, IconTags, IconTrash } from "@tabler/icons-react";
import dayjs from "dayjs";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceBudget,
  deleteFinanceBudget,
  fetchFinanceBudgets,
  fetchFinanceCategories,
  updateFinanceBudget,
} from "../../actions/financeActions";
import { selectFinanceBudgets, selectFinanceCategories } from "../../selectors/financeSelectors";
import { FinanceBudget } from "../../types/finance";
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
import { formatFinanceMoneyMinor, getFinanceErrorMessage } from "../../components/finance/financeFormatters";

type DraftBudget = {
  period: string;
  categoryId: number | null;
  amountMinor: number;
  currency: string;
};

const DEFAULT_DRAFT: DraftBudget = {
  period: "",
  categoryId: null,
  amountMinor: 0,
  currency: "PLN",
};

const formatBudgetPeriod = (period: string): string => {
  const parsed = dayjs(`${period}-01`);
  return parsed.isValid() ? parsed.format("MMMM YYYY") : period;
};

const FinanceBudgets = () => {
  const dispatch = useAppDispatch();
  const budgets = useAppSelector(selectFinanceBudgets);
  const categories = useAppSelector(selectFinanceCategories);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<FinanceBudget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FinanceBudget | null>(null);
  const [draft, setDraft] = useState<DraftBudget>(DEFAULT_DRAFT);
  const [search, setSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

  useEffect(() => {
    dispatch(fetchFinanceBudgets());
    dispatch(fetchFinanceCategories());
  }, [dispatch]);

  useEffect(() => {
    if (editingBudget) {
      setDraft({
        period: editingBudget.period,
        categoryId: editingBudget.categoryId,
        amountMinor: editingBudget.amountMinor,
        currency: editingBudget.currency,
      });
    } else {
      setDraft(DEFAULT_DRAFT);
    }
  }, [editingBudget]);

  const categoryById = useMemo(
    () => new Map(categories.data.map((category) => [category.id, category])),
    [categories.data],
  );

  const categoryOptions = useMemo(
    () =>
      categories.data
        .map((category) => ({
          value: String(category.id),
          label: `${category.kind === "income" ? "Income" : "Expense"} · ${category.name}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories.data],
  );

  const periodOptions = useMemo(
    () =>
      Array.from(new Set(budgets.data.map((budget) => budget.period)))
        .sort((a, b) => b.localeCompare(a))
        .map((period) => ({ value: period, label: formatBudgetPeriod(period) })),
    [budgets.data],
  );

  const sortedBudgets = useMemo(
    () =>
      [...budgets.data].sort((a, b) => {
        if (a.period === b.period) {
          return a.categoryId - b.categoryId;
        }
        return a.period.localeCompare(b.period);
      }),
    [budgets.data],
  );

  const filteredBudgets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sortedBudgets.filter((budget) => {
      const category = categoryById.get(budget.categoryId);
      const matchesSearch =
        !query ||
        budget.period.toLocaleLowerCase().includes(query) ||
        formatBudgetPeriod(budget.period).toLocaleLowerCase().includes(query) ||
        budget.currency.toLocaleLowerCase().includes(query) ||
        String(category?.name ?? "").toLocaleLowerCase().includes(query);
      const matchesPeriod = !periodFilter || budget.period === periodFilter;
      const matchesCategory = !categoryFilter || String(budget.categoryId) === categoryFilter;
      return matchesSearch && matchesPeriod && matchesCategory;
    });
  }, [categoryById, categoryFilter, periodFilter, search, sortedBudgets]);

  const hasFilters = Boolean(search.trim()) || Boolean(periodFilter) || Boolean(categoryFilter);

  const normalizeBudgetPayload = (payload: DraftBudget) => ({
    ...payload,
    categoryId: payload.categoryId ?? undefined,
    currency: payload.currency.trim().toUpperCase(),
  });

  const openNewBudget = () => {
    setEditingBudget(null);
    setDraft(DEFAULT_DRAFT);
    setActionError(null);
    setModalOpen(true);
  };

  const openEditBudget = (budget: FinanceBudget) => {
    setEditingBudget(budget);
    setActionError(null);
    setModalOpen(true);
  };

  const closeBudgetModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingBudget(null);
    setActionError(null);
  };

  const clearFilters = () => {
    setSearch("");
    setPeriodFilter(null);
    setCategoryFilter(null);
  };

  const handleSubmit = async () => {
    if (!draft.period || !draft.categoryId) {
      setActionError("Select a budget month and category.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      if (editingBudget) {
        await dispatch(
          updateFinanceBudget({
            id: editingBudget.id,
            changes: normalizeBudgetPayload(draft),
          }),
        ).unwrap();
      } else {
        await dispatch(createFinanceBudget(normalizeBudgetPayload(draft))).unwrap();
      }
      setModalOpen(false);
      setEditingBudget(null);
      setDraft(DEFAULT_DRAFT);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to save this budget."));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await dispatch(deleteFinanceBudget(deleteTarget.id)).unwrap();
      setDeleteTarget(null);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to delete this budget."));
    } finally {
      setDeleting(false);
    }
  };

  const beginDelete = (budget: FinanceBudget) => {
    setActionError(null);
    setDeleteTarget(budget);
  };

  const categoryBadge = (budget: FinanceBudget) => {
    const category = categoryById.get(budget.categoryId);
    return (
      <Badge color={category?.kind === "income" ? "teal" : "blue"} variant="light">
        {category?.kind === "income" ? "Income" : "Expense"}
      </Badge>
    );
  };

  const emptyState = (
    <FinanceEmptyState
      icon={<IconChartBar size={25} />}
      title={hasFilters ? "No budgets match these filters" : "Create your first monthly budget"}
      description={
        hasFilters
          ? "Try another month, category, currency, or search term."
          : "Set category targets by month so Finance reports can compare planned and actual activity."
      }
      action={
        hasFilters ? (
          <Button variant="light" onClick={clearFilters}>Clear filters</Button>
        ) : (
          <FinancePrimaryAction leftSection={<IconPlus size={16} />} onClick={openNewBudget}>
            New budget
          </FinancePrimaryAction>
        )
      }
    />
  );

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        eyebrow="Planning"
        title="Budgets"
        description="Set monthly targets by category so actual income and spending can be compared with plan."
        icon={<IconChartBar size={24} />}
        actions={
          <FinancePrimaryAction leftSection={<IconPlus size={17} />} onClick={openNewBudget}>
            New budget
          </FinancePrimaryAction>
        }
      />

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search budgets by month, category, or currency"
      >
        <Select
          aria-label="Filter budgets by month"
          placeholder="All months"
          value={periodFilter}
          onChange={setPeriodFilter}
          data={periodOptions}
          searchable
          clearable
          w={190}
        />
        <Select
          aria-label="Filter budgets by category"
          placeholder="All categories"
          value={categoryFilter}
          onChange={setCategoryFilter}
          data={categoryOptions}
          searchable
          clearable
          w={220}
        />
        <Text size="xs" c="dimmed" fw={700} ml="auto">
          {filteredBudgets.length} of {budgets.data.length} budgets
        </Text>
      </FinanceToolbar>

      {budgets.error ? (
        <FinanceErrorState
          title="Budgets could not be loaded"
          message={budgets.error}
          onRetry={() => {
            void dispatch(fetchFinanceBudgets());
          }}
        />
      ) : null}
      {categories.error ? (
        <FinanceErrorState
          title="Budget category options could not be loaded"
          message={categories.error}
          onRetry={() => {
            void dispatch(fetchFinanceCategories());
          }}
        />
      ) : null}

      {isMobile ? (
        budgets.loading ? (
          <FinanceLoadingState label="Loading budgets" />
        ) : filteredBudgets.length === 0 ? (
          emptyState
        ) : (
          <Stack gap="sm">
            {filteredBudgets.map((budget) => {
              const category = categoryById.get(budget.categoryId);
              return (
                <FinanceRecordCard
                  key={budget.id}
                  title={category?.name ?? "Unknown category"}
                  subtitle={formatBudgetPeriod(budget.period)}
                  leading={
                    <ThemeIcon color="blue" variant="light" radius="md" size={38}>
                      <IconCalendarDollar size={19} />
                    </ThemeIcon>
                  }
                  status={categoryBadge(budget)}
                  fields={[
                    { label: "Target", value: formatFinanceMoneyMinor(budget.amountMinor, budget.currency) },
                    { label: "Currency", value: budget.currency },
                  ]}
                  actions={
                    <>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconEdit size={15} />}
                        onClick={() => openEditBudget(budget)}
                        aria-label={`Edit budget for ${category?.name ?? "category"} in ${budget.period}`}
                        style={{ flex: "1 1 120px" }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        leftSection={<IconTrash size={15} />}
                        onClick={() => beginDelete(budget)}
                        aria-label={`Delete budget for ${category?.name ?? "category"} in ${budget.period}`}
                        style={{ flex: "1 1 120px" }}
                      >
                        Delete
                      </Button>
                    </>
                  }
                />
              );
            })}
          </Stack>
        )
      ) : (
        <FinancePanel
          title="Monthly budget plan"
          description="Each category target feeds the Budgets vs Actual Finance report."
          icon={<IconCalendarDollar size={18} />}
          noPadding
        >
          {budgets.loading ? (
            <FinanceLoadingState label="Loading budgets" />
          ) : filteredBudgets.length === 0 ? (
            emptyState
          ) : (
            <ScrollArea offsetScrollbars type="auto">
              <Table highlightOnHover verticalSpacing="md" miw={760}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Period</Table.Th>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th ta="right">Target</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredBudgets.map((budget) => {
                    const category = categoryById.get(budget.categoryId);
                    return (
                      <Table.Tr key={budget.id}>
                        <Table.Td>
                          <Text fw={750}>{formatBudgetPeriod(budget.period)}</Text>
                        </Table.Td>
                        <Table.Td>{category?.name ?? "Unknown category"}</Table.Td>
                        <Table.Td>{categoryBadge(budget)}</Table.Td>
                        <Table.Td ta="right" fw={750}>
                          {formatFinanceMoneyMinor(budget.amountMinor, budget.currency)}
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            <Tooltip label="Edit budget">
                              <ActionIcon
                                variant="subtle"
                                onClick={() => openEditBudget(budget)}
                                aria-label={`Edit budget for ${category?.name ?? "category"} in ${budget.period}`}
                              >
                                <IconEdit size={18} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Delete budget">
                              <ActionIcon
                                color="red"
                                variant="subtle"
                                onClick={() => beginDelete(budget)}
                                aria-label={`Delete budget for ${category?.name ?? "category"} in ${budget.period}`}
                              >
                                <IconTrash size={18} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </FinancePanel>
      )}

      <FinanceModal
        opened={modalOpen}
        onClose={closeBudgetModal}
        title={editingBudget ? "Edit budget" : "New budget"}
        size="lg"
        scrollAreaComponent={ScrollArea.Autosize}
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
      >
        <Box
          component="form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Stack gap="md">
            <FinanceFormSection
              title="Budget period"
              description="Choose the month and reporting category this target belongs to."
              icon={<IconCalendarDollar size={18} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <MonthPickerInput
                  label="Month"
                  placeholder="Select month"
                  value={draft.period ? dayjs(`${draft.period}-01`).toDate() : null}
                  onChange={(value) =>
                    setDraft((state) => ({
                      ...state,
                      period: value ? dayjs(value).format("YYYY-MM") : "",
                    }))
                  }
                  valueFormat="MMMM YYYY"
                  withAsterisk
                  clearable
                />
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
                  withAsterisk
                />
              </SimpleGrid>
            </FinanceFormSection>

            <FinanceFormSection
              title="Target amount"
              description="Enter the planned amount in the currency used for this budget."
              icon={<IconTags size={18} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <NumberInput
                  label="Amount"
                  decimalScale={2}
                  fixedDecimalScale
                  min={0}
                  value={draft.amountMinor / 100}
                  suffix={draft.currency ? ` ${draft.currency}` : undefined}
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
                  description="Three-letter ISO code"
                  value={draft.currency}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, currency: event.currentTarget.value.toUpperCase() }))
                  }
                  maxLength={3}
                  withAsterisk
                />
              </SimpleGrid>
            </FinanceFormSection>

            {actionError ? <Alert color="red">{actionError}</Alert> : null}

            <FinanceModalFooter>
              <Button variant="default" onClick={closeBudgetModal} disabled={saving} fullWidth={isMobile}>
                Cancel
              </Button>
              <FinancePrimaryAction
                type="submit"
                loading={saving}
                disabled={!draft.period || !draft.categoryId || draft.currency.trim().length !== 3}
                fullWidth={isMobile}
              >
                {editingBudget ? "Save changes" : "Create budget"}
              </FinancePrimaryAction>
            </FinanceModalFooter>
          </Stack>
        </Box>
      </FinanceModal>

      <FinanceConfirmModal
        opened={Boolean(deleteTarget)}
        onClose={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setActionError(null);
          }
        }}
        onConfirm={() => void handleConfirmDelete()}
        title="Delete budget?"
        description={`Delete the ${deleteTarget ? formatBudgetPeriod(deleteTarget.period) : ""} budget for ${deleteTarget ? categoryById.get(deleteTarget.categoryId)?.name ?? "this category" : "this category"}?`}
        confirmLabel="Delete budget"
        loading={deleting}
      >
        {actionError ? <Alert color="red">{actionError}</Alert> : null}
      </FinanceConfirmModal>
    </Stack>
  );
};

export default FinanceBudgets;
