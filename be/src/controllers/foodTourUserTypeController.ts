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

/** Create a product-local role by cloning an already delegated role. Never
 * accept arbitrary permissions, global defaults, or an empty/global scope. */
export async function createFoodTourUserType(req: AuthenticatedRequest, scope: number[]): Promise<Record<string, unknown>> {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(key => !['name', 'description', 'sourceUserTypeId', 'productTypeIds'].includes(key))) {
    throw new HttpError(400, 'Only name, description and an existing Food Tour permission template can be configured.');
  }
  if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'A user type name is required.');
  const name = /^food tour(?:$|[ -])/i.test(body.name.trim()) ? body.name.trim() : `Food Tour ${body.name.trim()}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (name.length > 100 || !slug.startsWith('food-tour-') || slug.length > 100) throw new HttpError(400, 'Choose a Food Tour role name of at most 100 characters.');
  if (body.description != null && (typeof body.description !== 'string' || body.description.length > 255)) throw new HttpError(400, 'Description must be at most 255 characters.');
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
