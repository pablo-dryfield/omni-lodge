import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context: qi }: MigrationParams): Promise<void> {
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.addColumn('venue_compensation_terms', 'min_duration_minutes', {
      type: DataTypes.INTEGER,
      allowNull: true,
    }, { transaction });
    await qi.addColumn('venue_compensation_terms', 'max_duration_minutes', {
      type: DataTypes.INTEGER,
      allowNull: true,
    }, { transaction });
    await qi.addColumn('night_report_venues', 'stay_duration_minutes', {
      type: DataTypes.INTEGER,
      allowNull: true,
    }, { transaction });
    await qi.addIndex('venue_compensation_terms', [
      'venue_id',
      'compensation_type',
      'min_duration_minutes',
      'max_duration_minutes',
    ], { name: 'venue_comp_terms_duration_idx', transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context: qi }: MigrationParams): Promise<void> {
  const transaction = await qi.sequelize.transaction();
  try {
    await qi.removeIndex('venue_compensation_terms', 'venue_comp_terms_duration_idx', { transaction }).catch(() => {});
    await qi.removeColumn('night_report_venues', 'stay_duration_minutes', { transaction });
    await qi.removeColumn('venue_compensation_terms', 'max_duration_minutes', { transaction });
    await qi.removeColumn('venue_compensation_terms', 'min_duration_minutes', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
