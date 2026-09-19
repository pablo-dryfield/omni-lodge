import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createMigrationRuntimeStatus,
  inspectMigrationDatabase,
  listCompiledMigrationNames,
  MigrationDatabaseSafetyError,
} from '../migrationRuntimeStatus.js';
import type { MigrationDatabaseInventory } from '../migrationSafety.js';

const compiledMigrationNames = (): string[] => readdirSync(resolve('src/migrations'))
  .filter((name) => name.endsWith('.ts'))
  .map((name) => name.replace(/\.ts$/u, '.js'))
  .sort();

const inventory = (
  appliedMigrationNames: string[],
  overrides: Partial<MigrationDatabaseInventory> = {},
): MigrationDatabaseInventory => ({
  metadataTableExists: true,
  appliedMigrationCount: appliedMigrationNames.length,
  appliedMigrationNames,
  existingControlTables: ['sequelize_meta'],
  applicationTables: ['users'],
  ...overrides,
});

describe('migration runtime status', () => {
  it('reports a valid managed database and exact pending names', () => {
    const compiled = compiledMigrationNames();
    const applied = compiled.slice(0, -2);
    const result = createMigrationRuntimeStatus({
      inventory: inventory(applied),
      compiledMigrationNames: compiled,
    });

    expect(result).toEqual({
      schemaVersion: 1,
      kind: 'omnilodge-migration-status',
      ok: true,
      classification: 'managed',
      lineage: 'compiled_prefix',
      metadataTableExists: true,
      appliedMigrationCount: applied.length,
      compiledMigrationCount: compiled.length,
      pendingMigrationCount: 2,
      pendingMigrationNames: compiled.slice(-2),
    });
  });

  it('reports a fresh database without creating migration metadata', () => {
    const compiled = compiledMigrationNames();
    const result = createMigrationRuntimeStatus({
      inventory: inventory([], {
        metadataTableExists: false,
        existingControlTables: [],
        applicationTables: [],
      }),
      compiledMigrationNames: compiled,
    });

    expect(result.classification).toBe('fresh');
    expect(result.metadataTableExists).toBe(false);
    expect(result.pendingMigrationNames).toEqual(compiled);
  });

  it('fails closed for an unmanaged existing schema', () => {
    const compiled = compiledMigrationNames();
    expect(() => createMigrationRuntimeStatus({
      inventory: inventory([], {
        metadataTableExists: false,
        existingControlTables: [],
      }),
      compiledMigrationNames: compiled,
    })).toThrow(MigrationDatabaseSafetyError);
  });

  it('uses only catalog SELECTs and skips sequelize_meta when it is absent', async () => {
    const statements: string[] = [];
    const result = await inspectMigrationDatabase(async <T>(sql: string): Promise<T[]> => {
      statements.push(sql);
      if (sql.includes('NOT IN')) return [{ table_name: 'users' }] as T[];
      return [];
    });

    expect(result).toEqual({
      metadataTableExists: false,
      appliedMigrationCount: 0,
      appliedMigrationNames: [],
      existingControlTables: [],
      applicationTables: ['users'],
    });
    expect(statements).toHaveLength(2);
    expect(statements.every((sql) => /^\s*SELECT\b/iu.test(sql))).toBe(true);
    expect(statements.some((sql) => /FROM sequelize_meta/iu.test(sql))).toBe(false);
  });

  it('lists only sorted compiled JavaScript migrations', async () => {
    const root = mkdtempSync(join(tmpdir(), 'omnilodge-migration-status-'));
    try {
      mkdirSync(join(root, 'nested'));
      writeFileSync(join(root, '202601010002-two.js'), '');
      writeFileSync(join(root, '202601010001-one.js'), '');
      writeFileSync(join(root, 'ignored.js.map'), '');
      writeFileSync(join(root, 'ignored.ts'), '');
      expect(await listCompiledMigrationNames(root)).toEqual([
        '202601010001-one.js',
        '202601010002-two.js',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
