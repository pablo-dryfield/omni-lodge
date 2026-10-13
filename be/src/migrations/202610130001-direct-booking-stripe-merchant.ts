import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_STRIPE_MERCHANT = 'stripe_merchant';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn(TABLE_BOOKINGS, COLUMN_STRIPE_MERCHANT, {
    type: DataTypes.STRING(64),
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn(TABLE_BOOKINGS, COLUMN_STRIPE_MERCHANT);
}
