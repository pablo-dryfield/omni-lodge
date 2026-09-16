import dotenv from 'dotenv';
import { QueryTypes, Sequelize, Transaction } from 'sequelize';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type RuntimeDatabaseConfiguration = Readonly<{
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}>;

export class RuntimeDatabaseConfigurationError extends Error {
  readonly missing: string[];
  readonly invalid: string[];

  constructor(missing: string[], invalid: string[]) {
    super('Runtime database configuration is invalid.');
    this.name = 'RuntimeDatabaseConfigurationError';
    this.missing = [...missing];
    this.invalid = [...invalid];
  }
}

export function loadRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): void {
  const environment = (env.NODE_ENV || 'development').trim().toLowerCase();
  const envFile = environment === 'production' ? '.env.prod' : '.env.dev';
  let parsed: Record<string, string>;
  try {
    parsed = dotenv.parse(readFileSync(resolve(cwd, envFile)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  Object.entries(parsed).forEach(([key, value]) => {
    if (env[key] === undefined) env[key] = value;
  });
}

export function readRuntimeDatabaseConfiguration(
  env: NodeJS.ProcessEnv,
  { requirePassword = false }: { requirePassword?: boolean } = {},
): RuntimeDatabaseConfiguration {
  const requiredNames = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'] as const;
  const missing: string[] = requiredNames.filter((name) => !env[name]?.trim());
  if (requirePassword && !env.DB_PASSWORD?.trim()) {
    missing.push('DB_PASSWORD');
  }
  const invalid = missing.length === 0 && (
    !/^\d+$/.test(env.DB_PORT ?? '')
    || Number(env.DB_PORT) < 1
    || Number(env.DB_PORT) > 65_535
  ) ? ['DB_PORT'] : [];

  if (missing.length > 0 || invalid.length > 0) {
    throw new RuntimeDatabaseConfigurationError(missing, invalid);
  }

  return {
    host: env.DB_HOST!.trim(),
    port: Number(env.DB_PORT),
    database: env.DB_NAME!.trim(),
    username: env.DB_USER!.trim(),
    password: env.DB_PASSWORD ?? '',
  };
}

export function createRuntimeDatabase(
  configuration: RuntimeDatabaseConfiguration,
): Sequelize {
  return new Sequelize({
    dialect: 'postgres',
    host: configuration.host,
    port: configuration.port,
    database: configuration.database,
    username: configuration.username,
    password: configuration.password,
    logging: false,
    pool: {
      min: 0,
      max: 1,
      idle: 1_000,
      acquire: 10_000,
    },
    dialectOptions: {
      ssl: false,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      query_timeout: 10_000,
      application_name: 'omnilodge-runtime-preflight',
    },
  });
}

export async function withReadOnlyTransaction<T>(
  database: Sequelize,
  operation: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  const transaction = await database.transaction();
  let settled = false;
  try {
    await database.query('SET TRANSACTION READ ONLY;', { transaction });
    const rows = await database.query<{ transaction_read_only: string }>(
      "SELECT current_setting('transaction_read_only') AS transaction_read_only;",
      { type: QueryTypes.SELECT, transaction },
    );
    if (rows[0]?.transaction_read_only !== 'on') {
      throw new Error('Database did not enter a read-only transaction.');
    }
    const result = await operation(transaction);
    await transaction.commit();
    settled = true;
    return result;
  } finally {
    if (!settled) {
      try {
        await transaction.rollback();
      } catch {
        // Preserve the original error. The connection is closed by the caller.
      }
    }
  }
}
