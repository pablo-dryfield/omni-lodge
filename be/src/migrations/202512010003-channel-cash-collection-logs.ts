import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'channel_cash_collection_logs';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      TABLE,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        channelId: {
          field: 'channel_id',
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'channels',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        currencyCode: {
          field: 'currency_code',
          type: DataTypes.STRING(3),
          allowNull: false,
          defaultValue: 'PLN',
        },
        amountMinor: {
          field: 'amount_minor',
          type: DataTypes.INTEGER,
          allowNull: false,
        },
        rangeStart: {
          field: 'range_start',
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        rangeEnd: {
          field: 'range_end',
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        financeTransactionId: {
          field: 'finance_transaction_id',
          type: DataTypes.INTEGER,
          allowNull: true,
          references: {
            model: 'finance_transactions',
            key: 'id',
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        note: {
          type: DataTypes.TEXT,
          allowNull: true,
        },
        createdBy: {
          field: 'created_by',
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'users',
            key: 'id',
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
        },
        createdAt: {
          field: 'created_at',
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
        updatedAt: {
          field: 'updated_at',
          type: DataTypes.DATE,
          allowNull: true,
        },
      },
      { transaction },
    );

    await qi.addIndex(TABLE, ['channel_id', 'range_start', 'range_end'], {
      name: 'channel_cash_collection_range_idx',
      transaction,
    });
    await qi.addIndex(TABLE, ['finance_transaction_id'], {
      name: 'channel_cash_collection_finance_tx_idx',
      transaction,
    });

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
    await qi.removeIndex(TABLE, 'channel_cash_collection_range_idx', { transaction }).catch(() => {});
    await qi.removeIndex(TABLE, 'channel_cash_collection_finance_tx_idx', { transaction }).catch(() => {});
    await qi.dropTable(TABLE, { transaction }).catch(() => {});
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

