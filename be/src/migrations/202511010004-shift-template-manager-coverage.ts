import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.addColumn('shift_templates', 'manager_covers_team', {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  await qi.removeColumn('shift_templates', 'manager_covers_team');
}

