import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';

type MigrationParams = { context: QueryInterface };

export async function up({ context }: MigrationParams): Promise<void> {
  await context.addColumn('users', 'finance_vendor_id', {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'finance_vendors',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  });

  await context.createTable('affiliate_payout_logs', {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },
    affiliate_user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    },
    currency_code: {
      type: DataTypes.STRING(3),
      allowNull: false,
    },
    amount_minor: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    range_start: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    range_end: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    paid_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    booking_ids: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
    finance_transaction_id: {
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
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
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
  });

  await context.addIndex('affiliate_payout_logs', ['affiliate_user_id'], {
    name: 'affiliate_payout_logs_affiliate_user_id_idx',
  });
  await context.addIndex('affiliate_payout_logs', ['finance_transaction_id'], {
    name: 'affiliate_payout_logs_finance_transaction_id_idx',
  });
}

export async function down({ context }: MigrationParams): Promise<void> {
  await context.dropTable('affiliate_payout_logs');
  await context.removeColumn('users', 'finance_vendor_id');
}
