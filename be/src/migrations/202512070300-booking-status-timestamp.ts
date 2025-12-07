import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const STATUS_COLUMN = 'status_changed_at';

const backfillStatusTimestamp = `
  UPDATE "${TABLE_BOOKINGS}"
  SET ${STATUS_COLUMN} = COALESCE(cancelled_at, source_received_at, processed_at, updated_at, created_at)
  WHERE ${STATUS_COLUMN} IS NULL;
`;

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn(
    TABLE_BOOKINGS,
    STATUS_COLUMN,
    {
      type: DataTypes.DATE,
      allowNull: true,
      field: STATUS_COLUMN,
    },
  );

  await qi.sequelize.query(backfillStatusTimestamp);
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn(TABLE_BOOKINGS, STATUS_COLUMN);
}

