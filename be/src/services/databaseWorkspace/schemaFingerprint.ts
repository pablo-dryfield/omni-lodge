import type pg from 'pg';
import { operationHash } from './store.js';
export async function schemaFingerprint(
  client: pg.Client,
  oid: string,
): Promise<string> {
  const r = await client.query(
    `SELECT c.oid::text,n.nspname,c.relname,c.relkind,c.relowner,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT jsonb_agg(jsonb_build_array(a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(jsonb_build_array(k.conrelid,k.conname,pg_get_constraintdef(k.oid)) ORDER BY k.conrelid,k.conname)
      FROM pg_constraint k WHERE k.conrelid=c.oid OR k.confrelid=c.oid) AS constraints,
    (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid=c.oid) AS indexes,
    (SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polroles::text,p.polpermissive,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
    (SELECT jsonb_agg(jsonb_build_array(t.tgname,t.tgenabled,pg_get_triggerdef(t.oid),pg_get_functiondef(t.tgfoid)) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid=$1::oid`,
    [oid],
  );
  return operationHash(r.rows[0] || null);
}
