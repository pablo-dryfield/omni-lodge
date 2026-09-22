export const APPLICATION_RUNTIME_MODES = Object.freeze({
  primary: 'primary',
  deploymentCandidate: 'deployment-candidate',
  dryRun: 'dry-run',
} as const);

export type ApplicationRuntimeMode =
  typeof APPLICATION_RUNTIME_MODES[keyof typeof APPLICATION_RUNTIME_MODES];

export type ApplicationRuntimeModePolicy = Readonly<{
  mode: ApplicationRuntimeMode;
  allowStartupMutations: boolean;
  allowBackgroundJobs: boolean;
}>;

export function resolveApplicationRuntimeMode(value: unknown): ApplicationRuntimeMode {
  if (value === undefined || value === null || String(value).trim() === '') {
    // Preserve the legacy runtime until the artifact cutover explicitly stamps
    // the primary mode. Candidate mode is always opt-in and exact.
    return APPLICATION_RUNTIME_MODES.primary;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === APPLICATION_RUNTIME_MODES.primary) {
    return APPLICATION_RUNTIME_MODES.primary;
  }
  if (normalized === APPLICATION_RUNTIME_MODES.deploymentCandidate) {
    return APPLICATION_RUNTIME_MODES.deploymentCandidate;
  }
  if (normalized === APPLICATION_RUNTIME_MODES.dryRun) {
    return APPLICATION_RUNTIME_MODES.dryRun;
  }
  throw new Error('[runtime] APP_RUNTIME_MODE is invalid.');
}

const isNonPrimaryRuntimeMode = (mode: ApplicationRuntimeMode): boolean =>
  mode !== APPLICATION_RUNTIME_MODES.primary;

export function buildApplicationRuntimeModePolicy({
  value,
  nodeEnv,
  skipDbSync,
  alterSchema,
  seedAccessControl,
}: {
  value: unknown;
  nodeEnv: string | undefined;
  skipDbSync: boolean;
  alterSchema: boolean;
  seedAccessControl: boolean;
}): ApplicationRuntimeModePolicy {
  const mode = resolveApplicationRuntimeMode(value);
  if (isNonPrimaryRuntimeMode(mode)) {
    const violations: string[] = [];
    if ((nodeEnv ?? '').trim().toLowerCase() !== 'production') {
      violations.push('NODE_ENV must be production');
    }
    if (!skipDbSync) violations.push('SKIP_DB_SYNC must be true');
    if (alterSchema) violations.push('DB_SYNC_ALTER must be false');
    if (seedAccessControl) violations.push('SEED_ACCESS_CONTROL must be false');
    if (violations.length > 0) {
      throw new Error(
        `[runtime] Refusing unsafe ${mode} startup: `
        + `${violations.join('; ')}.`,
      );
    }
  }
  const primary = mode === APPLICATION_RUNTIME_MODES.primary;
  return Object.freeze({
    mode,
    allowStartupMutations: primary,
    allowBackgroundJobs: primary,
  });
}
