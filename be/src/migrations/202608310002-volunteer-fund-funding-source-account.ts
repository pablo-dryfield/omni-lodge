import { DataTypes, type QueryInterface, type Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'volunteer_funds';
const COLUMN = 'funding_source_account_id';
const INDEX = 'volunteer_funds_funding_source_account_idx';
const DISTINCT_ACCOUNTS_CONSTRAINT = 'volunteer_funds_distinct_finance_accounts_ck';

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.addColumn(
      TABLE,
      COLUMN,
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'finance_accounts', key: 'id' },
        onDelete: 'RESTRICT',
      },
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE ${TABLE}
         ADD CONSTRAINT ${DISTINCT_ACCOUNTS_CONSTRAINT}
         CHECK (
           ${COLUMN} IS NULL
           OR linked_account_id IS NULL
           OR ${COLUMN} <> linked_account_id
         );`,
      { transaction },
    );

    await context.addIndex(TABLE, [COLUMN], { name: INDEX, transaction });

    // Existing PLN funds can be activated immediately only when the intended source is unambiguous.
    await context.sequelize.query(
      `WITH source_candidates AS (
         SELECT
           fund.id AS fund_id,
           MIN(account.id) AS account_id
         FROM ${TABLE} fund
         INNER JOIN finance_accounts account
           ON account.is_active = TRUE
          AND account.type = 'cash'
          AND UPPER(account.currency) = UPPER(fund.currency)
          AND regexp_replace(LOWER(BTRIM(account.name)), '[^a-z0-9]+', '', 'g') = 'cashregisterpln'
          AND account.id IS DISTINCT FROM fund.linked_account_id
         WHERE fund.${COLUMN} IS NULL
           AND fund.is_active = TRUE
         GROUP BY fund.id
         HAVING COUNT(*) = 1
       )
       UPDATE ${TABLE} fund
          SET ${COLUMN} = source.account_id,
              updated_at = NOW()
         FROM source_candidates source
        WHERE fund.id = source.fund_id;`,
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
    await context.removeIndex(TABLE, INDEX, { transaction });
    await context.sequelize.query(
      `ALTER TABLE ${TABLE}
         DROP CONSTRAINT IF EXISTS ${DISTINCT_ACCOUNTS_CONSTRAINT};`,
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
            AND conname = '${DISTINCT_ACCOUNTS_CONSTRAINT}'
       ) AS distinct_constraint_exists,
       EXISTS (
         SELECT 1
           FROM pg_constraint constraint_row
           INNER JOIN pg_attribute attribute_row
             ON attribute_row.attrelid = constraint_row.conrelid
            AND attribute_row.attnum = ANY(constraint_row.conkey)
          WHERE constraint_row.conrelid = '${TABLE}'::regclass
            AND constraint_row.contype = 'f'
            AND attribute_row.attname = '${COLUMN}'
            AND constraint_row.confrelid = 'finance_accounts'::regclass
       ) AS foreign_key_exists,
       EXISTS (
         SELECT 1
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = '${TABLE}'
            AND indexname = '${INDEX}'
       ) AS index_exists;`,
  );
  const result = (rows as Array<{
    column_exists?: boolean;
    distinct_constraint_exists?: boolean;
    foreign_key_exists?: boolean;
    index_exists?: boolean;
  }>)[0] ?? {};
  const missing = [
    ...(result.column_exists ? [] : [COLUMN]),
    ...(result.distinct_constraint_exists ? [] : [DISTINCT_ACCOUNTS_CONSTRAINT]),
    ...(result.foreign_key_exists ? [] : [`${COLUMN} foreign key`]),
    ...(result.index_exists ? [] : [INDEX]),
  ];
  return { ok: missing.length === 0, details: { missing } };
}
