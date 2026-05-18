import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_PAYMENT_METHOD_COUNTRY = 'payment_method_country';
const COLUMN_IP_ADDRESS = 'ip_address';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_PAYMENT_METHOD_COUNTRY, {
    type: DataTypes.STRING(5),
    allowNull: true,
  });
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_IP_ADDRESS, {
    type: DataTypes.STRING(45),
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_IP_ADDRESS);
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_PAYMENT_METHOD_COUNTRY);
}

