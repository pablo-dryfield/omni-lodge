import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_REFUNDED_CURRENCY = 'refunded_currency';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_REFUNDED_CURRENCY, {
    type: DataTypes.STRING(3),
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_REFUNDED_CURRENCY);
}
