import crypto from 'node:crypto';
import type pg from 'pg';
import { quoteIdentifier as q } from './filters.js';
import { WorkspaceError } from './types.js';
import {
  publicFunctionHazards,
  restrictPublicFunctions,
} from './functionBoundary.js';

/** Store a SCRAM verifier in DDL, never a usable plaintext password in pg_stat_activity. */
export function scramVerifier(password: string): string {
  const salt = crypto.randomBytes(16),
    salted = crypto.pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const client = crypto
    .createHmac('sha256', salted)
    .update('Client Key')
    .digest();
  const stored = crypto.createHash('sha256').update(client).digest('base64');
  const server = crypto
    .createHmac('sha256', salted)
    .update('Server Key')
    .digest('base64');
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
}
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;
export async function provisionWorkspaceRoles(
  client: pg.Client,
  input: {
    database: string;
    controlDatabase: string;
    prefix: string;
    protectedObjects: readonly string[];
    manageOwnership: boolean;
    restrictPublicFunctions?: boolean;
  },
) {
  if (
    !/^[a-z][a-z0-9_]{2,39}$/.test(input.prefix) ||
    !/^[a-z][a-z0-9_]{2,62}$/.test(input.controlDatabase)
  )
    throw new WorkspaceError(
      400,
      'PROVISION_NAMES',
      'Invalid fixed provisioning names.',
    );
  const identity = (
    await client.query(
      "SELECT current_database() AS database,current_user AS role,rolsuper,current_setting('server_version_num')::int/10000 AS major FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (
    identity.database !== input.database ||
    !identity.rolsuper ||
    ![16, 17].includes(Number(identity.major))
  )
    throw new WorkspaceError(
      403,
      'PROVISION_AUTHORITY',
      'Trusted provisioning requires a superuser connected to the named PostgreSQL 16/17 application database.',
    );
  const names = Object.fromEntries(
    [
      'control',
      'read',
      'write',
      'maintenance',
      'restore',
      'roles',
      'objects',
    ].map((kind) => [kind, `${input.prefix}_${kind}`]),
  );
  const passwords = Object.fromEntries(
    Object.keys(names)
      .filter((k) => k !== 'objects')
      .map((k) => [k, crypto.randomBytes(32).toString('base64url')]),
  );
  const lock = (
    await client.query(
      "SELECT pg_try_advisory_lock(hashtext('omnilodge.database-workspace.bootstrap')) AS acquired",
    )
  ).rows[0].acquired;
  if (!lock)
    throw new WorkspaceError(
      409,
      'PROVISION_BUSY',
      'Another provisioning operation is active.',
    );
  try {
    const functionHazards = await publicFunctionHazards(client, ['public']);
    if (functionHazards.length && !input.restrictPublicFunctions)
      throw new WorkspaceError(
        409,
        'PUBLIC_FUNCTION_PRIVILEGES',
        'Network/security-definer routines have PUBLIC execution grants. Review the function inventory and explicitly authorize restricting those grants before provisioning workspace identities. Existing named grants and application access are retained.',
      );
    if (functionHazards.length)
      await restrictPublicFunctions(
        client,
        String(identity.role),
        functionHazards,
      );
    for (const [kind, name] of Object.entries(names)) {
      const old = (
        await client.query(
          'SELECT rolname,rolsuper,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=$1',
          [name],
        )
      ).rows[0];
      if (old && (old.rolsuper || old.rolreplication || old.rolbypassrls))
        throw new WorkspaceError(
          409,
          'PROVISION_ROLE_CONFLICT',
          'A reserved workspace role has unexpected privileges. Preserve it for operator investigation.',
        );
      if (!old)
        await client.query(
          `CREATE ROLE ${q(name)} ${kind === 'objects' ? 'NOLOGIN' : 'LOGIN'} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
      if (kind !== 'objects')
        await client.query(
          `ALTER ROLE ${q(name)} LOGIN NOSUPERUSER ${kind === 'restore' ? 'CREATEDB' : 'NOCREATEDB'} ${kind === 'roles' ? 'CREATEROLE' : 'NOCREATEROLE'} NOREPLICATION NOBYPASSRLS PASSWORD ${literal(scramVerifier(passwords[kind]))}`,
        );
      else
        await client.query(
          `ALTER ROLE ${q(name)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
    }
    const oldDatabase = (
      await client.query(
        'SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',
        [input.controlDatabase],
      )
    ).rows[0];
    if (oldDatabase && oldDatabase.owner !== names.control)
      throw new WorkspaceError(
        409,
        'PROVISION_DATABASE_CONFLICT',
        'The independent control database exists with another owner. It will not be adopted or overwritten.',
      );
    if (!oldDatabase)
      await client.query(
        `CREATE DATABASE ${q(input.controlDatabase)} OWNER ${q(names.control)} TEMPLATE template0`,
      );
    await client.query(
      `REVOKE ALL ON DATABASE ${q(input.controlDatabase)} FROM PUBLIC`,
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${q(input.controlDatabase)} TO ${q(names.control)}`,
    );
    const relations = (
      await client.query(
        "SELECT c.oid::text,c.relname,c.relkind,COALESCE(c.reloptions @> ARRAY['security_invoker=true'],false) AS invoker_view FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') ORDER BY c.relname",
      )
    ).rows;
    for (const role of [names.read, names.write, names.maintenance]) {
      await client.query(
        `GRANT CONNECT ON DATABASE ${q(input.database)} TO ${q(role)}`,
      );
      await client.query(`GRANT USAGE ON SCHEMA public TO ${q(role)}`);
      await client.query(
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${q(role)}`,
      );
      await client.query(
        `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${q(role)}`,
      );
      for (const [setting, value] of Object.entries({
        statement_timeout: '30s',
        lock_timeout: '2s',
        idle_in_transaction_session_timeout: '30s',
        work_mem: '4MB',
        temp_file_limit: '64MB',
        max_parallel_workers_per_gather: '0',
      }))
        await client.query(
          `ALTER ROLE ${q(role)} SET ${setting}=${literal(value)}`,
        );
    }
    let granted = 0,
      ownershipChanges = 0;
    for (const relation of relations) {
      const name = String(relation.relname);
      if (
        input.protectedObjects.includes(name) ||
        input.protectedObjects.includes(`public.${name}`) ||
        (relation.relkind === 'v' && !relation.invoker_view)
      )
        continue;
      const table = `public.${q(name)}`;
      if (input.manageOwnership) {
        await client.query(
          `ALTER ${relation.relkind === 'm' ? 'MATERIALIZED VIEW' : relation.relkind === 'v' ? 'VIEW' : 'TABLE'} ${table} OWNER TO ${q(names.objects)}`,
        );
        ownershipChanges++;
        // An application that later becomes nonsuperuser retains explicit DML.
        await client.query(
          `GRANT ALL ON TABLE ${table} TO ${q(String(identity.role))}`,
        );
      }
      await client.query(
        `GRANT SELECT ON TABLE ${table} TO ${q(names.read)},${q(names.maintenance)}`,
      );
      if (['r', 'p', 'v'].includes(relation.relkind))
        await client.query(
          `GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE ${table} TO ${q(names.write)}`,
        );
      const sequences = (
        await client.query(
          "SELECT s.oid::regclass::text AS name FROM pg_class s JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid WHERE s.relkind='S' AND d.refclassid='pg_class'::regclass AND d.refobjid=$1::oid AND d.deptype IN ('a','i')",
          [relation.oid],
        )
      ).rows;
      for (const sequence of sequences)
        await client.query(
          `GRANT USAGE,SELECT ON SEQUENCE ${sequence.name} TO ${q(names.write)}`,
        );
      granted++;
    }
    await client.query(`GRANT pg_read_all_stats TO ${q(names.read)}`);
    if (Number(identity.major) >= 17)
      await client.query(`GRANT pg_maintain TO ${q(names.maintenance)}`);
    await client.query(
      `GRANT CREATE ON SCHEMA public TO ${q(names.maintenance)}`,
    );
    if (input.manageOwnership)
      await client.query(
        `GRANT ${q(names.objects)} TO ${q(names.maintenance)} WITH INHERIT TRUE, SET TRUE`,
      );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(names.maintenance)} IN SCHEMA public GRANT SELECT ON TABLES TO ${q(names.read)}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(names.maintenance)} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${q(names.write)}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${q(names.maintenance)} IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ${q(names.write)}`,
    );
    return {
      names,
      passwords,
      major: Number(identity.major) as 16 | 17,
      granted,
      ownershipChanges,
    };
  } finally {
    await client
      .query(
        "SELECT pg_advisory_unlock(hashtext('omnilodge.database-workspace.bootstrap'))",
      )
      .catch(() => {});
  }
}
