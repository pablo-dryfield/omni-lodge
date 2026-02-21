import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const OPEN_BAR_TABLES = [
  'open_bar_inventory_movements',
  'open_bar_drink_issues',
  'open_bar_delivery_items',
  'open_bar_deliveries',
  'open_bar_recipe_ingredients',
  'open_bar_recipes',
  'open_bar_ingredient_variants',
  'open_bar_ingredients',
  'open_bar_sessions',
  'open_bar_ingredient_categories',
];

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.sequelize.query(
      `TRUNCATE TABLE ${OPEN_BAR_TABLES.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE;`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down(_params: MigrationParams): Promise<void> {
  // No-op: this migration intentionally clears data and cannot restore deleted records.
}

