import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import UserTypeProductType from '../models/UserTypeProductType.js';
import Page from '../models/Page.js';
import Module from '../models/Module.js';
import Action from '../models/Action.js';
import ModuleAction from '../models/ModuleAction.js';
import RolePagePermission from '../models/RolePagePermission.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import AuditLog from '../models/AuditLog.js';
import { PRODUCT_SCOPED_PAGES } from '../services/productScopedApiPolicy.js';

export const SCOPED_OWNER_ACTIONS: Record<string, string[]> = {
  'booking-management': ['view', 'create', 'update'],
  'booking-manifest': ['view'],
  'user-directory': ['view', 'create', 'update'],
  'product-catalog': ['view', 'create', 'update', 'delete'],
  'product-price-management': ['view', 'create', 'update', 'delete'],
  'product-addon-management': ['view', 'create', 'update', 'delete'],
  'finance-reports': ['view'],
};

/** Explicit configuration, not a seed that silently promotes every role. */
export async function configureProductScopedOwner(roleId: number, actorId: number): Promise<Record<string, unknown>> {
  return sequelize.transaction(async transaction => {
    const actor = await User.findByPk(actorId, { transaction });
    const actorRole = actor ? await UserType.findByPk(actor.userTypeId, { transaction }) : null;
    if (!actor?.status || !actor.approved || !['owner', 'admin'].includes(actorRole?.slug ?? '') ||
      await UserTypeProductType.count({ where: { userTypeId: actor!.userTypeId }, transaction })) {
      throw new Error('Configuration requires an active, company-wide owner/admin actor');
    }
    const role = await UserType.findByPk(roleId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!role?.status || ['owner', 'admin', 'administrator'].includes(role.slug)) throw new Error('Select a separate product owner role, never a company-wide role');
    const scope = await UserTypeProductType.findAll({ where: { userTypeId: roleId }, transaction });
    if (!scope.length) throw new Error('Assign the role explicit product types before enabling delegated management');
    const pages = await Page.findAll({ where: { slug: { [Op.in]: [...PRODUCT_SCOPED_PAGES] }, status: true }, transaction });
    if (pages.length !== PRODUCT_SCOPED_PAGES.size) throw new Error('Missing navigation pages; access-control infrastructure must exist first');
    const modules = await Module.findAll({ where: { slug: { [Op.in]: Object.keys(SCOPED_OWNER_ACTIONS) }, status: true }, transaction });
    if (modules.length !== Object.keys(SCOPED_OWNER_ACTIONS).length) throw new Error('Missing scoped-management modules');
    const actions = await Action.findAll({ transaction });
    for (const page of pages) {
      const [record] = await RolePagePermission.findOrCreate({ where: { userTypeId: roleId, pageId: page.id },
        defaults: { userTypeId: roleId, pageId: page.id, canView: true, status: true, createdBy: actorId }, transaction });
      await record.update({ canView: true, status: true, updatedBy: actorId }, { transaction });
    }
    const grant = async (targetRoleId: number, moduleSlug: string, actionKey: string) => {
      const module = modules.find(m => m.slug === moduleSlug)!;
      const action = actions.find(a => a.key === actionKey);
      if (!action || !await ModuleAction.findOne({ where: { moduleId: module.id, actionId: action.id }, transaction })) throw new Error(`Unsupported module action ${moduleSlug}/${actionKey}`);
      const [record] = await RoleModulePermission.findOrCreate({ where: { userTypeId: targetRoleId, moduleId: module.id, actionId: action.id },
        defaults: { userTypeId: targetRoleId, moduleId: module.id, actionId: action.id, allowed: true, status: true, createdBy: actorId }, transaction });
      await record.update({ allowed: true, status: true, updatedBy: actorId }, { transaction });
    };
    for (const [module, keys] of Object.entries(SCOPED_OWNER_ACTIONS)) for (const key of keys) await grant(roleId, module, key);

    // A new, separate member role avoids changing any existing shared users.
    const memberSlug = `${role.slug}-member`;
    const [member, created] = await UserType.findOrCreate({ where: { slug: memberSlug },
      defaults: { slug: memberSlug, name: role.slug === 'food-tour-owner' ? 'Food Tour Guide' : `${role.name} — Team member`, status: true, isDefault: false, createdBy: actorId }, transaction });
    const memberScope = await UserTypeProductType.findAll({ where: { userTypeId: member.id }, transaction });
    const scopeIds = scope.map(link => link.productTypeId);
    if (!created && (!memberScope.length || memberScope.some(link => !scopeIds.includes(link.productTypeId)))) throw new Error('Existing member role is not exclusively assigned to this product scope');
    if (created) await UserTypeProductType.bulkCreate(scopeIds.map(productTypeId => ({ userTypeId: member.id, productTypeId })), { transaction });
    const bookingsPage = pages.find(page => page.slug === 'bookings')!;
    await RolePagePermission.findOrCreate({ where: { userTypeId: member.id, pageId: bookingsPage.id },
      defaults: { userTypeId: member.id, pageId: bookingsPage.id, canView: true, status: true, createdBy: actorId }, transaction });
    await grant(member.id, 'booking-management', 'view');
    const manifestPage = pages.find(page => page.slug === 'bookings-manifest')!;
    await RolePagePermission.findOrCreate({ where: { userTypeId: member.id, pageId: manifestPage.id },
      defaults: { userTypeId: member.id, pageId: manifestPage.id, canView: true, status: true, createdBy: actorId }, transaction });
    await grant(member.id, 'booking-manifest', 'view');
    const dashboardPage = pages.find(page => page.slug === 'dashboard')!;
    await RolePagePermission.findOrCreate({ where: { userTypeId: member.id, pageId: dashboardPage.id },
      defaults: { userTypeId: member.id, pageId: dashboardPage.id, canView: true, status: true, createdBy: actorId }, transaction });
    await AuditLog.create({ actorId, action: 'product_scope.owner_configured', entity: 'userType', entityId: String(roleId),
      metaJson: { roleSlug: role.slug, productTypeIds: scopeIds, memberRoleId: member.id, pages: [...PRODUCT_SCOPED_PAGES], actions: SCOPED_OWNER_ACTIONS } }, { transaction });
    return { roleId, roleSlug: role.slug, productTypeIds: scopeIds, memberRoleId: member.id };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const roleId = Number(process.argv.find(arg => arg.startsWith('--role-id='))?.split('=')[1]);
  const actorId = Number(process.argv.find(arg => arg.startsWith('--actor-id='))?.split('=')[1]);
  const host = String(sequelize.config.host ?? '').toLowerCase();
  if (!Number.isSafeInteger(roleId) || roleId <= 0 || !Number.isSafeInteger(actorId) || actorId <= 0 ||
    !['127.0.0.1', 'localhost', '::1'].includes(host) || process.env.NODE_ENV === 'production') {
    throw new Error('This helper is local-only. Supply --role-id=<id> --actor-id=<company-owner/admin-id>. Configure production through the approved release/administration workflow.');
  }
  configureProductScopedOwner(roleId, actorId).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error instanceof Error ? error.message : 'Configuration failed'); process.exitCode = 1; })
    .finally(() => sequelize.close());
}
