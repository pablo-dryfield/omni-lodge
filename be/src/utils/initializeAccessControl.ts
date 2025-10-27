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
import PaymentMethod from '../models/PaymentMethod.js';

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
  { slug: 'venue-numbers', name: 'Venue Numbers', description: 'Nightly venue headcounts and open bar metrics', sortOrder: 5 },
  { slug: 'finance', name: 'Finance', description: 'Finance operations and reporting', sortOrder: 6 },
  { slug: 'pays', name: 'Staff Payment', description: 'Staff commission overview', sortOrder: 6 },
  { slug: 'settings-products', name: 'Products', description: 'Manage saleable products', sortOrder: 7 },
  { slug: 'settings-product-types', name: 'Product Types', description: 'Group products into categories', sortOrder: 8 },
  { slug: 'settings-product-prices', name: 'Product Prices', description: 'Schedule base product prices', sortOrder: 9 },
  { slug: 'settings-venues', name: 'Venues', description: 'Maintain the partner venue directory', sortOrder: 10 },
  { slug: 'settings-addons', name: 'Add-Ons', description: 'Manage catalog add-ons', sortOrder: 11 },
  { slug: 'settings-product-addons', name: 'Product Add-Ons', description: 'Map add-ons to products', sortOrder: 12 },
  { slug: 'settings-payment-methods', name: 'Payment Methods', description: 'Manage accepted payment methods', sortOrder: 13 },
  { slug: 'settings-channel-product-prices', name: 'Channel Product Prices', description: 'Override per-channel pricing', sortOrder: 14 },
  { slug: 'settings-channel-commissions', name: 'Channel Commissions', description: 'Track commission rates by channel', sortOrder: 15 },
  { slug: 'settings-actions', name: 'Actions', description: 'Manage access control actions', sortOrder: 16 },
  { slug: 'settings-channels', name: 'Channels', description: 'Manage booking channels and integrations', sortOrder: 17 },
];

const defaultModules = [
  { slug: 'dashboard-overview', name: 'Dashboard Overview', pageSlug: 'dashboard', description: 'Key platform metrics', componentRef: 'DashboardOverview', sortOrder: 1 },
  { slug: 'booking-management', name: 'Booking Management', pageSlug: 'bookings', description: 'Create and manage bookings', componentRef: 'BookingTable', sortOrder: 1 },
  { slug: 'booking-manifest', name: 'Booking Manifest', pageSlug: 'bookings-manifest', description: 'View manifest by pickup date', componentRef: 'BookingManifest', sortOrder: 1 },
  { slug: 'user-directory', name: 'User Directory', pageSlug: 'users', description: 'Manage platform users', componentRef: 'UserTable', sortOrder: 1 },
  { slug: 'reporting', name: 'Reporting', pageSlug: 'reports', description: 'Generate platform reports', componentRef: 'ReportBuilder', sortOrder: 1 },
  { slug: 'venue-numbers-management', name: 'Venue Numbers', pageSlug: 'venue-numbers', description: 'Capture nightly venue counts and upload signed sheets', componentRef: 'VenueNumbersList', sortOrder: 1 },
  { slug: 'staff-payouts-all', name: 'Staff Payments (All)', pageSlug: 'pays', description: 'View commission data for all staff', componentRef: 'StaffPayoutsAll', sortOrder: 1 },
  { slug: 'staff-payouts-self', name: 'Staff Payments (Self)', pageSlug: 'pays', description: 'View personal commission data', componentRef: 'StaffPayoutsSelf', sortOrder: 2 },
  { slug: 'finance-dashboard', name: 'Finance Dashboard', pageSlug: 'finance', description: 'Overview of finance KPIs', componentRef: 'FinanceDashboard', sortOrder: 1 },
  { slug: 'finance-transactions', name: 'Finance Transactions', pageSlug: 'finance', description: 'Manage finance transactions', componentRef: 'FinanceTransactions', sortOrder: 2 },
  { slug: 'finance-accounts', name: 'Finance Accounts', pageSlug: 'finance', description: 'Manage financial accounts', componentRef: 'FinanceAccounts', sortOrder: 3 },
  { slug: 'finance-categories', name: 'Finance Categories', pageSlug: 'finance', description: 'Maintain finance category taxonomy', componentRef: 'FinanceCategories', sortOrder: 4 },
  { slug: 'finance-vendors', name: 'Finance Vendors', pageSlug: 'finance', description: 'Manage vendor directory', componentRef: 'FinanceVendors', sortOrder: 5 },
  { slug: 'finance-clients', name: 'Finance Clients', pageSlug: 'finance', description: 'Manage client directory', componentRef: 'FinanceClients', sortOrder: 6 },
  { slug: 'finance-recurring', name: 'Finance Recurring Rules', pageSlug: 'finance', description: 'Automate recurring transactions', componentRef: 'FinanceRecurringRules', sortOrder: 7 },
  { slug: 'finance-budgets', name: 'Finance Budgets', pageSlug: 'finance', description: 'Maintain budgets by category', componentRef: 'FinanceBudgets', sortOrder: 8 },
  { slug: 'finance-management-requests', name: 'Finance Management Requests', pageSlug: 'finance', description: 'Review and approve finance management requests', componentRef: 'FinanceManagementRequests', sortOrder: 9 },
  { slug: 'finance-files', name: 'Finance Files', pageSlug: 'finance', description: 'Manage finance document uploads', componentRef: 'FinanceFiles', sortOrder: 10 },
  { slug: 'finance-reports', name: 'Finance Reports', pageSlug: 'finance', description: 'Finance reporting overview', componentRef: 'FinanceReports', sortOrder: 11 },
  { slug: 'product-catalog', name: 'Product Catalog', pageSlug: 'settings-products', description: 'Create and maintain products', componentRef: 'ProductCatalog', sortOrder: 1 },
  { slug: 'product-taxonomy', name: 'Product Types', pageSlug: 'settings-product-types', description: 'Define product categories and metadata', componentRef: 'ProductTypeManagement', sortOrder: 1 },
  { slug: 'product-price-management', name: 'Product Prices', pageSlug: 'settings-product-prices', description: 'Manage base price history', componentRef: 'ProductPriceManagement', sortOrder: 1 },
  { slug: 'venue-directory', name: 'Venue Directory', pageSlug: 'settings-venues', description: 'Maintain the partner venue directory', componentRef: 'VenueDirectory', sortOrder: 1 },
  { slug: 'addon-management', name: 'Add-On Management', pageSlug: 'settings-addons', description: 'Create and maintain add-ons', componentRef: 'AddonManagement', sortOrder: 1 },
  { slug: 'product-addon-management', name: 'Product Add-On Mapping', pageSlug: 'settings-product-addons', description: 'Assign add-ons to products', componentRef: 'ProductAddonManagement', sortOrder: 1 },
  { slug: 'payment-method-management', name: 'Payment Method Management', pageSlug: 'settings-payment-methods', description: 'Manage accepted payment methods', componentRef: 'PaymentMethodManagement', sortOrder: 1 },
  { slug: 'channel-product-price-management', name: 'Channel Product Prices', pageSlug: 'settings-channel-product-prices', description: 'Override per-channel pricing', componentRef: 'ChannelProductPriceManagement', sortOrder: 1 },
  { slug: 'channel-commission-management', name: 'Channel Commissions', pageSlug: 'settings-channel-commissions', description: 'Maintain commission agreements', componentRef: 'ChannelCommissionManagement', sortOrder: 1 },
  { slug: 'channel-console', name: 'Channel Console', pageSlug: 'settings-channels', description: 'Manage booking channels and integrations', componentRef: 'ChannelConsole', sortOrder: 1 },
  { slug: 'action-registry', name: 'Action Registry', pageSlug: 'settings-actions', description: 'Maintain action catalog', componentRef: 'ActionRegistry', sortOrder: 1 },
];

const rolePageMatrix: Record<string, string[]> = {
  admin: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'venue-numbers', 'finance', 'pays', 'settings-products', 'settings-product-types', 'settings-product-prices', 'settings-venues', 'settings-addons', 'settings-product-addons', 'settings-payment-methods', 'settings-channel-product-prices', 'settings-channel-commissions', 'settings-actions', 'settings-channels', 'settings',
'settings-users',
'settings-user-types',
'settings-pages',
'settings-modules',
'settings-permissions',
'settings-permissions-pages',
'settings-permissions-modules'],
  owner: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'venue-numbers', 'finance', 'pays'],
  manager: ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'venue-numbers', 'finance', 'pays'],
  'assistant-manager': ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'venue-numbers', 'finance', 'pays'],
  guide: ['dashboard', 'bookings', 'bookings-manifest', 'venue-numbers', 'pays'],
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
    'venue-numbers-management': ['view', 'create', 'update', 'delete'],
    'staff-payouts-all': ['view'],
    'finance-dashboard': ['view', 'create', 'update', 'delete'],
    'finance-transactions': ['view', 'create', 'update', 'delete'],
    'finance-accounts': ['view', 'create', 'update', 'delete'],
    'finance-categories': ['view', 'create', 'update', 'delete'],
    'finance-vendors': ['view', 'create', 'update', 'delete'],
    'finance-clients': ['view', 'create', 'update', 'delete'],
    'finance-recurring': ['view', 'create', 'update', 'delete'],
    'finance-budgets': ['view', 'create', 'update', 'delete'],
    'finance-management-requests': ['view', 'create', 'update', 'delete'],
    'finance-files': ['view', 'create', 'update', 'delete'],
    'finance-reports': ['view', 'create', 'update', 'delete'],
    'venue-directory': ['view', 'create', 'update', 'delete'],
    'product-catalog': ['view', 'create', 'update', 'delete'],
    'product-taxonomy': ['view', 'create', 'update', 'delete'],
    'product-price-management': ['view', 'create', 'update', 'delete'],
    'addon-management': ['view', 'create', 'update', 'delete'],
    'payment-method-management': ['view', 'create', 'update', 'delete'],
    'action-registry': ['view', 'create', 'update', 'delete'],
    'product-addon-management': ['view', 'create', 'update', 'delete'],
    'channel-product-price-management': ['view', 'create', 'update', 'delete'],
    'channel-commission-management': ['view', 'create', 'update', 'delete'],
    'channel-console': ['view', 'create', 'update', 'delete'],
  },
  owner: {
    'dashboard-overview': ['view', 'update'],
    'booking-management': ['view', 'create', 'update', 'delete'],
    'booking-manifest': ['view'],
    'user-directory': ['view', 'create', 'update', 'delete'],
    reporting: ['view', 'create', 'update', 'delete'],
    'venue-numbers-management': ['view', 'create', 'update'],
    'staff-payouts-all': ['view'],
    'finance-dashboard': ['view', 'create', 'update', 'delete'],
    'finance-transactions': ['view', 'create', 'update', 'delete'],
    'finance-accounts': ['view', 'create', 'update', 'delete'],
    'finance-categories': ['view', 'create', 'update', 'delete'],
    'finance-vendors': ['view', 'create', 'update', 'delete'],
    'finance-clients': ['view', 'create', 'update', 'delete'],
    'finance-recurring': ['view', 'create', 'update', 'delete'],
    'finance-budgets': ['view', 'create', 'update', 'delete'],
    'finance-management-requests': ['view', 'create', 'update', 'delete'],
    'finance-files': ['view', 'create', 'update', 'delete'],
    'finance-reports': ['view', 'create', 'update', 'delete'],
  },
  manager: {
    'dashboard-overview': ['view'],
    'booking-management': ['view', 'create', 'update'],
    'booking-manifest': ['view'],
    reporting: ['view', 'create'],
    'venue-numbers-management': ['view', 'create', 'update'],
    'staff-payouts-all': ['view'],
    'finance-dashboard': ['view', 'create', 'update', 'delete'],
    'finance-transactions': ['view', 'create', 'update', 'delete'],
    'finance-accounts': ['view', 'create', 'update', 'delete'],
    'finance-categories': ['view', 'create', 'update', 'delete'],
    'finance-vendors': ['view', 'create', 'update', 'delete'],
    'finance-clients': ['view', 'create', 'update', 'delete'],
    'finance-recurring': ['view', 'create', 'update', 'delete'],
    'finance-budgets': ['view', 'create', 'update', 'delete'],
    'finance-management-requests': ['view', 'create', 'update', 'delete'],
    'finance-files': ['view', 'create', 'update', 'delete'],
    'finance-reports': ['view', 'create', 'update', 'delete'],
  },
  'assistant-manager': {
    'dashboard-overview': ['view'],
    'booking-management': ['view', 'create', 'update'],
    'booking-manifest': ['view'],
    reporting: ['view'],
    'venue-numbers-management': ['view', 'create', 'update'],
    'staff-payouts-all': ['view'],
    'finance-dashboard': ['view', 'create', 'update', 'delete'],
    'finance-transactions': ['view', 'create', 'update', 'delete'],
    'finance-accounts': ['view', 'create', 'update', 'delete'],
    'finance-categories': ['view', 'create', 'update', 'delete'],
    'finance-vendors': ['view', 'create', 'update', 'delete'],
    'finance-clients': ['view', 'create', 'update', 'delete'],
    'finance-recurring': ['view', 'create', 'update', 'delete'],
    'finance-budgets': ['view', 'create', 'update', 'delete'],
    'finance-management-requests': ['view', 'create', 'update', 'delete'],
    'finance-files': ['view', 'create', 'update', 'delete'],
    'finance-reports': ['view', 'create', 'update', 'delete'],
  },
  guide: {
    'dashboard-overview': ['view'],
    'booking-management': ['view'],
    'booking-manifest': ['view'],
    'venue-numbers-management': ['view', 'create', 'update'],
    'staff-payouts-self': ['view'],
  },
};

export const PAYMENT_METHOD_SEED = [
  { name: 'Online/Card', description: 'Online or card-based payments' },
  { name: 'Bank Transfer', description: 'Payments received via bank transfer' },
  { name: 'Transfer', description: 'Third-party transfer payments' },
  { name: 'Cash', description: 'Payments collected in cash' },
];

export const CHANNEL_PAYMENT_METHOD_OVERRIDES: Record<string, string> = {
  email: 'Bank Transfer',
  xperiencepoland: 'Transfer',
  'walk-in': 'Cash',
  topdeck: 'Cash',
  'hostel atlantis': 'Cash',
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
    const paymentMethodMap = new Map<string, PaymentMethod>();
    for (const method of PAYMENT_METHOD_SEED) {
      const [record] = await PaymentMethod.findOrCreate({
        where: { name: method.name },
        defaults: {
          description: method.description,
        },
        transaction,
      });
      paymentMethodMap.set(record.name.toLowerCase(), record);
    }

    const defaultPaymentMethod = paymentMethodMap.get('online/card');
    if (!defaultPaymentMethod) {
      throw new Error('Default payment method "Online/Card" is required but could not be created.');
    }

    for (const channelSeed of CHANNEL_SEEDS) {
      const apiKey = channelSeed.name.replace(/\s+/g, '-').toLowerCase();
      const apiSecret = `${apiKey}-secret`;
      const channelNameKey = channelSeed.name.trim().toLowerCase();
      const overrideName = CHANNEL_PAYMENT_METHOD_OVERRIDES[channelNameKey];
      const overridePaymentMethod = overrideName ? paymentMethodMap.get(overrideName.toLowerCase()) : undefined;
      const targetPaymentMethod = overridePaymentMethod ?? defaultPaymentMethod;
      const paymentMethodId = targetPaymentMethod.id;

      const [channel, created] = await Channel.findOrCreate({
        where: { name: channelSeed.name },
        defaults: {
          description: channelSeed.description,
          apiKey,
          apiSecret,
          createdBy: 1,
          updatedBy: 1,
          paymentMethodId,
        },
        transaction,
      });

      if (!created) {
        let needsUpdate = false;
        if (channel.paymentMethodId !== paymentMethodId) {
          channel.paymentMethodId = paymentMethodId;
          needsUpdate = true;
        }
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

  await resetSequence('pages');
  await resetSequence('actions');
  await resetSequence('modules');
  await resetSequence('moduleActions');
  await resetSequence('rolePagePermissions');
  await resetSequence('roleModulePermissions');

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










async function resetSequence(tableName: string, columnName = 'id', transaction?: Transaction): Promise<void> {
  const escapedTable = `"${tableName.replace(/"/g, '""')}"`;
  const escapedColumn = `"${columnName.replace(/"/g, '""')}"`;
  const sequenceSql = `
    SELECT setval(
      pg_get_serial_sequence('${escapedTable}', '${columnName}'),
      COALESCE((SELECT MAX(${escapedColumn}) FROM ${escapedTable}), 0) + 1,
      false
    );
  `;
  await sequelize.query(sequenceSql, { transaction });
}
