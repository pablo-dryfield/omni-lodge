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

@Table({
  tableName: 'venue_compensation_ledgers',
  modelName: 'VenueCompensationLedger',
  timestamps: true,
})
export default class VenueCompensationLedger extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @ForeignKey(() => Venue)
  @AllowNull(false)
  @Column({ field: 'venue_id', type: DataType.INTEGER })
  declare venueId: number;

  @BelongsTo(() => Venue, { foreignKey: 'venue_id', as: 'ledgerVenue' })
  declare venue?: NonAttribute<Venue>;

  @AllowNull(false)
  @Column({ type: DataType.ENUM('receivable', 'payable') })
  declare direction: 'receivable' | 'payable';

  @AllowNull(false)
  @Column({ field: 'range_start', type: DataType.DATEONLY })
  declare rangeStart: string;

  @AllowNull(false)
  @Column({ field: 'range_end', type: DataType.DATEONLY })
  declare rangeEnd: string;

  @AllowNull(false)
  @Default('PLN')
  @Column({ field: 'currency_code', type: DataType.STRING(3) })
  declare currencyCode: string;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'opening_balance_minor', type: DataType.INTEGER })
  declare openingBalanceMinor: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'due_amount_minor', type: DataType.INTEGER })
  declare dueAmountMinor: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'paid_amount_minor', type: DataType.INTEGER })
  declare paidAmountMinor: number;

  @AllowNull(false)
  @Default(0)
  @Column({ field: 'closing_balance_minor', type: DataType.INTEGER })
  declare closingBalanceMinor: number;

  @AllowNull(false)
  @Default(DataType.NOW)
  @Column({ field: 'created_at', type: DataType.DATE })
  declare createdAt: Date;

  @AllowNull(true)
  @Column({ field: 'updated_at', type: DataType.DATE })
  declare updatedAt: Date | null;
}
