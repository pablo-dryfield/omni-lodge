import { fn, col, Transaction } from 'sequelize';
import AddonInventoryMapping from '../models/AddonInventoryMapping.js';
import Counter from '../models/Counter.js';
import CounterChannelMetric from '../models/CounterChannelMetric.js';
import InventoryMovement from '../models/InventoryMovement.js';
import InventoryFulfillment from '../models/InventoryFulfillment.js';
import Booking from '../models/Booking.js';
import Addon from '../models/Addon.js';
import InventoryItem from '../models/InventoryItem.js';
import { Op } from 'sequelize';

export type TshirtVariantAvailability = {
  variant: string;
  availableQuantity: number;
  inStock: boolean;
};

export type AddonInventoryAvailability = {
  addonId: number;
  availableQuantity: number;
  inStock: boolean;
  variantSelectionRequired: boolean;
  variants: TshirtVariantAvailability[];
};

const TSHIRT_VARIANT_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const compareTshirtVariants = (left: string, right: string): number => {
  const leftIndex = TSHIRT_VARIANT_ORDER.indexOf(left);
  const rightIndex = TSHIRT_VARIANT_ORDER.indexOf(right);
  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
};

export async function getAvailableStock(inventoryItemId:number, transaction?:Transaction):Promise<number>{
  const onHand=Number(await InventoryMovement.sum('quantityDelta',{where:{inventoryItemId},transaction})??0);
  const reserved=Number(await InventoryFulfillment.sum('quantity',{where:{inventoryItemId,status:{[Op.in]:['ready','packed']}},transaction})??0);
  return onHand-reserved;
}

export async function getAddonInventoryAvailability(
  addonIds: number[],
  transaction?: Transaction,
): Promise<Map<number, AddonInventoryAvailability>> {
  const normalizedAddonIds = Array.from(
    new Set(addonIds.map(Number).filter((addonId) => Number.isInteger(addonId) && addonId > 0)),
  );
  if (!normalizedAddonIds.length) return new Map();

  const mappings = await AddonInventoryMapping.findAll({
    where: { addonId: { [Op.in]: normalizedAddonIds }, isActive: true },
    transaction,
  });
  if (!mappings.length) return new Map();

  const inventoryItemIds = Array.from(new Set(mappings.map((mapping) => mapping.inventoryItemId)));
  const activeItems = await InventoryItem.findAll({
    attributes: ['id'],
    where: { id: { [Op.in]: inventoryItemIds }, isActive: true },
    transaction,
  });
  const activeItemIds = new Set(activeItems.map((item) => item.id));
  const stockEntries = await Promise.all(
    inventoryItemIds
      .filter((inventoryItemId) => activeItemIds.has(inventoryItemId))
      .map(async (inventoryItemId) => [
        inventoryItemId,
        await getAvailableStock(inventoryItemId, transaction),
      ] as const),
  );
  const stockByItem = new Map(stockEntries);
  const quantitiesByAddonVariant = new Map<number, Map<string, number>>();
  const ungroupedQuantityByAddon = new Map<number, number>();
  const countedMappings = new Set<string>();

  for (const mapping of mappings) {
    if (!activeItemIds.has(mapping.inventoryItemId)) continue;
    const variant = String(mapping.variant ?? '').trim().toUpperCase();
    const mappingKey = `${mapping.addonId}:${variant || 'ALL'}:${mapping.inventoryItemId}`;
    if (countedMappings.has(mappingKey)) continue;
    countedMappings.add(mappingKey);

    const unitsPerAddon = Math.max(0.001, Number(mapping.quantityPerAddon) || 1);
    const availableQuantity = Math.max(
      0,
      Math.floor((stockByItem.get(mapping.inventoryItemId) ?? 0) / unitsPerAddon),
    );
    if (variant) {
      const variantQuantities = quantitiesByAddonVariant.get(mapping.addonId) ?? new Map<string, number>();
      variantQuantities.set(variant, (variantQuantities.get(variant) ?? 0) + availableQuantity);
      quantitiesByAddonVariant.set(mapping.addonId, variantQuantities);
    } else {
      ungroupedQuantityByAddon.set(
        mapping.addonId,
        (ungroupedQuantityByAddon.get(mapping.addonId) ?? 0) + availableQuantity,
      );
    }
  }

  const availabilityByAddon = new Map<number, AddonInventoryAvailability>();
  for (const addonId of normalizedAddonIds) {
    const variantQuantities = quantitiesByAddonVariant.get(addonId);
    const variants = variantQuantities
      ? Array.from(variantQuantities.entries())
          .map(([variant, availableQuantity]) => ({
            variant,
            availableQuantity,
            inStock: availableQuantity > 0,
          }))
          .sort((left, right) => compareTshirtVariants(left.variant, right.variant))
      : [];
    const ungroupedQuantity = ungroupedQuantityByAddon.get(addonId) ?? 0;
    const availableQuantity = variants.length > 0
      ? variants.reduce((total, variant) => total + variant.availableQuantity, 0)
      : ungroupedQuantity;
    if (variants.length > 0 || ungroupedQuantityByAddon.has(addonId)) {
      availabilityByAddon.set(addonId, {
        addonId,
        availableQuantity,
        inStock: availableQuantity > 0,
        variantSelectionRequired: variants.length > 0,
        variants,
      });
    }
  }

  return availabilityByAddon;
}

export async function getTshirtVariantAvailability(transaction?: Transaction): Promise<TshirtVariantAvailability[]> {
  const tshirtAddons = await Addon.findAll({
    attributes: ['id'],
    where: { isActive: true, name: { [Op.iLike]: '%shirt%' } },
    transaction,
  });
  const addonIds = tshirtAddons.map((addon) => addon.id);
  if (!addonIds.length) return [];

  const availabilityByAddon = await getAddonInventoryAvailability(addonIds, transaction);
  const quantityByVariant = new Map<string, number>();

  for (const availability of availabilityByAddon.values()) {
    for (const variant of availability.variants) {
      quantityByVariant.set(
        variant.variant,
        (quantityByVariant.get(variant.variant) ?? 0) + variant.availableQuantity,
      );
    }
  }

  return Array.from(quantityByVariant.entries())
    .map(([variant, availableQuantity]) => ({ variant, availableQuantity, inStock: availableQuantity > 0 }))
    .sort((left, right) => compareTshirtVariants(left.variant, right.variant));
}

export async function allocateWaitingFulfillments(inventoryItemId:number, actorId:number, transaction:Transaction):Promise<void>{
  let available=await getAvailableStock(inventoryItemId,transaction);
  const queue=await InventoryFulfillment.findAll({where:{inventoryItemId,status:'waiting_stock'},order:[['createdAt','ASC'],['id','ASC']],transaction,lock:transaction.LOCK.UPDATE});
  for(const row of queue){const qty=Number(row.quantity);if(qty<=available){await row.update({status:'ready',updatedBy:actorId},{transaction});available-=qty;}}
}

export async function reconcileCounterInventory(counter: Counter, actorId: number, transaction: Transaction): Promise<void> {
  const mappings = await AddonInventoryMapping.findAll({ where: { isActive: true }, transaction });
  if (!mappings.length) return;
  const metrics = await CounterChannelMetric.findAll({
    attributes: ['addonId', [fn('SUM', col('qty')), 'totalQty']],
    where: { counterId: counter.id, kind: 'addon', tallyType: 'attended' },
    group: ['addonId'], transaction,
  });
  const attended = new Map(metrics.map((row) => [Number(row.addonId), Number(row.get('totalQty') ?? 0)]));
  const variantMappingsByAddon = new Set(mappings.filter(mapping => Boolean(mapping.variant)).map(mapping => mapping.addonId));
  const bookings = variantMappingsByAddon.size ? await Booking.findAll({ where: { experienceDate: counter.date, ...(counter.productId ? { productId: counter.productId } : {}) }, attributes: ['attendedTshirtSizes'], transaction }) : [];
  const allocatedVariants = new Set(bookings.flatMap(booking => Object.entries(booking.attendedTshirtSizes ?? {}).filter(([, quantity]) => Number(quantity) > 0).map(([variant]) => variant.toUpperCase())));
  for (const addonId of variantMappingsByAddon) {
    const mappedVariants = new Set(mappings.filter(mapping => mapping.addonId === addonId && mapping.variant).map(mapping => mapping.variant!.toUpperCase()));
    const missing = Array.from(allocatedVariants).filter(variant => !mappedVariants.has(variant));
    if (missing.length) throw new Error(`Missing inventory mapping for T-shirt size${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`);
  }
  for (const mapping of mappings) {
    // Every fulfillment tied to the counter represents stock that was not handed out there.
    // Completed fulfillments have their own movement, while cancelled ones were never consumed.
    const promised=Number(await InventoryFulfillment.sum('quantity',{where:{counterId:counter.id,addonId:mapping.addonId,inventoryItemId:mapping.inventoryItemId},transaction})??0);
    if (!mapping.variant && variantMappingsByAddon.has(mapping.addonId)) continue;
    const variantQuantity = mapping.variant ? bookings.reduce((sum, booking) => sum + Math.max(0, Number(booking.attendedTshirtSizes?.[mapping.variant!] ?? 0)), 0) : null;
    const required = Math.max(0,(variantQuantity ?? attended.get(mapping.addonId) ?? 0) * Number(mapping.quantityPerAddon)-promised);
    const previous = Number(await InventoryMovement.sum('quantityDelta', {
      where: { counterId: counter.id, inventoryItemId: mapping.inventoryItemId, type: 'counter_usage' }, transaction,
    }) ?? 0);
    const delta = -required - previous;
    if (Math.abs(delta) > 0.0001) {
      await InventoryMovement.create({ inventoryItemId: mapping.inventoryItemId, quantityDelta: delta, type: 'counter_usage', date: counter.date, counterId: counter.id, purchaseId: null, unitCostMinor: null, notes: `Final attended add-ons${mapping.variant ? ` (${mapping.variant})` : ''} for counter #${counter.id}`, createdBy: actorId }, { transaction });
      if (delta > 0) await allocateWaitingFulfillments(mapping.inventoryItemId, actorId, transaction);
    }
  }
}
