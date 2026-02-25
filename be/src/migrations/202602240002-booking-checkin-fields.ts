import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_ATTENDED_ADDONS = 'attended_addons_snapshot';
const COLUMN_CHECKED_IN_AT = 'checked_in_at';
const COLUMN_CHECKED_IN_BY = 'checked_in_by';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_ATTENDED_ADDONS, {
    type: DataTypes.JSONB,
    allowNull: true,
  });
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_CHECKED_IN_AT, {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_CHECKED_IN_BY, {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_CHECKED_IN_BY);
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_CHECKED_IN_AT);
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_ATTENDED_ADDONS);
}
