import { createHash } from 'node:crypto';

export const LEGACY_SCHEMA_FINGERPRINT_VERSION = 1;

// This is the immutable migration inventory that existed when the legacy
// Sequelize-managed database was first brought under Umzug. Do not derive this
// list from the current migration directory: newly added migrations must always
// remain pending after adoption.
export const LEGACY_ADOPTION_MIGRATIONS = Object.freeze([
  '202510020001-counter-registry.js',
  '202510020002-pub-crawl-seed.js',
  '202510100003-payment-methods.js',
  '202510100004-pricing-and-commissions.js',
  '202510100005-counter-metric-kind-cash.js',
  '202510170006-night-reports.js',
  '202510170007-venues.js',
  '202510200008-venue-open-bar-flag.js',
  '202510240009-finance-module.js',
  '202510280010-scheduling-module.js',
  '202510280011-scheduling-demo-seed.js',
  '202511010001-shift-roles.js',
  '202511010002-shift-template-repeat-on.js',
  '202511010003-shift-assignment-role-uniqueness.js',
  '202511010004-shift-template-manager-coverage.js',
  '202511030001-report-templates.js',
  '202511070001-reporting-engine.js',
  '202511110001-derived-field-ast.js',
  '202511150001-derived-field-join-metadata.js',
  '202511150002-user-home-preferences.js',
  '202511200003-review-counters.js',
  '202511200004-review-platforms.js',
  '202511220001-review-entry-approval.js',
  '202511220004-review-platform-metadata.js',
  '202511220005-compensation-components.js',
  '202511220006-am-task-tracking.js',
  '202511220007-extend-staff-types.js',
  '202511220008-add-night-report-method.js',
  '202511230001-venue-compensation-terms.js',
  '202511230002-venue-compensation-term-rates.js',
  '202511260001-venue-finance-links.js',
  '202511260002-staff-profile-finance-links.js',
  '202511260003-remove-staff-category-links.js',
  '202511260004-venue-compensation-collection-logs.js',
  '202511270100-staff-payout-collection-logs.js',
  '202511270200-staff-payout-ledgers.js',
  '202511270210-venue-compensation-ledgers.js',
  '202511270230-compensation-component-default-finance.js',
  '202511300900-staff-payout-ledgers-dedupe.js',
  '202511300905-venue-compensation-ledgers-dedupe.js',
  '202512010001-review-counter-monthly-approvals.js',
  '202512010002-review-counter-base-override.js',
  '202512010003-channel-cash-collection-logs.js',
  '202512010003-finance-transaction-awaiting-reimbursement.js',
  '202512030005-booking-ingestion.js',
  '202512040010-booking-status-rebooked.js',
  '202512040020-booking-index-tuning.js',
  '202512070300-booking-status-timestamp.js',
  '202512100201-add-xperiencepoland-platform.js',
  '202512210001-game-scores.js',
]);

export type LegacyAdoptionProfile = {
  id: string;
  migrationNames: readonly string[];
  schemaFingerprint: string;
  fingerprintVersion: number;
  expectedCounts: Readonly<{
    tables: number;
    columns: number;
    constraints: number;
    indexes: number;
    enumValues: number;
    views: number;
    triggers: number;
  }>;
};

// Reconstructed on PostgreSQL from the immutable 50-migration legacy boundary
// plus the idempotent initial-schema/compatibility bridges that intentionally
// remain pending after adoption. A different legacy shape needs a separately
// reviewed profile; an operator cannot approve an arbitrary runtime digest.
export const LEGACY_ADOPTION_PROFILE: LegacyAdoptionProfile = Object.freeze({
  id: 'pre-umzug-2026-01-24-v1',
  migrationNames: LEGACY_ADOPTION_MIGRATIONS,
  schemaFingerprint: 'bb7b1d4e1c7d4ef074f8d4d29ffaccdb7f2d57b7f430c29ea662c6d999716a66',
  fingerprintVersion: LEGACY_SCHEMA_FINGERPRINT_VERSION,
  expectedCounts: Object.freeze({
    tables: 79,
    columns: 896,
    constraints: 243,
    indexes: 198,
    enumValues: 170,
    views: 0,
    triggers: 0,
  }),
});

export type LegacySchemaSnapshot = {
  version: number;
  tables: unknown[];
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
  enums: unknown[];
  views: unknown[];
  triggers: unknown[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function fingerprintLegacySchema(snapshot: LegacySchemaSnapshot): string {
  const canonical = JSON.stringify(canonicalize(snapshot));
  return createHash('sha256').update(canonical).digest('hex');
}

export function legacyAdoptionConfirmation(profile: LegacyAdoptionProfile): string {
  return `${profile.id}:${profile.schemaFingerprint}`;
}

export function legacySnapshotCounts(snapshot: LegacySchemaSnapshot): LegacyAdoptionProfile['expectedCounts'] {
  return {
    tables: snapshot.tables.length,
    columns: snapshot.columns.length,
    constraints: snapshot.constraints.length,
    indexes: snapshot.indexes.length,
    enumValues: snapshot.enums.length,
    views: snapshot.views.length,
    triggers: snapshot.triggers.length,
  };
}
