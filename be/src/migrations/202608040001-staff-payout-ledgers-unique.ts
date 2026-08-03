import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'staff_payout_ledgers';
const UNIQUE_INDEX = 'staff_payout_ledgers_user_range_unique';

export async function up({ context: queryInterface }: MigrationParams): Promise<void> {
  await queryInterface.sequelize.transaction(async (transaction) => {
    await queryInterface.sequelize.query(
      `
        WITH ranked AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY staff_user_id, range_start, range_end
              ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
            ) AS row_number
          FROM ${TABLE}
        )
        DELETE FROM ${TABLE}
        WHERE id IN (SELECT id FROM ranked WHERE row_number > 1)
      `,
      { transaction },
    );
    await queryInterface.sequelize.query(
      `
        CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX}
        ON ${TABLE} (staff_user_id, range_start, range_end)
      `,
      { transaction },
    );
  });
}

export async function down({ context: queryInterface }: MigrationParams): Promise<void> {
  await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${UNIQUE_INDEX}`);
}
