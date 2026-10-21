import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import { Op, UniqueConstraintError, ValidationError, type Model, type ModelStatic, type Transaction } from 'sequelize';
import { DataType } from 'sequelize-typescript';
import sequelize from '../config/database.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import UserTypeProductType from '../models/UserTypeProductType.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import Product from '../models/Product.js';
import ProductType from '../models/ProductType.js';
import ProductPrice from '../models/ProductPrice.js';
import ProductAddon from '../models/ProductAddon.js';
import Addon from '../models/Addon.js';
import AuditLog from '../models/AuditLog.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { applyUserTypeChange } from '../services/staffEligibilityHistoryService.js';
import { isExclusiveProductScope, type ScopedApiRoute } from '../services/productScopedApiPolicy.js';
import { getAllowedProductTypeIds } from '../services/productScopeService.js';

const USER_FIELDS = ['id', 'username', 'firstName', 'lastName', 'email', 'phone', 'whatsappHandle',
  'arrivalDate', 'departureDate', 'userTypeId', 'status', 'approved', 'badgeRequired', 'createdAt', 'updatedAt'];
const USER_WRITABLE = ['username', 'firstName', 'lastName', 'email', 'phone', 'whatsappHandle',
  'arrivalDate', 'departureDate', 'userTypeId', 'status', 'approved', 'badgeRequired', 'password'];
const columns = (model: ModelStatic<Model>, fields?: string[]) => Object.entries(model.getAttributes())
  .filter(([key]) => !fields || fields.includes(key))
  .map(([key, attribute]) => ({ header: key.charAt(0).toUpperCase() + key.slice(1), accessorKey: key,
    type: attribute.type instanceof DataType.DATE ? 'date' : 'text' }));
const pick = (record: Model, fields: string[]) => Object.fromEntries(fields.map(key => [key, record.get(key)]));
const positiveId = (value: unknown, field: string): number => {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new HttpError(400, `${field} must be a positive integer`);
  }
  return Number(value);
};
const payloadFor = (input: unknown, fields: string[]): Record<string, unknown> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid request body');
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some(key => ![...fields, 'createdBy', 'updatedBy'].includes(key))) {
    throw new HttpError(400, 'This request contains fields unavailable to product-scoped management');
  }
  return Object.fromEntries(Object.entries(body).filter(([key]) => fields.includes(key)));
};
const audit = async (req: AuthenticatedRequest, action: string, entity: string, id: number,
  metaJson: Record<string, unknown>, transaction: Transaction) => AuditLog.create({
  actorId: req.authContext!.id, action: `product_scope.${action}`, entity, entityId: String(id),
  metaJson: { ...metaJson, productTypeIds: req.productTypeScope },
}, { transaction });

const FOOD_TOUR_OWNER = 'food-tour-owner';

/** Empty scopes mean global, not empty. Food Tour owners may delegate their
 * explicitly scoped role family; other actors still need a permission subset. */
export async function manageableRoleIds(req: AuthenticatedRequest, scope: number[], transaction?: Transaction): Promise<number[]> {
  const links = await UserTypeProductType.findAll({ transaction });
  const scopes = new Map<number, number[]>();
  for (const link of links) scopes.set(link.userTypeId, [...(scopes.get(link.userTypeId) ?? []), link.productTypeId]);
  const candidates = [...scopes].filter(([, ids]) => isExclusiveProductScope(ids, scope)).map(([id]) => id);
  // Resolve role identity from the database, including inside the write
  // transaction, rather than trusting a potentially stale session role slug.
  const roles = await UserType.findAll({
    where: { id: { [Op.in]: [...candidates, req.authContext!.userTypeId!] } },
    attributes: ['id', 'slug', 'status'], transaction,
  });
  const actor = roles.find(role => role.id === req.authContext!.userTypeId);
  if (!actor?.status) return [];
  const activeCandidates = roles.filter(role => role.status && candidates.includes(role.id));
  if (actor.slug === FOOD_TOUR_OWNER) {
    const products = await ProductType.findAll({ where: { id: { [Op.in]: scope } }, attributes: ['id', 'name'], transaction });
    // A role name alone never grants access: both sides must be explicitly
    // Food Tour-only. The API boundary still clips every delegated permission.
    if (scope.length !== 1 || products.length !== 1 || !/^food tour(?:$|[ -])/i.test(products[0].name.trim())) return [];
    return activeCandidates.filter(role => role.slug.startsWith('food-tour-')).map(role => role.id);
  }
  const permissions = await RoleModulePermission.findAll({
    where: { userTypeId: { [Op.in]: [...candidates, req.authContext!.userTypeId!] }, allowed: true, status: true }, transaction,
  });
  const own = new Set(permissions.filter(p => p.userTypeId === req.authContext!.userTypeId).map(p => `${p.moduleId}:${p.actionId}`));
  // The owner role carries special delegation authority, so a manager cannot
  // promote somebody to owner merely because its raw permission set is larger.
  return activeCandidates.filter(role => role.slug !== FOOD_TOUR_OWNER &&
    !permissions.some(p => p.userTypeId === role.id && !own.has(`${p.moduleId}:${p.actionId}`))).map(role => role.id);
}

async function directory(req: AuthenticatedRequest, res: Response, route: ScopedApiRoute, scope: number[]): Promise<void> {
  const roleIds = await manageableRoleIds(req, scope);
  if (req.method === 'GET') {
    const where: Record<string, unknown> = { userTypeId: { [Op.in]: roleIds } };
    if (route.id) where.id = route.id;
    if (req.path === '/active' || req.query.active === 'true') { where.status = true; where.approved = true; }
    const records = await User.findAll({ where, attributes: USER_FIELDS, order: [['firstName', 'ASC'], ['id', 'ASC']] });
    if (route.id && records.length === 0) throw new HttpError(404, 'User not found in your product scope');
    const data = records.map(record => pick(record, USER_FIELDS));
    if (req.query.format === 'compact') { res.json(data); return; }
    res.json([{ data: route.id ? data[0] : data, columns: columns(User, USER_FIELDS) }]); return;
  }
  const data = payloadFor(req.body, USER_WRITABLE);
  const creating = req.method === 'POST';
  for (const key of ['username', 'firstName', 'lastName', 'email']) {
    if (creating || data[key] !== undefined) {
      if (typeof data[key] !== 'string' || !(data[key] as string).trim() || (data[key] as string).length > 100) throw new HttpError(400, `${key} is required and must be at most 100 characters`);
      data[key] = (data[key] as string).trim();
    }
  }
  if (data.username !== undefined && String(data.username).length < 3) throw new HttpError(400, 'Username must have at least 3 characters');
  if (data.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.email))) throw new HttpError(400, 'A valid email is required');
  for (const key of ['status', 'approved', 'badgeRequired']) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new HttpError(400, `${key} must be a boolean`);
  }
  // Printing, payroll affiliation and external onboarding are not tenant-local.
  if (data.badgeRequired === true) throw new HttpError(400, 'Staff badges must be enabled by company administration');
  if (creating) {
    if (typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 72) throw new HttpError(400, 'Password must have between 8 and 72 characters');
    data.password = await bcrypt.hash(data.password, 10);
    data.badgeRequired = false;
    data.status ??= true;
    data.approved ??= true;
  } else if (data.password !== undefined) {
    throw new HttpError(403, 'Password resets are restricted to company administration');
  }
  const saved = await sequelize.transaction(async transaction => {
    // Role locks serialize against the global role-scope editor.
    const lockedRoles = await UserType.findAll({ where: { id: { [Op.in]: [...roleIds, req.authContext!.userTypeId!] } }, transaction, lock: transaction.LOCK.UPDATE, order: [['id', 'ASC']] });
    const currentScope = await getAllowedProductTypeIds(req, transaction);
    if (currentScope === null || currentScope.length !== scope.length || !currentScope.every(id => scope.includes(id))) throw new HttpError(409, 'Your product scope changed. Reload before retrying.');
    const eligible = new Set(await manageableRoleIds(req, scope, transaction));
    const target = creating ? null : await User.findByPk(route.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!creating && (!target || !eligible.has(target.userTypeId))) throw new HttpError(404, 'User not found in your product scope');
    const roleId = data.userTypeId === undefined ? target?.userTypeId : positiveId(data.userTypeId, 'userTypeId');
    if (!roleId || !eligible.has(roleId) || !lockedRoles.some(role => role.id === roleId && role.status)) throw new HttpError(403, 'The selected role is shared, unassigned or outside your delegated permissions');
    if (target?.id === req.authContext!.id && ['userTypeId', 'status', 'approved'].some(key => data[key] !== undefined && data[key] !== target.get(key))) {
      throw new HttpError(403, 'You cannot change your own role or approval status');
    }
    const { userTypeId: _roleId, ...profile } = data;
    const previous = target ? pick(target, USER_FIELDS) : null;
    const now = new Date();
    if (profile.approved === true && target?.approved !== true) { profile.approvedAt = now; profile.approvedBy = req.authContext!.id; }
    if (profile.approved === false && target?.approved === true) { profile.approvalRevokedAt = now; profile.approvalRevokedBy = req.authContext!.id; }
    if (profile.status === false && target?.status === true) { profile.deactivatedAt = now; profile.deactivatedBy = req.authContext!.id; }
    if (profile.status === true && target?.status === false) { profile.reactivatedAt = now; profile.reactivatedBy = req.authContext!.id; }
    const record = target
      ? await target.update({ ...profile, updatedBy: req.authContext!.id }, { transaction })
      : await User.create({ ...profile, userTypeId: roleId, createdBy: req.authContext!.id, updatedBy: req.authContext!.id }, { transaction });
    if (creating || roleId !== target?.userTypeId) await applyUserTypeChange({
      userId: record.id, userTypeId: roleId, actorId: req.authContext!.id,
      source: 'product_scoped_user_management', metadata: { initialization: creating }, transaction,
    });
    await record.reload({ transaction });
    await audit(req, creating ? 'user_created' : 'user_updated', 'user', record.id,
      { previous, next: pick(record, USER_FIELDS) }, transaction);
    return record;
  });
  res.status(creating ? 201 : 200).json([pick(saved, USER_FIELDS)]);
}

const CATALOG = {
  productPrices: { model: ProductPrice as ModelStatic<Model>, writable: ['productId', 'price', 'currencyCode', 'validFrom', 'validTo'] },
  productAddons: { model: ProductAddon as ModelStatic<Model>, writable: ['productId', 'addonId', 'maxPerAttendee', 'priceOverride', 'sortOrder', 'storefrontConfig'] },
};
async function catalog(req: AuthenticatedRequest, res: Response, route: ScopedApiRoute, scope: number[]): Promise<void> {
  const products = await Product.findAll({ where: { productTypeId: { [Op.in]: scope } }, attributes: ['id', 'name'] });
  const productIds = products.map(p => p.id);
  const spec = CATALOG[route.resource as keyof typeof CATALOG];
  const where = { productId: { [Op.in]: productIds }, ...(route.id ? { id: route.id } : {}) };
  if (req.method === 'GET') {
    const records = await spec.model.findAll({ where, order: [['id', 'ASC']] });
    const data = records.map(record => ({ ...record.get({ plain: true }), productName: products.find(p => p.id === record.get('productId'))?.name }));
    if (route.id && !data.length) throw new HttpError(404, 'Record not found in your product scope');
    res.json([{ data: route.id ? data[0] : data, columns: columns(spec.model) }]); return;
  }
  const creating = req.method === 'POST';
  const data = req.method === 'DELETE' ? {} : payloadFor(req.body, spec.writable);
  if (creating || data.productId !== undefined) {
    data.productId = positiveId(data.productId, 'productId');
    if (!productIds.includes(data.productId as number)) throw new HttpError(403, 'Product outside your assigned scope');
  }
  if (route.resource === 'productPrices' && req.method !== 'DELETE') {
    if (creating || data.price !== undefined) {
      if (!['string', 'number'].includes(typeof data.price) || !Number.isFinite(Number(data.price)) || Number(data.price) <= 0) throw new HttpError(400, 'Price must be positive');
      data.price = Number(data.price);
    }
    if (creating || data.currencyCode !== undefined) {
      if (typeof data.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(data.currencyCode)) throw new HttpError(400, 'A three-letter currency code is required');
    }
    if (creating || data.validFrom !== undefined) {
      if (typeof data.validFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.validFrom) || !Number.isFinite(Date.parse(data.validFrom))) throw new HttpError(400, 'A valid start date is required');
    }
    if (data.validTo === '') data.validTo = null;
    if (data.validTo != null && (typeof data.validTo !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.validTo) || !Number.isFinite(Date.parse(data.validTo)))) throw new HttpError(400, 'Invalid end date');
  }
  if (route.resource === 'productAddons' && req.method !== 'DELETE') {
    if (creating || data.addonId !== undefined) {
      data.addonId = positiveId(data.addonId, 'addonId');
      const link = await ProductAddon.findOne({ where: { productId: { [Op.in]: productIds }, addonId: data.addonId } });
      if (!link) throw new HttpError(403, 'Unassigned add-ons must be assigned by company administration first');
    }
    for (const key of ['maxPerAttendee', 'sortOrder', 'priceOverride']) {
      if (data[key] != null && (!Number.isFinite(Number(data[key])) || Number(data[key]) < (key === 'maxPerAttendee' ? 1 : 0))) throw new HttpError(400, `Invalid ${key}`);
    }
    if (data.storefrontConfig !== undefined && (!data.storefrontConfig || typeof data.storefrontConfig !== 'object' || Array.isArray(data.storefrontConfig))) throw new HttpError(400, 'storefrontConfig must be an object');
  }
  const saved = await sequelize.transaction(async transaction => {
    const targetProductId = data.productId;
    const record = creating ? null : await spec.model.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
    if (!creating && !record) throw new HttpError(404, 'Record not found in your product scope');
    const affectedIds = [...new Set([targetProductId, record?.get('productId')].filter((id): id is number => typeof id === 'number'))];
    const stillScoped = await Product.findAll({ where: { id: { [Op.in]: affectedIds }, productTypeId: { [Op.in]: scope } }, attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });
    if (stillScoped.length !== affectedIds.length) throw new HttpError(403, 'The product is no longer in your assigned scope');
    if (route.resource === 'productPrices' && req.method !== 'DELETE') {
      const from = data.validFrom ?? record?.get('validFrom');
      const to = data.validTo === undefined ? record?.get('validTo') : data.validTo;
      if (to != null && String(to) < String(from)) throw new HttpError(400, 'End date cannot be before start date');
    }
    if (req.method === 'DELETE') {
      await audit(req, 'catalog_deleted', route.resource, Number(record!.get('id')), { previous: record!.get({ plain: true }) }, transaction);
      await record!.destroy({ transaction }); return null;
    }
    const next = record ? await record.update(data, { transaction }) : await spec.model.create(data, { transaction });
    await audit(req, creating ? 'catalog_created' : 'catalog_updated', route.resource, Number(next.get('id')), { next: next.get({ plain: true }) }, transaction);
    return next;
  });
  if (!saved) { res.status(204).send(); return; }
  res.status(creating ? 201 : 200).json([saved]);
}

export async function handleProductScopedManagement(req: AuthenticatedRequest, res: Response, route: ScopedApiRoute, scope: number[]): Promise<void> {
  try {
    if (route.resource === 'home') {
      res.json({ preference: { viewMode: 'navigation', savedDashboardIds: [], activeDashboardId: null,
        quickActionVisibility: { 'home-planned-payments': false } } }); return;
    }
    if (route.resource === 'users') { await directory(req, res, route, scope); return; }
    if (route.resource === 'finance') {
      const { getFinanceReports } = await import('../finance/controllers/reportController.js');
      await getFinanceReports(req, res); return;
    }
    if (route.resource === 'userTypes') {
      if (req.method === 'POST') {
        const { createFoodTourUserType } = await import('./foodTourUserTypeController.js');
        res.status(201).json([await createFoodTourUserType(req, scope)]); return;
      }
      const ids = await manageableRoleIds(req, scope);
      if (route.id && !ids.includes(route.id)) throw new HttpError(404, 'Role not found in your product scope');
      const roles = await UserType.findAll({ where: { id: route.id ?? { [Op.in]: ids }, status: true }, attributes: ['id', 'name', 'slug'] });
      res.json([{ data: route.id ? roles[0] : roles, columns: columns(UserType, ['id', 'name', 'slug']) }]); return;
    }
    if (route.resource === 'productTypes') {
      const records = await ProductType.findAll({ where: { id: { [Op.in]: scope }, ...(route.id ? { id: route.id } : {}) } });
      if (route.id && !records.length) throw new HttpError(404, 'Product type not found in your scope');
      res.json([{ data: route.id ? records[0] : records, columns: columns(ProductType) }]); return;
    }
    if (route.resource === 'addons') {
      const products = await Product.findAll({ where: { productTypeId: { [Op.in]: scope } }, attributes: ['id'] });
      const links = await ProductAddon.findAll({ where: { productId: { [Op.in]: products.map(p => p.id) } }, attributes: ['addonId'] });
      const ids = links.map(link => link.addonId);
      if (route.id && !ids.includes(route.id)) throw new HttpError(404, 'Add-on not found in your product scope');
      const addons = await Addon.findAll({ where: { id: route.id ?? { [Op.in]: ids } } });
      res.json([{ data: route.id ? addons[0] : addons, columns: columns(Addon) }]); return;
    }
    await catalog(req, res, route, scope);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof UniqueConstraintError ? 409 : error instanceof ValidationError ? 400 : 500;
    const message = error instanceof HttpError ? error.message : status === 409 ? 'This record already exists' : status === 400 ? 'Invalid record values' : 'Unable to complete product-scoped management';
    res.status(status).json([{ message }]);
  }
}
