import type { QueryInterface, Transaction } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.sequelize.query(
      `ALTER TABLE required_actions
       ADD COLUMN IF NOT EXISTS target_staff_profile_types JSONB NULL;`,
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
      `ALTER TABLE required_actions
       DROP COLUMN IF EXISTS target_staff_profile_types;`,
      { transaction },
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
