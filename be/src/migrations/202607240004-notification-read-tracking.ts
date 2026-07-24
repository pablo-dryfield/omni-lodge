import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `ALTER TABLE notifications
       ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL;`,
      { transaction },
    );
    await context.sequelize.query(
      `CREATE INDEX IF NOT EXISTS notifications_user_read_idx
       ON notifications (user_id, read_at, sent_at DESC);`,
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
    await context.sequelize.query('DROP INDEX IF EXISTS notifications_user_read_idx;', { transaction });
    await context.sequelize.query(
      `ALTER TABLE notifications
       DROP COLUMN IF EXISTS read_at;`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
