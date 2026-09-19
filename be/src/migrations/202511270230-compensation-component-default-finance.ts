import { DataTypes, QueryInterface } from 'sequelize';

const TABLE = 'compensation_components';
type MigrationParams = { context: QueryInterface };

export async function up({ context: qi }: MigrationParams): Promise<void> {
  await qi.addColumn(TABLE, 'default_finance_account_id', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'finance_accounts',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });

  await qi.addColumn(TABLE, 'default_finance_category_id', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'finance_categories',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });
}

export async function down({ context: qi }: MigrationParams): Promise<void> {
  await qi.removeColumn(TABLE, 'default_finance_category_id');
  await qi.removeColumn(TABLE, 'default_finance_account_id');
}
