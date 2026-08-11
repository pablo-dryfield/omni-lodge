import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const KEY = 'CUSTOMER_EMAIL_ACTION_BATCH_SIZE';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `UPDATE config_keys
     SET default_value = '10', updated_at = NOW()
     WHERE key = :key`,
    { replacements: { key: KEY } },
  );
  await context.sequelize.query(
    `UPDATE config_values
     SET value = '10', updated_at = NOW()
     WHERE key = :key AND value = '20'`,
    { replacements: { key: KEY } },
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `UPDATE config_keys
     SET default_value = '20', updated_at = NOW()
     WHERE key = :key`,
    { replacements: { key: KEY } },
  );
  await context.sequelize.query(
    `UPDATE config_values
     SET value = '20', updated_at = NOW()
     WHERE key = :key AND value = '10'`,
    { replacements: { key: KEY } },
  );
}
