import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };
const TABLE = 'review_month_locks';

export async function up({ context: queryInterface }: MigrationParams): Promise<void> {
  await queryInterface.createTable(TABLE, {
    id: { type: DataTypes.INTEGER, allowNull: false, autoIncrement: true, primaryKey: true },
    period_start: { type: DataTypes.DATEONLY, allowNull: false, unique: true },
    is_locked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    review_ids: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    locked_at: { type: DataTypes.DATE, allowNull: true },
    locked_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    unlocked_at: { type: DataTypes.DATE, allowNull: true },
    unlocked_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
}

export async function down({ context: queryInterface }: MigrationParams): Promise<void> {
  await queryInterface.dropTable(TABLE);
}
