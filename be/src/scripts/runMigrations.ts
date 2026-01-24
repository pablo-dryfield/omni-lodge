import 'dotenv/config';
import { randomUUID } from 'crypto';
import { QueryTypes } from 'sequelize';
import type { QueryInterface, Transaction } from 'sequelize';
import { Umzug, SequelizeStorage } from 'umzug';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';
import sequelize from '../config/database.js';

const TABLE_MIGRATION_RUNS = 'migration_audit_runs';
const TABLE_MIGRATION_STEPS = 'migration_audit_steps';
const strictVerification = (process.env.MIGRATION_VERIFY_STRICT ?? 'false').trim().toLowerCase() === 'true';
const BASELINE_EXCLUDES = new Set([
  '202601150001-control-panel-config.js',
  '202602010001-migration-audit.js',
  '202602150001-config-seed-runs.js',
]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsGlob: [string, { cwd: string }] = ['../migrations/*.js', { cwd: __dirname }];
type VerifyResult =
  | void
  | null
  | boolean
  | string[]
  | { ok?: boolean; details?: unknown };

type MigrationModule = {
  up: ({ context }: { context: QueryInterface }) => Promise<void> | void;
  down: ({ context }: { context: QueryInterface }) => Promise<void> | void;
  verify?: ({ context }: { context: QueryInterface }) => Promise<VerifyResult> | VerifyResult;
};

type AuditError = { message: string | null; stack: string | null };

function serializeError(error: unknown): AuditError {
  if (!error) {
    return { message: null, stack: null };
  }
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? null };
  }
  return { message: String(error), stack: null };
}

async function ensureMigrationAuditTables(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_MIGRATION_RUNS} (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL,
      direction VARCHAR(8) NOT NULL,
      status VARCHAR(16) NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMP NULL,
      node_env VARCHAR(32) NULL,
      db_name TEXT NULL,
      error_message TEXT NULL,
      error_stack TEXT NULL
    );
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE_MIGRATION_STEPS} (
      id BIGSERIAL PRIMARY KEY,
      run_id UUID NOT NULL,
      direction VARCHAR(8) NOT NULL,
      migration_name TEXT NOT NULL,
      status VARCHAR(16) NOT NULL,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMP NULL,
      error_message TEXT NULL,
      error_stack TEXT NULL,
      verify_status VARCHAR(16) NULL,
      verify_details JSONB NULL
    );
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS migration_audit_runs_run_id_idx
    ON ${TABLE_MIGRATION_RUNS} (run_id);
  `);
  await sequelize.query(`
    CREATE INDEX IF NOT EXISTS migration_audit_steps_run_id_idx
    ON ${TABLE_MIGRATION_STEPS} (run_id);
  `);
  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS migration_audit_steps_run_migration_idx
    ON ${TABLE_MIGRATION_STEPS} (run_id, migration_name, direction);
  `);
}

async function startMigrationRun(runId: string, direction: string): Promise<void> {
  await sequelize.query(
    `
      INSERT INTO ${TABLE_MIGRATION_RUNS} (run_id, direction, status, node_env, db_name)
      VALUES (:runId, :direction, 'running', :nodeEnv, :dbName);
    `,
    {
      replacements: {
        runId,
        direction,
        nodeEnv: process.env.NODE_ENV ?? null,
        dbName: process.env.DB_NAME ?? null,
      },
    },
  );
}

async function finishMigrationRun(runId: string, direction: string, status: string, error?: unknown): Promise<void> {
  const { message, stack } = serializeError(error);
  await sequelize.query(
    `
      UPDATE ${TABLE_MIGRATION_RUNS}
      SET status = :status,
          finished_at = NOW(),
          error_message = :errorMessage,
          error_stack = :errorStack
      WHERE run_id = :runId AND direction = :direction;
    `,
    {
      replacements: {
        runId,
        direction,
        status,
        errorMessage: message,
        errorStack: stack,
      },
    },
  );
}

async function startMigrationStep(runId: string, direction: string, migrationName: string): Promise<void> {
  await sequelize.query(
    `
      INSERT INTO ${TABLE_MIGRATION_STEPS} (run_id, direction, migration_name, status)
      VALUES (:runId, :direction, :migrationName, 'running')
      ON CONFLICT (run_id, migration_name, direction)
      DO UPDATE SET status = 'running', started_at = NOW(), finished_at = NULL,
        error_message = NULL, error_stack = NULL, verify_status = NULL, verify_details = NULL;
    `,
    { replacements: { runId, direction, migrationName } },
  );
}

async function finishMigrationStep(
  runId: string,
  direction: string,
  migrationName: string,
  status: string,
  error?: unknown,
  verifyStatus?: string | null,
  verifyDetails?: unknown,
): Promise<void> {
  const { message, stack } = serializeError(error);
  await sequelize.query(
    `
      UPDATE ${TABLE_MIGRATION_STEPS}
      SET status = :status,
          finished_at = NOW(),
          error_message = :errorMessage,
          error_stack = :errorStack,
          verify_status = :verifyStatus,
          verify_details = :verifyDetails
      WHERE run_id = :runId AND direction = :direction AND migration_name = :migrationName;
    `,
    {
      replacements: {
        runId,
        direction,
        migrationName,
        status,
        errorMessage: message,
        errorStack: stack,
        verifyStatus: verifyStatus ?? null,
        verifyDetails: verifyDetails == null ? null : JSON.stringify(verifyDetails),
      },
    },
  );
}

function interpretVerifyResult(result: VerifyResult): { status: string; details: unknown; shouldFail: boolean } {
  if (result === undefined || result === null) {
    return { status: 'skipped', details: null, shouldFail: false };
  }
  if (typeof result === 'boolean') {
    return { status: result ? 'passed' : 'failed', details: null, shouldFail: !result };
  }
  if (Array.isArray(result)) {
    const shouldFail = result.length > 0;
    return {
      status: shouldFail ? 'failed' : 'passed',
      details: shouldFail ? { missing: result } : null,
      shouldFail,
    };
  }
  if (typeof result === 'object' && 'ok' in result) {
    const ok = Boolean((result as { ok?: boolean }).ok);
    const details = (result as { details?: unknown }).details ?? null;
    return { status: ok ? 'passed' : 'failed', details, shouldFail: !ok };
  }
  return { status: 'passed', details: result, shouldFail: false };
}

type TableRef = string | { tableName: string; schema?: string };

type IndexSpec = {
  table: string;
  schema: string;
  name?: string;
  columns: string[];
  unique?: boolean;
};

type ConstraintSpec = {
  table: string;
  schema: string;
  name?: string;
  type: string;
  columns: string[];
  references?: { table: string; schema: string; column: string };
};

type SeedCheck = {
  table: string;
  schema: string;
  rowCount: number;
  attemptedCount?: number;
  skippedCount?: number;
  identifierColumn?: string;
  identifierValues?: Array<string | number | null>;
  beforeCount?: number;
  afterCount?: number;
  ignoreDuplicates?: boolean;
};

type TableExpectation = {
  table: string;
  schema: string;
  created: boolean;
  columns: Set<string>;
  primaryKeyColumns: Set<string>;
};

type MigrationTracker = {
  tables: Map<string, TableExpectation>;
  indexes: IndexSpec[];
  constraints: ConstraintSpec[];
  seeds: SeedCheck[];
  rawQueries: string[];
  warnings: string[];
};

type VerifySummary = { status: string; details: unknown; shouldFail: boolean };

function createMigrationTracker(): MigrationTracker {
  return {
    tables: new Map(),
    indexes: [],
    constraints: [],
    seeds: [],
    rawQueries: [],
    warnings: [],
  };
}

function combineVerifyResults(autoResult: VerifySummary, manualResult: VerifySummary): VerifySummary {
  const shouldFail = autoResult.shouldFail || manualResult.shouldFail;
  let status = 'passed';
  if (shouldFail) {
    status = 'failed';
  } else if (autoResult.status === 'warning' || manualResult.status === 'warning') {
    status = 'warning';
  } else if (autoResult.status === 'skipped' && manualResult.status === 'skipped') {
    status = 'skipped';
  }
  return {
    status,
    shouldFail,
    details: {
      auto: autoResult.details,
      manual: manualResult.details,
    },
  };
}

function normalizeTableRef(ref: TableRef): { schema: string; table: string; fullName: string } {
  if (typeof ref === 'string') {
    const parts = ref.split('.');
    if (parts.length === 2) {
      const [schema, table] = parts;
      return { schema: schema || 'public', table, fullName: `${schema || 'public'}.${table}` };
    }
    return { schema: 'public', table: ref, fullName: `public.${ref}` };
  }
  const schema = ref.schema ?? 'public';
  const table = ref.tableName;
  return { schema, table, fullName: `${schema}.${table}` };
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteQualifiedName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function normalizeField(field: unknown): string {
  if (typeof field === 'string') {
    return field;
  }
  if (field && typeof field === 'object') {
    const fieldObj = field as { attribute?: string; name?: string; field?: string };
    return fieldObj.attribute ?? fieldObj.name ?? fieldObj.field ?? String(field);
  }
  return String(field);
}

function safeSqlPreview(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getTransaction(options?: unknown): Transaction | null | undefined {
  if (options && typeof options === 'object' && 'transaction' in options) {
    return (options as { transaction?: Transaction | null }).transaction;
  }
  return undefined;
}

async function selectQuery<T>(
  sql: string,
  replacements?: Record<string, unknown>,
  transaction?: Transaction | null,
): Promise<T[]> {
  const rows = await sequelize.query(sql, {
    replacements,
    type: QueryTypes.SELECT,
    transaction,
  });
  return rows as unknown as T[];
}

async function ensureSequelizeMetaTable(): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS sequelize_meta (
      name VARCHAR(255) PRIMARY KEY
    );
  `);
}

async function listMigrationNames(): Promise<string[]> {
  const distDir = join(__dirname, '../migrations');
  const srcDir = join(__dirname, '../../src/migrations');

  try {
    const entries = await fs.readdir(distDir);
    return entries.filter((entry) => entry.endsWith('.js')).sort();
  } catch {
    const entries = await fs.readdir(srcDir);
    return entries
      .filter((entry) => entry.endsWith('.ts'))
      .map((entry) => entry.replace(/\.ts$/, '.js'))
      .sort();
  }
}

async function loadSequelizeMeta(): Promise<Set<string>> {
  const rows = await selectQuery<{ name: string }>('SELECT name FROM sequelize_meta');
  return new Set(rows.map((row) => row.name));
}

async function insertSequelizeMeta(names: string[]): Promise<void> {
  if (names.length === 0) {
    return;
  }
  const values = names.map((name) => `('${name.replace(/'/g, "''")}')`).join(', ');
  await sequelize.query(
    `INSERT INTO sequelize_meta (name) VALUES ${values} ON CONFLICT (name) DO NOTHING;`,
  );
}

async function ensureBaselineState(): Promise<void> {
  await ensureSequelizeMetaTable();
  const rows = await selectQuery<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM sequelize_meta');
  const metaCount = Number(rows[0]?.count ?? 0);
  if (metaCount > 0) {
    return;
  }

  const excludedTables = [
    'sequelize_meta',
    'migration_audit_runs',
    'migration_audit_steps',
  ];
  const excludedList = excludedTables.map((table) => `'${table}'`).join(', ');
  const existing = await selectQuery<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN (${excludedList});
    `,
  );
  if (existing.length === 0) {
    return;
  }

  const names = await listMigrationNames();
  const target = names.filter((name) => !BASELINE_EXCLUDES.has(name));
  const existingMeta = await loadSequelizeMeta();
  const missing = target.filter((name) => !existingMeta.has(name));
  console.log(`baseline: inserting ${missing.length} migrations into sequelize_meta`);
  await insertSequelizeMeta(missing);
}

function ensureTableExpectation(tracker: MigrationTracker, schema: string, table: string, created = false): TableExpectation {
  const key = `${schema}.${table}`;
  let entry = tracker.tables.get(key);
  if (!entry) {
    entry = {
      table,
      schema,
      created,
      columns: new Set(),
      primaryKeyColumns: new Set(),
    };
    tracker.tables.set(key, entry);
  } else if (created) {
    entry.created = true;
  }
  return entry;
}

function resolveReference(ref: unknown): { table: string; schema: string; column: string } | null {
  if (!ref) {
    return null;
  }
  if (typeof ref === 'string') {
    return { table: ref, schema: 'public', column: 'id' };
  }
  if (typeof ref !== 'object') {
    return null;
  }
  const refObj = ref as {
    table?: string | { tableName: string; schema?: string };
    model?: string | { tableName?: string; name?: string; schema?: string };
    key?: string;
    field?: string;
  };
  let table = '';
  let schema = 'public';
  if (typeof refObj.table === 'string') {
    table = refObj.table;
  } else if (refObj.table && typeof refObj.table === 'object') {
    table = refObj.table.tableName;
    schema = refObj.table.schema ?? schema;
  } else if (typeof refObj.model === 'string') {
    table = refObj.model;
  } else if (refObj.model && typeof refObj.model === 'object') {
    table = refObj.model.tableName ?? refObj.model.name ?? '';
    schema = refObj.model.schema ?? schema;
  }
  if (!table) {
    return null;
  }
  const column = refObj.key ?? refObj.field ?? 'id';
  return { table, schema, column };
}

function recordCreateTable(tracker: MigrationTracker, tableRef: TableRef, attributes: Record<string, unknown>): void {
  const { schema, table } = normalizeTableRef(tableRef);
  const entry = ensureTableExpectation(tracker, schema, table, true);
  for (const [columnName, definition] of Object.entries(attributes ?? {})) {
    entry.columns.add(columnName);
    if (definition && typeof definition === 'object') {
      const def = definition as {
        primaryKey?: boolean;
        references?: unknown;
        unique?: boolean | string;
      };
      if (def.primaryKey) {
        entry.primaryKeyColumns.add(columnName);
      }
      const reference = resolveReference(def.references);
      if (reference) {
        tracker.constraints.push({
          table,
          schema,
          type: 'FOREIGN KEY',
          columns: [columnName],
          references: {
            table: reference.table,
            schema: reference.schema,
            column: reference.column,
          },
        });
      }
      if (def.unique) {
        tracker.constraints.push({
          table,
          schema,
          type: 'UNIQUE',
          columns: [columnName],
          name: typeof def.unique === 'string' ? def.unique : undefined,
        });
      }
    }
  }
}

function recordAddColumn(
  tracker: MigrationTracker,
  tableRef: TableRef,
  columnName: string,
  definition?: Record<string, unknown>,
): void {
  const { schema, table } = normalizeTableRef(tableRef);
  const entry = ensureTableExpectation(tracker, schema, table);
  entry.columns.add(columnName);
  if (definition) {
    const def = definition as { primaryKey?: boolean; references?: unknown; unique?: boolean | string };
    if (def.primaryKey) {
      entry.primaryKeyColumns.add(columnName);
    }
    const reference = resolveReference(def.references);
    if (reference) {
      tracker.constraints.push({
        table,
        schema,
        type: 'FOREIGN KEY',
        columns: [columnName],
        references: {
          table: reference.table,
          schema: reference.schema,
          column: reference.column,
        },
      });
    }
    if (def.unique) {
      tracker.constraints.push({
        table,
        schema,
        type: 'UNIQUE',
        columns: [columnName],
        name: typeof def.unique === 'string' ? def.unique : undefined,
      });
    }
  }
}

function recordAddIndex(
  tracker: MigrationTracker,
  tableRef: TableRef,
  fields: unknown[] = [],
  options?: { name?: string; unique?: boolean },
): void {
  const { schema, table } = normalizeTableRef(tableRef);
  const fieldList = Array.isArray(fields) ? fields : [fields];
  tracker.indexes.push({
    table,
    schema,
    name: options?.name,
    unique: options?.unique,
    columns: fieldList.map(normalizeField),
  });
}

function recordAddConstraint(
  tracker: MigrationTracker,
  tableRef: TableRef,
  options: {
    type?: string;
    fields?: unknown[];
    name?: string;
    references?: unknown;
  },
): void {
  const { schema, table } = normalizeTableRef(tableRef);
  const type = (options.type ?? '').toString().toUpperCase();
  const fieldList = Array.isArray(options.fields) ? options.fields : options.fields ? [options.fields] : [];
  const columns = fieldList.map(normalizeField);
  const reference = resolveReference(options.references);
  tracker.constraints.push({
    table,
    schema,
    name: options.name,
    type: type || 'CONSTRAINT',
    columns,
    references: reference
      ? { table: reference.table, schema: reference.schema, column: reference.column }
      : undefined,
  });
}

function recordRenameTable(tracker: MigrationTracker, tableRef: TableRef): void {
  const { schema, table } = normalizeTableRef(tableRef);
  ensureTableExpectation(tracker, schema, table);
}

function recordRenameColumn(tracker: MigrationTracker, tableRef: TableRef, newName: string): void {
  const { schema, table } = normalizeTableRef(tableRef);
  const entry = ensureTableExpectation(tracker, schema, table);
  entry.columns.add(newName);
}

function pickIdentifierColumn(rows: Record<string, unknown>[]): string | undefined {
  const candidates = ['id', 'key', 'code', 'slug', 'name'];
  for (const candidate of candidates) {
    if (rows.every((row) => Object.prototype.hasOwnProperty.call(row, candidate))) {
      return candidate;
    }
  }
  return undefined;
}

async function countTableRows(
  tableRef: TableRef,
  transaction?: Transaction | null,
): Promise<number> {
  const { schema, table } = normalizeTableRef(tableRef);
  const rows = await selectQuery<{ count: string }>(
    `SELECT COUNT(*)::bigint AS count FROM ${quoteQualifiedName(schema, table)};`,
    undefined,
    transaction,
  );
  return Number(rows[0]?.count ?? 0);
}

async function getPrimaryKeyColumns(
  schema: string,
  table: string,
  transaction?: Transaction | null,
): Promise<string[]> {
  const rows = await selectQuery<{ column_name: string }>(
    `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = :schema AND tc.table_name = :table AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position;
    `,
    { schema, table },
    transaction,
  );
  return rows.map((row) => row.column_name);
}

async function columnExists(
  schema: string,
  table: string,
  column: string,
  transaction?: Transaction | null,
): Promise<boolean> {
  const rows = await selectQuery<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = :table AND column_name = :column;
    `,
    { schema, table, column },
    transaction,
  );
  return rows.length > 0;
}

function createTrackedQueryInterface(base: QueryInterface, tracker: MigrationTracker): QueryInterface {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'createTable') {
        return async (tableName: TableRef, attributes: Record<string, unknown>, options?: unknown) => {
          recordCreateTable(tracker, tableName, attributes);
          const { schema, table } = normalizeTableRef(tableName);
          const transaction = getTransaction(options);
          if (await tableExists(schema, table, transaction)) {
            tracker.warnings.push(`createTable skipped for existing ${schema}.${table}`);
            return undefined;
          }
          return (target.createTable as (...args: unknown[]) => unknown).call(target, tableName, attributes, options);
        };
      }
      if (prop === 'addColumn') {
        return async (tableName: TableRef, columnName: string, definition?: Record<string, unknown>, options?: unknown) => {
          recordAddColumn(tracker, tableName, columnName, definition);
          const { schema, table } = normalizeTableRef(tableName);
          const transaction = getTransaction(options);
          if (await columnExists(schema, table, columnName, transaction)) {
            tracker.warnings.push(`addColumn skipped for existing ${schema}.${table}.${columnName}`);
            return undefined;
          }
          return (target.addColumn as (...args: unknown[]) => unknown).call(target, tableName, columnName, definition, options);
        };
      }
      if (prop === 'addIndex') {
        return async (tableName: TableRef, fields: unknown[], options?: { name?: string; unique?: boolean }) => {
          recordAddIndex(tracker, tableName, fields, options);
          const { schema, table } = normalizeTableRef(tableName);
          const transaction = getTransaction(options);
          const expectedIndex: IndexSpec = {
            table,
            schema,
            name: options?.name,
            unique: options?.unique,
            columns: (Array.isArray(fields) ? fields : [fields]).map(normalizeField),
          };
          if (await indexExists(schema, table, expectedIndex, transaction)) {
            tracker.warnings.push(`addIndex skipped for existing ${schema}.${table}`);
            return undefined;
          }
          return (target.addIndex as (...args: unknown[]) => unknown).call(target, tableName, fields, options);
        };
      }
      if (prop === 'addConstraint') {
        return async (tableName: TableRef, options: {
          type?: string;
          fields?: unknown[];
          name?: string;
          references?: unknown;
        }) => {
          recordAddConstraint(tracker, tableName, options);
          const { schema, table } = normalizeTableRef(tableName);
          const transaction = getTransaction(options);
          const fieldList = Array.isArray(options.fields) ? options.fields : options.fields ? [options.fields] : [];
          const expectedConstraint: ConstraintSpec = {
            table,
            schema,
            name: options.name,
            type: (options.type ?? '').toString().toUpperCase() || 'CONSTRAINT',
            columns: fieldList.map(normalizeField),
            references: resolveConstraintReference(options.references),
          };
          if (await constraintExists(schema, table, expectedConstraint, transaction)) {
            tracker.warnings.push(`addConstraint skipped for existing ${schema}.${table}`);
            return undefined;
          }
          return (target.addConstraint as (...args: unknown[]) => unknown).call(target, tableName, options);
        };
      }
      if (prop === 'renameTable') {
        return async (before: TableRef, after: TableRef) => {
          recordRenameTable(tracker, after);
          const beforeRef = normalizeTableRef(before);
          const afterRef = normalizeTableRef(after);
          if (!(await tableExists(beforeRef.schema, beforeRef.table)) && await tableExists(afterRef.schema, afterRef.table)) {
            tracker.warnings.push(`renameTable skipped for existing ${afterRef.schema}.${afterRef.table}`);
            return undefined;
          }
          return (target.renameTable as (...args: unknown[]) => unknown).call(target, before, after);
        };
      }
      if (prop === 'renameColumn') {
        return async (tableName: TableRef, oldName: string, newName: string) => {
          recordRenameColumn(tracker, tableName, newName);
          const { schema, table } = normalizeTableRef(tableName);
          if (!(await columnExists(schema, table, oldName)) && await columnExists(schema, table, newName)) {
            tracker.warnings.push(`renameColumn skipped for existing ${schema}.${table}.${newName}`);
            return undefined;
          }
          return (target.renameColumn as (...args: unknown[]) => unknown).call(target, tableName, oldName, newName);
        };
      }
      if (prop === 'bulkInsert') {
        return async (tableName: TableRef, records: Record<string, unknown>[], options?: { transaction?: Transaction | null; ignoreDuplicates?: boolean }) => {
          const rows = Array.isArray(records) ? records : [];
          const transaction = getTransaction(options);
          const { schema, table } = normalizeTableRef(tableName);
          let identifierColumn = rows.length > 0 ? pickIdentifierColumn(rows) : undefined;
          if (!identifierColumn && rows.length > 0) {
            const pkColumns = await getPrimaryKeyColumns(schema, table, transaction);
            if (pkColumns.length === 1 && rows.every((row) => Object.prototype.hasOwnProperty.call(row, pkColumns[0]))) {
              identifierColumn = pkColumns[0];
            }
          }
          let identifierValues: Array<string | number | null> | undefined;
          let identifierKey: string | undefined;
          if (identifierColumn) {
            const key = identifierColumn;
            identifierKey = key;
            identifierValues = rows.map((row) => row[key] as string | number | null);
          }
          let filteredRows = rows;
          let skippedCount = 0;
          if (identifierKey && rows.length > 0) {
            const key = identifierKey;
            const values = identifierValues?.filter((value) => value !== null && value !== undefined) ?? [];
            if (values.length > 0) {
              const existingRows = await selectQuery<{ value: string | number }>(
                `
                  SELECT ${quoteIdentifier(key)} AS value
                  FROM ${quoteQualifiedName(schema, table)}
                  WHERE ${quoteIdentifier(key)} = ANY(:values);
                `,
                { values },
                transaction,
              );
              const existingSet = new Set(existingRows.map((row) => String(row.value)));
              filteredRows = rows.filter((row) => !existingSet.has(String(row[key])));
              skippedCount = rows.length - filteredRows.length;
            }
          }
          const shouldCount = rows.length > 0 && !identifierColumn;
          const beforeCount = shouldCount ? await countTableRows(tableName, transaction) : undefined;
          const result = filteredRows.length > 0
            ? await (target.bulkInsert as (...args: unknown[]) => unknown).call(target, tableName, filteredRows, options)
            : undefined;
          const afterCount = shouldCount ? await countTableRows(tableName, transaction) : undefined;
          tracker.seeds.push({
            table,
            schema,
            rowCount: filteredRows.length,
            attemptedCount: rows.length,
            skippedCount,
            identifierColumn,
            identifierValues,
            beforeCount,
            afterCount,
            ignoreDuplicates: options?.ignoreDuplicates,
          });
          if (skippedCount > 0) {
            tracker.warnings.push(`bulkInsert skipped ${skippedCount} existing rows for ${schema}.${table}`);
          }
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

async function tableExists(schema: string, table: string, transaction?: Transaction | null): Promise<boolean> {
  const rows = await selectQuery<{ name: string | null }>(
    'SELECT to_regclass(:tableName) AS name',
    { tableName: `${schema}.${table}` },
    transaction,
  );
  return Boolean(rows[0]?.name);
}

async function listTableColumns(schema: string, table: string, transaction?: Transaction | null): Promise<Set<string>> {
  const rows = await selectQuery<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = :schema AND table_name = :table;
    `,
    { schema, table },
    transaction,
  );
  return new Set(rows.map((row) => row.column_name));
}

async function listTableIndexes(
  schema: string,
  table: string,
  transaction?: Transaction | null,
): Promise<Array<{ name: string; columns: string[]; unique: boolean }>> {
  const rows = await selectQuery<{ index_name: string; is_unique: boolean; columns: string[] }>(
    `
      SELECT
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        array_agg(a.attname ORDER BY x.ordinality) AS columns
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality) ON true
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
      WHERE n.nspname = :schema AND t.relname = :table
      GROUP BY i.relname, ix.indisunique;
    `,
    { schema, table },
    transaction,
  );
  return rows.map((row) => ({
    name: row.index_name,
    unique: row.is_unique,
    columns: Array.isArray(row.columns)
      ? row.columns
      : String(row.columns).replace(/[{}]/g, '').split(',').filter(Boolean),
  }));
}

async function listTableConstraints(schema: string, table: string, transaction?: Transaction | null): Promise<Array<{
  name: string;
  type: string;
  columns: string[];
  references?: { table: string | null; column: string | null };
}>> {
  const rows = await selectQuery<{
    constraint_name: string;
    constraint_type: string;
    column_name: string | null;
    foreign_table: string | null;
    foreign_column: string | null;
    ordinal_position: number | null;
  }>(
    `
      SELECT
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        kcu.ordinal_position,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.table_schema = :schema AND tc.table_name = :table;
    `,
    { schema, table },
    transaction,
  );
  const constraints = new Map<string, { name: string; type: string; columns: Array<{ name: string; position: number }>; references?: { table: string | null; column: string | null } }>();
  for (const row of rows) {
    const existing = constraints.get(row.constraint_name) ?? {
      name: row.constraint_name,
      type: row.constraint_type.toUpperCase(),
      columns: [],
      references: row.foreign_table || row.foreign_column ? { table: row.foreign_table, column: row.foreign_column } : undefined,
    };
    if (row.column_name) {
      existing.columns.push({ name: row.column_name, position: row.ordinal_position ?? 0 });
    }
    constraints.set(row.constraint_name, existing);
  }
  return Array.from(constraints.values()).map((constraint) => ({
    name: constraint.name,
    type: constraint.type,
    columns: constraint.columns.sort((a, b) => a.position - b.position).map((column) => column.name),
    references: constraint.references,
  }));
}

async function indexExists(
  schema: string,
  table: string,
  expected: IndexSpec,
  transaction?: Transaction | null,
): Promise<boolean> {
  const actualIndexes = await listTableIndexes(schema, table, transaction);
  const matchByName = expected.name
    ? actualIndexes.find((index) => index.name === expected.name)
    : undefined;
  if (matchByName) {
    return true;
  }
  return Boolean(
    actualIndexes.find(
      (index) =>
        columnsMatchExact(expected.columns, index.columns) &&
        (expected.unique === undefined || expected.unique === index.unique),
    ),
  );
}

async function constraintExists(
  schema: string,
  table: string,
  expected: ConstraintSpec,
  transaction?: Transaction | null,
): Promise<boolean> {
  const actualConstraints = await listTableConstraints(schema, table, transaction);
  const matchByName = expected.name
    ? actualConstraints.find((constraint) => constraint.name === expected.name)
    : undefined;
  if (matchByName) {
    return true;
  }
  return Boolean(
    actualConstraints.find((constraint) => {
      if (constraint.type !== expected.type) {
        return false;
      }
      if (!columnsMatchExact(expected.columns, constraint.columns)) {
        return false;
      }
      if (expected.references) {
        return (
          constraint.references?.table === expected.references.table &&
          constraint.references?.column === expected.references.column
        );
      }
      return true;
    }),
  );
}

function resolveConstraintReference(references?: unknown): { table: string; schema: string; column: string } | undefined {
  if (!references) {
    return undefined;
  }
  const resolved = resolveReference(references);
  if (!resolved) {
    return undefined;
  }
  return { table: resolved.table, schema: resolved.schema, column: resolved.column };
}

function columnsMatchExact(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) {
    return false;
  }
  return expected.every((value, index) => value === actual[index]);
}

async function verifyTrackedObjects(tracker: MigrationTracker): Promise<VerifySummary> {
  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; columns: string[] }> = [];
  const missingIndexes: Array<{ table: string; name?: string; columns: string[] }> = [];
  const missingConstraints: Array<{ table: string; name?: string; type: string; columns: string[]; references?: { table: string; column: string } }> = [];
  const seedFailures: Array<{ table: string; reason: string; column?: string; missingValues?: Array<string | number | null> }> = [];
  const warnings: string[] = [...tracker.warnings];

  if (tracker.rawQueries.length > 0) {
    warnings.push(`raw SQL executed (${tracker.rawQueries.length})`);
  }

  for (const tableEntry of tracker.tables.values()) {
    if (tableEntry.created) {
      const exists = await tableExists(tableEntry.schema, tableEntry.table);
      if (!exists) {
        missingTables.push(`${tableEntry.schema}.${tableEntry.table}`);
      }
    }
  }

  for (const tableEntry of tracker.tables.values()) {
    if (tableEntry.columns.size === 0) {
      continue;
    }
    const existingColumns = await listTableColumns(tableEntry.schema, tableEntry.table);
    const missing = Array.from(tableEntry.columns).filter((column) => !existingColumns.has(column));
    if (missing.length > 0) {
      missingColumns.push({ table: `${tableEntry.schema}.${tableEntry.table}`, columns: missing });
    }
  }

  const expectedConstraints = [...tracker.constraints];
  for (const tableEntry of tracker.tables.values()) {
    if (tableEntry.primaryKeyColumns.size > 0) {
      const alreadyDefined = expectedConstraints.some(
        (constraint) =>
          constraint.table === tableEntry.table &&
          constraint.schema === tableEntry.schema &&
          constraint.type === 'PRIMARY KEY' &&
          columnsMatchExact(constraint.columns, Array.from(tableEntry.primaryKeyColumns)),
      );
      if (!alreadyDefined) {
        expectedConstraints.push({
          table: tableEntry.table,
          schema: tableEntry.schema,
          type: 'PRIMARY KEY',
          columns: Array.from(tableEntry.primaryKeyColumns),
        });
      }
    }
  }

  const tablesWithIndexes = new Map<string, IndexSpec[]>();
  for (const indexSpec of tracker.indexes) {
    const key = `${indexSpec.schema}.${indexSpec.table}`;
    const entries = tablesWithIndexes.get(key) ?? [];
    entries.push(indexSpec);
    tablesWithIndexes.set(key, entries);
  }
  for (const [tableKey, expectedIndexes] of tablesWithIndexes.entries()) {
    const [schema, table] = tableKey.split('.');
    const actualIndexes = await listTableIndexes(schema, table);
    for (const expected of expectedIndexes) {
      let match = actualIndexes.find((index) => expected.name && index.name === expected.name);
      if (!match) {
        match = actualIndexes.find(
          (index) =>
            columnsMatchExact(expected.columns, index.columns) &&
            (expected.unique === undefined || expected.unique === index.unique),
        );
      }
      if (!match) {
        missingIndexes.push({
          table: `${schema}.${table}`,
          name: expected.name,
          columns: expected.columns,
        });
      }
    }
  }

  const constraintsByTable = new Map<string, ConstraintSpec[]>();
  for (const constraintSpec of expectedConstraints) {
    const key = `${constraintSpec.schema}.${constraintSpec.table}`;
    const entries = constraintsByTable.get(key) ?? [];
    entries.push(constraintSpec);
    constraintsByTable.set(key, entries);
  }
  for (const [tableKey, expectedConstraintList] of constraintsByTable.entries()) {
    const [schema, table] = tableKey.split('.');
    const actualConstraints = await listTableConstraints(schema, table);
    for (const expected of expectedConstraintList) {
      let match = actualConstraints.find((constraint) => expected.name && constraint.name === expected.name);
      if (!match) {
        match = actualConstraints.find((constraint) => {
          if (constraint.type !== expected.type) {
            return false;
          }
          if (!columnsMatchExact(expected.columns, constraint.columns)) {
            return false;
          }
          if (expected.references) {
            return (
              constraint.references?.table === expected.references.table &&
              constraint.references?.column === expected.references.column
            );
          }
          return true;
        });
      }
      if (!match) {
        missingConstraints.push({
          table: `${schema}.${table}`,
          name: expected.name,
          type: expected.type,
          columns: expected.columns,
          references: expected.references
            ? { table: `${expected.references.schema}.${expected.references.table}`, column: expected.references.column }
            : undefined,
        });
      }
    }
  }

  for (const seed of tracker.seeds) {
    if ((seed.attemptedCount ?? seed.rowCount) === 0) {
      continue;
    }
    let identifierFailure = false;
    const identifierValues = (seed.identifierValues ?? []).filter((value) => value !== null && value !== undefined);
    if (seed.identifierColumn && identifierValues.length > 0) {
      const rows = await selectQuery<{ value: string | number }>(
        `
          SELECT ${quoteIdentifier(seed.identifierColumn)} AS value
          FROM ${quoteQualifiedName(seed.schema, seed.table)}
          WHERE ${quoteIdentifier(seed.identifierColumn)} = ANY(:values);
        `,
        { values: identifierValues },
      );
      const foundValues = new Set(rows.map((row) => String(row.value)));
      const missingValues = identifierValues.filter((value) => !foundValues.has(String(value)));
      if (missingValues.length > 0) {
        identifierFailure = true;
        seedFailures.push({
          table: `${seed.schema}.${seed.table}`,
          reason: 'missing_seed_rows',
          column: seed.identifierColumn,
          missingValues,
        });
      }
    }

    if (!seed.identifierColumn && seed.beforeCount !== undefined && seed.afterCount !== undefined) {
      const diff = seed.afterCount - seed.beforeCount;
      if (!seed.ignoreDuplicates && diff < seed.rowCount) {
        seedFailures.push({
          table: `${seed.schema}.${seed.table}`,
          reason: `seed_row_count_mismatch (${diff} of ${seed.rowCount})`,
        });
      } else if (seed.ignoreDuplicates && diff < seed.rowCount && !identifierFailure) {
        warnings.push(`seed rows skipped in ${seed.schema}.${seed.table} with ignoreDuplicates`);
      }
    } else if (!seed.identifierColumn) {
      warnings.push(`seed verification incomplete for ${seed.schema}.${seed.table}`);
    }
  }

  if (strictVerification && tracker.rawQueries.length > 0) {
    seedFailures.push({
      table: 'migration',
      reason: 'raw_sql_detected',
    });
  }

  const hasFailures = missingTables.length > 0 ||
    missingColumns.length > 0 ||
    missingIndexes.length > 0 ||
    missingConstraints.length > 0 ||
    seedFailures.length > 0;
  const hasWarnings = warnings.length > 0;
  const trackedCount = tracker.tables.size + tracker.indexes.length + tracker.constraints.length + tracker.seeds.length;

  let status = 'passed';
  if (hasFailures) {
    status = 'failed';
  } else if (hasWarnings) {
    status = 'warning';
  } else if (trackedCount === 0 && tracker.rawQueries.length === 0) {
    status = 'skipped';
  }

  return {
    status,
    shouldFail: hasFailures,
    details: {
      missingTables,
      missingColumns,
      missingIndexes,
      missingConstraints,
      seedFailures,
      warnings,
      rawQueryCount: tracker.rawQueries.length,
      rawQuerySample: tracker.rawQueries.slice(0, 5),
    },
  };
}

const umzug = new Umzug({
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, tableName: 'sequelize_meta' }),
    logger: console,
    migrations: {
        glob: migrationsGlob,
        resolve: ({ name, path, context }) => {
            const runId = currentRunId;
            const direction = currentDirection;
            return {
                name,
                up: async () => {
                    if (!path) {
                        throw new Error(`Migration ${name} is missing file path`);
                    }
                    await startMigrationStep(runId, direction, name);
                    let verifyStatus: string | undefined;
                    let verifyDetails: unknown;
                    try {
                    const migration = (await import(pathToFileURL(path).href)) as MigrationModule;
                        if (typeof migration.up !== 'function') {
                            throw new Error(`Migration ${name} is missing an up() export`);
                        }
                        const tracker = createMigrationTracker();
                        const trackedContext = createTrackedQueryInterface(context, tracker);
                        const originalQuery = context.sequelize.query.bind(context.sequelize);
                        (context.sequelize as unknown as { query: (...args: any[]) => any }).query = async (...args: unknown[]) => {
                            const sql = safeSqlPreview(args[0]);
                            tracker.rawQueries.push(sql.slice(0, 500));
                            const [sqlArg, options] = args as [unknown, unknown];
                            return originalQuery(sqlArg as any, options as any);
                        };
                        try {
                            await migration.up({ context: trackedContext });
                        } finally {
                            (context.sequelize as unknown as { query: (...args: any[]) => any }).query = originalQuery;
                        }
                        const autoVerify = await verifyTrackedObjects(tracker);
                        const manualVerify = typeof migration.verify === 'function'
                            ? interpretVerifyResult(await migration.verify({ context }))
                            : { status: 'skipped', details: null, shouldFail: false };
                        const combinedVerify = combineVerifyResults(autoVerify, manualVerify);
                        verifyStatus = combinedVerify.status;
                        verifyDetails = combinedVerify.details;
                        if (combinedVerify.shouldFail) {
                            throw new Error(`Verification failed for ${name}`);
                        }
                        await finishMigrationStep(runId, direction, name, 'success', undefined, verifyStatus, verifyDetails);
                    }
                    catch (error) {
                        await finishMigrationStep(runId, direction, name, 'failed', error, verifyStatus, verifyDetails);
                        throw error;
                    }
                },
                down: async () => {
                    if (!path) {
                        throw new Error(`Migration ${name} is missing file path`);
                    }
                    await startMigrationStep(runId, direction, name);
                    try {
                        const migration = (await import(pathToFileURL(path).href)) as MigrationModule;
                        if (typeof migration.down !== 'function') {
                            throw new Error(`Migration ${name} is missing a down() export`);
                        }
                        await migration.down({ context });
                        await finishMigrationStep(runId, direction, name, 'success');
                    }
                    catch (error) {
                        await finishMigrationStep(runId, direction, name, 'failed', error);
                        throw error;
                    }
                },
            };
        },
    },
});
let currentRunId = '';
let currentDirection = 'up';

async function run() {
    const shouldUndo = process.argv.includes('--undo');
    currentDirection = shouldUndo ? 'down' : 'up';
    currentRunId = randomUUID();
    let failure: unknown;
    try {
        await ensureMigrationAuditTables();
        await ensureBaselineState();
        await startMigrationRun(currentRunId, currentDirection);
        if (shouldUndo) {
            await umzug.down({ step: 1 });
        }
        else {
            await umzug.up();
        }
    }
    catch (error) {
        failure = error;
        throw error;
    }
    finally {
        const status = failure ? 'failed' : 'success';
        try {
            await finishMigrationRun(currentRunId, currentDirection, status, failure);
        }
        finally {
            await sequelize.close();
        }
    }
}
run().catch((error) => {
    console.error('Migration execution failed', error);
    process.exit(1);
});
