import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';
type MigrationParams = { context: QueryInterface };
export async function up({ context: query }: MigrationParams) {
  await query.addColumn('review_archive', 'is_no_name', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await query.addColumn('review_archive', 'is_bad_review', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
}
export async function down({ context: query }: MigrationParams) {
  await query.removeColumn('review_archive', 'is_bad_review');
  await query.removeColumn('review_archive', 'is_no_name');
}
