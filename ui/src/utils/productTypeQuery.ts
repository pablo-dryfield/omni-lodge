const compareProductTypeValues = (left: string, right: string) => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  const leftIsNumber = Number.isFinite(leftNumber);
  const rightIsNumber = Number.isFinite(rightNumber);

  if (leftIsNumber && rightIsNumber && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  if (leftIsNumber !== rightIsNumber) {
    return leftIsNumber ? -1 : 1;
  }

  return left.localeCompare(right);
};

export const normalizeProductTypeQueryValues = (values: readonly string[]) =>
  Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

export const sortProductTypeQueryValues = (values: readonly string[]) =>
  normalizeProductTypeQueryValues(values).sort(compareProductTypeValues);

export type ProductTypeQueryOption = {
  value: string;
  label: string;
};

const normalizeProductTypeLabel = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

export const isFoodTourProductType = (option: ProductTypeQueryOption): boolean =>
  normalizeProductTypeLabel(option.label) === 'food tour krakow';

export const getDefaultBookingsSummaryProductTypeValues = (
  options: readonly ProductTypeQueryOption[],
): string[] => {
  const allValues = normalizeProductTypeQueryValues(options.map((option) => option.value));
  const filteredValues = normalizeProductTypeQueryValues(
    options
      .filter((option) => !isFoodTourProductType(option))
      .map((option) => option.value),
  );
  return filteredValues.length > 0 ? filteredValues : allValues;
};

export const resolveBookingsSummaryProductTypeValues = (
  options: readonly ProductTypeQueryOption[],
  requestedValues: readonly string[],
  hasExplicitUrlSelection: boolean,
): string[] => {
  const availableValues = normalizeProductTypeQueryValues(options.map((option) => option.value));
  const availableSet = new Set(availableValues);
  const validRequestedValues = sortProductTypeQueryValues(requestedValues).filter((value) =>
    availableSet.has(value),
  );

  if (validRequestedValues.length > 0) {
    return validRequestedValues;
  }

  return hasExplicitUrlSelection
    ? availableValues
    : getDefaultBookingsSummaryProductTypeValues(options);
};

type SerializeProductTypeSelectionOptions = {
  omitWhenAllSelected?: boolean;
};

/**
 * By default, an omitted product-type query means "all product types". While
 * the catalog is loading, preserve an explicit URL selection instead of
 * incorrectly collapsing it. Pages with a filtered default can keep an
 * all-types selection explicit with omitWhenAllSelected=false.
 */
export const serializeProductTypeSelection = (
  selectedValues: readonly string[],
  availableValues: readonly string[],
  options: SerializeProductTypeSelectionOptions = {},
): string | undefined => {
  const selected = sortProductTypeQueryValues(selectedValues);
  if (selected.length === 0) {
    return undefined;
  }

  const available = normalizeProductTypeQueryValues(availableValues);
  if (available.length === 0) {
    return selected.join(',');
  }

  const selectedSet = new Set(selected);
  if (options.omitWhenAllSelected !== false && available.every((value) => selectedSet.has(value))) {
    return undefined;
  }

  return selected.join(',');
};
