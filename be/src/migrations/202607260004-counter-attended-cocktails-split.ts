import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const METRICS_TABLE = 'counter_channel_metrics';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.query(`
    WITH cocktail_addon AS (
      SELECT id
      FROM addons
      WHERE name ILIKE '%cocktail%'
      ORDER BY id
      LIMIT 1
    ),
    booking_split AS (
      SELECT
        c.id AS counter_id,
        ch.id AS channel_id,
        cocktail_addon.id AS addon_id,
        SUM(GREATEST(att.attended_total - att.attended_cocktails, 0))::INTEGER AS normal_attended,
        SUM(att.attended_cocktails)::INTEGER AS cocktails_attended
      FROM counters c
      JOIN bookings b
        ON b.experience_date = c.date
       AND b.product_id = c.product_id
      JOIN channels ch
        ON regexp_replace(lower(ch.name), '[^a-z0-9]', '', 'g') =
           regexp_replace(lower(b.platform), '[^a-z0-9]', '', 'g')
      LEFT JOIN payment_methods pm ON pm.id = ch.payment_method_id
      CROSS JOIN cocktail_addon
      CROSS JOIN LATERAL (
        SELECT
          GREATEST(ROUND(COALESCE(b.attended_total, 0))::INTEGER, 0) AS attended_total,
          GREATEST(
            ROUND(COALESCE(NULLIF(b.addons_snapshot->'extras'->>'cocktails', '')::NUMERIC, 0))::INTEGER,
            0
          ) AS purchased_cocktails,
          GREATEST(
            ROUND(COALESCE(NULLIF(b.attended_addons_snapshot->>'cocktails', '')::NUMERIC, 0))::INTEGER,
            0
          ) AS explicit_attended_cocktails
      ) raw
      CROSS JOIN LATERAL (
        SELECT
          raw.attended_total,
          CASE
            WHEN raw.explicit_attended_cocktails > 0 THEN LEAST(raw.explicit_attended_cocktails, raw.attended_total)
            WHEN raw.purchased_cocktails > 0
             AND raw.attended_total > 0
             AND lower(COALESCE(b.attendance_status::TEXT, '')) = 'checked_in_full'
              THEN LEAST(raw.purchased_cocktails, raw.attended_total)
            ELSE 0
          END AS attended_cocktails
      ) att
      WHERE c.product_id IS NOT NULL
        AND COALESCE(lower(pm.name), '') <> 'cash'
        AND b.status IN ('pending', 'confirmed', 'amended', 'completed')
      GROUP BY c.id, ch.id, cocktail_addon.id
    ),
    updated_people AS (
      UPDATE "${METRICS_TABLE}" metric
      SET
        qty = booking_split.normal_attended,
        "updatedAt" = NOW()
      FROM booking_split
      WHERE metric.counter_id = booking_split.counter_id
        AND metric.channel_id = booking_split.channel_id
        AND metric.kind = 'people'
        AND metric.tally_type = 'attended'
        AND metric.addon_id IS NULL
        AND metric.period IS NULL
      RETURNING metric.counter_id, metric.channel_id
    ),
    inserted_people AS (
      INSERT INTO "${METRICS_TABLE}" (
        counter_id,
        channel_id,
        kind,
        addon_id,
        tally_type,
        period,
        qty,
        "createdAt",
        "updatedAt"
      )
      SELECT
        booking_split.counter_id,
        booking_split.channel_id,
        'people',
        NULL,
        'attended',
        NULL,
        booking_split.normal_attended,
        NOW(),
        NOW()
      FROM booking_split
      WHERE booking_split.normal_attended > 0
        AND NOT EXISTS (
          SELECT 1
          FROM "${METRICS_TABLE}" metric
          WHERE metric.counter_id = booking_split.counter_id
            AND metric.channel_id = booking_split.channel_id
            AND metric.kind = 'people'
            AND metric.tally_type = 'attended'
            AND metric.addon_id IS NULL
            AND metric.period IS NULL
        )
      RETURNING counter_id, channel_id
    ),
    updated_cocktails AS (
      UPDATE "${METRICS_TABLE}" metric
      SET
        qty = booking_split.cocktails_attended,
        "updatedAt" = NOW()
      FROM booking_split
      WHERE metric.counter_id = booking_split.counter_id
        AND metric.channel_id = booking_split.channel_id
        AND metric.kind = 'addon'
        AND metric.addon_id = booking_split.addon_id
        AND metric.tally_type = 'attended'
        AND metric.period IS NULL
      RETURNING metric.counter_id, metric.channel_id
    )
    INSERT INTO "${METRICS_TABLE}" (
      counter_id,
      channel_id,
      kind,
      addon_id,
      tally_type,
      period,
      qty,
      "createdAt",
      "updatedAt"
    )
    SELECT
      booking_split.counter_id,
      booking_split.channel_id,
      'addon',
      booking_split.addon_id,
      'attended',
      NULL,
      booking_split.cocktails_attended,
      NOW(),
      NOW()
    FROM booking_split
    WHERE booking_split.cocktails_attended > 0
      AND NOT EXISTS (
        SELECT 1
        FROM "${METRICS_TABLE}" metric
        WHERE metric.counter_id = booking_split.counter_id
          AND metric.channel_id = booking_split.channel_id
          AND metric.kind = 'addon'
          AND metric.addon_id = booking_split.addon_id
          AND metric.tally_type = 'attended'
          AND metric.period IS NULL
      );
  `);
}

export async function down(): Promise<void> {
  // No-op: this migration backfills derived counter metrics from booking attendance.
}
