import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'night_report_venues';
const COLUMN = 'route_index';
const CONSTRAINT = 'night_report_venues_route_positive';
const INDEX = 'night_report_venues_report_route_order_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    const table = await qi.describeTable(TABLE);
    if (!table[COLUMN]) {
      await qi.addColumn(
        TABLE,
        COLUMN,
        {
          type: DataTypes.INTEGER,
          allowNull: false,
          defaultValue: 1,
        },
        { transaction },
      );
    }

    await qi.sequelize.query(
      `
      WITH inferred_routes AS (
        SELECT
          id,
          GREATEST(
            1,
            SUM(CASE WHEN is_open_bar THEN 1 ELSE 0 END)
              OVER (
                PARTITION BY report_id
                ORDER BY order_index
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              )
          ) AS inferred_route_index
        FROM "${TABLE}"
      )
      UPDATE "${TABLE}" AS venue
      SET "${COLUMN}" = inferred_routes.inferred_route_index
      FROM inferred_routes
      WHERE venue.id = inferred_routes.id
      `,
      { transaction },
    );

    await qi.sequelize.query(
      `ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`,
      { transaction },
    );
    await qi.sequelize.query(
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT ${CONSTRAINT} CHECK ("${COLUMN}" > 0)`,
      { transaction },
    );

    await qi.addIndex(TABLE, ['report_id', COLUMN, 'order_index'], {
      name: INDEX,
      transaction,
    }).catch(() => {});

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.removeIndex(TABLE, INDEX, { transaction }).catch(() => {});
    await qi.sequelize.query(
      `ALTER TABLE "${TABLE}" DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`,
      { transaction },
    );
    const table = await qi.describeTable(TABLE);
    if (table[COLUMN]) {
      await qi.removeColumn(TABLE, COLUMN, { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
