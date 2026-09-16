import { constants as fsConstants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { QueryTypes, type Sequelize, type Transaction } from 'sequelize';
import {
  assertDatabaseSyncPolicy,
  resolveDatabaseSyncBoolean,
} from '../config/databaseSyncPolicy.js';
import { inspectRuntimeConfiguration } from '../config/runtimeConfiguration.js';
import { withReadOnlyTransaction } from './runtimeDatabase.js';

export const RUNTIME_PREFLIGHT_SCHEMA_VERSION = 1 as const;

export type RuntimePreflightResult = Readonly<{
  schemaVersion: typeof RUNTIME_PREFLIGHT_SCHEMA_VERSION;
  kind: 'omnilodge-backend-runtime-preflight';
  ok: true;
  checks: Readonly<{
    productionConfiguration: true;
    databaseSyncPolicy: true;
    startupMutationPolicy: true;
    databaseReadOnlyProbe: true;
    sharpNativeOperation: true;
    puppeteerBrowserLaunch: true;
  }>;
}>;

export class RuntimePreflightError extends Error {
  readonly code: string;
  readonly details?: Readonly<{ missing?: string[]; invalid?: string[] }>;

  constructor(
    code: string,
    message: string,
    details?: Readonly<{ missing?: string[]; invalid?: string[] }>,
  ) {
    super(message);
    this.name = 'RuntimePreflightError';
    this.code = code;
    this.details = details;
  }
}

export type RuntimePreflightOperations = Readonly<{
  probeDatabaseReadOnly: () => Promise<void>;
  checkSharpNativeOperation: () => Promise<void>;
  checkPuppeteerBrowserLaunch: () => Promise<void>;
}>;

const runCheck = async (
  code: string,
  message: string,
  operation: () => Promise<void>,
): Promise<void> => {
  try {
    await operation();
  } catch {
    throw new RuntimePreflightError(code, message);
  }
};

export async function runRuntimePreflightChecks({
  env,
  operations,
}: {
  env: NodeJS.ProcessEnv;
  operations: RuntimePreflightOperations;
}): Promise<RuntimePreflightResult> {
  const configuration = inspectRuntimeConfiguration(env, {
    requireProduction: true,
    requireCanonicalRelease: true,
    additionalRequiredNames: ['PUPPETEER_CACHE_DIR'],
  });
  const puppeteerCacheDirectory = env.PUPPETEER_CACHE_DIR?.trim() ?? '';
  const invalidConfiguration = [...configuration.invalid];
  if (configuration.ok && !isAbsolute(puppeteerCacheDirectory)) {
    invalidConfiguration.push('PUPPETEER_CACHE_DIR');
  }
  if (!configuration.ok || invalidConfiguration.length > 0) {
    throw new RuntimePreflightError(
      'PRODUCTION_CONFIGURATION_INVALID',
      'Required production runtime configuration is missing or invalid.',
      { missing: configuration.missing, invalid: invalidConfiguration },
    );
  }

  try {
    // Unsafe fallbacks make missing and unrecognized policy values fail closed.
    assertDatabaseSyncPolicy({
      nodeEnv: env.NODE_ENV,
      skipDbSync: resolveDatabaseSyncBoolean(env.SKIP_DB_SYNC, false),
      alterSchema: resolveDatabaseSyncBoolean(env.DB_SYNC_ALTER, true),
    });
  } catch {
    throw new RuntimePreflightError(
      'DATABASE_SYNC_POLICY_UNSAFE',
      'Production database synchronization policy is unsafe.',
    );
  }

  if (resolveDatabaseSyncBoolean(env.SEED_ACCESS_CONTROL, true)) {
    throw new RuntimePreflightError(
      'STARTUP_MUTATION_POLICY_UNSAFE',
      'Production startup must not seed access control automatically.',
    );
  }

  await runCheck(
    'DATABASE_READ_ONLY_PROBE_FAILED',
    'The production database read-only probe failed.',
    operations.probeDatabaseReadOnly,
  );
  await runCheck(
    'SHARP_NATIVE_OPERATION_FAILED',
    'The Sharp native image operation failed.',
    operations.checkSharpNativeOperation,
  );
  await runCheck(
    'PUPPETEER_BROWSER_LAUNCH_FAILED',
    'The Puppeteer browser smoke check failed.',
    operations.checkPuppeteerBrowserLaunch,
  );

  return {
    schemaVersion: RUNTIME_PREFLIGHT_SCHEMA_VERSION,
    kind: 'omnilodge-backend-runtime-preflight',
    ok: true,
    checks: {
      productionConfiguration: true,
      databaseSyncPolicy: true,
      startupMutationPolicy: true,
      databaseReadOnlyProbe: true,
      sharpNativeOperation: true,
      puppeteerBrowserLaunch: true,
    },
  };
}

export async function probeRuntimeDatabaseReadOnly(database: Sequelize): Promise<void> {
  await withReadOnlyTransaction(database, async (transaction: Transaction) => {
    const rows = await database.query<{ probe: number }>('SELECT 1::integer AS probe;', {
      type: QueryTypes.SELECT,
      transaction,
    });
    if (rows.length !== 1 || Number(rows[0]?.probe) !== 1) {
      throw new Error('Unexpected database probe response.');
    }
  });
}

export async function checkSharpNativeOperation(): Promise<void> {
  const { default: sharp } = await import('sharp');
  const result = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: '#000000',
    },
  }).png().toBuffer({ resolveWithObject: true });
  if (result.info.width !== 1 || result.info.height !== 1 || result.data.length === 0) {
    throw new Error('Unexpected Sharp smoke-check output.');
  }
}

export async function checkPuppeteerBrowserLaunch(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { default: puppeteer } = await import('puppeteer');
  const cacheDirectory = env.PUPPETEER_CACHE_DIR?.trim() ?? '';
  if (!isAbsolute(cacheDirectory)) {
    throw new Error('Puppeteer cache directory must be absolute.');
  }
  const executablePath = puppeteer.executablePath();
  const [realCacheDirectory, realExecutablePath] = await Promise.all([
    realpath(cacheDirectory),
    realpath(executablePath),
  ]);
  const relativeExecutablePath = relative(realCacheDirectory, realExecutablePath);
  if (
    relativeExecutablePath === ''
    || relativeExecutablePath === '..'
    || relativeExecutablePath.startsWith(`..${sep}`)
    || isAbsolute(relativeExecutablePath)
  ) {
    throw new Error('Puppeteer executable is outside its configured cache directory.');
  }
  await access(executablePath, fsConstants.R_OK | fsConstants.X_OK);

  const browser = await puppeteer.launch({
    headless: true,
    timeout: 15_000,
    protocolTimeout: 15_000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const version = await browser.version();
    if (!version.trim()) {
      throw new Error('Puppeteer returned an empty browser version.');
    }
  } finally {
    await browser.close();
  }
}
