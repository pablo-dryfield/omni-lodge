import { PgParser } from '@supabase/pg-parser';
import { walkTree } from './parser.js';
import { quoteIdentifier } from './filters.js';
import { catalogQuery, relationDetails } from './catalog.js';
import { operationHash } from './store.js';
import {
  WorkspaceError,
  type Target,
  type Credential,
  type JobPayload,
} from './types.js';

const ddlKinds = new Set([
  'CreateStmt',
  'AlterTableStmt',
  'DropStmt',
  'RenameStmt',
  'IndexStmt',
  'ViewStmt',
  'CreateSeqStmt',
  'AlterSeqStmt',
  'CreateFunctionStmt',
  'CreateTrigStmt',
  'AlterFunctionStmt',
  'CreateEnumStmt',
  'AlterEnumStmt',
  'CreateDomainStmt',
  'AlterDomainStmt',
  'CompositeTypeStmt',
  'CreateSchemaStmt',
  'CommentStmt',
  'CreatePolicyStmt',
  'AlterPolicyStmt',
]);
const forbidden = new Set([
  'AlterOwnerStmt',
  'GrantStmt',
  'GrantRoleStmt',
  'CreateRoleStmt',
  'AlterRoleStmt',
  'DropRoleStmt',
  'DoStmt',
  'CallStmt',
  'CopyStmt',
  'VariableSetStmt',
  'AlterSystemStmt',
  'CreateExtensionStmt',
  'AlterExtensionStmt',
  'CreateFdwStmt',
  'CreateForeignServerStmt',
  'CreateUserMappingStmt',
  'AlterUserMappingStmt',
  'CreateSubscriptionStmt',
  'AlterSubscriptionStmt',
  'CreatedbStmt',
  'DropdbStmt',
  'CreateTableSpaceStmt',
]);
export async function parseDDL(
  sql: unknown,
  target: Target,
  maxBytes: number,
  maxStatements: number,
  protectedObjects: string[],
): Promise<{
  sql: string[];
  atomic: boolean;
  kinds: string[];
  lockRelations: string[];
}> {
  if (
    typeof sql !== 'string' ||
    !sql.trim() ||
    Buffer.byteLength(sql) > maxBytes
  )
    throw new WorkspaceError(
      400,
      'DDL_SIZE',
      'Enter a schema script within the SQL byte limit.',
    );
  const parser = new PgParser({ version: target.major }),
    parsed = await parser.parse(sql);
  if (parsed.error)
    throw new WorkspaceError(400, 'SQL_SYNTAX', parsed.error.message, {
      position: parsed.error.position,
    });
  const statements = parsed.tree.stmts as Array<{
    stmt: Record<string, unknown>;
    stmt_location?: number;
    stmt_len?: number;
  }>;
  if (!statements?.length || statements.length > maxStatements)
    throw new WorkspaceError(
      400,
      'STATEMENT_LIMIT',
      'The schema script exceeds the configured statement limit.',
    );
  let atomic = true;
  const bytes = Buffer.from(sql),
    output: string[] = [],
    kinds: string[] = [];
  const lockRelations = new Set<string>();
  for (const statement of statements) {
    const kind = Object.keys(statement.stmt)[0];
    if (kind === 'ViewStmt') {
      const view = statement.stmt.ViewStmt as {
        options?: Array<{
          DefElem?: {
            defname?: string;
            arg?: {
              Boolean?: { boolval?: boolean };
              String?: { sval?: string };
            };
          };
        }>;
      };
      const invoker = view.options?.some(
        (o) =>
          o.DefElem?.defname === 'security_invoker' &&
          (o.DefElem.arg?.Boolean?.boolval === true ||
            ['true', 'on'].includes(o.DefElem.arg?.String?.sval || '')),
      );
      if (!invoker)
        throw new WorkspaceError(
          403,
          'INVOKER_VIEW_REQUIRED',
          'Views must specify WITH (security_invoker=true) so reads cannot inherit their owner’s access to protected data.',
        );
    }
    if (!ddlKinds.has(kind))
      throw new WorkspaceError(
        403,
        'DDL_WORKFLOW',
        'Use a supported schema operation. Role, extension, network, database and filesystem operations require their dedicated administration workflow.',
      );
    walkTree(statement.stmt, (key, node) => {
      if (forbidden.has(key))
        throw new WorkspaceError(
          403,
          'DDL_WORKFLOW',
          'This nested operation is outside schema-development policy.',
        );
      if (key === 'RangeVar') {
        const schema = String(node.schemaname || 'public'),
          name = String(node.relname || '');
        lockRelations.add(qualified(schema, name));
        if (
          node.catalogname ||
          !target.schemas.includes(schema) ||
          protectedObjects.some((p) => p === name || p === `${schema}.${name}`)
        )
          throw new WorkspaceError(
            403,
            'PROTECTED_OBJECT',
            'Schema changes cannot reference protected or unregistered objects.',
          );
      }
      if (key === 'String' && protectedObjects.includes(String(node.sval)))
        throw new WorkspaceError(
          403,
          'PROTECTED_OBJECT',
          'The script references a protected control object.',
        );
      if (node.behavior === 'DROP_CASCADE' || node.subtype === 'AT_ChangeOwner')
        throw new WorkspaceError(
          403,
          'DDL_DEPENDENCY_REVIEW',
          'Cascading drops and ownership changes require a separate infrastructure review.',
        );
      if (
        typeof node.schemaname === 'string' &&
        node.schemaname &&
        !target.schemas.includes(node.schemaname)
      )
        throw new WorkspaceError(
          403,
          'SCHEMA_NOT_ALLOWED',
          'The schema is outside the registered target.',
        );
      const checkName = (value: unknown) => {
        if (!Array.isArray(value)) return;
        const parts = value.map(
          (v) => (v as { String?: { sval?: string } })?.String?.sval,
        );
        if (parts.some((v) => !v)) return;
        if (
          key === 'DropStmt' &&
          [
            'OBJECT_TABLE',
            'OBJECT_VIEW',
            'OBJECT_MATVIEW',
            'OBJECT_INDEX',
          ].includes(String(node.removeType))
        )
          lockRelations.add(
            qualified(
              parts.length === 2 ? parts[0]! : 'public',
              parts[parts.length - 1]!,
            ),
          );
        if (
          parts.length > 2 ||
          (parts.length === 2 && !target.schemas.includes(parts[0]!))
        )
          throw new WorkspaceError(
            403,
            'SCHEMA_NOT_ALLOWED',
            'The object is outside the registered schemas.',
          );
      };
      if (key === 'DropStmt')
        for (const object of (node.objects as Array<{
          List?: { items?: unknown[] };
        }>) || [])
          checkName(object.List?.items);
      if (key === 'CreateFunctionStmt') checkName(node.funcname);
      if (
        [
          'CreateEnumStmt',
          'AlterEnumStmt',
          'CreateDomainStmt',
          'AlterDomainStmt',
        ].includes(key)
      )
        checkName(node.typeName || node.typeNameList || node.domainname);
      if (
        key === 'DefElem' &&
        node.defname === 'security' &&
        (node.arg as { Boolean?: { boolval?: boolean } })?.Boolean?.boolval
      )
        throw new WorkspaceError(
          403,
          'SECURITY_DEFINER',
          'Security-definer routines require infrastructure review outside this workspace.',
        );
      if (key === 'DefElem' && node.defname === 'language') {
        const arg = node.arg as { String?: { sval?: string } };
        if (
          arg?.String?.sval &&
          !['sql', 'plpgsql'].includes(arg.String.sval.toLowerCase())
        )
          throw new WorkspaceError(
            403,
            'ROUTINE_LANGUAGE',
            'Only SQL and PL/pgSQL invoker routines are supported.',
          );
      }
      if (node.concurrent || node.concurrently) atomic = false;
    });
    if (kind === 'AlterEnumStmt') atomic = false;
    const start = statement.stmt_location || 0,
      end = statement.stmt_len ? start + statement.stmt_len : bytes.length;
    output.push(bytes.subarray(start, end).toString('utf8').trim());
    kinds.push(kind);
  }
  if (!atomic && statements.length !== 1)
    throw new WorkspaceError(
      400,
      'NONATOMIC_BATCH',
      'Run each concurrent or enum operation as its own reviewed job.',
    );
  return {
    sql: output,
    atomic,
    kinds,
    lockRelations: [...lockRelations].sort(),
  };
}
export async function schemaStateHash(
  target: Target,
  credential: Credential,
): Promise<string> {
  const rows = await catalogQuery(
    target,
    credential,
    `SELECT c.oid::text,n.nspname,c.relname,c.relkind,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY k.conname) FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
    (SELECT jsonb_agg(pg_get_expr(d.adbin,d.adrelid) ORDER BY d.adnum) FROM pg_attrdef d WHERE d.adrelid=c.oid) AS defaults,
    (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
    (SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.objsubid) FROM pg_description d WHERE d.classoid='pg_class'::regclass AND d.objoid=c.oid) AS comments,
    c.reloptions,
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid) END AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) ORDER BY c.oid`,
    [target.schemas],
  );
  const objects = await catalogQuery(
    target,
    credential,
    `SELECT
    (SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND p.prokind IN ('f','p')) AS routines,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.oid) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY($1) AND t.typtype IN ('e','d','c')) AS types,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.oid) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY($1)) AS enum_values,
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.seqrelid) FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1)) AS sequences`,
    [target.schemas],
  );
  return operationHash({ relations: rows, objects });
}
export async function prepareMaintenance(
  target: Target,
  readCredential: Credential,
  protectedObjects: string[],
  request: Record<string, unknown>,
  actingRole?: string,
): Promise<NonNullable<JobPayload['administration']>> {
  const kind = String(request.kind || ''),
    oid = String(request.objectId || '');
  const schemaHash = await schemaStateHash(target, readCredential);
  if (kind === 'signal') {
    const s = request.session as Record<string, unknown>;
    if (
      !s ||
      !Number.isSafeInteger(s.pid) ||
      typeof s.backendStart !== 'string' ||
      typeof s.queryStart !== 'string' ||
      typeof s.applicationName !== 'string' ||
      typeof s.user !== 'string'
    )
      throw new WorkspaceError(
        400,
        'SESSION_IDENTITY',
        'Select an exact current database session.',
      );
    return {
      kind,
      sql: [],
      atomic: false,
      action: 'monitor',
      signal: {
        pid: Number(s.pid),
        backendStart: s.backendStart,
        queryStart: s.queryStart,
        applicationName: s.applicationName,
        user: s.user,
        terminate: request.terminate === true,
      },
    };
  }
  const details = await relationDetails(
      target,
      readCredential,
      oid,
      protectedObjects,
    ),
    name = details.qualifiedName;
  if (actingRole) {
    const [permission] = await catalogQuery(
      target,
      readCredential,
      `SELECT pg_has_role($2,relowner,'USAGE') OR ${target.major >= 17 ? "has_table_privilege($2,oid,'MAINTAIN')" : "pg_has_role($2,(SELECT datdba FROM pg_database WHERE datname=current_database()),'USAGE')"} AS allowed FROM pg_class WHERE oid=$1::oid`,
      [oid, actingRole],
    );
    if (!permission?.allowed)
      throw new WorkspaceError(
        403,
        'MAINTENANCE_PRIVILEGE',
        `The registered maintenance identity lacks ${target.major >= 17 ? 'MAINTAIN or ownership' : 'ownership (PostgreSQL 16 has no MAINTAIN privilege)'} for this object. Provision a dedicated nonprivileged object-owner role through infrastructure maintenance; never grant the application superuser role.`,
      );
  }
  if (!['analyze', 'vacuum', 'reindex', 'refresh'].includes(kind))
    throw new WorkspaceError(
      400,
      'MAINTENANCE_OPERATION',
      'Choose Analyze, Vacuum, Reindex or materialized-view refresh.',
    );
  if (kind === 'refresh' && details.kind !== 'm')
    throw new WorkspaceError(
      400,
      'MATERIALIZED_VIEW_REQUIRED',
      'Refresh requires a materialized view.',
    );
  if (kind !== 'refresh' && !['r', 'p', 'm'].includes(details.kind))
    throw new WorkspaceError(
      400,
      'TABLE_REQUIRED',
      'Choose a table or materialized view.',
    );
  const concurrent = request.concurrent === true;
  if (
    kind === 'refresh' &&
    concurrent &&
    !details.indexes.some((i) => i.unique_index && i.valid)
  )
    throw new WorkspaceError(
      400,
      'UNIQUE_INDEX_REQUIRED',
      'Concurrent refresh requires a valid unique index that covers all rows; verify its predicate and expressions before proceeding.',
    );
  const sql =
    kind === 'analyze'
      ? `ANALYZE ${name}`
      : kind === 'vacuum'
        ? `VACUUM (ANALYZE, PARALLEL 0) ${name}`
        : kind === 'reindex'
          ? `REINDEX TABLE ${concurrent ? 'CONCURRENTLY ' : ''}${name}`
          : `REFRESH MATERIALIZED VIEW ${concurrent ? 'CONCURRENTLY ' : ''}${name}`;
  return {
    kind,
    sql: [sql],
    atomic: kind !== 'vacuum' && !(kind === 'reindex' && concurrent),
    action: 'maintenance',
    schemaHash,
    postCheck: { kind, oid },
  };
}
export const qualified = (schema: string, name: string) =>
  `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
