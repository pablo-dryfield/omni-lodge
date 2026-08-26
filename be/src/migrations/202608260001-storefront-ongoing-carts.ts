import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable('storefront_ongoing_carts', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    public_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    session_id: { type: DataTypes.UUID, allowNull: false },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
    cart: { type: DataTypes.JSONB, allowNull: false },
    customer: { type: DataTypes.JSONB, allowNull: false },
    quote_snapshot: { type: DataTypes.JSONB, allowNull: false },
    attribution: { type: DataTypes.JSONB, allowNull: true },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'PLN' },
    total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    last_activity_at: { type: DataTypes.DATE, allowNull: false },
    recovery_due_at: { type: DataTypes.DATE, allowNull: false },
    recovery_sent_at: { type: DataTypes.DATE, allowNull: true },
    recovery_message_id: { type: DataTypes.STRING(255), allowNull: true },
    recovery_error: { type: DataTypes.TEXT, allowNull: true },
    opened_at: { type: DataTypes.DATE, allowNull: true },
    checkout_started_at: { type: DataTypes.DATE, allowNull: true },
    converted_at: { type: DataTypes.DATE, allowNull: true },
    dismissed_at: { type: DataTypes.DATE, allowNull: true },
    order_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'storefront_orders', key: 'id' },
      onDelete: 'SET NULL',
    },
    metadata: { type: DataTypes.JSONB, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });

  await context.addIndex('storefront_ongoing_carts', ['status']);
  await context.addIndex('storefront_ongoing_carts', ['recovery_due_at']);
  await context.addIndex('storefront_ongoing_carts', ['order_id']);
  await context.addIndex('storefront_ongoing_carts', ['customer'], { using: 'gin' });
  await context.sequelize.query(`
    CREATE UNIQUE INDEX storefront_ongoing_carts_active_session
    ON storefront_ongoing_carts (session_id)
    WHERE status IN ('active', 'checkout_started', 'sending_recovery', 'recovery_sent')
  `);
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable('storefront_ongoing_carts');
}
