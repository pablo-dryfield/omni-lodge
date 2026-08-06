import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable('user_type_product_types', {
    user_type_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'userTypes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      primaryKey: true,
    },
    product_type_id: {
      type: DataTypes.INTEGER, allowNull: false,
      references: { model: 'productTypes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      primaryKey: true,
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await context.addIndex('user_type_product_types', ['product_type_id'], {
    name: 'user_type_product_types_product_type_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable('user_type_product_types');
}
