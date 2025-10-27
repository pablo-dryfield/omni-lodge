import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  TextInput,
  Title,
} from "@mantine/core";
import { IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceCategory,
  deleteFinanceCategory,
  fetchFinanceCategories,
  updateFinanceCategory,
} from "../../actions/financeActions";
import { selectFinanceCategories } from "../../selectors/financeSelectors";
import { FinanceCategory } from "../../types/finance";

type DraftCategory = {
  name: string;
  kind: FinanceCategory["kind"];
  parentId: number | null;
  isActive: boolean;
};

const defaultDraft: DraftCategory = {
  name: "",
  kind: "expense",
  parentId: null,
  isActive: true,
};

const FinanceCategories = () => {
  const dispatch = useAppDispatch();
  const categories = useAppSelector(selectFinanceCategories);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<FinanceCategory | null>(null);
  const [draft, setDraft] = useState<DraftCategory>(defaultDraft);

  useEffect(() => {
    dispatch(fetchFinanceCategories());
  }, [dispatch]);

  useEffect(() => {
    if (editingCategory) {
      setDraft({
        name: editingCategory.name,
        kind: editingCategory.kind,
        parentId: editingCategory.parentId,
        isActive: editingCategory.isActive,
      });
    } else {
      setDraft(defaultDraft);
    }
  }, [editingCategory]);

  const parentOptions = useMemo(
    () =>
      categories.data.map((category) => ({
        value: String(category.id),
        label: `${category.kind === "income" ? "Income" : "Expense"} Â- ${category.name}`,
      })),
    [categories.data],
  );

  const displayCategories = useMemo(() => {
    const map = new Map<number, FinanceCategory>();
    categories.data.forEach((category) => map.set(category.id, category));
    return categories.data
      .map((category) => {
        const parent = category.parentId ? map.get(category.parentId) : undefined;
        return { category, parentName: parent?.name ?? "â€”" };
      })
      .sort((a, b) => a.category.name.localeCompare(b.category.name));
  }, [categories.data]);

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      return;
    }

    if (editingCategory) {
      await dispatch(
        updateFinanceCategory({
          id: editingCategory.id,
          changes: {
            ...editingCategory,
            ...draft,
          },
        }),
      );
    } else {
      await dispatch(createFinanceCategory(draft));
    }

    setModalOpen(false);
    setEditingCategory(null);
    setDraft(defaultDraft);
  };

  const handleDelete = async (id: number) => {
    await dispatch(deleteFinanceCategory(id));
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={3}>Categories</Title>
        <Button
          leftSection={<IconPlus size={18} />}
          onClick={() => {
            setEditingCategory(null);
            setModalOpen(true);
          }}
        >
          New Category
        </Button>
      </Group>

      <Table striped withColumnBorders highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Kind</Table.Th>
            <Table.Th>Parent</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {displayCategories.map(({ category, parentName }) => (
            <Table.Tr key={category.id}>
              <Table.Td>{category.name}</Table.Td>
              <Table.Td>{category.kind === "income" ? "Income" : "Expense"}</Table.Td>
              <Table.Td>{parentName}</Table.Td>
              <Table.Td>{category.isActive ? "Active" : "Inactive"}</Table.Td>
              <Table.Td width={120}>
                <Group gap={4} justify="flex-end">
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      setEditingCategory(category);
                      setModalOpen(true);
                    }}
                  >
                    <IconEdit size={18} />
                  </ActionIcon>
                  <ActionIcon color="red" variant="subtle" onClick={() => handleDelete(category.id)}>
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
          setEditingCategory(null);
        }}
        title={editingCategory ? "Edit Category" : "New Category"}
        size="lg"
      >
        <Stack gap="md">
          <TextInput
            label="Name"
            withAsterisk
            value={draft.name}
            onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
          />
          <Group grow>
            <Select
              label="Kind"
              data={[
                { value: "income", label: "Income" },
                { value: "expense", label: "Expense" },
              ]}
              value={draft.kind}
              onChange={(value) => setDraft((state) => ({ ...state, kind: (value ?? "expense") as DraftCategory["kind"] }))}
            />
            <Select
              label="Parent"
              placeholder="None"
              data={parentOptions}
              value={draft.parentId ? String(draft.parentId) : null}
              onChange={(value) =>
                setDraft((state) => ({
                  ...state,
                  parentId: value ? Number(value) : null,
                }))
              }
              clearable
              searchable
            />
          </Group>
          <Switch
            label="Category is active"
            checked={draft.isActive}
            onChange={(event) => setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))}
          />
          <Group justify="flex-end">
            <Button variant="light" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingCategory ? "Save changes" : "Create category"}</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
};

export default FinanceCategories;

