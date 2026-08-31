import type {
  ComboboxItem,
  ComboboxParsedItem,
  OptionsFilter,
} from "@mantine/core";

export const CREATE_VENDOR_OPTION_VALUE = "__finance_create_vendor__";

export type VendorOption = {
  value: string;
  label: string;
};

export type VendorDefaultCategoryOption = {
  value: string;
  label: string;
};

export const resolveInlineVendorDefaultCategoryId = (
  suggestedCategoryId: number | null | undefined,
  categoryOptions: readonly VendorDefaultCategoryOption[],
): number | null => {
  if (!suggestedCategoryId) {
    return null;
  }
  return categoryOptions.some(({ value }) => Number(value) === suggestedCategoryId)
    ? suggestedCategoryId
    : null;
};

const isComboboxItem = (option: ComboboxParsedItem): option is ComboboxItem =>
  "value" in option;

export const filterInlineVendorOptions: OptionsFilter = ({ options, search, limit }) => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const createOption = options.find(
    (option) => isComboboxItem(option) && option.value === CREATE_VENDOR_OPTION_VALUE,
  );
  const matchingVendors = options
    .filter(
      (option): option is ComboboxItem =>
        isComboboxItem(option)
        && option.value !== CREATE_VENDOR_OPTION_VALUE
        && (!normalizedSearch || option.label.toLocaleLowerCase().includes(normalizedSearch)),
    )
    .slice(0, limit);

  return createOption ? [...matchingVendors, createOption] : matchingVendors;
};

export const getInlineVendorNameSuggestion = (
  search: string,
  selectedLabel: string | null,
): string => {
  const normalizedSearch = search.trim();
  const normalizedSearchLower = normalizedSearch.toLocaleLowerCase();
  if (
    !normalizedSearch
    || normalizedSearch === CREATE_VENDOR_OPTION_VALUE
    || normalizedSearchLower === "create new vendor"
    || normalizedSearchLower === "+ create new vendor"
    || normalizedSearchLower === selectedLabel?.trim().toLocaleLowerCase()
  ) {
    return "";
  }
  return normalizedSearch;
};

export const validateInlineVendorName = (
  rawName: string,
  options: VendorOption[],
): string | null => {
  const normalizedName = rawName.trim();
  if (!normalizedName) {
    return "Vendor name is required.";
  }
  const existingVendor = options.find(
    (option) => option.label.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase(),
  );
  return existingVendor
    ? `A vendor named ${existingVendor.label} already exists. Select it from the list instead.`
    : null;
};
