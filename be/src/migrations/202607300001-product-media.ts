import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn('products', 'image_url', {
    type: DataTypes.TEXT,
    allowNull: true,
  });
  await context.addColumn('products', 'images', {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: [],
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn('products', 'images');
  await context.removeColumn('products', 'image_url');
}

export async function verify({ context }: MigrationParams): Promise<boolean> {
  const columns = await context.describeTable('products');
  return Boolean(columns.image_url && columns.images);
}
