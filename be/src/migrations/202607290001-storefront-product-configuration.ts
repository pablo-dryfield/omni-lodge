import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn('products', 'storefront_config', {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  });
  await context.addColumn('product_addons', 'storefront_config', {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {},
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn('product_addons', 'storefront_config');
  await context.removeColumn('products', 'storefront_config');
}
