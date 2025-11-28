import { QueryInterface, Sequelize } from "sequelize";

const TABLE = "staff_payout_ledgers";
const UNIQUE_INDEX = "staff_payout_ledgers_user_range_unique";
const LEGACY_INDEX = "staff_payout_ledgers_user_range_idx";

export async function up(qi: QueryInterface, _sequelize: typeof Sequelize): Promise<void> {
  await qi.sequelize.transaction(async (transaction) => {
    await qi.sequelize.query(
      `
        WITH ranked AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY staff_user_id, range_start, range_end
              ORDER BY id DESC
            ) AS rn
          FROM ${TABLE}
        )
        DELETE FROM ${TABLE}
        WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
      `,
      { transaction },
    );

    try {
      await qi.removeIndex(TABLE, UNIQUE_INDEX, { transaction });
    } catch {
      // ignore – index may not exist yet
    }

    await qi.addIndex(TABLE, ["staff_user_id", "range_start", "range_end"], {
      unique: true,
      name: UNIQUE_INDEX,
      transaction,
    });
  });
}

export async function down(qi: QueryInterface, _sequelize: typeof Sequelize): Promise<void> {
  await qi.sequelize.transaction(async (transaction) => {
    try {
      await qi.removeIndex(TABLE, UNIQUE_INDEX, { transaction });
    } catch {
      // ignore – index may already be removed
    }

    await qi.addIndex(TABLE, ["staff_user_id", "range_start", "range_end"], {
      unique: false,
      name: LEGACY_INDEX,
      transaction,
    });
  });
}
