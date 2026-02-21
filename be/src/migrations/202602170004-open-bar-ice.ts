import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_INGREDIENTS = 'open_bar_ingredients';
const TABLE_RECIPES = 'open_bar_recipes';
const INGREDIENTS_CUP_ICE_CHECK = 'open_bar_ingredients_cup_ice_chk';
const RECIPES_ICE_CUBES_CHECK = 'open_bar_recipes_ice_cubes_chk';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.addColumn(
      TABLE_INGREDIENTS,
      'is_ice',
      {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ADD CONSTRAINT ${INGREDIENTS_CUP_ICE_CHECK}
      CHECK (NOT (is_cup = true AND is_ice = true));
      `,
      { transaction },
    );

    await qi.addColumn(
      TABLE_RECIPES,
      'has_ice',
      {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_RECIPES,
      'ice_cubes',
      {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_RECIPES}
      ADD CONSTRAINT ${RECIPES_ICE_CUBES_CHECK}
      CHECK (ice_cubes >= 0);
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
    await qi.removeConstraint(TABLE_RECIPES, RECIPES_ICE_CUBES_CHECK, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_RECIPES, 'ice_cubes', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_RECIPES, 'has_ice', { transaction }).catch(() => {});

    await qi.removeConstraint(TABLE_INGREDIENTS, INGREDIENTS_CUP_ICE_CHECK, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_INGREDIENTS, 'is_ice', { transaction }).catch(() => {});

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
