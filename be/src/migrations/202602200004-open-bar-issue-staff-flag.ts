import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_ISSUES = 'open_bar_drink_issues';
const COLUMN_STAFF_FLAG = 'is_staff_drink';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    const columns = await qi.describeTable(TABLE_ISSUES);
    if (!(COLUMN_STAFF_FLAG in columns)) {
      await qi.addColumn(
        TABLE_ISSUES,
        COLUMN_STAFF_FLAG,
        {
          type: DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: false,
        },
        { transaction },
      );
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();
  try {
    const columns = await qi.describeTable(TABLE_ISSUES);
    if (COLUMN_STAFF_FLAG in columns) {
      await qi.removeColumn(TABLE_ISSUES, COLUMN_STAFF_FLAG, { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
