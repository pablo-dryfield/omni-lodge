import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS required_actions_customer_email_message_uidx
     ON required_actions ((payload->>'gmailMessageId'))
     WHERE type = 'customer_email';`,
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query('DROP INDEX IF EXISTS required_actions_customer_email_message_uidx;');
}
