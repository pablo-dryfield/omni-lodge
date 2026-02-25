import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';
import { BOOKING_ATTENDANCE_STATUSES } from '../constants/bookings.js';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const COLUMN_ATTENDANCE_STATUS = 'attendance_status';
const ENUM_BOOKINGS_ATTENDANCE_STATUS = 'enum_bookings_attendance_status';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(TABLE_BOOKINGS, COLUMN_ATTENDANCE_STATUS, {
    type: DataTypes.ENUM(...BOOKING_ATTENDANCE_STATUSES),
    allowNull: false,
    defaultValue: 'pending',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, COLUMN_ATTENDANCE_STATUS);
  await qi.sequelize.query(`DROP TYPE IF EXISTS "${ENUM_BOOKINGS_ATTENDANCE_STATUS}";`);
}
