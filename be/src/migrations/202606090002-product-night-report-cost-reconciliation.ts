import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_PRODUCTS = 'products';
const COLUMN_REQUIRES_RECONCILIATION = 'requires_night_report_cost_reconciliation';

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn(TABLE_PRODUCTS, COLUMN_REQUIRES_RECONCILIATION, {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.removeColumn(TABLE_PRODUCTS, COLUMN_REQUIRES_RECONCILIATION);
}
