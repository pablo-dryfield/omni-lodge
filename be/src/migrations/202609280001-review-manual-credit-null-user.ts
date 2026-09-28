import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

/**
 * PostgreSQL kept the original NOT NULL constraint in production even though
 * the category migration changed the Sequelize definition. Re-apply the
 * column definition without recreating the foreign key so no-name and bad
 * review counters can be stored without inventing a user.
 */
export async function up({ context: query }: MigrationParams): Promise<void> {
  await query.changeColumn('review_manual_credits', 'user_id', {
    type: DataTypes.INTEGER,
    allowNull: true,
  });
}

export async function down({ context: query }: MigrationParams): Promise<void> {
  await query.sequelize.transaction(async (transaction) => {
    await query.bulkDelete('review_manual_credits', { user_id: null }, { transaction });
    await query.changeColumn('review_manual_credits', 'user_id', {
      type: DataTypes.INTEGER,
      allowNull: false,
    }, { transaction });
  });
}
