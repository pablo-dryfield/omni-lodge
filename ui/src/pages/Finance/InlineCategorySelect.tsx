import { useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
} from "@mantine/core";
import { IconPlus, IconTag } from "@tabler/icons-react";
import { createFinanceCategory } from "../../actions/financeActions";
import { FinanceModal, FinanceModalFooter, FinancePrimaryAction } from "../../components/finance/FinanceUi";
import { PAGE_SLUGS } from "../../constants/pageSlugs";
import { useModuleAccess } from "../../hooks/useModuleAccess";
import { useAppDispatch } from "../../store/hooks";
import type { FinanceCategory, FinanceTransaction } from "../../types/finance";
import {
  CREATE_NEW_CATEGORY_VALUE,
  CREATE_NEW_CATEGORY_LABEL,
  filterInlineCategoryOptions,
  getInlineCategoryNameSuggestion,
  getInlineCategoryOptions,
  getInlineParentCategoryOptions,
  getTransactionCategoryKind,
  type InlineParentCategoryOption,
  validateNewFinanceCategoryName,
} from "./inlineCategoryCreate";
import classes from "./InlineCategorySelect.module.css";

type InlineCategorySelectProps = {
  categories: FinanceCategory[];
  transactionKind: FinanceTransaction["kind"];
  value: number | null;
  onChange: (value: number | null) => void;
  onCreateModalOpenChange?: (opened: boolean) => void;
  disabled?: boolean;
};

const getCreateError = (error: unknown): string => {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return "Unable to create this category. Please try again.";
};

const InlineCategorySelect = ({
  categories,
  transactionKind,
  value,
  onChange,
  onCreateModalOpenChange,
  disabled = false,
}: InlineCategorySelectProps) => {
  const dispatch = useAppDispatch();
  const categoryAccess = useModuleAccess(PAGE_SLUGS.financeCategories);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categoryKind = getTransactionCategoryKind(transactionKind);
  const canCreate = categoryAccess.ready && categoryAccess.canCreate && Boolean(categoryKind);

  const options = useMemo(
    () => getInlineCategoryOptions(categories, transactionKind, canCreate),
    [canCreate, categories, transactionKind],
  );

  const parentOptions = useMemo(
    () => categoryKind ? getInlineParentCategoryOptions(categories, categoryKind) : [],
    [categories, categoryKind],
  );

  const selectedLabel = useMemo(
    () => categories.find((category) => category.id === value)?.name ?? null,
    [categories, value],
  );

  const closeCreateModal = () => {
    if (saving) {
      return;
    }
    setCreateOpen(false);
    onCreateModalOpenChange?.(false);
    setName("");
    setParentId(null);
    setError(null);
  };

  const openCreateModal = () => {
    if (!canCreate) {
      return;
    }
    setName(getInlineCategoryNameSuggestion(categorySearch, selectedLabel));
    setParentId(null);
    setError(null);
    setCreateOpen(true);
    onCreateModalOpenChange?.(true);
  };

  const handleSelectChange = (nextValue: string | null) => {
    if (nextValue === CREATE_NEW_CATEGORY_VALUE) {
      openCreateModal();
      return;
    }
    onChange(nextValue ? Number(nextValue) : null);
  };

  const handleCreate = async () => {
    if (!categoryKind) {
      setError("Choose a transaction type before creating a category.");
      return;
    }
    const validationError = validateNewFinanceCategoryName(name, categories, categoryKind);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await dispatch(createFinanceCategory({
        name: name.trim(),
        kind: categoryKind,
        parentId,
        isActive: true,
      })).unwrap();
      onChange(created.id);
      setCreateOpen(false);
      onCreateModalOpenChange?.(false);
      setName("");
      setParentId(null);
      setCategorySearch(created.name);
    } catch (createError) {
      setError(getCreateError(createError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Select
        label="Category"
        data={options}
        value={value ? String(value) : null}
        onChange={handleSelectChange}
        searchable
        onSearchChange={setCategorySearch}
        filter={canCreate ? filterInlineCategoryOptions : undefined}
        renderOption={({ option }) =>
          option.value === CREATE_NEW_CATEGORY_VALUE ? (
            <Group gap="xs" wrap="nowrap" py={2} c="blue.7">
              <ThemeIcon size={24} radius="xl" variant="light" color="blue">
                <IconPlus size={15} stroke={2.4} />
              </ThemeIcon>
              <Text size="sm" fw={750}>{CREATE_NEW_CATEGORY_LABEL}</Text>
            </Group>
          ) : (
            option.label
          )
        }
        clearable
        disabled={disabled}
        nothingFoundMessage="No categories found"
      />

      <FinanceModal
        opened={createOpen}
        onClose={closeCreateModal}
        title="Create category"
        size="sm"
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
        zIndex={400}
        styles={{ title: { width: "100%", textAlign: "center" } }}
      >
        <form
          className={classes.form}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleCreate();
          }}
        >
          <Stack gap="md">
            {categoryKind && (
              <Badge
                className={classes.kindBadge}
                color={categoryKind === "expense" ? "orange" : "teal"}
                variant="light"
                leftSection={<IconTag size={13} />}
              >
                {categoryKind} category
              </Badge>
            )}
            <TextInput
              label="Category name"
              placeholder="For example: Venue supplies"
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setError(null);
              }}
              autoFocus
              withAsterisk
              maxLength={160}
              disabled={saving}
            />
            <Select
              label="Parent category"
              placeholder="No parent (create at root)"
              data={parentOptions}
              value={parentId ? String(parentId) : null}
              onChange={(nextValue) => {
                setParentId(nextValue ? Number(nextValue) : null);
                setError(null);
              }}
              searchable
              clearable
              disabled={saving}
              nothingFoundMessage="No matching parent category"
              comboboxProps={{ zIndex: 500 }}
              renderOption={({ option }) => {
                const parentOption = option as InlineParentCategoryOption;
                const levelLabel = parentOption.hasHierarchyIssue
                  ? "Check hierarchy"
                  : parentOption.level === 1
                    ? "Root"
                    : `Level ${parentOption.level}`;

                return (
                  <Group justify="space-between" gap="sm" wrap="nowrap" w="100%">
                    <Stack
                      gap={1}
                      style={{
                        minWidth: 0,
                        paddingLeft: Math.min(Math.max(parentOption.level - 1, 0), 4) * 8,
                      }}
                    >
                      <Text size="sm" fw={700} truncate>{parentOption.categoryName}</Text>
                      <Text size="xs" c="dimmed" truncate>
                        {parentOption.hasHierarchyIssue
                          ? `${parentOption.path} · hierarchy needs attention`
                          : parentOption.parentPath
                            ? `Under ${parentOption.parentPath}`
                            : "Top-level category"}
                      </Text>
                    </Stack>
                    <Badge
                      size="xs"
                      variant="light"
                      color={parentOption.hasHierarchyIssue ? "red" : "gray"}
                      style={{ flexShrink: 0 }}
                    >
                      {levelLabel}
                    </Badge>
                  </Group>
                );
              }}
            />
            {error && <Alert className={classes.error} color="red">{error}</Alert>}
            <FinanceModalFooter>
              <Group className={classes.footer} gap="sm" wrap="wrap" justify="center">
                <Button type="button" variant="default" onClick={closeCreateModal} disabled={saving}>
                  Cancel
                </Button>
                <FinancePrimaryAction
                  type="submit"
                  leftSection={<IconPlus size={16} />}
                  loading={saving}
                  disabled={!name.trim()}
                >
                  Create and select
                </FinancePrimaryAction>
              </Group>
            </FinanceModalFooter>
          </Stack>
        </form>
      </FinanceModal>
    </>
  );
};

export default InlineCategorySelect;
