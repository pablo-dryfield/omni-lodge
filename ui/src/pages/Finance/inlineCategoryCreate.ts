import type { FinanceCategory, FinanceTransaction } from "../../types/finance";
import type { ComboboxItem, ComboboxParsedItem, OptionsFilter } from "@mantine/core";

export const CREATE_NEW_CATEGORY_VALUE = "__create_new_finance_category__";
export const CREATE_NEW_CATEGORY_LABEL = "Create new category";

export type InlineParentCategoryOption = {
  value: string;
  label: string;
  categoryName: string;
  path: string;
  parentPath: string | null;
  level: number;
  hasHierarchyIssue: boolean;
};

const isComboboxItem = (option: ComboboxParsedItem): option is ComboboxItem =>
  "value" in option;

export const filterInlineCategoryOptions: OptionsFilter = ({ options, search, limit }) => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const createOption = options.find(
    (option) => isComboboxItem(option) && option.value === CREATE_NEW_CATEGORY_VALUE,
  );
  const matchingCategories = options
    .filter(
      (option): option is ComboboxItem =>
        isComboboxItem(option)
        && option.value !== CREATE_NEW_CATEGORY_VALUE
        && (!normalizedSearch || option.label.toLocaleLowerCase().includes(normalizedSearch)),
    )
    .slice(0, limit);

  return createOption ? [...matchingCategories, createOption] : matchingCategories;
};

export const getTransactionCategoryKind = (
  transactionKind: FinanceTransaction["kind"],
): FinanceCategory["kind"] | null => {
  if (transactionKind === "expense") {
    return "expense";
  }
  if (transactionKind === "income" || transactionKind === "refund") {
    return "income";
  }
  return null;
};

export const getInlineCategoryOptions = (
  categories: FinanceCategory[],
  transactionKind: FinanceTransaction["kind"],
  canCreate: boolean,
): Array<{ value: string; label: string }> => {
  const categoryKind = getTransactionCategoryKind(transactionKind);
  if (!categoryKind) {
    return [];
  }

  const options = categories
    .filter((category) => category.kind === categoryKind)
    .map((category) => ({
      value: String(category.id),
      label: category.name,
    }));

  if (canCreate) {
    options.push({
      value: CREATE_NEW_CATEGORY_VALUE,
      label: CREATE_NEW_CATEGORY_LABEL,
    });
  }

  return options;
};

export const getInlineParentCategoryOptions = (
  categories: FinanceCategory[],
  kind: FinanceCategory["kind"],
): InlineParentCategoryOption[] => {
  const categoriesById = new Map(
    categories
      .filter((category) => category.kind === kind)
      .map((category) => [category.id, category]),
  );

  return categories
    .filter((category) => category.kind === kind && category.isActive)
    .map((category) => {
      const names: string[] = [];
      const visited = new Set<number>();
      let current: FinanceCategory | undefined = category;
      let hasHierarchyIssue = false;

      while (current) {
        if (visited.has(current.id)) {
          hasHierarchyIssue = true;
          break;
        }

        visited.add(current.id);
        names.unshift(current.name.trim() || `Category #${current.id}`);

        if (current.parentId == null) {
          break;
        }

        const parent = categoriesById.get(current.parentId);
        if (!parent) {
          hasHierarchyIssue = true;
          break;
        }
        current = parent;
      }

      const path = names.join(" › ");
      const level = names.length;
      const levelLabel = hasHierarchyIssue
        ? "Hierarchy issue"
        : level === 1
          ? "Root"
          : `Level ${level}`;

      return {
        value: String(category.id),
        label: `${path} · ${levelLabel}`,
        categoryName: category.name,
        path,
        parentPath: names.length > 1 ? names.slice(0, -1).join(" › ") : null,
        level,
        hasHierarchyIssue,
      };
    })
    .sort((left, right) =>
      left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
      || Number(left.value) - Number(right.value));
};

export const validateNewFinanceCategoryName = (
  rawName: string,
  categories: FinanceCategory[],
  kind: FinanceCategory["kind"],
): string | null => {
  const name = rawName.trim();
  if (!name) {
    return "Category name is required.";
  }

  const normalizedName = name.toLocaleLowerCase();
  if (
    categories.some(
      (category) => category.kind === kind && category.name.trim().toLocaleLowerCase() === normalizedName,
    )
  ) {
    return `An ${kind} category with this name already exists.`;
  }

  return null;
};

export const getInlineCategoryNameSuggestion = (
  search: string,
  selectedLabel: string | null,
): string => {
  const normalizedSearch = search.trim();
  if (
    !normalizedSearch
    || normalizedSearch === CREATE_NEW_CATEGORY_VALUE
    || normalizedSearch.toLocaleLowerCase() === CREATE_NEW_CATEGORY_LABEL.toLocaleLowerCase()
    || normalizedSearch.toLocaleLowerCase() === `+ ${CREATE_NEW_CATEGORY_LABEL}`.toLocaleLowerCase()
    || normalizedSearch.toLocaleLowerCase() === selectedLabel?.trim().toLocaleLowerCase()
  ) {
    return "";
  }
  return normalizedSearch;
};
