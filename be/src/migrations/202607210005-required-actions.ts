import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `CREATE TABLE IF NOT EXISTS required_actions (
        id SERIAL PRIMARY KEY,
        type VARCHAR(64) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        target_user_ids JSONB NULL,
        target_user_type_ids JSONB NULL,
        target_shift_role_ids JSONB NULL,
        requires_completion BOOLEAN NOT NULL DEFAULT TRUE,
        starts_at TIMESTAMPTZ NULL,
        due_at TIMESTAMPTZ NULL,
        expires_at TIMESTAMPTZ NULL,
        status BOOLEAN NOT NULL DEFAULT TRUE,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE TABLE IF NOT EXISTS required_action_completions (
        id SERIAL PRIMARY KEY,
        required_action_id INTEGER NOT NULL REFERENCES required_actions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(32) NOT NULL DEFAULT 'completed',
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT required_action_completions_unique_user_action UNIQUE (required_action_id, user_id)
      );`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE INDEX IF NOT EXISTS required_actions_active_idx
       ON required_actions (status, type, starts_at, expires_at);`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE INDEX IF NOT EXISTS required_action_completions_user_idx
       ON required_action_completions (user_id, required_action_id);`,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query('DROP TABLE IF EXISTS required_action_completions;', { transaction });
    await context.sequelize.query('DROP TABLE IF EXISTS required_actions;', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
