import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_RECIPE_INGREDIENTS = 'open_bar_recipe_ingredients';
const CHECK_TOP_UP = 'open_bar_recipe_ingredients_top_up_chk';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.addColumn(
      TABLE_RECIPE_INGREDIENTS,
      'is_top_up',
      {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_RECIPE_INGREDIENTS}
      ADD CONSTRAINT ${CHECK_TOP_UP}
      CHECK (NOT is_top_up OR line_type = 'category_selector');
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
    await qi.removeConstraint(TABLE_RECIPE_INGREDIENTS, CHECK_TOP_UP, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_RECIPE_INGREDIENTS, 'is_top_up', { transaction }).catch(() => {});
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
