import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const TABLE = 'channel_product_prices';
const OLD_INDEX = 'channel_product_prices_range_idx';
const NEW_INDEX = 'channel_product_prices_ticket_currency_range_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const qi = context;
  const transaction = await qi.sequelize.transaction();

  try {
    await qi.addColumn(
      TABLE,
      'ticket_type',
      {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: 'normal',
      },
      { transaction },
    );

    await qi.addColumn(
      TABLE,
      'currency_code',
      {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'PLN',
      },
      { transaction },
    );

    await qi.removeIndex(TABLE, OLD_INDEX, { transaction }).catch(() => {});
    await qi.addIndex(
      TABLE,
      ['channel_id', 'product_id', 'ticket_type', 'currency_code', 'valid_from', 'valid_to'],
      { name: NEW_INDEX, transaction },
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
    await qi.removeIndex(TABLE, NEW_INDEX, { transaction }).catch(() => {});
    await qi.removeColumn(TABLE, 'currency_code', { transaction });
    await qi.removeColumn(TABLE, 'ticket_type', { transaction });

    await qi.addIndex(TABLE, ['channel_id', 'product_id', 'valid_from', 'valid_to'], {
      name: OLD_INDEX,
      transaction,
    });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
