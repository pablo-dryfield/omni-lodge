import { catalogQuery } from './catalog.js';
import { quoteIdentifier } from './filters.js';
import { operationHash } from './store.js';
import type { Target, Credential } from './types.js';

export type SchemaObject = {
  key: string;
  family: string;
  schema: string;
  name: string;
  definition: string;
  dependencies: string[];
  oid: string;
  details: Record<string, unknown>;
  dropSql?: string;
};
const q = quoteIdentifier,
  qualified = (schema: string, name: string) => `${q(schema)}.${q(name)}`;
export async function schemaSnapshot(
  target: Target,
  credential: Credential,
  protectedObjects: string[],
) {
  const relations = await catalogQuery(
    target,
    credential,
    `SELECT c.oid::text,n.nspname AS schema,c.relname AS name,c.relkind AS kind,c.relispartition,
    c.relrowsecurity,c.relforcerowsecurity,c.reloptions,pg_get_partkeydef(c.oid) AS partition_key,pg_get_expr(c.relpartbound,c.oid) AS partition_bound,
    (SELECT inhparent::regclass::text FROM pg_inherits WHERE inhrelid=c.oid LIMIT 1) AS parent,
    CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END AS view_definition,
    obj_description(c.oid,'pg_class') AS comment,
    (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(jsonb_build_object('name',conname,'kind',contype,'definition',pg_get_constraintdef(oid,true),'target',confrelid::text) ORDER BY conname) FROM pg_constraint WHERE conrelid=c.oid) AS constraints
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind IN ('r','p','v','m') ORDER BY n.nspname,c.relname`,
    [target.schemas],
  );
  const routines = await catalogQuery(
    target,
    credential,
    `SELECT p.oid::text,n.nspname AS schema,p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS name,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1) AND p.prokind IN ('f','p') ORDER BY n.nspname,p.proname,p.oid`,
    [target.schemas],
  );
  const types = await catalogQuery(
    target,
    credential,
    `SELECT t.oid::text,n.nspname AS schema,t.typname AS name,t.typtype,format_type(t.typbasetype,t.typtypmod) AS base_type,t.typdefault,t.typnotnull,
    ARRAY(SELECT enumlabel FROM pg_enum WHERE enumtypid=t.oid ORDER BY enumsortorder) AS labels,
    ARRAY(SELECT pg_get_constraintdef(oid,true) FROM pg_constraint WHERE contypid=t.oid ORDER BY conname) AS constraints FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=ANY($1) AND t.typtype IN ('e','d') ORDER BY n.nspname,t.typname`,
    [target.schemas],
  );
  const sequences = await catalogQuery(
    target,
    credential,
    `SELECT c.oid::text,s.schemaname AS schema,s.sequencename AS name,s.data_type::text,s.start_value::text,s.min_value::text,s.max_value::text,s.increment_by::text,s.cycle FROM pg_sequences s JOIN pg_namespace n ON n.nspname=s.schemaname JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=s.sequencename WHERE s.schemaname=ANY($1) AND NOT EXISTS(SELECT 1 FROM pg_depend d LEFT JOIN pg_class owned ON owned.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND (d.deptype='i' OR owned.relname=ANY($2))) ORDER BY s.schemaname,s.sequencename`,
    [target.schemas, protectedObjects],
  );
  const edges = await catalogQuery(
    target,
    credential,
    `SELECT k.oid::text AS id,k.conname AS name,k.conrelid::text AS source,k.confrelid::text AS target,
    ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY v(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=v.num ORDER BY v.ord) AS source_columns,
    ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY v(num,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=v.num ORDER BY v.ord) AS target_columns,
    pg_get_constraintdef(k.oid,true) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname=ANY($1) ORDER BY k.conname`,
    [target.schemas],
  );
  const indexes = await catalogQuery(
    target,
    credential,
    `SELECT i.indexrelid::text AS oid,n.nspname AS schema,c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indrelid::text AS table_oid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid) ORDER BY n.nspname,c.relname`,
    [target.schemas],
  );
  const literal = (v: unknown) => `'${String(v).replace(/'/g, "''")}'`;
  const objects: SchemaObject[] = [];
  for (const t of types) {
    const name = qualified(String(t.schema), String(t.name));
    const definition =
      t.typtype === 'e'
        ? `CREATE TYPE ${name} AS ENUM (${(t.labels as string[]).map(literal).join(', ')});`
        : `CREATE DOMAIN ${name} AS ${t.base_type}${t.typdefault ? ` DEFAULT ${t.typdefault}` : ''}${t.typnotnull ? ' NOT NULL' : ''} ${(t.constraints as string[]).join(' ')};`;
    objects.push({
      key: `type:${t.schema}.${t.name}`,
      family: 'type',
      schema: String(t.schema),
      name: String(t.name),
      definition,
      dependencies: [],
      oid: String(t.oid),
      details: t,
      dropSql: `DROP ${t.typtype === 'd' ? 'DOMAIN' : 'TYPE'} ${name};`,
    });
  }
  for (const s of sequences)
    objects.push({
      key: `sequence:${s.schema}.${s.name}`,
      family: 'sequence',
      schema: String(s.schema),
      name: String(s.name),
      definition: `CREATE SEQUENCE ${qualified(String(s.schema), String(s.name))} AS ${s.data_type} START WITH ${s.start_value} INCREMENT BY ${s.increment_by} MINVALUE ${s.min_value} MAXVALUE ${s.max_value} ${s.cycle ? 'CYCLE' : 'NO CYCLE'};`,
      dependencies: [],
      oid: String(s.oid),
      details: s,
    });
  for (const r of routines)
    objects.push({
      key: `routine:${r.schema}.${r.name}`,
      family: 'routine',
      schema: String(r.schema),
      name: String(r.name),
      definition: String(r.definition),
      dependencies: [],
      oid: String(r.oid),
      details: r,
    });
  for (const r of relations) {
    if (
      protectedObjects.includes(String(r.name)) ||
      protectedObjects.includes(`${r.schema}.${r.name}`)
    )
      continue;
    const name = qualified(String(r.schema), String(r.name)),
      columns =
        (r.columns as Array<{
          name: string;
          type: string;
          notNull: boolean;
          identity: string;
          generated: string;
          default: string;
        }>) || [];
    const constraints =
      (r.constraints as Array<{
        name: string;
        kind: string;
        definition: string;
        target: string;
      }>) || [];
    const columnSQL = columns.map(
      (c) =>
        `${q(c.name)} ${c.type}${c.identity ? ` GENERATED ${c.identity === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY` : c.generated ? ` GENERATED ALWAYS AS (${c.default}) STORED` : c.default ? ` DEFAULT ${c.default}` : ''}${c.notNull ? ' NOT NULL' : ''}`,
    );
    const definition = ['v', 'm'].includes(String(r.kind))
      ? `CREATE ${r.kind === 'm' ? 'MATERIALIZED ' : ''}VIEW ${name}${r.kind === 'v' && Array.isArray(r.reloptions) && r.reloptions.length ? ` WITH (${r.reloptions.join(', ')})` : ''} AS ${String(r.view_definition).replace(/;\s*$/, '')}${r.kind === 'm' ? ' WITH NO DATA' : ''};`
      : r.relispartition
        ? `CREATE TABLE ${name} PARTITION OF ${r.parent} ${r.partition_bound};`
        : `CREATE TABLE ${name} (\n  ${[...columnSQL, ...constraints.filter((c) => c.kind !== 'f').map((c) => `CONSTRAINT ${q(c.name)} ${c.definition}`)].join(',\n  ')}\n)${r.partition_key ? ` PARTITION BY ${r.partition_key}` : ''};`;
    objects.push({
      key: `relation:${r.schema}.${r.name}`,
      family: 'relation',
      schema: String(r.schema),
      name: String(r.name),
      definition,
      dependencies: [],
      oid: String(r.oid),
      details: r,
    });
    if (['r', 'p'].includes(String(r.kind)))
      objects.push({
        key: `security:${r.schema}.${r.name}`,
        family: 'security',
        schema: String(r.schema),
        name: String(r.name),
        oid: `security:${r.oid}`,
        dependencies: [`relation:${r.schema}.${r.name}`],
        details: { table: name },
        definition: `ALTER TABLE ${name} ${r.relrowsecurity ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY;\nALTER TABLE ${name} ${r.relforcerowsecurity ? 'FORCE' : 'NO FORCE'} ROW LEVEL SECURITY;`,
      });
    for (const constraint of constraints.filter((c) => c.kind === 'f'))
      objects.push({
        key: `constraint:${r.schema}.${r.name}.${constraint.name}`,
        family: 'constraint',
        schema: String(r.schema),
        name: constraint.name,
        definition: `ALTER TABLE ${name} ADD CONSTRAINT ${q(constraint.name)} ${constraint.definition};`,
        dependencies: [`relation:${r.schema}.${r.name}`],
        oid: `${r.oid}:${constraint.name}`,
        details: { ...constraint, table: name },
      });
  }
  for (const i of indexes)
    objects.push({
      key: `index:${i.schema}.${i.name}`,
      family: 'index',
      schema: String(i.schema),
      name: String(i.name),
      definition: `${i.definition};`,
      dependencies: objects
        .filter((o) => o.family === 'relation' && o.oid === i.table_oid)
        .map((o) => o.key),
      oid: String(i.oid),
      details: i,
    });
  const supplements = await catalogQuery(
    target,
    credential,
    `
    SELECT 'trigger'::text AS family,t.oid::text,n.nspname AS schema,c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition,t.tgenabled::text AS enabled,NULL::text AS command,NULL::boolean AS permissive,NULL::text[] AS roles,NULL::text AS using,NULL::text AS with_check
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND NOT t.tgisinternal
    UNION ALL SELECT 'policy',p.oid::text,n.nspname,c.relname,p.polname,NULL,NULL,p.polcmd::text,p.polpermissive,ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END FROM unnest(p.polroles) r),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1)`,
    [target.schemas],
  );
  for (const s of supplements) {
    const relation = objects.find(
      (o) => o.key === `relation:${s.schema}.${s.table_name}`,
    );
    if (!relation) continue;
    const table = qualified(String(s.schema), String(s.table_name));
    const definition =
      s.family === 'trigger'
        ? `${s.definition};\nALTER TABLE ${table} ${s.enabled === 'D' ? 'DISABLE' : s.enabled === 'A' ? 'ENABLE ALWAYS' : s.enabled === 'R' ? 'ENABLE REPLICA' : 'ENABLE'} TRIGGER ${q(String(s.name))};`
        : `CREATE POLICY ${q(String(s.name))} ON ${table} AS ${s.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'} FOR ${{ r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' }[String(s.command)]} TO ${(s.roles as string[]).map((r) => (r === 'PUBLIC' ? 'PUBLIC' : q(r))).join(', ')}${s.using ? ` USING (${s.using})` : ''}${s.with_check ? ` WITH CHECK (${s.with_check})` : ''};`;
    objects.push({
      key: `${s.family}:${s.schema}.${s.table_name}.${s.name}`,
      family: String(s.family),
      schema: String(s.schema),
      name: String(s.name),
      definition,
      dependencies: [relation.key],
      oid: String(s.oid),
      details: s,
      dropSql: `DROP ${s.family === 'trigger' ? 'TRIGGER' : 'POLICY'} ${q(String(s.name))} ON ${table};`,
    });
  }
  const comments = await catalogQuery(
    target,
    credential,
    `SELECT c.oid::text,n.nspname AS schema,c.relname AS table_name,a.attname AS column_name,d.description
    FROM pg_description d JOIN pg_class c ON c.oid=d.objoid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.objsubid
    WHERE d.classoid='pg_class'::regclass AND n.nspname=ANY($1) AND c.relkind IN ('r','p','v','m','S','i')`,
    [target.schemas],
  );
  for (const c of comments) {
    const relation = objects.find(
      (o) =>
        o.oid === c.oid && ['relation', 'sequence', 'index'].includes(o.family),
    );
    if (!relation) continue;
    const object = qualified(String(c.schema), String(c.table_name)),
      type = c.column_name
        ? 'COLUMN'
        : relation.family === 'relation'
          ? relation.details.kind === 'v'
            ? 'VIEW'
            : relation.details.kind === 'm'
              ? 'MATERIALIZED VIEW'
              : 'TABLE'
          : relation.family.toUpperCase();
    const address =
      object + (c.column_name ? `.${q(String(c.column_name))}` : '');
    objects.push({
      key: `comment:${relation.key}${c.column_name ? `.${c.column_name}` : ''}`,
      family: 'comment',
      schema: String(c.schema),
      name: address,
      definition: `COMMENT ON ${type} ${address} IS ${literal(c.description)};`,
      dropSql: `COMMENT ON ${type} ${address} IS NULL;`,
      dependencies: [relation.key],
      oid: `comment:${c.oid}:${c.column_name || ''}`,
      details: c,
    });
  }
  const dependencyRows = await catalogQuery(
    target,
    credential,
    `SELECT d.classid::regclass::text AS family,d.objid::text AS object,d.refclassid::regclass::text AS referenced_family,d.refobjid::text AS referenced,
    rw.ev_class::text AS view_oid FROM pg_depend d LEFT JOIN pg_rewrite rw ON d.classid='pg_rewrite'::regclass AND rw.oid=d.objid
    WHERE (d.objid=ANY($1::oid[]) AND d.classid IN ('pg_class'::regclass,'pg_proc'::regclass,'pg_type'::regclass,'pg_trigger'::regclass,'pg_policy'::regclass)) OR rw.ev_class=ANY($1::oid[])`,
    [objects.map((o) => o.oid).filter((oid) => /^\d+$/.test(oid))],
  );
  const family = (o: SchemaObject) =>
    ['relation', 'index', 'sequence'].includes(o.family)
      ? 'pg_class'
      : o.family === 'routine'
        ? 'pg_proc'
        : o.family === 'type'
          ? 'pg_type'
          : `pg_${o.family}`;
  for (const edge of dependencyRows) {
    const object = objects.find(
      (o) =>
        o.oid === (edge.view_oid || edge.object) &&
        family(o) === (edge.view_oid ? 'pg_class' : edge.family),
    );
    const dependency = objects.find(
      (o) => o.oid === edge.referenced && family(o) === edge.referenced_family,
    );
    if (
      object &&
      dependency &&
      object !== dependency &&
      !object.dependencies.includes(dependency.key)
    )
      object.dependencies.push(dependency.key);
  }
  const order: Record<string, number> = {
    type: 0,
    sequence: 1,
    routine: 2,
    relation: 3,
    constraint: 4,
    index: 5,
    security: 6,
    policy: 7,
    trigger: 8,
    comment: 9,
  };
  objects.sort(
    (a, b) => order[a.family] - order[b.family] || a.key.localeCompare(b.key),
  );
  const ordered = dependencyOrder(objects);
  return {
    targetId: target.id,
    major: target.major,
    measuredAt: new Date().toISOString(),
    hash: operationHash(objects.map(({ oid, details, ...o }) => o)),
    objects: ordered.objects,
    dependencyCycles: ordered.cycles,
    edges,
    nodes: relations
      .filter(
        (r) =>
          !protectedObjects.includes(String(r.name)) &&
          !protectedObjects.includes(`${r.schema}.${r.name}`),
      )
      .map((r) => ({
        id: r.oid,
        schema: r.schema,
        name: r.name,
        columns: r.columns,
        kind: r.kind,
      })),
    warnings: [
      'Snapshots describe schema, not row data. Sequence current values are excluded. Routine bodies may have undeclared dependencies; verify generated ordering.',
      'Ownership, grants and infrastructure objects are inspected in their dedicated administration views. Renames and data conversions are never inferred. Extension/network objects require infrastructure maintenance.',
    ],
  };
}
export function dependencyOrder(objects: SchemaObject[]) {
  const state = new Map<string, number>(),
    output: SchemaObject[] = [],
    cycles = new Set<string>(),
    byKey = new Map(objects.map((o) => [o.key, o]));
  const visit = (o: SchemaObject): boolean => {
    if (state.get(o.key) === 2) return !cycles.has(o.key);
    if (state.get(o.key) === 1) {
      cycles.add(o.key);
      return false;
    }
    state.set(o.key, 1);
    let valid = true;
    for (const key of [...o.dependencies].sort()) {
      const d = byKey.get(key);
      if (d && !visit(d)) valid = false;
    }
    if (!valid) cycles.add(o.key);
    state.set(o.key, 2);
    output.push(o);
    return valid;
  };
  for (const o of objects) visit(o);
  return { objects: output, cycles: [...cycles].sort() };
}
export function compareSchemas(
  source: Awaited<ReturnType<typeof schemaSnapshot>>,
  target: Awaited<ReturnType<typeof schemaSnapshot>>,
  includeDrops = false,
) {
  const changes: Array<{
      key: string;
      status: string;
      source?: SchemaObject;
      target?: SchemaObject;
      resolution: string;
    }> = [],
    sql: string[] = [];
  for (const object of dependencyOrder(source.objects).objects) {
    const old = target.objects.find((o) => o.key === object.key);
    if (old?.definition === object.definition) continue;
    const changed = Boolean(old),
      replaceable =
        object.family === 'routine' ||
        (object.family === 'relation' && object.details.kind === 'v');
    changes.push({
      key: object.key,
      status: changed ? 'changed' : 'added',
      source: object,
      target: old,
      resolution:
        changed && !replaceable
          ? 'Manual resolution required'
          : 'Generated create/replace',
    });
    if (source.dependencyCycles?.includes(object.key)) {
      changes[changes.length - 1].resolution =
        'Manual resolution required: dependency cycle';
      sql.push(`-- Manual dependency-cycle resolution required: ${object.key}`);
    } else if (!changed) sql.push(object.definition);
    else if (replaceable || ['security', 'comment'].includes(object.family))
      sql.push(
        object.definition.replace(/^CREATE VIEW /i, 'CREATE OR REPLACE VIEW '),
      );
    else
      sql.push(
        `-- Manual resolution required: ${object.key}\n-- Source definition follows; inspect data conversion/dependencies before applying.\n${object.definition
          .split('\n')
          .map((line) => '-- ' + line)
          .join('\n')}`,
      );
  }
  for (const object of [...dependencyOrder(target.objects).objects].reverse())
    if (!source.objects.some((o) => o.key === object.key)) {
      changes.push({
        key: object.key,
        status: 'removed',
        target: object,
        resolution: includeDrops
          ? 'Explicit destructive removal requested'
          : 'Drop excluded',
      });
      if (includeDrops) {
        const type =
          object.family === 'relation'
            ? object.details.kind === 'v'
              ? 'VIEW'
              : object.details.kind === 'm'
                ? 'MATERIALIZED VIEW'
                : 'TABLE'
            : object.family === 'constraint'
              ? 'CONSTRAINT'
              : object.family === 'routine'
                ? 'FUNCTION'
                : object.family.toUpperCase();
        sql.push(
          object.dropSql
            ? object.dropSql
            : object.family === 'security'
              ? `-- Row security removed from source snapshot: inspect ${object.key}`
              : object.family === 'constraint'
                ? `ALTER TABLE ${object.details.table} DROP CONSTRAINT ${q(object.name)};`
                : object.family === 'routine'
                  ? `-- Manual signature/procedure resolution required before dropping ${object.key}`
                  : `DROP ${type} ${qualified(object.schema, object.name)};`,
        );
      }
    }
  return {
    sourceHash: source.hash,
    targetHash: target.hash,
    changes,
    sql: sql.join('\n\n'),
    unresolved: changes.filter((c) => c.resolution.includes('Manual')).length,
    warnings: [
      ...source.warnings,
      'Review dependencies, destructive scope and conversion of existing data. No database changes have been executed.',
    ],
  };
}
