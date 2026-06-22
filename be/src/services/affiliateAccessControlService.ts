import Action from '../models/Action.js';
import Module from '../models/Module.js';
import Page from '../models/Page.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import RolePagePermission from '../models/RolePagePermission.js';
import UserType from '../models/UserType.js';

const AFFILIATE_ROLE = {
  slug: 'affiliate',
  name: 'Affiliate',
  description: 'Affiliate portal user',
};

const AFFILIATE_PAGE = {
  slug: 'affiliates',
  name: 'Affiliates',
  description: 'Affiliate booking portal',
  sortOrder: 8,
};

const AFFILIATE_MODULE = {
  slug: 'affiliate-overview',
  name: 'Affiliate Overview',
  description: 'Review affiliate-tagged booking performance',
  componentRef: 'AffiliatesPage',
  sortOrder: 1,
};

const getOrCreateAction = async (key: string, name: string, description: string) => {
  const [action] = await Action.findOrCreate({
    where: { key },
    defaults: {
      name,
      description,
      isAssignable: true,
      status: true,
    },
  });
  return action;
};

export const ensureAffiliateAccessControl = async (): Promise<void> => {
  const [affiliateRole] = await UserType.findOrCreate({
    where: { slug: AFFILIATE_ROLE.slug },
    defaults: {
      name: AFFILIATE_ROLE.name,
      description: AFFILIATE_ROLE.description,
      isDefault: false,
      status: true,
    },
  });

  const [page] = await Page.findOrCreate({
    where: { slug: AFFILIATE_PAGE.slug },
    defaults: {
      name: AFFILIATE_PAGE.name,
      description: AFFILIATE_PAGE.description,
      sortOrder: AFFILIATE_PAGE.sortOrder,
      status: true,
    },
  });

  const [module] = await Module.findOrCreate({
    where: { slug: AFFILIATE_MODULE.slug },
    defaults: {
      name: AFFILIATE_MODULE.name,
      description: AFFILIATE_MODULE.description,
      componentRef: AFFILIATE_MODULE.componentRef,
      sortOrder: AFFILIATE_MODULE.sortOrder,
      status: true,
      pageId: page.id,
    },
  });

  const viewAction = await getOrCreateAction('view', 'View', 'View records');
  const updateAction = await getOrCreateAction('update', 'Update', 'Update records');

  const allowedRoleSlugs = ['admin', 'administrator', 'owner', 'manager', 'affiliate'];
  const roles = await UserType.findAll({
    where: { slug: allowedRoleSlugs },
  });
  const roleMap = new Map(roles.map((role) => [role.slug, role]));
  roleMap.set(affiliateRole.slug, affiliateRole);

  for (const roleSlug of allowedRoleSlugs) {
    const role = roleMap.get(roleSlug);
    if (!role) {
      continue;
    }

    await RolePagePermission.findOrCreate({
      where: {
        userTypeId: role.id,
        pageId: page.id,
      },
      defaults: {
        canView: true,
        status: true,
      },
    });
  }

  const viewOnlyRoleSlugs = new Set(['affiliate']);
  for (const roleSlug of allowedRoleSlugs) {
    const role = roleMap.get(roleSlug);
    if (!role) {
      continue;
    }

    await RoleModulePermission.findOrCreate({
      where: {
        userTypeId: role.id,
        moduleId: module.id,
        actionId: viewAction.id,
      },
      defaults: {
        allowed: true,
        status: true,
      },
    });

    if (!viewOnlyRoleSlugs.has(roleSlug)) {
      await RoleModulePermission.findOrCreate({
        where: {
          userTypeId: role.id,
          moduleId: module.id,
          actionId: updateAction.id,
        },
        defaults: {
          allowed: true,
          status: true,
        },
      });
    }
  }
};
