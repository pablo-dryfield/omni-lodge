import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_NIGHT_REPORTS = 'night_reports';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn(TABLE_NIGHT_REPORTS, 'no_extra_cost_confirmed', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });

  await context.addColumn(TABLE_NIGHT_REPORTS, 'no_extra_cost_confirmed_by', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });

  await context.addColumn(TABLE_NIGHT_REPORTS, 'no_extra_cost_confirmed_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn(TABLE_NIGHT_REPORTS, 'no_extra_cost_confirmed_at');
  await context.removeColumn(TABLE_NIGHT_REPORTS, 'no_extra_cost_confirmed_by');
  await context.removeColumn(TABLE_NIGHT_REPORTS, 'no_extra_cost_confirmed');
}
