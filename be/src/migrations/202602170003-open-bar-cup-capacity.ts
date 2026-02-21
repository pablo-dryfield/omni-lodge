import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_INGREDIENTS = 'open_bar_ingredients';
const CUP_CAPACITY_CHECK = 'open_bar_ingredients_cup_capacity_chk';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.addColumn(
      TABLE_INGREDIENTS,
      'cup_capacity_ml',
      {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: true,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ADD CONSTRAINT ${CUP_CAPACITY_CHECK}
      CHECK (
        (is_cup = false AND cup_capacity_ml IS NULL)
        OR
        (is_cup = true AND (cup_capacity_ml IS NULL OR cup_capacity_ml > 0))
      );
      `,
      { transaction },
    );

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
    await qi.removeConstraint(TABLE_INGREDIENTS, CUP_CAPACITY_CHECK, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_INGREDIENTS, 'cup_capacity_ml', { transaction }).catch(() => {});
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
