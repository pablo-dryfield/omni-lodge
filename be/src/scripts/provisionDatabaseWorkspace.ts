import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import pg from 'pg';

// This bootstrap deliberately refuses remote hosts. Production provisioning is
// a reviewed release-control-plane operation, never a browser request.
const envPath = path.resolve(process.cwd(), '.env.dev');
dotenv.config({ path: envPath });
if (
  !process.argv.includes('--local') ||
  !['localhost', '127.0.0.1', '::1'].includes(process.env.DB_HOST || '')
)
  throw new Error(
    'Use --local with a loopback development database. Remote provisioning is refused.',
  );
const { quoteIdentifier } = await import(
  '../services/databaseWorkspace/filters.js'
);
const { WorkspaceStore } = await import(
  '../services/databaseWorkspace/store.js'
);
const { default: sequelize } = await import('../config/database.js');
const { initializeConfigRegistry, updateConfigValue, getConfigValue } =
  await import('../services/configService.js');
const { ensureDatabaseWorkspaceAccess } = await import(
  '../services/databaseWorkspace/accessSeed.js'
);
const { WORKSPACE_CONTROL_OBJECTS } = await import(
  '../config/databaseWorkspacePolicy.js'
);
const c = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const controlName = 'omnilodge_workbench_control';
const names = {
  control: 'omnilodge_dw_local_control',
  read: 'omnilodge_dw_local_read',
  write: 'omnilodge_dw_local_write',
  maintenance: 'omnilodge_dw_local_maintenance',
  restore: 'omnilodge_dw_local_restore',
  roleAdmin: 'omnilodge_dw_local_roles',
};
const passwords = Object.fromEntries(
  Object.keys(names).map((k) => [
    k,
    crypto.randomBytes(32).toString('base64url'),
  ]),
);
let control: InstanceType<typeof WorkspaceStore> | undefined;
try {
  await c.connect();
  const info = await c.query(
    "SELECT current_setting('server_version_num')::int/10000 AS major",
  );
  if (![15, 16, 17].includes(info.rows[0].major))
    throw new Error(
      'Local PostgreSQL major is not supported by the configured parser.',
    );
  for (const [kind, name] of Object.entries(names)) {
    const exists = await c.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [
      name,
    ]);
    if (!exists.rowCount)
      await c.query(
        `CREATE ROLE ${quoteIdentifier(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
    await c.query(
      `ALTER ROLE ${quoteIdentifier(name)} PASSWORD ${literal(passwords[kind])}`,
    );
  }
  if (
    !(
      await c.query('SELECT 1 FROM pg_database WHERE datname=$1', [controlName])
    ).rowCount
  )
    await c.query(
      `CREATE DATABASE ${quoteIdentifier(controlName)} OWNER ${quoteIdentifier(names.control)}`,
    );
  await c.query(
    `REVOKE CONNECT ON DATABASE ${quoteIdentifier(controlName)} FROM PUBLIC`,
  );
  await c.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(controlName)} TO ${quoteIdentifier(names.control)}`,
  );
  await initializeConfigRegistry();
  const protectedObjects = [
    ...WORKSPACE_CONTROL_OBJECTS,
    ...(getConfigValue('DB_WORKSPACE_PROTECTED_OBJECTS') as string[]),
  ];
  for (const name of [names.read, names.write, names.maintenance]) {
    await c.query(
      `GRANT CONNECT ON DATABASE ${quoteIdentifier(process.env.DB_NAME!)} TO ${quoteIdentifier(name)}`,
    );
    await c.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(name)}`);
    await c.query(
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${quoteIdentifier(name)}`,
    );
    await c.query(
      `ALTER ROLE ${quoteIdentifier(name)} SET statement_timeout='30s'`,
    );
    await c.query(`ALTER ROLE ${quoteIdentifier(name)} SET lock_timeout='2s'`);
    await c.query(
      `ALTER ROLE ${quoteIdentifier(name)} SET idle_in_transaction_session_timeout='30s'`,
    );
    await c.query(`ALTER ROLE ${quoteIdentifier(name)} SET work_mem='4MB'`);
    await c.query(
      `ALTER ROLE ${quoteIdentifier(name)} SET temp_file_limit='64MB'`,
    );
    await c.query(
      `ALTER ROLE ${quoteIdentifier(name)} SET max_parallel_workers_per_gather=0`,
    );
  }
  const relations = await c.query(
    "SELECT relname,c.relkind,COALESCE(c.reloptions @> ARRAY['security_invoker=true'],false) AS invoker_view FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')",
  );
  for (const { relname, relkind, invoker_view } of relations.rows) {
    if (
      protectedObjects.includes(relname) ||
      protectedObjects.includes(`public.${relname}`)
      || (relkind==='v' && !invoker_view)
    )
      continue;
    await c.query(
      `GRANT SELECT ON TABLE public.${quoteIdentifier(relname)} TO ${quoteIdentifier(names.read)}`,
    );
    await c.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.${quoteIdentifier(relname)} TO ${quoteIdentifier(names.write)}`,
    );
    await c.query(
      `GRANT SELECT ON TABLE public.${quoteIdentifier(relname)} TO ${quoteIdentifier(names.maintenance)}`,
    );
  }
  await c.query(
    `GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(names.write)}`,
  );
  await c.query(`GRANT pg_read_all_stats TO ${quoteIdentifier(names.read)}`);
  if (info.rows[0].major >= 17)
    await c.query(`GRANT pg_maintain TO ${quoteIdentifier(names.maintenance)}`);
  await c.query(
    `GRANT USAGE,CREATE ON SCHEMA public TO ${quoteIdentifier(names.maintenance)}`,
  );
  await c.query(`ALTER ROLE ${quoteIdentifier(names.restore)} CREATEDB`);
  if (info.rows[0].major >= 16)
    await c.query(`ALTER ROLE ${quoteIdentifier(names.roleAdmin)} CREATEROLE`);
  await c.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(names.maintenance)} IN SCHEMA public GRANT SELECT ON TABLES TO ${quoteIdentifier(names.read)}`,
  );
  await c.query(
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(names.maintenance)} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${quoteIdentifier(names.write)}`,
  );
  const url = new URL('postgresql://localhost');
  url.hostname = process.env.DB_HOST!;
  url.port = process.env.DB_PORT || '5432';
  url.pathname = controlName;
  url.username = names.control;
  url.password = passwords.control;
  let privateEnv = fs.readFileSync(envPath, 'utf8');
  privateEnv =
    privateEnv.replace(/^DB_WORKSPACE_CONTROL_URL=.*\r?\n?/gm, '').trimEnd() +
    `\nDB_WORKSPACE_CONTROL_URL=${url.toString()}\n`;
  fs.writeFileSync(envPath, privateEnv, { mode: 0o600 });
  process.env.DB_WORKSPACE_CONTROL_URL = url.toString();
  control = new WorkspaceStore(url.toString());
  await control.initialize();
  const set = async (key: string, value: unknown) =>
    updateConfigValue({
      key,
      value,
      actorId: null,
      reason: 'Local Database Workspace provisioning',
    });
  await set('DB_WORKSPACE_TARGETS', [
    {
      id: 'local',
      label: 'Local database',
      environment: 'development',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      major: info.rows[0].major,
      schemas: ['public'],
      tls: false,
    },
  ]);
  await set('DB_WORKSPACE_TARGET_CREDENTIALS', {
    local: {
      read: { user: names.read, password: passwords.read },
      write: { user: names.write, password: passwords.write },
      maintenance: { user: names.maintenance, password: passwords.maintenance },
      restore: { user: names.restore, password: passwords.restore },
      roleAdmin: { user: names.roleAdmin, password: passwords.roleAdmin },
    },
  });
  await set('DB_WORKSPACE_ENABLED', true);
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
    ],
    timeoutMs: 120000,
    protectedApplications: ['omnilodge-release', 'omnilodge-migration'],
  });
  await ensureDatabaseWorkspaceAccess();
  console.log(
    JSON.stringify({
      ok: true,
      scope: 'local only',
      controlDatabase: controlName,
      major: info.rows[0].major,
      credentials: 'saved privately; not displayed',
    }),
  );
} finally {
  await c.end().catch(() => {});
  await control?.close();
  await sequelize.close();
}
