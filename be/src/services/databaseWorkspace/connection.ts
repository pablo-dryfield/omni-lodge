import pg from 'pg';
import { WorkspaceError, type Credential, type Target } from './types.js';

export function targetClient(
  target: Target,
  credential: Credential,
  applicationName: string,
): pg.Client {
  return new pg.Client({
    host: target.host,
    port: target.port,
    database: target.database,
    user: credential.user,
    password: credential.password,
    ssl: target.tls ? { rejectUnauthorized: true, ca: target.ca } : false,
    connectionTimeoutMillis: 5000,
    application_name: applicationName,
    options:
      '-c search_path=pg_catalog,public -c timezone=UTC -c statement_timeout=30000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000',
  });
}
export async function assertRestrictedIdentity(
  client: pg.Client,
  target: Target,
): Promise<void> {
  const r = await client.query(
    `SELECT current_database() AS database, current_setting('server_version_num')::int/10000 AS major,
    r.rolsuper,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolbypassrls,
    EXISTS(SELECT 1 FROM pg_roles privileged WHERE (privileged.rolsuper OR privileged.rolcreaterole OR privileged.rolbypassrls)
      AND privileged.oid<>r.oid AND pg_has_role(current_user,privileged.oid,'MEMBER')) AS privileged_membership,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[])
      AND c.relkind IN ('r','p','v','m','f') AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_data,
    pg_has_role(current_user,(SELECT datdba FROM pg_database WHERE datname=current_database()),'MEMBER') AS owns_database,
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname=ANY($1::text[]) AND pg_has_role(current_user,n.nspowner,'MEMBER')) AS owns_schema
    ,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1::text[]) AND c.relkind='v' AND has_table_privilege(c.oid,'SELECT') AND NOT COALESCE(c.reloptions @> ARRAY['security_invoker=true'],false)
      AND NOT (c.relname IN ('pg_stat_statements','pg_stat_statements_info') AND EXISTS(SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND e.extname='pg_stat_statements'))) AS unsafe_view_grant
    ,EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1::text[]) AND p.prosecdef AND has_function_privilege(p.oid,'EXECUTE')) AS unsafe_definer_grant
    FROM pg_roles r WHERE r.rolname=current_user`,
    [target.schemas],
  );
  const role = r.rows[0];
  if (
    !role ||
    Number(role.major) !== target.major ||
    role.database !== target.database
  )
    throw new WorkspaceError(
      409,
      'TARGET_CHANGED',
      'The database identity or PostgreSQL major differs from the registered connection.',
    );
  if (
    role.rolsuper ||
    role.rolcreaterole ||
    role.rolcreatedb ||
    role.rolreplication ||
    role.rolbypassrls ||
    role.privileged_membership ||
    role.owns_data ||
    role.owns_database ||
    role.owns_schema ||
    role.unsafe_view_grant ||
    role.unsafe_definer_grant
  )
    throw new WorkspaceError(
      503,
      'UNSAFE_DATABASE_IDENTITY',
      'Provision a restricted database identity. Ordinary SQL cannot use superusers, owners, privileged memberships, owner-authorized views or executable application security-definer routines. Revoke broad PUBLIC function grants through trusted infrastructure maintenance and use security-invoker views.',
    );
}
