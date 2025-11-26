import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'venue_compensation_collection_logs';

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
        venueId: {
          field: 'venue_id',
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'venues',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        direction: {
          type: DataTypes.ENUM('receivable', 'payable'),
          allowNull: false,
        },
        currencyCode: {
          field: 'currency_code',
          type: DataTypes.STRING(3),
          allowNull: false,
          defaultValue: 'USD',
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
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL',
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
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
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

    await qi.addIndex(TABLE, ['venue_id', 'range_start', 'range_end'], { name: 'venue_collection_range_idx', transaction });
    await qi.addIndex(TABLE, ['finance_transaction_id'], { name: 'venue_collection_finance_tx_idx', transaction });

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
    await qi.removeIndex(TABLE, 'venue_collection_range_idx', { transaction }).catch(() => {});
    await qi.removeIndex(TABLE, 'venue_collection_finance_tx_idx', { transaction }).catch(() => {});
    await qi.dropTable(TABLE, { transaction }).catch(() => {});
    await qi.sequelize.query('DROP TYPE IF EXISTS "enum_venue_compensation_collection_logs_direction"', { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
