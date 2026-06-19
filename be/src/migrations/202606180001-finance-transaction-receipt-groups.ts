import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_FINANCE_TRANSACTIONS = 'finance_transactions';

const COLUMN_RECEIPT_GROUP_KEY = 'receipt_group_key';
const COLUMN_RECEIPT_TOTAL_MINOR = 'receipt_total_minor';
const COLUMN_RECEIPT_CURRENCY = 'receipt_currency';
const COLUMN_RECEIPT_ALLOCATION_NOTE = 'receipt_allocation_note';
const COLUMN_RECEIPT_LINE_ORDER = 'receipt_line_order';

const INDEX_RECEIPT_GROUP_KEY = 'finance_transactions_receipt_group_key_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_GROUP_KEY, {
    type: DataTypes.STRING(64),
    allowNull: true,
  });

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_TOTAL_MINOR, {
    type: DataTypes.INTEGER,
    allowNull: true,
  });

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_CURRENCY, {
    type: DataTypes.STRING(3),
    allowNull: true,
  });

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_ALLOCATION_NOTE, {
    type: DataTypes.TEXT,
    allowNull: true,
  });

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_LINE_ORDER, {
    type: DataTypes.INTEGER,
    allowNull: true,
  });

  await qi.addIndex(TABLE_FINANCE_TRANSACTIONS, [COLUMN_RECEIPT_GROUP_KEY], {
    name: INDEX_RECEIPT_GROUP_KEY,
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.removeIndex(TABLE_FINANCE_TRANSACTIONS, INDEX_RECEIPT_GROUP_KEY);
  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_LINE_ORDER);
  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_ALLOCATION_NOTE);
  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_CURRENCY);
  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_TOTAL_MINOR);
  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_RECEIPT_GROUP_KEY);
}
