import type { QueryInterface, Transaction } from 'sequelize';
import { DataTypes, QueryTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };
type ColumnDefinitions = Parameters<QueryInterface['createTable']>[1];

/**
 * The application pre-dates Umzug.  Before the first migration was added its
 * schema was created by sequelize.sync() from the models at git commit
 * eaef17f0.  Keep that historical contract here instead of importing today's
 * models: migrations must remain stable when models change.
 *
 * At that commit defineAssociations() ran only after sequelize.sync().  The
 * legacy tables consequently contained the model-declared foreign-key values,
 * but not database REFERENCES constraints (nor the association-only booking
 * fields).  This baseline intentionally reproduces the schema that the first
 * migrations received.  Later migrations add the durable constraints they
 * own.
 *
 * There are seventeen application tables below.  The migration runner owns
 * the eighteenth legacy table, sequelize_meta, and creates it separately.
 * A brand-new database also needs the access-control graph that the historical
 * application bootstrapped immediately after sync.  Those rows are runtime
 * authorization prerequisites (not demo/sample data), so they are inserted
 * only when this migration itself created the entire legacy schema, including
 * every access-control table, and this is therefore a true empty-database run.
 */

const timestamps = (): ColumnDefinitions => ({
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: DataTypes.NOW,
  },
});

const integerPrimaryKey = () => ({
  type: DataTypes.INTEGER,
  allowNull: false,
  autoIncrement: true,
  primaryKey: true,
});

const auditColumns = (createdByRequired: boolean): ColumnDefinitions => ({
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: !createdByRequired,
  },
  updatedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
});

type LegacyTable = {
  name: string;
  columns: ColumnDefinitions;
  options?: Parameters<QueryInterface['createTable']>[2];
};

const LEGACY_TABLES: LegacyTable[] = [
  {
    name: 'userTypes',
    columns: {
      id: integerPrimaryKey(),
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
      ...auditColumns(false),
    },
  },
  {
    name: 'users',
    columns: {
      id: integerPrimaryKey(),
      username: { type: DataTypes.STRING, allowNull: false, unique: true },
      firstName: { type: DataTypes.STRING, allowNull: false },
      lastName: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false, unique: true },
      password: { type: DataTypes.STRING, allowNull: false },
      userTypeId: { type: DataTypes.INTEGER, allowNull: true },
      ...timestamps(),
      ...auditColumns(false),
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
  },
  {
    name: 'pages',
    columns: {
      id: integerPrimaryKey(),
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      icon: { type: DataTypes.STRING, allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
      ...auditColumns(false),
    },
  },
  {
    name: 'modules',
    columns: {
      id: integerPrimaryKey(),
      pageId: { type: DataTypes.INTEGER, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      componentRef: { type: DataTypes.STRING, allowNull: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
      ...auditColumns(false),
    },
  },
  {
    name: 'actions',
    columns: {
      id: integerPrimaryKey(),
      key: { type: DataTypes.STRING, allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: true },
      isAssignable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
      ...auditColumns(false),
    },
  },
  {
    name: 'moduleActions',
    columns: {
      id: integerPrimaryKey(),
      moduleId: { type: DataTypes.INTEGER, allowNull: false },
      actionId: { type: DataTypes.INTEGER, allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
      ...auditColumns(false),
    },
    options: {
      uniqueKeys: {
        module_action_unique: { fields: ['moduleId', 'actionId'] },
      },
    },
  },
  {
    name: 'rolePagePermissions',
    columns: {
      id: integerPrimaryKey(),
      userTypeId: { type: DataTypes.INTEGER, allowNull: false },
      pageId: { type: DataTypes.INTEGER, allowNull: false },
      canView: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
      ...auditColumns(false),
    },
    options: {
      uniqueKeys: {
        role_page_unique: { fields: ['userTypeId', 'pageId'] },
      },
    },
  },
  {
    name: 'roleModulePermissions',
    columns: {
      id: integerPrimaryKey(),
      userTypeId: { type: DataTypes.INTEGER, allowNull: false },
      moduleId: { type: DataTypes.INTEGER, allowNull: false },
      actionId: { type: DataTypes.INTEGER, allowNull: false },
      allowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      ...timestamps(),
      ...auditColumns(false),
    },
    options: {
      uniqueKeys: {
        role_module_unique: { fields: ['userTypeId', 'moduleId', 'actionId'] },
      },
    },
  },
  {
    name: 'guests',
    columns: {
      id: integerPrimaryKey(),
      name: { type: DataTypes.STRING, allowNull: false },
      email: { type: DataTypes.STRING, allowNull: false },
      phoneNumber: { type: DataTypes.STRING, allowNull: true },
      address: { type: DataTypes.STRING, allowNull: true },
      paymentStatus: { type: DataTypes.STRING, allowNull: false },
      deposit: { type: DataTypes.FLOAT, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
  {
    name: 'channels',
    columns: {
      id: integerPrimaryKey(),
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.STRING, allowNull: false },
      apiKey: { type: DataTypes.STRING, allowNull: false },
      apiSecret: { type: DataTypes.STRING, allowNull: false },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
  {
    name: 'bookings',
    columns: {
      id: integerPrimaryKey(),
      checkInDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      checkOutDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      totalAmount: { type: DataTypes.FLOAT, allowNull: true },
      paymentStatus: { type: DataTypes.STRING, allowNull: true },
      roomType: { type: DataTypes.STRING, allowNull: true },
      numGuests: { type: DataTypes.FLOAT, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
  {
    name: 'productTypes',
    columns: {
      id: integerPrimaryKey(),
      name: { type: DataTypes.STRING, allowNull: false },
      add: { type: DataTypes.BOOLEAN, allowNull: true },
      sub: { type: DataTypes.BOOLEAN, allowNull: true },
      mul: { type: DataTypes.BOOLEAN, allowNull: true },
      div: { type: DataTypes.BOOLEAN, allowNull: true },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
  {
    name: 'products',
    columns: {
      id: integerPrimaryKey(),
      name: { type: DataTypes.STRING, allowNull: false },
      productTypeId: { type: DataTypes.INTEGER, allowNull: false },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      ...timestamps(),
      ...auditColumns(true),
      status: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
  },
  {
    name: 'counters',
    columns: {
      id: integerPrimaryKey(),
      userId: { type: DataTypes.INTEGER, allowNull: false },
      total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      date: { type: DataTypes.DATE, allowNull: false },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
  {
    name: 'counterProducts',
    columns: {
      id: integerPrimaryKey(),
      counterId: { type: DataTypes.INTEGER, allowNull: false },
      productId: { type: DataTypes.INTEGER, allowNull: false },
      quantity: { type: DataTypes.INTEGER, allowNull: false },
      total: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
  {
    name: 'counterUsers',
    columns: {
      id: integerPrimaryKey(),
      counterId: { type: DataTypes.INTEGER, allowNull: false },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
  {
    name: 'reviews',
    columns: {
      id: integerPrimaryKey(),
      channel: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      title: { type: DataTypes.STRING, allowNull: false },
      Description: { type: DataTypes.STRING, allowNull: false },
      score: { type: DataTypes.INTEGER, allowNull: false },
      date: { type: DataTypes.DATE, allowNull: false },
      extractionDate: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      ...timestamps(),
      ...auditColumns(true),
    },
  },
];

const INITIAL_USER_TYPES = [
  { slug: 'admin', name: 'Administrator', description: 'Full platform access', isDefault: false },
  { slug: 'owner', name: 'Owner', description: 'Business owner', isDefault: false },
  { slug: 'manager', name: 'Manager', description: 'Manage day-to-day operations', isDefault: false },
  {
    slug: 'assistant-manager',
    name: 'Assistant Manager',
    description: 'Assist managers with operations',
    isDefault: false,
  },
  { slug: 'guide', name: 'Guide', description: 'Front line staff', isDefault: true },
] as const;

const INITIAL_ACTIONS = [
  { key: 'view', name: 'View', description: 'View records' },
  { key: 'create', name: 'Create', description: 'Create records' },
  { key: 'update', name: 'Update', description: 'Update records' },
  { key: 'delete', name: 'Delete', description: 'Delete records' },
] as const;

const INITIAL_PAGES = [
  { slug: 'dashboard', name: 'Dashboard', description: 'System overview', sortOrder: 1 },
  { slug: 'bookings', name: 'Bookings', description: 'Booking management', sortOrder: 2 },
  {
    slug: 'bookings-manifest',
    name: 'Bookings Manifest',
    description: 'Bookings manifest view',
    sortOrder: 3,
  },
  { slug: 'users', name: 'Users', description: 'User administration', sortOrder: 3 },
  { slug: 'reports', name: 'Reports', description: 'Analytics and reports', sortOrder: 4 },
  { slug: 'pays', name: 'Staff Payment', description: 'Staff commission overview', sortOrder: 5 },
] as const;

const INITIAL_MODULES = [
  {
    slug: 'dashboard-overview',
    name: 'Dashboard Overview',
    pageSlug: 'dashboard',
    description: 'Key platform metrics',
    componentRef: 'DashboardOverview',
    sortOrder: 1,
  },
  {
    slug: 'booking-management',
    name: 'Booking Management',
    pageSlug: 'bookings',
    description: 'Create and manage bookings',
    componentRef: 'BookingTable',
    sortOrder: 1,
  },
  {
    slug: 'booking-manifest',
    name: 'Booking Manifest',
    pageSlug: 'bookings-manifest',
    description: 'View manifest by pickup date',
    componentRef: 'BookingManifest',
    sortOrder: 1,
  },
  {
    slug: 'user-directory',
    name: 'User Directory',
    pageSlug: 'users',
    description: 'Manage platform users',
    componentRef: 'UserTable',
    sortOrder: 1,
  },
  {
    slug: 'reporting',
    name: 'Reporting',
    pageSlug: 'reports',
    description: 'Generate platform reports',
    componentRef: 'ReportBuilder',
    sortOrder: 1,
  },
  {
    slug: 'staff-payouts-all',
    name: 'Staff Payments (All)',
    pageSlug: 'pays',
    description: 'View commission data for all staff',
    componentRef: 'StaffPayoutsAll',
    sortOrder: 1,
  },
  {
    slug: 'staff-payouts-self',
    name: 'Staff Payments (Self)',
    pageSlug: 'pays',
    description: 'View personal commission data',
    componentRef: 'StaffPayoutsSelf',
    sortOrder: 2,
  },
] as const;

// Keep the historical matrices intact. References to settings pages/modules
// were already present at eaef17f0 but were ignored by the initializer because
// those resources were not part of its default page/module lists.
const INITIAL_ROLE_PAGE_MATRIX: Record<string, readonly string[]> = {
  admin: [
    'dashboard',
    'bookings',
    'bookings-manifest',
    'users',
    'reports',
    'pays',
    'settings',
    'settings-users',
    'settings-user-types',
    'settings-pages',
    'settings-modules',
    'settings-permissions',
    'settings-permissions-pages',
    'settings-permissions-modules',
  ],
  owner: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'pays'],
  manager: ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
  'assistant-manager': ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
  guide: ['dashboard', 'bookings', 'bookings-manifest', 'pays'],
};

const INITIAL_ROLE_MODULE_MATRIX: Record<string, Record<string, readonly string[]>> = {
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

const INITIAL_ACCESS_TABLES = [
  'userTypes',
  'pages',
  'modules',
  'actions',
  'moduleActions',
  'rolePagePermissions',
  'roleModulePermissions',
] as const;

async function createTableWhenMissing(
  queryInterface: QueryInterface,
  table: LegacyTable,
  transaction: Transaction,
): Promise<boolean> {
  if (await queryInterface.tableExists(table.name, { transaction })) {
    return false;
  }

  await queryInterface.createTable(table.name, table.columns, {
    ...table.options,
    transaction,
  });
  return true;
}

async function resolveSeedIds(
  queryInterface: QueryInterface,
  tableName: string,
  identifierColumn: string,
  identifiers: readonly string[],
  transaction: Transaction,
): Promise<Map<string, number>> {
  const rows = await queryInterface.sequelize.query<{ id: number; identifier: string }>(
    `SELECT id, "${identifierColumn}" AS identifier
       FROM "${tableName}"
      WHERE "${identifierColumn}" IN (:identifiers);`,
    {
      transaction,
      type: QueryTypes.SELECT,
      replacements: { identifiers: [...identifiers] },
    },
  );
  const resolved = new Map(rows.map((row) => [row.identifier, Number(row.id)]));
  const missing = identifiers.filter((identifier) => !resolved.has(identifier));
  if (missing.length > 0) {
    throw new Error(`Failed to resolve ${tableName} bootstrap rows: ${missing.join(', ')}`);
  }
  return resolved;
}

function requireSeedId(ids: Map<string, number>, identifier: string, resource: string): number {
  const id = ids.get(identifier);
  if (id === undefined) {
    throw new Error(`Missing ${resource} bootstrap id for ${identifier}`);
  }
  return id;
}

async function seedFreshAccessPrerequisites(
  queryInterface: QueryInterface,
  createdTables: Set<string>,
  transaction: Transaction,
): Promise<void> {
  const createdEntireLegacySchema = createdTables.size === LEGACY_TABLES.length;
  const createdEntireAccessGraph = INITIAL_ACCESS_TABLES.every((tableName) => createdTables.has(tableName));
  if (!createdEntireLegacySchema || !createdEntireAccessGraph) {
    return;
  }

  const now = new Date();
  // Sequelize's bulkInsert QueryOptions type omits the dialect-supported
  // ignoreDuplicates flag.  Keeping it in a named object avoids that stale
  // excess-property check while PostgreSQL emits ON CONFLICT DO NOTHING.
  const insertOptions = { transaction, ignoreDuplicates: true } as const;
  await queryInterface.bulkInsert(
    'userTypes',
    INITIAL_USER_TYPES.map((role) => ({
      ...role,
      status: true,
      createdAt: now,
      updatedAt: now,
    })),
    insertOptions,
  );
  await queryInterface.bulkInsert(
    'actions',
    INITIAL_ACTIONS.map((action) => ({
      ...action,
      isAssignable: true,
      status: true,
      createdAt: now,
      updatedAt: now,
    })),
    insertOptions,
  );
  await queryInterface.bulkInsert(
    'pages',
    INITIAL_PAGES.map((page) => ({
      ...page,
      status: true,
      createdAt: now,
      updatedAt: now,
    })),
    insertOptions,
  );

  const roleIds = await resolveSeedIds(
    queryInterface,
    'userTypes',
    'slug',
    INITIAL_USER_TYPES.map((role) => role.slug),
    transaction,
  );
  const actionIds = await resolveSeedIds(
    queryInterface,
    'actions',
    'key',
    INITIAL_ACTIONS.map((action) => action.key),
    transaction,
  );
  const pageIds = await resolveSeedIds(
    queryInterface,
    'pages',
    'slug',
    INITIAL_PAGES.map((page) => page.slug),
    transaction,
  );

  await queryInterface.bulkInsert(
    'modules',
    INITIAL_MODULES.map(({ pageSlug, ...module }) => ({
      ...module,
      pageId: requireSeedId(pageIds, pageSlug, 'page'),
      status: true,
      createdAt: now,
      updatedAt: now,
    })),
    insertOptions,
  );
  const moduleIds = await resolveSeedIds(
    queryInterface,
    'modules',
    'slug',
    INITIAL_MODULES.map((module) => module.slug),
    transaction,
  );

  await queryInterface.bulkInsert(
    'moduleActions',
    INITIAL_MODULES.flatMap((module) => INITIAL_ACTIONS.map((action) => ({
      moduleId: requireSeedId(moduleIds, module.slug, 'module'),
      actionId: requireSeedId(actionIds, action.key, 'action'),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }))),
    insertOptions,
  );

  const rolePagePermissions = Object.entries(INITIAL_ROLE_PAGE_MATRIX).flatMap(
    ([roleSlug, pageSlugs]) => pageSlugs.flatMap((pageSlug) => {
      const pageId = pageIds.get(pageSlug);
      return pageId === undefined ? [] : [{
        userTypeId: requireSeedId(roleIds, roleSlug, 'role'),
        pageId,
        canView: true,
        status: true,
        createdAt: now,
        updatedAt: now,
      }];
    }),
  );
  await queryInterface.bulkInsert('rolePagePermissions', rolePagePermissions, insertOptions);

  const roleModulePermissions = Object.entries(INITIAL_ROLE_MODULE_MATRIX).flatMap(
    ([roleSlug, moduleConfig]) => Object.entries(moduleConfig).flatMap(([moduleSlug, actionKeys]) => {
      const moduleId = moduleIds.get(moduleSlug);
      if (moduleId === undefined) {
        return [];
      }
      return actionKeys.map((actionKey) => ({
        userTypeId: requireSeedId(roleIds, roleSlug, 'role'),
        moduleId,
        actionId: requireSeedId(actionIds, actionKey, 'action'),
        allowed: true,
        status: true,
        createdAt: now,
        updatedAt: now,
      }));
    }),
  );
  await queryInterface.bulkInsert('roleModulePermissions', roleModulePermissions, insertOptions);
}

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    const createdTables = new Set<string>();
    for (const table of LEGACY_TABLES) {
      const created = await createTableWhenMissing(context, table, transaction);
      if (created) {
        createdTables.add(table.name);
      }
    }
    await seedFreshAccessPrerequisites(context, createdTables, transaction);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * Deliberately irreversible.  Once this migration is introduced, an existing
 * production database also records it as applied.  Dropping legacy tables on
 * rollback would therefore destroy tables that this migration did not create.
 */
export async function down(_params: MigrationParams): Promise<void> {
  // no-op by design
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: { missing: string[] } }> {
  const missing: string[] = [];
  for (const table of LEGACY_TABLES) {
    if (!(await context.tableExists(table.name))) {
      missing.push(table.name);
    }
  }
  return { ok: missing.length === 0, details: { missing } };
}
