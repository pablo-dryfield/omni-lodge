import type { QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query(
    `CREATE TABLE IF NOT EXISTS customer_email_thread_participants (
      id SERIAL PRIMARY KEY,
      thread_id VARCHAR(256) NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      first_message_id VARCHAR(256) NULL,
      last_message_id VARCHAR(256) NULL,
      first_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT customer_email_thread_participants_unique UNIQUE (thread_id, user_id)
    );`,
  );
  await context.sequelize.query(
    `CREATE INDEX IF NOT EXISTS customer_email_thread_participants_thread_idx
     ON customer_email_thread_participants (thread_id);`,
  );
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.sequelize.query('DROP TABLE IF EXISTS customer_email_thread_participants;');
}
