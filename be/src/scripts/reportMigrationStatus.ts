import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryTypes, type Transaction } from 'sequelize';
import {
  createMigrationRuntimeStatus,
  inspectMigrationDatabase,
  listCompiledMigrationNames,
  MigrationDatabaseSafetyError,
  type MigrationSelectQuery,
  type MigrationRuntimeStatus,
} from './migrationRuntimeStatus.js';
import {
  createRuntimeDatabase,
  loadRuntimeEnvironment,
  readRuntimeDatabaseConfiguration,
  RuntimeDatabaseConfigurationError,
  withReadOnlyTransaction,
} from './runtimeDatabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const writeJson = (stream: NodeJS.WriteStream, value: unknown): void => {
  stream.write(`${JSON.stringify(value)}\n`);
};

async function run(): Promise<void> {
  loadRuntimeEnvironment();
  const compiledMigrationNames = await listCompiledMigrationNames(join(__dirname, '../migrations'));
  const configuration = readRuntimeDatabaseConfiguration(process.env, {
    requirePassword: process.env.NODE_ENV?.trim().toLowerCase() === 'production',
  });
  const database = createRuntimeDatabase(configuration);
  let status: MigrationRuntimeStatus;
  try {
    const inventory = await withReadOnlyTransaction(database, async (transaction: Transaction) => {
      const selectQuery: MigrationSelectQuery = async <T>(
        sql: string,
        replacements?: Record<string, unknown>,
      ): Promise<T[]> => database.query(sql, {
        replacements,
        type: QueryTypes.SELECT,
        transaction,
      }) as Promise<T[]>;
      return inspectMigrationDatabase(selectQuery);
    });
    status = createMigrationRuntimeStatus({
      inventory,
      compiledMigrationNames,
    });
  } finally {
    await database.close();
  }
  writeJson(process.stdout, status);
}

run().catch((error: unknown) => {
  let code = 'MIGRATION_STATUS_FAILED';
  let details: Record<string, unknown> | undefined;
  if (error instanceof RuntimeDatabaseConfigurationError) {
    code = 'DATABASE_CONFIGURATION_INVALID';
    details = { missing: error.missing, invalid: error.invalid };
  } else if (error instanceof MigrationDatabaseSafetyError) {
    code = 'MIGRATION_DATABASE_UNSAFE';
    details = { classification: error.classification };
  }
  writeJson(process.stderr, {
    schemaVersion: 1,
    kind: 'omnilodge-migration-status',
    ok: false,
    error: {
      code,
      ...(details ? { details } : {}),
    },
  });
  process.exitCode = 1;
});
