import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable('storefront_orders', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    public_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'draft' },
    payment_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'unpaid' },
    stripe_checkout_session_id: { type: DataTypes.STRING, allowNull: true, unique: true },
    stripe_payment_intent_id: { type: DataTypes.STRING, allowNull: true },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'PLN' },
    subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    addon_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    discount_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    total: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    customer_first_name: { type: DataTypes.STRING, allowNull: false },
    customer_last_name: { type: DataTypes.STRING, allowNull: false },
    customer_email: { type: DataTypes.STRING, allowNull: false },
    customer_phone: { type: DataTypes.STRING, allowNull: true },
    customer_country_code: { type: DataTypes.STRING(2), allowNull: true },
    discount_code: { type: DataTypes.STRING, allowNull: true },
    attribution: { type: DataTypes.JSONB, allowNull: true },
    metadata: { type: DataTypes.JSONB, allowNull: true },
    paid_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });

  await context.createTable('storefront_order_items', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    order_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: 'storefront_orders', key: 'id' },
      onDelete: 'CASCADE',
    },
    product_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'products', key: 'id' },
    },
    product_name: { type: DataTypes.STRING, allowNull: false },
    product_slug: { type: DataTypes.STRING, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    experience_date: { type: DataTypes.DATEONLY, allowNull: true },
    experience_time: { type: DataTypes.STRING(16), allowNull: true },
    unit_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    base_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    addon_total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    total: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    addons: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    options: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });

  await context.createTable('storefront_promotions', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    type: { type: DataTypes.STRING(16), allowNull: false },
    value: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: true },
    min_subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
    max_redemptions: { type: DataTypes.INTEGER, allowNull: true },
    redemption_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    valid_from: { type: DataTypes.DATE, allowNull: true },
    valid_to: { type: DataTypes.DATE, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    metadata: { type: DataTypes.JSONB, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });

  await context.addIndex('storefront_orders', ['customer_email']);
  await context.addIndex('storefront_orders', ['payment_status']);
  await context.addIndex('storefront_order_items', ['order_id']);
  await context.addIndex('storefront_order_items', ['product_id']);
  await context.addIndex('storefront_promotions', ['is_active']);
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable('storefront_order_items');
  await context.dropTable('storefront_promotions');
  await context.dropTable('storefront_orders');
}
