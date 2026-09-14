import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const backendRequire = createRequire(path.join(repositoryRoot, 'be', 'package.json'));
const { Client } = backendRequire('pg');

const requiredEnvironment = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingEnvironment = requiredEnvironment.filter((name) => !(process.env[name] ?? '').trim());
if (missingEnvironment.length > 0) {
  throw new Error(`Missing disposable database configuration: ${missingEnvironment.join(', ')}`);
}

const REQUIRED_SCHEMA = Object.freeze({
  users: [
    'id',
    'email',
    'role',
    'status',
    'phone',
    'country_of_citizenship',
    'date_of_birth',
    'preferred_pronouns',
    'emergency_contact_name',
    'emergency_contact_relationship',
    'emergency_contact_phone',
    'emergency_contact_email',
    'arrival_date',
    'departure_date',
    'dietary_restrictions',
    'allergies',
    'medical_notes',
    'whatsapp_handle',
    'facebook_profile_url',
    'instagram_profile_url',
    'discovery_source',
    'profile_photo_path',
    'profile_photo_url',
  ],
  products: ['id'],
  channels: ['id'],
  guests: ['id'],
  bookings: [
    'id',
    'platform',
    'platform_booking_id',
    'experience_date',
    'source_received_at',
    'payment_status',
  ],
  availabilities: ['id', 'createdAt', 'updatedAt'],
  booking_addons: ['id', 'createdAt', 'updatedAt'],
  booking_emails: ['id', 'createdAt', 'updatedAt'],
  booking_events: ['id', 'createdAt', 'updatedAt'],
  channel_commissions: ['id', 'createdAt', 'updatedAt'],
  channel_product_prices: ['id', 'createdAt', 'updatedAt'],
  product_prices: ['id', 'createdAt', 'updatedAt'],
  report_templates: ['id', 'preview_order'],
  schedule_weeks: ['id', 'createdAt', 'updatedAt'],
  shift_assignments: ['id', 'createdAt', 'updatedAt'],
  shift_instances: ['id', 'createdAt', 'updatedAt'],
  shift_roles: ['id', 'createdAt', 'updatedAt'],
  shift_templates: ['id', 'createdAt', 'updatedAt'],
  finance_accounts: ['id'],
  finance_transactions: ['id', 'account_id', 'amount_minor', 'status', 'meta'],
  staff_profiles: ['user_id', 'staff_type', 'active', 'createdAt', 'updatedAt'],
  swap_requests: ['id', 'createdAt', 'updatedAt'],
  user_shift_roles: ['user_id', 'shift_role_id', 'createdAt', 'updatedAt'],
  venue_compensation_terms: ['id', 'createdAt', 'updatedAt'],
  venue_compensation_term_rates: ['id', 'createdAt', 'updatedAt'],
  am_task_templates: ['id', 'schedule_config'],
  am_task_assignments: ['id', 'template_id', 'target_scope', 'user_id'],
  am_task_logs: ['id', 'template_id', 'user_id', 'task_date', 'status', 'meta'],
  social_media_contents: [
    'id',
    'status',
    'scheduled_at',
    'published_at',
    'published_task_log_id',
  ],
  volunteer_stays: ['id', 'user_id', 'start_date', 'end_date', 'monthly_targets'],
  cleaning_submissions: ['id', 'task_log_id', 'user_id', 'status'],
  error_monitoring_issues: ['id', 'fingerprint', 'status', 'last_seen_at'],
  error_monitoring_occurrences: ['id', 'issue_id', 'occurred_at', 'release'],
  storefront_orders: [
    'id',
    'public_id',
    'status',
    'payment_status',
    'order_source',
    'payment_method',
  ],
  whatsapp_messages: ['id', 'provider_message_id', 'direction', 'occurred_at'],
  open_bar_sessions: ['id', 'business_date', 'status'],
  review_archive: ['id', 'source_review_id', 'is_deleted'],
  staff_payout_receipts: ['id', 'staff_user_id', 'status', 'range_start', 'range_end'],
  migration_audit_runs: ['run_id', 'direction', 'status', 'finished_at'],
  migration_audit_steps: ['run_id', 'migration_name', 'status', 'verify_status'],
  sequelize_meta: ['name'],
});

const REQUIRED_INDEXES = [
  'cleaning_submission_assignment_uq',
  'error_monitoring_issues_fingerprint_key',
  'finance_transactions_recurring_occurrence_uidx',
  'social_media_contents_published_task_log_id_uq',
  'storefront_orders_public_id_key',
  'volunteer_stays_user_dates_idx',
  'whatsapp_messages_phone_provider_unique',
];

const REQUIRED_FOREIGN_KEYS = [
  ['bookings', 'product_id', 'products', 'id'],
  ['finance_transactions', 'account_id', 'finance_accounts', 'id'],
  ['am_task_assignments', 'template_id', 'am_task_templates', 'id'],
  ['social_media_contents', 'published_task_log_id', 'am_task_logs', 'id'],
  ['volunteer_stays', 'user_id', 'users', 'id'],
  ['cleaning_submissions', 'task_log_id', 'am_task_logs', 'id'],
  ['error_monitoring_occurrences', 'issue_id', 'error_monitoring_issues', 'id'],
];

const migrationsDirectory = path.join(repositoryRoot, 'be', 'dist', 'migrations');
const expectedMigrations = fs.readdirSync(migrationsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => entry.name)
  .sort();

if (expectedMigrations.length === 0) {
  throw new Error('No compiled migrations were found');
}

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
});

try {
  await client.connect();

  const appliedResult = await client.query('SELECT name FROM sequelize_meta ORDER BY name');
  const appliedMigrations = appliedResult.rows.map((row) => String(row.name));
  const appliedSet = new Set(appliedMigrations);
  const expectedSet = new Set(expectedMigrations);
  const missing = expectedMigrations.filter((name) => !appliedSet.has(name));
  const unexpected = appliedMigrations.filter((name) => !expectedSet.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Migration metadata differs from the compiled set: missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}`,
    );
  }

  const runResult = await client.query(`
    SELECT run_id::text, direction, status, finished_at
    FROM migration_audit_runs
    ORDER BY id DESC
    LIMIT 2
  `);
  if (runResult.rows.length !== 2) {
    throw new Error(`Expected exactly two migration audit runs, found ${runResult.rows.length}`);
  }

  const [secondRun, firstRun] = runResult.rows;
  for (const [label, run] of [['first', firstRun], ['second', secondRun]]) {
    if (run.direction !== 'up' || run.status !== 'success' || !run.finished_at) {
      throw new Error(`${label} migration run did not finish successfully`);
    }
  }

  const stepResult = await client.query(`
    SELECT run_id::text, COUNT(*)::integer AS count
    FROM migration_audit_steps
    WHERE run_id = ANY($1::uuid[])
    GROUP BY run_id
  `, [[firstRun.run_id, secondRun.run_id]]);
  const stepCounts = new Map(stepResult.rows.map((row) => [row.run_id, Number(row.count)]));
  const firstRunSteps = stepCounts.get(firstRun.run_id) ?? 0;
  const secondRunSteps = stepCounts.get(secondRun.run_id) ?? 0;

  if (firstRunSteps !== expectedMigrations.length) {
    throw new Error(
      `Fresh migration applied ${firstRunSteps} step(s), expected ${expectedMigrations.length}`,
    );
  }
  if (secondRunSteps !== 0) {
    throw new Error(`Second migration run was not a no-op; it applied ${secondRunSteps} step(s)`);
  }

  const failedStepsResult = await client.query(`
    SELECT COUNT(*)::integer AS count
    FROM migration_audit_steps
    WHERE status <> 'success'
       OR verify_status = 'failed'
  `);
  const failedSteps = Number(failedStepsResult.rows[0]?.count ?? 0);
  if (failedSteps !== 0) {
    throw new Error(`Migration audit contains ${failedSteps} failed step(s)`);
  }

  const tableCountResult = await client.query(`
    SELECT COUNT(*)::integer AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
  `);
  const tableCount = Number(tableCountResult.rows[0]?.count ?? 0);
  const requiredTableNames = Object.keys(REQUIRED_SCHEMA);
  const columnResult = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
  `, [requiredTableNames]);
  const actualColumns = new Map();
  for (const row of columnResult.rows) {
    const columns = actualColumns.get(row.table_name) ?? new Set();
    columns.add(row.column_name);
    actualColumns.set(row.table_name, columns);
  }
  const missingSchema = [];
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
    const columns = actualColumns.get(tableName);
    if (!columns) {
      missingSchema.push(`${tableName} (table)`);
      continue;
    }
    for (const columnName of requiredColumns) {
      if (!columns.has(columnName)) missingSchema.push(`${tableName}.${columnName}`);
    }
  }
  if (missingSchema.length > 0) {
    throw new Error(`Fresh schema is missing required application objects: ${missingSchema.join(', ')}`);
  }

  const indexResult = await client.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
  `, [REQUIRED_INDEXES]);
  const actualIndexes = new Set(indexResult.rows.map((row) => String(row.indexname)));
  const missingIndexes = REQUIRED_INDEXES.filter((indexName) => !actualIndexes.has(indexName));
  if (missingIndexes.length > 0) {
    throw new Error(`Fresh schema is missing required indexes: ${missingIndexes.join(', ')}`);
  }

  const foreignKeyResult = await client.query(`
    SELECT
      source_table.relname AS table_name,
      source_attribute.attname AS column_name,
      target_table.relname AS target_table_name,
      target_attribute.attname AS target_column_name
    FROM pg_constraint constraint_record
    JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid
    JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
    JOIN pg_class target_table ON target_table.oid = constraint_record.confrelid
    JOIN LATERAL unnest(constraint_record.conkey, constraint_record.confkey)
      AS key_pair(source_number, target_number) ON TRUE
    JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = source_table.oid
      AND source_attribute.attnum = key_pair.source_number
    JOIN pg_attribute target_attribute
      ON target_attribute.attrelid = target_table.oid
      AND target_attribute.attnum = key_pair.target_number
    WHERE constraint_record.contype = 'f'
      AND source_namespace.nspname = 'public'
  `);
  const actualForeignKeys = new Set(foreignKeyResult.rows.map((row) => [
    row.table_name,
    row.column_name,
    row.target_table_name,
    row.target_column_name,
  ].join('.')));
  const missingForeignKeys = REQUIRED_FOREIGN_KEYS
    .map((parts) => parts.join('.'))
    .filter((foreignKey) => !actualForeignKeys.has(foreignKey));
  if (missingForeignKeys.length > 0) {
    throw new Error(`Fresh schema is missing required foreign keys: ${missingForeignKeys.join(', ')}`);
  }

  console.log(JSON.stringify({
    status: 'valid',
    migrations: expectedMigrations.length,
    firstRunSteps,
    secondRunSteps,
    publicTables: tableCount,
    requiredTables: requiredTableNames.length,
    requiredIndexes: REQUIRED_INDEXES.length,
    requiredForeignKeys: REQUIRED_FOREIGN_KEYS.length,
  }));
} finally {
  await client.end().catch(() => undefined);
}
