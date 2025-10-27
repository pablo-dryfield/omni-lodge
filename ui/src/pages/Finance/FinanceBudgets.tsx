import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  TextInput,
  Title,
} from "@mantine/core";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
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

type DraftBudget = {
  period: string;
  categoryId: number | null;
  amountMinor: number;
  currency: string;
};

const defaultDraft: DraftBudget = {
  period: "",
  categoryId: null,
  amountMinor: 0,
  currency: "PLN",
};

const FinanceBudgets = () => {
  const dispatch = useAppDispatch();
  const budgets = useAppSelector(selectFinanceBudgets);
  const categories = useAppSelector(selectFinanceCategories);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<FinanceBudget | null>(null);
  const [draft, setDraft] = useState<DraftBudget>(defaultDraft);

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
      setDraft(defaultDraft);
    }
  }, [editingBudget]);

  const categoryOptions = useMemo(
    () =>
      categories.data.map((category) => ({
        value: String(category.id),
        label: `${category.kind === "income" ? "Income" : "Expense"} �- ${category.name}`,
      })),
    [categories.data],
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

  const handleSubmit = async () => {
    if (!draft.period || !draft.categoryId) {
      return;
    }

    if (editingBudget) {
      await dispatch(
        updateFinanceBudget({
          id: editingBudget.id,
          changes: {
            ...editingBudget,
            ...draft,
          },
        }),
      );
    } else {
      await dispatch(createFinanceBudget(draft));
    }

    setModalOpen(false);
    setEditingBudget(null);
  };

  const handleDelete = async (id: number) => {
    await dispatch(deleteFinanceBudget(id));
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Budgets</Title>
        <Button leftSection={<IconPlus size={18} />} onClick={() => setModalOpen(true)}>
          New Budget
        </Button>
      </Group>

      <Table striped highlightOnHover withColumnBorders>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Period</Table.Th>
            <Table.Th>Category</Table.Th>
            <Table.Th ta="right">Amount</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sortedBudgets.map((budget) => (
            <Table.Tr key={budget.id}>
              <Table.Td>{budget.period}</Table.Td>
              <Table.Td>{categories.data.find((category) => category.id === budget.categoryId)?.name ?? "—"}</Table.Td>
              <Table.Td ta="right">
                {(budget.amountMinor / 100).toFixed(2)} {budget.currency}
              </Table.Td>
              <Table.Td width={120}>
                <Group gap={4} justify="flex-end">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      setEditingBudget(budget);
                      setModalOpen(true);
                    }}
                  >
                    <IconEdit size={18} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" onClick={() => handleDelete(budget.id)}>
                    <IconTrash size={18} />
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal
        opened={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingBudget(null);
        }}
        title={editingBudget ? "Edit Budget" : "New Budget"}
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Period (YYYY-MM)"
            placeholder="2025-01"
            value={draft.period}
            onChange={(event) => setDraft((state) => ({ ...state, period: event.currentTarget.value }))}
            withAsterisk
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
          </Group>
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingBudget ? "Save changes" : "Create budget"}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceBudgets;

