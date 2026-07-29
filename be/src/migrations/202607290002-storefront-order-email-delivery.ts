import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn('storefront_orders', 'customer_email_sent_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await context.addColumn('storefront_orders', 'internal_email_sent_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn('storefront_orders', 'internal_email_sent_at');
  await context.removeColumn('storefront_orders', 'customer_email_sent_at');
}
