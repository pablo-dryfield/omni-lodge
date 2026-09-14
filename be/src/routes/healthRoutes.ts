import { Request, Response, Router } from 'express';

const REQUIRED_DATABASE_ENV = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'] as const;
const REQUIRED_PRODUCTION_ENV = [
  'DB_PASSWORD',
  'JWT_SECRET',
  'APP_VERSION',
  'GIT_COMMIT_SHA',
] as const;
const DEFAULT_DATABASE_TIMEOUT_MS = 5_000;
const DEFAULT_DATABASE_CACHE_MS = 2_000;
const RELEASE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,119}$/;
const GIT_SHA = /^[a-f0-9]{40}$/i;

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

    const requiredNames: readonly string[] = env.NODE_ENV === 'production'
      ? [...REQUIRED_DATABASE_ENV, ...REQUIRED_PRODUCTION_ENV]
      : REQUIRED_DATABASE_ENV;
    const missing = requiredNames.filter((name) => !env[name]?.trim());
    const invalid = missing.length === 0
      ? [
          !/^\d+$/.test(env.DB_PORT ?? '')
            || Number(env.DB_PORT) < 1
            || Number(env.DB_PORT) > 65_535
            ? 'DB_PORT'
            : null,
          env.NODE_ENV === 'production' && !RELEASE_TOKEN.test(env.APP_VERSION ?? '')
            ? 'APP_VERSION'
            : null,
          env.NODE_ENV === 'production' && !GIT_SHA.test(env.GIT_COMMIT_SHA ?? '')
            ? 'GIT_COMMIT_SHA'
            : null,
        ].filter((name): name is string => Boolean(name))
      : [];
    const configurationOk = missing.length === 0 && invalid.length === 0;
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
