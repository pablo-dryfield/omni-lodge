import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Text,
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
import type { FinanceCategory } from "../../types/finance";

type DraftCategory = {
  name: string;
  kind: FinanceCategory["kind"];
  parentId: number | null;
  isActive: boolean;
};

type CategoryNode = FinanceCategory & { children: CategoryNode[] };

const DEFAULT_DRAFT: DraftCategory = {
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
  const [draft, setDraft] = useState<DraftCategory>(DEFAULT_DRAFT);

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
      setDraft(DEFAULT_DRAFT);
    }
  }, [editingCategory]);

  const categoryTree = useMemo<CategoryNode[]>(() => {
    const nodes = new Map<number, CategoryNode>();
    categories.data.forEach((category) => {
      nodes.set(category.id, { ...category, children: [] });
    });

    const roots: CategoryNode[] = [];
    nodes.forEach((node) => {
      if (node.parentId && nodes.has(node.parentId)) {
        nodes.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    });

    const sortTree = (list: CategoryNode[]) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      list.forEach((child) => sortTree(child.children));
    };
    sortTree(roots);

    return roots;
  }, [categories.data]);

  const parentOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const traverse = (nodes: CategoryNode[], depth = 0) => {
      nodes.forEach((node) => {
        options.push({
          value: String(node.id),
          label: `${"• ".repeat(depth)}${node.name} (${node.kind === "income" ? "Income" : "Expense"})`,
        });
        if (node.children.length > 0) {
          traverse(node.children, depth + 1);
        }
      });
    };
    traverse(categoryTree);
    return options;
  }, [categoryTree]);

  const handleDelete = async (id: number) => {
    await dispatch(deleteFinanceCategory(id));
  };

  const renderTree = (nodes: CategoryNode[], depth = 0): JSX.Element[] =>
    nodes.flatMap((node) => {
      const card = (
        <Card key={node.id} withBorder padding="md" radius="md" style={{ marginLeft: depth * 20 }}>
          <Stack gap="xs">
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Group gap="xs">
                  <Text fw={600}>{node.name}</Text>
                  <Badge color={node.kind === "income" ? "green" : "blue"} variant="light">
                    {node.kind === "income" ? "Income" : "Expense"}
                  </Badge>
                  {!node.isActive && (
                    <Badge color="gray" variant="light">
                      Inactive
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">
                  {node.parentId ? `Child of category #${node.parentId}` : "Root category"}
                </Text>
              </Stack>
              <Group gap={4}>
                <ActionIcon
                  variant="subtle"
                  aria-label="Edit category"
                  onClick={() => {
                    setEditingCategory(node);
                    setModalOpen(true);
                  }}
                >
                  <IconEdit size={18} />
                </ActionIcon>
                <ActionIcon
                  color="red"
                  variant="subtle"
                  aria-label="Delete category"
                  onClick={() => handleDelete(node.id)}
                >
                  <IconTrash size={18} />
                </ActionIcon>
              </Group>
            </Group>
            {node.children.length > 0 && (
              <Text size="sm" c="dimmed">
                {node.children.length} subcategor{node.children.length === 1 ? "y" : "ies"}
              </Text>
            )}
          </Stack>
        </Card>
      );
      const children = node.children.length > 0 ? renderTree(node.children, depth + 1) : [];
      return [card, ...children];
    });

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      return;
    }

    if (editingCategory) {
      await dispatch(
        updateFinanceCategory({
          id: editingCategory.id,
          changes: { ...editingCategory, ...draft },
        }),
      );
    } else {
      await dispatch(createFinanceCategory(draft));
    }

    setModalOpen(false);
    setEditingCategory(null);
    setDraft(DEFAULT_DRAFT);
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

      {categoryTree.length === 0 ? (
        <Card withBorder padding="xl">
          <Text c="dimmed" ta="center">
            No categories found. Create your first category to start building the tree.
          </Text>
        </Card>
      ) : (
        <Stack gap="sm">{renderTree(categoryTree)}</Stack>
      )}

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
              onChange={(value) =>
                setDraft((state) => ({ ...state, kind: (value ?? "expense") as DraftCategory["kind"] }))
              }
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
