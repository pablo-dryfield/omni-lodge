import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `ALTER TABLE required_action_completions
       ADD COLUMN IF NOT EXISTS prompted_at TIMESTAMPTZ NULL,
       ADD COLUMN IF NOT EXISTS last_prompted_at TIMESTAMPTZ NULL,
       ADD COLUMN IF NOT EXISTS prompt_count INTEGER NOT NULL DEFAULT 0;`,
      { transaction },
    );

    await context.sequelize.query(
      `ALTER TABLE required_action_completions
       ALTER COLUMN completed_at DROP NOT NULL;`,
      { transaction },
    );

    await context.sequelize.query(
      `CREATE INDEX IF NOT EXISTS required_action_completions_action_idx
       ON required_action_completions (required_action_id, status);`,
      { transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `DROP INDEX IF EXISTS required_action_completions_action_idx;`,
      { transaction },
    );
    await context.sequelize.query(
      `ALTER TABLE required_action_completions
       DROP COLUMN IF EXISTS prompted_at,
       DROP COLUMN IF EXISTS last_prompted_at,
       DROP COLUMN IF EXISTS prompt_count;`,
      { transaction },
    );
    await context.sequelize.query(
      `ALTER TABLE required_action_completions
       ALTER COLUMN completed_at SET NOT NULL;`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
