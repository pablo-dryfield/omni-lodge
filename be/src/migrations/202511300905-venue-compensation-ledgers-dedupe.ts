import { QueryInterface, Sequelize } from "sequelize";

const TABLE = "venue_compensation_ledgers";
const UNIQUE_INDEX = "venue_comp_ledgers_unique_range";
const LEGACY_INDEX = "venue_comp_ledgers_range_idx";

export async function up(qi: QueryInterface, _sequelize: typeof Sequelize): Promise<void> {
  await qi.sequelize.transaction(async (transaction) => {
    await qi.sequelize.query(
      `
        WITH ranked AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY venue_id, direction, currency_code, range_start, range_end
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
      // index may not exist yet, ignore
    }

    await qi.addIndex(TABLE, ["venue_id", "direction", "currency_code", "range_start", "range_end"], {
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
      // ignore if already removed
    }

    await qi.addIndex(TABLE, ["venue_id", "direction", "currency_code", "range_start", "range_end"], {
      unique: false,
      name: LEGACY_INDEX,
      transaction,
    });
  });
}
