import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `CREATE TABLE IF NOT EXISTS customer_email_inspections (
      id BIGSERIAL PRIMARY KEY,
      gmail_message_id VARCHAR(256) NOT NULL UNIQUE,
      status VARCHAR(32) NOT NULL DEFAULT 'processing',
      action_created BOOLEAN NOT NULL DEFAULT FALSE,
      inspected_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  );
  await context.sequelize.query(
    `CREATE INDEX IF NOT EXISTS customer_email_inspections_status_idx
     ON customer_email_inspections (status, updated_at);`,
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query('DROP TABLE IF EXISTS customer_email_inspections;');
}
