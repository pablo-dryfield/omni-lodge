import { Op } from 'sequelize';
import Action from '../models/Action.js';
import Page from '../models/Page.js';
import Module from '../models/Module.js';
import ModuleAction from '../models/ModuleAction.js';
import RolePagePermission from '../models/RolePagePermission.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const defaultActions = [
  { key: 'view', name: 'View', description: 'View records' },
  { key: 'create', name: 'Create', description: 'Create records' },
  { key: 'update', name: 'Update', description: 'Update records' },
  { key: 'delete', name: 'Delete', description: 'Delete records' },
];

const defaultRoles = [
  { slug: 'admin', name: 'Administrator', description: 'Full platform access', isDefault: false },
  { slug: 'owner', name: 'Owner', description: 'Business owner', isDefault: false },
  { slug: 'manager', name: 'Manager', description: 'Manage day-to-day operations', isDefault: false },
  { slug: 'assistant-manager', name: 'Assistant Manager', description: 'Assist managers with operations', isDefault: false },
  { slug: 'guide', name: 'Guide', description: 'Front line staff', isDefault: true },
];

const defaultPages = [
  { slug: 'dashboard', name: 'Dashboard', description: 'System overview', sortOrder: 1 },
  { slug: 'bookings', name: 'Bookings', description: 'Booking management', sortOrder: 2 },
  { slug: 'bookings-manifest', name: 'Bookings Manifest', description: 'Bookings manifest view', sortOrder: 3 },
  { slug: 'users', name: 'Users', description: 'User administration', sortOrder: 3 },
  { slug: 'reports', name: 'Reports', description: 'Analytics and reports', sortOrder: 4 },
  { slug: 'pays', name: 'Staff Payment', description: 'Staff commission overview', sortOrder: 5 },
];

const defaultModules = [
  { slug: 'dashboard-overview', name: 'Dashboard Overview', pageSlug: 'dashboard', description: 'Key platform metrics', componentRef: 'DashboardOverview', sortOrder: 1 },
  { slug: 'booking-management', name: 'Booking Management', pageSlug: 'bookings', description: 'Create and manage bookings', componentRef: 'BookingTable', sortOrder: 1 },
  { slug: 'booking-manifest', name: 'Booking Manifest', pageSlug: 'bookings-manifest', description: 'View manifest by pickup date', componentRef: 'BookingManifest', sortOrder: 1 },
  { slug: 'user-directory', name: 'User Directory', pageSlug: 'users', description: 'Manage platform users', componentRef: 'UserTable', sortOrder: 1 },
  { slug: 'reporting', name: 'Reporting', pageSlug: 'reports', description: 'Generate platform reports', componentRef: 'ReportBuilder', sortOrder: 1 },
  { slug: 'staff-payouts-all', name: 'Staff Payments (All)', pageSlug: 'pays', description: 'View commission data for all staff', componentRef: 'StaffPayoutsAll', sortOrder: 1 },
  { slug: 'staff-payouts-self', name: 'Staff Payments (Self)', pageSlug: 'pays', description: 'View personal commission data', componentRef: 'StaffPayoutsSelf', sortOrder: 2 },
];

const rolePageMatrix: Record<string, string[]> = {
  admin: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'pays'],
  owner: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'pays'],
  manager: ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
  'assistant-manager': ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
  staff: ['dashboard', 'bookings', 'pays'],
};

const roleModuleMatrix: Record<string, Record<string, string[]>> = {
  admin: {
    'dashboard-overview': ['view', 'update'],
    'booking-management': ['view', 'create', 'update', 'delete'],
    'booking-manifest': ['view'],
    'user-directory': ['view', 'create', 'update', 'delete'],
    reporting: ['view', 'create', 'update', 'delete'],
    'staff-payouts-all': ['view'],
  },
  owner: {
    'dashboard-overview': ['view', 'update'],
    'booking-management': ['view', 'create', 'update', 'delete'],
    'booking-manifest': ['view'],
    'user-directory': ['view', 'create', 'update', 'delete'],
    reporting: ['view', 'create', 'update', 'delete'],
    'staff-payouts-all': ['view'],
  },
  manager: {
    'dashboard-overview': ['view'],
    'booking-management': ['view', 'create', 'update'],
    reporting: ['view', 'create'],
    'staff-payouts-all': ['view'],
  },
  'assistant-manager': {
    'dashboard-overview': ['view'],
    'booking-management': ['view', 'create', 'update'],
    reporting: ['view'],
    'staff-payouts-all': ['view'],
  },
  guide: {
    'dashboard-overview': ['view'],
    'booking-management': ['view'],
    'staff-payouts-self': ['view'],
  },
};

export async function initializeAccessControl(): Promise<void> {
  const existingRoles = await UserType.findAll();
  await Promise.all(existingRoles.map(async role => {
    if (!role.slug || !role.slug.trim()) {
      role.slug = slugify(role.name || `role-${role.id}`);
      await role.save();
    }
  }));

  const roleMap = new Map<string, UserType>();
  for (const role of defaultRoles) {
    const [record] = await UserType.findOrCreate({
      where: { slug: role.slug },
      defaults: {
        name: role.name,
        description: role.description,
        isDefault: role.isDefault,
        status: true,
      },
    });
    roleMap.set(role.slug, record);
  }

  const actionMap = new Map<string, Action>();
  for (const action of defaultActions) {
    const [record] = await Action.findOrCreate({
      where: { key: action.key },
      defaults: {
        name: action.name,
        description: action.description,
        isAssignable: true,
        status: true,
      },
    });
    actionMap.set(action.key, record);
  }

  const pageMap = new Map<string, Page>();
  for (const page of defaultPages) {
    const [record] = await Page.findOrCreate({
      where: { slug: page.slug },
      defaults: {
        name: page.name,
        description: page.description,
        sortOrder: page.sortOrder,
        status: true,
      },
    });
    pageMap.set(page.slug, record);
  }

  const moduleMap = new Map<string, Module>();
  for (const module of defaultModules) {
    const page = pageMap.get(module.pageSlug);
    if (!page) {
      continue;
    }
    const [record] = await Module.findOrCreate({
      where: { slug: module.slug },
      defaults: {
        name: module.name,
        description: module.description,
        componentRef: module.componentRef,
        sortOrder: module.sortOrder,
        status: true,
        pageId: page.id,
      },
    });
    moduleMap.set(module.slug, record);
  }

  for (const [moduleSlug, record] of moduleMap.entries()) {
    for (const action of defaultActions) {
      const actionRecord = actionMap.get(action.key);
      if (!actionRecord) {
        continue;
      }
      await ModuleAction.findOrCreate({
        where: {
          moduleId: record.id,
          actionId: actionRecord.id,
        },
        defaults: {
          enabled: true,
        },
      });
    }
  }

  for (const [roleSlug, pages] of Object.entries(rolePageMatrix)) {
    const role = roleMap.get(roleSlug);
    if (!role) {
      continue;
    }

    const pageRecords = await Page.findAll({
      where: {
        slug: {
          [Op.in]: pages,
        },
      },
    });

    for (const page of pageRecords) {
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
  }

  for (const [roleSlug, moduleConfig] of Object.entries(roleModuleMatrix)) {
    const role = roleMap.get(roleSlug);
    if (!role) {
      continue;
    }

    for (const [moduleSlug, actions] of Object.entries(moduleConfig)) {
      const moduleRecord = moduleMap.get(moduleSlug);
      if (!moduleRecord) {
        continue;
      }

      for (const actionKey of actions) {
        const actionRecord = actionMap.get(actionKey);
        if (!actionRecord) {
          continue;
        }

        await RoleModulePermission.findOrCreate({
          where: {
            userTypeId: role.id,
            moduleId: moduleRecord.id,
            actionId: actionRecord.id,
          },
          defaults: {
            allowed: true,
            status: true,
          },
        });
      }
    }
  }

  const adminRole = roleMap.get('admin');
  if (adminRole) {
    const adminUser = await User.findByPk(1);
    if (adminUser && adminUser.userTypeId !== adminRole.id) {
      adminUser.userTypeId = adminRole.id;
      await adminUser.save();
    }
  }
}










