import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'users';
const COLUMNS = [
  { name: 'badge_name', type: DataTypes.STRING },
  { name: 'badge_prefix_emoji', type: DataTypes.STRING },
  { name: 'badge_suffix_emoji', type: DataTypes.STRING },
] as const;

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const table = (await (qi as any).describeTable(TABLE)) as Record<string, unknown>;
  for (const column of COLUMNS) {
    if (!(column.name in table)) {
      await qi.addColumn(TABLE, column.name, {
        type: column.type,
        allowNull: true,
      });
    }
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const table = (await (qi as any).describeTable(TABLE)) as Record<string, unknown>;
  for (const column of [...COLUMNS].reverse()) {
    if (column.name in table) {
      await qi.removeColumn(TABLE, column.name);
    }
  }
}
