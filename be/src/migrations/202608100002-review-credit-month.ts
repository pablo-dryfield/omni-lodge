import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context: queryInterface }: MigrationParams): Promise<void> {
  await queryInterface.addColumn('review_archive', 'credit_month', {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });
  await queryInterface.addIndex('review_archive', ['credit_month'], {
    name: 'review_archive_credit_month_idx',
  });
}

export async function down({ context: queryInterface }: MigrationParams): Promise<void> {
  await queryInterface.removeIndex('review_archive', 'review_archive_credit_month_idx');
  await queryInterface.removeColumn('review_archive', 'credit_month');
}
