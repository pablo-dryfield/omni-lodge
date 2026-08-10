import type { Response } from 'express';
import { fn, col } from 'sequelize';
import sequelize from '../config/database.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import InventoryItem from '../models/InventoryItem.js';
import AddonInventoryMapping from '../models/AddonInventoryMapping.js';
import InventoryMovement, { InventoryMovementType } from '../models/InventoryMovement.js';
import InventoryPurchase from '../models/InventoryPurchase.js';
import InventoryPurchaseItem from '../models/InventoryPurchaseItem.js';
import Addon from '../models/Addon.js';
import { FinanceAccount, FinanceCategory, FinanceFile, FinanceTransaction, FinanceVendor } from '../finance/models/index.js';
import { createFinanceTransaction } from '../finance/services/transactionService.js';
import InventoryFulfillment, { InventoryFulfillmentStatus } from '../models/InventoryFulfillment.js';
import Booking from '../models/Booking.js';
import Counter from '../models/Counter.js';
import { allocateWaitingFulfillments, getAvailableStock, reconcileCounterInventory } from '../services/inventoryService.js';

const actor = (req: AuthenticatedRequest) => { const id = req.authContext?.id; if (!id) throw new Error('Authentication required'); return id; };
const fail = (res: Response, error: unknown) => res.status(error instanceof Error && /required|invalid|positive|not found/i.test(error.message) ? 400 : 500).json([{ message: error instanceof Error ? error.message : 'Unknown error' }]);
const positive = (value: unknown, name: string) => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be positive`); return n; };

export async function getInventoryOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const items = await InventoryItem.findAll({ order: [['name','ASC']] });
    const totals = await InventoryMovement.findAll({ attributes: ['inventoryItemId', [fn('SUM', col('quantity_delta')), 'stock']], group: ['inventoryItemId'] });
    const byId = new Map(totals.map(x => [x.inventoryItemId, Number(x.get('stock') ?? 0)]));
    const mappings = await AddonInventoryMapping.findAll();
    const addons = await Addon.findAll({ attributes: ['id','name'] });
    const addonNames = new Map(addons.map(x => [x.id, x.name]));
    const reservedRows=await InventoryFulfillment.findAll({attributes:['inventoryItemId',[fn('SUM',col('quantity')),'reserved']],where:{status:['ready','packed']},group:['inventoryItemId']}); const reserved=new Map(reservedRows.map(x=>[x.inventoryItemId,Number(x.get('reserved')??0)]));
    const incidents=await InventoryMovement.findAll({where:{type:'damage'},order:[['createdAt','DESC']],limit:100});
    res.json({ items: items.map(item => {const currentStock=byId.get(item.id)??0;const reservedStock=reserved.get(item.id)??0;return ({ ...item.toJSON(), currentStock,reservedStock,availableStock:currentStock-reservedStock, lowStock: currentStock-reservedStock <= Number(item.reorderLevel) });}), mappings: mappings.map(m => ({ ...m.toJSON(), addonName: addonNames.get(m.addonId) ?? null })),incidents });
  } catch (e) { fail(res,e); }
}

export async function createInventoryItem(req: AuthenticatedRequest, res: Response): Promise<void> {
  try { const name=String(req.body.name ?? '').trim(); const sku=String(req.body.sku ?? '').trim(); if (!name || !sku) throw new Error('name and sku are required'); const item = await InventoryItem.create({ name, sku, unit: String(req.body.unit ?? 'unit'), reorderLevel: Number(req.body.reorderLevel ?? 0), isActive: true, createdBy: actor(req), updatedBy: null }); res.status(201).json({ item }); } catch(e) { fail(res,e); }
}

export async function createInventoryMapping(req: AuthenticatedRequest, res: Response): Promise<void> {
  try { const addonId = positive(req.body.addonId,'addonId'); const inventoryItemId = positive(req.body.inventoryItemId,'inventoryItemId'); const quantityPerAddon = positive(req.body.quantityPerAddon ?? 1,'quantityPerAddon'); const variant = String(req.body.variant ?? '').trim().toUpperCase() || null; const mapping = await AddonInventoryMapping.create({ addonId, inventoryItemId, quantityPerAddon, variant, isActive: true }); res.status(201).json({ mapping }); } catch(e) { fail(res,e); }
}

export async function createInventoryAdjustment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try { const quantityDelta = Number(req.body.quantityDelta); if (!Number.isFinite(quantityDelta) || quantityDelta === 0) throw new Error('quantityDelta must be non-zero'); const allowed: InventoryMovementType[] = ['initial_stock','adjustment','damage','return','correction']; const type = String(req.body.type) as InventoryMovementType; if (!allowed.includes(type)) throw new Error('Invalid adjustment type'); const movement = await InventoryMovement.create({ inventoryItemId: positive(req.body.inventoryItemId,'inventoryItemId'), quantityDelta, type, date: String(req.body.date), unitCostMinor: req.body.unitCostMinor == null ? null : Number(req.body.unitCostMinor), notes: req.body.notes ?? null, purchaseId: null, counterId: null, createdBy: actor(req) }); res.status(201).json({ movement }); } catch(e) { fail(res,e); }
}

export async function createInventoryUsageIncident(req:AuthenticatedRequest,res:Response):Promise<void>{try{const userId=actor(req);const addonId=positive(req.body.addonId,'addonId');const mappingWhere:Record<string,unknown>={addonId,isActive:true};if(req.body.inventoryItemId)mappingWhere.inventoryItemId=positive(req.body.inventoryItemId,'inventoryItemId');const mapping=await AddonInventoryMapping.findOne({where:mappingWhere});if(!mapping)throw new Error('No active inventory mapping found for this add-on');const quantity=positive(req.body.quantity,'quantity');const consumed=quantity*Number(mapping.quantityPerAddon);const kind=String(req.body.incidentKind??'retake');if(!['retake','damaged','waste','complimentary','other'].includes(kind))throw new Error('Invalid incident kind');const bookingId=req.body.bookingId?positive(req.body.bookingId,'bookingId'):null;const counterId=req.body.counterId?positive(req.body.counterId,'counterId'):null;if(bookingId&&!await Booking.count({where:{id:bookingId}}))throw new Error('Booking not found');if(counterId&&!await Counter.count({where:{id:counterId}}))throw new Error('Counter not found');const movement=await InventoryMovement.create({inventoryItemId:mapping.inventoryItemId,quantityDelta:-consumed,type:'damage',date:String(req.body.date??dayString()),unitCostMinor:null,purchaseId:null,counterId,fulfillmentId:null,addonId,bookingId,incidentKind:kind,notes:req.body.notes??null,createdBy:userId});res.status(201).json({incident:movement});}catch(e){fail(res,e);}}

export async function listInventoryPurchases(req: AuthenticatedRequest, res: Response): Promise<void> {
  try { const purchases = await InventoryPurchase.findAll({ order: [['date','DESC'],['id','DESC']], limit: 200 }); const ids = purchases.map(x=>x.id); const lines = ids.length ? await InventoryPurchaseItem.findAll({ where: { purchaseId: ids } }) : []; res.json({ purchases: purchases.map(p => ({ ...p.toJSON(), items: lines.filter(x=>x.purchaseId===p.id) })) }); } catch(e) { fail(res,e); }
}

export async function getInventoryFinanceOptions(req: AuthenticatedRequest, res: Response): Promise<void> {
  try { const [accounts,categories,vendors,files] = await Promise.all([FinanceAccount.findAll(),FinanceCategory.findAll(),FinanceVendor.findAll(),FinanceFile.findAll({ order:[['uploadedAt','DESC']],limit:100 })]); res.json({ accounts,categories,vendors,files }); } catch(e) { fail(res,e); }
}

export async function createInventoryPurchase(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = actor(req); const lines = Array.isArray(req.body.items) ? req.body.items : []; if (!lines.length) throw new Error('At least one purchase item is required');
    const normalized = lines.map((x: any) => { const quantity=positive(x.quantity,'quantity'); const unitCostMinor=Math.round(positive(x.unitCostMinor,'unitCostMinor')); return { inventoryItemId: positive(x.inventoryItemId,'inventoryItemId'), quantity, unitCostMinor, lineTotalMinor: Math.round(quantity*unitCostMinor) }; });
    const calculatedTotal = normalized.reduce((s:any,x:any)=>s+x.lineTotalMinor,0); const totalMinor = req.body.totalMinor == null ? calculatedTotal : Math.round(positive(req.body.totalMinor,'totalMinor'));
    const result = await sequelize.transaction(async transaction => {
      const finance = await createFinanceTransaction({ kind:'expense', date:String(req.body.date), accountId:positive(req.body.accountId,'accountId'), currency:String(req.body.currency ?? 'PLN').toUpperCase(), amountMinor:totalMinor, categoryId:positive(req.body.categoryId,'categoryId'), counterpartyType:'vendor', counterpartyId:positive(req.body.vendorId,'vendorId'), status:req.body.status ?? 'paid', paymentMethod:req.body.paymentMethod ?? null, description:req.body.notes ?? `Inventory purchase${req.body.invoiceNumber ? ` invoice ${req.body.invoiceNumber}` : ''}`, invoiceFileId:req.body.invoiceFileId == null ? null : positive(req.body.invoiceFileId,'invoiceFileId'), tags:{ source:'inventory_purchase' }, meta:{ invoiceNumber:req.body.invoiceNumber ?? null } }, userId, { transaction });
      const purchase = await InventoryPurchase.create({ date:String(req.body.date), vendorId:Number(req.body.vendorId), financeTransactionId:finance.id, invoiceFileId:req.body.invoiceFileId ?? null, invoiceNumber:req.body.invoiceNumber ?? null, currency:String(req.body.currency ?? 'PLN').toUpperCase(), totalMinor, notes:req.body.notes ?? null, createdBy:userId }, { transaction });
      for (const line of normalized) { await InventoryPurchaseItem.create({ ...line, purchaseId:purchase.id }, { transaction }); await InventoryMovement.create({ inventoryItemId:line.inventoryItemId, quantityDelta:line.quantity, type:'purchase', date:purchase.date, unitCostMinor:line.unitCostMinor, purchaseId:purchase.id, counterId:null, fulfillmentId:null, notes:purchase.invoiceNumber ? `Invoice ${purchase.invoiceNumber}` : null, createdBy:userId }, { transaction }); await allocateWaitingFulfillments(line.inventoryItemId,userId,transaction); }
      await FinanceTransaction.update({ meta:{ source:'inventory_purchase', inventoryPurchaseId:purchase.id, invoiceNumber:purchase.invoiceNumber } }, { where:{ id:finance.id }, transaction });
      return { purchase, financeTransaction: finance };
    }); res.status(201).json(result);
  } catch(e) { fail(res,e); }
}

export async function listInventoryFulfillments(req:AuthenticatedRequest,res:Response):Promise<void>{try{const rows=await InventoryFulfillment.findAll({order:[['createdAt','ASC']]});res.json({fulfillments:rows});}catch(e){fail(res,e);}}
export async function createInventoryFulfillment(req:AuthenticatedRequest,res:Response):Promise<void>{try{const userId=actor(req);const inventoryItemId=positive(req.body.inventoryItemId,'inventoryItemId');const addonId=positive(req.body.addonId,'addonId');const quantity=positive(req.body.quantity,'quantity');const recipientName=String(req.body.recipientName??'').trim();if(!recipientName)throw new Error('recipientName is required');const bookingId=req.body.bookingId?positive(req.body.bookingId,'bookingId'):null;const counterId=req.body.counterId?positive(req.body.counterId,'counterId'):null;if(bookingId&&!await Booking.count({where:{id:bookingId}}))throw new Error('Booking not found');const counter=counterId?await Counter.findByPk(counterId):null;if(counterId&&!counter)throw new Error('Counter not found');const row=await sequelize.transaction(async transaction=>{const available=await getAvailableStock(inventoryItemId,transaction);const created=await InventoryFulfillment.create({inventoryItemId,addonId,bookingId,counterId,quantity,status:available>=quantity?'ready':'waiting_stock',deliveryMethod:req.body.deliveryMethod==='collection'?'collection':'mail',recipientName,email:req.body.email??null,phone:req.body.phone??null,address:req.body.address??null,size:req.body.size??null,trackingNumber:null,fulfilledAt:null,postageFinanceTransactionId:null,notes:req.body.notes??null,createdBy:userId,updatedBy:null},{transaction});if(counter?.status==='final')await reconcileCounterInventory(counter,userId,transaction);return created;});res.status(201).json({fulfillment:row});}catch(e){fail(res,e);}}
export async function updateInventoryFulfillment(req:AuthenticatedRequest,res:Response):Promise<void>{try{const userId=actor(req);const id=positive(req.params.id,'id');const target=String(req.body.status) as InventoryFulfillmentStatus;const allowed:InventoryFulfillmentStatus[]=['waiting_stock','ready','packed','shipped','collected','cancelled'];if(!allowed.includes(target))throw new Error('Invalid fulfillment status');const row=await sequelize.transaction(async transaction=>{const record=await InventoryFulfillment.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});if(!record)throw new Error('Fulfillment not found');if(['shipped','collected'].includes(record.status)&&record.status!==target)throw new Error('Completed fulfillment cannot be reopened');if(['shipped','collected'].includes(target)&&!['ready','packed'].includes(record.status))throw new Error('Only allocated fulfillment can be completed');if(['shipped','collected'].includes(target)){await InventoryMovement.create({inventoryItemId:record.inventoryItemId,quantityDelta:-Number(record.quantity),type:'counter_usage',date:dayString(),unitCostMinor:null,purchaseId:null,counterId:record.counterId,fulfillmentId:record.id,notes:`Fulfillment #${record.id} ${target}`,createdBy:userId},{transaction});}let postageFinanceTransactionId=record.postageFinanceTransactionId;const postage=req.body.postage;if(target==='shipped'&&postage&&Number(postage.amountMinor)>0&&!postageFinanceTransactionId){const expense=await createFinanceTransaction({kind:'expense',date:dayString(),accountId:positive(postage.accountId,'postage.accountId'),currency:String(postage.currency??'PLN').toUpperCase(),amountMinor:Math.round(positive(postage.amountMinor,'postage.amountMinor')),categoryId:positive(postage.categoryId,'postage.categoryId'),counterpartyType:'vendor',counterpartyId:positive(postage.vendorId,'postage.vendorId'),status:postage.status??'paid',description:`Postage for inventory fulfillment #${record.id}`,invoiceFileId:postage.invoiceFileId??null,tags:{source:'inventory_fulfillment_postage'},meta:{inventoryFulfillmentId:record.id} },userId,{transaction});postageFinanceTransactionId=expense.id;}await record.update({status:target,trackingNumber:req.body.trackingNumber??record.trackingNumber,fulfilledAt:['shipped','collected'].includes(target)?new Date():record.fulfilledAt,postageFinanceTransactionId,updatedBy:userId},{transaction});if(target==='cancelled')await allocateWaitingFulfillments(record.inventoryItemId,userId,transaction);return record;});res.json({fulfillment:row});}catch(e){fail(res,e);}}
const dayString=()=>new Date().toISOString().slice(0,10);
