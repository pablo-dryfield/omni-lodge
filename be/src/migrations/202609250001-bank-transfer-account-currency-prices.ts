import type { QueryInterface, Transaction } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

const FINANCE_ACCOUNTS_TABLE = 'finance_accounts';
const CURRENCIES_TABLE = 'currencies';
const CURRENCY_EXCHANGE_RATES_TABLE = 'currency_exchange_rates';
const PRODUCT_PRICES_TABLE = 'product_prices';
const STOREFRONT_ORDERS_TABLE = 'storefront_orders';
const CURRENCY_EXCHANGE_RATES_LOOKUP_INDEX = 'currency_exchange_rates_currency_effective_idx';
const PRODUCT_PRICE_CURRENCY_INDEX = 'product_prices_product_currency_range_idx';
const ORDER_BANK_TRANSFER_ACCOUNT_INDEX = 'storefront_orders_bank_transfer_account_idx';

export async function up({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.createTable(CURRENCIES_TABLE, {
      code: {
        type: DataTypes.STRING(3),
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      exchange_rate_to_pln: {
        type: DataTypes.DECIMAL(12, 6),
        allowNull: false,
        defaultValue: 1,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      last_rate_updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, { transaction });
    await context.bulkInsert(CURRENCIES_TABLE, [
      {
        code: 'PLN',
        name: 'Polish złoty',
        exchange_rate_to_pln: 1,
        is_active: true,
        last_rate_updated_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ], { transaction });
    await context.sequelize.query(
      `INSERT INTO "${CURRENCIES_TABLE}" (
          code,
          name,
          exchange_rate_to_pln,
          is_active,
          last_rate_updated_at,
          created_at,
          updated_at
        )
        SELECT DISTINCT
          UPPER(TRIM(currency)) AS code,
          UPPER(TRIM(currency)) AS name,
          1 AS exchange_rate_to_pln,
          true AS is_active,
          NOW() AS last_rate_updated_at,
          NOW() AS created_at,
          NOW() AS updated_at
        FROM "${FINANCE_ACCOUNTS_TABLE}"
        WHERE currency IS NOT NULL
          AND LENGTH(TRIM(currency)) = 3
        ON CONFLICT (code) DO NOTHING;`,
      { transaction },
    );
    await context.sequelize.query(
      `UPDATE "${FINANCE_ACCOUNTS_TABLE}"
          SET currency = UPPER(TRIM(currency))
        WHERE currency IS NOT NULL
          AND currency <> UPPER(TRIM(currency));`,
      { transaction },
    );

    await context.createTable(CURRENCY_EXCHANGE_RATES_TABLE, {
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      currency_code: {
        type: DataTypes.STRING(3),
        allowNull: false,
        references: { model: CURRENCIES_TABLE, key: 'code' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      exchange_rate_to_pln: {
        type: DataTypes.DECIMAL(12, 6),
        allowNull: false,
      },
      effective_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      source: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, { transaction });
    await context.addIndex(
      CURRENCY_EXCHANGE_RATES_TABLE,
      ['currency_code', 'effective_at'],
      { name: CURRENCY_EXCHANGE_RATES_LOOKUP_INDEX, transaction },
    );
    await context.sequelize.query(
      `INSERT INTO "${CURRENCY_EXCHANGE_RATES_TABLE}" (
          currency_code,
          exchange_rate_to_pln,
          effective_at,
          source,
          note,
          created_at,
          updated_at
        )
        SELECT
          code,
          exchange_rate_to_pln,
          COALESCE(last_rate_updated_at, NOW()),
          'migration',
          'Initial currency rate created during bank-transfer currency migration',
          NOW(),
          NOW()
        FROM "${CURRENCIES_TABLE}";`,
      { transaction },
    );

    await context.addColumn(FINANCE_ACCOUNTS_TABLE, 'account_holder_name', {
      type: DataTypes.STRING(160),
      allowNull: true,
    }, { transaction });
    await context.addColumn(FINANCE_ACCOUNTS_TABLE, 'account_number', {
      type: DataTypes.STRING(80),
      allowNull: true,
    }, { transaction });
    await context.addColumn(FINANCE_ACCOUNTS_TABLE, 'swift_code', {
      type: DataTypes.STRING(32),
      allowNull: true,
    }, { transaction });
    await context.addColumn(FINANCE_ACCOUNTS_TABLE, 'bank_name', {
      type: DataTypes.STRING(160),
      allowNull: true,
    }, { transaction });
    await context.addColumn(FINANCE_ACCOUNTS_TABLE, 'bank_transfer_instructions', {
      type: DataTypes.TEXT,
      allowNull: true,
    }, { transaction });

    await context.addColumn(PRODUCT_PRICES_TABLE, 'currency_code', {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'PLN',
    }, { transaction });
    await context.addIndex(
      PRODUCT_PRICES_TABLE,
      ['product_id', 'currency_code', 'valid_from', 'valid_to'],
      { name: PRODUCT_PRICE_CURRENCY_INDEX, transaction },
    );
    await context.addConstraint(PRODUCT_PRICES_TABLE, {
      fields: ['currency_code'],
      type: 'foreign key',
      name: 'product_prices_currency_code_fkey',
      references: { table: CURRENCIES_TABLE, field: 'code' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
      transaction,
    });
    await context.addConstraint(FINANCE_ACCOUNTS_TABLE, {
      fields: ['currency'],
      type: 'foreign key',
      name: 'finance_accounts_currency_fkey',
      references: { table: CURRENCIES_TABLE, field: 'code' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
      transaction,
    });

    await context.addColumn(STOREFRONT_ORDERS_TABLE, 'bank_transfer_account_id', {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: FINANCE_ACCOUNTS_TABLE, key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }, { transaction });
    await context.addIndex(
      STOREFRONT_ORDERS_TABLE,
      ['bank_transfer_account_id'],
      { name: ORDER_BANK_TRANSFER_ACCOUNT_INDEX, transaction },
    );

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function down({ context }: MigrationParams): Promise<void> {
  const transaction: Transaction = await context.sequelize.transaction();
  try {
    await context.removeIndex(STOREFRONT_ORDERS_TABLE, ORDER_BANK_TRANSFER_ACCOUNT_INDEX, { transaction })
      .catch(() => {});
    await context.removeColumn(STOREFRONT_ORDERS_TABLE, 'bank_transfer_account_id', { transaction });

    await context.removeIndex(PRODUCT_PRICES_TABLE, PRODUCT_PRICE_CURRENCY_INDEX, { transaction })
      .catch(() => {});
    await context.removeConstraint(PRODUCT_PRICES_TABLE, 'product_prices_currency_code_fkey', { transaction })
      .catch(() => {});
    await context.removeConstraint(FINANCE_ACCOUNTS_TABLE, 'finance_accounts_currency_fkey', { transaction })
      .catch(() => {});
    await context.removeColumn(PRODUCT_PRICES_TABLE, 'currency_code', { transaction });

    await context.removeColumn(FINANCE_ACCOUNTS_TABLE, 'bank_transfer_instructions', { transaction });
    await context.removeColumn(FINANCE_ACCOUNTS_TABLE, 'bank_name', { transaction });
    await context.removeColumn(FINANCE_ACCOUNTS_TABLE, 'swift_code', { transaction });
    await context.removeColumn(FINANCE_ACCOUNTS_TABLE, 'account_number', { transaction });
    await context.removeColumn(FINANCE_ACCOUNTS_TABLE, 'account_holder_name', { transaction });

    await context.removeIndex(CURRENCY_EXCHANGE_RATES_TABLE, CURRENCY_EXCHANGE_RATES_LOOKUP_INDEX, { transaction })
      .catch(() => {});
    await context.dropTable(CURRENCY_EXCHANGE_RATES_TABLE, { transaction });
    await context.dropTable(CURRENCIES_TABLE, { transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
