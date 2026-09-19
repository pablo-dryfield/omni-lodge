import { createHash } from 'node:crypto';
import {
  LEGACY_ADOPTION_MIGRATIONS,
  LEGACY_ADOPTION_PROFILE,
  fingerprintLegacySchema,
  legacyAdoptionConfirmation,
  legacySnapshotCounts,
  type LegacySchemaSnapshot,
} from '../legacyMigrationAdoptionProfile.js';

const buildSnapshot = (): LegacySchemaSnapshot => ({
  version: 1,
  tables: [{ schema: 'public', table: 'users' }],
  columns: [
    {
      schema: 'public',
      table: 'users',
      column: 'id',
      dataType: 'integer',
      nullable: false,
      defaultExpression: ' nextval(  users_id_seq  ) ',
    },
  ],
  constraints: [{ name: 'users_pkey', type: 'PRIMARY KEY', columns: ['id'] }],
  indexes: [{ name: 'users_pkey', method: 'btree', columns: ['id'], unique: true }],
  enums: [{ type: 'user_status', values: ['active', 'inactive'] }],
  views: [],
  triggers: [],
});

describe('legacy migration adoption profile', () => {
  it('pins the immutable 50-migration legacy boundary', () => {
    expect(Object.isFrozen(LEGACY_ADOPTION_MIGRATIONS)).toBe(true);
    expect(Object.isFrozen(LEGACY_ADOPTION_PROFILE)).toBe(true);
    expect(Object.isFrozen(LEGACY_ADOPTION_PROFILE.expectedCounts)).toBe(true);
    expect(LEGACY_ADOPTION_MIGRATIONS).toHaveLength(50);
    expect(new Set(LEGACY_ADOPTION_MIGRATIONS).size).toBe(50);
    expect([...LEGACY_ADOPTION_MIGRATIONS].sort()).toEqual(LEGACY_ADOPTION_MIGRATIONS);
    expect(LEGACY_ADOPTION_MIGRATIONS[0]).toBe('202510020001-counter-registry.js');
    expect(LEGACY_ADOPTION_MIGRATIONS.at(-1)).toBe('202512210001-game-scores.js');
    expect(
      createHash('sha256').update(LEGACY_ADOPTION_MIGRATIONS.join('\n')).digest('hex'),
    ).toBe('686ee814b62f15ef81d47fc5da074c7679d01a0483a3bb75b7148ac1d892a280');
    expect(LEGACY_ADOPTION_PROFILE.migrationNames).toBe(LEGACY_ADOPTION_MIGRATIONS);
    expect(LEGACY_ADOPTION_PROFILE.expectedCounts).toEqual({
      tables: 79,
      columns: 896,
      constraints: 243,
      indexes: 198,
      enumValues: 170,
      views: 0,
      triggers: 0,
    });
  });

  it('does not include later control-plane or compatibility migrations', () => {
    expect(LEGACY_ADOPTION_MIGRATIONS).not.toContain('202601150001-control-panel-config.js');
    expect(LEGACY_ADOPTION_MIGRATIONS).not.toContain('202602010001-migration-audit.js');
    expect(LEGACY_ADOPTION_MIGRATIONS).not.toContain('202602150001-config-seed-runs.js');
  });

  it('requires the profile id and committed fingerprint as its confirmation', () => {
    expect(legacyAdoptionConfirmation(LEGACY_ADOPTION_PROFILE)).toBe(
      'pre-umzug-2026-01-24-v1:bb7b1d4e1c7d4ef074f8d4d29ffaccdb7f2d57b7f430c29ea662c6d999716a66',
    );
  });

  it('fingerprints equivalent object-key ordering deterministically', () => {
    const original = buildSnapshot();
    const reorderedKeysAndWhitespace: LegacySchemaSnapshot = {
      triggers: [],
      views: [],
      enums: [{ values: ['active', 'inactive'], type: 'user_status' }],
      indexes: [{ unique: true, columns: ['id'], method: 'btree', name: 'users_pkey' }],
      constraints: [{ columns: ['id'], type: 'PRIMARY KEY', name: 'users_pkey' }],
      columns: [
        {
          defaultExpression: ' nextval(  users_id_seq  ) ',
          nullable: false,
          dataType: 'integer',
          column: 'id',
          table: 'users',
          schema: 'public',
        },
      ],
      tables: [{ table: 'users', schema: 'public' }],
      version: 1,
    };

    expect(fingerprintLegacySchema(original)).toHaveLength(64);
    expect(fingerprintLegacySchema(reorderedKeysAndWhitespace)).toBe(
      fingerprintLegacySchema(original),
    );
  });

  it('changes the fingerprint when the schema semantics change', () => {
    const original = buildSnapshot();
    const changed = buildSnapshot();
    changed.columns = changed.columns.map((column) => ({
      ...(column as Record<string, unknown>),
      nullable: true,
    }));

    expect(fingerprintLegacySchema(changed)).not.toBe(fingerprintLegacySchema(original));
  });

  it('preserves whitespace that may be meaningful inside schema strings', () => {
    const original = buildSnapshot();
    const changed = buildSnapshot();
    changed.enums = [{ type: 'user_status', values: ['active user', 'inactive'] }];

    expect(fingerprintLegacySchema(changed)).not.toBe(fingerprintLegacySchema(original));
  });

  it('counts every fingerprinted schema object category', () => {
    const snapshot: LegacySchemaSnapshot = {
      version: 1,
      tables: [{}, {}],
      columns: [{}, {}, {}],
      constraints: [{}],
      indexes: [{}, {}, {}, {}],
      enums: [{}, {}],
      views: [{}],
      triggers: [{}, {}, {}],
    };

    expect(legacySnapshotCounts(snapshot)).toEqual({
      tables: 2,
      columns: 3,
      constraints: 1,
      indexes: 4,
      enumValues: 2,
      views: 1,
      triggers: 3,
    });
  });
});
