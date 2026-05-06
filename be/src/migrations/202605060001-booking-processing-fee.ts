import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_PROCESSING_FEE = 'processing_fee';
const COLUMN_PROCESSING_FEE_CURRENCY = 'processing_fee_currency';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_PROCESSING_FEE, {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  });
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_PROCESSING_FEE_CURRENCY, {
    type: DataTypes.STRING(3),
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_PROCESSING_FEE_CURRENCY);
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_PROCESSING_FEE);
}

