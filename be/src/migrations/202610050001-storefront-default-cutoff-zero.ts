import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    UPDATE products
    SET storefront_config = jsonb_set(
      storefront_config,
      '{availability,cutoffMinutes}',
      '0'::jsonb,
      false
    )
    WHERE storefront_config #>> '{availability,cutoffMinutes}' = '30'
  `);
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(`
    UPDATE products
    SET storefront_config = jsonb_set(
      storefront_config,
      '{availability,cutoffMinutes}',
      '30'::jsonb,
      false
    )
    WHERE storefront_config #>> '{availability,cutoffMinutes}' = '0'
  `);
}
