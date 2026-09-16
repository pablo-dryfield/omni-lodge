import { promises as fs } from 'node:fs';
import {
  assertMigrationMetadataLineage,
  classifyMigrationDatabase,
  MIGRATION_CONTROL_TABLES,
  PRE_CI_PRODUCTION_METADATA_PROFILE,
  type MigrationDatabaseClassification,
  type MigrationDatabaseInventory,
  type MigrationMetadataLineage,
} from './migrationSafety.js';
import { LEGACY_ADOPTION_MIGRATIONS } from './legacyMigrationAdoptionProfile.js';

export type MigrationSelectQuery = <T>(
  sql: string,
  replacements?: Record<string, unknown>,
) => Promise<T[]>;

export type MigrationRuntimeStatus = Readonly<{
  schemaVersion: 1;
  kind: 'omnilodge-migration-status';
  ok: true;
  classification: Extract<MigrationDatabaseClassification, 'fresh' | 'managed'>;
  lineage: MigrationMetadataLineage['kind'];
  metadataTableExists: boolean;
  appliedMigrationCount: number;
  compiledMigrationCount: number;
  pendingMigrationCount: number;
  pendingMigrationNames: string[];
}>;

export class MigrationDatabaseSafetyError extends Error {
  readonly classification: MigrationDatabaseClassification;

  constructor(classification: MigrationDatabaseClassification, message: string) {
    super(message);
    this.name = 'MigrationDatabaseSafetyError';
    this.classification = classification;
  }
}

export async function inspectMigrationDatabase(
  selectQuery: MigrationSelectQuery,
): Promise<MigrationDatabaseInventory> {
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

export async function listCompiledMigrationNames(
  migrationsDirectory: string,
): Promise<string[]> {
  const entries = await fs.readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();
}

export function createMigrationRuntimeStatus({
  inventory,
  compiledMigrationNames,
}: {
  inventory: MigrationDatabaseInventory;
  compiledMigrationNames: string[];
}): MigrationRuntimeStatus {
  if (inventory.appliedMigrationCount !== inventory.appliedMigrationNames.length) {
    throw new Error('Migration inventory is inconsistent: applied migration count does not match its names.');
  }
  if (inventory.appliedMigrationCount > 0 && !inventory.metadataTableExists) {
    throw new Error('Migration inventory is inconsistent: applied migrations exist without sequelize_meta.');
  }

  const classification = classifyMigrationDatabase(inventory);
  if (classification === 'unmanaged_existing_schema') {
    const sample = inventory.applicationTables.slice(0, 5).join(', ');
    throw new MigrationDatabaseSafetyError(
      classification,
      'Migration authority is missing: application tables exist while sequelize_meta is missing or empty. '
      + 'The normal migration runner will not adopt an existing schema automatically. '
      + 'Use the reviewed operator-only legacy adoption command first. '
      + `applicationTableCount=${inventory.applicationTables.length} sample=${sample}`,
    );
  }
  if (classification === 'unexpected_control_state') {
    throw new MigrationDatabaseSafetyError(
      classification,
      'Migration control state is inconsistent: migration audit tables exist while sequelize_meta is missing or empty. '
      + 'Review and repair the control tables explicitly before running migrations. '
      + `existingControlTables=${inventory.existingControlTables.join(',')}`,
    );
  }
  if (classification === 'inconsistent_metadata') {
    throw new MigrationDatabaseSafetyError(
      classification,
      'Migration metadata is inconsistent: sequelize_meta contains applied migrations but no application tables exist. '
      + `appliedMigrationCount=${inventory.appliedMigrationCount}`,
    );
  }

  const lineage = assertMigrationMetadataLineage({
    compiledMigrationNames,
    appliedMigrationNames: inventory.appliedMigrationNames,
    legacyAdoptionMigrationNames: LEGACY_ADOPTION_MIGRATIONS,
    preCiProductionProfile: PRE_CI_PRODUCTION_METADATA_PROFILE,
  });
  const appliedNames = new Set(inventory.appliedMigrationNames);
  const pendingMigrationNames = compiledMigrationNames.filter((name) => !appliedNames.has(name));

  return {
    schemaVersion: 1,
    kind: 'omnilodge-migration-status',
    ok: true,
    classification,
    lineage: lineage.kind,
    metadataTableExists: inventory.metadataTableExists,
    appliedMigrationCount: inventory.appliedMigrationCount,
    compiledMigrationCount: compiledMigrationNames.length,
    pendingMigrationCount: pendingMigrationNames.length,
    pendingMigrationNames,
  };
}

export async function inspectMigrationRuntimeStatus({
  selectQuery,
  migrationsDirectory,
}: {
  selectQuery: MigrationSelectQuery;
  migrationsDirectory: string;
}): Promise<MigrationRuntimeStatus> {
  const [inventory, compiledMigrationNames] = await Promise.all([
    inspectMigrationDatabase(selectQuery),
    listCompiledMigrationNames(migrationsDirectory),
  ]);
  return createMigrationRuntimeStatus({ inventory, compiledMigrationNames });
}
