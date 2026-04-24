import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_DISCOUNT_CODE = 'discount_code';
const COLUMN_TIP_AMOUNT = 'tip_amount';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_DISCOUNT_CODE, {
    type: DataTypes.STRING(128),
    allowNull: true,
  });
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_TIP_AMOUNT, {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_TIP_AMOUNT);
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_DISCOUNT_CODE);
}
