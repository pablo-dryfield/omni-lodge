import {
  checkSharpNativeOperation,
  runRuntimePreflightChecks,
  RuntimePreflightError,
  type RuntimePreflightOperations,
} from '../runtimePreflightChecks.js';
import {
  readRuntimeDatabaseConfiguration,
  RuntimeDatabaseConfigurationError,
  withReadOnlyTransaction,
} from '../runtimeDatabase.js';
import type { Sequelize } from 'sequelize';

const productionEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DB_HOST: 'database.internal',
  DB_PORT: '5432',
  DB_NAME: 'omnilodge',
  DB_USER: 'runtime',
  DB_PASSWORD: 'database-secret',
  JWT_SECRET: 'jwt-secret',
  APP_VERSION: 'omnilodge-r101-a2-aaaaaaaaaaaa',
  GIT_COMMIT_SHA: 'a'.repeat(40),
  SKIP_DB_SYNC: 'true',
  DB_SYNC_ALTER: 'false',
  SEED_ACCESS_CONTROL: 'false',
  PUPPETEER_CACHE_DIR: process.platform === 'win32'
    ? 'C:\\omnilodge\\puppeteer'
    : '/var/cache/omnilodge/puppeteer',
});

const operations = (): RuntimePreflightOperations => ({
  probeDatabaseReadOnly: jest.fn().mockResolvedValue(undefined),
  checkSharpNativeOperation: jest.fn().mockResolvedValue(undefined),
  checkPuppeteerBrowserLaunch: jest.fn().mockResolvedValue(undefined),
});

describe('backend runtime preflight', () => {
  it('runs every non-mutating runtime check and returns a stable public result', async () => {
    const checks = operations();
    const result = await runRuntimePreflightChecks({
      env: productionEnvironment(),
      operations: checks,
    });

    expect(result).toEqual({
      schemaVersion: 1,
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
    });
    expect(checks.probeDatabaseReadOnly).toHaveBeenCalledTimes(1);
    expect(checks.checkSharpNativeOperation).toHaveBeenCalledTimes(1);
    expect(checks.checkPuppeteerBrowserLaunch).toHaveBeenCalledTimes(1);
  });

  it('does not run probes when production configuration is invalid', async () => {
    const env = productionEnvironment();
    env.JWT_SECRET = '';
    const checks = operations();

    await expect(runRuntimePreflightChecks({ env, operations: checks })).rejects.toMatchObject({
      code: 'PRODUCTION_CONFIGURATION_INVALID',
      details: { missing: ['JWT_SECRET'], invalid: [] },
    });
    expect(checks.probeDatabaseReadOnly).not.toHaveBeenCalled();
  });

  it.each([
    ['missing skip policy', undefined, 'false'],
    ['enabled alter policy', 'true', 'true'],
    ['invalid alter policy', 'true', 'perhaps'],
  ])('fails closed for %s', async (_label, skipDbSync, alterSchema) => {
    const env = productionEnvironment();
    env.SKIP_DB_SYNC = skipDbSync;
    env.DB_SYNC_ALTER = alterSchema;
    await expect(runRuntimePreflightChecks({ env, operations: operations() })).rejects.toMatchObject({
      code: 'DATABASE_SYNC_POLICY_UNSAFE',
    });
  });

  it.each([undefined, 'true', 'perhaps'])(
    'rejects mutating startup access-control policy %p',
    async (seedAccessControl) => {
      const env = productionEnvironment();
      env.SEED_ACCESS_CONTROL = seedAccessControl;
      await expect(runRuntimePreflightChecks({ env, operations: operations() })).rejects.toMatchObject({
        code: 'STARTUP_MUTATION_POLICY_UNSAFE',
      });
    },
  );

  it('requires a fixed absolute Puppeteer cache directory', async () => {
    const env = productionEnvironment();
    env.PUPPETEER_CACHE_DIR = 'relative-cache';
    await expect(runRuntimePreflightChecks({ env, operations: operations() })).rejects.toMatchObject({
      code: 'PRODUCTION_CONFIGURATION_INVALID',
      details: { invalid: ['PUPPETEER_CACHE_DIR'] },
    });
  });

  it('converts dependency failures into a non-secret stable code', async () => {
    const checks = operations();
    (checks.checkSharpNativeOperation as jest.Mock).mockRejectedValue(
      new Error('native failure with password=do-not-report'),
    );
    let failure: unknown;
    try {
      await runRuntimePreflightChecks({ env: productionEnvironment(), operations: checks });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(RuntimePreflightError);
    expect(failure).toMatchObject({ code: 'SHARP_NATIVE_OPERATION_FAILED' });
    expect(JSON.stringify(failure)).not.toContain('do-not-report');
  });
});

describe('runtime database configuration', () => {
  it('requires a password in production without including values in its error', () => {
    const env = productionEnvironment();
    env.DB_PASSWORD = '';
    let failure: unknown;
    try {
      readRuntimeDatabaseConfiguration(env, { requirePassword: true });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(RuntimeDatabaseConfigurationError);
    expect(failure).toMatchObject({ missing: ['DB_PASSWORD'], invalid: [] });
    expect(JSON.stringify(failure)).not.toContain('jwt-secret');
  });

  it('enforces read-only mode before invoking a database operation', async () => {
    const transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ transaction_read_only: 'on' }]);
    const database = {
      transaction: jest.fn().mockResolvedValue(transaction),
      query,
    } as unknown as Sequelize;
    const operation = jest.fn().mockResolvedValue('done');

    await expect(withReadOnlyTransaction(database, operation)).resolves.toBe('done');
    expect(query.mock.calls[0][0]).toBe('SET TRANSACTION READ ONLY;');
    expect(query.mock.calls[1][0]).toContain("current_setting('transaction_read_only')");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  it('rolls back and refuses the operation unless PostgreSQL confirms read-only mode', async () => {
    const transaction = {
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    };
    const database = {
      transaction: jest.fn().mockResolvedValue(transaction),
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ transaction_read_only: 'off' }]),
    } as unknown as Sequelize;
    const operation = jest.fn();

    await expect(withReadOnlyTransaction(database, operation)).rejects.toThrow('read-only');
    expect(operation).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});

describe('native runtime smoke operations', () => {
  it('performs a harmless in-memory Sharp operation', async () => {
    await expect(checkSharpNativeOperation()).resolves.toBeUndefined();
  });
});
