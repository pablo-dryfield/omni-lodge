import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const ISSUE_TABLE = 'error_monitoring_issues';
const OCCURRENCE_TABLE = 'error_monitoring_occurrences';
const NOTE_TABLE = 'error_monitoring_notes';
const AFFECTED_USER_TABLE = 'error_monitoring_affected_users';
const REQUIRED_INDEXES = [
  'error_monitoring_issues_fingerprint_key',
  'error_monitoring_issues_status_last_seen_idx',
  'error_monitoring_issues_severity_last_seen_idx',
  'error_monitoring_issues_source_kind_idx',
  'error_monitoring_issues_assignee_status_idx',
  'error_monitoring_occurrences_event_id_key',
  'error_monitoring_occurrences_issue_occurred_idx',
  'error_monitoring_occurrences_occurred_idx',
  'error_monitoring_occurrences_user_occurred_idx',
  'error_monitoring_occurrences_client_event_key',
  'error_monitoring_occurrences_request_id_idx',
  'error_monitoring_notes_issue_created_idx',
  'error_monitoring_affected_users_user_issue_idx',
] as const;
const REQUIRED_CONSTRAINTS = [
  { table: ISSUE_TABLE, name: 'error_monitoring_issues_source_ck' },
  { table: ISSUE_TABLE, name: 'error_monitoring_issues_severity_ck' },
  { table: ISSUE_TABLE, name: 'error_monitoring_issues_status_ck' },
  { table: ISSUE_TABLE, name: 'error_monitoring_issues_counts_ck' },
  { table: OCCURRENCE_TABLE, name: 'error_monitoring_occurrences_source_ck' },
  { table: OCCURRENCE_TABLE, name: 'error_monitoring_occurrences_level_ck' },
  { table: OCCURRENCE_TABLE, name: 'error_monitoring_occurrences_http_status_ck' },
  { table: OCCURRENCE_TABLE, name: 'error_monitoring_occurrences_duration_ck' },
  { table: OCCURRENCE_TABLE, name: 'error_monitoring_occurrences_event_count_ck' },
  { table: NOTE_TABLE, name: 'error_monitoring_notes_body_ck' },
] as const;

const INDEX_DEFINITIONS = [
  `CREATE UNIQUE INDEX IF NOT EXISTS error_monitoring_issues_fingerprint_key
     ON ${ISSUE_TABLE} (fingerprint);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_issues_status_last_seen_idx
     ON ${ISSUE_TABLE} (status, last_seen_at);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_issues_severity_last_seen_idx
     ON ${ISSUE_TABLE} (severity, last_seen_at);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_issues_source_kind_idx
     ON ${ISSUE_TABLE} (source, kind, last_seen_at);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_issues_assignee_status_idx
     ON ${ISSUE_TABLE} (assigned_to_user_id, status);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS error_monitoring_occurrences_event_id_key
     ON ${OCCURRENCE_TABLE} (event_id);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_occurrences_issue_occurred_idx
     ON ${OCCURRENCE_TABLE} (issue_id, occurred_at);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_occurrences_occurred_idx
     ON ${OCCURRENCE_TABLE} (occurred_at);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_occurrences_user_occurred_idx
     ON ${OCCURRENCE_TABLE} (user_id, occurred_at);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS error_monitoring_occurrences_client_event_key
     ON ${OCCURRENCE_TABLE} (client_event_id) WHERE client_event_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_occurrences_request_id_idx
     ON ${OCCURRENCE_TABLE} (request_id);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_notes_issue_created_idx
     ON ${NOTE_TABLE} (issue_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS error_monitoring_affected_users_user_issue_idx
     ON ${AFFECTED_USER_TABLE} (user_id, issue_id);`,
] as const;

const addCheckConstraintsIdempotently = async (
  context: QueryInterface,
  transaction: Transaction,
  table: string,
  constraints: ReadonlyArray<{ name: string; expression: string }>,
): Promise<void> => {
  const clauses = constraints.map(({ name, expression }) => `
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint constraint_record
       WHERE constraint_record.conname = '${name}'
         AND constraint_record.conrelid = 'public.${table}'::regclass
    ) THEN
      ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression});
    END IF;`).join('');
  await context.sequelize.query(`DO $error_monitoring_constraints$
  BEGIN${clauses}
  END
  $error_monitoring_constraints$;`, { transaction });
};

const addIndexesIdempotently = async (
  context: QueryInterface,
  transaction: Transaction,
): Promise<void> => {
  for (const definition of INDEX_DEFINITIONS) {
    await context.sequelize.query(definition, { transaction });
  }
};

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.createTable(ISSUE_TABLE, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      fingerprint: { type: DataTypes.STRING(64), allowNull: false },
      source: { type: DataTypes.STRING(24), allowNull: false },
      kind: { type: DataTypes.STRING(64), allowNull: false },
      title: { type: DataTypes.STRING(500), allowNull: false },
      normalized_message: { type: DataTypes.TEXT, allowNull: false },
      culprit: { type: DataTypes.STRING(500), allowNull: true },
      severity: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'error' },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open' },
      first_seen_at: { type: DataTypes.DATE, allowNull: false },
      last_seen_at: { type: DataTypes.DATE, allowNull: false },
      occurrence_count: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 1 },
      affected_user_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      reopened_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_regressed_at: { type: DataTypes.DATE, allowNull: true },
      last_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      last_route: { type: DataTypes.STRING(500), allowNull: true },
      last_page_url: { type: DataTypes.TEXT, allowNull: true },
      last_release: { type: DataTypes.STRING(120), allowNull: true },
      last_environment: { type: DataTypes.STRING(50), allowNull: true },
      assigned_to_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status_changed_at: { type: DataTypes.DATE, allowNull: true },
      status_changed_by_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      resolved_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });

    await context.createTable(OCCURRENCE_TABLE, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      event_id: { type: DataTypes.UUID, allowNull: false },
      client_event_id: { type: DataTypes.STRING(128), allowNull: true },
      issue_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: ISSUE_TABLE, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      source: { type: DataTypes.STRING(24), allowNull: false },
      kind: { type: DataTypes.STRING(64), allowNull: false },
      level: { type: DataTypes.STRING(16), allowNull: false },
      event_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      error_name: { type: DataTypes.STRING(160), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      stack: { type: DataTypes.TEXT, allowNull: true },
      component_stack: { type: DataTypes.TEXT, allowNull: true },
      occurred_at: { type: DataTypes.DATE, allowNull: false },
      received_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      session_id_hash: { type: DataTypes.STRING(64), allowNull: true },
      request_id: { type: DataTypes.STRING(100), allowNull: true },
      http_method: { type: DataTypes.STRING(12), allowNull: true },
      http_url_path: { type: DataTypes.TEXT, allowNull: true },
      http_status: { type: DataTypes.INTEGER, allowNull: true },
      duration_ms: { type: DataTypes.DECIMAL(12, 3), allowNull: true },
      response_size_bytes: { type: DataTypes.BIGINT, allowNull: true },
      page_url_path: { type: DataTypes.TEXT, allowNull: true },
      route: { type: DataTypes.STRING(500), allowNull: true },
      release: { type: DataTypes.STRING(120), allowNull: true },
      environment: { type: DataTypes.STRING(50), allowNull: true },
      user_agent: { type: DataTypes.STRING(1000), allowNull: true },
      ip_hash: { type: DataTypes.STRING(64), allowNull: true },
      context_json: { type: DataTypes.JSONB, allowNull: true },
      tags_json: { type: DataTypes.JSONB, allowNull: true },
      breadcrumbs_json: { type: DataTypes.JSONB, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });

    await context.createTable(NOTE_TABLE, {
      id: { type: DataTypes.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      issue_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: ISSUE_TABLE, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      author_user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      body: { type: DataTypes.TEXT, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, { transaction });

    await context.createTable(AFFECTED_USER_TABLE, {
      issue_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        references: { model: ISSUE_TABLE, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      first_seen_at: { type: DataTypes.DATE, allowNull: false },
      last_seen_at: { type: DataTypes.DATE, allowNull: false },
    }, { transaction });

    // The migration runner commits `up` before its post-run verification. These
    // guards make a retry safe if verification or audit recording fails after
    // the schema transaction was already committed.
    await addCheckConstraintsIdempotently(context, transaction, ISSUE_TABLE, [
      { name: 'error_monitoring_issues_source_ck', expression: "source IN ('client', 'server', 'request', 'process')" },
      { name: 'error_monitoring_issues_severity_ck', expression: "severity IN ('warning', 'error', 'fatal')" },
      { name: 'error_monitoring_issues_status_ck', expression: "status IN ('open', 'investigating', 'resolved', 'ignored')" },
      {
        name: 'error_monitoring_issues_counts_ck',
        expression: 'occurrence_count >= 1 AND affected_user_count >= 0 AND reopened_count >= 0',
      },
    ]);
    await addCheckConstraintsIdempotently(context, transaction, OCCURRENCE_TABLE, [
      { name: 'error_monitoring_occurrences_source_ck', expression: "source IN ('client', 'server', 'request', 'process')" },
      { name: 'error_monitoring_occurrences_level_ck', expression: "level IN ('warning', 'error', 'fatal')" },
      {
        name: 'error_monitoring_occurrences_http_status_ck',
        expression: 'http_status IS NULL OR (http_status >= 100 AND http_status <= 599)',
      },
      { name: 'error_monitoring_occurrences_duration_ck', expression: 'duration_ms IS NULL OR duration_ms >= 0' },
      { name: 'error_monitoring_occurrences_event_count_ck', expression: 'event_count BETWEEN 1 AND 1000' },
    ]);
    await addCheckConstraintsIdempotently(context, transaction, NOTE_TABLE, [
      { name: 'error_monitoring_notes_body_ck', expression: 'length(btrim(body)) BETWEEN 1 AND 4000' },
    ]);

    await addIndexesIdempotently(context, transaction);

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.dropTable(AFFECTED_USER_TABLE, { transaction });
    await context.dropTable(NOTE_TABLE, { transaction });
    await context.dropTable(OCCURRENCE_TABLE, { transaction });
    await context.dropTable(ISSUE_TABLE, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const required: Record<string, readonly string[]> = {
    [ISSUE_TABLE]: [
      'fingerprint',
      'status',
      'severity',
      'occurrence_count',
      'affected_user_count',
      'last_regressed_at',
    ],
    [OCCURRENCE_TABLE]: ['event_id', 'issue_id', 'event_count', 'message', 'occurred_at', 'context_json'],
    [NOTE_TABLE]: ['issue_id', 'author_user_id', 'body'],
    [AFFECTED_USER_TABLE]: ['issue_id', 'user_id', 'first_seen_at', 'last_seen_at'],
  };
  const missing: Record<string, string[]> = {};

  for (const [table, columns] of Object.entries(required)) {
    try {
      const description = await context.describeTable(table);
      const absent = columns.filter((column) => !Object.prototype.hasOwnProperty.call(description, column));
      if (absent.length > 0) missing[table] = absent;
    } catch {
      missing[table] = [...columns];
    }
  }

  const [indexRows] = await context.sequelize.query(
    `SELECT index_record.relname AS indexname
       FROM pg_class index_record
       JOIN pg_index index_metadata ON index_metadata.indexrelid = index_record.oid
       JOIN pg_class table_record ON table_record.oid = index_metadata.indrelid
       JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      WHERE namespace_record.nspname = 'public'
        AND index_metadata.indisvalid = TRUE
        AND index_metadata.indisready = TRUE
        AND index_record.relname IN (${REQUIRED_INDEXES.map((name) => `'${name}'`).join(', ')})
        AND (index_record.relname NOT IN (
          'error_monitoring_issues_fingerprint_key',
          'error_monitoring_occurrences_event_id_key',
          'error_monitoring_occurrences_client_event_key'
        ) OR index_metadata.indisunique = TRUE)
        AND (index_record.relname <> 'error_monitoring_occurrences_client_event_key'
          OR index_metadata.indpred IS NOT NULL);`,
  );
  const existingIndexes = new Set(
    (indexRows as Array<{ indexname: string }>).map((row) => row.indexname),
  );
  const missingIndexes = REQUIRED_INDEXES.filter((index) => !existingIndexes.has(index));

  const [constraintRows] = await context.sequelize.query(
    `SELECT table_record.relname AS table_name,
            constraint_record.conname AS constraint_name
       FROM pg_constraint constraint_record
       JOIN pg_class table_record ON table_record.oid = constraint_record.conrelid
       JOIN pg_namespace namespace_record ON namespace_record.oid = table_record.relnamespace
      WHERE namespace_record.nspname = 'public'
        AND constraint_record.contype = 'c'
        AND constraint_record.convalidated = TRUE
        AND (table_record.relname, constraint_record.conname) IN (VALUES
          ${REQUIRED_CONSTRAINTS
    .map(({ table, name }) => `('${table}', '${name}')`)
    .join(',\n          ')}
        );`,
  );
  const existingConstraints = new Set(
    (constraintRows as Array<{ table_name: string; constraint_name: string }>)
      .map((row) => `${row.table_name}.${row.constraint_name}`),
  );
  const missingConstraints = REQUIRED_CONSTRAINTS
    .filter(({ table, name }) => !existingConstraints.has(`${table}.${name}`))
    .map(({ name }) => name);

  return {
    ok: Object.keys(missing).length === 0
      && missingIndexes.length === 0
      && missingConstraints.length === 0,
    details: { missing, missingIndexes, missingConstraints },
  };
}
