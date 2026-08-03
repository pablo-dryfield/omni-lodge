import { fn, col, Transaction } from 'sequelize';
import AddonInventoryMapping from '../models/AddonInventoryMapping.js';
import Counter from '../models/Counter.js';
import CounterChannelMetric from '../models/CounterChannelMetric.js';
import InventoryMovement from '../models/InventoryMovement.js';
import InventoryFulfillment from '../models/InventoryFulfillment.js';
import { Op } from 'sequelize';

export async function getAvailableStock(inventoryItemId:number, transaction?:Transaction):Promise<number>{
  const onHand=Number(await InventoryMovement.sum('quantityDelta',{where:{inventoryItemId},transaction})??0);
  const reserved=Number(await InventoryFulfillment.sum('quantity',{where:{inventoryItemId,status:{[Op.in]:['ready','packed']}},transaction})??0);
  return onHand-reserved;
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
  for (const mapping of mappings) {
    // Every fulfillment tied to the counter represents stock that was not handed out there.
    // Completed fulfillments have their own movement, while cancelled ones were never consumed.
    const promised=Number(await InventoryFulfillment.sum('quantity',{where:{counterId:counter.id,addonId:mapping.addonId,inventoryItemId:mapping.inventoryItemId},transaction})??0);
    const required = Math.max(0,(attended.get(mapping.addonId) ?? 0) * Number(mapping.quantityPerAddon)-promised);
    const previous = Number(await InventoryMovement.sum('quantityDelta', {
      where: { counterId: counter.id, inventoryItemId: mapping.inventoryItemId, type: 'counter_usage' }, transaction,
    }) ?? 0);
    const delta = -required - previous;
    if (Math.abs(delta) > 0.0001) {
      await InventoryMovement.create({ inventoryItemId: mapping.inventoryItemId, quantityDelta: delta, type: 'counter_usage', date: counter.date, counterId: counter.id, purchaseId: null, unitCostMinor: null, notes: `Final attended add-ons for counter #${counter.id}`, createdBy: actorId }, { transaction });
    }
  }
}
