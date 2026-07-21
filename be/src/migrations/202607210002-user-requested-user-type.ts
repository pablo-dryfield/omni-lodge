import { DataTypes, QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'users';

export async function up({ context }: MigrationParams): Promise<void> {
  const table = (await context.describeTable(TABLE)) as Record<string, unknown>;
  if (!('requested_user_type' in table)) {
    await context.addColumn(TABLE, 'requested_user_type', {
      type: DataTypes.STRING,
      allowNull: true,
    });
  }
  if (!('approved' in table)) {
    await context.addColumn(TABLE, 'approved', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const table = (await context.describeTable(TABLE)) as Record<string, unknown>;
  if ('approved' in table) {
    await context.removeColumn(TABLE, 'approved');
  }
  if ('requested_user_type' in table) {
    await context.removeColumn(TABLE, 'requested_user_type');
  }
}
