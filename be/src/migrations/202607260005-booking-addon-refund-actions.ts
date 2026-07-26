import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_ADDON_REFUND_ACTIONS = 'addon_refund_actions';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_ADDON_REFUND_ACTIONS, {
    type: DataTypes.JSONB,
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_ADDON_REFUND_ACTIONS);
}
