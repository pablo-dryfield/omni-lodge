import {
  AllowNull,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import Currency from './Currency.js';
import User from './User.js';

@Table({
  timestamps: true,
  underscored: true,
  modelName: 'CurrencyExchangeRate',
  tableName: 'currency_exchange_rates',
})
export default class CurrencyExchangeRate extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Currency)
  @AllowNull(false)
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;

  @BelongsTo(() => Currency, { foreignKey: 'currency_code', as: 'currency' })
  declare currency?: Currency;

  @AllowNull(false)
  @Column({ field: 'exchange_rate_to_pln', type: DataType.DECIMAL(12, 6) })
  declare exchangeRateToPln: number;

  @AllowNull(false)
  @Column({ field: 'effective_at', type: DataType.DATE })
  declare effectiveAt: Date;

  @AllowNull(true)
  @Column(DataType.STRING(80))
  declare source: string | null;

  @AllowNull(true)
  @Column(DataType.TEXT)
  declare note: string | null;

  @ForeignKey(() => User)
  @AllowNull(true)
  @Column({ field: 'created_by', type: DataType.INTEGER })
  declare createdBy: number | null;

  @BelongsTo(() => User, { foreignKey: 'created_by', as: 'createdByUser' })
  declare createdByUser?: User;
}
