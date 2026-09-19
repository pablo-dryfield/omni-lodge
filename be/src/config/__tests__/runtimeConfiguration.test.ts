import { inspectRuntimeConfiguration } from '../runtimeConfiguration.js';

const productionEnvironment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DB_HOST: 'database.internal',
  DB_PORT: '5432',
  DB_NAME: 'omnilodge',
  DB_USER: 'runtime',
  DB_PASSWORD: 'not-reported',
  JWT_SECRET: 'also-not-reported',
  APP_VERSION: 'omnilodge-r101-a2-aaaaaaaaaaaa',
  GIT_COMMIT_SHA: 'a'.repeat(40),
});

describe('inspectRuntimeConfiguration', () => {
  it('accepts the complete production readiness contract', () => {
    expect(inspectRuntimeConfiguration(productionEnvironment(), { requireProduction: true }))
      .toEqual({ ok: true, missing: [], invalid: [] });
  });

  it('reports names but never values for missing or invalid configuration', () => {
    const env = productionEnvironment();
    env.DB_PASSWORD = ' ';
    env.GIT_COMMIT_SHA = 'secret-but-invalid';
    const result = inspectRuntimeConfiguration(env, { requireProduction: true });

    expect(result).toEqual({ ok: false, missing: ['DB_PASSWORD'], invalid: [] });
    expect(JSON.stringify(result)).not.toContain('secret-but-invalid');
  });

  it('requires an explicitly production runtime for deployment preflight', () => {
    const env = productionEnvironment();
    env.NODE_ENV = 'development';
    expect(inspectRuntimeConfiguration(env, { requireProduction: true })).toEqual({
      ok: false,
      missing: [],
      invalid: ['NODE_ENV'],
    });
  });

  it('binds a canonical deployment release ID to the exact lowercase source SHA', () => {
    const env = productionEnvironment();
    expect(inspectRuntimeConfiguration(env, {
      requireProduction: true,
      requireCanonicalRelease: true,
    }).ok).toBe(true);

    env.APP_VERSION = 'omnilodge-r101-a2-bbbbbbbbbbbb';
    expect(inspectRuntimeConfiguration(env, {
      requireProduction: true,
      requireCanonicalRelease: true,
    }).invalid).toEqual(['APP_VERSION']);

    env.APP_VERSION = 'omnilodge-r101-a2-aaaaaaaaaaaa';
    env.GIT_COMMIT_SHA = 'A'.repeat(40);
    expect(inspectRuntimeConfiguration(env, {
      requireProduction: true,
      requireCanonicalRelease: true,
    }).invalid).toEqual(['GIT_COMMIT_SHA']);
  });
});
