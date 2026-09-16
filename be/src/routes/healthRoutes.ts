import { Request, Response, Router } from 'express';
import { inspectRuntimeConfiguration } from '../config/runtimeConfiguration.js';

const DEFAULT_DATABASE_TIMEOUT_MS = 5_000;
const DEFAULT_DATABASE_CACHE_MS = 2_000;

type HealthEnvironment = NodeJS.ProcessEnv;

type HealthRouterOptions = {
  env?: HealthEnvironment;
  uptime?: () => number;
  now?: () => number;
  databaseTimeoutMs?: number;
  databaseCacheMs?: number;
  checkDatabase?: () => Promise<void>;
};

const cleanPublicValue = (value: string | undefined, maxLength: number): string | null => {
  const normalized = value?.trim();
  if (!normalized) return null;
  return normalized.replace(/[^a-zA-Z0-9._:/@+-]/g, '').slice(0, maxLength) || null;
};

const defaultDatabaseCheck = async (): Promise<void> => {
  // Keep the shallow liveness route independent from database initialization.
  // The database module is loaded only when the readiness route is requested.
  const { default: sequelize } = await import('../config/database.js');
  await sequelize.query('SELECT 1');
};

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Database readiness check timed out')), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const createHealthRouter = (options: HealthRouterOptions = {}): Router => {
  const router = Router();
  const env = options.env ?? process.env;
  const uptime = options.uptime ?? process.uptime;
  const now = options.now ?? Date.now;
  const checkDatabase = options.checkDatabase ?? defaultDatabaseCheck;
  const databaseTimeoutMs = options.databaseTimeoutMs ?? DEFAULT_DATABASE_TIMEOUT_MS;
  const databaseCacheMs = options.databaseCacheMs ?? DEFAULT_DATABASE_CACHE_MS;
  let databaseInFlight: Promise<boolean> | null = null;
  let databaseCached: { ok: boolean; expiresAt: number } | null = null;

  const probeDatabase = async (): Promise<boolean> => {
    if (databaseCached && databaseCached.expiresAt > now()) return databaseCached.ok;
    if (!databaseInFlight) {
      const operation = Promise.resolve()
        .then(checkDatabase)
        .then(() => true, () => false);
      databaseInFlight = operation;
      void operation.then((ok) => {
        databaseCached = { ok, expiresAt: now() + databaseCacheMs };
        if (databaseInFlight === operation) databaseInFlight = null;
      });
    }

    try {
      const operation = databaseInFlight;
      if (!operation) return false;
      return await withTimeout(operation, databaseTimeoutMs);
    } catch {
      // Keep sharing a timed-out operation until it settles so repeated public
      // requests cannot create an unbounded database-query pileup.
      return false;
    }
  };

  const release = () => ({
    id: cleanPublicValue(env.APP_VERSION, 120),
    gitSha: cleanPublicValue(env.GIT_COMMIT_SHA, 64),
    runtimeMode: cleanPublicValue(env.APP_RUNTIME_MODE, 40) ?? 'primary',
  });

  const setHealthHeaders = (res: Response) => {
    res.set('Cache-Control', 'no-store');
  };

  // Preserve the existing lightweight endpoint for uptime monitors and older
  // clients. Deployment automation must use /ready instead.
  router.get('/', (_req: Request, res: Response) => {
    setHealthHeaders(res);
    res.status(200).json({
      status: 'ok',
      ready: true,
      uptimeSeconds: Math.floor(uptime()),
    });
  });

  router.get('/live', (_req: Request, res: Response) => {
    setHealthHeaders(res);
    res.status(200).json({
      status: 'ok',
      live: true,
      uptimeSeconds: Math.floor(uptime()),
      release: release(),
    });
  });

  router.get('/ready', async (_req: Request, res: Response) => {
    setHealthHeaders(res);

    const configuration = inspectRuntimeConfiguration(env);
    const { missing, invalid } = configuration;
    const configurationOk = configuration.ok;
    let databaseOk = false;

    if (configurationOk) {
      databaseOk = await probeDatabase();
    }

    const ready = configurationOk && databaseOk;
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'not_ready',
      ready,
      uptimeSeconds: Math.floor(uptime()),
      release: release(),
      checks: {
        configuration: {
          ok: configurationOk,
          missing,
          invalid,
        },
        database: {
          ok: databaseOk,
        },
      },
    });
  });

  return router;
};

export default createHealthRouter();
