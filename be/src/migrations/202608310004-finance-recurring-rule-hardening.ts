import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const RULE_TABLE = 'finance_recurring_rules';
const TRANSACTION_TABLE = 'finance_transactions';
const STATUS_ENUM = 'enum_finance_recurring_rules_status';
const OCCURRENCE_UNIQUE_INDEX = 'finance_transactions_recurring_occurrence_uidx';
const OCCURRENCE_RULE_INDEX = 'finance_transactions_recurring_rule_idx';
const INTERVAL_CONSTRAINT = 'finance_recurring_rules_interval_ck';
const MONTH_DAY_CONSTRAINT = 'finance_recurring_rules_month_day_ck';
const DATE_RANGE_CONSTRAINT = 'finance_recurring_rules_date_range_ck';
const TEMPLATE_CONSTRAINT = 'finance_recurring_rules_template_object_ck';
const TIMEZONE_CONSTRAINT = 'finance_recurring_rules_timezone_ck';
const FAILURE_COUNT_CONSTRAINT = 'finance_recurring_rules_failure_count_ck';
const MIGRATION_KEY = '202608310004-finance-recurring-rule-hardening';

export async function up({ context }: MigrationParams): Promise<void> {
  // PostgreSQL does not allow a freshly added enum value to be used before the
  // transaction that added it commits. Run this statement independently, then
  // perform all dependent schema/data work atomically below.
  await context.sequelize.query(
    `ALTER TYPE "${STATUS_ENUM}" ADD VALUE IF NOT EXISTS 'completed';`,
  );

  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.addColumn(RULE_TABLE, 'completed_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn(RULE_TABLE, 'last_error', {
      type: DataTypes.TEXT,
      allowNull: true,
    }, { transaction });
    await context.addColumn(RULE_TABLE, 'last_error_at', {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    await context.addColumn(RULE_TABLE, 'consecutive_failures', {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    }, { transaction });

    // Preserve every historical row. If legacy automation already created the
    // same logical occurrence more than once, keep the oldest as canonical and
    // void/annotate later rows before introducing the unique identity index.
    await context.sequelize.query(
      `WITH ranked AS (
         SELECT
           id,
           status AS previous_status,
           FIRST_VALUE(id) OVER (
             PARTITION BY meta->>'recurring_rule_id', meta->>'recurring_scheduled_for'
             ORDER BY id ASC
           ) AS canonical_transaction_id,
           ROW_NUMBER() OVER (
             PARTITION BY meta->>'recurring_rule_id', meta->>'recurring_scheduled_for'
             ORDER BY id ASC
           ) AS duplicate_rank
         FROM ${TRANSACTION_TABLE}
         WHERE jsonb_typeof(meta) = 'object'
           AND meta ? 'recurring_rule_id'
           AND meta ? 'recurring_scheduled_for'
       ), reconciled AS (
         UPDATE ${TRANSACTION_TABLE} AS finance_transaction
            SET status = 'void',
                meta = COALESCE(finance_transaction.meta, '{}'::jsonb)
                  || jsonb_build_object(
                    'recurring_duplicate', true,
                    'recurring_duplicate_of_transaction_id', ranked.canonical_transaction_id,
                    'recurring_duplicate_reconciled_by', '${MIGRATION_KEY}'
                  ),
                updated_at = NOW()
           FROM ranked
          WHERE finance_transaction.id = ranked.id
            AND ranked.duplicate_rank > 1
         RETURNING
           finance_transaction.id,
           ranked.canonical_transaction_id,
           ranked.previous_status
       )
       INSERT INTO finance_audit_logs (
         entity,
         entity_id,
         action,
         changes,
         metadata,
         performed_by,
         occurred_at
       )
       SELECT
         'finance_transaction',
         id,
         'migration_deduplicate',
         jsonb_build_object('status', jsonb_build_object('before', previous_status, 'after', 'void')),
         jsonb_build_object(
           'migration', '${MIGRATION_KEY}',
           'canonicalTransactionId', canonical_transaction_id,
           'reason', 'Duplicate recurring occurrence identity'
         ),
         NULL,
         NOW()
       FROM reconciled;`,
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE ${RULE_TABLE}
         ADD CONSTRAINT ${INTERVAL_CONSTRAINT}
         CHECK ("interval" BETWEEN 1 AND 365) NOT VALID,
         ADD CONSTRAINT ${MONTH_DAY_CONSTRAINT}
         CHECK (by_month_day IS NULL OR by_month_day BETWEEN 1 AND 31) NOT VALID,
         ADD CONSTRAINT ${DATE_RANGE_CONSTRAINT}
         CHECK (end_date IS NULL OR end_date >= start_date) NOT VALID,
         ADD CONSTRAINT ${TEMPLATE_CONSTRAINT}
         CHECK (jsonb_typeof(template_json) = 'object') NOT VALID,
         ADD CONSTRAINT ${TIMEZONE_CONSTRAINT}
         CHECK (length(btrim(timezone)) BETWEEN 1 AND 64) NOT VALID,
         ADD CONSTRAINT ${FAILURE_COUNT_CONSTRAINT}
         CHECK (consecutive_failures >= 0) NOT VALID;`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE UNIQUE INDEX ${OCCURRENCE_UNIQUE_INDEX}
         ON ${TRANSACTION_TABLE} (
           (jsonb_extract_path_text(meta, 'recurring_rule_id')),
           (jsonb_extract_path_text(meta, 'recurring_scheduled_for'))
         )
       WHERE jsonb_typeof(meta) = 'object'
         AND meta ? 'recurring_rule_id'
         AND meta ? 'recurring_scheduled_for'
         AND COALESCE(meta->>'recurring_duplicate', 'false') <> 'true';`,
      { transaction },
    );
    await context.sequelize.query(
      `CREATE INDEX ${OCCURRENCE_RULE_INDEX}
         ON ${TRANSACTION_TABLE} ((jsonb_extract_path_text(meta, 'recurring_rule_id')));`,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(`DROP INDEX IF EXISTS ${OCCURRENCE_RULE_INDEX};`, { transaction });
    await context.sequelize.query(`DROP INDEX IF EXISTS ${OCCURRENCE_UNIQUE_INDEX};`, { transaction });
    await context.sequelize.query(
      `WITH reconciliation AS (
         SELECT DISTINCT ON (entity_id)
           entity_id,
           changes #>> '{status,before}' AS previous_status
         FROM finance_audit_logs
         WHERE entity = 'finance_transaction'
           AND action = 'migration_deduplicate'
           AND metadata->>'migration' = '${MIGRATION_KEY}'
         ORDER BY entity_id, occurred_at DESC, id DESC
       )
       UPDATE ${TRANSACTION_TABLE} AS finance_transaction
          SET status = reconciliation.previous_status::"enum_finance_transactions_status",
              meta = finance_transaction.meta
                - 'recurring_duplicate'
                - 'recurring_duplicate_of_transaction_id'
                - 'recurring_duplicate_reconciled_by',
              updated_at = NOW()
         FROM reconciliation
        WHERE finance_transaction.id = reconciliation.entity_id
          AND reconciliation.previous_status IS NOT NULL;

       DELETE FROM finance_audit_logs
        WHERE entity = 'finance_transaction'
          AND action = 'migration_deduplicate'
          AND metadata->>'migration' = '${MIGRATION_KEY}';`,
      { transaction },
    );
    for (const constraint of [
      INTERVAL_CONSTRAINT,
      MONTH_DAY_CONSTRAINT,
      DATE_RANGE_CONSTRAINT,
      TEMPLATE_CONSTRAINT,
      TIMEZONE_CONSTRAINT,
      FAILURE_COUNT_CONSTRAINT,
    ]) {
      await context.sequelize.query(
        `ALTER TABLE ${RULE_TABLE} DROP CONSTRAINT IF EXISTS ${constraint};`,
        { transaction },
      );
    }

    // PostgreSQL enum labels cannot be safely removed in place. Map completed
    // rows back to paused so an older application remains compatible, and leave
    // the harmless extra enum label available rather than rebuilding the type.
    await context.sequelize.query(
      `UPDATE ${RULE_TABLE} SET status = 'paused' WHERE status = 'completed';`,
      { transaction },
    );
    await context.removeColumn(RULE_TABLE, 'consecutive_failures', { transaction });
    await context.removeColumn(RULE_TABLE, 'last_error_at', { transaction });
    await context.removeColumn(RULE_TABLE, 'last_error', { transaction });
    await context.removeColumn(RULE_TABLE, 'completed_at', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function verify({ context }: MigrationParams): Promise<{ ok: boolean; details: unknown }> {
  const [rows] = await context.sequelize.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM pg_enum enum_value
         INNER JOIN pg_type enum_type ON enum_type.oid = enum_value.enumtypid
         WHERE enum_type.typname = '${STATUS_ENUM}' AND enum_value.enumlabel = 'completed'
       ) AS completed_status_exists,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = '${RULE_TABLE}' AND column_name = 'completed_at'
       ) AS completed_at_exists,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = '${RULE_TABLE}' AND column_name = 'last_error'
       ) AS last_error_exists,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = '${RULE_TABLE}' AND column_name = 'last_error_at'
       ) AS last_error_at_exists,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = '${RULE_TABLE}' AND column_name = 'consecutive_failures'
       ) AS consecutive_failures_exists,
       EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = '${TRANSACTION_TABLE}'
           AND indexname = '${OCCURRENCE_UNIQUE_INDEX}'
           AND indexdef ILIKE '%UNIQUE%'
           AND indexdef ILIKE '%recurring_rule_id%'
           AND indexdef ILIKE '%recurring_scheduled_for%'
       ) AS occurrence_index_exists,
       EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND tablename = '${TRANSACTION_TABLE}'
           AND indexname = '${OCCURRENCE_RULE_INDEX}'
           AND indexdef ILIKE '%recurring_rule_id%'
       ) AS occurrence_rule_index_exists,
       (
         SELECT COUNT(*) = 6
         FROM pg_constraint
         WHERE conrelid = '${RULE_TABLE}'::regclass
           AND conname IN (
             '${INTERVAL_CONSTRAINT}',
             '${MONTH_DAY_CONSTRAINT}',
             '${DATE_RANGE_CONSTRAINT}',
             '${TEMPLATE_CONSTRAINT}',
             '${TIMEZONE_CONSTRAINT}',
             '${FAILURE_COUNT_CONSTRAINT}'
           )
       ) AS constraints_exist;`,
  );
  const result = (rows as Array<Record<string, boolean>>)[0] ?? {};
  const missing = Object.entries(result)
    .filter(([, exists]) => !exists)
    .map(([name]) => name);
  return { ok: missing.length === 0, details: { missing } };
}
