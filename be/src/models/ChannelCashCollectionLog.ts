import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { NonAttribute } from 'sequelize';

import Channel from './Channel.js';
import User from './User.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';

@Table({
  tableName: 'channel_cash_collection_logs',
  modelName: 'ChannelCashCollectionLog',
  timestamps: true,
})
export default class ChannelCashCollectionLog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Channel)
  @AllowNull(false)
  @Column({ field: 'channel_id', type: DataType.INTEGER })
  declare channelId: number;

  @BelongsTo(() => Channel, { foreignKey: 'channel_id', as: 'channel' })
  declare channel?: NonAttribute<Channel>;

  @AllowNull(false)
  @Default('PLN')
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;

  @AllowNull(false)
  @Column({ field: 'amount_minor', type: DataType.INTEGER })
  declare amountMinor: number;

  @AllowNull(false)
  @Column({ field: 'range_start', type: DataType.DATEONLY })
  declare rangeStart: string;

  @AllowNull(false)
  @Column({ field: 'range_end', type: DataType.DATEONLY })
  declare rangeEnd: string;

  @ForeignKey(() => FinanceTransaction)
  @AllowNull(true)
  @Column({ field: 'finance_transaction_id', type: DataType.INTEGER })
  declare financeTransactionId: number | null;

  @BelongsTo(() => FinanceTransaction, { foreignKey: 'finance_transaction_id', as: 'financeTransaction' })
  declare financeTransaction?: NonAttribute<FinanceTransaction | null>;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare note: string | null;

  @ForeignKey(() => User)
  @AllowNull(false)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: NonAttribute<User>;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}

