import { DataTypes, QueryInterface } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'users';

const addColumnIfMissing = async (
  queryInterface: QueryInterface,
  table: Record<string, unknown>,
  name: string,
  options: Parameters<QueryInterface['addColumn']>[2],
): Promise<void> => {
  if (!(name in table)) {
    await queryInterface.addColumn(TABLE, name, options);
  }
};

const addActorColumn = async (queryInterface: QueryInterface, table: Record<string, unknown>, name: string): Promise<void> => {
  await addColumnIfMissing(queryInterface, table, name, {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });
};

export async function up({ context }: MigrationParams): Promise<void> {
  const table = (await context.describeTable(TABLE)) as Record<string, unknown>;
  await addColumnIfMissing(context, table, 'approved_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addActorColumn(context, table, 'approved_by');
  await addColumnIfMissing(context, table, 'approval_revoked_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addActorColumn(context, table, 'approval_revoked_by');
  await addColumnIfMissing(context, table, 'deactivated_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addActorColumn(context, table, 'deactivated_by');
  await addColumnIfMissing(context, table, 'reactivated_at', {
    type: DataTypes.DATE,
    allowNull: true,
  });
  await addActorColumn(context, table, 'reactivated_by');
}

export async function down({ context }: MigrationParams): Promise<void> {
  const table = (await context.describeTable(TABLE)) as Record<string, unknown>;
  for (const column of [
    'reactivated_by',
    'reactivated_at',
    'deactivated_by',
    'deactivated_at',
    'approval_revoked_by',
    'approval_revoked_at',
    'approved_by',
    'approved_at',
  ]) {
    if (column in table) {
      await context.removeColumn(TABLE, column);
    }
  }
}
