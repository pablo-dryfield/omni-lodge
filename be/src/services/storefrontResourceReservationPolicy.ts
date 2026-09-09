export type InventoryReservationDemand = {
  orderItemId: number;
  addonId: number;
  variant: string | null;
  quantity: number;
  commitExpiresAt: Date;
};

export type InventoryReservationMapping = {
  id: number;
  addonId: number;
  inventoryItemId: number;
  variant: string | null;
  quantityPerAddon: number;
};

export type InventoryReservationAllocation = {
  orderItemId: number;
  addonId: number;
  variant: string | null;
  inventoryItemId: number;
  quantity: number;
  commitExpiresAt: Date;
};

export type InventoryReservationShortage = {
  orderItemId: number;
  addonId: number;
  variant: string | null;
  missingQuantity: number;
};

export type InventoryReservationScheduleItem = {
  experienceStartsAt: Date | null;
  addons: Array<Record<string, unknown>>;
};

const normalizedVariant = (value: string | null | undefined): string =>
  String(value ?? '').trim().toUpperCase();

const demandKey = (addonId: number, variant: string | null): string =>
  `${addonId}:${normalizedVariant(variant)}`;

const roundStock = (value: number): number => Math.round(value * 1000) / 1000;

/**
 * Produces a deterministic allocation without mutating its inputs. Demands
 * with fewer compatible mappings are allocated first, and dedicated inventory
 * is preferred over stock shared by several add-ons/variants.
 */
export const allocateInventoryReservationDemands = (
  demandsInput: InventoryReservationDemand[],
  mappingsInput: InventoryReservationMapping[],
  availableByInventoryItemInput: ReadonlyMap<number, number>,
): {
  allocations: InventoryReservationAllocation[];
  shortages: InventoryReservationShortage[];
} => {
  const mappings = mappingsInput
    .filter((mapping) => Number.isInteger(mapping.inventoryItemId) && mapping.inventoryItemId > 0)
    .filter((mapping) => Number.isFinite(mapping.quantityPerAddon) && mapping.quantityPerAddon > 0)
    .sort((left, right) => left.inventoryItemId - right.inventoryItemId || left.id - right.id);
  const compatibility = new Map<string, InventoryReservationMapping[]>();
  for (const demand of demandsInput) {
    const key = demandKey(demand.addonId, demand.variant);
    compatibility.set(key, mappings.filter((mapping) => (
      mapping.addonId === demand.addonId
      && normalizedVariant(mapping.variant) === normalizedVariant(demand.variant)
    )));
  }

  const demandKeysByInventoryItem = new Map<number, Set<string>>();
  for (const [key, compatibleMappings] of compatibility) {
    for (const mapping of compatibleMappings) {
      const keys = demandKeysByInventoryItem.get(mapping.inventoryItemId) ?? new Set<string>();
      keys.add(key);
      demandKeysByInventoryItem.set(mapping.inventoryItemId, keys);
    }
  }

  const demands = [...demandsInput]
    .filter((demand) => Number.isInteger(demand.quantity) && demand.quantity > 0)
    .sort((left, right) => {
      const leftMappings = compatibility.get(demandKey(left.addonId, left.variant))?.length ?? 0;
      const rightMappings = compatibility.get(demandKey(right.addonId, right.variant))?.length ?? 0;
      return leftMappings - rightMappings
        || left.orderItemId - right.orderItemId
        || left.addonId - right.addonId
        || normalizedVariant(left.variant).localeCompare(normalizedVariant(right.variant));
    });
  const available = new Map(
    [...availableByInventoryItemInput].map(([inventoryItemId, quantity]) => [
      inventoryItemId,
      Math.max(0, Number(quantity) || 0),
    ]),
  );
  const allocationByKey = new Map<string, InventoryReservationAllocation>();
  const shortages: InventoryReservationShortage[] = [];

  for (const demand of demands) {
    let remaining = demand.quantity;
    const compatibleMappings = [...(compatibility.get(demandKey(demand.addonId, demand.variant)) ?? [])]
      .sort((left, right) => (
        (demandKeysByInventoryItem.get(left.inventoryItemId)?.size ?? 0)
        - (demandKeysByInventoryItem.get(right.inventoryItemId)?.size ?? 0)
        || left.inventoryItemId - right.inventoryItemId
        || left.id - right.id
      ));

    for (const mapping of compatibleMappings) {
      if (remaining <= 0) break;
      const inventoryAvailable = available.get(mapping.inventoryItemId) ?? 0;
      const addonCapacity = Math.max(
        0,
        Math.floor((inventoryAvailable + 0.0000001) / mapping.quantityPerAddon),
      );
      const allocatedAddonQuantity = Math.min(remaining, addonCapacity);
      if (allocatedAddonQuantity <= 0) continue;
      const inventoryQuantity = roundStock(allocatedAddonQuantity * mapping.quantityPerAddon);
      available.set(
        mapping.inventoryItemId,
        roundStock(Math.max(0, inventoryAvailable - inventoryQuantity)),
      );
      const key = [
        demand.orderItemId,
        demand.addonId,
        normalizedVariant(demand.variant),
        mapping.inventoryItemId,
      ].join(':');
      const previous = allocationByKey.get(key);
      allocationByKey.set(key, {
        orderItemId: demand.orderItemId,
        addonId: demand.addonId,
        variant: normalizedVariant(demand.variant) || null,
        inventoryItemId: mapping.inventoryItemId,
        quantity: roundStock((previous?.quantity ?? 0) + inventoryQuantity),
        commitExpiresAt: previous && previous.commitExpiresAt > demand.commitExpiresAt
          ? previous.commitExpiresAt
          : demand.commitExpiresAt,
      });
      remaining -= allocatedAddonQuantity;
    }

    if (remaining > 0) {
      shortages.push({
        orderItemId: demand.orderItemId,
        addonId: demand.addonId,
        variant: normalizedVariant(demand.variant) || null,
        missingQuantity: remaining,
      });
    }
  }

  return {
    allocations: [...allocationByKey.values()].sort((left, right) => (
      left.orderItemId - right.orderItemId
      || left.inventoryItemId - right.inventoryItemId
      || left.addonId - right.addonId
      || normalizedVariant(left.variant).localeCompare(normalizedVariant(right.variant))
    )),
    shortages,
  };
};

export const resolveInventoryReservationCommitExpiry = (
  paymentDueAt: Date,
  experienceStartsAt: Date | null,
): Date => {
  if (!experienceStartsAt) return new Date(paymentDueAt.getTime());
  const afterExperience = new Date(experienceStartsAt.getTime() + 24 * 60 * 60 * 1000);
  return afterExperience > paymentDueAt ? afterExperience : new Date(paymentDueAt.getTime());
};

const positiveSelectionQuantity = (value: unknown): number => {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

/**
 * Rebuilds the commitment horizon for an inventory reservation from the
 * current order-item schedule. A reservation may aggregate the same add-on
 * selection across several items, so it follows the latest matching event.
 */
export const resolveInventoryReservationCommitExpiryForSchedule = (
  paymentDueAt: Date,
  addonId: number,
  variant: string | null,
  items: InventoryReservationScheduleItem[],
): Date | null => {
  const wantedVariant = normalizedVariant(variant);
  let latest: Date | null = null;

  for (const item of items) {
    const matches = item.addons.some((addon) => {
      if (Number(addon.addonId) !== addonId) return false;
      const variants = Array.isArray(addon.variants)
        ? addon.variants.filter((entry): entry is Record<string, unknown> => (
            Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
          ))
        : [];
      if (wantedVariant) {
        return variants.some((selection) => (
          normalizedVariant(String(selection.value ?? '')) === wantedVariant
          && positiveSelectionQuantity(selection.quantity) > 0
        ));
      }
      return variants.length === 0 && positiveSelectionQuantity(addon.quantity) > 0;
    });
    if (!matches) continue;

    const expiry = resolveInventoryReservationCommitExpiry(
      paymentDueAt,
      item.experienceStartsAt,
    );
    if (!latest || expiry > latest) latest = expiry;
  }

  return latest;
};

export const canAcquireLimitedPromotion = (input: {
  redemptionCount: number;
  maxRedemptions: number | null;
  activeReservationCount: number;
  ownsActiveReservation?: boolean;
}): boolean => input.maxRedemptions === null
  || input.ownsActiveReservation === true
  || input.redemptionCount + input.activeReservationCount < input.maxRedemptions;
