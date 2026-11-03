import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { provisionWorkspaceRoles } from '../services/databaseWorkspace/provisioning.js';
import { WORKSPACE_CONTROL_OBJECTS } from '../config/databaseWorkspacePolicy.js';
import { publicFunctionHazards } from '../services/databaseWorkspace/functionBoundary.js';

// Trusted-host bootstrap from the reviewed immutable release only. Never mount
// this entry point behind an API. Default invocation performs SELECTs only.
const envFile = '/etc/omnilodge/backend.env';
if (
  process.platform !== 'linux' ||
  process.getuid?.() !== 0 ||
  process.env.NODE_ENV !== 'production' ||
  !/^\/opt\/omnilodge\/releases\/omnilodge-[a-z0-9-]+\/be$/.test(process.cwd())
)
  throw new Error(
    'Use the trusted immutable production backend, protected environment and root maintenance context.',
  );
const envStat = await fs.lstat(envFile);
if (
  !envStat.isFile() ||
  envStat.isSymbolicLink() ||
  envStat.uid !== 0 ||
  (envStat.mode & 0o077) !== 0
)
  throw new Error(
    'The bootstrap environment must be a root-owned mode 0600 regular file.',
  );
if (
  !process.env.CONFIG_ENCRYPTION_KEY ||
  !process.env.DB_NAME ||
  !process.env.DB_PASSWORD
)
  throw new Error('Required protected bootstrap values are missing.');
const database = process.env.DB_NAME,
  apply = process.argv.includes('--apply'),
  manageOwnership = process.argv.includes('--manage-unprotected-ownership');
if (apply && !process.argv.includes(`--confirm-database=${database}`))
  throw new Error(
    'Confirm the exact application database with --confirm-database=<name>.',
  );
const client = new pg.Client({
  host: '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  database,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
  connectionTimeoutMillis: 5000,
  application_name: 'omnilodge-workspace-bootstrap',
});
await client.connect();
try {
  const info = (
    await client.query(
      "SELECT current_database() AS database,current_user AS application_role,current_setting('server_version_num')::int/10000 AS major,rolsuper,pg_database_size(current_database())::text AS database_bytes FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (!apply) {
    console.log(
      JSON.stringify({
        ok: true,
        mode: 'read-only plan',
        ...info,
        controlConfigured: !!process.env.DB_WORKSPACE_CONTROL_URL,
        ownershipRequested: manageOwnership,
        unsafePublicFunctions: (
          await publicFunctionHazards(client, ['public'])
        ).map((f) => f.address),
        changes:
          'Create independent control database and restricted roles, register encrypted Control Panel credentials, write protected bootstrap URL. Reload the protected environment through the release control plane before enabling admission in Control Panel. No changes executed.',
      }),
    );
  } else {
    if (process.env.DB_WORKSPACE_CONTROL_URL)
      throw new Error(
        'Control storage is already configured. Verify existing provisioning; this bootstrap refuses implicit credential rotation or store replacement.',
      );
    process.env.OMNILODGE_WORKSPACE_WORKER = 'true';
    const { initializeConfigRegistry, updateConfigValue, getConfigValue } =
      await import('../services/configService.js');
    const { default: sequelize } = await import('../config/database.js');
    const { WorkspaceStore } = await import(
      '../services/databaseWorkspace/store.js'
    );
    const { initializeRecovery } = await import(
      '../services/databaseWorkspace/recovery.js'
    );
    const { initializeSchedules } = await import(
      '../services/databaseWorkspace/schedules.js'
    );
    const { ensureDatabaseWorkspaceAccess } = await import(
      '../services/databaseWorkspace/accessSeed.js'
    );
    let store: InstanceType<typeof WorkspaceStore> | undefined;
    try {
      await initializeConfigRegistry();
      const configured = getConfigValue('DB_WORKSPACE_PROTECTED_OBJECTS');
      const protection = [
        ...new Set([
          ...WORKSPACE_CONTROL_OBJECTS,
          ...(Array.isArray(configured) ? (configured as string[]) : []),
        ]),
      ];
      const result = await provisionWorkspaceRoles(client, {
        database,
        controlDatabase: 'omnilodge_workbench_control',
        prefix: 'omnilodge_dw',
        protectedObjects: protection,
        manageOwnership,
        restrictPublicFunctions: process.argv.includes(
          '--restrict-unsafe-public-functions',
        ),
      });
      const url = new URL('postgresql://127.0.0.1');
      url.port = process.env.DB_PORT || '5432';
      url.username = result.names.control;
      url.password = result.passwords.control;
      url.pathname = 'omnilodge_workbench_control';
      url.searchParams.set('sslmode', 'disable');
      store = new WorkspaceStore(url.toString());
      await store.initialize();
      await initializeSchedules(store);
      await initializeRecovery(store);
      const set = (key: string, value: unknown) =>
        updateConfigValue({
          key,
          value,
          actorId: null,
          reason: 'Reviewed production Database Workspace bootstrap',
        });
      await set('DB_WORKSPACE_TARGETS', [
        {
          id: 'production',
          label: 'Production',
          environment: 'production',
          host: '127.0.0.1',
          port: Number(process.env.DB_PORT || 5432),
          database,
          major: result.major,
          schemas: ['public'],
          tls: false,
        },
      ]);
      await set('DB_WORKSPACE_TARGET_CREDENTIALS', {
        production: Object.fromEntries(
          ['read', 'write', 'maintenance', 'restore', 'roleAdmin'].map(
            (kind) => {
              const name = kind === 'roleAdmin' ? 'roles' : kind;
              return [
                kind,
                { user: result.names[name], password: result.passwords[name] },
              ];
            },
          ),
        ),
      });
      await set(
        'DB_WORKSPACE_ARTIFACT_DIRECTORY',
        '/var/lib/omnilodge/runtime/backend/database-workspace',
      );
      await fs.mkdir('/var/lib/omnilodge/runtime/backend/database-workspace', {
        recursive: true,
        mode: 0o700,
      });
      await set('DB_WORKSPACE_WORKER_MEMORY_MB', 512);
      await set('DB_WORKSPACE_WORKER_CPU_PERCENT', 50);
      await set('DB_WORKSPACE_ACTIVE_JOBS_PER_TARGET', 1);
      await set('DB_WORKSPACE_WRITES_ENABLED', true);
      await set('DB_WORKSPACE_MAINTENANCE_ENABLED', true);
      await set('DB_WORKSPACE_MAINTENANCE_POLICY', {
        operations: [
          'analyze',
          'vacuum',
          'reindex',
          'refresh',
          'ddl',
          'privilege',
          'role',
          'signal',
        ],
        timeoutMs: 120000,
        protectedApplications: ['omnilodge-release', 'omnilodge-migration'],
      });
      // Restore remains subject to measured disk/identity/tool readiness. It is
      // enabled explicitly in Control Panel after that independent drill.
      await set('DB_WORKSPACE_RESTORE_ENABLED', false);
      await ensureDatabaseWorkspaceAccess();
      const previous = await fs.readFile(envFile, 'utf8');
      if (/^DB_WORKSPACE_CONTROL_URL=/m.test(previous))
        throw new Error(
          'Bootstrap environment changed during provisioning. Preserve the partial setup for investigation.',
        );
      const temp = path.join(
        path.dirname(envFile),
        `.workspace-bootstrap-${process.pid}`,
      );
      await fs.writeFile(
        temp,
        previous.trimEnd() + `\nDB_WORKSPACE_CONTROL_URL=${url.toString()}\n`,
        { mode: 0o600, flag: 'wx' },
      );
      await fs.rename(temp, envFile);
      // Activate only after the primary backend has reloaded the newly written
      // bootstrap URL through the release control plane.
      await set('DB_WORKSPACE_ENABLED', false);
      console.log(
        JSON.stringify({
          ok: true,
          controlDatabase: 'omnilodge_workbench_control',
          grantedRelations: result.granted,
          ownershipChanges: result.ownershipChanges,
          restoreEnabled: false,
          next: 'Reload the protected environment through the release control plane, then enable Database Workspace in Control Panel and verify its worker heartbeat/restricted-role smoke. Admission remains disabled until that activation.',
          credentials: 'stored privately, not displayed',
        }),
      );
    } finally {
      await store?.close();
      await sequelize.close();
    }
  }
} finally {
  await client.end();
}
