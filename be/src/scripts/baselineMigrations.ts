import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { QueryTypes, Transaction } from 'sequelize';
import sequelize from '../config/database.js';
import { assertLegacyAdoptionInventory, MIGRATION_CONTROL_TABLES } from './migrationSafety.js';
import {
  fingerprintLegacySchema,
  LEGACY_ADOPTION_PROFILE,
  LEGACY_SCHEMA_FINGERPRINT_VERSION,
  legacyAdoptionConfirmation,
  legacySnapshotCounts,
  type LegacySchemaSnapshot,
} from './legacyMigrationAdoptionProfile.js';

type AdoptionArguments = {
  profileId: string | null;
  confirmation: string | null;
  apply: boolean;
};

type QueryTransaction = Transaction | null | undefined;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArguments(argv: string[]): AdoptionArguments {
  const parsed: AdoptionArguments = { profileId: null, confirmation: null, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (argument === '--profile' || argument === '--confirm') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      if (argument === '--profile') parsed.profileId = value;
      else parsed.confirmation = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

async function selectRows<T>(
  sql: string,
  replacements?: Record<string, unknown>,
  transaction?: QueryTransaction,
): Promise<T[]> {
  return sequelize.query(sql, {
    replacements,
    transaction,
    type: QueryTypes.SELECT,
  }) as Promise<T[]>;
}

async function metadataInventory(transaction?: QueryTransaction): Promise<{
  metadataTableExists: boolean;
  appliedMigrationCount: number;
  appliedMigrationNames: string[];
  existingControlTables: string[];
  applicationTables: string[];
}> {
  const controlTables = await selectRows<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN (:controlTables)
      ORDER BY table_name;
    `,
    { controlTables: [...MIGRATION_CONTROL_TABLES] },
    transaction,
  );
  const existingControlTables = controlTables.map((row) => row.table_name);
  const metadataTableExists = existingControlTables.includes('sequelize_meta');
  const applicationTables = await selectRows<{ table_name: string }>(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN (:controlTables)
      ORDER BY table_name;
    `,
    { controlTables: [...MIGRATION_CONTROL_TABLES] },
    transaction,
  );
  let appliedMigrationNames: string[] = [];
  if (metadataTableExists) {
    const rows = await selectRows<{ name: string }>(
      'SELECT name FROM sequelize_meta ORDER BY name;',
      undefined,
      transaction,
    );
    appliedMigrationNames = rows.map((row) => row.name);
  }
  return {
    metadataTableExists,
    appliedMigrationCount: appliedMigrationNames.length,
    appliedMigrationNames,
    existingControlTables,
    applicationTables: applicationTables.map((row) => row.table_name),
  };
}

async function loadLegacySchemaSnapshot(transaction?: QueryTransaction): Promise<LegacySchemaSnapshot> {
  const replacements = { controlTables: [...MIGRATION_CONTROL_TABLES] };
  const tables = await selectRows(
    `
      SELECT c.relname AS table_name,
             c.relkind AS relation_kind,
             c.relrowsecurity AS row_security,
             c.relforcerowsecurity AS force_row_security
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relname NOT IN (:controlTables)
      ORDER BY c.relname;
    `,
    replacements,
    transaction,
  );
  const columns = await selectRows(
    `
      SELECT c.relname AS table_name,
             a.attnum::integer AS ordinal_position,
             a.attname AS column_name,
             pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
             a.attnotnull AS not_null,
             COALESCE(pg_get_expr(d.adbin, d.adrelid, true), '') AS default_expression,
             a.attidentity AS identity_kind,
             a.attgenerated AS generated_kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a
        ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND c.relname NOT IN (:controlTables)
      ORDER BY c.relname, a.attnum;
    `,
    replacements,
    transaction,
  );
  const constraints = await selectRows(
    `
      SELECT source_table.relname AS table_name,
             constraint_record.conname AS constraint_name,
             constraint_record.contype AS constraint_type,
             COALESCE(ARRAY(
               SELECT attribute.attname
               FROM unnest(constraint_record.conkey) WITH ORDINALITY key_column(attnum, ordinal_position)
               JOIN pg_attribute attribute
                 ON attribute.attrelid = constraint_record.conrelid
                AND attribute.attnum = key_column.attnum
               ORDER BY key_column.ordinal_position
             ), ARRAY[]::text[]) AS columns,
             target_namespace.nspname AS foreign_schema,
             target_table.relname AS foreign_table,
             COALESCE(ARRAY(
               SELECT attribute.attname
               FROM unnest(constraint_record.confkey) WITH ORDINALITY key_column(attnum, ordinal_position)
               JOIN pg_attribute attribute
                 ON attribute.attrelid = constraint_record.confrelid
                AND attribute.attnum = key_column.attnum
               ORDER BY key_column.ordinal_position
             ), ARRAY[]::text[]) AS foreign_columns,
             constraint_record.confupdtype::text AS update_action,
             constraint_record.confdeltype::text AS delete_action,
             constraint_record.condeferrable AS deferrable,
             constraint_record.condeferred AS initially_deferred,
             constraint_record.convalidated AS validated,
             COALESCE(
               pg_get_expr(constraint_record.conbin, constraint_record.conrelid, true),
               ''
             ) AS check_expression
      FROM pg_constraint constraint_record
      JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid
      JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
      LEFT JOIN pg_class target_table ON target_table.oid = constraint_record.confrelid
      LEFT JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
      WHERE source_namespace.nspname = 'public'
        AND source_table.relname NOT IN (:controlTables)
      ORDER BY source_table.relname, constraint_record.conname;
    `,
    replacements,
    transaction,
  );
  const indexes = await selectRows(
    `
      SELECT table_record.relname AS table_name,
             index_record.relname AS index_name,
             index_metadata.indisunique AS is_unique,
             index_metadata.indisprimary AS is_primary,
             index_metadata.indisvalid AS is_valid,
             index_metadata.indisready AS is_ready,
             access_method.amname AS access_method,
             ARRAY(
               SELECT pg_get_indexdef(index_metadata.indexrelid, key_position, true)
               FROM generate_series(1, index_metadata.indnkeyatts) key_position
               ORDER BY key_position
             ) AS keys,
             COALESCE(
               pg_get_expr(index_metadata.indpred, index_metadata.indrelid, true),
               ''
             ) AS predicate
      FROM pg_index index_metadata
      JOIN pg_class table_record ON table_record.oid = index_metadata.indrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      JOIN pg_class index_record ON index_record.oid = index_metadata.indexrelid
      JOIN pg_am access_method ON access_method.oid = index_record.relam
      WHERE namespace_record.nspname = 'public'
        AND table_record.relname NOT IN (:controlTables)
      ORDER BY table_record.relname, index_record.relname;
    `,
    replacements,
    transaction,
  );
  const enums = await selectRows(
    `
      SELECT type_record.typname AS enum_name,
             enum_record.enumsortorder::text AS sort_order,
             enum_record.enumlabel AS label
      FROM pg_type type_record
      JOIN pg_namespace namespace_record ON namespace_record.oid = type_record.typnamespace
      JOIN pg_enum enum_record ON enum_record.enumtypid = type_record.oid
      WHERE namespace_record.nspname = 'public'
      ORDER BY type_record.typname, enum_record.enumsortorder;
    `,
    undefined,
    transaction,
  );
  const views = await selectRows(
    `
      SELECT relation.relname AS view_name,
             relation.relkind AS relation_kind,
             pg_get_viewdef(relation.oid, true) AS definition
      FROM pg_class relation
      JOIN pg_namespace namespace_record ON namespace_record.oid = relation.relnamespace
      WHERE namespace_record.nspname = 'public'
        AND relation.relkind IN ('v', 'm')
      ORDER BY relation.relname;
    `,
    undefined,
    transaction,
  );
  const triggers = await selectRows(
    `
      SELECT table_record.relname AS table_name,
             trigger_record.tgname AS trigger_name,
             trigger_record.tgenabled AS enabled,
             pg_get_triggerdef(trigger_record.oid, true) AS definition
      FROM pg_trigger trigger_record
      JOIN pg_class table_record ON table_record.oid = trigger_record.tgrelid
      JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      WHERE namespace_record.nspname = 'public'
        AND NOT trigger_record.tgisinternal
        AND table_record.relname NOT IN (:controlTables)
      ORDER BY table_record.relname, trigger_record.tgname;
    `,
    replacements,
    transaction,
  );
  return {
    version: LEGACY_SCHEMA_FINGERPRINT_VERSION,
    tables,
    columns,
    constraints,
    indexes,
    enums,
    views,
    triggers,
  };
}

async function assertCompiledProfileInventory(): Promise<void> {
  const migrationsDirectory = join(__dirname, '../migrations');
  const compiledNames = new Set(
    (await fs.readdir(migrationsDirectory)).filter((entry) => entry.endsWith('.js')),
  );
  const missing = LEGACY_ADOPTION_PROFILE.migrationNames.filter((name) => !compiledNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Legacy profile references missing compiled migrations: ${missing.join(', ')}`);
  }
}

async function assertAdoptable(transaction?: QueryTransaction): Promise<LegacySchemaSnapshot> {
  const inventory = await metadataInventory(transaction);
  assertLegacyAdoptionInventory(inventory);
  const snapshot = await loadLegacySchemaSnapshot(transaction);
  const actualFingerprint = fingerprintLegacySchema(snapshot);
  if (actualFingerprint !== LEGACY_ADOPTION_PROFILE.schemaFingerprint) {
    throw new Error(
      'Legacy schema fingerprint mismatch. '
      + `expected=${LEGACY_ADOPTION_PROFILE.schemaFingerprint} actual=${actualFingerprint} `
      + `counts=${JSON.stringify(legacySnapshotCounts(snapshot))}`,
    );
  }
  return snapshot;
}

async function applyAdoption(): Promise<void> {
  await sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.SERIALIZABLE },
    async (transaction) => {
      await sequelize.query(
        `SELECT pg_advisory_xact_lock(hashtext('omnilodge-legacy-migration-adoption'));`,
        { transaction, type: QueryTypes.SELECT },
      );
      await assertAdoptable(transaction);
      await sequelize.query(
        `CREATE TABLE sequelize_meta (name VARCHAR(255) PRIMARY KEY);`,
        { transaction },
      );
      await sequelize.query(
        `
          INSERT INTO sequelize_meta (name)
          SELECT adopted.migration_name
          FROM unnest(CAST($1 AS VARCHAR(255)[])) AS adopted(migration_name);
        `,
        { bind: [[...LEGACY_ADOPTION_PROFILE.migrationNames]], transaction },
      );
    },
  );
}

async function run(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.profileId !== LEGACY_ADOPTION_PROFILE.id) {
    throw new Error(
      `Select the committed profile with --profile ${LEGACY_ADOPTION_PROFILE.id}. `
      + 'No other profile is authorized.',
    );
  }
  await assertCompiledProfileInventory();
  const snapshot = await assertAdoptable();
  const counts = legacySnapshotCounts(snapshot);

  if (!args.apply) {
    console.log(JSON.stringify({
      status: 'dry-run-valid',
      profile: LEGACY_ADOPTION_PROFILE.id,
      fingerprint: LEGACY_ADOPTION_PROFILE.schemaFingerprint,
      migrationCount: LEGACY_ADOPTION_PROFILE.migrationNames.length,
      counts,
      applied: false,
    }));
    return;
  }

  const expectedConfirmation = legacyAdoptionConfirmation(LEGACY_ADOPTION_PROFILE);
  if (args.confirmation !== expectedConfirmation) {
    throw new Error(
      'Applying legacy adoption requires --confirm '
      + `${expectedConfirmation}`,
    );
  }
  await applyAdoption();
  console.log(JSON.stringify({
    status: 'adopted',
    profile: LEGACY_ADOPTION_PROFILE.id,
    fingerprint: LEGACY_ADOPTION_PROFILE.schemaFingerprint,
    migrationCount: LEGACY_ADOPTION_PROFILE.migrationNames.length,
    applied: true,
  }));
}

run()
  .catch((error) => {
    console.error('Legacy migration adoption failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
