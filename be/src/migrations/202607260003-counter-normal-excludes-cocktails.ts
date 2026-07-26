import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const METRICS_TABLE = 'counter_channel_metrics';
const ADDONS_TABLE = 'addons';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.query(`
    WITH cocktail_metrics AS (
      SELECT
        metric.counter_id,
        metric.channel_id,
        metric.tally_type,
        COALESCE(metric.period::text, '__attended__') AS period_key,
        SUM(metric.qty) AS cocktail_qty
      FROM "${METRICS_TABLE}" AS metric
      JOIN "${ADDONS_TABLE}" AS addon ON addon.id = metric.addon_id
      WHERE metric.kind = 'addon'
        AND addon.name ILIKE '%cocktail%'
      GROUP BY
        metric.counter_id,
        metric.channel_id,
        metric.tally_type,
        COALESCE(metric.period::text, '__attended__')
    )
    UPDATE "${METRICS_TABLE}" AS people
    SET
      qty = GREATEST(people.qty - cocktail_metrics.cocktail_qty, 0),
      "updatedAt" = NOW()
    FROM cocktail_metrics
    WHERE people.kind = 'people'
      AND people.counter_id = cocktail_metrics.counter_id
      AND people.channel_id = cocktail_metrics.channel_id
      AND people.tally_type = cocktail_metrics.tally_type
      AND COALESCE(people.period::text, '__attended__') = cocktail_metrics.period_key
      AND cocktail_metrics.cocktail_qty > 0;
  `);
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.sequelize.query(`
    WITH cocktail_metrics AS (
      SELECT
        metric.counter_id,
        metric.channel_id,
        metric.tally_type,
        COALESCE(metric.period::text, '__attended__') AS period_key,
        SUM(metric.qty) AS cocktail_qty
      FROM "${METRICS_TABLE}" AS metric
      JOIN "${ADDONS_TABLE}" AS addon ON addon.id = metric.addon_id
      WHERE metric.kind = 'addon'
        AND addon.name ILIKE '%cocktail%'
      GROUP BY
        metric.counter_id,
        metric.channel_id,
        metric.tally_type,
        COALESCE(metric.period::text, '__attended__')
    )
    UPDATE "${METRICS_TABLE}" AS people
    SET
      qty = people.qty + cocktail_metrics.cocktail_qty,
      "updatedAt" = NOW()
    FROM cocktail_metrics
    WHERE people.kind = 'people'
      AND people.counter_id = cocktail_metrics.counter_id
      AND people.channel_id = cocktail_metrics.channel_id
      AND people.tally_type = cocktail_metrics.tally_type
      AND COALESCE(people.period::text, '__attended__') = cocktail_metrics.period_key
      AND cocktail_metrics.cocktail_qty > 0;
  `);
}
