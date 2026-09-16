import {
  assertLegacyAdoptionInventory,
  assertMigrationMetadataLineage,
  classifyMigrationDatabase,
  hashMigrationNames,
  resolveConstraintDefinition,
  resolveIndexDefinition,
  type ConstraintDefinition,
  type IndexDefinition,
  type PinnedMigrationMetadataProfile,
} from '../migrationSafety.js';

describe('migration database classification', () => {
  it.each([
    {
      label: 'a database without application tables or applied migrations as fresh',
      inventory: {
        metadataTableExists: false,
        appliedMigrationCount: 0,
        appliedMigrationNames: [],
        existingControlTables: [],
        applicationTables: [],
      },
      expected: 'fresh',
    },
    {
      label: 'an empty existing metadata table as fresh',
      inventory: {
        metadataTableExists: true,
        appliedMigrationCount: 0,
        appliedMigrationNames: [],
        existingControlTables: ['sequelize_meta'],
        applicationTables: [],
      },
      expected: 'fresh',
    },
    {
      label: 'an existing application schema without applied metadata as unmanaged',
      inventory: {
        metadataTableExists: false,
        appliedMigrationCount: 0,
        appliedMigrationNames: [],
        existingControlTables: [],
        applicationTables: ['users'],
      },
      expected: 'unmanaged_existing_schema',
    },
    {
      label: 'an existing application schema with an empty metadata table as unmanaged',
      inventory: {
        metadataTableExists: true,
        appliedMigrationCount: 0,
        appliedMigrationNames: [],
        existingControlTables: ['sequelize_meta'],
        applicationTables: ['users'],
      },
      expected: 'unmanaged_existing_schema',
    },
    {
      label: 'an application schema with applied metadata as managed',
      inventory: {
        metadataTableExists: true,
        appliedMigrationCount: 50,
        appliedMigrationNames: ['one.js'],
        existingControlTables: ['sequelize_meta'],
        applicationTables: ['users'],
      },
      expected: 'managed',
    },
    {
      label: 'applied metadata without application tables as inconsistent',
      inventory: {
        metadataTableExists: true,
        appliedMigrationCount: 1,
        appliedMigrationNames: ['one.js'],
        existingControlTables: ['sequelize_meta'],
        applicationTables: [],
      },
      expected: 'inconsistent_metadata',
    },
    {
      label: 'orphaned migration audit tables without metadata as inconsistent control state',
      inventory: {
        metadataTableExists: false,
        appliedMigrationCount: 0,
        appliedMigrationNames: [],
        existingControlTables: ['migration_audit_runs'],
        applicationTables: [],
      },
      expected: 'unexpected_control_state',
    },
    {
      label: 'audit tables with empty metadata as inconsistent control state',
      inventory: {
        metadataTableExists: true,
        appliedMigrationCount: 0,
        appliedMigrationNames: [],
        existingControlTables: ['migration_audit_runs', 'migration_audit_steps', 'sequelize_meta'],
        applicationTables: [],
      },
      expected: 'unexpected_control_state',
    },
  ] as const)('classifies $label', ({ inventory, expected }) => {
    expect(classifyMigrationDatabase(inventory)).toBe(expected);
  });
});

describe('legacy adoption inventory', () => {
  it('requires sequelize_meta to be completely absent', () => {
    expect(() => assertLegacyAdoptionInventory({
      metadataTableExists: true,
      appliedMigrationCount: 0,
      appliedMigrationNames: [],
      existingControlTables: ['sequelize_meta'],
      applicationTables: ['users'],
    })).toThrow('requires all migration control tables to be absent');
  });

  it('requires an existing application schema', () => {
    expect(() => assertLegacyAdoptionInventory({
      metadataTableExists: false,
      appliedMigrationCount: 0,
      appliedMigrationNames: [],
      existingControlTables: [],
      applicationTables: [],
    })).toThrow('forbidden for an empty database');
  });

  it('accepts only an existing unmanaged schema with no metadata table', () => {
    expect(() => assertLegacyAdoptionInventory({
      metadataTableExists: false,
      appliedMigrationCount: 0,
      appliedMigrationNames: [],
      existingControlTables: [],
      applicationTables: ['users'],
    })).not.toThrow();
  });

  it('rejects orphaned audit control tables even when sequelize_meta is absent', () => {
    expect(() => assertLegacyAdoptionInventory({
      metadataTableExists: false,
      appliedMigrationCount: 0,
      appliedMigrationNames: [],
      existingControlTables: ['migration_audit_runs'],
      applicationTables: ['users'],
    })).toThrow('requires all migration control tables to be absent');
  });
});

describe('migration metadata lineage', () => {
  const compiled = [
    '202601010001-first.js',
    '202601010002-legacy-a.js',
    '202601010003-legacy-b.js',
    '202601010004-bridge-b.js',
    '202601010005-existing.js',
    '202601010006-boundary.js',
  ];
  const legacy = [
    '202601010002-legacy-a.js',
    '202601010003-legacy-b.js',
  ];
  const exclusions = [
    '202601010001-first.js',
    '202601010004-bridge-b.js',
  ];
  const productionBaseline = compiled.filter((name) => !exclusions.includes(name));
  const profile: PinnedMigrationMetadataProfile = {
    id: 'test-production-profile',
    compiledBoundary: compiled.at(-1)!,
    compiledCountThroughBoundary: compiled.length,
    compiledNamesSha256: hashMigrationNames(compiled),
    excludedMigrationNames: exclusions,
    baselineAppliedCount: productionBaseline.length,
    baselineAppliedNamesSha256: hashMigrationNames(productionBaseline),
  };

  const assertLineage = (appliedMigrationNames: string[], overrides: {
    compiledMigrationNames?: string[];
    legacyAdoptionMigrationNames?: string[];
    preCiProductionProfile?: PinnedMigrationMetadataProfile;
  } = {}) => assertMigrationMetadataLineage({
    compiledMigrationNames: overrides.compiledMigrationNames ?? compiled,
    appliedMigrationNames,
    legacyAdoptionMigrationNames: overrides.legacyAdoptionMigrationNames ?? legacy,
    preCiProductionProfile: overrides.preCiProductionProfile ?? profile,
  });

  it('accepts an empty or partial compiled prefix', () => {
    expect(assertLineage([])).toEqual({ kind: 'compiled_prefix', appliedCount: 0 });
    expect(assertLineage(compiled.slice(0, 3))).toEqual({
      kind: 'compiled_prefix',
      appliedCount: 3,
    });
  });

  it('accepts the exact legacy adoption set plus a prefix of its remaining migrations', () => {
    expect(assertLineage([...legacy].reverse())).toEqual({
      kind: 'legacy_adoption',
      appliedCount: 2,
    });
    expect(assertLineage([...legacy, compiled[0]])).toEqual({
      kind: 'compiled_prefix',
      appliedCount: 3,
    });
  });

  it('accepts the pinned production baseline plus the exact bridge prefix', () => {
    expect(assertLineage(productionBaseline)).toEqual({
      kind: 'pre_ci_production',
      appliedCount: 4,
    });
    expect(assertLineage([...productionBaseline, exclusions[0]])).toEqual({
      kind: 'pre_ci_production',
      appliedCount: 5,
    });
    expect(assertLineage(compiled)).toEqual({
      kind: 'compiled_prefix',
      appliedCount: 6,
    });
  });

  it('rejects unknown metadata and known migrations with gaps', () => {
    expect(() => assertLineage(['202699999999-unknown.js'])).toThrow(
      'sequelize_meta contains unknown migrations',
    );
    expect(() => assertLineage([compiled[0], compiled[2]])).toThrow(
      'Migration metadata lineage is invalid',
    );
    expect(() => assertLineage([...productionBaseline, exclusions[1]])).toThrow(
      'Migration metadata lineage is invalid',
    );
    expect(() => assertLineage([...legacy, compiled[3]])).toThrow(
      'Migration metadata lineage is invalid',
    );
  });

  it('rejects changes anywhere at or before the pinned production boundary', () => {
    const backdated = ['202512310999-backdated.js', ...compiled].sort();
    expect(() => assertLineage([], { compiledMigrationNames: backdated })).toThrow(
      'compiled boundary changed',
    );
  });

  it('allows future migrations only after the immutable production boundary', () => {
    const future = [...compiled, '202701010001-future.js'];
    expect(assertLineage(compiled, { compiledMigrationNames: future })).toEqual({
      kind: 'compiled_prefix',
      appliedCount: compiled.length,
    });
    expect(assertLineage(productionBaseline, { compiledMigrationNames: future })).toEqual({
      kind: 'pre_ci_production',
      appliedCount: productionBaseline.length,
    });
    expect(() => assertLineage(
      [...productionBaseline, '202701010001-future.js'],
      { compiledMigrationNames: future },
    )).toThrow('Migration metadata lineage is invalid');
  });
});

describe('migration index definition resolution', () => {
  const expectedIndex: IndexDefinition = {
    name: 'users_email_idx',
    columns: ['tenant_id', 'email'],
    unique: true,
    method: 'btree',
    hasPredicate: false,
    valid: true,
    ready: true,
  };

  it('matches an equivalent definition with the expected name', () => {
    const actual: IndexDefinition = {
      ...expectedIndex,
      method: 'BTREE',
    };

    expect(resolveIndexDefinition(expectedIndex, [actual])).toEqual({
      status: 'exact_name',
      match: actual,
    });
  });

  it('preserves case-sensitive column names resolved from quoted PostgreSQL identifiers', () => {
    const camelCaseExpected: IndexDefinition = {
      ...expectedIndex,
      name: 'counters_user_id_idx',
      columns: ['userId'],
    };
    const catalogDefinition: IndexDefinition = {
      ...camelCaseExpected,
      columns: ['userId'],
    };

    expect(resolveIndexDefinition(camelCaseExpected, [catalogDefinition])).toEqual({
      status: 'exact_name',
      match: catalogDefinition,
    });
  });

  it('reports a same-name conflict even when another name has an equivalent definition', () => {
    const conflicting: IndexDefinition = {
      name: expectedIndex.name,
      columns: ['email', 'tenant_id'],
      unique: false,
      method: 'gin',
      hasPredicate: true,
      valid: false,
      ready: false,
    };
    const equivalentUnderAnotherName: IndexDefinition = {
      ...expectedIndex,
      name: 'users_email_equivalent_idx',
    };

    expect(
      resolveIndexDefinition(expectedIndex, [conflicting, equivalentUnderAnotherName]),
    ).toEqual({
      status: 'name_conflict',
      conflicting,
      differences: [
        'columns',
        'uniqueness',
        'method',
        'predicate_presence',
        'validity',
        'readiness',
      ],
    });
  });

  it('uses an equivalent differently named index only when the expected name is absent', () => {
    const equivalentUnderAnotherName: IndexDefinition = {
      ...expectedIndex,
      name: 'users_email_legacy_idx',
    };

    expect(resolveIndexDefinition(expectedIndex, [equivalentUnderAnotherName])).toEqual({
      status: 'equivalent_other_name',
      match: equivalentUnderAnotherName,
    });
  });

  it('rejects a same-named partial index with a different predicate', () => {
    const expected: IndexDefinition = {
      ...expectedIndex,
      hasPredicate: true,
      predicate: "status::text = 'active'::text",
    };
    const conflicting: IndexDefinition = {
      ...expected,
      predicate: "status::text = 'archived'::text",
    };
    const equivalentUnderAnotherName: IndexDefinition = {
      ...expected,
      name: 'users_email_active_legacy_idx',
    };

    expect(resolveIndexDefinition(expected, [conflicting, equivalentUnderAnotherName])).toEqual({
      status: 'name_conflict',
      conflicting,
      differences: ['predicate'],
    });
  });
});

describe('migration constraint definition resolution', () => {
  const expectedConstraint: ConstraintDefinition = {
    name: 'orders_account_id_fkey',
    type: 'FOREIGN KEY',
    columns: ['tenant_id', 'account_id'],
    references: {
      schema: 'public',
      table: 'accounts',
      columns: ['tenant_id', 'id'],
    },
    onUpdate: 'CASCADE',
    onDelete: 'RESTRICT',
  };

  it('matches an equivalent definition with the expected name', () => {
    const actual: ConstraintDefinition = {
      ...expectedConstraint,
      type: ' foreign   key ',
      onUpdate: 'cascade',
      onDelete: 'restrict',
    };

    expect(resolveConstraintDefinition(expectedConstraint, [actual])).toEqual({
      status: 'exact_name',
      match: actual,
    });
  });

  it('reports a same-name conflict even when another name has an equivalent definition', () => {
    const conflicting: ConstraintDefinition = {
      name: expectedConstraint.name,
      type: 'UNIQUE',
      columns: ['account_id', 'tenant_id'],
      references: {
        schema: 'archive',
        table: 'legacy_accounts',
        columns: ['id', 'tenant_id'],
      },
      onUpdate: 'NO ACTION',
      onDelete: 'CASCADE',
    };
    const equivalentUnderAnotherName: ConstraintDefinition = {
      ...expectedConstraint,
      name: 'orders_account_id_legacy_fkey',
    };

    expect(
      resolveConstraintDefinition(expectedConstraint, [conflicting, equivalentUnderAnotherName]),
    ).toEqual({
      status: 'name_conflict',
      conflicting,
      differences: [
        'type',
        'columns',
        'reference_schema',
        'reference_table',
        'reference_columns',
        'on_update',
        'on_delete',
      ],
    });
  });

  it('uses an equivalent differently named constraint only when the expected name is absent', () => {
    const equivalentUnderAnotherName: ConstraintDefinition = {
      ...expectedConstraint,
      name: 'orders_account_id_legacy_fkey',
    };

    expect(resolveConstraintDefinition(expectedConstraint, [equivalentUnderAnotherName])).toEqual({
      status: 'equivalent_other_name',
      match: equivalentUnderAnotherName,
    });
  });

  it('rejects a same-named check constraint with a different expression', () => {
    const expected: ConstraintDefinition = {
      name: 'orders_quantity_check',
      type: 'CHECK',
      columns: ['quantity'],
      checkExpression: 'quantity > 0',
    };
    const conflicting: ConstraintDefinition = {
      ...expected,
      checkExpression: 'quantity >= 0',
    };

    expect(resolveConstraintDefinition(expected, [conflicting])).toEqual({
      status: 'name_conflict',
      conflicting,
      differences: ['check_expression'],
    });
  });
});
