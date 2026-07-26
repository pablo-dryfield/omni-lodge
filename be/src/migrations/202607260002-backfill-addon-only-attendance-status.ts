import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'bookings';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.query(`
    WITH addon_attendance AS (
      SELECT
        id,
        COALESCE((addons_snapshot->'extras'->>'tshirts')::int, 0)
          + COALESCE((addons_snapshot->'extras'->>'cocktails')::int, 0)
          + COALESCE((addons_snapshot->'extras'->>'photos')::int, 0) AS purchased_extras,
        COALESCE((attended_addons_snapshot->>'tshirts')::int, 0)
          + COALESCE((attended_addons_snapshot->>'cocktails')::int, 0)
          + COALESCE((attended_addons_snapshot->>'photos')::int, 0) AS attended_extras,
        CASE
          WHEN COALESCE((attended_addons_snapshot->>'tshirts')::int, 0) >= COALESCE((addons_snapshot->'extras'->>'tshirts')::int, 0)
            AND COALESCE((attended_addons_snapshot->>'cocktails')::int, 0) >= COALESCE((addons_snapshot->'extras'->>'cocktails')::int, 0)
            AND COALESCE((attended_addons_snapshot->>'photos')::int, 0) >= COALESCE((addons_snapshot->'extras'->>'photos')::int, 0)
          THEN 'checked_in_full'
          ELSE 'checked_in_partial'
        END AS next_attendance_status
      FROM "${TABLE}"
      WHERE COALESCE(party_size_total, 0) <= 0
        AND COALESCE(party_size_adults, 0) + COALESCE(party_size_children, 0) <= 0
        AND status IN ('pending', 'confirmed', 'amended', 'completed')
        AND attendance_status = 'pending'
        AND attended_addons_snapshot IS NOT NULL
        AND addons_snapshot ? 'extras'
    )
    UPDATE "${TABLE}" AS booking
    SET
      attendance_status = addon_attendance.next_attendance_status::enum_bookings_attendance_status,
      checked_in_at = COALESCE(booking.checked_in_at, booking.updated_at, NOW())
    FROM addon_attendance
    WHERE booking.id = addon_attendance.id
      AND addon_attendance.purchased_extras > 0
      AND addon_attendance.attended_extras > 0;
  `);
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.query(`
    WITH addon_attendance AS (
      SELECT id
      FROM "${TABLE}"
      WHERE COALESCE(party_size_total, 0) <= 0
        AND COALESCE(party_size_adults, 0) + COALESCE(party_size_children, 0) <= 0
        AND attendance_status IN ('checked_in_full', 'checked_in_partial')
        AND attended_addons_snapshot IS NOT NULL
        AND addons_snapshot ? 'extras'
        AND (
          COALESCE((attended_addons_snapshot->>'tshirts')::int, 0)
          + COALESCE((attended_addons_snapshot->>'cocktails')::int, 0)
          + COALESCE((attended_addons_snapshot->>'photos')::int, 0)
        ) > 0
    )
    UPDATE "${TABLE}" AS booking
    SET attendance_status = 'pending'::enum_bookings_attendance_status
    FROM addon_attendance
    WHERE booking.id = addon_attendance.id;
  `);
}
