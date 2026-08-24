const TSHIRT_SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

const sizeOrderIndex = (size: string): number => {
  const index = TSHIRT_SIZE_ORDER.indexOf(size);
  return index >= 0 ? index : TSHIRT_SIZE_ORDER.length;
};

export const getManifestTshirtSizeLabels = (
  quantity: number,
  selectedSizes?: Record<string, number>,
): string[] => {
  const bookedQuantity = Math.max(0, Math.round(Number(quantity) || 0));
  const sizes = Object.entries(selectedSizes ?? {})
    .map(([rawSize, rawQuantity]) => ({
      size: rawSize.trim().toUpperCase(),
      quantity: Number(rawQuantity),
    }))
    .filter(({ size, quantity }) => size.length > 0 && Number.isInteger(quantity) && quantity > 0)
    .sort((left, right) => {
      const orderDifference = sizeOrderIndex(left.size) - sizeOrderIndex(right.size);
      return orderDifference !== 0 ? orderDifference : left.size.localeCompare(right.size);
    });

  if (sizes.length === 0) {
    return [];
  }

  const selectedQuantity = sizes.reduce((total, size) => total + size.quantity, 0);
  const details = sizes.map(
    ({ size, quantity: sizeQuantity }) => `${size} × ${sizeQuantity}`,
  );
  const unspecifiedQuantity = Math.max(bookedQuantity - selectedQuantity, 0);
  if (unspecifiedQuantity > 0) {
    details.push(`${unspecifiedQuantity} unspecified`);
  }

  return details;
};
