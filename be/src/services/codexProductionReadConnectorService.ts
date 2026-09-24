import crypto from 'node:crypto';

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pg from 'pg';
import type { Pool as PgPool, QueryResultRow } from 'pg';

type PrimitiveFilterValue = string | number | boolean | null;

export type ProductionReadConnectorConfig = {
  host: string;
  port: number;
  bearerToken: string;
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  maxRows: number;
  maxResponseBytes: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  rateLimitPerMinute: number;
  allowedTableKeys: ReadonlySet<string>;
};

export type ProductionReadQuery = {
  operation: string;
  text: string;
  values?: unknown[];
};

export type ProductionReadQueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
};

export type ProductionReadQueryExecutor = (
  query: ProductionReadQuery,
) => Promise<ProductionReadQueryResult>;

type ReadRowsRequestBody = {
  schema?: unknown;
  table?: unknown;
  columns?: unknown;
  filters?: unknown;
  limit?: unknown;
  orderBy?: unknown;
};

const { Pool } = pg;

const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;
const TABLE_KEY_PATTERN = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const TABLE_SCHEMA_WILDCARD_PATTERN = /^[a-z_][a-z0-9_]*\.\*$/;
const DEFAULT_MAX_ROWS = 100;
const HARD_MAX_ROWS = 500;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const HARD_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_STATEMENT_TIMEOUT_MS = 5_000;
const HARD_MAX_STATEMENT_TIMEOUT_MS = 15_000;
const DEFAULT_LOCK_TIMEOUT_MS = 1_000;
const HARD_MAX_LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
const HARD_MAX_RATE_LIMIT_PER_MINUTE = 300;
const DEFAULT_BODY_LIMIT = '16kb';

const ERROR_ISSUE_STATUSES = new Set(['open', 'investigating', 'resolved', 'ignored']);

class HttpError extends Error {
  statusCode: number;

  safeCode: string;

  constructor(statusCode: number, safeCode: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.safeCode = safeCode;
  }
}

const requiredString = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback?: string,
): string => {
  const value = env[key] ?? fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment value: ${key}`);
  }
  return value;
};

const optionalString = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string => {
  const value = env[key];
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
};

const readBoundedInteger = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const rawValue = env[key];
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${key} must be an integer greater than or equal to ${min}`);
  }
  return Math.min(value, max);
};

const readOptionalPortFallback = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number => {
  const rawValue = env[key];
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return fallback;
  const value = Number(rawValue);
  return Number.isInteger(value) && value >= 1 && value <= 65_535 ? value : fallback;
};

const parseAllowedTableKeys = (value: string | undefined): ReadonlySet<string> => {
  if (typeof value !== 'string' || value.trim() === '') return new Set();

  const keys = value
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  for (const key of keys) {
    if (!TABLE_KEY_PATTERN.test(key) && !TABLE_SCHEMA_WILDCARD_PATTERN.test(key)) {
      throw new Error(`Invalid CODEX_READ_CONNECTOR_ALLOWED_TABLES entry: ${key}`);
    }
  }

  return new Set(keys);
};

export const loadProductionReadConnectorConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ProductionReadConnectorConfig => ({
  host: optionalString(env, 'CODEX_READ_CONNECTOR_HOST', '127.0.0.1'),
  port: readBoundedInteger(env, 'CODEX_READ_CONNECTOR_PORT', 3019, 1, 65_535),
  bearerToken: requiredString(env, 'CODEX_READ_CONNECTOR_TOKEN'),
  database: {
    host: optionalString(env, 'CODEX_READ_DB_HOST', env.DB_HOST ?? '127.0.0.1'),
    port: readBoundedInteger(
      env,
      'CODEX_READ_DB_PORT',
      readOptionalPortFallback(env, 'DB_PORT', 5432),
      1,
      65_535,
    ),
    database: requiredString(env, 'CODEX_READ_DB_NAME', env.DB_NAME),
    user: requiredString(env, 'CODEX_READ_DB_USER', 'codex_cloud_reader'),
    password: requiredString(env, 'CODEX_READ_DB_PASSWORD'),
  },
  maxRows: readBoundedInteger(
    env,
    'CODEX_READ_CONNECTOR_MAX_ROWS',
    DEFAULT_MAX_ROWS,
    1,
    HARD_MAX_ROWS,
  ),
  maxResponseBytes: readBoundedInteger(
    env,
    'CODEX_READ_CONNECTOR_MAX_RESPONSE_BYTES',
    DEFAULT_MAX_RESPONSE_BYTES,
    1_024,
    HARD_MAX_RESPONSE_BYTES,
  ),
  statementTimeoutMs: readBoundedInteger(
    env,
    'CODEX_READ_CONNECTOR_STATEMENT_TIMEOUT_MS',
    DEFAULT_STATEMENT_TIMEOUT_MS,
    250,
    HARD_MAX_STATEMENT_TIMEOUT_MS,
  ),
  lockTimeoutMs: readBoundedInteger(
    env,
    'CODEX_READ_CONNECTOR_LOCK_TIMEOUT_MS',
    DEFAULT_LOCK_TIMEOUT_MS,
    100,
    HARD_MAX_LOCK_TIMEOUT_MS,
  ),
  rateLimitPerMinute: readBoundedInteger(
    env,
    'CODEX_READ_CONNECTOR_RATE_LIMIT_PER_MINUTE',
    DEFAULT_RATE_LIMIT_PER_MINUTE,
    1,
    HARD_MAX_RATE_LIMIT_PER_MINUTE,
  ),
  allowedTableKeys: parseAllowedTableKeys(env.CODEX_READ_CONNECTOR_ALLOWED_TABLES),
});

const timingSafeTokenMatch = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
};

const bearerFromHeader = (value: string | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
};

const createAuthMiddleware = (config: ProductionReadConnectorConfig): RequestHandler => (
  req,
  res,
  next,
) => {
  const token = bearerFromHeader(req.header('authorization'));
  if (!token || !timingSafeTokenMatch(token, config.bearerToken)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
};

const audit = (
  status: 'success' | 'failure',
  details: Record<string, unknown>,
): void => {
  const payload = {
    component: 'codex-production-read-connector',
    status,
    timestampUtc: new Date().toISOString(),
    ...details,
  };
  console.info(JSON.stringify(payload));
};

const jsonResponse = (
  res: Response,
  config: ProductionReadConnectorConfig,
  payload: Record<string, unknown>,
  statusCode = 200,
): void => {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > config.maxResponseBytes) {
    throw new HttpError(413, 'response_too_large', 'Response exceeds the configured byte limit');
  }

  res.status(statusCode).type('application/json').send(body);
};

const requireIdentifier = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new HttpError(400, 'invalid_identifier', `${label} must be a safe PostgreSQL identifier`);
  }
  return value;
};

const quoteIdentifier = (identifier: string): string => {
  const safeIdentifier = requireIdentifier(identifier, 'identifier');
  return `"${safeIdentifier}"`;
};

const clampRequestedLimit = (
  value: unknown,
  config: ProductionReadConnectorConfig,
): number => {
  if (value === undefined || value === null || value === '') return config.maxRows;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new HttpError(400, 'invalid_limit', 'limit must be a positive integer');
  }
  return Math.min(limit, config.maxRows);
};

const normalizeStatusList = (value: unknown): string[] => {
  if (value === undefined || value === null) return ['open', 'investigating'];
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'invalid_statuses', 'statuses must be a non-empty array');
  }

  const statuses = value.map((status) => {
    if (typeof status !== 'string' || !ERROR_ISSUE_STATUSES.has(status)) {
      throw new HttpError(400, 'invalid_statuses', 'statuses contains an unsupported status');
    }
    return status;
  });

  return [...new Set(statuses)];
};

const normalizeColumnList = (value: unknown): string[] => {
  if (value === undefined || value === null) return ['*'];
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'invalid_columns', 'columns must be a non-empty array');
  }

  return value.map((column) => requireIdentifier(column, 'column'));
};

const normalizeFilters = (value: unknown): Record<string, PrimitiveFilterValue> => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_filters', 'filters must be an object');
  }

  const filters: Record<string, PrimitiveFilterValue> = {};
  for (const [key, rawFilterValue] of Object.entries(value)) {
    const column = requireIdentifier(key, 'filter column');
    if (
      rawFilterValue !== null
      && typeof rawFilterValue !== 'string'
      && typeof rawFilterValue !== 'number'
      && typeof rawFilterValue !== 'boolean'
    ) {
      throw new HttpError(
        400,
        'invalid_filter_value',
        'filter values must be strings, numbers, booleans, or null',
      );
    }
    filters[column] = rawFilterValue;
  }

  return filters;
};

const normalizeOrderBy = (
  value: unknown,
): { column: string; direction: 'ASC' | 'DESC' } | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'invalid_order_by', 'orderBy must be an object');
  }

  const record = value as Record<string, unknown>;
  const column = requireIdentifier(record.column, 'orderBy.column');
  const rawDirection = typeof record.direction === 'string'
    ? record.direction.trim().toLowerCase()
    : 'asc';
  if (rawDirection !== 'asc' && rawDirection !== 'desc') {
    throw new HttpError(400, 'invalid_order_direction', 'orderBy.direction must be asc or desc');
  }

  return { column, direction: rawDirection.toUpperCase() as 'ASC' | 'DESC' };
};

const tableKey = (schema: string, table: string): string => `${schema}.${table}`;

const tableSchemaWildcardKey = (schema: string): string => `${schema}.*`;

const ensureTableReadAllowed = (
  config: ProductionReadConnectorConfig,
  schema: string,
  table: string,
): void => {
  if (
    !config.allowedTableKeys.has(tableKey(schema, table))
    && !config.allowedTableKeys.has(tableSchemaWildcardKey(schema))
  ) {
    throw new HttpError(403, 'table_not_allowlisted', 'This table is not allowlisted for row reads');
  }
};

const normalizeRow = (row: QueryResultRow | Record<string, unknown>): Record<string, unknown> => (
  Object.fromEntries(Object.entries(row as Record<string, unknown>))
);

export const createPgProductionReadExecutor = (
  config: ProductionReadConnectorConfig,
): {
  executor: ProductionReadQueryExecutor;
  close: () => Promise<void>;
} => {
  const pool: PgPool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'omnilodge-codex-production-read-connector',
  });

  return {
    executor: async ({ text, values = [] }) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SELECT set_config($1, $2, true)', [
          'statement_timeout',
          `${config.statementTimeoutMs}ms`,
        ]);
        await client.query('SELECT set_config($1, $2, true)', [
          'lock_timeout',
          `${config.lockTimeoutMs}ms`,
        ]);
        const result = await client.query(text, values);
        await client.query('COMMIT');
        return {
          rows: result.rows.map(normalizeRow),
          rowCount: result.rowCount ?? result.rows.length,
        };
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The original query failure is more useful than a rollback failure.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
};

const asyncHandler = (
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler => (
  req,
  res,
  next,
) => {
  handler(req, res, next).catch(next);
};

const requestContext = (req: Request): Record<string, unknown> => ({
  method: req.method,
  path: req.path,
  requestId: req.header('cf-ray') ?? req.header('x-request-id') ?? null,
  accessServiceTokenId: req.header('cf-access-client-id') ? 'present' : 'absent',
});

const withAudit = async (
  req: Request,
  operation: string,
  callback: () => Promise<{ payload: Record<string, unknown>; rowCount?: number }>,
): Promise<Record<string, unknown>> => {
  const started = Date.now();
  try {
    const result = await callback();
    audit('success', {
      ...requestContext(req),
      operation,
      durationMs: Date.now() - started,
      rowCount: result.rowCount ?? null,
    });
    return result.payload;
  } catch (error) {
    audit('failure', {
      ...requestContext(req),
      operation,
      durationMs: Date.now() - started,
      error: error instanceof HttpError ? error.safeCode : 'query_failed',
    });
    throw error;
  }
};

const createHealthHandler = (
  config: ProductionReadConnectorConfig,
  executor: ProductionReadQueryExecutor,
): RequestHandler => asyncHandler(async (req, res) => {
  const payload = await withAudit(req, 'health', async () => {
    const result = await executor({
      operation: 'health',
      text: `SELECT current_user AS user_name,
                    current_database() AS database_name,
                    current_setting('transaction_read_only') AS transaction_read_only`,
    });
    return {
      payload: {
        ok: true,
        service: 'codex-production-read-connector',
        database: result.rows[0] ?? null,
      },
      rowCount: result.rowCount,
    };
  });
  jsonResponse(res, config, payload);
});

const createListTablesHandler = (
  config: ProductionReadConnectorConfig,
  executor: ProductionReadQueryExecutor,
): RequestHandler => asyncHandler(async (req, res) => {
  const payload = await withAudit(req, 'schema.tables', async () => {
    const result = await executor({
      operation: 'schema.tables',
      text: `SELECT table_schema, table_name, table_type
               FROM information_schema.tables
              WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              ORDER BY table_schema ASC, table_name ASC
              LIMIT $1`,
      values: [config.maxRows],
    });
    return {
      payload: {
        tables: result.rows,
        limit: config.maxRows,
      },
      rowCount: result.rowCount,
    };
  });
  jsonResponse(res, config, payload);
});

const createDescribeTableHandler = (
  config: ProductionReadConnectorConfig,
  executor: ProductionReadQueryExecutor,
): RequestHandler => asyncHandler(async (req, res) => {
  const schema = requireIdentifier(req.params.schema, 'schema');
  const table = requireIdentifier(req.params.table, 'table');
  const payload = await withAudit(req, 'schema.table.describe', async () => {
    const result = await executor({
      operation: 'schema.table.describe',
      text: `SELECT column_name,
                    data_type,
                    udt_name,
                    is_nullable,
                    column_default
               FROM information_schema.columns
              WHERE table_schema = $1
                AND table_name = $2
              ORDER BY ordinal_position ASC
              LIMIT $3`,
      values: [schema, table, config.maxRows],
    });
    return {
      payload: {
        schema,
        table,
        columns: result.rows,
      },
      rowCount: result.rowCount,
    };
  });
  jsonResponse(res, config, payload);
});

const createOpenErrorIssuesReportHandler = (
  config: ProductionReadConnectorConfig,
  executor: ProductionReadQueryExecutor,
): RequestHandler => asyncHandler(async (req, res) => {
  const statuses = normalizeStatusList(req.body?.statuses);
  const limit = clampRequestedLimit(req.body?.limit, config);
  const payload = await withAudit(req, 'report.open_error_issues', async () => {
    const result = await executor({
      operation: 'report.open_error_issues',
      text: `SELECT id::text AS id,
                    source,
                    kind,
                    title,
                    culprit,
                    severity,
                    status,
                    first_seen_at,
                    last_seen_at,
                    occurrence_count::text AS occurrence_count,
                    affected_user_count,
                    reopened_count,
                    last_route,
                    last_page_url,
                    last_release,
                    last_environment,
                    updated_at
               FROM error_monitoring_issues
              WHERE status = ANY($1::text[])
              ORDER BY last_seen_at DESC, id DESC
              LIMIT $2`,
      values: [statuses, limit],
    });
    return {
      payload: {
        report: 'open_error_issues',
        statuses,
        limit,
        rows: result.rows,
      },
      rowCount: result.rowCount,
    };
  });
  jsonResponse(res, config, payload);
});

const createReadRowsHandler = (
  config: ProductionReadConnectorConfig,
  executor: ProductionReadQueryExecutor,
): RequestHandler => asyncHandler(async (req, res) => {
  const body = req.body as ReadRowsRequestBody;
  const schema = requireIdentifier(body?.schema ?? 'public', 'schema');
  const table = requireIdentifier(body?.table, 'table');
  ensureTableReadAllowed(config, schema, table);

  const columns = normalizeColumnList(body?.columns);
  const filters = normalizeFilters(body?.filters);
  const orderBy = normalizeOrderBy(body?.orderBy);
  const limit = clampRequestedLimit(body?.limit, config);

  const selectedColumns = columns[0] === '*'
    ? '*'
    : columns.map(quoteIdentifier).join(', ');
  const values: unknown[] = [];
  const whereClauses = Object.entries(filters).map(([column, value]) => {
    if (value === null) return `${quoteIdentifier(column)} IS NULL`;
    values.push(value);
    return `${quoteIdentifier(column)} = $${values.length}`;
  });

  const text = [
    `SELECT ${selectedColumns}`,
    `FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '',
    orderBy ? `ORDER BY ${quoteIdentifier(orderBy.column)} ${orderBy.direction}` : '',
    `LIMIT $${values.length + 1}`,
  ].filter(Boolean).join(' ');
  values.push(limit);

  const payload = await withAudit(req, 'tables.read', async () => {
    const result = await executor({
      operation: 'tables.read',
      text,
      values,
    });
    return {
      payload: {
        schema,
        table,
        limit,
        rows: result.rows,
      },
      rowCount: result.rowCount,
    };
  });

  jsonResponse(res, config, payload);
});

const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};

const errorHandler = (
  config: ProductionReadConnectorConfig,
): ErrorRequestHandler => (
  error,
  _req,
  res,
  _next,
) => {
  if (res.headersSent) return;
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ error: error.safeCode, message: error.message });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  const message = process.env.NODE_ENV === 'production'
    ? 'Production read connector request failed'
    : error instanceof Error ? error.message : 'Production read connector request failed';
  res.status(500).json({
    error: 'request_failed',
    message,
    responseLimitBytes: config.maxResponseBytes,
  });
};

export const createProductionReadConnectorApp = (
  config: ProductionReadConnectorConfig,
  executor: ProductionReadQueryExecutor,
): express.Express => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(rateLimit({
    windowMs: 60_000,
    max: config.rateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
  }));
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(createAuthMiddleware(config));

  app.get('/health', createHealthHandler(config, executor));
  app.get('/schema/tables', createListTablesHandler(config, executor));
  app.get('/schema/tables/:schema/:table', createDescribeTableHandler(config, executor));
  app.post('/reports/open-error-issues', createOpenErrorIssuesReportHandler(config, executor));
  app.post('/tables/read', createReadRowsHandler(config, executor));
  app.use(notFoundHandler);
  app.use(errorHandler(config));

  return app;
};
