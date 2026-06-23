import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'users';
const COLUMN = 'affiliate_commission_rate';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.changeColumn(TABLE, COLUMN, {
    type: DataTypes.DECIMAL(8, 4),
    allowNull: false,
    defaultValue: 0,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.changeColumn(TABLE, COLUMN, {
    type: DataTypes.DECIMAL(8, 4),
    allowNull: false,
    defaultValue: 18.18,
  });
}
