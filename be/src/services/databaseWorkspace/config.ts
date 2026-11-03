import crypto from 'node:crypto';
import { getConfigValue, refreshConfigCacheKeys } from '../configService.js';
import { DATABASE_WORKSPACE_CONFIG } from '../../config/databaseWorkspaceConfig.js';
import { WORKSPACE_CONTROL_OBJECTS } from '../../config/databaseWorkspacePolicy.js';
import { configureControlBudget } from './store.js';
import {
  WorkspaceError,
  type Credential,
  type ExecutionMode,
  type Limits,
  type Target,
} from './types.js';

const keys = DATABASE_WORKSPACE_CONFIG.map((d) => d.key);
const num = (key: string) => {
  const definition = DATABASE_WORKSPACE_CONFIG.find(
    (d) => d.key === `DB_WORKSPACE_${key}`,
  )!;
  const value = Number(
    getConfigValue(definition.key) ?? definition.defaultValue,
  );
  const min = Number(definition.validation?.min ?? 0),
    max = Number(definition.validation?.max ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new WorkspaceError(
      503,
      'INVALID_CONFIGURATION',
      `${definition.label} has an invalid value.`,
    );
  return value;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new WorkspaceError(
      503,
      'INVALID_CONFIGURATION',
      'Database Workspace configuration must be an object.',
    );
  return value as Record<string, unknown>;
};

export async function workspaceConfiguration() {
  await refreshConfigCacheKeys(keys);
  configureControlBudget(num('CONTROL_STORAGE_BUDGET_BYTES'));
  const raw = getConfigValue('DB_WORKSPACE_TARGETS');
  if (!Array.isArray(raw) || raw.length > 10)
    throw new WorkspaceError(
      503,
      'INVALID_CONFIGURATION',
      'Configure at most ten Database Workspace connections.',
    );
  const targets: Target[] = raw.map((input) => {
    const t = object(input);
    if (
      typeof t.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(t.id) ||
      typeof t.host !== 'string' ||
      !t.host ||
      typeof t.database !== 'string' ||
      !t.database ||
      typeof t.label !== 'string' ||
      !t.label ||
      ![15, 16, 17].includes(Number(t.major)) ||
      !['production', 'staging', 'development', 'test'].includes(
        String(t.environment),
      ) ||
      !Array.isArray(t.schemas) ||
      !t.schemas.length ||
      t.schemas.some((s) => typeof s !== 'string' || !s || s.length > 63)
    )
      throw new WorkspaceError(
        503,
        'INVALID_CONFIGURATION',
        'A registered Database Workspace connection is invalid.',
      );
    const port = Number(t.port || 5432);
    if (
      !Number.isSafeInteger(port) ||
      port < 1 ||
      port > 65535 ||
      /[\s/@?#]/.test(t.host) ||
      t.host === '169.254.169.254'
    )
      throw new WorkspaceError(
        503,
        'INVALID_CONFIGURATION',
        'A registered database host or port is invalid.',
      );
    if (t.tls !== true && !['127.0.0.1', 'localhost', '::1'].includes(t.host))
      throw new WorkspaceError(
        503,
        'TLS_REQUIRED',
        'Remote database connections require verified TLS.',
      );
    return {
      id: t.id,
      label: t.label,
      environment: t.environment as Target['environment'],
      host: t.host,
      port,
      database: t.database,
      major: Number(t.major) as Target['major'],
      schemas: t.schemas as string[],
      tls: t.tls === true,
      ca: typeof t.ca === 'string' ? t.ca : undefined,
      readOnly: t.readOnly === true,
    };
  });
  if (new Set(targets.map((t) => t.id)).size !== targets.length)
    throw new WorkspaceError(
      503,
      'INVALID_CONFIGURATION',
      'Database connection IDs must be unique.',
    );
  const configuredProtection = getConfigValue('DB_WORKSPACE_PROTECTED_OBJECTS');
  if (
    !Array.isArray(configuredProtection) ||
    configuredProtection.some((v) => typeof v !== 'string')
  )
    throw new WorkspaceError(
      503,
      'INVALID_CONFIGURATION',
      'Protected database objects must be a list of names.',
    );
  const protectedObjects = [
    ...new Set([...WORKSPACE_CONTROL_OBJECTS, ...configuredProtection]),
  ];
  const limits: Limits = {
    queryMaxBytes: num('QUERY_MAX_BYTES'),
    batchMaxStatements: num('BATCH_MAX_STATEMENTS'),
    readTimeoutMs: num('READ_TIMEOUT_MS'),
    writeTimeoutMs: num('WRITE_TIMEOUT_MS'),
    lockTimeoutMs: num('LOCK_TIMEOUT_MS'),
    jobMaxDurationMs: num('JOB_MAX_DURATION_MS'),
    activeJobsPerUser: num('ACTIVE_JOBS_PER_USER'),
    activeJobsPerTarget: num('ACTIVE_JOBS_PER_TARGET'),
    activeWritesPerTarget: num('ACTIVE_WRITES_PER_TARGET'),
    queueMaxJobs: num('QUEUE_MAX_JOBS'),
    queueWaitMs: num('QUEUE_WAIT_MS'),
    resultPageRows: num('RESULT_PAGE_ROWS'),
    resultMaxRows: num('RESULT_MAX_ROWS'),
    resultMaxBytes: num('RESULT_MAX_BYTES'),
    resultTtlMinutes: num('RESULT_TTL_MINUTES'),
    writeMaxRows: num('WRITE_MAX_ROWS'),
    reviewTokenTtlSeconds: num('REVIEW_TOKEN_TTL_SECONDS'),
    artifactDirectory: String(
      getConfigValue('DB_WORKSPACE_ARTIFACT_DIRECTORY') ||
        'runtime/database-workspace',
    ),
    storageBudgetBytes: num('STORAGE_BUDGET_BYTES'),
  };
  const enabled = getConfigValue('DB_WORKSPACE_ENABLED') === true;
  const writesEnabled = getConfigValue('DB_WORKSPACE_WRITES_ENABLED') === true;
  const maintenanceEnabled =
    getConfigValue('DB_WORKSPACE_MAINTENANCE_ENABLED') === true;
  const credentials = object(
    getConfigValue('DB_WORKSPACE_TARGET_CREDENTIALS') || {},
  );
  // Hash every authority-bearing setting, including credential rotation, to expire old reviews.
  const policyHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        targets,
        protectedObjects,
        limits,
        enabled,
        writesEnabled,
        maintenanceEnabled,
        credentials,
        settings: keys.map((key) => [key, getConfigValue(key)]),
      }),
    )
    .digest('hex');
  return {
    enabled,
    writesEnabled,
    maintenanceEnabled,
    targets,
    credentials,
    protectedObjects: protectedObjects as string[],
    limits,
    policyHash,
  };
}

export function targetCredential(
  config: Awaited<ReturnType<typeof workspaceConfiguration>>,
  targetId: string,
  mode: ExecutionMode,
): { target: Target; credential: Credential } {
  if (!config.enabled)
    throw new WorkspaceError(
      503,
      'WORKSPACE_DISABLED',
      'Database Workspace is disabled in Control Panel.',
    );
  const target = config.targets.find((t) => t.id === targetId);
  if (!target)
    throw new WorkspaceError(
      404,
      'TARGET_NOT_FOUND',
      'Database connection not found.',
    );
  if (mode !== 'read' && (target.readOnly || !config.writesEnabled))
    throw new WorkspaceError(
      403,
      'WRITES_DISABLED',
      'Writes are disabled for this connection.',
    );
  if (mode === 'maintenance' && !config.maintenanceEnabled)
    throw new WorkspaceError(
      403,
      'MAINTENANCE_DISABLED',
      'Database maintenance is disabled.',
    );
  const entry = object(config.credentials[targetId] || {});
  const cred = object(entry[mode] || {});
  if (
    typeof cred.user !== 'string' ||
    !cred.user ||
    typeof cred.password !== 'string' ||
    !cred.password
  )
    throw new WorkspaceError(
      503,
      'CREDENTIAL_NOT_CONFIGURED',
      `Configure the ${mode} identity for this connection in Control Panel.`,
    );
  return { target, credential: { user: cred.user, password: cred.password } };
}

export const publicTarget = (t: Target) => ({
  id: t.id,
  label: t.label,
  environment: t.environment,
  database: t.database,
  major: t.major,
  schemas: t.schemas,
  readOnly: t.readOnly,
});
