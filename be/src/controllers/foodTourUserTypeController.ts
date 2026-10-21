import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import UserType from '../models/UserType.js';
import UserTypeProductType from '../models/UserTypeProductType.js';
import Page from '../models/Page.js';
import Module from '../models/Module.js';
import RolePagePermission from '../models/RolePagePermission.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import AuditLog from '../models/AuditLog.js';
import HttpError from '../errors/HttpError.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';
import { isFoodTourOwner } from '../services/foodTourRolePolicy.js';
import { getAllowedProductTypeIds } from '../services/productScopeService.js';
import { PRODUCT_SCOPED_MODULES, PRODUCT_SCOPED_PAGES } from '../services/productScopedApiPolicy.js';
import { manageableRoleIds } from './productScopedManagementController.js';

const roleName = (value: unknown): { name: string; slug: string } => {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'A user type name is required.');
  const name = /^food tour(?:$|[ -])/i.test(value.trim()) ? value.trim() : `Food Tour ${value.trim()}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (name.length > 100 || !slug.startsWith('food-tour-') || slug.length > 100) throw new HttpError(400, 'Choose a Food Tour role name of at most 100 characters.');
  return { name, slug };
};
const validateDescription = (value: unknown): void => {
  if (value != null && (typeof value !== 'string' || value.length > 255)) throw new HttpError(400, 'Description must be at most 255 characters.');
};

/** Create a product-local role by cloning an already delegated role. Never
 * accept arbitrary permissions, global defaults, or an empty/global scope. */
export async function createFoodTourUserType(req: AuthenticatedRequest, scope: number[]): Promise<Record<string, unknown>> {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(key => !['name', 'description', 'sourceUserTypeId', 'productTypeIds'].includes(key))) {
    throw new HttpError(400, 'Only name, description and an existing Food Tour permission template can be configured.');
  }
  const { name, slug } = roleName(body.name);
  validateDescription(body.description);
  const sourceId = Number(body.sourceUserTypeId);
  if (!['string', 'number'].includes(typeof body.sourceUserTypeId) || !Number.isSafeInteger(sourceId) || sourceId <= 0) throw new HttpError(400, 'Select an existing Food Tour permission template.');
  if (body.productTypeIds !== undefined && (!Array.isArray(body.productTypeIds) || body.productTypeIds.length !== 1 || body.productTypeIds[0] !== scope[0])) {
    throw new HttpError(403, 'New user types must be restricted to Food Tour.');
  }
  return sequelize.transaction(async transaction => {
    const locked = await UserType.findAll({ where: { id: { [Op.in]: [req.authContext!.userTypeId!, sourceId] } },
      transaction, lock: transaction.LOCK.UPDATE, order: [['id', 'ASC']] });
    const currentScope = await getAllowedProductTypeIds(req, transaction);
    if (!currentScope || currentScope.length !== scope.length || !currentScope.every(id => scope.includes(id))) throw new HttpError(409, 'Your product scope changed. Reload before retrying.');
    if (!(await isFoodTourOwner(req, currentScope, transaction))) throw new HttpError(403, 'Only a Food Tour Owner can create Food Tour user types.');
    const allowed = await manageableRoleIds(req, currentScope, transaction);
    if (!allowed.includes(sourceId) || !locked.some(role => role.id === sourceId && role.status)) throw new HttpError(403, 'The permission template must be an active Food Tour-only user type.');
    const actorId = req.authContext!.id;
    const created = await UserType.create({ name, slug, description: body.description ?? null,
      isDefault: false, status: true, createdBy: actorId, updatedBy: actorId }, { transaction });
    await UserTypeProductType.bulkCreate(currentScope.map(productTypeId => ({ userTypeId: created.id, productTypeId })), { transaction });
    const [pages, modules] = await Promise.all([
      Page.findAll({ where: { slug: { [Op.in]: [...PRODUCT_SCOPED_PAGES] } }, attributes: ['id'], transaction }),
      Module.findAll({ where: { slug: { [Op.in]: [...PRODUCT_SCOPED_MODULES] } }, attributes: ['id'], transaction }),
    ]);
    const [pagePermissions, modulePermissions] = await Promise.all([
      RolePagePermission.findAll({ where: { userTypeId: sourceId, pageId: { [Op.in]: pages.map(p => p.id) }, canView: true, status: true }, transaction }),
      RoleModulePermission.findAll({ where: { userTypeId: sourceId, moduleId: { [Op.in]: modules.map(m => m.id) }, allowed: true, status: true }, transaction }),
    ]);
    await RolePagePermission.bulkCreate(pagePermissions.map(p => ({ userTypeId: created.id, pageId: p.pageId,
      canView: true, status: true, createdBy: actorId, updatedBy: actorId })), { transaction });
    await RoleModulePermission.bulkCreate(modulePermissions.map(p => ({ userTypeId: created.id, moduleId: p.moduleId,
      actionId: p.actionId, allowed: true, status: true, createdBy: actorId, updatedBy: actorId })), { transaction });
    await AuditLog.create({ actorId, action: 'product_scope.user_type_created', entity: 'userType', entityId: String(created.id),
      metaJson: { name, slug, productTypeIds: currentScope, sourceUserTypeId: sourceId,
        pagesCopied: pagePermissions.length, moduleActionsCopied: modulePermissions.length } }, { transaction });
    return { ...created.get({ plain: true }), productTypeIds: currentScope };
  });
}

/** Metadata only: preserve role identity, members, scopes and permissions. */
export async function updateFoodTourUserType(req: AuthenticatedRequest, scope: number[], id: number): Promise<Record<string, unknown>> {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
    Object.keys(body).some(key => !['name', 'description'].includes(key))) {
    throw new HttpError(400, 'Only the user type name and description can be edited.');
  }
  const changes: Record<string, unknown> = {};
  if (body.name !== undefined) changes.name = roleName(body.name).name;
  if (body.description !== undefined) { validateDescription(body.description); changes.description = body.description; }
  return sequelize.transaction(async transaction => {
    const locked = await UserType.findAll({ where: { id: { [Op.in]: [req.authContext!.userTypeId!, id] } },
      transaction, lock: transaction.LOCK.UPDATE, order: [['id', 'ASC']] });
    const currentScope = await getAllowedProductTypeIds(req, transaction);
    if (!currentScope || currentScope.length !== scope.length || !currentScope.every(type => scope.includes(type))) throw new HttpError(409, 'Your product scope changed. Reload before retrying.');
    if (!(await isFoodTourOwner(req, currentScope, transaction))) throw new HttpError(403, 'Only a Food Tour Owner can edit Food Tour user types.');
    const allowed = await manageableRoleIds(req, currentScope, transaction);
    const target = locked.find(role => role.id === id);
    if (!target || !allowed.includes(id)) throw new HttpError(404, 'User type not found in your Food Tour scope.');
    const previous = { name: target.name, description: target.description };
    await target.update({ ...changes, updatedBy: req.authContext!.id }, { transaction });
    await AuditLog.create({ actorId: req.authContext!.id, action: 'product_scope.user_type_updated', entity: 'userType', entityId: String(id),
      metaJson: { previous, next: { name: target.name, description: target.description }, productTypeIds: currentScope } }, { transaction });
    return { ...target.get({ plain: true }), productTypeIds: currentScope };
  });
}
