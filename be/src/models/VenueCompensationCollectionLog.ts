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
import Venue from './Venue.js';
import FinanceTransaction from '../finance/models/FinanceTransaction.js';
import User from './User.js';

@Table({
  tableName: 'venue_compensation_collection_logs',
  modelName: 'VenueCompensationCollectionLog',
  timestamps: true,
})
export default class VenueCompensationCollectionLog extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Venue)
  @AllowNull(false)
  @Column({ field: 'venue_id', type: DataType.INTEGER })
  declare venueId: number;

  @BelongsTo(() => Venue, { foreignKey: 'venue_id', as: 'venue' })
  declare venue?: NonAttribute<Venue>;

  @AllowNull(false)
  @Column({ type: DataType.ENUM('receivable', 'payable') })
  declare direction: 'receivable' | 'payable';

  @AllowNull(false)
  @Default('USD')
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
