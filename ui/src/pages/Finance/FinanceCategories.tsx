import { useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconEdit,
  IconPlus,
  IconSettings,
  IconSitemap,
  IconTags,
  IconTrash,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createFinanceCategory,
  deleteFinanceCategory,
  fetchFinanceCategories,
  updateFinanceCategory,
} from "../../actions/financeActions";
import { selectFinanceCategories } from "../../selectors/financeSelectors";
import type { FinanceCategory } from "../../types/finance";
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
import { getFinanceErrorMessage } from "../../components/finance/financeFormatters";

type DraftCategory = {
  name: string;
  kind: FinanceCategory["kind"];
  parentId: number | null;
  isActive: boolean;
};

type CategoryNode = FinanceCategory & { children: CategoryNode[] };
type FlatCategory = {
  category: CategoryNode;
  depth: number;
  parentName: string | null;
};
type KindFilter = "all" | FinanceCategory["kind"];
type StatusFilter = "all" | "active" | "inactive";

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
  const [deleteTarget, setDeleteTarget] = useState<FinanceCategory | null>(null);
  const [draft, setDraft] = useState<DraftCategory>(DEFAULT_DRAFT);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);

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

  const categoryNameById = useMemo(
    () => new Map(categories.data.map((category) => [category.id, category.name])),
    [categories.data],
  );

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

  const flatCategories = useMemo<FlatCategory[]>(() => {
    const rows: FlatCategory[] = [];
    const visit = (nodes: CategoryNode[], depth: number) => {
      nodes.forEach((category) => {
        rows.push({
          category,
          depth,
          parentName: category.parentId ? categoryNameById.get(category.parentId) ?? null : null,
        });
        visit(category.children, depth + 1);
      });
    };
    visit(categoryTree, 0);
    return rows;
  }, [categoryNameById, categoryTree]);

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return flatCategories.filter(({ category, parentName }) => {
      const matchesSearch =
        !query ||
        category.name.toLocaleLowerCase().includes(query) ||
        String(parentName ?? "").toLocaleLowerCase().includes(query);
      const matchesKind = kindFilter === "all" || category.kind === kindFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" ? category.isActive : !category.isActive);
      return matchesSearch && matchesKind && matchesStatus;
    });
  }, [flatCategories, kindFilter, search, statusFilter]);

  const parentOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    const traverse = (nodes: CategoryNode[], depth = 0) => {
      nodes.forEach((node) => {
        if (editingCategory?.id === node.id) {
          return;
        }
        if (node.kind === draft.kind) {
          options.push({
            value: String(node.id),
            label: `${"— ".repeat(depth)}${node.name}`,
          });
        }
        traverse(node.children, depth + 1);
      });
    };
    traverse(categoryTree);
    return options;
  }, [categoryTree, draft.kind, editingCategory?.id]);

  const hasFilters = Boolean(search.trim()) || kindFilter !== "all" || statusFilter !== "all";

  const openNewCategory = () => {
    setEditingCategory(null);
    setDraft(DEFAULT_DRAFT);
    setActionError(null);
    setModalOpen(true);
  };

  const openEditCategory = (category: FinanceCategory) => {
    setEditingCategory(category);
    setActionError(null);
    setModalOpen(true);
  };

  const closeCategoryModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingCategory(null);
    setActionError(null);
  };

  const clearFilters = () => {
    setSearch("");
    setKindFilter("all");
    setStatusFilter("all");
  };

  const handleSubmit = async () => {
    if (!draft.name.trim()) {
      setActionError("Category name is required.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const normalizedDraft = { ...draft, name: draft.name.trim() };
      if (editingCategory) {
        await dispatch(
          updateFinanceCategory({
            id: editingCategory.id,
            changes: { ...editingCategory, ...normalizedDraft },
          }),
        ).unwrap();
      } else {
        await dispatch(createFinanceCategory(normalizedDraft)).unwrap();
      }
      setModalOpen(false);
      setEditingCategory(null);
      setDraft(DEFAULT_DRAFT);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to save this category."));
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
      await dispatch(deleteFinanceCategory(deleteTarget.id)).unwrap();
      setDeleteTarget(null);
    } catch (error) {
      setActionError(getFinanceErrorMessage(error, "Unable to delete this category."));
    } finally {
      setDeleting(false);
    }
  };

  const kindBadge = (category: FinanceCategory) => (
    <Badge color={category.kind === "income" ? "teal" : "blue"} variant="light">
      {category.kind === "income" ? "Income" : "Expense"}
    </Badge>
  );

  const statusBadge = (category: FinanceCategory) => (
    <Badge color={category.isActive ? "teal" : "gray"} variant="light">
      {category.isActive ? "Active" : "Inactive"}
    </Badge>
  );

  const beginDelete = (category: FinanceCategory) => {
    setActionError(null);
    setDeleteTarget(category);
  };

  const emptyState = (
    <FinanceEmptyState
      icon={<IconSitemap size={25} />}
      title={hasFilters ? "No categories match these filters" : "Create your category structure"}
      description={
        hasFilters
          ? "Try a different category name, type, or status."
          : "Organize income and expenses into reusable categories for cleaner transactions, budgets, and reports."
      }
      action={
        hasFilters ? (
          <Button variant="light" onClick={clearFilters}>Clear filters</Button>
        ) : (
          <FinancePrimaryAction leftSection={<IconPlus size={16} />} onClick={openNewCategory}>
            New category
          </FinancePrimaryAction>
        )
      }
    />
  );

  return (
    <Stack className={financePageClass} gap="lg">
      <FinancePageHeader
        eyebrow="Finance structure"
        title="Categories"
        description="Organize income and expense reporting with a clear, reusable category hierarchy."
        icon={<IconSitemap size={24} />}
        actions={
          <FinancePrimaryAction leftSection={<IconPlus size={17} />} onClick={openNewCategory}>
            New category
          </FinancePrimaryAction>
        }
      />

      <FinanceToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search categories or parent groups"
      >
        <Select
          aria-label="Filter categories by type"
          value={kindFilter}
          onChange={(value) => setKindFilter((value ?? "all") as KindFilter)}
          data={[
            { value: "all", label: "Income & expense" },
            { value: "income", label: "Income" },
            { value: "expense", label: "Expense" },
          ]}
          w={180}
        />
        <Select
          aria-label="Filter categories by status"
          value={statusFilter}
          onChange={(value) => setStatusFilter((value ?? "all") as StatusFilter)}
          data={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ]}
          w={165}
        />
        <Text size="xs" c="dimmed" fw={700} ml="auto">
          {filteredCategories.length} of {categories.data.length} categories
        </Text>
      </FinanceToolbar>

      {categories.error ? (
        <FinanceErrorState
          title="Categories could not be loaded"
          message={categories.error}
          onRetry={() => {
            void dispatch(fetchFinanceCategories());
          }}
        />
      ) : null}

      {isMobile ? (
        categories.loading ? (
          <FinanceLoadingState label="Loading categories" />
        ) : filteredCategories.length === 0 ? (
          emptyState
        ) : (
          <Stack gap="sm">
            {filteredCategories.map(({ category, depth, parentName }) => (
              <FinanceRecordCard
                key={category.id}
                title={category.name}
                subtitle={parentName ? `Under ${parentName}` : "Root category"}
                leading={
                  <ThemeIcon color={category.kind === "income" ? "teal" : "blue"} variant="light" radius="md" size={38}>
                    <IconTags size={19} />
                  </ThemeIcon>
                }
                status={statusBadge(category)}
                fields={[
                  { label: "Type", value: kindBadge(category) },
                  { label: "Level", value: depth === 0 ? "Root" : `Level ${depth + 1}` },
                  {
                    label: "Subcategories",
                    value: category.children.length === 0 ? "None" : category.children.length,
                  },
                ]}
                actions={
                  <>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconEdit size={15} />}
                      onClick={() => openEditCategory(category)}
                      aria-label={`Edit category ${category.name}`}
                      style={{ flex: "1 1 120px" }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconTrash size={15} />}
                      onClick={() => beginDelete(category)}
                      aria-label={`Delete category ${category.name}`}
                      style={{ flex: "1 1 120px" }}
                    >
                      Delete
                    </Button>
                  </>
                }
              />
            ))}
          </Stack>
        )
      ) : (
        <FinancePanel
          title="Category hierarchy"
          description="Parent categories group related records while every category keeps its income or expense type."
          icon={<IconSitemap size={18} />}
          noPadding
        >
          {categories.loading ? (
            <FinanceLoadingState label="Loading categories" />
          ) : filteredCategories.length === 0 ? (
            emptyState
          ) : (
            <ScrollArea offsetScrollbars type="auto">
              <Table highlightOnHover verticalSpacing="md" miw={820}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Category</Table.Th>
                    <Table.Th>Type</Table.Th>
                    <Table.Th>Parent</Table.Th>
                    <Table.Th>Subcategories</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th ta="right">Actions</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredCategories.map(({ category, depth, parentName }) => (
                    <Table.Tr key={category.id}>
                      <Table.Td>
                        <Group gap="sm" wrap="nowrap" style={{ paddingLeft: Math.min(depth, 5) * 18 }}>
                          <ThemeIcon
                            color={category.kind === "income" ? "teal" : "blue"}
                            variant="light"
                            radius="md"
                            size={32}
                          >
                            <IconTags size={16} />
                          </ThemeIcon>
                          <Stack gap={1}>
                            <Text fw={750}>{category.name}</Text>
                            <Text size="xs" c="dimmed">{depth === 0 ? "Root category" : `Level ${depth + 1}`}</Text>
                          </Stack>
                        </Group>
                      </Table.Td>
                      <Table.Td>{kindBadge(category)}</Table.Td>
                      <Table.Td>{parentName ?? "—"}</Table.Td>
                      <Table.Td>{category.children.length || "—"}</Table.Td>
                      <Table.Td>{statusBadge(category)}</Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <Tooltip label={`Edit ${category.name}`}>
                            <ActionIcon
                              variant="subtle"
                              onClick={() => openEditCategory(category)}
                              aria-label={`Edit category ${category.name}`}
                            >
                              <IconEdit size={18} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={`Delete ${category.name}`}>
                            <ActionIcon
                              color="red"
                              variant="subtle"
                              onClick={() => beginDelete(category)}
                              aria-label={`Delete category ${category.name}`}
                            >
                              <IconTrash size={18} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </FinancePanel>
      )}

      <FinanceModal
        opened={modalOpen}
        onClose={closeCategoryModal}
        title={editingCategory ? "Edit category" : "New category"}
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
              title="Category details"
              description="Choose a clear reporting label and whether the category tracks income or expenses."
              icon={<IconTags size={18} />}
            >
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Name"
                  placeholder="For example: Venue supplies"
                  withAsterisk
                  autoFocus
                  value={draft.name}
                  onChange={(event) => setDraft((state) => ({ ...state, name: event.currentTarget.value }))}
                />
                <Select
                  label="Type"
                  data={[
                    { value: "income", label: "Income" },
                    { value: "expense", label: "Expense" },
                  ]}
                  value={draft.kind}
                  onChange={(value) =>
                    setDraft((state) => ({
                      ...state,
                      kind: (value ?? "expense") as DraftCategory["kind"],
                      parentId: null,
                    }))
                  }
                />
              </SimpleGrid>
            </FinanceFormSection>

            <FinanceFormSection
              title="Hierarchy"
              description="Leave the parent empty for a top-level category, or nest it under an existing group."
              icon={<IconSitemap size={18} />}
            >
              <Select
                label="Parent category"
                placeholder="No parent · root category"
                data={parentOptions}
                value={draft.parentId ? String(draft.parentId) : null}
                onChange={(value) =>
                  setDraft((state) => ({ ...state, parentId: value ? Number(value) : null }))
                }
                clearable
                searchable
              />
            </FinanceFormSection>

            <FinanceFormSection
              title="Availability"
              description="Inactive categories remain visible in history but can be filtered from daily setup."
              icon={<IconSettings size={18} />}
            >
              <Switch
                label="Category is active"
                checked={draft.isActive}
                onChange={(event) =>
                  setDraft((state) => ({ ...state, isActive: event.currentTarget.checked }))
                }
              />
            </FinanceFormSection>

            {actionError ? <Alert color="red">{actionError}</Alert> : null}

            <FinanceModalFooter>
              <Button variant="default" onClick={closeCategoryModal} disabled={saving} fullWidth={isMobile}>
                Cancel
              </Button>
              <FinancePrimaryAction
                type="submit"
                loading={saving}
                disabled={!draft.name.trim()}
                fullWidth={isMobile}
              >
                {editingCategory ? "Save changes" : "Create category"}
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
        title="Delete category?"
        description={`Delete ${deleteTarget?.name ?? "this category"}? Categories with children or linked Finance records may not be removable.`}
        confirmLabel="Delete category"
        loading={deleting}
      >
        {actionError ? <Alert color="red">{actionError}</Alert> : null}
      </FinanceConfirmModal>
    </Stack>
  );
};

export default FinanceCategories;
