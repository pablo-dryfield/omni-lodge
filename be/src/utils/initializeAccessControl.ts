import { Op, Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import Action from '../models/Action.js';
import Page from '../models/Page.js';
import Module from '../models/Module.js';
import ModuleAction from '../models/ModuleAction.js';
import RolePagePermission from '../models/RolePagePermission.js';
import RoleModulePermission from '../models/RoleModulePermission.js';
import User from '../models/User.js';
import UserType from '../models/UserType.js';
import Channel from '../models/Channel.js';
import Addon from '../models/Addon.js';
import Product from '../models/Product.js';
import ProductAddon from '../models/ProductAddon.js';

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
  admin: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'pays', 'settings',
'settings-users',
'settings-user-types',
'settings-pages',
'settings-modules',
'settings-permissions',
'settings-permissions-pages',
'settings-permissions-modules'],
  owner: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'pays'],
  manager: ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
  'assistant-manager': ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
  guide: ['dashboard', 'bookings', 'bookings-manifest', 'pays'],
};

const roleModuleMatrix: Record<string, Record<string, string[]>> = {
  admin: {
    'dashboard-overview': ['view', 'update'],
    'booking-management': ['view', 'create', 'update', 'delete'],
    'booking-manifest': ['view'],
    'user-directory': ['view', 'create', 'update', 'delete'],
'settings-home': ['view', 'create', 'update', 'delete'],
'settings-users-admin': ['view', 'create', 'update', 'delete'],
'settings-user-types-admin': ['view', 'create', 'update', 'delete'],
'settings-pages-admin': ['view', 'create', 'update', 'delete'],
'settings-modules-admin': ['view', 'create', 'update', 'delete'],
'settings-permissions-overview': ['view', 'create', 'update', 'delete'],
'settings-page-permissions': ['view', 'create', 'update', 'delete'],
'settings-module-permissions': ['view', 'create', 'update', 'delete'],
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
    'booking-manifest': ['view'],
    reporting: ['view', 'create'],
    'staff-payouts-all': ['view'],
  },
  'assistant-manager': {
    'dashboard-overview': ['view'],
    'booking-management': ['view', 'create', 'update'],
    'booking-manifest': ['view'],
    reporting: ['view'],
    'staff-payouts-all': ['view'],
  },
  guide: {
    'dashboard-overview': ['view'],
    'booking-management': ['view'],
    'booking-manifest': ['view'],
    'staff-payouts-self': ['view'],
  },
};

const CHANNEL_SEEDS = [
  { name: 'Fareharbor', description: 'Fareharbor bookings' },
  { name: 'Viator', description: 'Viator bookings' },
  { name: 'GetYourGuide', description: 'GetYourGuide bookings' },
  { name: 'FreeTour', description: 'FreeTour bookings' },
  { name: 'Walk-In', description: 'Walk-in guests' },
  { name: 'Ecwid', description: 'Ecwid online store' },
  { name: 'Email', description: 'Email reservations' },
  { name: 'Hostel Atlantis', description: 'Hostel Atlantis partners' },
  { name: 'XperiencePoland', description: 'XperiencePoland partners' },
  { name: 'TopDeck', description: 'TopDeck partners' },
];

const ADDON_SEEDS = [
  { name: 'Cocktails' },
  { name: 'T-Shirts' },
  { name: 'Photos' },
];

const PRODUCT_NAME = 'Pub Crawl';

const PRODUCT_ADDON_SEEDS = [
  { addonName: 'Cocktails', maxPerAttendee: 1, sortOrder: 0 },
  { addonName: 'T-Shirts', maxPerAttendee: null, sortOrder: 1 },
  { addonName: 'Photos', maxPerAttendee: null, sortOrder: 2 },
];

async function seedPubCrawlCatalog(): Promise<void> {
  await sequelize.transaction(async (transaction: Transaction) => {
    for (const channelSeed of CHANNEL_SEEDS) {
      const apiKey = channelSeed.name.replace(/\s+/g, '-').toLowerCase();
      const apiSecret = `${apiKey}-secret`;
      const [channel, created] = await Channel.findOrCreate({
        where: { name: channelSeed.name },
        defaults: {
          description: channelSeed.description,
          apiKey,
          apiSecret,
          createdBy: 1,
          updatedBy: 1,
        },
        transaction,
      });

      if (!created) {
        let needsUpdate = false;
        if (channel.description !== channelSeed.description) {
          channel.description = channelSeed.description;
          needsUpdate = true;
        }
        if (channel.apiKey !== apiKey) {
          channel.apiKey = apiKey;
          needsUpdate = true;
        }
        if (channel.apiSecret !== apiSecret) {
          channel.apiSecret = apiSecret;
          needsUpdate = true;
        }
        if (channel.updatedBy !== 1) {
          channel.updatedBy = 1;
          needsUpdate = true;
        }
        if (needsUpdate) {
          await channel.save({ transaction });
        }
      }
    }

    const addonMap = new Map<string, Addon>();

    for (const addonSeed of ADDON_SEEDS) {
      const [addon] = await Addon.findOrCreate({
        where: { name: addonSeed.name },
        defaults: {
          basePrice: null,
          taxRate: null,
          isActive: true,
        },
        transaction,
      });

      let addonNeedsUpdate = false;
      if (!addon.isActive) {
        addon.isActive = true;
        addonNeedsUpdate = true;
      }
      if (addon.name !== addonSeed.name) {
        addon.name = addonSeed.name;
        addonNeedsUpdate = true;
      }
      if (addonNeedsUpdate) {
        await addon.save({ transaction });
      }
      addonMap.set(addonSeed.name, addon);
    }

    const referenceProduct = await Product.findOne({ order: [['id', 'ASC']], transaction });
    const productTypeId = referenceProduct?.productTypeId ?? 1;
    const createdBy = referenceProduct?.createdBy ?? 1;

    await Product.update(
      { status: false },
      { where: { name: { [Op.ne]: PRODUCT_NAME } }, transaction },
    );

    const [product] = await Product.findOrCreate({
      where: { name: PRODUCT_NAME },
      defaults: {
        productTypeId,
        price: 0,
        status: true,
        createdBy,
        updatedBy: createdBy,
      },
      transaction,
    });

    let productNeedsUpdate = false;
    if (product.productTypeId == null) {
      product.productTypeId = productTypeId;
      productNeedsUpdate = true;
    }
    if (product.price !== 0) {
      product.price = 0;
      productNeedsUpdate = true;
    }
    if (!product.status) {
      product.status = true;
      productNeedsUpdate = true;
    }
    if (!product.createdBy) {
      product.createdBy = createdBy;
      productNeedsUpdate = true;
    }
    if (product.updatedBy !== createdBy) {
      product.updatedBy = createdBy;
      productNeedsUpdate = true;
    }
    if (productNeedsUpdate) {
      await product.save({ transaction });
    }

    await ProductAddon.destroy({ where: { productId: product.id }, transaction });

    for (const entry of PRODUCT_ADDON_SEEDS) {
      const addon = addonMap.get(entry.addonName);
      if (!addon) {
        continue;
      }
      await ProductAddon.create(
        {
          productId: product.id,
          addonId: addon.id,
          maxPerAttendee: entry.maxPerAttendee,
          priceOverride: null,
          sortOrder: entry.sortOrder,
        },
        { transaction },
      );
    }
  });
}

export async function initializeAccessControl(): Promise<void> {
  await seedPubCrawlCatalog();

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










