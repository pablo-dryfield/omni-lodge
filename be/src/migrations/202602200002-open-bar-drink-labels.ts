import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_SETTINGS = 'open_bar_drink_label_settings';
const TABLE_RECIPES = 'open_bar_recipes';
const TABLE_ISSUES = 'open_bar_drink_issues';
const UNIQUE_DRINK_TYPE = 'open_bar_drink_label_settings_drink_type_uq';

const DRINK_TYPES = ['classic', 'cocktail', 'beer', 'soft', 'custom'] as const;
const DISPLAY_MODES = ['recipe_name', 'recipe_with_ingredients', 'ingredients_only'] as const;

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TABLE_SETTINGS,
      {
        id: {
          type: DataTypes.INTEGER,
          autoIncrement: true,
          primaryKey: true,
        },
        drink_type: {
          type: DataTypes.ENUM(...DRINK_TYPES),
          allowNull: false,
        },
        display_mode: {
          type: DataTypes.ENUM(...DISPLAY_MODES),
          allowNull: false,
          defaultValue: 'recipe_name',
        },
        created_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        updated_by: {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updated_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addConstraint(TABLE_SETTINGS, {
      type: 'unique',
      name: UNIQUE_DRINK_TYPE,
      fields: ['drink_type'],
      transaction,
    });

    await qi.addColumn(
      TABLE_RECIPES,
      'label_display_mode',
      {
        type: DataTypes.ENUM(...DISPLAY_MODES),
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE_ISSUES,
      'display_name_snapshot',
      {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      { transaction },
    );

    const defaults = [
      { drinkType: 'classic', displayMode: 'recipe_with_ingredients' },
      { drinkType: 'cocktail', displayMode: 'recipe_name' },
      { drinkType: 'beer', displayMode: 'recipe_name' },
      { drinkType: 'soft', displayMode: 'recipe_name' },
      { drinkType: 'custom', displayMode: 'recipe_name' },
    ] as const;

    for (const row of defaults) {
      await qi.sequelize.query(
        `
        INSERT INTO ${TABLE_SETTINGS}
          (drink_type, display_mode, created_at, updated_at)
        VALUES
          (:drinkType, :displayMode, NOW(), NOW())
        ON CONFLICT (drink_type)
        DO UPDATE SET
          display_mode = EXCLUDED.display_mode,
          updated_at = NOW();
        `,
        { transaction, replacements: row },
      );
    }

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
    await qi.removeColumn(TABLE_ISSUES, 'display_name_snapshot', { transaction }).catch(() => {});
    await qi.removeColumn(TABLE_RECIPES, 'label_display_mode', { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE_SETTINGS, UNIQUE_DRINK_TYPE, { transaction }).catch(() => {});
    await qi.dropTable(TABLE_SETTINGS, { transaction }).catch(() => {});
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
