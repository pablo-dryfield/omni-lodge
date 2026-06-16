import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE_FINANCE_TRANSACTIONS = 'finance_transactions';
const COLUMN_NIGHT_REPORT_ID = 'night_report_id';
const COLUMN_PRODUCT_ID = 'product_id';
const COLUMN_SERVICE_DATE = 'service_date';

const INDEX_NIGHT_REPORT_ID = 'finance_transactions_night_report_id_idx';
const INDEX_PRODUCT_ID = 'finance_transactions_product_id_idx';
const INDEX_SERVICE_DATE = 'finance_transactions_service_date_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_NIGHT_REPORT_ID, {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'night_reports',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_PRODUCT_ID, {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'products',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });

  await qi.addColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_SERVICE_DATE, {
    type: DataTypes.DATEONLY,
    allowNull: true,
  });

  await qi.addIndex(TABLE_FINANCE_TRANSACTIONS, [COLUMN_NIGHT_REPORT_ID], { name: INDEX_NIGHT_REPORT_ID });
  await qi.addIndex(TABLE_FINANCE_TRANSACTIONS, [COLUMN_PRODUCT_ID], { name: INDEX_PRODUCT_ID });
  await qi.addIndex(TABLE_FINANCE_TRANSACTIONS, [COLUMN_SERVICE_DATE], { name: INDEX_SERVICE_DATE });

  await qi.sequelize.query(`
    UPDATE finance_transactions
    SET night_report_id = NULLIF(meta->>'night_report_id', '')::integer
    WHERE kind = 'expense'
      AND meta->>'source' = 'night-report-cost'
      AND meta ? 'night_report_id'
      AND night_report_id IS NULL
  `);

  await qi.sequelize.query(`
    UPDATE finance_transactions AS ft
    SET
      service_date = nr.activity_date,
      product_id = c.product_id
    FROM night_reports AS nr
    JOIN counters AS c
      ON c.id = nr.counter_id
    WHERE ft.night_report_id = nr.id
      AND (ft.service_date IS NULL OR ft.product_id IS NULL)
  `);
}

export async function down({ context }: MigrationParams): Promise<void> {
  const qi = context;

  await qi.removeIndex(TABLE_FINANCE_TRANSACTIONS, INDEX_SERVICE_DATE);
  await qi.removeIndex(TABLE_FINANCE_TRANSACTIONS, INDEX_PRODUCT_ID);
  await qi.removeIndex(TABLE_FINANCE_TRANSACTIONS, INDEX_NIGHT_REPORT_ID);

  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_SERVICE_DATE);
  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_PRODUCT_ID);
  await qi.removeColumn(TABLE_FINANCE_TRANSACTIONS, COLUMN_NIGHT_REPORT_ID);
}
