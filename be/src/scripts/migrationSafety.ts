import { createHash } from 'node:crypto';

export const MIGRATION_CONTROL_TABLES = Object.freeze([
  'sequelize_meta',
  'migration_audit_runs',
  'migration_audit_steps',
]);

export type MigrationDatabaseInventory = {
  metadataTableExists: boolean;
  appliedMigrationCount: number;
  appliedMigrationNames: string[];
  existingControlTables: string[];
  applicationTables: string[];
};

export type PinnedMigrationMetadataProfile = Readonly<{
  id: string;
  compiledBoundary: string;
  compiledCountThroughBoundary: number;
  compiledNamesSha256: string;
  excludedMigrationNames: readonly string[];
  baselineAppliedCount: number;
  baselineAppliedNamesSha256: string;
}>;

export type MigrationMetadataLineage = Readonly<{
  kind: 'compiled_prefix' | 'legacy_adoption' | 'pre_ci_production';
  appliedCount: number;
}>;

// Production already had 185 migration records before the CI migration gate
// introduced four idempotent, backdated bridge migrations. This profile pins
// the complete historical filename inventory at that boundary and the exact
// four omissions. New migrations may be appended after the boundary, but a
// renamed, removed, substituted, or newly backdated historical migration makes
// the profile invalid instead of silently expanding its authority.
export const PRE_CI_PRODUCTION_METADATA_PROFILE: PinnedMigrationMetadataProfile = Object.freeze({
  id: 'production-pre-ci-2026-09-16-v1',
  compiledBoundary: '202609090002-error-monitoring-access.js',
  compiledCountThroughBoundary: 189,
  compiledNamesSha256: '40ae182a92714e68882122af42449a183adfa80fbc496b6a37f15ef42d8fe2b7',
  excludedMigrationNames: Object.freeze([
    '202510010000-initial-schema.js',
    '202511030002-report-template-preview-order.js',
    '202511250001-user-profile-fields.js',
    '202512040021-legacy-timestamp-column-bridge.js',
  ]),
  baselineAppliedCount: 185,
  baselineAppliedNamesSha256: '3955590304d2d458561d3eeb184b61b723511624280608b8228f4679aa1d49c4',
});

export const hashMigrationNames = (names: readonly string[]): string =>
  createHash('sha256').update(names.join('\n')).digest('hex');

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalMigrationNames = (
  names: readonly string[],
  label: string,
  requireSorted: boolean,
): string[] => {
  if (!Array.isArray(names)) {
    throw new Error(`Migration lineage configuration is invalid: ${label} must be an array.`);
  }
  const normalized = names.map((name) => {
    if (
      typeof name !== 'string'
      || name.trim() !== name
      || !/^[0-9]{12}-[a-z0-9-]+\.js$/u.test(name)
    ) {
      throw new Error(`Migration lineage configuration is invalid: ${label} contains an invalid name.`);
    }
    return name;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Migration lineage configuration is invalid: ${label} contains duplicates.`);
  }
  const sorted = [...normalized].sort(compareText);
  if (requireSorted && sorted.some((name, index) => name !== normalized[index])) {
    throw new Error(`Migration lineage configuration is invalid: ${label} must be sorted.`);
  }
  return sorted;
};

const arraysMatchExact = (expected: readonly string[], actual: readonly string[]): boolean =>
  expected.length === actual.length && expected.every((value, index) => value === actual[index]);

const assertPinnedProfile = (
  compiledMigrationNames: readonly string[],
  profile: PinnedMigrationMetadataProfile,
): { baselineNames: string[]; excludedNames: string[] } => {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Migration lineage configuration is invalid: the pre-CI production profile is required.');
  }
  const boundaryIndex = compiledMigrationNames.indexOf(profile.compiledBoundary);
  if (boundaryIndex < 0) {
    throw new Error(
      `Migration lineage configuration is invalid: profile ${profile.id} boundary is missing.`,
    );
  }
  const namesThroughBoundary = compiledMigrationNames.slice(0, boundaryIndex + 1);
  if (
    namesThroughBoundary.length !== profile.compiledCountThroughBoundary
    || hashMigrationNames(namesThroughBoundary) !== profile.compiledNamesSha256
  ) {
    throw new Error(
      `Migration lineage configuration is invalid: profile ${profile.id} compiled boundary changed.`,
    );
  }

  const excludedNames = canonicalMigrationNames(
    profile.excludedMigrationNames,
    `profile ${profile.id} exclusions`,
    true,
  );
  const namesThroughBoundarySet = new Set(namesThroughBoundary);
  if (excludedNames.some((name) => !namesThroughBoundarySet.has(name))) {
    throw new Error(
      `Migration lineage configuration is invalid: profile ${profile.id} excludes an unknown migration.`,
    );
  }
  const excludedSet = new Set(excludedNames);
  const baselineNames = namesThroughBoundary.filter((name) => !excludedSet.has(name));
  if (
    baselineNames.length !== profile.baselineAppliedCount
    || hashMigrationNames(baselineNames) !== profile.baselineAppliedNamesSha256
  ) {
    throw new Error(
      `Migration lineage configuration is invalid: profile ${profile.id} baseline changed.`,
    );
  }
  return { baselineNames, excludedNames };
};

export function assertMigrationMetadataLineage({
  compiledMigrationNames: rawCompiledMigrationNames,
  appliedMigrationNames: rawAppliedMigrationNames,
  legacyAdoptionMigrationNames: rawLegacyAdoptionMigrationNames,
  preCiProductionProfile,
}: {
  compiledMigrationNames: readonly string[];
  appliedMigrationNames: readonly string[];
  legacyAdoptionMigrationNames: readonly string[];
  preCiProductionProfile: PinnedMigrationMetadataProfile;
}): MigrationMetadataLineage {
  const compiledMigrationNames = canonicalMigrationNames(
    rawCompiledMigrationNames,
    'compiled migration inventory',
    true,
  );
  if (compiledMigrationNames.length === 0) {
    throw new Error('Migration lineage configuration is invalid: compiled migration inventory is empty.');
  }
  const appliedMigrationNames = canonicalMigrationNames(
    rawAppliedMigrationNames,
    'applied migration metadata',
    false,
  );
  const legacyAdoptionMigrationNames = canonicalMigrationNames(
    rawLegacyAdoptionMigrationNames,
    'legacy adoption migration inventory',
    true,
  );
  const compiledSet = new Set(compiledMigrationNames);
  const unknownApplied = appliedMigrationNames.filter((name) => !compiledSet.has(name));
  if (unknownApplied.length > 0) {
    throw new Error(
      'Migration metadata lineage is invalid: sequelize_meta contains unknown migrations: '
      + unknownApplied.slice(0, 5).join(', '),
    );
  }
  const unknownLegacy = legacyAdoptionMigrationNames.filter((name) => !compiledSet.has(name));
  if (unknownLegacy.length > 0) {
    throw new Error(
      'Migration lineage configuration is invalid: legacy adoption inventory is not in the compiled inventory.',
    );
  }

  const { baselineNames, excludedNames } = assertPinnedProfile(
    compiledMigrationNames,
    preCiProductionProfile,
  );

  const compiledPrefix = compiledMigrationNames.slice(0, appliedMigrationNames.length);
  if (arraysMatchExact(compiledPrefix, appliedMigrationNames)) {
    return { kind: 'compiled_prefix', appliedCount: appliedMigrationNames.length };
  }

  const appliedSet = new Set(appliedMigrationNames);
  const legacySet = new Set(legacyAdoptionMigrationNames);
  const legacyRemaining = compiledMigrationNames.filter((name) => !legacySet.has(name));
  const appliedAfterLegacy = appliedMigrationNames.filter((name) => !legacySet.has(name));
  const expectedLegacyLineage = [
    ...legacyAdoptionMigrationNames,
    ...legacyRemaining.slice(0, appliedAfterLegacy.length),
  ].sort(compareText);
  if (
    legacyAdoptionMigrationNames.every((name) => appliedSet.has(name))
    && arraysMatchExact(expectedLegacyLineage, appliedMigrationNames)
  ) {
    return { kind: 'legacy_adoption', appliedCount: appliedMigrationNames.length };
  }

  const baselineSet = new Set(baselineNames);
  const appliedAfterBaseline = appliedMigrationNames.filter((name) => !baselineSet.has(name));
  const expectedProductionLineage = [
    ...baselineNames,
    ...excludedNames.slice(0, appliedAfterBaseline.length),
  ].sort(compareText);
  if (
    baselineNames.every((name) => appliedSet.has(name))
    && arraysMatchExact(expectedProductionLineage, appliedMigrationNames)
  ) {
    return { kind: 'pre_ci_production', appliedCount: appliedMigrationNames.length };
  }

  throw new Error(
    'Migration metadata lineage is invalid: applied migrations are not a compiled prefix, '
    + 'the committed legacy-adoption lineage, or the pinned pre-CI production lineage.',
  );
}

export type MigrationDatabaseClassification =
  | 'fresh'
  | 'managed'
  | 'unmanaged_existing_schema'
  | 'unexpected_control_state'
  | 'inconsistent_metadata';

export function classifyMigrationDatabase(
  inventory: MigrationDatabaseInventory,
): MigrationDatabaseClassification {
  const hasApplicationTables = inventory.applicationTables.length > 0;
  if (inventory.appliedMigrationCount > 0) {
    return hasApplicationTables ? 'managed' : 'inconsistent_metadata';
  }
  const hasAuditControlTables = inventory.existingControlTables.some(
    (table) => table !== 'sequelize_meta',
  );
  if (!hasApplicationTables && hasAuditControlTables) {
    return 'unexpected_control_state';
  }
  return hasApplicationTables ? 'unmanaged_existing_schema' : 'fresh';
}

export function assertLegacyAdoptionInventory(
  inventory: MigrationDatabaseInventory,
): void {
  if (inventory.metadataTableExists || inventory.existingControlTables.length > 0) {
    throw new Error(
      'Legacy adoption requires all migration control tables to be absent; existing control state must be reviewed explicitly.',
    );
  }
  if (inventory.applicationTables.length === 0) {
    throw new Error('Legacy adoption is forbidden for an empty database; run normal migrations instead.');
  }
}

export type IndexDefinition = {
  name?: string;
  columns: string[];
  unique: boolean;
  method: string;
  hasPredicate: boolean;
  predicate?: string;
  valid?: boolean;
  ready?: boolean;
};

export type ConstraintReference = {
  schema: string;
  table: string;
  columns: string[];
};

export type ConstraintDefinition = {
  name?: string;
  type: string;
  columns: string[];
  references?: ConstraintReference;
  onUpdate?: string;
  onDelete?: string;
  checkExpression?: string;
};

export type DefinitionResolution<T> = {
  status: 'exact_name' | 'equivalent_other_name' | 'missing' | 'name_conflict';
  match?: T;
  conflicting?: T;
  differences?: string[];
};

const normalizeWord = (value: string | undefined, fallback: string): string =>
  (value ?? fallback).trim().replace(/\s+/gu, ' ').toUpperCase();

export const normalizeIndexMethod = (value: string | undefined): string =>
  (value ?? 'btree').trim().toLowerCase();

export const normalizeConstraintAction = (value: string | undefined): string =>
  normalizeWord(value, 'NO ACTION');

export function indexDefinitionDifferences(
  expected: IndexDefinition,
  actual: IndexDefinition,
): string[] {
  const differences: string[] = [];
  if (!arraysMatchExact(expected.columns, actual.columns)) differences.push('columns');
  if (expected.unique !== actual.unique) differences.push('uniqueness');
  if (normalizeIndexMethod(expected.method) !== normalizeIndexMethod(actual.method)) differences.push('method');
  if (expected.hasPredicate !== actual.hasPredicate) differences.push('predicate_presence');
  if (expected.hasPredicate && expected.predicate !== actual.predicate) differences.push('predicate');
  if (actual.valid === false) differences.push('validity');
  if (actual.ready === false) differences.push('readiness');
  return differences;
}

export function constraintDefinitionDifferences(
  expected: ConstraintDefinition,
  actual: ConstraintDefinition,
): string[] {
  const differences: string[] = [];
  if (normalizeWord(expected.type, 'CONSTRAINT') !== normalizeWord(actual.type, 'CONSTRAINT')) {
    differences.push('type');
  }
  if (!arraysMatchExact(expected.columns, actual.columns)) differences.push('columns');

  if (expected.references) {
    if (!actual.references) {
      differences.push('reference');
    } else {
      if (expected.references.schema !== actual.references.schema) differences.push('reference_schema');
      if (expected.references.table !== actual.references.table) differences.push('reference_table');
      if (!arraysMatchExact(expected.references.columns, actual.references.columns)) {
        differences.push('reference_columns');
      }
    }
  } else if (actual.references) {
    differences.push('reference');
  }

  if (normalizeWord(expected.type, 'CONSTRAINT') === 'FOREIGN KEY') {
    if (normalizeConstraintAction(expected.onUpdate) !== normalizeConstraintAction(actual.onUpdate)) {
      differences.push('on_update');
    }
    if (normalizeConstraintAction(expected.onDelete) !== normalizeConstraintAction(actual.onDelete)) {
      differences.push('on_delete');
    }
  }
  if (
    normalizeWord(expected.type, 'CONSTRAINT') === 'CHECK'
    && expected.checkExpression !== actual.checkExpression
  ) {
    differences.push('check_expression');
  }
  return differences;
}

export function resolveIndexDefinition(
  expected: IndexDefinition,
  actualDefinitions: IndexDefinition[],
): DefinitionResolution<IndexDefinition> {
  if (expected.name) {
    const named = actualDefinitions.find((definition) => definition.name === expected.name);
    if (named) {
      const differences = indexDefinitionDifferences(expected, named);
      return differences.length === 0
        ? { status: 'exact_name', match: named }
        : { status: 'name_conflict', conflicting: named, differences };
    }
  }

  const equivalent = actualDefinitions.find(
    (definition) => indexDefinitionDifferences(expected, definition).length === 0,
  );
  return equivalent
    ? { status: 'equivalent_other_name', match: equivalent }
    : { status: 'missing' };
}

export function resolveConstraintDefinition(
  expected: ConstraintDefinition,
  actualDefinitions: ConstraintDefinition[],
): DefinitionResolution<ConstraintDefinition> {
  if (expected.name) {
    const named = actualDefinitions.find((definition) => definition.name === expected.name);
    if (named) {
      const differences = constraintDefinitionDifferences(expected, named);
      return differences.length === 0
        ? { status: 'exact_name', match: named }
        : { status: 'name_conflict', conflicting: named, differences };
    }
  }

  const equivalent = actualDefinitions.find(
    (definition) => constraintDefinitionDifferences(expected, definition).length === 0,
  );
  return equivalent
    ? { status: 'equivalent_other_name', match: equivalent }
    : { status: 'missing' };
}
