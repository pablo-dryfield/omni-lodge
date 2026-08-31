import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'volunteer_fund_entries';
const COLUMN = 'finance_counter_transaction_id';
const INDEX = 'volunteer_fund_entries_finance_counter_transaction_uidx';
const PAIR_CONSTRAINT = 'volunteer_fund_entry_allocation_finance_pair_ck';

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.addColumn(
      TABLE,
      COLUMN,
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'finance_transactions', key: 'id' },
        onDelete: 'RESTRICT',
      },
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE ${TABLE}
         ADD CONSTRAINT ${PAIR_CONSTRAINT}
         CHECK (
           (
             entry_type = 'allocation'
             AND (
               (finance_transaction_id IS NULL AND ${COLUMN} IS NULL)
               OR (
                 finance_transaction_id IS NOT NULL
                 AND ${COLUMN} IS NOT NULL
                 AND finance_transaction_id <> ${COLUMN}
               )
             )
           )
           OR (entry_type <> 'allocation' AND ${COLUMN} IS NULL)
         );`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE UNIQUE INDEX ${INDEX}
         ON ${TABLE} (${COLUMN})
       WHERE ${COLUMN} IS NOT NULL;`,
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
    await context.sequelize.query(`DROP INDEX IF EXISTS ${INDEX};`, { transaction });
    await context.sequelize.query(
      `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${PAIR_CONSTRAINT};`,
      { transaction },
    );
    await context.removeColumn(TABLE, COLUMN, { transaction });
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
         SELECT 1
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = '${TABLE}'
            AND column_name = '${COLUMN}'
       ) AS column_exists,
       EXISTS (
         SELECT 1
           FROM pg_constraint
          WHERE conrelid = '${TABLE}'::regclass
            AND conname = '${PAIR_CONSTRAINT}'
       ) AS pair_constraint_exists,
       EXISTS (
         SELECT 1
           FROM pg_constraint constraint_row
           INNER JOIN pg_attribute attribute_row
             ON attribute_row.attrelid = constraint_row.conrelid
            AND attribute_row.attnum = ANY(constraint_row.conkey)
          WHERE constraint_row.conrelid = '${TABLE}'::regclass
            AND constraint_row.contype = 'f'
            AND attribute_row.attname = '${COLUMN}'
            AND constraint_row.confrelid = 'finance_transactions'::regclass
            AND constraint_row.confdeltype = 'r'
       ) AS restricted_foreign_key_exists,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = '${TABLE}'
            AND indexname = '${INDEX}'
            AND indexdef ILIKE '%UNIQUE%'
            AND indexdef ILIKE '%WHERE (finance_counter_transaction_id IS NOT NULL)%'
       ) AS partial_unique_index_exists;`,
  );
  const result = (rows as Array<{
    column_exists?: boolean;
    pair_constraint_exists?: boolean;
    restricted_foreign_key_exists?: boolean;
    partial_unique_index_exists?: boolean;
  }>)[0] ?? {};
  const missing = [
    ...(result.column_exists ? [] : [COLUMN]),
    ...(result.pair_constraint_exists ? [] : [PAIR_CONSTRAINT]),
    ...(result.restricted_foreign_key_exists ? [] : [`${COLUMN} restricted foreign key`]),
    ...(result.partial_unique_index_exists ? [] : [INDEX]),
  ];
  return { ok: missing.length === 0, details: { missing } };
}
