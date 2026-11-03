import { targetClient, assertRestrictedIdentity } from './connection.js';
import { WorkspaceError, type Credential, type Target } from './types.js';
import { quoteIdentifier } from './filters.js';

export async function catalogQuery(target:Target,credential:Credential,text:string,values:unknown[]=[]):Promise<Record<string,unknown>[]> {
  const c=targetClient(target,credential,'omnilodge-workspace-catalog');
  try {await c.connect();await assertRestrictedIdentity(c,target);await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='5000'");const r=await c.query(text,values);await c.query('ROLLBACK');return r.rows;}
  finally{await c.end().catch(()=>{});}
}
export async function catalogObjects(target:Target,credential:Credential,search:string,protectedObjects:string[],schema?:string) {
  return catalogQuery(target,credential,`SELECT c.oid::text AS id,n.nspname AS schema,c.relname AS name,c.relkind AS kind,
    obj_description(c.oid,'pg_class') AS comment,c.reltuples::bigint::text AS estimated_rows,
    has_table_privilege(c.oid,'SELECT') AS readable,has_table_privilege(c.oid,'UPDATE') AS writable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=ANY($1::text[]) AND ($2='' OR c.relname ILIKE '%'||$2||'%') AND ($3::text IS NULL OR n.nspname=$3)
      AND c.relkind IN ('r','p','v','m','f','S') AND NOT(c.relname=ANY($4::text[]))
    ORDER BY n.nspname,c.relname LIMIT 500`,[target.schemas,search.slice(0,200),schema||null,protectedObjects]);
}
export async function relationDetails(target:Target,credential:Credential,oid:string,protectedObjects:string[]) {
  if(!/^\d+$/.test(oid))throw new WorkspaceError(400,'INVALID_OBJECT','Invalid database object.');
  const [relation]=await catalogQuery(target,credential,`SELECT c.oid::text AS id,n.nspname AS schema,c.relname AS name,c.relkind AS kind,
    obj_description(c.oid,'pg_class') AS comment,pg_total_relation_size(c.oid)::text AS size_bytes,
    c.relrowsecurity AS row_security,c.relforcerowsecurity AS force_row_security,pg_get_userbyid(c.relowner) AS owner,
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=$1::oid AND n.nspname=ANY($2::text[]) AND has_table_privilege(c.oid,'SELECT')`,[oid,target.schemas]);
  if(!relation||protectedObjects.includes(String(relation.name))||protectedObjects.includes(`${relation.schema}.${relation.name}`))throw new WorkspaceError(404,'OBJECT_NOT_FOUND','This database object is unavailable.');
  const columns=await catalogQuery(target,credential,`SELECT a.attnum AS ordinal,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
    t.typname AS pg_type,a.atttypid AS oid,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,
    pg_get_expr(d.adbin,d.adrelid) AS default_value,col_description(a.attrelid,a.attnum) AS comment,
    EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=a.attrelid AND k.contype='p' AND a.attnum=ANY(k.conkey)) AS primary_key
    FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1::oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[oid]);
  const constraints=await catalogQuery(target,credential,`SELECT conname AS name,contype AS kind,pg_get_constraintdef(oid,true) AS definition,
    confrelid::text AS related_object FROM pg_constraint WHERE conrelid=$1::oid ORDER BY conname`,[oid]);
  const indexes=await catalogQuery(target,credential,`SELECT ic.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,
    i.indisunique AS unique_index,i.indisprimary AS primary_index FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid WHERE i.indrelid=$1::oid`,[oid]);
  return {...relation,id:String(relation.id),schema:String(relation.schema),name:String(relation.name),kind:String(relation.kind),qualifiedName:`${quoteIdentifier(String(relation.schema))}.${quoteIdentifier(String(relation.name))}`,columns,constraints,indexes};
}
