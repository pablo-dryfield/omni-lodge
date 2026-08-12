import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable('storefront_saved_carts', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    public_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    name: { type: DataTypes.STRING(160), allowNull: false },
    cart: { type: DataTypes.JSONB, allowNull: false },
    customer: { type: DataTypes.JSONB, allowNull: true },
    quote_snapshot: { type: DataTypes.JSONB, allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'PLN' },
    total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    is_locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    opened_at: { type: DataTypes.DATE, allowNull: true },
    checkout_started_at: { type: DataTypes.DATE, allowNull: true },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    disabled_at: { type: DataTypes.DATE, allowNull: true },
    order_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'storefront_orders', key: 'id' },
      onDelete: 'SET NULL',
    },
    created_by_user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onDelete: 'RESTRICT',
    },
    metadata: { type: DataTypes.JSONB, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });

  await context.addIndex('storefront_saved_carts', ['status']);
  await context.addIndex('storefront_saved_carts', ['expires_at']);
  await context.addIndex('storefront_saved_carts', ['order_id']);
  await context.addIndex('storefront_saved_carts', ['created_by_user_id']);
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable('storefront_saved_carts');
}
