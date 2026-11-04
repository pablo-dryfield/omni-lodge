const mockValues = new Map<string, unknown>();
jest.mock('../configService.js', () => ({
  getConfigValue: (key: string) => mockValues.get(key),
  refreshConfigCacheKeys: jest.fn(async () => {}),
}));
jest.mock('../databaseWorkspace/store.js', () => ({
  configureControlBudget: jest.fn(),
}));
import { DATABASE_WORKSPACE_CONFIG } from '../../config/databaseWorkspaceConfig.js';
import { workspaceConfiguration } from '../databaseWorkspace/config.js';
import { refreshConfigCacheKeys } from '../configService.js';
beforeEach(() => {
  mockValues.clear();
  for (const definition of DATABASE_WORKSPACE_CONFIG)
    mockValues.set(
      definition.key,
      definition.valueType === 'json' &&
        typeof definition.defaultValue === 'string'
        ? JSON.parse(definition.defaultValue)
        : definition.defaultValue,
    );
  mockValues.set('DB_BACKUP_DIRECTORY', '/home/postgres/backups');
});
it('invalidates existing workspace reviews when the configured server backup location changes', async () => {
  const before = await workspaceConfiguration();
  mockValues.set('DB_BACKUP_DIRECTORY', '/srv/backup-copies');
  const after = await workspaceConfiguration();
  expect(after.policyHash).not.toBe(before.policyHash);
  expect(refreshConfigCacheKeys).toHaveBeenCalledWith(
    expect.arrayContaining(['DB_BACKUP_DIRECTORY']),
  );
});
