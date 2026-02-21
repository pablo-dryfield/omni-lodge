import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_RECIPES = 'open_bar_recipes';
const TABLE_RECIPE_INGREDIENTS = 'open_bar_recipe_ingredients';
const TABLE_CATEGORIES = 'open_bar_ingredient_categories';
const LINE_TYPE_ENUM = 'enum_open_bar_recipe_ingredients_line_type';
const FK_CATEGORY = 'open_bar_recipe_ingredients_category_id_fkey';
const CHECK_LINE_REF = 'open_bar_recipe_ingredients_line_ref_chk';
const INDEX_CATEGORY = 'open_bar_recipe_ingredients_category_idx';
const INDEX_LINE_TYPE = 'open_bar_recipe_ingredients_line_type_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.addColumn(
      TABLE_RECIPES,
      'ask_strength',
      {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      { transaction },
    );

    await qi.sequelize.query(
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'enum_open_bar_recipe_ingredients_line_type'
        ) THEN
          CREATE TYPE ${LINE_TYPE_ENUM} AS ENUM ('fixed_ingredient', 'category_selector');
        END IF;
      END $$;
      `,
      { transaction },
    );

    await qi.addColumn(
      TABLE_RECIPE_INGREDIENTS,
      'line_type',
      {
        type: DataTypes.ENUM('fixed_ingredient', 'category_selector'),
        allowNull: false,
        defaultValue: 'fixed_ingredient',
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_RECIPE_INGREDIENTS,
      'category_id',
      {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: TABLE_CATEGORIES, key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_RECIPE_INGREDIENTS,
      'affects_strength',
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
      ALTER COLUMN ingredient_id DROP NOT NULL;
      `,
      { transaction },
    );

    await qi.addIndex(TABLE_RECIPE_INGREDIENTS, ['category_id'], {
      name: INDEX_CATEGORY,
      transaction,
    });

    await qi.addIndex(TABLE_RECIPE_INGREDIENTS, ['line_type'], {
      name: INDEX_LINE_TYPE,
      transaction,
    });

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_RECIPE_INGREDIENTS}
      ADD CONSTRAINT ${CHECK_LINE_REF}
      CHECK (
        (line_type = 'fixed_ingredient' AND ingredient_id IS NOT NULL AND category_id IS NULL)
        OR
        (line_type = 'category_selector' AND category_id IS NOT NULL AND ingredient_id IS NULL)
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
    await qi.removeConstraint(TABLE_RECIPE_INGREDIENTS, CHECK_LINE_REF, { transaction }).catch(() => {});
    await qi.removeIndex(TABLE_RECIPE_INGREDIENTS, INDEX_LINE_TYPE, { transaction }).catch(() => {});
    await qi.removeIndex(TABLE_RECIPE_INGREDIENTS, INDEX_CATEGORY, { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE_RECIPE_INGREDIENTS, FK_CATEGORY, { transaction }).catch(() => {});

    await qi.sequelize.query(
      `
      DELETE FROM ${TABLE_RECIPE_INGREDIENTS}
      WHERE line_type = 'category_selector';
      `,
      { transaction },
    );

    await qi.removeColumn(TABLE_RECIPE_INGREDIENTS, 'affects_strength', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_RECIPE_INGREDIENTS, 'category_id', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_RECIPE_INGREDIENTS, 'line_type', { transaction }).catch(() => {});

    await qi.sequelize.query(
      `
      ALTER TABLE ${TABLE_RECIPE_INGREDIENTS}
      ALTER COLUMN ingredient_id SET NOT NULL;
      `,
      { transaction },
    );

    await qi.removeColumn(TABLE_RECIPES, 'ask_strength', { transaction }).catch(() => {});

    await qi.sequelize.query(
      `
      DROP TYPE IF EXISTS ${LINE_TYPE_ENUM};
      `,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
