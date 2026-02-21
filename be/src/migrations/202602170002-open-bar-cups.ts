import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_INGREDIENTS = 'open_bar_ingredients';
const TABLE_RECIPES = 'open_bar_recipes';
const CUP_CHECK = 'open_bar_ingredients_cup_type_chk';
const CUP_INDEX = 'open_bar_recipes_cup_ingredient_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.addColumn(
      TABLE_INGREDIENTS,
      'is_cup',
      {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_INGREDIENTS,
      'cup_type',
      {
        type: DataTypes.ENUM('disposable', 'reusable'),
        allowNull: true,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_INGREDIENTS}
      ADD CONSTRAINT ${CUP_CHECK}
      CHECK (
        (is_cup = false AND cup_type IS NULL)
        OR
        (is_cup = true AND cup_type IN ('disposable', 'reusable'))
      );
      `,
      { transaction },
    );

    await qi.addColumn(
      TABLE_RECIPES,
      'cup_ingredient_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: TABLE_INGREDIENTS, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      { transaction },
    );

    await qi.addIndex(TABLE_RECIPES, ['cup_ingredient_id'], {
      name: CUP_INDEX,
      transaction,
    });

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
    await qi.removeIndex(TABLE_RECIPES, CUP_INDEX, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_RECIPES, 'cup_ingredient_id', { transaction }).catch(() => {});

    await qi.removeConstraint(TABLE_INGREDIENTS, CUP_CHECK, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_INGREDIENTS, 'cup_type', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_INGREDIENTS, 'is_cup', { transaction }).catch(() => {});

    await qi.sequelize.query(
      `
      DROP TYPE IF EXISTS "enum_open_bar_ingredients_cup_type";
      `,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
