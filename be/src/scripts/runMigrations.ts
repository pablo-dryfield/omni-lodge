import 'dotenv/config';
import { randomUUID } from 'crypto';
import { QueryTypes } from 'sequelize';
import type { QueryInterface, Transaction } from 'sequelize';
import { Umzug, SequelizeStorage } from 'umzug';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';
import sequelize from '../config/database.js';
import {
  assertMigrationMetadataLineage,
  classifyMigrationDatabase,
  MIGRATION_CONTROL_TABLES,
  normalizeConstraintAction,
  normalizeIndexMethod,
  PRE_CI_PRODUCTION_METADATA_PROFILE,
  resolveConstraintDefinition,
  resolveIndexDefinition,
  type ConstraintDefinition,
  type IndexDefinition,
} from './migrationSafety.js';
import { LEGACY_ADOPTION_MIGRATIONS } from './legacyMigrationAdoptionProfile.js';

const TABLE_MIGRATION_RUNS = 'migration_audit_runs';
const TABLE_MIGRATION_STEPS = 'migration_audit_steps';
const strictVerification = (process.env.MIGRATION_VERIFY_STRICT ?? 'false').trim().toLowerCase() === 'true';
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

type IndexSpec = IndexDefinition & {
  table: string;
  schema: string;
  predicateWhere?: unknown;
};

type ConstraintSpec = ConstraintDefinition & {
  table: string;
  schema: string;
  checkWhere?: unknown;
};

type IndexOptions = {
  name?: string;
  unique?: boolean;
  using?: string;
  type?: string;
  where?: unknown;
  transaction?: Transaction | null;
};

type ConstraintOptions = {
  type?: string;
  fields?: unknown[];
  name?: string;
  references?: unknown;
  onUpdate?: string;
  onDelete?: string;
  where?: unknown;
  transaction?: Transaction | null;
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

async function inspectMigrationDatabase(): Promise<{
  metadataTableExists: boolean;
  appliedMigrationCount: number;
  appliedMigrationNames: string[];
  existingControlTables: string[];
  applicationTables: string[];
}> {
  const controlTableRows = await selectQuery<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN (:controlTables)
      ORDER BY table_name;
    `,
    { controlTables: [...MIGRATION_CONTROL_TABLES] },
  );
  const existingControlTables = controlTableRows.map((row) => row.table_name);
  const metadataTableExists = existingControlTables.includes('sequelize_meta');
  let appliedMigrationNames: string[] = [];
  if (metadataTableExists) {
    const rows = await selectQuery<{ name: string }>(
      'SELECT name FROM sequelize_meta ORDER BY name;',
    );
    appliedMigrationNames = rows.map((row) => row.name);
  }

  const tableRows = await selectQuery<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN (:controlTables)
      ORDER BY table_name;
    `,
    { controlTables: [...MIGRATION_CONTROL_TABLES] },
  );
  return {
    metadataTableExists,
    appliedMigrationCount: appliedMigrationNames.length,
    appliedMigrationNames,
    existingControlTables,
    applicationTables: tableRows.map((row) => row.table_name),
  };
}

async function listCompiledMigrationNames(): Promise<string[]> {
  const migrationsDirectory = join(__dirname, '../migrations');
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();
}

async function assertMigrationDatabaseSafe(): Promise<void> {
  const [inventory, compiledMigrationNames] = await Promise.all([
    inspectMigrationDatabase(),
    listCompiledMigrationNames(),
  ]);
  const classification = classifyMigrationDatabase(inventory);
  if (classification === 'fresh') {
    assertMigrationMetadataLineage({
      compiledMigrationNames,
      appliedMigrationNames: inventory.appliedMigrationNames,
      legacyAdoptionMigrationNames: LEGACY_ADOPTION_MIGRATIONS,
      preCiProductionProfile: PRE_CI_PRODUCTION_METADATA_PROFILE,
    });
    return;
  }

  if (classification === 'managed') {
    assertMigrationMetadataLineage({
      compiledMigrationNames,
      appliedMigrationNames: inventory.appliedMigrationNames,
      legacyAdoptionMigrationNames: LEGACY_ADOPTION_MIGRATIONS,
      preCiProductionProfile: PRE_CI_PRODUCTION_METADATA_PROFILE,
    });
    return;
  }

  if (classification === 'unmanaged_existing_schema') {
    const sample = inventory.applicationTables.slice(0, 5).join(', ');
    throw new Error(
      'Migration authority is missing: application tables exist while sequelize_meta is missing or empty. '
      + 'The normal migration runner will not adopt an existing schema automatically. '
      + 'Use the reviewed operator-only legacy adoption command first. '
      + `applicationTableCount=${inventory.applicationTables.length} sample=${sample}`,
    );
  }

  if (classification === 'unexpected_control_state') {
    throw new Error(
      'Migration control state is inconsistent: migration audit tables exist while sequelize_meta is missing or empty. '
      + 'Review and repair the control tables explicitly before running migrations. '
      + `existingControlTables=${inventory.existingControlTables.join(',')}`,
    );
  }

  throw new Error(
    'Migration metadata is inconsistent: sequelize_meta contains applied migrations but no application tables exist. '
    + `appliedMigrationCount=${inventory.appliedMigrationCount}`,
  );
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

function resolveReference(ref: unknown): ConstraintDefinition['references'] | null {
  if (!ref) {
    return null;
  }
  if (typeof ref === 'string') {
    return { table: ref, schema: 'public', columns: ['id'] };
  }
  if (typeof ref !== 'object') {
    return null;
  }
  const refObj = ref as {
    table?: string | { tableName: string; schema?: string };
    model?: string | { tableName?: string; name?: string; schema?: string };
    key?: string | string[];
    field?: string | string[];
    fields?: unknown[];
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
  const rawColumns = refObj.fields ?? refObj.key ?? refObj.field ?? 'id';
  const columns = (Array.isArray(rawColumns) ? rawColumns : [rawColumns]).map(normalizeField);
  return { table, schema, columns };
}

function recordCreateTable(tracker: MigrationTracker, tableRef: TableRef, attributes: Record<string, unknown>): void {
  const { schema, table } = normalizeTableRef(tableRef);
  const entry = ensureTableExpectation(tracker, schema, table, true);
  for (const [columnName, definition] of Object.entries(attributes ?? {})) {
    let physicalColumnName = columnName;
    if (definition && typeof definition === 'object') {
      const def = definition as {
        field?: unknown;
        primaryKey?: boolean;
        references?: unknown;
        unique?: boolean | string;
        onUpdate?: string;
        onDelete?: string;
      };
      if (typeof def.field === 'string' && def.field.trim()) {
        physicalColumnName = def.field;
      }
      entry.columns.add(physicalColumnName);
      if (def.primaryKey) {
        entry.primaryKeyColumns.add(physicalColumnName);
      }
      const reference = resolveReference(def.references);
      if (reference) {
        tracker.constraints.push({
          table,
          schema,
          type: 'FOREIGN KEY',
          columns: [physicalColumnName],
          references: {
            table: reference.table,
            schema: reference.schema,
            columns: reference.columns,
          },
          onUpdate: normalizeConstraintAction(def.onUpdate),
          onDelete: normalizeConstraintAction(def.onDelete),
        });
      }
      if (def.unique) {
        tracker.constraints.push({
          table,
          schema,
          type: 'UNIQUE',
          columns: [physicalColumnName],
          name: typeof def.unique === 'string' ? def.unique : undefined,
        });
      }
    } else {
      entry.columns.add(physicalColumnName);
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
    const def = definition as {
      primaryKey?: boolean;
      references?: unknown;
      unique?: boolean | string;
      onUpdate?: string;
      onDelete?: string;
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
          columns: reference.columns,
        },
        onUpdate: normalizeConstraintAction(def.onUpdate),
        onDelete: normalizeConstraintAction(def.onDelete),
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
  options?: IndexOptions,
): void {
  const { schema, table } = normalizeTableRef(tableRef);
  const fieldList = Array.isArray(fields) ? fields : [fields];
  tracker.indexes.push({
    table,
    schema,
    name: options?.name,
    unique: Boolean(options?.unique),
    method: normalizeIndexMethod(options?.using ?? options?.type),
    hasPredicate: options?.where != null,
    predicateWhere: options?.where,
    columns: fieldList.map(normalizeField),
  });
}

function recordAddConstraint(
  tracker: MigrationTracker,
  tableRef: TableRef,
  options: ConstraintOptions,
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
      ? { table: reference.table, schema: reference.schema, columns: reference.columns }
      : undefined,
    onUpdate: normalizeConstraintAction(options.onUpdate),
    onDelete: normalizeConstraintAction(options.onDelete),
    checkWhere: options.where,
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
        return async (tableName: TableRef, fields: unknown[], options?: IndexOptions) => {
          recordAddIndex(tracker, tableName, fields, options);
          const { schema, table } = normalizeTableRef(tableName);
          const transaction = getTransaction(options);
          const expectedIndex: IndexSpec = {
            table,
            schema,
            name: options?.name,
            unique: Boolean(options?.unique),
            method: normalizeIndexMethod(options?.using ?? options?.type),
            hasPredicate: options?.where != null,
            predicateWhere: options?.where,
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
        return async (tableName: TableRef, options: ConstraintOptions) => {
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
            onUpdate: normalizeConstraintAction(options.onUpdate),
            onDelete: normalizeConstraintAction(options.onDelete),
            checkWhere: options.where,
          };
          if (await constraintExists(schema, table, expectedConstraint, transaction)) {
            tracker.warnings.push(`addConstraint skipped for existing ${schema}.${table}`);
            return undefined;
          }
          return (target.addConstraint as (...args: unknown[]) => unknown).call(target, tableName, options);
        };
      }
      if (prop === 'renameTable') {
        return async (before: TableRef, after: TableRef, options?: unknown) => {
          recordRenameTable(tracker, after);
          const beforeRef = normalizeTableRef(before);
          const afterRef = normalizeTableRef(after);
          const transaction = getTransaction(options);
          if (!(await tableExists(beforeRef.schema, beforeRef.table, transaction))
            && await tableExists(afterRef.schema, afterRef.table, transaction)) {
            tracker.warnings.push(`renameTable skipped for existing ${afterRef.schema}.${afterRef.table}`);
            return undefined;
          }
          return (target.renameTable as (...args: unknown[]) => unknown).call(target, before, after, options);
        };
      }
      if (prop === 'renameColumn') {
        return async (tableName: TableRef, oldName: string, newName: string, options?: unknown) => {
          recordRenameColumn(tracker, tableName, newName);
          const { schema, table } = normalizeTableRef(tableName);
          const transaction = getTransaction(options);
          if (!(await columnExists(schema, table, oldName, transaction))
            && await columnExists(schema, table, newName, transaction)) {
            tracker.warnings.push(`renameColumn skipped for existing ${schema}.${table}.${newName}`);
            return undefined;
          }
          return (target.renameColumn as (...args: unknown[]) => unknown)
            .call(target, tableName, oldName, newName, options);
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
                  WHERE ${quoteIdentifier(key)} IN (:values);
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
    `
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = :schema
        AND table_name = :table
        AND table_type = 'BASE TABLE'
      LIMIT 1;
    `,
    { schema, table },
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
): Promise<IndexDefinition[]> {
  const rows = await selectQuery<{
    index_name: string;
    is_unique: boolean;
    columns: string[];
    access_method: string;
    has_predicate: boolean;
    predicate: string | null;
    is_valid: boolean;
    is_ready: boolean;
  }>(
    `
      SELECT
        i.relname AS index_name,
        ix.indisunique AS is_unique,
        ARRAY(
          SELECT CASE
            WHEN key_column.attnum > 0 THEN attribute.attname
            ELSE pg_get_indexdef(ix.indexrelid, key_column.ordinal_position::integer, true)
          END
          FROM unnest(ix.indkey) WITH ORDINALITY key_column(attnum, ordinal_position)
          LEFT JOIN pg_attribute attribute
            ON attribute.attrelid = ix.indrelid
           AND attribute.attnum = key_column.attnum
          WHERE key_column.ordinal_position <= ix.indnkeyatts
          ORDER BY key_column.ordinal_position
        ) AS columns,
        am.amname AS access_method,
        ix.indpred IS NOT NULL AS has_predicate,
        pg_get_expr(ix.indpred, ix.indrelid, true) AS predicate,
        ix.indisvalid AS is_valid,
        ix.indisready AS is_ready
      FROM pg_class t
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_index ix ON ix.indrelid = t.oid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON am.oid = i.relam
      WHERE n.nspname = :schema AND t.relname = :table
      ORDER BY i.relname;
    `,
    { schema, table },
    transaction,
  );
  return rows.map((row) => ({
    name: row.index_name,
    unique: row.is_unique,
    method: normalizeIndexMethod(row.access_method),
    hasPredicate: row.has_predicate,
    predicate: row.has_predicate ? row.predicate ?? undefined : undefined,
    valid: row.is_valid,
    ready: row.is_ready,
    columns: Array.isArray(row.columns)
      ? row.columns
      : String(row.columns).replace(/[{}]/g, '').split(',').filter(Boolean),
  }));
}

function postgresConstraintType(type: string): string {
  const types: Record<string, string> = {
    p: 'PRIMARY KEY',
    u: 'UNIQUE',
    f: 'FOREIGN KEY',
    c: 'CHECK',
    x: 'EXCLUDE',
  };
  return types[type] ?? type.toUpperCase();
}

function postgresConstraintAction(action: string): string {
  const actions: Record<string, string> = {
    a: 'NO ACTION',
    r: 'RESTRICT',
    c: 'CASCADE',
    n: 'SET NULL',
    d: 'SET DEFAULT',
  };
  return actions[action] ?? action.toUpperCase();
}

async function listTableConstraints(
  schema: string,
  table: string,
  transaction?: Transaction | null,
): Promise<ConstraintDefinition[]> {
  const rows = await selectQuery<{
    constraint_name: string;
    constraint_type: string;
    columns: string[];
    foreign_schema: string | null;
    foreign_table: string | null;
    foreign_columns: string[];
    update_action: string;
    delete_action: string;
    check_expression: string | null;
  }>(
    `
      SELECT
        constraint_record.conname AS constraint_name,
        constraint_record.contype::text AS constraint_type,
        to_jsonb(COALESCE(ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_record.conkey) WITH ORDINALITY key_column(attnum, ordinal_position)
          JOIN pg_attribute attribute
            ON attribute.attrelid = constraint_record.conrelid
           AND attribute.attnum = key_column.attnum
          ORDER BY key_column.ordinal_position
        ), ARRAY[]::text[])) AS columns,
        target_namespace.nspname AS foreign_schema,
        target_table.relname AS foreign_table,
        to_jsonb(COALESCE(ARRAY(
          SELECT attribute.attname
          FROM unnest(constraint_record.confkey) WITH ORDINALITY key_column(attnum, ordinal_position)
          JOIN pg_attribute attribute
            ON attribute.attrelid = constraint_record.confrelid
           AND attribute.attnum = key_column.attnum
          ORDER BY key_column.ordinal_position
        ), ARRAY[]::text[])) AS foreign_columns,
        constraint_record.confupdtype::text AS update_action,
        constraint_record.confdeltype::text AS delete_action,
        CASE
          WHEN constraint_record.contype = 'c'
          THEN pg_get_expr(constraint_record.conbin, constraint_record.conrelid, true)
          ELSE NULL
        END AS check_expression
      FROM pg_constraint constraint_record
      JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid
      JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
      LEFT JOIN pg_class target_table ON target_table.oid = constraint_record.confrelid
      LEFT JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
      WHERE source_namespace.nspname = :schema AND source_table.relname = :table
      ORDER BY constraint_record.conname;
    `,
    { schema, table },
    transaction,
  );
  return rows.map((row) => ({
    name: row.constraint_name,
    type: postgresConstraintType(row.constraint_type),
    columns: row.columns,
    references: row.foreign_schema && row.foreign_table
      ? {
        schema: row.foreign_schema,
        table: row.foreign_table,
        columns: row.foreign_columns,
      }
      : undefined,
    onUpdate: postgresConstraintAction(row.update_action),
    onDelete: postgresConstraintAction(row.delete_action),
    checkExpression: row.check_expression ?? undefined,
  }));
}

type PredicateObjectKind = 'index' | 'check';

function renderPredicateWhere(where: unknown): string {
  const queryGenerator = sequelize.getQueryInterface().queryGenerator as unknown as {
    whereItemsQuery: (value: unknown) => string;
  };
  const rendered = queryGenerator.whereItemsQuery(where).trim();
  if (!rendered) {
    throw new Error('Unable to render the expected predicate definition.');
  }
  return rendered;
}

async function canonicalizePredicateWithTransaction(
  schema: string,
  table: string,
  where: unknown,
  kind: PredicateObjectKind,
  transaction: Transaction,
): Promise<string> {
  const suffix = randomUUID().replace(/-/gu, '');
  const temporaryTable = `mp_${suffix}`;
  const temporaryObject = `${kind === 'index' ? 'mi' : 'mc'}_${suffix}`;
  let tableCreated = false;
  try {
    await sequelize.query(
      `CREATE TEMP TABLE ${quoteIdentifier(temporaryTable)} `
      + `(LIKE ${quoteQualifiedName(schema, table)}) ON COMMIT DROP;`,
      { transaction },
    );
    tableCreated = true;
    const predicateSql = renderPredicateWhere(where);
    if (kind === 'index') {
      await sequelize.query(
        `CREATE INDEX ${quoteIdentifier(temporaryObject)} `
        + `ON ${quoteIdentifier(temporaryTable)} ((1)) WHERE ${predicateSql};`,
        { transaction },
      );
      const rows = await selectQuery<{ predicate: string | null }>(
        `
          SELECT pg_get_expr(index_metadata.indpred, index_metadata.indrelid, true) AS predicate
          FROM pg_index index_metadata
          JOIN pg_class index_record ON index_record.oid = index_metadata.indexrelid
          WHERE index_record.relnamespace = pg_my_temp_schema()
            AND index_record.relname = :objectName;
        `,
        { objectName: temporaryObject },
        transaction,
      );
      if (!rows[0]?.predicate) throw new Error('PostgreSQL did not return the expected index predicate.');
      return rows[0].predicate;
    }

    await sequelize.query(
      `ALTER TABLE ${quoteIdentifier(temporaryTable)} `
      + `ADD CONSTRAINT ${quoteIdentifier(temporaryObject)} CHECK (${predicateSql});`,
      { transaction },
    );
    const rows = await selectQuery<{ predicate: string | null }>(
      `
        SELECT pg_get_expr(constraint_record.conbin, constraint_record.conrelid, true) AS predicate
        FROM pg_constraint constraint_record
        WHERE constraint_record.connamespace = pg_my_temp_schema()
          AND constraint_record.conname = :objectName;
      `,
      { objectName: temporaryObject },
      transaction,
    );
    if (!rows[0]?.predicate) throw new Error('PostgreSQL did not return the expected check expression.');
    return rows[0].predicate;
  } finally {
    if (tableCreated) {
      await sequelize.query(
        `DROP TABLE IF EXISTS pg_temp.${quoteIdentifier(temporaryTable)};`,
        { transaction },
      ).catch(() => undefined);
    }
  }
}

async function canonicalizePredicate(
  schema: string,
  table: string,
  where: unknown,
  kind: PredicateObjectKind,
  transaction?: Transaction | null,
): Promise<string> {
  if (transaction) {
    return canonicalizePredicateWithTransaction(schema, table, where, kind, transaction);
  }
  return sequelize.transaction(
    (localTransaction) => canonicalizePredicateWithTransaction(
      schema,
      table,
      where,
      kind,
      localTransaction,
    ),
  );
}

async function expectedIndexDefinition(
  expected: IndexSpec,
  transaction?: Transaction | null,
): Promise<IndexDefinition> {
  if (!expected.hasPredicate) return expected;
  if (expected.predicateWhere == null) {
    throw new Error(`Expected partial index ${expected.name ?? '(unnamed)'} has no verifiable predicate.`);
  }
  return {
    ...expected,
    predicate: await canonicalizePredicate(
      expected.schema,
      expected.table,
      expected.predicateWhere,
      'index',
      transaction,
    ),
  };
}

async function expectedConstraintDefinition(
  expected: ConstraintSpec,
  transaction?: Transaction | null,
): Promise<ConstraintDefinition> {
  if (expected.type.trim().toUpperCase() !== 'CHECK') return expected;
  if (expected.checkWhere == null) {
    throw new Error(`Expected check constraint ${expected.name ?? '(unnamed)'} has no verifiable expression.`);
  }
  return {
    ...expected,
    checkExpression: await canonicalizePredicate(
      expected.schema,
      expected.table,
      expected.checkWhere,
      'check',
      transaction,
    ),
  };
}

async function indexExists(
  schema: string,
  table: string,
  expected: IndexSpec,
  transaction?: Transaction | null,
): Promise<boolean> {
  const actualIndexes = await listTableIndexes(schema, table, transaction);
  const expectedDefinition = await expectedIndexDefinition(expected, transaction);
  const resolution = resolveIndexDefinition(expectedDefinition, actualIndexes);
  if (resolution.status === 'name_conflict') {
    throw new Error(
      `Index definition conflict for ${schema}.${table}.${expected.name}: `
      + `${resolution.differences?.join(', ') ?? 'unknown difference'}`,
    );
  }
  return resolution.status !== 'missing';
}

async function constraintExists(
  schema: string,
  table: string,
  expected: ConstraintSpec,
  transaction?: Transaction | null,
): Promise<boolean> {
  const actualConstraints = await listTableConstraints(schema, table, transaction);
  const expectedDefinition = await expectedConstraintDefinition(expected, transaction);
  const resolution = resolveConstraintDefinition(expectedDefinition, actualConstraints);
  if (resolution.status === 'name_conflict') {
    throw new Error(
      `Constraint definition conflict for ${schema}.${table}.${expected.name}: `
      + `${resolution.differences?.join(', ') ?? 'unknown difference'}`,
    );
  }
  return resolution.status !== 'missing';
}

function resolveConstraintReference(references?: unknown): ConstraintDefinition['references'] {
  if (!references) {
    return undefined;
  }
  const resolved = resolveReference(references);
  if (!resolved) {
    return undefined;
  }
  return resolved;
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
  const mismatchedIndexes: Array<{ table: string; name?: string; differences: string[] }> = [];
  const missingConstraints: Array<{
    table: string;
    name?: string;
    type: string;
    columns: string[];
    references?: { table: string; columns: string[] };
  }> = [];
  const mismatchedConstraints: Array<{ table: string; name?: string; differences: string[] }> = [];
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
      const expectedDefinition = await expectedIndexDefinition(expected);
      const resolution = resolveIndexDefinition(expectedDefinition, actualIndexes);
      if (resolution.status === 'name_conflict') {
        mismatchedIndexes.push({
          table: `${schema}.${table}`,
          name: expected.name,
          differences: resolution.differences ?? [],
        });
      } else if (resolution.status === 'missing') {
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
      const expectedDefinition = await expectedConstraintDefinition(expected);
      const resolution = resolveConstraintDefinition(expectedDefinition, actualConstraints);
      if (resolution.status === 'name_conflict') {
        mismatchedConstraints.push({
          table: `${schema}.${table}`,
          name: expected.name,
          differences: resolution.differences ?? [],
        });
      } else if (resolution.status === 'missing') {
        missingConstraints.push({
          table: `${schema}.${table}`,
          name: expected.name,
          type: expected.type,
          columns: expected.columns,
          references: expected.references
            ? {
              table: `${expected.references.schema}.${expected.references.table}`,
              columns: expected.references.columns,
            }
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
          WHERE ${quoteIdentifier(seed.identifierColumn)} IN (:values);
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
    mismatchedIndexes.length > 0 ||
    missingConstraints.length > 0 ||
    mismatchedConstraints.length > 0 ||
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
      mismatchedIndexes,
      missingConstraints,
      mismatchedConstraints,
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
                            throw new Error(
                                `Verification failed for ${name} `
                                + `(auto=${autoVerify.status}, manual=${manualVerify.status})`,
                            );
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
    let auditRunStarted = false;
    try {
        await assertMigrationDatabaseSafe();
        await ensureSequelizeMetaTable();
        await ensureMigrationAuditTables();
        await startMigrationRun(currentRunId, currentDirection);
        auditRunStarted = true;
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
            if (auditRunStarted) {
                await finishMigrationRun(currentRunId, currentDirection, status, failure);
            }
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
