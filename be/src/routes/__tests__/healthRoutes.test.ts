import express from 'express';
import request from 'supertest';
import { createHealthRouter } from '../healthRoutes';

const completeEnvironment = {
  NODE_ENV: 'production',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5432',
  DB_NAME: 'omnilodge_test',
  DB_USER: 'omnilodge_test',
  APP_VERSION: 'release-20260914-a1005a62',
  GIT_COMMIT_SHA: 'a1005a62bb32a0807f78591bf49086bed05d79b2',
};

const buildApp = (options: Parameters<typeof createHealthRouter>[0] = {}) => {
  const app = express();
  app.use('/api/health', createHealthRouter(options));
  return app;
};

describe('health routes', () => {
  it('preserves the legacy process health response without authentication or caching', async () => {
    const response = await request(buildApp({ uptime: () => 12.9 })).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      status: 'ok',
      ready: true,
      uptimeSeconds: 12,
    });
  });

  it('reports liveness and sanitized release identity without checking the database', async () => {
    const checkDatabase = jest.fn(async () => undefined);
    const response = await request(buildApp({
      env: {
        APP_VERSION: ' release-20260914-a1005a62 ',
        GIT_COMMIT_SHA: 'a1005a62<script>',
      },
      uptime: () => 4.2,
      checkDatabase,
    })).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      status: 'ok',
      live: true,
      uptimeSeconds: 4,
      release: {
        id: 'release-20260914-a1005a62',
        gitSha: 'a1005a62script',
      },
    });
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it('reports ready only after configuration and the database check pass', async () => {
    const checkDatabase = jest.fn(async () => undefined);
    const response = await request(buildApp({
      env: completeEnvironment,
      uptime: () => 8,
      checkDatabase,
    })).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'ok',
      ready: true,
      uptimeSeconds: 8,
      release: {
        id: 'release-20260914-a1005a62',
        gitSha: 'a1005a62bb32a0807f78591bf49086bed05d79b2',
      },
      checks: {
        configuration: { ok: true, missing: [] },
        database: { ok: true },
      },
    });
    expect(checkDatabase).toHaveBeenCalledTimes(1);
  });

  it('fails closed without contacting the database when required configuration is missing', async () => {
    const checkDatabase = jest.fn(async () => undefined);
    const response = await request(buildApp({
      env: { NODE_ENV: 'production', DB_HOST: '127.0.0.1' },
      checkDatabase,
    })).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
    expect(response.body.checks.configuration).toEqual({
      ok: false,
      missing: ['DB_PORT', 'DB_NAME', 'DB_USER', 'APP_VERSION', 'GIT_COMMIT_SHA'],
    });
    expect(response.body.checks.database).toEqual({ ok: false });
    expect(checkDatabase).not.toHaveBeenCalled();
  });

  it('fails closed without leaking database errors', async () => {
    const checkDatabase = jest.fn(async () => {
      throw new Error('password=do-not-return connection refused');
    });
    const response = await request(buildApp({
      env: completeEnvironment,
      checkDatabase,
    })).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.checks.database).toEqual({ ok: false });
    expect(JSON.stringify(response.body)).not.toContain('do-not-return');
  });

  it('fails closed when the database check exceeds its deadline', async () => {
    const response = await request(buildApp({
      env: completeEnvironment,
      databaseTimeoutMs: 5,
      checkDatabase: () => new Promise<void>(() => undefined),
    })).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
    expect(response.body.checks.database).toEqual({ ok: false });
  });
});
