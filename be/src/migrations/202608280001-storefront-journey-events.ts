import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.createTable('storefront_journey_visits', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    public_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    ongoing_cart_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: 'storefront_ongoing_carts', key: 'id' },
      onDelete: 'CASCADE',
    },
    browser_instance_id: { type: DataTypes.UUID, allowNull: true },
    first_page_id: { type: DataTypes.UUID, allowNull: true },
    last_page_id: { type: DataTypes.UUID, allowNull: true },
    started_at: { type: DataTypes.DATE, allowNull: false },
    last_activity_at: { type: DataTypes.DATE, allowNull: false },
    qualified_at: { type: DataTypes.DATE, allowNull: false },
    clarity_sampled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    clarity_session_id: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false },
    updated_at: { type: DataTypes.DATE, allowNull: false },
  });

  await context.addIndex('storefront_journey_visits', ['ongoing_cart_id', 'started_at']);
  await context.addIndex('storefront_journey_visits', ['browser_instance_id', 'last_activity_at']);

  await context.createTable('storefront_journey_events', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    public_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    visit_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: 'storefront_journey_visits', key: 'id' },
      onDelete: 'CASCADE',
    },
    ongoing_cart_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: 'storefront_ongoing_carts', key: 'id' },
      onDelete: 'CASCADE',
    },
    page_id: { type: DataTypes.UUID, allowNull: true },
    type: { type: DataTypes.STRING(64), allowNull: false },
    source: { type: DataTypes.STRING(16), allowNull: false },
    severity: { type: DataTypes.STRING(16), allowNull: false },
    sequence: { type: DataTypes.INTEGER, allowNull: true },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    details: { type: DataTypes.JSONB, allowNull: true },
    received_at: { type: DataTypes.DATE, allowNull: false },
  });

  await context.addIndex('storefront_journey_events', ['ongoing_cart_id', 'occurred_at']);
  await context.addIndex('storefront_journey_events', ['visit_id', 'occurred_at']);
  await context.addIndex('storefront_journey_events', ['type', 'occurred_at']);
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable('storefront_journey_events');
  await context.dropTable('storefront_journey_visits');
}
