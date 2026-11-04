import { catalogQuery, relationDetails } from './catalog.js';
import { quoteIdentifier } from './filters.js';
import {
  WorkspaceError,
  type Target,
  type Credential,
  type JobPayload,
} from './types.js';
import { operationHash } from './store.js';
export async function privilegeStateHash(
  target: Target,
  credential: Credential,
): Promise<string> {
  const roles = await catalogQuery(
    target,
    credential,
    'SELECT oid,rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit,rolcanlogin FROM pg_roles ORDER BY oid',
  );
  const membership = await catalogQuery(
    target,
    credential,
    `SELECT roleid,member,grantor,admin_option${target.major >= 16 ? ',inherit_option,set_option' : ''} FROM pg_auth_members ORDER BY roleid,member,grantor`,
  );
  const grants = await catalogQuery(
    target,
    credential,
    'SELECT oid,relacl::text FROM pg_class WHERE relnamespace IN(SELECT oid FROM pg_namespace WHERE nspname=ANY($1)) ORDER BY oid',
    [target.schemas],
  );
  const defaults = await catalogQuery(
    target,
    credential,
    'SELECT defaclrole,defaclnamespace,defaclobjtype,defaclacl::text FROM pg_default_acl ORDER BY oid',
  );
  const schemas = await catalogQuery(
    target,
    credential,
    'SELECT oid,nspacl::text FROM pg_namespace WHERE nspname=ANY($1) ORDER BY oid',
    [target.schemas],
  );
  return operationHash({ roles, membership, grants, defaults, schemas });
}

export async function privilegeSnapshot(
  target: Target,
  credential: Credential,
  protectedRoles: string[],
) {
  const roles = await catalogQuery(
    target,
    credential,
    `SELECT oid::text,rolname AS name,rolsuper AS superuser,rolinherit AS inherit,rolcreaterole AS create_roles,rolcreatedb AS create_databases,rolcanlogin AS login,rolreplication AS replication,rolbypassrls AS bypass_rls,rolconnlimit AS connection_limit,rolvaliduntil::text AS valid_until FROM pg_roles ORDER BY rolname`,
  );
  const memberships = await catalogQuery(
    target,
    credential,
    `SELECT pg_get_userbyid(roleid) AS role,pg_get_userbyid(member) AS member,admin_option${target.major >= 16 ? ',inherit_option,set_option' : ''} FROM pg_auth_members ORDER BY roleid,member`,
  );
  const grants = await catalogQuery(
    target,
    credential,
    `SELECT n.nspname AS schema,c.relname AS object,pg_get_userbyid(c.relowner) AS owner,
    CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type AS privilege,x.is_grantable AS grant_option FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x WHERE n.nspname=ANY($1) ORDER BY n.nspname,c.relname,grantee LIMIT 5000`,
    [target.schemas],
  );
  const defaults = await catalogQuery(
    target,
    credential,
    `SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname AS schema,d.defaclobjtype AS object_type,CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,x.privilege_type AS privilege,x.is_grantable AS grant_option FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(d.defaclacl) x WHERE n.nspname IS NULL OR n.nspname=ANY($1)`,
    [target.schemas],
  );
  return {
    roles: roles.map((r) => ({
      ...r,
      protected:
        protectedRoles.includes(String(r.name)) ||
        String(r.name).startsWith('pg_') ||
        r.superuser,
    })),
    memberships,
    grants,
    defaults,
    notice:
      'PostgreSQL roles are separate from OmniLodge user types. Passwords and connection secrets are never returned.',
  };
}
export async function preparePrivilege(
  target: Target,
  credential: Credential,
  protectedObjects: string[],
  protectedRoles: string[],
  request: Record<string, unknown>,
): Promise<NonNullable<JobPayload['administration']>> {
  const role = String(request.role || ''),
    operation = String(request.operation || ''),
    scope = String(request.scope || 'table');
  if (
    !role ||
    role === 'PUBLIC' ||
    role.startsWith('pg_') ||
    protectedRoles.includes(role)
  )
    throw new WorkspaceError(
      403,
      'PROTECTED_ROLE',
      'This service/system identity is protected from workbench privilege changes.',
    );
  const exists = await catalogQuery(
    target,
    credential,
    `WITH RECURSIVE linked(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname=ANY($2::text[])
    UNION SELECT CASE WHEN a.roleid=l.oid THEN a.member ELSE a.roleid END FROM pg_auth_members a JOIN linked l ON a.roleid=l.oid OR a.member=l.oid ${target.major >= 16 ? 'WHERE a.inherit_option OR a.set_option' : ''})
    SELECT oid FROM pg_roles WHERE rolname=$1 AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND oid NOT IN (SELECT oid FROM linked)`,
    [role, protectedRoles],
  );
  if (!exists.length || !['grant', 'revoke'].includes(operation))
    throw new WorkspaceError(
      400,
      'PRIVILEGE_REQUEST',
      'Choose an existing ordinary database role and Grant or Revoke.',
    );
  const privileges = request.privileges;
  const allow =
    scope === 'sequence'
      ? ['SELECT', 'USAGE', 'UPDATE']
      : scope === 'schema'
        ? ['USAGE', 'CREATE']
        : ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER'];
  if (
    !Array.isArray(privileges) ||
    !privileges.length ||
    privileges.some((p) => typeof p !== 'string' || !allow.includes(p))
  )
    throw new WorkspaceError(
      400,
      'PRIVILEGE_REQUEST',
      'Choose explicit supported object privileges.',
    );
  let object = '';
  if (scope === 'schema' || scope === 'defaults') {
    const schema = String(request.schema || '');
    if (!target.schemas.includes(schema))
      throw new WorkspaceError(
        400,
        'SCHEMA_NOT_ALLOWED',
        'Choose a registered schema.',
      );
    object = `SCHEMA ${quoteIdentifier(schema)}`;
  } else {
    const details = await relationDetails(
      target,
      credential,
      String(request.objectId || ''),
      protectedObjects,
    );
    if ((scope === 'sequence') !== (details.kind === 'S'))
      throw new WorkspaceError(
        400,
        'PRIVILEGE_OBJECT',
        'Match the privilege scope to the selected object.',
      );
    object = `${scope === 'sequence' ? 'SEQUENCE' : 'TABLE'} ${details.qualifiedName}`;
  }
  const prefix =
    scope === 'defaults'
      ? `ALTER DEFAULT PRIVILEGES IN SCHEMA ${quoteIdentifier(String(request.schema))} `
      : '';
  const sql = `${prefix}${operation === 'grant' ? 'GRANT' : 'REVOKE'} ${privileges.join(', ')} ON ${scope === 'defaults' ? 'TABLES' : object} ${operation === 'grant' ? 'TO' : 'FROM'} ${quoteIdentifier(role)}`;
  return {
    kind: 'privilege',
    sql: [sql],
    atomic: true,
    action: 'privileges',
    privilegeHash: await privilegeStateHash(target, credential),
  };
}
export async function prepareRoleChange(
  target: Target,
  credential: Credential,
  protectedRoles: string[],
  request: Record<string, unknown>,
): Promise<NonNullable<JobPayload['administration']>> {
  if (target.major < 16)
    throw new WorkspaceError(
      409,
      'ROLE_VERSION',
      'Role management requires PostgreSQL 16 or newer membership semantics.',
    );
  const role = String(request.role || ''),
    member = String(request.member || ''),
    operation = String(request.operation || '');
  const safe = (name: string) =>
    /^[a-z][a-z0-9_]{0,62}$/.test(name) &&
    !name.startsWith('pg_') &&
    !name.startsWith('omnilodge_') &&
    !protectedRoles.includes(name) &&
    name !== 'public';
  if (
    !safe(role) ||
    (['grantMembership', 'revokeMembership'].includes(operation) &&
      !safe(member))
  )
    throw new WorkspaceError(
      403,
      'PROTECTED_ROLE',
      'Choose ordinary role names outside the protected service/system identities.',
    );
  const connected = await catalogQuery(
    target,
    credential,
    `WITH RECURSIVE linked(oid) AS (
    SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[]) UNION
    SELECT CASE WHEN a.roleid=l.oid THEN a.member ELSE a.roleid END FROM pg_auth_members a JOIN linked l ON a.roleid=l.oid OR a.member=l.oid ${target.major >= 16 ? 'WHERE a.inherit_option OR a.set_option' : ''})
    SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,oid IN(SELECT oid FROM linked) AS protected FROM pg_roles WHERE rolname=ANY($2::text[])`,
    [protectedRoles, [role, member].filter(Boolean)],
  );
  if (
    connected.some(
      (r) =>
        r.protected ||
        r.rolsuper ||
        r.rolcreatedb ||
        r.rolcreaterole ||
        r.rolreplication ||
        r.rolbypassrls,
    )
  )
    throw new WorkspaceError(
      403,
      'PROTECTED_ROLE',
      'This role is privileged or connected to a protected identity.',
    );
  if (operation !== 'create' && !connected.some((r) => r.rolname === role))
    throw new WorkspaceError(404, 'ROLE_NOT_FOUND', 'Role not found.');
  let sql = '';
  if (operation === 'create') {
    if (connected.some((r) => r.rolname === role))
      throw new WorkspaceError(409, 'ROLE_EXISTS', 'This role already exists.');
    sql = `CREATE ROLE ${quoteIdentifier(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`;
  } else if (operation === 'rename') {
    const name = String(request.newName || '');
    if (!safe(name))
      throw new WorkspaceError(
        400,
        'ROLE_NAME',
        'Use a safe ordinary role name.',
      );
    sql = `ALTER ROLE ${quoteIdentifier(role)} RENAME TO ${quoteIdentifier(name)}`;
  } else if (operation === 'disableLogin')
    sql = `ALTER ROLE ${quoteIdentifier(role)} NOLOGIN`;
  else if (operation === 'drop') sql = `DROP ROLE ${quoteIdentifier(role)}`;
  else if (['grantMembership', 'revokeMembership'].includes(operation)) {
    if (role === member || !connected.some((r) => r.rolname === member))
      throw new WorkspaceError(
        400,
        'ROLE_MEMBERSHIP',
        'Choose two different existing ordinary roles.',
      );
    sql = `${operation === 'grantMembership' ? 'GRANT' : 'REVOKE'} ${quoteIdentifier(role)} ${operation === 'grantMembership' ? 'TO' : 'FROM'} ${quoteIdentifier(member)}`;
  } else
    throw new WorkspaceError(
      400,
      'ROLE_OPERATION',
      'Choose Create NOLOGIN role, Rename, Disable login, Drop, Grant membership or Revoke membership.',
    );
  return {
    kind: 'role',
    sql: [sql],
    atomic: true,
    action: 'privileges',
    privilegeHash: await privilegeStateHash(target, credential),
  };
}
