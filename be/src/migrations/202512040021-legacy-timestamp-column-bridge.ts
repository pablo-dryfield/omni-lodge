import type { QueryInterface, Transaction } from 'sequelize';
import { DataTypes, literal } from 'sequelize';

type MigrationParams = { context: QueryInterface };
type ColumnDescription = {
  allowNull?: boolean;
  defaultValue?: unknown;
  type?: string;
};
type TableDescription = Record<string, ColumnDescription>;

/**
 * These models use Sequelize's default timestamp names. Their original table
 * migrations created snake-case timestamps, while the long-running database
 * was normalized by Sequelize to the camel-case physical columns.
 *
 * Keep this bridge immediately after booking-index-tuning: that migration is
 * the last historical migration which addresses booking_events.created_at by
 * name. PostgreSQL keeps its index attached when the column is renamed.
 */
export const CAMEL_TIMESTAMP_TABLES = [
  'availabilities',
  'booking_addons',
  'booking_emails',
  'booking_events',
  'channel_commissions',
  'channel_product_prices',
  'product_prices',
  'schedule_weeks',
  'shift_assignments',
  'shift_instances',
  'shift_roles',
  'shift_templates',
  'staff_profiles',
  'swap_requests',
  'user_shift_roles',
  'venue_compensation_terms',
  'venue_compensation_term_rates',
] as const;

const hasDefault = (column: ColumnDescription | undefined): boolean => (
  column?.defaultValue !== null && column?.defaultValue !== undefined
);

const isTimestampWithTimeZone = (column: ColumnDescription | undefined): boolean => (
  typeof column?.type === 'string'
  && /TIMESTAMP(?:\(\d+\))? WITH TIME ZONE/i.test(column.type)
);

async function describeTable(
  context: QueryInterface,
  table: string,
  transaction?: Transaction,
): Promise<TableDescription> {
  return await (context as any).describeTable(table, { transaction }) as TableDescription;
}

async function ensureTimestampColumn(
  context: QueryInterface,
  table: string,
  canonicalName: 'createdAt' | 'updatedAt',
  legacyName: 'created_at' | 'updated_at',
  transaction: Transaction,
): Promise<void> {
  const columns = await describeTable(context, table, transaction);
  const canonicalColumn = columns[canonicalName];
  const legacyColumn = columns[legacyName];
  let resultingColumn = canonicalColumn;
  let structuralChange = false;

  if (!canonicalColumn && legacyColumn) {
    await context.renameColumn(table, legacyName, canonicalName, { transaction });
    resultingColumn = legacyColumn;
    structuralChange = true;
  } else if (!canonicalColumn) {
    // A database missing both historical spellings is recoverable without
    // manufacturing nullable model timestamps for its existing rows.
    await context.addColumn(table, canonicalName, {
      type: DataTypes.DATE,
      allowNull: true,
    }, { transaction });
    resultingColumn = { allowNull: true, defaultValue: undefined, type: 'TIMESTAMP WITH TIME ZONE' };
    structuralChange = true;
  }

  if (resultingColumn?.allowNull !== false) {
    const fallback = canonicalColumn && legacyColumn
      ? literal(`COALESCE("${legacyName}", NOW())`)
      : literal('NOW()');
    await context.bulkUpdate(
      table,
      { [canonicalName]: fallback },
      { [canonicalName]: null },
      { transaction },
    );
  }

  if (structuralChange
      || resultingColumn?.allowNull !== false
      || hasDefault(resultingColumn)
      || !isTimestampWithTimeZone(resultingColumn)) {
    // Omitting defaultValue intentionally emits DROP DEFAULT. Sequelize owns
    // these values and the production schema has no database-side default.
    await context.changeColumn(table, canonicalName, {
      type: DataTypes.DATE,
      allowNull: false,
    }, { transaction });
  }
}

export async function up({ context }: MigrationParams): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    for (const table of CAMEL_TIMESTAMP_TABLES) {
      await ensureTimestampColumn(context, table, 'createdAt', 'created_at', transaction);
      await ensureTimestampColumn(context, table, 'updatedAt', 'updated_at', transaction);
    }
  });
}

export async function down(): Promise<void> {
  // The camel-case columns historically existed in production before this
  // migration owned the schema. Renaming or removing them on rollback could
  // break the running models or destroy an independently-created column.
}

export async function verify({ context }: MigrationParams): Promise<{
  ok: boolean;
  details: {
    missingColumns: string[];
    nullableColumns: string[];
    columnsWithDefaults: string[];
    invalidTypes: string[];
  };
}> {
  const missingColumns: string[] = [];
  const nullableColumns: string[] = [];
  const columnsWithDefaults: string[] = [];
  const invalidTypes: string[] = [];

  for (const table of CAMEL_TIMESTAMP_TABLES) {
    const columns = await describeTable(context, table);
    for (const columnName of ['createdAt', 'updatedAt'] as const) {
      const column = columns[columnName];
      const qualifiedName = `${table}.${columnName}`;
      if (!column) {
        missingColumns.push(qualifiedName);
        continue;
      }
      if (column.allowNull !== false) nullableColumns.push(qualifiedName);
      if (hasDefault(column)) columnsWithDefaults.push(qualifiedName);
      if (!isTimestampWithTimeZone(column)) invalidTypes.push(qualifiedName);
    }
  }

  return {
    ok: missingColumns.length === 0
      && nullableColumns.length === 0
      && columnsWithDefaults.length === 0
      && invalidTypes.length === 0,
    details: {
      missingColumns,
      nullableColumns,
      columnsWithDefaults,
      invalidTypes,
    },
  };
}
