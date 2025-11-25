import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

const TABLE = 'venues';
const VENDOR_COLUMN = 'finance_vendor_id';
const CLIENT_COLUMN = 'finance_client_id';

const VENDOR_FK = 'venues_finance_vendor_id_fkey';
const CLIENT_FK = 'venues_finance_client_id_fkey';
const VENDOR_IDX = 'venues_finance_vendor_lookup_idx';
const CLIENT_IDX = 'venues_finance_client_lookup_idx';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.addColumn(
      TABLE,
      VENDOR_COLUMN,
      {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE,
      CLIENT_COLUMN,
      {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      { transaction },
    );

    await qi.addConstraint(TABLE, {
      name: VENDOR_FK,
      type: 'foreign key',
      fields: [VENDOR_COLUMN],
      references: {
        table: 'finance_vendors',
        field: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      transaction,
    });

    await qi.addConstraint(TABLE, {
      name: CLIENT_FK,
      type: 'foreign key',
      fields: [CLIENT_COLUMN],
      references: {
        table: 'finance_clients',
        field: 'id',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      transaction,
    });

    await qi.addIndex(TABLE, [VENDOR_COLUMN], { name: VENDOR_IDX, transaction });
    await qi.addIndex(TABLE, [CLIENT_COLUMN], { name: CLIENT_IDX, transaction });

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
    await qi.removeIndex(TABLE, VENDOR_IDX, { transaction }).catch(() => {});
    await qi.removeIndex(TABLE, CLIENT_IDX, { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE, VENDOR_FK, { transaction }).catch(() => {});
    await qi.removeConstraint(TABLE, CLIENT_FK, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE, VENDOR_COLUMN, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE, CLIENT_COLUMN, { transaction }).catch(() => {});
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
