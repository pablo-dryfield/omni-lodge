import {
  assertDatabaseSyncPolicy,
  resolveDatabaseSyncBoolean,
} from '../databaseSyncPolicy.js';

describe('resolveDatabaseSyncBoolean', () => {
  it.each([
    [true, true],
    [1, true],
    [' YES ', true],
    [false, false],
    [0, false],
    [' n ', false],
  ])('normalizes %p to %p', (value, expected) => {
    expect(resolveDatabaseSyncBoolean(value, !expected)).toBe(expected);
  });

  it('uses the fail-safe caller fallback for missing or invalid values', () => {
    expect(resolveDatabaseSyncBoolean(undefined, false)).toBe(false);
    expect(resolveDatabaseSyncBoolean('maybe', true)).toBe(true);
  });
});

describe('assertDatabaseSyncPolicy', () => {
  it('allows production startup only when runtime schema sync is disabled', () => {
    expect(() => assertDatabaseSyncPolicy({
      nodeEnv: 'production',
      skipDbSync: true,
      alterSchema: false,
    })).not.toThrow();
  });

  it('rejects production startup when SKIP_DB_SYNC is not enabled', () => {
    expect(() => assertDatabaseSyncPolicy({
      nodeEnv: 'production',
      skipDbSync: false,
      alterSchema: false,
    })).toThrow('SKIP_DB_SYNC must be true');
  });

  it('rejects production startup when DB_SYNC_ALTER is enabled', () => {
    expect(() => assertDatabaseSyncPolicy({
      nodeEnv: 'production',
      skipDbSync: true,
      alterSchema: true,
    })).toThrow('DB_SYNC_ALTER must be false');
  });

  it.each(['development', 'test', undefined])(
    'preserves existing non-production sync behavior for NODE_ENV=%s',
    (nodeEnv) => {
      expect(() => assertDatabaseSyncPolicy({
        nodeEnv,
        skipDbSync: false,
        alterSchema: true,
      })).not.toThrow();
    },
  );
});
