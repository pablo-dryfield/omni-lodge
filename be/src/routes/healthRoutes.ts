import { Request, Response, Router } from 'express';

const REQUIRED_DATABASE_ENV = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER'] as const;
const REQUIRED_PRODUCTION_RELEASE_ENV = ['APP_VERSION', 'GIT_COMMIT_SHA'] as const;
const DEFAULT_DATABASE_TIMEOUT_MS = 5_000;

type HealthEnvironment = NodeJS.ProcessEnv;

type HealthRouterOptions = {
  env?: HealthEnvironment;
  uptime?: () => number;
  databaseTimeoutMs?: number;
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

const withTimeout = async (operation: Promise<void>, timeoutMs: number): Promise<void> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<void>((_resolve, reject) => {
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
  const checkDatabase = options.checkDatabase ?? defaultDatabaseCheck;
  const databaseTimeoutMs = options.databaseTimeoutMs ?? DEFAULT_DATABASE_TIMEOUT_MS;

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
      ? [...REQUIRED_DATABASE_ENV, ...REQUIRED_PRODUCTION_RELEASE_ENV]
      : REQUIRED_DATABASE_ENV;
    const missing = requiredNames.filter((name) => !env[name]?.trim());
    const configurationOk = missing.length === 0;
    let databaseOk = false;

    if (configurationOk) {
      try {
        await withTimeout(checkDatabase(), databaseTimeoutMs);
        databaseOk = true;
      } catch {
        // Readiness responses deliberately omit database errors and credentials.
      }
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
