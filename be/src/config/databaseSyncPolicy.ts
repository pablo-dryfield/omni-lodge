export type DatabaseSyncPolicy = {
  nodeEnv: string | undefined;
  skipDbSync: boolean;
  alterSchema: boolean;
};

export function assertDatabaseSyncPolicy(policy: DatabaseSyncPolicy): void {
  if ((policy.nodeEnv ?? '').trim().toLowerCase() !== 'production') {
    return;
  }

  const violations: string[] = [];
  if (!policy.skipDbSync) {
    violations.push('SKIP_DB_SYNC must be true');
  }
  if (policy.alterSchema) {
    violations.push('DB_SYNC_ALTER must be false');
  }
  if (violations.length > 0) {
    throw new Error(
      '[database] Refusing unsafe production startup: '
      + `${violations.join('; ')}. Apply reviewed migrations before starting the backend.`,
    );
  }
}
