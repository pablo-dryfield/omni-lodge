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

/**
 * An omitted product-type query means "all product types". While the catalog is
 * still loading, preserve an explicit URL selection instead of incorrectly
 * collapsing it to the unfiltered default.
 */
export const serializeProductTypeSelection = (
  selectedValues: readonly string[],
  availableValues: readonly string[],
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
  if (available.every((value) => selectedSet.has(value))) {
    return undefined;
  }

  return selected.join(',');
};
