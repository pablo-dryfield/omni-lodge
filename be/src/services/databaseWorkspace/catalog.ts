import { targetClient, assertRestrictedIdentity } from './connection.js';
import { WorkspaceError, type Credential, type Target } from './types.js';
import { quoteIdentifier } from './filters.js';

export async function catalogQuery(
  target: Target,
  credential: Credential,
  text: string,
  values: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const c = targetClient(target, credential, 'omnilodge-workspace-catalog');
  try {
    await c.connect();
    await assertRestrictedIdentity(c, target);
    await c.query('BEGIN READ ONLY');
    await c.query("SET LOCAL statement_timeout='5000'");
    const r = await c.query(text, values);
    await c.query('ROLLBACK');
    return r.rows;
  } finally {
    await c.end().catch(() => {});
  }
}
export async function catalogObjects(
  target: Target,
  credential: Credential,
  search: string,
  protectedObjects: string[],
  schema?: string,
  offset = 0,
) {
  return catalogQuery(
    target,
    credential,
    `SELECT c.oid::text AS id,n.nspname AS schema,c.relname AS name,c.relkind AS kind,
    obj_description(c.oid,'pg_class') AS comment,c.reltuples::bigint::text AS estimated_rows,
    has_table_privilege(c.oid,'SELECT') AS readable,has_table_privilege(c.oid,'UPDATE') AS writable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND ($2='' OR c.relname ILIKE '%'||$2||'%') AND ($3::text IS NULL OR n.nspname=$3)
      AND c.relkind IN ('r','p','v','m','f','S') AND NOT(c.relname=ANY($4::text[]) OR n.nspname||'.'||c.relname=ANY($4::text[]))
    ORDER BY n.nspname,c.relname LIMIT 100 OFFSET $5`,
    [
      target.schemas,
      search.slice(0, 200),
      schema || null,
      protectedObjects,
      Math.max(0, Math.min(100000, Math.floor(offset || 0))),
    ],
  );
}
// Metadata only, independent of the explorer's filters, selected object and page.
export async function completionColumns(
  target: Target,
  credential: Credential,
  protectedObjects: string[],
  maximum: number,
) {
  const cap = Math.max(100, Math.min(50000, Math.floor(maximum)));
  const rows = await catalogQuery(
    target,
    credential,
    `SELECT n.nspname AS schema,c.relname AS table,a.attname AS name,left(format_type(a.atttypid,a.atttypmod),128) AS type
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
     WHERE n.nspname=ANY($1::text[]) AND c.relkind IN ('r','p','v','m','f')
       AND a.attnum>0 AND NOT a.attisdropped AND has_schema_privilege(n.oid,'USAGE')
       AND has_column_privilege(c.oid,a.attnum,'SELECT')
       AND NOT(c.relname=ANY($2::text[]) OR n.nspname||'.'||c.relname=ANY($2::text[]))
     ORDER BY n.nspname,c.relname,a.attnum LIMIT $3`,
    [target.schemas, protectedObjects, cap + 1],
  );
  return { columns: rows.slice(0, cap), complete: rows.length <= cap };
}
export async function relationDetails(
  target: Target,
  credential: Credential,
  oid: string,
  protectedObjects: string[],
) {
  if (!/^\d+$/.test(oid))
    throw new WorkspaceError(400, 'INVALID_OBJECT', 'Invalid database object.');
  const [relation] = await catalogQuery(
    target,
    credential,
    `SELECT c.oid::text AS id,n.nspname AS schema,c.relname AS name,c.relkind AS kind,
    obj_description(c.oid,'pg_class') AS comment,pg_total_relation_size(c.oid)::text AS size_bytes,
    c.relrowsecurity AS row_security,c.relforcerowsecurity AS force_row_security,pg_get_userbyid(c.relowner) AS owner,
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=$1::oid AND n.nspname=ANY($2::text[]) AND has_table_privilege(c.oid,'SELECT')`,
    [oid, target.schemas],
  );
  if (
    !relation ||
    protectedObjects.includes(String(relation.name)) ||
    protectedObjects.includes(`${relation.schema}.${relation.name}`)
  )
    throw new WorkspaceError(
      404,
      'OBJECT_NOT_FOUND',
      'This database object is unavailable.',
    );
  const columns = await catalogQuery(
    target,
    credential,
    `SELECT a.attnum AS ordinal,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
    t.typname AS pg_type,a.atttypid AS oid,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,
    pg_get_expr(d.adbin,d.adrelid) AS default_value,col_description(a.attrelid,a.attnum) AS comment,
    EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=a.attrelid AND k.contype='p' AND a.attnum=ANY(k.conkey)) AS primary_key
    FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1::oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,
    [oid],
  );
  const constraints = await catalogQuery(
    target,
    credential,
    `SELECT k.conname AS name,k.contype AS kind,pg_get_constraintdef(k.oid,true) AS definition,
    k.confrelid::text AS related_object,n.nspname AS target_schema,c.relname AS target_name,
    ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY x.ord) AS source_columns,
    ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.ord) AS target_columns
    FROM pg_constraint k LEFT JOIN pg_class c ON c.oid=k.confrelid LEFT JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.conrelid=$1::oid ORDER BY k.conname`,
    [oid],
  );
  const indexes = await catalogQuery(
    target,
    credential,
    `SELECT ic.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,
    i.indisunique AS unique_index,i.indisprimary AS primary_index FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=$1::oid`,
    [oid],
  );
  const policies = await catalogQuery(
    target,
    credential,
    `SELECT polname AS name,polcmd AS command,polpermissive AS permissive,
    ARRAY(SELECT pg_get_userbyid(r)::text FROM unnest(polroles) r) AS roles,pg_get_expr(polqual,polrelid) AS using,pg_get_expr(polwithcheck,polrelid) AS with_check FROM pg_policy WHERE polrelid=$1::oid`,
    [oid],
  );
  const triggers = await catalogQuery(
    target,
    credential,
    `SELECT tgname AS name,tgenabled AS enabled,pg_get_triggerdef(oid,true) AS definition FROM pg_trigger WHERE tgrelid=$1::oid AND NOT tgisinternal`,
    [oid],
  );
  const dependencies = await catalogQuery(
    target,
    credential,
    `SELECT DISTINCT pg_describe_object(d.classid,d.objid,d.objsubid) AS object,
    pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) AS referenced_object,d.deptype AS kind
    FROM pg_depend d WHERE (d.classid='pg_class'::regclass AND d.objid=$1::oid) OR (d.refclassid='pg_class'::regclass AND d.refobjid=$1::oid) LIMIT 200`,
    [oid],
  );
  const partitions = await catalogQuery(
    target,
    credential,
    `SELECT c.oid::text,c.relname AS name,n.nspname AS schema,pg_get_expr(c.relpartbound,c.oid) AS bound,
    i.inhparent::regclass::text AS parent FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE i.inhparent=$1::oid OR i.inhrelid=$1::oid`,
    [oid],
  );
  return {
    ...relation,
    id: String(relation.id),
    schema: String(relation.schema),
    name: String(relation.name),
    kind: String(relation.kind),
    qualifiedName: `${quoteIdentifier(String(relation.schema))}.${quoteIdentifier(String(relation.name))}`,
    columns,
    constraints,
    indexes,
    policies,
    triggers,
    dependencies,
    partitions,
  };
}

export async function catalogCategory(
  target: Target,
  credential: Credential,
  category: string,
  search: string,
  offset: number,
) {
  const filter = search.slice(0, 200),
    start = Math.max(0, Math.min(100000, offset || 0));
  const sql: Record<string, string> = {
    routines: `SELECT 'routine:'||p.oid::text AS id,n.nspname AS schema,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS name,
      CASE WHEN p.prokind='p' THEN 'procedure' ELSE 'function' END AS kind,obj_description(p.oid,'pg_proc') AS comment FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND p.proname ILIKE '%'||$2||'%' AND p.prokind<>'a'`,
    types: `SELECT 'type:'||t.oid::text AS id,n.nspname AS schema,t.typname AS name,CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' ELSE 'type' END AS kind,obj_description(t.oid,'pg_type') AS comment FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY($1) AND t.typname ILIKE '%'||$2||'%' AND t.typtype IN ('e','d','r')`,
    schemas: `SELECT 'schema:'||n.oid::text AS id,n.nspname AS schema,n.nspname AS name,'schema' AS kind,obj_description(n.oid,'pg_namespace') AS comment FROM pg_namespace n WHERE n.nspname=ANY($1) AND n.nspname ILIKE '%'||$2||'%'`,
    extensions: `SELECT 'extension:'||e.oid::text AS id,n.nspname AS schema,e.extname AS name,'extension' AS kind,e.extversion AS comment FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE (n.nspname=ANY($1) OR e.extname='plpgsql') AND e.extname ILIKE '%'||$2||'%'`,
    infrastructure: `SELECT 'database:'||d.oid::text AS id,'cluster'::text AS schema,d.datname AS name,'database'::text AS kind,pg_get_userbyid(d.datdba)::text AS comment FROM pg_database d WHERE d.datname ILIKE '%'||$2||'%' AND $1::text[] IS NOT NULL
      UNION ALL SELECT 'tablespace:'||t.oid::text,'cluster',t.spcname,'tablespace',pg_get_userbyid(t.spcowner) FROM pg_tablespace t WHERE t.spcname ILIKE '%'||$2||'%'
      UNION ALL SELECT 'foreignServer:'||s.oid::text,'foreign data',s.srvname,'foreignServer',pg_get_userbyid(s.srvowner) FROM pg_foreign_server s WHERE s.srvname ILIKE '%'||$2||'%'
      UNION ALL SELECT 'publication:'||p.oid::text,'replication',p.pubname,'publication',pg_get_userbyid(p.pubowner) FROM pg_publication p WHERE p.pubname ILIKE '%'||$2||'%'`,
  };
  if (!sql[category])
    throw new WorkspaceError(
      400,
      'CATALOG_CATEGORY',
      'Choose schemas, routines, types, extensions or infrastructure.',
    );
  return catalogQuery(
    target,
    credential,
    `${sql[category]} ORDER BY schema,name LIMIT 100 OFFSET $3`,
    [target.schemas, filter, start],
  );
}
export async function describeCatalogObject(
  target: Target,
  credential: Credential,
  id: string,
  protectedObjects: string[],
) {
  if (/^\d+$/.test(id))
    return relationDetails(target, credential, id, protectedObjects);
  const match =
    /^(routine|type|schema|extension|database|tablespace|foreignServer|publication):(\d+)$/.exec(
      id,
    );
  if (!match)
    throw new WorkspaceError(
      400,
      'INVALID_OBJECT',
      'Unknown catalog reference.',
    );
  const [family, oid] = match.slice(1);
  let rows: Record<string, unknown>[] = [];
  if (family === 'routine')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT n.nspname AS schema,p.proname AS name,pg_get_userbyid(p.proowner) AS owner,pg_get_functiondef(p.oid) AS definition,p.prosecdef AS security_definer,l.lanname AS language,p.provolatile AS volatility,p.proacl::text AS privileges FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=$1::oid AND n.nspname=ANY($2) AND p.prokind<>'a'`,
      [oid, target.schemas],
    );
  if (family === 'type')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT n.nspname AS schema,t.typname AS name,pg_get_userbyid(t.typowner) AS owner,t.typtype AS type_kind,format_type(t.typbasetype,t.typtypmod) AS base_type,t.typnotnull AS not_null,t.typdefault AS default_value,
    ARRAY(SELECT enumlabel::text FROM pg_enum WHERE enumtypid=t.oid ORDER BY enumsortorder) AS labels,
    ARRAY(SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE contypid=t.oid) AS constraints FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.oid=$1::oid AND n.nspname=ANY($2)`,
      [oid, target.schemas],
    );
  if (family === 'schema')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT nspname AS schema,nspname AS name,pg_get_userbyid(nspowner) AS owner,nspacl::text AS privileges,obj_description(oid,'pg_namespace') AS comment FROM pg_namespace WHERE oid=$1::oid AND nspname=ANY($2)`,
      [oid, target.schemas],
    );
  if (family === 'extension')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT n.nspname AS schema,e.extname AS name,e.extversion AS installed_version,a.default_version,pg_get_userbyid(e.extowner) AS owner,a.comment FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace LEFT JOIN pg_available_extensions a ON a.name=e.extname WHERE e.oid=$1::oid AND (n.nspname=ANY($2) OR e.extname='plpgsql')`,
      [oid, target.schemas],
    );
  if (family === 'database')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT 'cluster' AS schema,datname AS name,pg_get_userbyid(datdba) AS owner,pg_encoding_to_char(encoding) AS encoding,datcollate AS collation,datctype AS character_classification,datconnlimit AS connection_limit,datallowconn AS allows_connections,datacl::text AS privileges FROM pg_database WHERE oid=$1::oid`,
      [oid],
    );
  if (family === 'tablespace')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT 'cluster' AS schema,spcname AS name,pg_get_userbyid(spcowner) AS owner,spcacl::text AS privileges FROM pg_tablespace WHERE oid=$1::oid`,
      [oid],
    );
  if (family === 'foreignServer')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT 'foreign data' AS schema,s.srvname AS name,pg_get_userbyid(s.srvowner) AS owner,s.srvtype AS server_type,s.srvversion AS version,f.fdwname AS wrapper,ARRAY(SELECT split_part(option,'=',1)||'=<redacted>' FROM unnest(s.srvoptions) option) AS options FROM pg_foreign_server s JOIN pg_foreign_data_wrapper f ON f.oid=s.srvfdw WHERE s.oid=$1::oid`,
      [oid],
    );
  if (family === 'publication')
    rows = await catalogQuery(
      target,
      credential,
      `SELECT 'replication' AS schema,p.pubname AS name,pg_get_userbyid(p.pubowner) AS owner,p.puballtables AS all_tables,p.pubinsert AS insert,p.pubupdate AS update,p.pubdelete AS delete,p.pubtruncate AS truncate FROM pg_publication p WHERE p.oid=$1::oid`,
      [oid],
    );
  if (!rows.length)
    throw new WorkspaceError(
      404,
      'OBJECT_NOT_FOUND',
      'Catalog object unavailable.',
    );
  return {
    ...rows[0],
    id,
    kind: family,
    columns: [],
    constraints: [],
    indexes: [],
    qualifiedName: `${quoteIdentifier(String(rows[0].schema))}.${quoteIdentifier(String(rows[0].name))}`,
    definition: rows[0].definition || JSON.stringify(rows[0], null, 2),
  };
}
