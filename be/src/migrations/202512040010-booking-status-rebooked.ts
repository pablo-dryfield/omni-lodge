import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_BOOKINGS = 'bookings';
const TABLE_BOOKING_EVENTS = 'booking_events';
const BOOKING_STATUS_ENUM = 'enum_bookings_status';
const BOOKING_EVENTS_STATUS_ENUM = 'enum_booking_events_status_after';
const NEW_STATUS = 'rebooked';

const BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'amended',
  'cancelled',
  'completed',
  'no_show',
  'unknown',
] as const;

const addEnumValue = async (qi: QueryInterface, typeName: string, value: string, transaction?: Transaction): Promise<void> => {
  await qi.sequelize.query(`ALTER TYPE "${typeName}" ADD VALUE IF NOT EXISTS '${value}';`, { transaction });
};

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.transaction(async (transaction) => {
    await addEnumValue(qi, BOOKING_STATUS_ENUM, NEW_STATUS, transaction);
    await addEnumValue(qi, BOOKING_EVENTS_STATUS_ENUM, NEW_STATUS, transaction);
  });
}

const recreateEnum = async (
  qi: QueryInterface,
  params: { table: string; column: string; typeName: string; values: readonly string[]; transaction: Transaction },
): Promise<void> => {
  const { table, column, typeName, values, transaction } = params;
  const tmpType = `${typeName}_old`;

  await qi.sequelize.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT;`, { transaction });
  await qi.sequelize.query(`ALTER TYPE "${typeName}" RENAME TO "${tmpType}";`, { transaction });
  await qi.sequelize.query(`CREATE TYPE "${typeName}" AS ENUM (${values.map((val) => `'${val}'`).join(', ')});`, { transaction });
  await qi.sequelize.query(
    `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "${typeName}" USING "${column}"::text::"${typeName}";`,
    { transaction },
  );
  await qi.sequelize.query(`DROP TYPE "${tmpType}";`, { transaction });
};

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.transaction(async (transaction) => {
    await qi.sequelize.query(
      `UPDATE "${TABLE_BOOKINGS}" SET status = 'amended' WHERE status = '${NEW_STATUS}';`,
      { transaction },
    );
    await qi.sequelize.query(
      `UPDATE "${TABLE_BOOKING_EVENTS}" SET status_after = 'amended' WHERE status_after = '${NEW_STATUS}';`,
      { transaction },
    );

    await recreateEnum(qi, {
      table: TABLE_BOOKINGS,
      column: 'status',
      typeName: BOOKING_STATUS_ENUM,
      values: BOOKING_STATUSES,
      transaction,
    });
    await qi.sequelize.query(
      `ALTER TABLE "${TABLE_BOOKINGS}" ALTER COLUMN "status" SET DEFAULT 'unknown'::"${BOOKING_STATUS_ENUM}";`,
      { transaction },
    );

    await recreateEnum(qi, {
      table: TABLE_BOOKING_EVENTS,
      column: 'status_after',
      typeName: BOOKING_EVENTS_STATUS_ENUM,
      values: BOOKING_STATUSES,
      transaction,
    });
  });
}
