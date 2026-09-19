import type { QueryInterface } from 'sequelize';
import { DataTypes, literal } from 'sequelize';

type MigrationParams = { context: QueryInterface };
type ColumnDescription = {
  allowNull?: boolean;
  defaultValue?: unknown;
  type?: string;
};

const TABLE = 'report_templates';
const COLUMN = 'preview_order';

const hasEmptyArrayDefault = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === 'string' && value.replace(/\s/g, '').includes('[]');
};

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    const columns = await (context as any).describeTable(TABLE, { transaction }) as Record<string, ColumnDescription>;
    const existing = columns[COLUMN];

    if (!existing) {
      await context.addColumn(TABLE, COLUMN, {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      }, { transaction });
      return;
    }

    if (existing.allowNull !== false) {
      await context.bulkUpdate(
        TABLE,
        { [COLUMN]: literal("'[]'::jsonb") },
        { [COLUMN]: null },
        { transaction },
      );
    }

    if (existing.allowNull !== false
        || existing.type?.toUpperCase() !== 'JSONB'
        || !hasEmptyArrayDefault(existing.defaultValue)) {
      await context.changeColumn(TABLE, COLUMN, {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      }, { transaction });
    }
  });
}

export async function down(): Promise<void> {
  // preview_order may have been created previously by Sequelize sync. Its
  // origin is not distinguishable, so rollback deliberately preserves data.
}

export async function verify({ context }: MigrationParams): Promise<{
  ok: boolean;
  details: {
    missing: boolean;
    nullable: boolean;
    invalidType: boolean;
    missingDefault: boolean;
  };
}> {
  const columns = await context.describeTable(TABLE) as Record<string, ColumnDescription>;
  const column = columns[COLUMN];
  const details = {
    missing: !column,
    nullable: Boolean(column && column.allowNull !== false),
    invalidType: Boolean(column && column.type?.toUpperCase() !== 'JSONB'),
    missingDefault: Boolean(column && !hasEmptyArrayDefault(column.defaultValue)),
  };

  return {
    ok: !details.missing && !details.nullable && !details.invalidType && !details.missingDefault,
    details,
  };
}
