import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const CHANNEL_COMMISSIONS_TABLE = 'channel_commissions';
const PRODUCT_PRICES_TABLE = 'product_prices';
const CHANNEL_PRODUCT_PRICES_TABLE = 'channel_product_prices';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.createTable(
      CHANNEL_COMMISSIONS_TABLE,
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
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        rate: {
          type: DataTypes.DECIMAL(6, 4),
          allowNull: false,
        },
        validFrom: {
          field: 'valid_from',
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        validTo: {
          field: 'valid_to',
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        createdBy: {
          field: 'created_by',
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        updatedBy: {
          field: 'updated_by',
          type: DataTypes.INTEGER,
          allowNull: true,
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
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
      },
      { transaction },
    );

    await qi.addIndex(
      CHANNEL_COMMISSIONS_TABLE,
      ['channel_id', 'valid_from', 'valid_to'],
      {
        name: 'channel_commissions_channel_range_idx',
        transaction,
      },
    );

    await qi.createTable(
      PRODUCT_PRICES_TABLE,
      {
        id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
        },
        productId: {
          field: 'product_id',
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'products',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        price: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        validFrom: {
          field: 'valid_from',
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        validTo: {
          field: 'valid_to',
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        createdBy: {
          field: 'created_by',
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        updatedBy: {
          field: 'updated_by',
          type: DataTypes.INTEGER,
          allowNull: true,
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
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
      },
      { transaction },
    );

    await qi.addIndex(
      PRODUCT_PRICES_TABLE,
      ['product_id', 'valid_from', 'valid_to'],
      {
        name: 'product_prices_product_range_idx',
        transaction,
      },
    );

    await qi.createTable(
      CHANNEL_PRODUCT_PRICES_TABLE,
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
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        productId: {
          field: 'product_id',
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: 'products',
            key: 'id',
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        price: {
          type: DataTypes.DECIMAL(10, 2),
          allowNull: false,
        },
        validFrom: {
          field: 'valid_from',
          type: DataTypes.DATEONLY,
          allowNull: false,
        },
        validTo: {
          field: 'valid_to',
          type: DataTypes.DATEONLY,
          allowNull: true,
        },
        createdBy: {
          field: 'created_by',
          type: DataTypes.INTEGER,
          allowNull: true,
        },
        updatedBy: {
          field: 'updated_by',
          type: DataTypes.INTEGER,
          allowNull: true,
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
          allowNull: false,
          defaultValue: DataTypes.NOW,
        },
      },
      { transaction },
    );

    await qi.addIndex(
      CHANNEL_PRODUCT_PRICES_TABLE,
      ['channel_id', 'product_id', 'valid_from', 'valid_to'],
      {
        name: 'channel_product_prices_range_idx',
        transaction,
      },
    );

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
    await qi.removeIndex(CHANNEL_PRODUCT_PRICES_TABLE, 'channel_product_prices_range_idx', { transaction });
    await qi.dropTable(CHANNEL_PRODUCT_PRICES_TABLE, { transaction });

    await qi.removeIndex(PRODUCT_PRICES_TABLE, 'product_prices_product_range_idx', { transaction });
    await qi.dropTable(PRODUCT_PRICES_TABLE, { transaction });

    await qi.removeIndex(CHANNEL_COMMISSIONS_TABLE, 'channel_commissions_channel_range_idx', { transaction });
    await qi.dropTable(CHANNEL_COMMISSIONS_TABLE, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
