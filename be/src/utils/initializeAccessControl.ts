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
import { hasSeedRun, recordSeedRun, runSeedOnce } from '../services/seedRunService.js';

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const defaultActions = [
  { key: 'view', name: 'View', description: 'View records' },
  { key: 'create', name: 'Create', description: 'Create records' },
  { key: 'update', name: 'Update', description: 'Update records' },
  { key: 'delete', name: 'Delete', description: 'Delete records' },
];

const defaultRoles = [
  { slug: 'admin', name: 'Administrator', description: 'Full platform access', isDefault: false },
  { slug: 'administrator', name: 'Administrator (Legacy)', description: 'Alias for full platform access', isDefault: false },
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
  { slug: 'channel-numbers', name: 'Channel Numbers', description: 'Channel performance summary across products and add-ons', sortOrder: 6 },
  { slug: 'reviews', name: 'Reviews', description: 'Track review credits and staff allocations', sortOrder: 7 },
  { slug: 'pays', name: 'Staff Payment', description: 'Staff commission overview', sortOrder: 8 },
  { slug: 'scheduling', name: 'Scheduling', description: 'Manage weekly staff scheduling', sortOrder: 9 },
  { slug: 'finance', name: 'Finance', description: 'Finance operations and reporting', sortOrder: 10 },
  { slug: 'settings-products', name: 'Products', description: 'Manage saleable products', sortOrder: 7 },
  { slug: 'settings-product-aliases', name: 'Product Aliases', description: 'Map booking labels to products', sortOrder: 7 },
  { slug: 'settings-product-types', name: 'Product Types', description: 'Group products into categories', sortOrder: 8 },
  { slug: 'settings-product-prices', name: 'Product Prices', description: 'Schedule base product prices', sortOrder: 9 },
  { slug: 'settings-venues', name: 'Venues', description: 'Maintain the partner venue directory', sortOrder: 10 },
  { slug: 'settings-addons', name: 'Add-Ons', description: 'Manage catalog add-ons', sortOrder: 11 },
  { slug: 'settings-product-addons', name: 'Product Add-Ons', description: 'Map add-ons to products', sortOrder: 12 },
  { slug: 'settings-payment-methods', name: 'Payment Methods', description: 'Manage accepted payment methods', sortOrder: 13 },
  { slug: 'settings-channel-product-prices', name: 'Channel Product Prices', description: 'Override per-channel pricing', sortOrder: 14 },
  { slug: 'settings-channel-commissions', name: 'Channel Commissions', description: 'Track commission rates by channel', sortOrder: 15 },
  { slug: 'settings-review-platforms', name: 'Review Platforms', description: 'Configure review platforms and metadata', sortOrder: 16 },
  { slug: 'assistant-manager-tasks', name: 'Assistant Manager Tasks', description: 'Configure AM task templates and planner defaults', sortOrder: 11 },
  { slug: 'settings-compensation-components', name: 'Compensation Components', description: 'Manage compensation component definitions and assignments', sortOrder: 17 },
  { slug: 'settings-actions', name: 'Actions', description: 'Manage access control actions', sortOrder: 17 },
  { slug: 'settings-channels', name: 'Channels', description: 'Manage booking channels and integrations', sortOrder: 18 },
  { slug: 'settings-staff-profiles', name: 'Staff Profiles', description: 'Maintain staff profile metadata', sortOrder: 19 },
  { slug: 'settings-shift-roles', name: 'Shift Roles', description: 'Manage scheduling shift role definitions', sortOrder: 20 },
  { slug: 'settings-user-shift-roles', name: 'User Shift Roles', description: 'Assign shift roles to users', sortOrder: 21 },
  { slug: 'settings-shift-types', name: 'Shift Types', description: 'Map shift types to products', sortOrder: 22 },
  { slug: 'settings-db-backups', name: 'Database Backups', description: 'Review and manage PostgreSQL backups', sortOrder: 23 },
  { slug: 'settings-home-experience', name: 'Home Experience', description: 'Assign default home modules per user', sortOrder: 24 },
  { slug: 'settings-control-panel', name: 'Control Panel', description: 'Manage dynamic configuration values', sortOrder: 25 },
  { slug: 'settings-maintenance', name: 'Maintenance', description: 'Review seeds, migrations, and configuration health', sortOrder: 26 },
];

const defaultModules = [
  { slug: 'dashboard-overview', name: 'Dashboard Overview', pageSlug: 'dashboard', description: 'Key platform metrics', componentRef: 'DashboardOverview', sortOrder: 1 },
  { slug: 'booking-management', name: 'Booking Management', pageSlug: 'bookings', description: 'Create and manage bookings', componentRef: 'BookingTable', sortOrder: 1 },
  { slug: 'booking-manifest', name: 'Booking Manifest', pageSlug: 'bookings-manifest', description: 'View manifest by pickup date', componentRef: 'BookingManifest', sortOrder: 1 },
  { slug: 'user-directory', name: 'User Directory', pageSlug: 'users', description: 'Manage platform users', componentRef: 'UserTable', sortOrder: 1 },
  { slug: 'reporting', name: 'Reporting', pageSlug: 'reports', description: 'Generate platform reports', componentRef: 'ReportBuilder', sortOrder: 1 },
  { slug: 'venue-numbers-management', name: 'Venue Numbers', pageSlug: 'venue-numbers', description: 'Capture nightly venue counts and upload signed sheets', componentRef: 'VenueNumbersList', sortOrder: 1 },
  { slug: 'channel-numbers-summary', name: 'Channel Numbers Summary', pageSlug: 'channel-numbers', description: 'Analyze booking channels across tickets and add-ons', componentRef: 'ChannelNumbersSummary', sortOrder: 1 },
  { slug: 'staff-payouts-all', name: 'Staff Payments (All)', pageSlug: 'pays', description: 'View commission data for all staff', componentRef: 'StaffPayoutsAll', sortOrder: 1 },
  { slug: 'staff-payouts-self', name: 'Staff Payments (Self)', pageSlug: 'pays', description: 'View personal commission data', componentRef: 'StaffPayoutsSelf', sortOrder: 2 },
  { slug: 'scheduling-availability', name: 'Scheduling Availability', pageSlug: 'scheduling', description: 'Submit availability for upcoming weeks', componentRef: 'SchedulingAvailability', sortOrder: 1 },
  { slug: 'scheduling-builder', name: 'Scheduling Builder', pageSlug: 'scheduling', description: 'Configure weekly schedules and assignments', componentRef: 'SchedulingBuilder', sortOrder: 2 },
  { slug: 'scheduling-my-shifts', name: 'Scheduling My Shifts', pageSlug: 'scheduling', description: 'Review personal shift assignments', componentRef: 'SchedulingMyShifts', sortOrder: 3 },
  { slug: 'scheduling-swaps', name: 'Scheduling Swaps', pageSlug: 'scheduling', description: 'Manage shift swap requests', componentRef: 'SchedulingSwaps', sortOrder: 4 },
  { slug: 'scheduling-history', name: 'Scheduling History', pageSlug: 'scheduling', description: 'View scheduling exports and history', componentRef: 'SchedulingHistory', sortOrder: 5 },
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
  { slug: 'product-alias-management', name: 'Product Aliases', pageSlug: 'settings-product-aliases', description: 'Map booking labels to products', componentRef: 'ProductAliasManagement', sortOrder: 1 },
  { slug: 'product-taxonomy', name: 'Product Types', pageSlug: 'settings-product-types', description: 'Define product categories and metadata', componentRef: 'ProductTypeManagement', sortOrder: 1 },
  { slug: 'product-price-management', name: 'Product Prices', pageSlug: 'settings-product-prices', description: 'Manage base price history', componentRef: 'ProductPriceManagement', sortOrder: 1 },
  { slug: 'venue-directory', name: 'Venue Directory', pageSlug: 'settings-venues', description: 'Maintain the partner venue directory', componentRef: 'VenueDirectory', sortOrder: 1 },
  { slug: 'addon-management', name: 'Add-On Management', pageSlug: 'settings-addons', description: 'Create and maintain add-ons', componentRef: 'AddonManagement', sortOrder: 1 },
  { slug: 'product-addon-management', name: 'Product Add-On Mapping', pageSlug: 'settings-product-addons', description: 'Assign add-ons to products', componentRef: 'ProductAddonManagement', sortOrder: 1 },
  { slug: 'payment-method-management', name: 'Payment Method Management', pageSlug: 'settings-payment-methods', description: 'Manage accepted payment methods', componentRef: 'PaymentMethodManagement', sortOrder: 1 },
  { slug: 'channel-product-price-management', name: 'Channel Product Prices', pageSlug: 'settings-channel-product-prices', description: 'Override per-channel pricing', componentRef: 'ChannelProductPriceManagement', sortOrder: 1 },
  { slug: 'channel-commission-management', name: 'Channel Commissions', pageSlug: 'settings-channel-commissions', description: 'Maintain commission agreements', componentRef: 'ChannelCommissionManagement', sortOrder: 1 },
  { slug: 'review-platform-management', name: 'Review Platforms', pageSlug: 'settings-review-platforms', description: 'Maintain review platforms', componentRef: 'ReviewPlatformManagement', sortOrder: 1 },
  { slug: 'compensation-component-management', name: 'Compensation Components', pageSlug: 'settings-compensation-components', description: 'Manage compensation component definitions and assignments', componentRef: 'CompensationComponentManagement', sortOrder: 1 },
  { slug: 'review-counter-management', name: 'Review Counters', pageSlug: 'reviews', description: 'Maintain platform review credit tracking', componentRef: 'ReviewCounterManagement', sortOrder: 1 },
  { slug: 'am-task-management', name: 'Assistant Manager Tasks', pageSlug: 'assistant-manager-tasks', description: 'Configure assistant manager task templates and assignments', componentRef: 'AssistantManagerTaskManagement', sortOrder: 1 },
  { slug: 'channel-console', name: 'Channel Console', pageSlug: 'settings-channels', description: 'Manage booking channels and integrations', componentRef: 'ChannelConsole', sortOrder: 1 },
  { slug: 'action-registry', name: 'Action Registry', pageSlug: 'settings-actions', description: 'Maintain action catalog', componentRef: 'ActionRegistry', sortOrder: 1 },
  { slug: 'staff-profile-directory', name: 'Staff Profile Directory', pageSlug: 'settings-staff-profiles', description: 'Maintain staff profile metadata', componentRef: 'StaffProfileDirectory', sortOrder: 1 },
  { slug: 'shift-role-directory', name: 'Shift Role Directory', pageSlug: 'settings-shift-roles', description: 'Manage scheduling shift role definitions', componentRef: 'ShiftRoleDirectory', sortOrder: 1 },
  { slug: 'shift-type-directory', name: 'Shift Type Directory', pageSlug: 'settings-shift-types', description: 'Map shift types to products', componentRef: 'ShiftTypeDirectory', sortOrder: 1 },
    { slug: 'user-shift-role-directory', name: 'User Shift Role Directory', pageSlug: 'settings-user-shift-roles', description: 'Assign shift roles to users', componentRef: 'UserShiftRoleDirectory', sortOrder: 1 },
    { slug: 'settings-home', name: 'Home Experience', pageSlug: 'settings-home-experience', description: 'Set default home experiences for users', componentRef: 'SettingsHomeExperience', sortOrder: 1 },
];

const rolePageMatrix: Record<string, string[]> = {
  admin: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'venue-numbers', 'channel-numbers', 'reviews', 'finance', 'pays', 'scheduling', 'assistant-manager-tasks', 'settings-products', 'settings-product-aliases', 'settings-product-types', 'settings-product-prices', 'settings-venues', 'settings-addons', 'settings-product-addons', 'settings-payment-methods', 'settings-channel-product-prices', 'settings-channel-commissions', 'settings-review-platforms', 'settings-compensation-components', 'settings-actions', 'settings-channels', 'settings',
'settings-users',
'settings-user-types',
'settings-pages',
'settings-modules',
'settings-permissions',
'settings-permissions-pages',
'settings-permissions-modules',
'settings-staff-profiles',
'settings-shift-roles',
'settings-user-shift-roles',
'settings-shift-types',
'settings-db-backups',
'settings-home-experience',
'settings-control-panel',
'settings-maintenance'],
  owner: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'venue-numbers', 'channel-numbers', 'reviews', 'finance', 'pays', 'scheduling', 'assistant-manager-tasks', 'settings-staff-profiles', 'settings-shift-roles', 'settings-user-shift-roles', 'settings-shift-types', 'settings-review-platforms', 'settings-compensation-components', 'settings-home-experience', 'settings-product-aliases'],
  manager: ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'venue-numbers', 'channel-numbers', 'reviews', 'finance', 'pays', 'scheduling', 'assistant-manager-tasks'],
  'assistant-manager': ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'venue-numbers', 'channel-numbers', 'reviews', 'finance', 'pays', 'scheduling', 'assistant-manager-tasks'],
  guide: ['dashboard', 'bookings', 'bookings-manifest', 'venue-numbers', 'channel-numbers', 'pays', 'scheduling'],
};

rolePageMatrix['administrator'] = [...rolePageMatrix.admin];

const roleModuleMatrix: Record<string, Record<string, string[]>> = {
  admin: {
    'dashboard-overview': ['view', 'update'],
    'booking-management': ['view', 'create', 'update', 'delete'],
    'booking-manifest': ['view'],
    'user-directory': ['view', 'create', 'update', 'delete'],
    'staff-profile-directory': ['view', 'create', 'update', 'delete'],
    'shift-role-directory': ['view', 'create', 'update', 'delete'],
    'shift-type-directory': ['view', 'create', 'update', 'delete'],
    'user-shift-role-directory': ['view', 'create', 'update', 'delete'],
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
      'channel-numbers-summary': ['view'],
      'staff-payouts-all': ['view'],
      'scheduling-availability': ['view', 'create', 'update', 'delete'],
      'scheduling-builder': ['view', 'create', 'update', 'delete'],
      'scheduling-my-shifts': ['view'],
      'scheduling-swaps': ['view', 'create', 'update', 'delete'],
      'scheduling-history': ['view', 'create', 'update', 'delete'],
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
    'product-alias-management': ['view', 'create', 'update', 'delete'],
    'product-taxonomy': ['view', 'create', 'update', 'delete'],
    'product-price-management': ['view', 'create', 'update', 'delete'],
    'addon-management': ['view', 'create', 'update', 'delete'],
    'payment-method-management': ['view', 'create', 'update', 'delete'],
    'action-registry': ['view', 'create', 'update', 'delete'],
    'product-addon-management': ['view', 'create', 'update', 'delete'],
    'channel-product-price-management': ['view', 'create', 'update', 'delete'],
    'channel-commission-management': ['view', 'create', 'update', 'delete'],
    'review-platform-management': ['view', 'create', 'update', 'delete'],
    'compensation-component-management': ['view', 'create', 'update', 'delete'],
    'am-task-management': ['view', 'create', 'update', 'delete'],
    'review-counter-management': ['view', 'create', 'update', 'delete'],
    'channel-console': ['view', 'create', 'update', 'delete'],
  },
  owner: {
    'dashboard-overview': ['view', 'update'],
    'booking-management': ['view', 'create', 'update', 'delete'],
    'booking-manifest': ['view'],
    'user-directory': ['view', 'create', 'update', 'delete'],
    'staff-profile-directory': ['view', 'create', 'update', 'delete'],
    'shift-role-directory': ['view', 'create', 'update', 'delete'],
    'shift-type-directory': ['view', 'create', 'update', 'delete'],
    'user-shift-role-directory': ['view', 'create', 'update', 'delete'],
    'settings-home': ['view', 'create', 'update', 'delete'],
      reporting: ['view', 'create', 'update', 'delete'],
      'venue-numbers-management': ['view', 'create', 'update'],
      'channel-numbers-summary': ['view'],
      'staff-payouts-all': ['view'],
      'scheduling-availability': ['view', 'create', 'update', 'delete'],
      'scheduling-builder': ['view', 'create', 'update', 'delete'],
      'scheduling-my-shifts': ['view'],
      'scheduling-swaps': ['view', 'create', 'update', 'delete'],
      'scheduling-history': ['view', 'create', 'update', 'delete'],
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
    'review-platform-management': ['view', 'create', 'update', 'delete'],
    'compensation-component-management': ['view', 'create', 'update', 'delete'],
    'am-task-management': ['view', 'create', 'update', 'delete'],
    'review-counter-management': ['view', 'create', 'update', 'delete'],
    'product-alias-management': ['view', 'create', 'update', 'delete'],
  },
  manager: {
    'dashboard-overview': ['view'],
    'booking-management': ['view', 'create', 'update'],
    'booking-manifest': ['view'],
      reporting: ['view', 'create'],
      'venue-numbers-management': ['view', 'create', 'update'],
      'channel-numbers-summary': ['view'],
      'staff-payouts-all': ['view'],
      'scheduling-availability': ['view', 'create', 'update'],
      'scheduling-builder': ['view', 'create', 'update'],
      'scheduling-my-shifts': ['view'],
      'scheduling-swaps': ['view', 'create', 'update'],
      'scheduling-history': ['view', 'create', 'update'],
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
    'review-counter-management': ['view'],
    'review-platform-management': ['view'],
    'am-task-management': ['view', 'create', 'update', 'delete'],
  },
  'assistant-manager': {
    'dashboard-overview': ['view'],
    'booking-management': ['view', 'create', 'update'],
    'booking-manifest': ['view'],
      reporting: ['view'],
      'venue-numbers-management': ['view', 'create', 'update'],
      'channel-numbers-summary': ['view'],
      'staff-payouts-self': ['view'],
      'scheduling-availability': ['view', 'create', 'update'],
      'scheduling-builder': ['view'],
      'scheduling-my-shifts': ['view'],
      'scheduling-history': ['view', 'create', 'update'],
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
    'review-counter-management': ['view'],
    'am-task-management': ['view', 'create', 'update', 'delete'],
  },
  guide: {
    'dashboard-overview': ['view'],
    'staff-payouts-self': ['view'],
    'channel-numbers-summary': ['view'],
    'scheduling-availability': ['view', 'create', 'update'],
    'scheduling-builder': ['view'],
    'scheduling-my-shifts': ['view'],
  },
};

roleModuleMatrix['administrator'] = Object.fromEntries(
  Object.entries(roleModuleMatrix.admin).map(([moduleSlug, actions]) => [moduleSlug, [...actions]])
);

roleModuleMatrix['pub-crawl-guide'] = Object.fromEntries(
  Object.entries(roleModuleMatrix.guide).map(([moduleSlug, actions]) => [moduleSlug, [...actions]])
);

export const ACCESS_CONTROL_SEED_KEYS = {
  roles: 'access-control.roles',
  actions: 'access-control.actions',
  pages: 'access-control.pages',
  modules: 'access-control.modules',
  moduleActions: 'access-control.module-actions',
  rolePages: 'access-control.role-pages',
  roleModules: 'access-control.role-modules',
  sequences: 'access-control.sequences',
  adminUser: 'access-control.admin-default-user',
} as const;

type AccessControlSeedKey = typeof ACCESS_CONTROL_SEED_KEYS[keyof typeof ACCESS_CONTROL_SEED_KEYS];

export type SeedCatalogEntry = {
  key: string;
  label: string;
  description: string;
  group: 'access-control' | 'catalog';
  sortOrder: number;
};

const PUB_CRAWL_SEED_KEY = 'catalog-pub-crawl-v1';

const SEED_CATALOG: SeedCatalogEntry[] = [
  {
    key: PUB_CRAWL_SEED_KEY,
    label: 'Pub Crawl Catalog',
    description: 'Seeds channels, products, add-ons, and payment method defaults for Pub Crawl.',
    group: 'catalog',
    sortOrder: 1,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.roles,
    label: 'Access Control Roles',
    description: 'Ensures default user roles exist.',
    group: 'access-control',
    sortOrder: 10,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.actions,
    label: 'Access Control Actions',
    description: 'Ensures default action keys exist.',
    group: 'access-control',
    sortOrder: 20,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.pages,
    label: 'Access Control Pages',
    description: 'Creates missing pages for navigation.',
    group: 'access-control',
    sortOrder: 30,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.modules,
    label: 'Access Control Modules',
    description: 'Creates missing modules tied to pages.',
    group: 'access-control',
    sortOrder: 40,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.moduleActions,
    label: 'Access Control Module Actions',
    description: 'Adds missing module/action combinations.',
    group: 'access-control',
    sortOrder: 50,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.rolePages,
    label: 'Access Control Role Pages',
    description: 'Adds missing role/page permissions.',
    group: 'access-control',
    sortOrder: 60,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.roleModules,
    label: 'Access Control Role Modules',
    description: 'Adds missing role/module permissions.',
    group: 'access-control',
    sortOrder: 70,
  },
  {
    key: ACCESS_CONTROL_SEED_KEYS.adminUser,
    label: 'Access Control Admin User',
    description: 'Ensures default admin user is assigned.',
    group: 'access-control',
    sortOrder: 80,
  },
];

export const listSeedCatalog = (): SeedCatalogEntry[] => [...SEED_CATALOG].sort((a, b) => a.sortOrder - b.sortOrder);

const capList = <T>(items: T[], cap = 50): { total: number; items: T[] } => ({
  total: items.length,
  items: items.slice(0, cap),
});

export async function previewSeedChanges(seedKey: string): Promise<{
  supported: boolean;
  seedKey: string;
  pendingCount: number;
  details?: Record<string, unknown> | null;
}> {
  if (!Object.values(ACCESS_CONTROL_SEED_KEYS).includes(seedKey as AccessControlSeedKey)) {
    return { supported: false, seedKey, pendingCount: 0, details: null };
  }

  switch (seedKey) {
    case ACCESS_CONTROL_SEED_KEYS.roles: {
      const existing = await UserType.findAll({ attributes: ['slug'] });
      const existingSlugs = new Set(existing.map((role) => role.slug));
      const missing = defaultRoles.filter((role) => !existingSlugs.has(role.slug));
      const summary = capList(missing.map((role) => ({ slug: role.slug, name: role.name })));
      return { supported: true, seedKey, pendingCount: summary.total, details: { missing: summary } };
    }
    case ACCESS_CONTROL_SEED_KEYS.actions: {
      const existing = await Action.findAll({ attributes: ['key'] });
      const existingKeys = new Set(existing.map((action) => action.key));
      const missing = defaultActions.filter((action) => !existingKeys.has(action.key));
      const summary = capList(missing.map((action) => ({ key: action.key, name: action.name })));
      return { supported: true, seedKey, pendingCount: summary.total, details: { missing: summary } };
    }
    case ACCESS_CONTROL_SEED_KEYS.pages: {
      const existing = await Page.findAll({ attributes: ['slug'] });
      const existingSlugs = new Set(existing.map((page) => page.slug));
      const missing = defaultPages.filter((page) => !existingSlugs.has(page.slug));
      const summary = capList(missing.map((page) => ({ slug: page.slug, name: page.name })));
      return { supported: true, seedKey, pendingCount: summary.total, details: { missing: summary } };
    }
    case ACCESS_CONTROL_SEED_KEYS.modules: {
      const existingPages = await Page.findAll({ attributes: ['slug', 'id'] });
      const pageMap = new Map(existingPages.map((page) => [page.slug, page.id]));
      const existingModules = await Module.findAll({ attributes: ['slug'] });
      const existingSlugs = new Set(existingModules.map((module) => module.slug));
      const missing = defaultModules
        .filter((module) => pageMap.has(module.pageSlug))
        .filter((module) => !existingSlugs.has(module.slug));
      const missingPages = defaultModules
        .filter((module) => !pageMap.has(module.pageSlug))
        .map((module) => module.pageSlug);
      const summary = capList(missing.map((module) => ({ slug: module.slug, name: module.name, pageSlug: module.pageSlug })));
      return {
        supported: true,
        seedKey,
        pendingCount: summary.total,
        details: { missing: summary, missingPages: Array.from(new Set(missingPages)) },
      };
    }
    case ACCESS_CONTROL_SEED_KEYS.moduleActions: {
      const actionRecords = await Action.findAll({ attributes: ['id', 'key'] });
      const actionMap = new Map(actionRecords.map((action) => [action.key, action.id]));
      const moduleRecords = await Module.findAll({ attributes: ['id', 'slug'] });
      const moduleMap = new Map(moduleRecords.map((module) => [module.slug, module.id]));

      const existing = await ModuleAction.findAll({ attributes: ['moduleId', 'actionId'] });
      const existingKeys = new Set(existing.map((entry) => `${entry.moduleId}:${entry.actionId}`));

      const missing: Array<{ moduleSlug: string; actionKey: string }> = [];
      for (const module of defaultModules) {
        const moduleId = moduleMap.get(module.slug);
        if (!moduleId) {
          continue;
        }
        for (const action of defaultActions) {
          const actionId = actionMap.get(action.key);
          if (!actionId) {
            continue;
          }
          const key = `${moduleId}:${actionId}`;
          if (!existingKeys.has(key)) {
            missing.push({ moduleSlug: module.slug, actionKey: action.key });
          }
        }
      }
      const summary = capList(missing);
      return { supported: true, seedKey, pendingCount: summary.total, details: { missing: summary } };
    }
    case ACCESS_CONTROL_SEED_KEYS.rolePages: {
      const roleRecords = await UserType.findAll({ attributes: ['id', 'slug'] });
      const roleMap = new Map(roleRecords.map((role) => [role.slug, role.id]));
      const pageRecords = await Page.findAll({ attributes: ['id', 'slug'] });
      const pageMap = new Map(pageRecords.map((page) => [page.slug, page.id]));
      const existing = await RolePagePermission.findAll({ attributes: ['userTypeId', 'pageId'] });
      const existingKeys = new Set(existing.map((entry) => `${entry.userTypeId}:${entry.pageId}`));

      const missing: Array<{ roleSlug: string; pageSlug: string }> = [];
      for (const [roleSlug, pages] of Object.entries(rolePageMatrix)) {
        const roleId = roleMap.get(roleSlug);
        if (!roleId) {
          continue;
        }
        for (const pageSlug of pages) {
          const pageId = pageMap.get(pageSlug);
          if (!pageId) {
            continue;
          }
          const key = `${roleId}:${pageId}`;
          if (!existingKeys.has(key)) {
            missing.push({ roleSlug, pageSlug });
          }
        }
      }
      const summary = capList(missing);
      return { supported: true, seedKey, pendingCount: summary.total, details: { missing: summary } };
    }
    case ACCESS_CONTROL_SEED_KEYS.roleModules: {
      const roleRecords = await UserType.findAll({ attributes: ['id', 'slug'] });
      const roleMap = new Map(roleRecords.map((role) => [role.slug, role.id]));
      const moduleRecords = await Module.findAll({ attributes: ['id', 'slug'] });
      const moduleMap = new Map(moduleRecords.map((module) => [module.slug, module.id]));
      const actionRecords = await Action.findAll({ attributes: ['id', 'key'] });
      const actionMap = new Map(actionRecords.map((action) => [action.key, action.id]));
      const existing = await RoleModulePermission.findAll({ attributes: ['userTypeId', 'moduleId', 'actionId'] });
      const existingKeys = new Set(existing.map((entry) => `${entry.userTypeId}:${entry.moduleId}:${entry.actionId}`));

      const missing: Array<{ roleSlug: string; moduleSlug: string; actionKey: string }> = [];
      for (const [roleSlug, moduleConfig] of Object.entries(roleModuleMatrix)) {
        const roleId = roleMap.get(roleSlug);
        if (!roleId) {
          continue;
        }
        for (const [moduleSlug, actions] of Object.entries(moduleConfig)) {
          const moduleId = moduleMap.get(moduleSlug);
          if (!moduleId) {
            continue;
          }
          for (const actionKey of actions) {
            const actionId = actionMap.get(actionKey);
            if (!actionId) {
              continue;
            }
            const key = `${roleId}:${moduleId}:${actionId}`;
            if (!existingKeys.has(key)) {
              missing.push({ roleSlug, moduleSlug, actionKey });
            }
          }
        }
      }
      const summary = capList(missing);
      return { supported: true, seedKey, pendingCount: summary.total, details: { missing: summary } };
    }
    case ACCESS_CONTROL_SEED_KEYS.adminUser: {
      const adminRole = await UserType.findOne({ where: { slug: 'admin' }, attributes: ['id'] });
      if (!adminRole) {
        return { supported: true, seedKey, pendingCount: 0, details: { reason: 'Admin role missing' } };
      }
      const adminUser = await User.findByPk(1);
      const needsUpdate = Boolean(adminUser && adminUser.userTypeId !== adminRole.id);
      return {
        supported: true,
        seedKey,
        pendingCount: needsUpdate ? 1 : 0,
        details: needsUpdate ? { userId: adminUser?.id, roleId: adminRole.id } : null,
      };
    }
    default:
      return { supported: false, seedKey, pendingCount: 0, details: null };
  }
}

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

async function seedPubCrawlCatalog(): Promise<{ createdCount: number; updatedCount: number }> {
  return sequelize.transaction(async (transaction: Transaction) => {
    let createdCount = 0;
    let updatedCount = 0;
    const paymentMethodMap = new Map<string, PaymentMethod>();
    for (const method of PAYMENT_METHOD_SEED) {
      const [record, created] = await PaymentMethod.findOrCreate({
        where: { name: method.name },
        defaults: {
          description: method.description,
        },
        transaction,
      });
      if (created) {
        createdCount += 1;
      }
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
          updatedCount += 1;
          await channel.save({ transaction });
        }
      } else {
        createdCount += 1;
      }
    }

    const addonMap = new Map<string, Addon>();

    for (const addonSeed of ADDON_SEEDS) {
      const [addon, created] = await Addon.findOrCreate({
        where: { name: addonSeed.name },
        defaults: {
          basePrice: null,
          taxRate: null,
          isActive: true,
        },
        transaction,
      });
      if (created) {
        createdCount += 1;
      }

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
        updatedCount += 1;
        await addon.save({ transaction });
      }
      addonMap.set(addonSeed.name, addon);
    }

    const referenceProduct = await Product.findOne({ order: [['id', 'ASC']], transaction });
    const productTypeId = referenceProduct?.productTypeId ?? 1;
    const createdBy = referenceProduct?.createdBy ?? 1;

    const [product, created] = await Product.findOrCreate({
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
    if (created) {
      createdCount += 1;
    }

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
      updatedCount += 1;
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
      createdCount += 1;
    }

    return { createdCount, updatedCount };
  });
}

async function seedAccessControlRoles() {
  return sequelize.transaction(async (transaction) => {
    let updatedCount = 0;
    const existingRoles = await UserType.findAll({ transaction });
    await Promise.all(existingRoles.map(async role => {
      if (!role.slug || !role.slug.trim()) {
        role.slug = slugify(role.name || `role-${role.id}`);
        await role.save({ transaction });
        updatedCount += 1;
      }
    }));

    let createdCount = 0;
    for (const role of defaultRoles) {
      const [, created] = await UserType.findOrCreate({
        where: { slug: role.slug },
        defaults: {
          name: role.name,
          description: role.description,
          isDefault: role.isDefault,
          status: true,
        },
        transaction,
      });
      if (created) {
        createdCount += 1;
      }
    }

    return { seededCount: createdCount, details: { createdCount, updatedCount } };
  });
}

async function seedAccessControlActions() {
  return sequelize.transaction(async (transaction) => {
    let createdCount = 0;
    for (const action of defaultActions) {
      const [, created] = await Action.findOrCreate({
        where: { key: action.key },
        defaults: {
          name: action.name,
          description: action.description,
          isAssignable: true,
          status: true,
        },
        transaction,
      });
      if (created) {
        createdCount += 1;
      }
    }
    return { seededCount: createdCount, details: { createdCount } };
  });
}

async function seedAccessControlPages() {
  return sequelize.transaction(async (transaction) => {
    let createdCount = 0;
    for (const page of defaultPages) {
      const [, created] = await Page.findOrCreate({
        where: { slug: page.slug },
        defaults: {
          name: page.name,
          description: page.description,
          sortOrder: page.sortOrder,
          status: true,
        },
        transaction,
      });
      if (created) {
        createdCount += 1;
      }
    }
    return { seededCount: createdCount, details: { createdCount } };
  });
}

async function seedAccessControlModules() {
  return sequelize.transaction(async (transaction) => {
    const pageSlugs = Array.from(new Set(defaultModules.map((module) => module.pageSlug)));
    const pages = await Page.findAll({
      where: { slug: { [Op.in]: pageSlugs } },
      transaction,
    });
    const pageMap = new Map(pages.map((page) => [page.slug, page]));
    let createdCount = 0;

    for (const module of defaultModules) {
      const page = pageMap.get(module.pageSlug);
      if (!page) {
        continue;
      }
      const [, created] = await Module.findOrCreate({
        where: { slug: module.slug },
        defaults: {
          name: module.name,
          description: module.description,
          componentRef: module.componentRef,
          sortOrder: module.sortOrder,
          status: true,
          pageId: page.id,
        },
        transaction,
      });
      if (created) {
        createdCount += 1;
      }
    }

    return { seededCount: createdCount, details: { createdCount } };
  });
}

async function seedAccessControlModuleActions() {
  return sequelize.transaction(async (transaction) => {
    const actionRecords = await Action.findAll({
      where: { key: { [Op.in]: defaultActions.map((action) => action.key) } },
      transaction,
    });
    const actionMap = new Map(actionRecords.map((action) => [action.key, action]));
    const moduleRecords = await Module.findAll({
      where: { slug: { [Op.in]: defaultModules.map((module) => module.slug) } },
      transaction,
    });
    const moduleMap = new Map(moduleRecords.map((module) => [module.slug, module]));

    let createdCount = 0;
    for (const module of defaultModules) {
      const moduleRecord = moduleMap.get(module.slug);
      if (!moduleRecord) {
        continue;
      }
      for (const action of defaultActions) {
        const actionRecord = actionMap.get(action.key);
        if (!actionRecord) {
          continue;
        }
        const [, created] = await ModuleAction.findOrCreate({
          where: {
            moduleId: moduleRecord.id,
            actionId: actionRecord.id,
          },
          defaults: {
            enabled: true,
          },
          transaction,
        });
        if (created) {
          createdCount += 1;
        }
      }
    }

    return { seededCount: createdCount, details: { createdCount } };
  });
}

async function seedAccessControlRolePages() {
  return sequelize.transaction(async (transaction) => {
    const roleRecords = await UserType.findAll({
      where: { slug: { [Op.in]: Object.keys(rolePageMatrix) } },
      transaction,
    });
    const roleMap = new Map(roleRecords.map((role) => [role.slug, role]));

    let createdCount = 0;
    for (const [roleSlug, pages] of Object.entries(rolePageMatrix)) {
      const role = roleMap.get(roleSlug);
      if (!role) {
        continue;
      }
      const pageRecords = await Page.findAll({
        where: { slug: { [Op.in]: pages } },
        transaction,
      });
      for (const page of pageRecords) {
        const [, created] = await RolePagePermission.findOrCreate({
          where: {
            userTypeId: role.id,
            pageId: page.id,
          },
          defaults: {
            canView: true,
            status: true,
          },
          transaction,
        });
        if (created) {
          createdCount += 1;
        }
      }
    }

    return { seededCount: createdCount, details: { createdCount } };
  });
}

async function seedAccessControlRoleModules() {
  return sequelize.transaction(async (transaction) => {
    const roleRecords = await UserType.findAll({
      where: { slug: { [Op.in]: Object.keys(roleModuleMatrix) } },
      transaction,
    });
    const roleMap = new Map(roleRecords.map((role) => [role.slug, role]));
    const moduleSlugSet = new Set<string>();
    Object.values(roleModuleMatrix).forEach((modules) => {
      Object.keys(modules).forEach((moduleSlug) => moduleSlugSet.add(moduleSlug));
    });
    const moduleRecords = await Module.findAll({
      where: { slug: { [Op.in]: Array.from(moduleSlugSet) } },
      transaction,
    });
    const moduleMap = new Map(moduleRecords.map((module) => [module.slug, module]));
    const actionRecords = await Action.findAll({
      where: { key: { [Op.in]: defaultActions.map((action) => action.key) } },
      transaction,
    });
    const actionMap = new Map(actionRecords.map((action) => [action.key, action]));

    let createdCount = 0;
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
          const [, created] = await RoleModulePermission.findOrCreate({
            where: {
              userTypeId: role.id,
              moduleId: moduleRecord.id,
              actionId: actionRecord.id,
            },
            defaults: {
              allowed: true,
              status: true,
            },
            transaction,
          });
          if (created) {
            createdCount += 1;
          }
        }
      }
    }

    return { seededCount: createdCount, details: { createdCount } };
  });
}

async function seedAccessControlSequences() {
  await resetSequence('pages');
  await resetSequence('actions');
  await resetSequence('modules');
  await resetSequence('moduleActions');
  await resetSequence('rolePagePermissions');
  await resetSequence('roleModulePermissions');
  return { seededCount: 0, details: { reset: true } };
}

async function seedAccessControlAdminUser() {
  const adminRole = await UserType.findOne({ where: { slug: 'admin' } });
  if (!adminRole) {
    return { seededCount: 0 };
  }
  const adminUser = await User.findByPk(1);
  if (adminUser && adminUser.userTypeId !== adminRole.id) {
    adminUser.userTypeId = adminRole.id;
    await adminUser.save();
    return { seededCount: 1, details: { userId: adminUser.id } };
  }
  return { seededCount: 0 };
}

const accessControlSeedHandlers: Record<AccessControlSeedKey, () => Promise<{ seededCount: number; details?: Record<string, unknown> | null }>> = {
  [ACCESS_CONTROL_SEED_KEYS.roles]: seedAccessControlRoles,
  [ACCESS_CONTROL_SEED_KEYS.actions]: seedAccessControlActions,
  [ACCESS_CONTROL_SEED_KEYS.pages]: seedAccessControlPages,
  [ACCESS_CONTROL_SEED_KEYS.modules]: seedAccessControlModules,
  [ACCESS_CONTROL_SEED_KEYS.moduleActions]: seedAccessControlModuleActions,
  [ACCESS_CONTROL_SEED_KEYS.rolePages]: seedAccessControlRolePages,
  [ACCESS_CONTROL_SEED_KEYS.roleModules]: seedAccessControlRoleModules,
  [ACCESS_CONTROL_SEED_KEYS.sequences]: seedAccessControlSequences,
  [ACCESS_CONTROL_SEED_KEYS.adminUser]: seedAccessControlAdminUser,
};

export async function runAccessControlSeedByKey(params: {
  seedKey: AccessControlSeedKey;
  actorId?: number | null;
  force?: boolean;
  runType?: string;
}): Promise<{ skipped: boolean; seededCount: number; details?: Record<string, unknown> | null }> {
  const { seedKey, actorId, force, runType } = params;
  const handler = accessControlSeedHandlers[seedKey];
  if (!handler) {
    return { skipped: true, seededCount: 0 };
  }

  if (!force && (await hasSeedRun(seedKey))) {
    return { skipped: true, seededCount: 0 };
  }

  const result = await handler();
  await recordSeedRun({
    seedKey,
    runType: runType ?? (force ? 'manual' : 'access-control'),
    seededBy: actorId ?? null,
    seededCount: result.seededCount,
    seedDetails: result.details ?? null,
  });

  return { skipped: false, seededCount: result.seededCount, details: result.details ?? null };
}

export async function initializeAccessControl(): Promise<void> {
  await runSeedOnce({
    seedKey: PUB_CRAWL_SEED_KEY,
    runType: 'sync',
    run: async () => {
      const summary = await seedPubCrawlCatalog();
      return {
        seededCount: summary.createdCount,
        details: summary,
      };
    },
  });

  const orderedSeeds: AccessControlSeedKey[] = [
    ACCESS_CONTROL_SEED_KEYS.roles,
    ACCESS_CONTROL_SEED_KEYS.actions,
    ACCESS_CONTROL_SEED_KEYS.pages,
    ACCESS_CONTROL_SEED_KEYS.modules,
    ACCESS_CONTROL_SEED_KEYS.moduleActions,
    ACCESS_CONTROL_SEED_KEYS.rolePages,
    ACCESS_CONTROL_SEED_KEYS.roleModules,
    ACCESS_CONTROL_SEED_KEYS.adminUser,
  ];

  for (const seedKey of orderedSeeds) {
    await runAccessControlSeedByKey({ seedKey });
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
