import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';
type MigrationParams = { context: QueryInterface };
export async function up({ context: query }: MigrationParams) {
  await query.changeColumn('review_manual_credits', 'user_id', { type: DataTypes.INTEGER, allowNull: true, references: { model: 'users', key: 'id' } });
  await query.addColumn('review_manual_credits', 'category', { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'staff' });
}
export async function down({ context: query }: MigrationParams) {
  await query.removeColumn('review_manual_credits', 'category');
  await query.changeColumn('review_manual_credits', 'user_id', { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } });
}
