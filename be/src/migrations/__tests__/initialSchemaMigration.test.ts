import type { QueryInterface } from 'sequelize';
import { down, up, verify } from '../202510010000-initial-schema';

const EXPECTED_TABLE_ORDER = [
  'userTypes',
  'users',
  'pages',
  'modules',
  'actions',
  'moduleActions',
  'rolePagePermissions',
  'roleModulePermissions',
  'guests',
  'channels',
  'bookings',
  'productTypes',
  'products',
  'counters',
  'counterProducts',
  'counterUsers',
  'reviews',
];

const SEEDED_IDS: Record<string, Record<string, number>> = {
  userTypes: {
    admin: 101,
    owner: 207,
    manager: 305,
    'assistant-manager': 412,
    guide: 599,
  },
  actions: { view: 11, create: 23, update: 37, delete: 49 },
  pages: {
    dashboard: 71,
    bookings: 83,
    'bookings-manifest': 97,
    users: 103,
    reports: 127,
    pays: 149,
  },
  modules: {
    'dashboard-overview': 1001,
    'booking-management': 1009,
    'booking-manifest': 1013,
    'user-directory': 1021,
    reporting: 1033,
    'staff-payouts-all': 1049,
    'staff-payouts-self': 1061,
  },
};

const createContext = (existingTables: string[] = []) => {
  const existing = new Set(existingTables);
  const transaction = {
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
  };
  const createTable = jest.fn(async (tableName: string) => {
    existing.add(tableName);
  });
  const tableExists = jest.fn(async (tableName: string) => existing.has(tableName));
  const query = jest.fn(async (sql: string) => {
    const tableName = Object.keys(SEEDED_IDS).find((table) => sql.includes(`FROM "${table}"`));
    if (!tableName) {
      return [];
    }
    return Object.entries(SEEDED_IDS[tableName]).map(([identifier, id]) => ({ id, identifier }));
  });
  const bulkInsert = jest.fn().mockResolvedValue(undefined);
  const context = {
    sequelize: {
      transaction: jest.fn().mockResolvedValue(transaction),
      query,
    },
    createTable,
    tableExists,
    bulkInsert,
    dropTable: jest.fn(),
  } as unknown as QueryInterface;

  return { context, transaction, createTable, tableExists, query, bulkInsert };
};

describe('202510010000 initial schema migration', () => {
  it('creates every pre-migration application table in dependency order', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    expect(setup.tableExists.mock.calls.map(([tableName]) => tableName)).toEqual(EXPECTED_TABLE_ORDER);
    expect(setup.createTable.mock.calls.map(([tableName]) => tableName)).toEqual(EXPECTED_TABLE_ORDER);
    expect(setup.createTable).toHaveBeenCalledTimes(17);
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.transaction.rollback).not.toHaveBeenCalled();
    expect(setup.query).toHaveBeenCalledTimes(4);
    expect(setup.bulkInsert).toHaveBeenCalledTimes(7);

    for (const [, , options] of setup.createTable.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ transaction: setup.transaction }));
    }
    for (const [, columns] of setup.createTable.mock.calls) {
      expect(columns.id).toEqual(expect.objectContaining({
        type: expect.anything(),
        autoIncrement: true,
        primaryKey: true,
      }));
    }
  });

  it('bootstraps the exact historical access-control graph on a fresh database', async () => {
    const setup = createContext();

    await up({ context: setup.context });

    const userTypeInsert = setup.bulkInsert.mock.calls.find(([tableName]) => tableName === 'userTypes');
    const actionInsert = setup.bulkInsert.mock.calls.find(([tableName]) => tableName === 'actions');
    const pageInsert = setup.bulkInsert.mock.calls.find(([tableName]) => tableName === 'pages');
    const moduleInsert = setup.bulkInsert.mock.calls.find(([tableName]) => tableName === 'modules');
    const moduleActionInsert = setup.bulkInsert.mock.calls.find(([tableName]) => tableName === 'moduleActions');
    const rolePageInsert = setup.bulkInsert.mock.calls.find(([tableName]) => tableName === 'rolePagePermissions');
    const roleModuleInsert = setup.bulkInsert.mock.calls.find(([tableName]) => tableName === 'roleModulePermissions');

    expect(userTypeInsert?.[1]).toEqual([
      expect.objectContaining({
        slug: 'admin',
        name: 'Administrator',
        description: 'Full platform access',
        isDefault: false,
        status: true,
      }),
      expect.objectContaining({
        slug: 'owner',
        name: 'Owner',
        description: 'Business owner',
        isDefault: false,
        status: true,
      }),
      expect.objectContaining({
        slug: 'manager',
        name: 'Manager',
        description: 'Manage day-to-day operations',
        isDefault: false,
        status: true,
      }),
      expect.objectContaining({
        slug: 'assistant-manager',
        name: 'Assistant Manager',
        description: 'Assist managers with operations',
        isDefault: false,
        status: true,
      }),
      expect.objectContaining({
        slug: 'guide',
        name: 'Guide',
        description: 'Front line staff',
        isDefault: true,
        status: true,
      }),
    ]);
    expect(actionInsert?.[1]).toEqual([
      expect.objectContaining({ key: 'view', name: 'View', description: 'View records' }),
      expect.objectContaining({ key: 'create', name: 'Create', description: 'Create records' }),
      expect.objectContaining({ key: 'update', name: 'Update', description: 'Update records' }),
      expect.objectContaining({ key: 'delete', name: 'Delete', description: 'Delete records' }),
    ]);
    expect(pageInsert?.[1]).toEqual([
      expect.objectContaining({
        slug: 'dashboard', name: 'Dashboard', description: 'System overview', sortOrder: 1,
      }),
      expect.objectContaining({
        slug: 'bookings', name: 'Bookings', description: 'Booking management', sortOrder: 2,
      }),
      expect.objectContaining({
        slug: 'bookings-manifest',
        name: 'Bookings Manifest',
        description: 'Bookings manifest view',
        sortOrder: 3,
      }),
      expect.objectContaining({
        slug: 'users', name: 'Users', description: 'User administration', sortOrder: 3,
      }),
      expect.objectContaining({
        slug: 'reports', name: 'Reports', description: 'Analytics and reports', sortOrder: 4,
      }),
      expect.objectContaining({
        slug: 'pays', name: 'Staff Payment', description: 'Staff commission overview', sortOrder: 5,
      }),
    ]);

    const modules = moduleInsert?.[1] as Array<Record<string, unknown>>;
    expect(modules).toEqual([
      expect.objectContaining({
        slug: 'dashboard-overview',
        name: 'Dashboard Overview',
        pageId: SEEDED_IDS.pages.dashboard,
        description: 'Key platform metrics',
        componentRef: 'DashboardOverview',
        sortOrder: 1,
      }),
      expect.objectContaining({
        slug: 'booking-management',
        name: 'Booking Management',
        pageId: SEEDED_IDS.pages.bookings,
        description: 'Create and manage bookings',
        componentRef: 'BookingTable',
        sortOrder: 1,
      }),
      expect.objectContaining({
        slug: 'booking-manifest',
        name: 'Booking Manifest',
        pageId: SEEDED_IDS.pages['bookings-manifest'],
        description: 'View manifest by pickup date',
        componentRef: 'BookingManifest',
        sortOrder: 1,
      }),
      expect.objectContaining({
        slug: 'user-directory',
        name: 'User Directory',
        pageId: SEEDED_IDS.pages.users,
        description: 'Manage platform users',
        componentRef: 'UserTable',
        sortOrder: 1,
      }),
      expect.objectContaining({
        slug: 'reporting',
        name: 'Reporting',
        pageId: SEEDED_IDS.pages.reports,
        description: 'Generate platform reports',
        componentRef: 'ReportBuilder',
        sortOrder: 1,
      }),
      expect.objectContaining({
        slug: 'staff-payouts-all',
        name: 'Staff Payments (All)',
        pageId: SEEDED_IDS.pages.pays,
        description: 'View commission data for all staff',
        componentRef: 'StaffPayoutsAll',
        sortOrder: 1,
      }),
      expect.objectContaining({
        slug: 'staff-payouts-self',
        name: 'Staff Payments (Self)',
        pageId: SEEDED_IDS.pages.pays,
        description: 'View personal commission data',
        componentRef: 'StaffPayoutsSelf',
        sortOrder: 2,
      }),
    ]);

    const moduleActions = moduleActionInsert?.[1] as Array<{
      moduleId: number;
      actionId: number;
      enabled: boolean;
    }>;
    expect(moduleActions).toHaveLength(28);
    expect(moduleActions.every((row) => row.enabled === true)).toBe(true);
    expect(new Set(moduleActions.map((row) => `${row.moduleId}:${row.actionId}`))).toEqual(new Set(
      Object.values(SEEDED_IDS.modules).flatMap((moduleId) =>
        Object.values(SEEDED_IDS.actions).map((actionId) => `${moduleId}:${actionId}`)),
    ));

    const expectedRolePages: Record<string, string[]> = {
      admin: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'pays'],
      owner: ['dashboard', 'bookings', 'bookings-manifest', 'users', 'reports', 'pays'],
      manager: ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
      'assistant-manager': ['dashboard', 'bookings', 'bookings-manifest', 'reports', 'pays'],
      guide: ['dashboard', 'bookings', 'bookings-manifest', 'pays'],
    };
    const expectedRolePagePairs = Object.entries(expectedRolePages).flatMap(([role, pages]) =>
      pages.map((page) => `${SEEDED_IDS.userTypes[role]}:${SEEDED_IDS.pages[page]}`));
    const rolePages = rolePageInsert?.[1] as Array<{
      userTypeId: number;
      pageId: number;
      canView: boolean;
      status: boolean;
    }>;
    expect(rolePages).toHaveLength(26);
    expect(rolePages.every((row) => row.canView === true && row.status === true)).toBe(true);
    expect(new Set(rolePages.map((row) => `${row.userTypeId}:${row.pageId}`)))
      .toEqual(new Set(expectedRolePagePairs));

    const expectedRoleModules: Record<string, Record<string, string[]>> = {
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
    const expectedRoleModuleTriples = Object.entries(expectedRoleModules).flatMap(
      ([role, moduleConfig]) => Object.entries(moduleConfig).flatMap(([moduleName, actions]) =>
        actions.map((action) => [
          SEEDED_IDS.userTypes[role],
          SEEDED_IDS.modules[moduleName],
          SEEDED_IDS.actions[action],
        ].join(':'))),
    );
    const roleModules = roleModuleInsert?.[1] as Array<{
      userTypeId: number;
      moduleId: number;
      actionId: number;
      allowed: boolean;
      status: boolean;
    }>;
    expect(roleModules).toHaveLength(51);
    expect(roleModules.every((row) => row.allowed === true && row.status === true)).toBe(true);
    expect(new Set(roleModules.map((row) => `${row.userTypeId}:${row.moduleId}:${row.actionId}`)))
      .toEqual(new Set(expectedRoleModuleTriples));

    for (const insert of [
      userTypeInsert,
      actionInsert,
      pageInsert,
      moduleInsert,
      moduleActionInsert,
      rolePageInsert,
      roleModuleInsert,
    ]) {
      expect(insert?.[1]).toEqual(expect.arrayContaining([
        expect.objectContaining({ createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
      ]));
      expect(insert?.[2]).toEqual({
        transaction: setup.transaction,
        ignoreDuplicates: true,
      });
    }
    for (const [, options] of setup.query.mock.calls) {
      expect(options).toEqual(expect.objectContaining({
        transaction: setup.transaction,
        replacements: { identifiers: expect.any(Array) },
      }));
    }
    for (const action of actionInsert?.[1] ?? []) {
      expect(action).toEqual(expect.objectContaining({ isAssignable: true, status: true }));
    }
  });

  it('preserves the legacy column casing, uniqueness, and counter shape', async () => {
    const setup = createContext();
    await up({ context: setup.context });

    const definitions = new Map(
      setup.createTable.mock.calls.map(([name, columns, options]) => [name, { columns, options }]),
    );

    expect(definitions.get('users')?.columns).toEqual(expect.objectContaining({
      firstName: expect.objectContaining({ allowNull: false }),
      lastName: expect.objectContaining({ allowNull: false }),
      userTypeId: expect.objectContaining({ allowNull: true }),
      username: expect.objectContaining({ unique: true }),
      email: expect.objectContaining({ unique: true }),
    }));
    expect(definitions.get('users')?.columns).not.toHaveProperty('created_at');
    expect(definitions.get('users')?.columns).not.toHaveProperty('firstname');
    expect(definitions.get('bookings')?.columns).not.toEqual(expect.objectContaining({
      guestId: expect.anything(),
      channelId: expect.anything(),
    }));
    expect(definitions.get('reviews')?.columns).toHaveProperty('Description');
    expect(definitions.get('reviews')?.columns).not.toHaveProperty('description');
    expect(definitions.get('counters')?.columns).toEqual(expect.objectContaining({
      total: expect.objectContaining({ allowNull: false }),
      date: expect.objectContaining({ allowNull: false }),
    }));
    expect(definitions.get('counterUsers')?.columns).toEqual(expect.objectContaining({
      counterId: expect.objectContaining({ allowNull: false }),
      userId: expect.objectContaining({ allowNull: false }),
    }));
    expect(definitions.get('counterUsers')?.columns).not.toHaveProperty('counter_id');

    expect(definitions.get('moduleActions')?.options).toEqual(expect.objectContaining({
      uniqueKeys: {
        module_action_unique: { fields: ['moduleId', 'actionId'] },
      },
    }));
    expect(definitions.get('rolePagePermissions')?.options).toEqual(expect.objectContaining({
      uniqueKeys: {
        role_page_unique: { fields: ['userTypeId', 'pageId'] },
      },
    }));
    expect(definitions.get('roleModulePermissions')?.options).toEqual(expect.objectContaining({
      uniqueKeys: {
        role_module_unique: { fields: ['userTypeId', 'moduleId', 'actionId'] },
      },
    }));

    // Associations were initialized only after sequelize.sync() at eaef17f0,
    // and that original schema contained neither FK constraints nor ENUMs.
    for (const { columns } of definitions.values()) {
      for (const column of Object.values(columns) as Array<{ type: unknown; references?: unknown }>) {
        expect(column.references).toBeUndefined();
        expect(String(column.type)).not.toMatch(/^ENUM/u);
      }
    }
  });

  it('keeps the products table faithful to the historical camel-case schema', async () => {
    const setup = createContext();
    await up({ context: setup.context });

    const products = setup.createTable.mock.calls.find(([name]) => name === 'products')?.[1];
    expect(products).toEqual(expect.objectContaining({
      productTypeId: expect.objectContaining({ allowNull: false }),
      createdBy: expect.objectContaining({ allowNull: false }),
    }));
    expect(products).not.toHaveProperty('product_type_id');
    expect(products).not.toHaveProperty('created_by');
  });

  it('is a strict table-by-table no-op when all legacy tables already exist', async () => {
    const setup = createContext(EXPECTED_TABLE_ORDER);

    await up({ context: setup.context });

    expect(setup.tableExists).toHaveBeenCalledTimes(EXPECTED_TABLE_ORDER.length);
    expect(setup.createTable).not.toHaveBeenCalled();
    expect(setup.bulkInsert).not.toHaveBeenCalled();
    expect(setup.transaction.commit).toHaveBeenCalledTimes(1);
    expect(setup.query).not.toHaveBeenCalled();
  });

  it('does not seed a partially existing access-control graph', async () => {
    const setup = createContext(['userTypes']);

    await up({ context: setup.context });

    expect(setup.createTable).toHaveBeenCalledTimes(EXPECTED_TABLE_ORDER.length - 1);
    expect(setup.createTable.mock.calls.map(([tableName]) => tableName)).not.toContain('userTypes');
    expect(setup.bulkInsert).not.toHaveBeenCalled();
    expect(setup.query).not.toHaveBeenCalled();
  });

  it('does not seed newly created access tables when any non-access legacy table existed', async () => {
    const setup = createContext(['reviews']);

    await up({ context: setup.context });

    expect(setup.createTable).toHaveBeenCalledTimes(EXPECTED_TABLE_ORDER.length - 1);
    expect(setup.createTable.mock.calls.map(([tableName]) => tableName)).not.toContain('reviews');
    expect(setup.bulkInsert).not.toHaveBeenCalled();
    expect(setup.query).not.toHaveBeenCalled();
  });

  it('can run twice and creates no table during the second pass', async () => {
    const setup = createContext();

    await up({ context: setup.context });
    expect(setup.createTable).toHaveBeenCalledTimes(EXPECTED_TABLE_ORDER.length);
    setup.createTable.mockClear();
    setup.tableExists.mockClear();
    setup.query.mockClear();
    setup.bulkInsert.mockClear();

    await up({ context: setup.context });

    expect(setup.tableExists).toHaveBeenCalledTimes(EXPECTED_TABLE_ORDER.length);
    expect(setup.createTable).not.toHaveBeenCalled();
    expect(setup.query).not.toHaveBeenCalled();
    expect(setup.bulkInsert).not.toHaveBeenCalled();
    expect(setup.transaction.commit).toHaveBeenCalledTimes(2);
  });

  it('creates only a missing table without altering any existing table', async () => {
    const setup = createContext(EXPECTED_TABLE_ORDER.filter((name) => name !== 'reviews'));

    await up({ context: setup.context });

    expect(setup.createTable).toHaveBeenCalledTimes(1);
    expect(setup.createTable).toHaveBeenCalledWith(
      'reviews',
      expect.any(Object),
      expect.objectContaining({ transaction: setup.transaction }),
    );
  });

  it('rolls back the transaction when table creation fails', async () => {
    const setup = createContext();
    setup.createTable.mockRejectedValueOnce(new Error('create failed'));

    await expect(up({ context: setup.context })).rejects.toThrow('create failed');

    expect(setup.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(setup.transaction.commit).not.toHaveBeenCalled();
  });

  it('rolls back the fresh bootstrap if inserted IDs cannot be resolved', async () => {
    const setup = createContext();
    setup.query.mockResolvedValueOnce([]);

    await expect(up({ context: setup.context }))
      .rejects.toThrow('Failed to resolve userTypes bootstrap rows');

    expect(setup.bulkInsert).toHaveBeenCalledTimes(3);
    expect(setup.transaction.rollback).toHaveBeenCalledTimes(1);
    expect(setup.transaction.commit).not.toHaveBeenCalled();
  });

  it('verifies table presence without requiring obsolete legacy columns', async () => {
    const setup = createContext(EXPECTED_TABLE_ORDER.filter((name) => name !== 'bookings'));

    await expect(verify({ context: setup.context })).resolves.toEqual({
      ok: false,
      details: { missing: ['bookings'] },
    });
  });

  it('never drops tables on rollback because existing databases also apply the baseline', async () => {
    const setup = createContext(EXPECTED_TABLE_ORDER);

    await down({ context: setup.context });

    expect((setup.context as unknown as { dropTable: jest.Mock }).dropTable).not.toHaveBeenCalled();
  });
});
